'use strict'
// Who must open a shift before using the system (1.4.0, owner decision).
//
// The setting `shift_required_roles` lists the ids of the roles that must (roles made in the
// roles screen have no key, only an id). `null` (the default) means
// every role that can operate a shift, which is the behaviour before 1.4.0. The owner (super
// administrator) is never required: he can sign in and do anything without a shift, and is asked
// to open one only when he sells or moves cash from the drawer (the service refuses those without
// one).

const { badRequest } = require('../errors')

const KEY = 'shift_required_roles'
const OWNER = 'super_admin'

/** Normalise the stored value: `null`, or a sorted list of role ids. */
function normaliseRequiredRoles(raw) {
  let v = raw
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      throw badRequest('قائمة الأدوار غير صالحة.')
    }
  }
  if (v === null || v === undefined) return 'null'
  if (!Array.isArray(v) || v.length > 500 || v.some((id) => !Number.isInteger(id) || id < 1))
    throw badRequest('قائمة الأدوار غير صالحة.')
  return JSON.stringify([...new Set(v)].sort((a, b) => a - b))
}

/** The list stored in the settings, or null for "every role that can operate a shift". */
async function requiredRoles(db) {
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [KEY])
  if (!rows.length) return null
  try {
    const v = JSON.parse(rows[0].value)
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

/** Must this user open a shift before using the system? (`user` as returned by describeUser.) */
async function shiftRequiredFor(db, user) {
  if (!user || user.roleKey === OWNER) return false
  if (!Array.isArray(user.permissions) || !user.permissions.includes('shifts.operate')) return false
  const list = await requiredRoles(db)
  return list === null || list.includes(user.roleId)
}

// Who is signed out by closing a shift (owner, 1.5.1, D-083): every user except the administrators.
// The administrators («مدير النظام», «مدير المتجر») keep their session after closing a shift. Only a
// close that succeeded signs out; nothing else does (a return, a refused or cancelled close).
const ADMINS = ['super_admin', 'store_admin']

/** Does closing a shift end this user's session? (`user` as returned by describeUser.) */
function signOutAfterClose(user) {
  return !(user && ADMINS.includes(user.roleKey))
}

module.exports = {
  KEY,
  OWNER,
  ADMINS,
  normaliseRequiredRoles,
  requiredRoles,
  shiftRequiredFor,
  signOutAfterClose
}
