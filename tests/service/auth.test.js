'use strict'
// Sign-in (stage 4 phase 3): username + password; old PINs work once to choose a password;
// temporary passwords, recovery code and the local reset command.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService, createUser } = require('./helpers')
const { resetPassword } = require('../../src/server/auth/reset')

const OWNER_PW = 'Hero-Store-4821'
let db, svc, recoveryCode
const login = (username, password, terminal = 't1') =>
  svc.call('auth.login', { username, password }, null, { 'x-heromarket-terminal': terminal })
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('first run: setup is required, creates a super admin once (with a recovery code), then is refused', async (t) => {
  if (!requireDb(t)) return
  assert.deepEqual((await svc.call('auth.status')).body, {
    needsSetup: true,
    setupCodeRequired: false
  })
  const weak = await svc.call('auth.setup', { username: 'owner', password: '12345678' })
  assert.equal(weak.status, 400, 'weak password refused')
  assert.equal((await q('SELECT count(*)::int AS n FROM users'))[0].n, 0)
  const res = await svc.call('auth.setup', { username: 'owner', password: OWNER_PW })
  assert.equal(res.status, 200)
  assert.ok(res.body.token)
  assert.equal(res.body.user.roleKey, 'super_admin')
  assert.ok(res.body.user.permissions.includes('roles.manage'))
  recoveryCode = res.body.recoveryCode
  assert.match(recoveryCode, /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/, 'recovery code shown once')
  const [u] = await q("SELECT password_scrypt, recovery_hash FROM users WHERE username = 'owner'")
  assert.ok(u.password_scrypt.startsWith('scrypt$') && u.recovery_hash.startsWith('scrypt$'))
  assert.ok(!u.recovery_hash.includes(recoveryCode), 'only a hash is stored')
  assert.deepEqual((await svc.call('auth.status')).body, {
    needsSetup: false,
    setupCodeRequired: false
  })
  const again = await svc.call('auth.setup', { username: 'intruder', password: 'Other-pass-777' })
  assert.equal(again.status, 409)
})

test('login with the right username and password returns a session; anything else is refused alike', async (t) => {
  if (!requireDb(t)) return
  const ok = await login('owner', OWNER_PW)
  assert.equal(ok.status, 200)
  assert.equal(ok.body.user.username, 'owner')
  assert.equal(ok.body.openShift, null)
  const me = await svc.call('auth.me', {}, ok.body.token)
  assert.equal(me.body.username, 'owner')
  assert.equal((await login('OWNER', OWNER_PW)).status, 200, 'username ignores case')
  const wrongPw = await login('owner', 'Hero-Store-0000')
  const noUser = await login('nobody', OWNER_PW)
  assert.equal(wrongPw.status, 401)
  assert.equal(noUser.status, 401)
  assert.equal(
    wrongPw.body.error.message,
    noUser.body.error.message,
    'an unknown user is not revealed'
  )
  // The old request shape (PIN only) is refused.
  assert.equal((await svc.call('auth.login', { pin: '4821' })).status, 400)
})

test('five wrong passwords lock the terminal out, even for the right password', async (t) => {
  if (!requireDb(t)) return
  for (let i = 0; i < 5; i++) await login('owner', `wrong-${i}aaaa`, 'locked-terminal')
  assert.equal((await login('owner', OWNER_PW, 'locked-terminal')).status, 429)
  assert.equal((await login('owner', OWNER_PW, 'other')).status, 200, 'other terminals unaffected')
})

test('rotating terminal names does not bypass the lockout: the source address is limited too', async (t) => {
  if (!requireDb(t)) return
  const from = (remoteAddress, terminal, password) =>
    svc.app.inject({
      method: 'POST',
      url: '/api/auth.login',
      payload: { username: 'owner', password },
      remoteAddress,
      headers: { 'x-heromarket-terminal': terminal }
    })
  for (let i = 0; i < 20; i++) await from('10.0.0.9', `fake-${i}`, 'not-the-pass-1')
  assert.equal((await from('10.0.0.9', 'fresh-name', OWNER_PW)).statusCode, 429)
  assert.equal(
    (await from('10.0.0.10', 'fresh-name', OWNER_PW)).statusCode,
    200,
    'other addresses unaffected'
  )
  svc.app.loginGuard.clear()
})

test('existing users: the old PIN (SHA-256, plain or keyed) works once, only to choose a password', async (t) => {
  if (!requireDb(t)) return
  const sha = crypto.createHash('sha256').update('5050').digest('hex')
  await svc.pool.query(
    "INSERT INTO users (username, password_hash, role) VALUES ('legacy_hash', $1, 'cashier'), ('legacy_plain', '6060', 'manager')",
    [sha]
  )
  await createUser(svc, { username: 'keyed_pin', pin: '7070', roleKey: 'cashier', legacyPin: true })
  await svc.prepare() // maps legacy role text to role_id
  for (const [username, pin, password, roleKey] of [
    ['legacy_hash', '5050', 'Cashier-pass-1', 'cashier'],
    ['legacy_plain', '٦٠٦٠', 'Manager-pass-1', 'manager'], // Arabic digits accepted for the PIN
    ['keyed_pin', '7070', 'Cashier-pass-2', 'cashier']
  ]) {
    const first = await login(username, pin)
    assert.equal(first.status, 200, username)
    assert.deepEqual(
      [first.body.passwordChangeRequired, first.body.firstPassword, first.body.token],
      [true, true, undefined],
      `${username}: no session until a password is chosen`
    )
    // The PIN alone cannot be kept as the password.
    const same = await svc.call('auth.setPassword', {
      username,
      currentPassword: pin,
      newPassword: pin
    })
    assert.equal(same.status, 400)
    const set = await svc.call('auth.setPassword', {
      username,
      currentPassword: pin,
      newPassword: password
    })
    assert.equal(set.status, 200, JSON.stringify(set.body))
    assert.equal(set.body.user.roleKey, roleKey)
    assert.ok(set.body.token)
    assert.equal(set.body.recoveryCode, null, 'only super administrators get a recovery code')
    assert.equal((await login(username, pin)).status, 401, `${username}: PIN no longer works`)
    assert.equal((await login(username, password)).status, 200)
  }
  const rows = await q(
    "SELECT username, password_hash, pin_lookup, pin_hash, password_scrypt LIKE 'scrypt$%' AS scrypt FROM users WHERE username IN ('legacy_hash', 'legacy_plain', 'keyed_pin')"
  )
  for (const r of rows) {
    assert.deepEqual([r.password_hash, r.pin_lookup, r.pin_hash], [null, null, null], r.username)
    assert.ok(r.scrypt, `${r.username}: password stored as scrypt`)
  }
  const audit = await q(
    "SELECT count(*)::int AS n FROM system_logs WHERE action_type = 'user_update' AND description LIKE '%إلغاء رمز PIN%'"
  )
  assert.equal(audit[0].n, 3, 'each move to a password is logged')
})

test('protected operations need a valid, unrevoked session', async (t) => {
  if (!requireDb(t)) return
  assert.equal((await svc.call('auth.me')).status, 401)
  assert.equal((await svc.call('auth.me', {}, 'forged-token')).status, 401)
  const s = await login('owner', OWNER_PW)
  assert.equal((await svc.call('auth.logout', {}, s.body.token)).status, 200)
  assert.equal((await svc.call('auth.me', {}, s.body.token)).status, 401, 'revoked on logout')
})

test('change password: verifies the current one, applies the rules, signs out other terminals', async (t) => {
  if (!requireDb(t)) return
  const a = (await login('legacy_hash', 'Cashier-pass-1', 'till-a')).body.token
  const b = (await login('legacy_hash', 'Cashier-pass-1', 'till-b')).body.token
  const change = (currentPassword, newPassword) =>
    svc.call('auth.changePassword', { currentPassword, newPassword }, a)
  assert.equal((await change('Wrong-pass-1', 'Cashier-pass-9')).status, 400)
  assert.equal((await change('Cashier-pass-1', 'short1')).status, 400, 'too short')
  // USER-01 (D-058): letters-only passwords are now allowed; guessable ones are still refused.
  assert.equal((await change('Cashier-pass-1', 'abcdefgh')).status, 400, 'a plain run')
  assert.equal((await change('Cashier-pass-1', 'aaaaaaab')).status, 400, 'too few characters')
  assert.equal((await change('Cashier-pass-1', 'legacy_hash-1')).status, 400, 'contains username')
  assert.equal((await change('Cashier-pass-1', 'Cashier-pass-9')).status, 200)
  assert.equal((await svc.call('auth.me', {}, a)).status, 200, 'this terminal stays signed in')
  assert.equal((await svc.call('auth.me', {}, b)).status, 401, 'other terminals signed out')
  assert.equal((await login('legacy_hash', 'Cashier-pass-1')).status, 401)
  assert.equal((await login('legacy_hash', 'Cashier-pass-9')).status, 200)
})

test('administrator reset: a temporary password that must be changed; the old one stops working', async (t) => {
  if (!requireDb(t)) return
  const owner = (await login('owner', OWNER_PW)).body.token
  const user = (await q("SELECT id, role_id FROM users WHERE username = 'legacy_plain'"))[0]
  const session = (await login('legacy_plain', 'Manager-pass-1')).body.token
  const r = await svc.call(
    'users.update',
    { id: user.id, username: 'legacy_plain', roleId: user.role_id, resetPassword: true },
    owner
  )
  assert.equal(r.status, 200)
  const temporary = r.body.temporaryPassword
  assert.ok(temporary && temporary.length >= 8)
  assert.equal((await svc.call('auth.me', {}, session)).status, 401, 'sessions ended')
  assert.equal((await login('legacy_plain', 'Manager-pass-1')).status, 401, 'old password')
  const t1 = await login('legacy_plain', temporary)
  assert.deepEqual(
    [t1.body.passwordChangeRequired, t1.body.firstPassword, t1.body.token],
    [true, false, undefined]
  )
  const set = await svc.call('auth.setPassword', {
    username: 'legacy_plain',
    currentPassword: temporary,
    newPassword: 'Manager-pass-2'
  })
  assert.equal(set.status, 200)
  assert.equal((await login('legacy_plain', temporary)).status, 401, 'temporary used up')
  // A new user created by an administrator starts the same way.
  const created = await svc.call(
    'users.create',
    { username: 'newcomer', roleId: user.role_id },
    owner
  )
  assert.equal(created.status, 200)
  assert.equal(
    (await login('newcomer', created.body.temporaryPassword)).body.passwordChangeRequired,
    true
  )
  // An administrator cannot pick a weak temporary password either.
  const weak = await svc.call(
    'users.create',
    { username: 'weakling', roleId: user.role_id, password: '1234' },
    owner
  )
  assert.equal(weak.status, 400)
  const list = (await svc.call('users.list', {}, owner)).body
  const state = Object.fromEntries(list.map((u) => [u.username, u.login_state]))
  assert.deepEqual([state.owner, state.newcomer], ['password', 'temporary'])
  assert.ok(list.every((u) => !('password_scrypt' in u) && !('recovery_hash' in u)))
})

test('recovery code: resets the super administrator once, then a new code replaces it', async (t) => {
  if (!requireDb(t)) return
  const recover = (username, code, newPassword, terminal = 'rec') =>
    svc.call('auth.recover', { username, recoveryCode: code, newPassword }, null, {
      'x-heromarket-terminal': terminal
    })
  // Only super administrators have one; a wrong code is refused.
  assert.equal((await recover('legacy_hash', recoveryCode, 'Some-pass-123')).status, 401)
  assert.equal((await recover('owner', 'AAAAA-BBBBB-CCCCC-DDDDD', 'Some-pass-123')).status, 401)
  // Typed in lower case with spaces: still accepted.
  const typed = recoveryCode.toLowerCase().replace(/-/g, ' ')
  const r = await recover('owner', typed, 'Shop-new-pass-1')
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.ok(r.body.token)
  assert.match(r.body.recoveryCode, /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/)
  assert.notEqual(r.body.recoveryCode, recoveryCode)
  assert.equal((await recover('owner', recoveryCode, 'Shop-new-pass-2')).status, 401, 'used once')
  assert.equal((await login('owner', OWNER_PW)).status, 401)
  assert.equal((await login('owner', 'Shop-new-pass-1')).status, 200)
  const logged = await q(
    "SELECT count(*)::int AS n FROM system_logs WHERE action_type = 'password_recovery'"
  )
  assert.equal(logged[0].n, 1)
  // Guessing codes is limited like passwords.
  for (let i = 0; i < 5; i++) await recover('owner', `WRONG-${i}`, 'X-pass-12345', 'guess')
  assert.equal(
    (await recover('owner', r.body.recoveryCode, 'Shop-new-pass-3', 'guess')).status,
    429
  )
  svc.app.loginGuard.clear()
  // A signed-in super administrator can replace a lost paper copy.
  const owner = (await login('owner', 'Shop-new-pass-1')).body.token
  const fresh = await svc.call(
    'auth.newRecoveryCode',
    { currentPassword: 'Shop-new-pass-1' },
    owner
  )
  assert.equal(fresh.status, 200)
  assert.equal(
    (await recover('owner', r.body.recoveryCode, 'Shop-new-pass-4')).status,
    401,
    'the replaced code no longer works'
  )
})

test('local reset command: temporary password, sessions ended, logged; a disabled account stays disabled', async (t) => {
  if (!requireDb(t)) return
  const session = (await login('owner', 'Shop-new-pass-1')).body.token
  const r = await resetPassword(svc.pool, 'Owner')
  assert.equal(r.username, 'owner')
  assert.equal((await svc.call('auth.me', {}, session)).status, 401)
  assert.equal((await login('owner', 'Shop-new-pass-1')).status, 401)
  assert.equal((await login('owner', r.temporaryPassword)).body.passwordChangeRequired, true)
  const set = await svc.call('auth.setPassword', {
    username: 'owner',
    currentPassword: r.temporaryPassword,
    newPassword: 'Shop-after-reset-1'
  })
  assert.equal(set.status, 200)
  assert.equal(set.body.recoveryCode, null, 'the existing recovery code is kept')
  const logged = await q("SELECT description FROM system_logs WHERE action_type = 'password_reset'")
  assert.equal(logged.length, 1)
  assert.match(logged[0].description, /owner/)
  await svc.pool.query("UPDATE users SET is_active = false WHERE username = 'newcomer'")
  const off = await resetPassword(svc.pool, 'newcomer')
  assert.equal((await login('newcomer', off.temporaryPassword)).status, 401, 'still disabled')
  await assert.rejects(resetPassword(svc.pool, 'ghost'), (e) => e.code === 'unknown_user')
})

test('networked server: first-run setup needs the one-time code from the server log', async (t) => {
  if (!requireDb(t)) return
  const db2 = await freshDatabase()
  const net = await startService(db2.url, { setupCode: '48213377' })
  try {
    assert.deepEqual((await net.call('auth.status')).body, {
      needsSetup: true,
      setupCodeRequired: true
    })
    const weak = await net.call('auth.setup', {
      username: 'owner',
      password: 'password',
      setupCode: '48213377'
    })
    assert.equal(weak.status, 400, 'guessable password refused for the first administrator')
    const noCode = await net.call('auth.setup', { username: 'intruder', password: OWNER_PW })
    assert.equal(noCode.status, 401)
    const wrong = await net.call('auth.setup', {
      username: 'intruder',
      password: OWNER_PW,
      setupCode: '11111111'
    })
    assert.equal(wrong.status, 401)
    const ok = await net.call('auth.setup', {
      username: 'owner',
      password: OWNER_PW,
      setupCode: '48213377'
    })
    assert.equal(ok.status, 200)
    assert.equal((await net.call('auth.status')).body.setupCodeRequired, false)
  } finally {
    await net.close()
    await db2.dispose()
  }
})
