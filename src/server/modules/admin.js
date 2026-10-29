'use strict'
// Users, roles & permissions, event log, system reset.
// Invariants enforced here (master mission §9.3):
//  - at least one active super administrator always remains;
//  - nobody changes their own role, deactivates or deletes themselves;
//  - a role can only be granted/edited/assigned within the actor's own permissions (no escalation);
//  - the protected super-administrator role cannot be edited or deleted, and only a super admin assigns it;
//  - every change is audited; permission changes take effect on the next request (no caching).
const { badRequest, conflict, forbidden, notFound } = require('../errors')
const { PERMISSIONS, KEYS } = require('../auth/permissions')
const { hashPassword, newTemporaryPassword, verifyPassword } = require('../auth/password')
const { activeSuperAdmins, permissionsForRole } = require('../auth/access')
const { helpers: authHelpers } = require('./auth')

// Sign-in state shown to administrators: 'pin' (not moved to a password yet), 'temporary'
// (must choose a password at the next sign-in) or 'password'.
const LOGIN_STATE = `CASE WHEN u.password_scrypt IS NULL THEN 'pin'
  WHEN u.must_change_password THEN 'temporary' ELSE 'password' END`

/**
 * Temporary password for a new or reset account: the administrator's choice (same rules as any
 * password) or a generated one. The user must replace it at their first sign-in.
 */
function temporaryPassword(given, username) {
  if (given) {
    authHelpers.assertNewPassword(given, username)
    return given
  }
  return newTemporaryPassword()
}

async function roleWithPerms(db, roleId) {
  const role = (await db.query('SELECT * FROM roles WHERE id = $1', [roleId])).rows[0]
  if (!role) throw notFound('الدور غير موجود.')
  role.permissions = await permissionsForRole(db, roleId)
  return role
}

/** The actor may only hand out permissions they hold themselves. */
function assertWithinActor(ctx, permissions) {
  const extra = permissions.filter((p) => !ctx.user.permissions.includes(p))
  if (extra.length) throw forbidden(`لا يمكنك منح صلاحيات لا تملكها: ${extra.join('، ')}`)
}

async function assertAssignable(db, ctx, roleId) {
  const role = await roleWithPerms(db, roleId)
  if (role.key === 'super_admin' && ctx.user.roleKey !== 'super_admin')
    throw forbidden('تعيين دور مدير النظام متاح لمدير النظام فقط.')
  assertWithinActor(ctx, role.permissions)
  return role
}

module.exports = function adminModule(app) {
  // ── Users ──────────────────────────────────────────────────
  app.operation({
    name: 'users.list',
    permission: 'users.manage',
    handler: async (ctx) =>
      (
        await ctx.pool.query(
          `SELECT u.id, u.username, u.role, u.is_active, u.created_at, r.id AS role_id, r.key AS role_key, r.name AS role_name,
                  ${LOGIN_STATE} AS login_state
           FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.username ASC`
        )
      ).rows
  })

  app.operation({
    name: 'users.create',
    permission: 'users.manage',
    schema: {
      type: 'object',
      required: ['username', 'roleId'],
      properties: {
        username: { type: 'string', minLength: 2, maxLength: 40 },
        password: { type: 'string', maxLength: 128 },
        roleId: { type: 'integer' }
      }
    },
    handler: async (ctx, u) =>
      ctx.tx(async (db) => {
        const username = u.username.trim()
        // Sign-in ignores case, so names that differ only in case would be ambiguous.
        if (
          (await db.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username]))
            .rowCount
        ) {
          throw conflict('اسم المستخدم هذا مسجل مسبقاً! يرجى اختيار اسم آخر.')
        }
        const role = await assertAssignable(db, ctx, u.roleId)
        const temporary = temporaryPassword(u.password, username)
        const legacyRole =
          role.key === 'super_admin'
            ? 'admin'
            : role.key === 'manager'
              ? 'manager'
              : role.key === 'cashier'
                ? 'cashier'
                : role.key || 'custom'
        const r = await db.query(
          `INSERT INTO users (username, role, role_id, password_scrypt, must_change_password, is_active, created_at)
           VALUES ($1, $2, $3, $4, true, true, LOCALTIMESTAMP(0)) RETURNING id`,
          [username, legacyRole, role.id, hashPassword(temporary)]
        )
        await ctx.audit(db, 'user_create', `إنشاء مستخدم جديد "${username}" بدور ${role.name}`)
        // Shown once to the administrator, who hands it to the user.
        return { id: r.rows[0].id, temporaryPassword: temporary }
      })
  })

  app.operation({
    name: 'users.update',
    permission: 'users.manage',
    schema: {
      type: 'object',
      required: ['id', 'username', 'roleId'],
      properties: {
        id: { type: 'integer' },
        username: { type: 'string', minLength: 2, maxLength: 40 },
        // Replace the user's password with a temporary one (forgotten password, new staff member).
        resetPassword: { type: 'boolean' },
        password: { type: 'string', maxLength: 128 },
        // The administrator's own password, required for a reset (USER-02, D-076).
        actorPassword: { type: 'string', maxLength: 128 },
        roleId: { type: 'integer' },
        isActive: { type: 'boolean' }
      }
    },
    handler: async (ctx, u) =>
      ctx.tx(async (db) => {
        const before = (
          await db.query(
            'SELECT u.*, r.key AS role_key, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1 FOR UPDATE OF u',
            [u.id]
          )
        ).rows[0]
        if (!before) throw notFound('المستخدم غير موجود.')
        const isSelf = before.id === ctx.user.id
        const roleChanged = before.role_id !== u.roleId
        const active = u.isActive === undefined ? before.is_active : u.isActive
        if (isSelf && roleChanged) throw forbidden('لا يمكنك تغيير دورك بنفسك.')
        if (isSelf && !active) throw forbidden('لا يمكنك تعطيل حسابك بنفسك.')
        // Editing a user whose current role exceeds your own authority is also escalation.
        if (before.role_id) assertWithinActor(ctx, await permissionsForRole(db, before.role_id))
        const role = roleChanged
          ? await assertAssignable(db, ctx, u.roleId)
          : await roleWithPerms(db, u.roleId)
        const losesSuperAdmin =
          before.role_key === 'super_admin' &&
          before.is_active &&
          (role.key !== 'super_admin' || !active)
        if (losesSuperAdmin && (await activeSuperAdmins(db, before.id)) === 0) {
          throw conflict('يجب أن يبقى حساب نشط واحد على الأقل بدور مدير النظام.')
        }
        const username = u.username.trim()
        if (
          (
            await db.query('SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2', [
              username,
              u.id
            ])
          ).rowCount
        ) {
          throw conflict('اسم المستخدم هذا مسجل مسبقاً! يرجى اختيار اسم آخر.')
        }
        let temporary = null
        if (u.resetPassword) {
          if (isSelf) throw forbidden('لتغيير كلمة مرورك استخدم "تغيير كلمة المرور".')
          // Re-authentication: whoever resets another user's password types their own first.
          const me = (
            await db.query('SELECT password_scrypt FROM users WHERE id = $1', [ctx.user.id])
          ).rows[0]
          if (!me?.password_scrypt || !verifyPassword(u.actorPassword || '', me.password_scrypt)) {
            await ctx.audit(
              ctx.pool,
              'password_reset_refused',
              `رفض إعادة تعيين كلمة مرور "${before.username}": كلمة مرور المدير غير صحيحة`
            )
            throw forbidden('كلمة مرورك غير صحيحة؛ لم تتم إعادة التعيين.')
          }
          temporary = temporaryPassword(u.password, username)
          // The old password and any PIN stop working; the user's sessions end.
          await db.query(
            `UPDATE users SET password_scrypt = $1, must_change_password = true, pin_lookup = NULL, pin_hash = NULL,
                    password_hash = NULL, temp_password_expires_at = LOCALTIMESTAMP(0) + interval '72 hours' WHERE id = $2`,
            [hashPassword(temporary), u.id]
          )
          await db.query(
            'UPDATE sessions SET revoked_at = LOCALTIMESTAMP(0) WHERE user_id = $1 AND revoked_at IS NULL',
            [u.id]
          )
        }
        const legacyRole =
          role.key === 'super_admin'
            ? 'admin'
            : role.key === 'manager'
              ? 'manager'
              : role.key === 'cashier'
                ? 'cashier'
                : role.key || 'custom'
        await db.query(
          'UPDATE users SET username = $1, role_id = $2, role = $3, is_active = $4, updated_at = LOCALTIMESTAMP(0) WHERE id = $5',
          [username, role.id, legacyRole, active, u.id]
        )
        if (!active)
          await db.query(
            'UPDATE sessions SET revoked_at = LOCALTIMESTAMP(0) WHERE user_id = $1 AND revoked_at IS NULL',
            [u.id]
          )
        await ctx.audit(
          db,
          'user_update',
          `تحديث بيانات المستخدم "${username}" (الدور: ${role.name}${active ? '' : '، معطل'})`,
          {
            role: roleChanged ? { from: before.role_name, to: role.name } : undefined,
            active:
              before.is_active !== active ? { from: before.is_active, to: active } : undefined,
            passwordReset: !!temporary
          }
        )
        return temporary ? { temporaryPassword: temporary } : { ok: true }
      })
  })

  app.operation({
    name: 'users.delete',
    permission: 'users.manage',
    schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    handler: async (ctx, { id }) =>
      ctx.tx(async (db) => {
        if (id === ctx.user.id)
          throw forbidden('لا يمكن حذف حساب المدير النشط الذي تستخدمه حالياً!')
        const u = (
          await db.query(
            'SELECT u.*, r.key AS role_key FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1 FOR UPDATE OF u',
            [id]
          )
        ).rows[0]
        if (!u) throw notFound('المستخدم غير موجود.')
        if (u.role_id) assertWithinActor(ctx, await permissionsForRole(db, u.role_id))
        if (
          u.role_key === 'super_admin' &&
          u.is_active &&
          (await activeSuperAdmins(db, id)) === 0
        ) {
          throw conflict('يجب أن يبقى حساب نشط واحد على الأقل بدور مدير النظام.')
        }
        try {
          await db.query('DELETE FROM sessions WHERE user_id = $1', [id])
          await db.query('DELETE FROM users WHERE id = $1', [id])
        } catch (e) {
          if (e.code === '23503') {
            throw conflict(
              'لا يمكن حذف هذا المستخدم لأنه قام بفتح ورديات أو تسجيل حركات سابقة بالنظام. يمكنك تعطيل الحساب بدلاً من حذفه.'
            )
          }
          throw e
        }
        await ctx.audit(db, 'user_delete', `حذف المستخدم "${u.username}" (رتبة: ${u.role})`)
      })
  })

  // ── Roles & permissions ────────────────────────────────────
  app.operation({
    name: 'roles.catalog',
    anyPermission: ['roles.manage', 'users.manage'],
    // Hidden permissions (unused Momkn and wallet tills, D-078) are not offered in the roles screen.
    handler: async () => PERMISSIONS.filter((p) => !p.hidden)
  })

  app.operation({
    name: 'roles.list',
    anyPermission: ['roles.manage', 'users.manage'],
    handler: async (ctx) => {
      const roles = (
        await ctx.pool.query(
          `SELECT r.*, (SELECT count(*) FROM users u WHERE u.role_id = r.id) AS user_count,
                  (SELECT count(*) FROM users u WHERE u.role_id = r.id AND u.is_active) AS active_user_count
           FROM roles r ORDER BY r.is_system DESC, r.id`
        )
      ).rows
      for (const r of roles) r.permissions = await permissionsForRole(ctx.pool, r.id)
      return roles
    }
  })

  const roleBody = {
    type: 'object',
    required: ['name', 'permissions'],
    properties: {
      id: { type: 'integer' },
      name: { type: 'string', minLength: 2, maxLength: 60 },
      description: { type: ['string', 'null'], maxLength: 300 },
      permissions: { type: 'array', items: { type: 'string' }, maxItems: 200, uniqueItems: true }
    }
  }

  function checkCatalog(permissions) {
    const unknown = permissions.filter((p) => !KEYS.has(p))
    if (unknown.length) throw badRequest(`صلاحيات غير معروفة: ${unknown.join(', ')}`)
  }

  app.operation({
    name: 'roles.create',
    permission: 'roles.manage',
    schema: roleBody,
    handler: async (ctx, r) =>
      ctx.tx(async (db) => {
        checkCatalog(r.permissions)
        assertWithinActor(ctx, r.permissions)
        const role = (
          await db.query(
            'INSERT INTO roles (name, description, is_system, is_protected) VALUES ($1, $2, false, false) RETURNING *',
            [r.name.trim(), r.description || '']
          )
        ).rows[0]
        for (const p of r.permissions)
          await db.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [
            role.id,
            p
          ])
        await ctx.audit(
          db,
          'role_create',
          `إنشاء الدور "${role.name}" بـ ${r.permissions.length} صلاحية`,
          { permissions: r.permissions }
        )
        return { id: role.id }
      })
  })

  app.operation({
    name: 'roles.update',
    permission: 'roles.manage',
    schema: { ...roleBody, required: ['id', 'name', 'permissions'] },
    handler: async (ctx, r) =>
      ctx.tx(async (db) => {
        checkCatalog(r.permissions)
        const before = await roleWithPerms(db, r.id)
        if (before.is_protected) throw forbidden('صلاحيات دور مدير النظام ثابتة ولا يمكن تعديلها.')
        // You may only touch permissions you hold: both those you add and those you remove.
        const added = r.permissions.filter((p) => !before.permissions.includes(p))
        const removed = before.permissions.filter((p) => !r.permissions.includes(p))
        assertWithinActor(ctx, [...added, ...removed])
        if (before.id === ctx.user.roleId && removed.includes('roles.manage')) {
          throw forbidden('لا يمكنك إزالة صلاحية إدارة الأدوار من دورك الحالي.')
        }
        await db.query(
          'UPDATE roles SET name = $1, description = $2, updated_at = LOCALTIMESTAMP(0) WHERE id = $3',
          [r.name.trim(), r.description || '', r.id]
        )
        await db.query('DELETE FROM role_permissions WHERE role_id = $1', [r.id])
        for (const p of r.permissions)
          await db.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [
            r.id,
            p
          ])
        const affected = (
          await db.query('SELECT count(*)::int AS n FROM users WHERE role_id = $1', [r.id])
        ).rows[0].n
        await ctx.audit(
          db,
          'role_update',
          `تعديل الدور "${r.name}" (يؤثر على ${affected} مستخدم)`,
          { added, removed }
        )
        return { added, removed, affectedUsers: affected }
      })
  })

  app.operation({
    name: 'roles.delete',
    permission: 'roles.manage',
    schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    handler: async (ctx, { id }) =>
      ctx.tx(async (db) => {
        const role = await roleWithPerms(db, id)
        if (role.is_system) throw forbidden('لا يمكن حذف الأدوار الأساسية.')
        assertWithinActor(ctx, role.permissions)
        const users = (
          await db.query('SELECT count(*)::int AS n FROM users WHERE role_id = $1', [id])
        ).rows[0].n
        if (users > 0)
          throw conflict(
            `لا يمكن حذف دور مسند إلى ${users} مستخدم. انقل المستخدمين إلى دور آخر أولاً.`
          )
        await db.query('DELETE FROM roles WHERE id = $1', [id])
        await ctx.audit(db, 'role_delete', `حذف الدور "${role.name}"`, {
          permissions: role.permissions
        })
      })
  })

  // ── Event log ──────────────────────────────────────────────
  app.operation({
    name: 'logs.list',
    permission: 'logs.view',
    schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 1000 },
        offset: { type: 'integer', minimum: 0 }
      }
    },
    handler: async (ctx, { limit = 100, offset = 0 }) => ({
      rows: (
        await ctx.pool.query('SELECT * FROM system_logs ORDER BY id DESC LIMIT $1 OFFSET $2', [
          limit,
          offset
        ])
      ).rows,
      usernames: (
        await ctx.pool.query(
          'SELECT DISTINCT username FROM users UNION SELECT DISTINCT username FROM system_logs WHERE username IS NOT NULL ORDER BY 1'
        )
      ).rows
    })
  })

  // ── System reset (legacy "إعادة ضبط بيانات التشغيل") ─────────
  app.operation({
    name: 'system.reset',
    permission: 'system.reset',
    schema: { type: 'object', required: ['confirm'], properties: { confirm: { const: 'RESET' } } },
    handler: async (ctx) =>
      ctx.tx(async (db) => {
        const tables = [
          'sale_payment_corrections',
          'supplier_pending_invoices',
          'supplier_purchase_return_items',
          'supplier_purchase_returns',
          'supplier_purchase_items',
          'sale_item_cost_backfill',
          'product_cost_migration',
          'sale_items',
          'sales',
          'safe_ledger',
          'client_ledger',
          'clients',
          'supplier_ledger',
          'supplier_purchases',
          'suppliers',
          'checks_register',
          'expenses',
          'damaged_goods',
          'shift_audits',
          'momkn_transactions',
          'mobile_money_transactions',
          'shift_closings',
          'treasury_ledger',
          'shifts'
        ]
        // Clears closed shifts with their money movements on purpose (migration 0011).
        await db.query("SELECT set_config('hm.bulk_load', 'on', true)")
        for (const t of tables) await db.query(`DELETE FROM ${t}`)
        // Same as clearing sqlite_sequence: ids start again at 1.
        for (const t of tables.filter(
          (x) => !['shift_closings', 'sale_item_cost_backfill'].includes(x)
        ))
          await db.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), 1, false)`)
        // Stock history restarts too: negative stock becomes 0 (legacy behaviour) and the remaining
        // stock becomes a fresh opening balance.
        await db.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
        await db.query('DELETE FROM stock_movements')
        await db.query('UPDATE products SET stock_qty = 0 WHERE stock_qty < 0')
        await db.query("SELECT set_config('hm.ledger_rebuild', 'off', true)")
        await db.query('SELECT hm_post_opening_balances($1)', ['رصيد افتتاحي بعد إعادة التهيئة'])
        await ctx.audit(db, 'system_reset', 'إعادة تهيئة كاملة لبيانات النظام والبدء من الصفر')
      })
  })
}
