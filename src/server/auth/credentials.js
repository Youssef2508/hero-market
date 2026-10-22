'use strict'
// Username + password check shared by sign-in, password setup and supervisor approval.
//
// A user without a password yet (every user after the upgrade) may use their current PIN as the
// password exactly once: the result is "change_required" and no session is issued until they choose
// a password, which erases the PIN. Temporary passwords (administrator reset, local reset command)
// work the same way.
const { verifyPin, legacyCandidates } = require('./pin')
const { verifyPassword, burnTime } = require('./password')

const ARABIC = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹'
const pinDigits = (s) =>
  String(s ?? '')
    .trim()
    .replace(/[٠-٩]/g, (d) => String(ARABIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)))

/** The account a typed username refers to: exact spelling first, otherwise ignoring case. */
async function findAccount(db, username) {
  const name = String(username ?? '').trim()
  if (!name) return null
  const { rows } = await db.query(
    `SELECT id, username, is_active, password_scrypt, must_change_password, pin_hash, password_hash, recovery_hash,
            (temp_password_expires_at IS NOT NULL AND temp_password_expires_at < LOCALTIMESTAMP) AS temp_expired
       FROM users WHERE lower(username) = lower($1)
      ORDER BY (username = $1) DESC, id LIMIT 1`,
    [name]
  )
  return rows[0] || null
}

/**
 * Returns { account, state } where state is
 *   'ok'              – password correct;
 *   'change_required' – correct PIN (not yet migrated) or temporary password: must choose a password;
 *   'expired'         – a correct temporary password whose 72 hours have passed (USER-02, D-076);
 *   'invalid'         – unknown or disabled user, or wrong password/PIN (indistinguishable to callers).
 */
async function checkCredentials(db, username, password) {
  const account = await findAccount(db, username)
  if (!account || !account.is_active) {
    burnTime(password)
    return { account: null, state: 'invalid' }
  }
  if (account.password_scrypt) {
    if (!verifyPassword(password, account.password_scrypt)) return { account, state: 'invalid' }
    if (account.must_change_password && account.temp_expired) return { account, state: 'expired' }
    return { account, state: account.must_change_password ? 'change_required' : 'ok' }
  }
  // Not migrated yet: the current PIN (scrypt, or a legacy SHA-256 / plain value) stands in once.
  const pin = pinDigits(password)
  let ok = false
  if (/^\d{4,8}$/.test(pin)) {
    if (account.pin_hash) ok = verifyPin(pin, account.pin_hash)
    else if (account.password_hash) ok = legacyCandidates(pin).includes(account.password_hash)
  }
  if (!ok) burnTime(password)
  return ok ? { account, state: 'change_required' } : { account, state: 'invalid' }
}

module.exports = { findAccount, checkCredentials }
