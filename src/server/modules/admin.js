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
const { pinLookup, hashPin } = require('../auth/pin')
const { activeSuperAdmins, permissionsForRole } = require('../auth/access')
const { helpers: authHelpers } = require('./auth')

const pinSchema = { type: 'string', pattern: '^[0-9]{4,8}$' }

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
                  (u.pin_lookup IS NOT NULL) AS pin_upgraded
           FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.username ASC`
        )
      ).rows
  })

  app.operation({
    name: 'users.create',
    permission: 'users.manage',
    schema: {
      type: 'object',
      required: ['username', 'pin', 'roleId'],
      properties: {
        username: { type: 'string', minLength: 2, maxLength: 40 },
        pin: pinSchema,
        roleId: { type: 'integer' }
      }
    },
    handler: async (ctx, u) =>
      ctx.tx(async (db) => {
        const username = u.username.trim()
        if ((await db.query('SELECT 1 FROM users WHERE username = $1', [username])).rowCount) {
          throw conflict('اسم المستخدم هذا مسجل مسبقاً! يرجى اختيار اسم آخر.')
        }
        const role = await assertAssignable(db, ctx, u.roleId)
        await authHelpers.assertPinFree(db, ctx.secret, u.pin)
        const legacyRole =
          role.key === 'super_admin'
            ? 'admin'
            : role.key === 'manager'
              ? 'manager'
              : role.key === 'cashier'
                ? 'cashier'
                : role.key || 'custom'
        const r = await db.query(
          `INSERT INTO users (username, role, role_id, pin_lookup, pin_hash, is_active, created_at)
           VALUES ($1, $2, $3, $4, $5, true, LOCALTIMESTAMP(0)) RETURNING id`,
          [username, legacyRole, role.id, pinLookup(ctx.secret, u.pin), hashPin(u.pin)]
        )
        await ctx.audit(db, 'user_create', `إنشاء مستخدم جديد "${username}" بدور ${role.name}`)
        return { id: r.rows[0].id }
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
        pin: { type: ['string', 'null'], pattern: '^([0-9]{4,8})?$' },
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
          (await db.query('SELECT 1 FROM users WHERE username = $1 AND id <> $2', [username, u.id]))
            .rowCount
        ) {
          throw conflict('اسم المستخدم هذا مسجل مسبقاً! يرجى اختيار اسم آخر.')
        }
        if (u.pin) {
          await authHelpers.assertPinFree(db, ctx.secret, u.pin, u.id)
          await db.query(
            'UPDATE users SET pin_lookup = $1, pin_hash = $2, password_hash = NULL WHERE id = $3',
            [pinLookup(ctx.secret, u.pin), hashPin(u.pin), u.id]
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
            pinChanged: !!u.pin
          }
        )
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
    handler: async () => PERMISSIONS
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
          'shifts'
        ]
        for (const t of tables) await db.query(`DELETE FROM ${t}`)
        // Same as clearing sqlite_sequence: ids start again at 1.
        for (const t of tables)
          await db.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), 1, false)`)
        await db.query('UPDATE products SET stock_qty = 0 WHERE stock_qty < 0')
        await ctx.audit(db, 'system_reset', 'إعادة تهيئة كاملة لبيانات النظام والبدء من الصفر')
      })
  })
}
