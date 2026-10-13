'use strict'
// Roles, permissions and their invariants. All checks run in the service, never in the renderer.
const { SYSTEM_ROLES, LEGACY_ROLE_MAP, KEYS, ROLE_TO_LEGACY } = require('./permissions')

/**
 * Idempotent start-up step:
 *  - create missing built-in roles with their default permissions (existing customisations are kept);
 *  - keep the protected super-administrator role in sync with the full catalogue;
 *  - give users without a role_id the built-in role matching their legacy users.role text.
 */
async function ensureAccessControl(client) {
  for (const r of SYSTEM_ROLES) {
    const existing = await client.query('SELECT id FROM roles WHERE key = $1', [r.key])
    let id = existing.rows[0]?.id
    if (!id) {
      id = (
        await client.query(
          `INSERT INTO roles (key, name, description, is_system, is_protected) VALUES ($1, $2, $3, true, $4)
           ON CONFLICT (name) DO UPDATE SET key = EXCLUDED.key, is_system = true RETURNING id`,
          [r.key, r.name, r.description, !!r.protected]
        )
      ).rows[0].id
      for (const p of r.permissions) {
        await client.query(
          'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, p]
        )
      }
    }
    if (r.protected) {
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [id])
      for (const p of r.permissions) {
        await client.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [
          id,
          p
        ])
      }
    }
  }
  const unmapped = await client.query('SELECT id, role FROM users WHERE role_id IS NULL')
  for (const u of unmapped.rows) {
    const key = LEGACY_ROLE_MAP[u.role] || 'cashier' // unknown legacy text → least privilege
    await client.query(
      'UPDATE users SET role_id = (SELECT id FROM roles WHERE key = $1) WHERE id = $2',
      [key, u.id]
    )
  }
}

async function permissionsForRole(db, roleId) {
  const { rows } = await db.query(
    'SELECT permission FROM role_permissions WHERE role_id = $1 ORDER BY permission',
    [roleId]
  )
  return rows.map((r) => r.permission).filter((p) => KEYS.has(p))
}

/** Public shape of the logged-in user (no secrets). `role` keeps the legacy text for existing UI labels. */
async function describeUser(db, userId) {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.role AS legacy_role, u.is_active, r.id AS role_id, r.key AS role_key, r.name AS role_name
     FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [userId]
  )
  const u = rows[0]
  if (!u) return null
  const permissions = u.role_id ? await permissionsForRole(db, u.role_id) : []
  return {
    id: u.id,
    username: u.username,
    role: ROLE_TO_LEGACY[u.role_key] || u.role_key || u.legacy_role,
    roleId: u.role_id,
    roleKey: u.role_key,
    roleName: u.role_name,
    isActive: u.is_active,
    permissions
  }
}

/** Number of active users holding the protected super-administrator role (lock-out protection). */
async function activeSuperAdmins(db, excludeUserId = null) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.key = 'super_admin' AND u.is_active AND ($1::int IS NULL OR u.id <> $1)`,
    [excludeUserId]
  )
  return rows[0].n
}

module.exports = { ensureAccessControl, permissionsForRole, describeUser, activeSuperAdmins }
