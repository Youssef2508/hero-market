'use strict'
// Local password reset (stage 4 phase 3): for someone with access to the store PC when no
// administrator can sign in (forgotten password and lost recovery code).
//   cashier PC:  "HeroMarket-POS.exe" --reset-password=<username>   (src/main/index.js)
//   server:      node src/server/cli.js reset-password <username>
// The user receives a temporary password that must be changed at the next sign-in; their sessions
// end, any old PIN stops working, and the reset is written to the event log. A disabled account
// stays disabled (only an administrator can enable it again).
const { findAccount } = require('./credentials')
const { hashPassword, newTemporaryPassword } = require('./password')

async function resetPassword(pool, username, { via = 'local command' } = {}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const account = await findAccount(client, username)
    if (!account) {
      const err = new Error(`no user named "${String(username).trim()}"`)
      err.code = 'unknown_user'
      throw err
    }
    const temporary = newTemporaryPassword()
    await client.query(
      `UPDATE users SET password_scrypt = $1, must_change_password = true, pin_lookup = NULL, pin_hash = NULL,
              password_hash = NULL, updated_at = LOCALTIMESTAMP(0) WHERE id = $2`,
      [hashPassword(temporary), account.id]
    )
    await client.query(
      'UPDATE sessions SET revoked_at = LOCALTIMESTAMP(0) WHERE user_id = $1 AND revoked_at IS NULL',
      [account.id]
    )
    await client.query(
      `INSERT INTO system_logs (timestamp, user_id, username, action_type, description)
       VALUES (LOCALTIMESTAMP(0), NULL, NULL, 'password_reset', $1)`,
      [`إعادة تعيين كلمة مرور المستخدم "${account.username}" من جهاز المتجر (${via})`]
    )
    await client.query('COMMIT')
    return { username: account.username, temporaryPassword: temporary }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

module.exports = { resetPassword }
