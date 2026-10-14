'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService } = require('./helpers')

let db, svc
before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('first run: setup is required, creates a super admin once, then is refused', async (t) => {
  if (!requireDb(t)) return
  assert.deepEqual((await svc.call('auth.status')).body, {
    needsSetup: true,
    setupCodeRequired: false
  })
  const res = await svc.call('auth.setup', { username: 'owner', pin: '4821' })
  assert.equal(res.status, 200)
  assert.ok(res.body.token)
  assert.equal(res.body.user.roleKey, 'super_admin')
  assert.ok(res.body.user.permissions.includes('roles.manage'))
  assert.deepEqual((await svc.call('auth.status')).body, {
    needsSetup: false,
    setupCodeRequired: false
  })
  const again = await svc.call('auth.setup', { username: 'intruder', pin: '7777' })
  assert.equal(again.status, 409)
})

test('login with the right PIN returns a session; wrong PIN is rejected', async (t) => {
  if (!requireDb(t)) return
  const ok = await svc.call('auth.login', { pin: '4821' }, null, { 'x-heromarket-terminal': 't1' })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.user.username, 'owner')
  assert.equal(ok.body.openShift, null)
  const me = await svc.call('auth.me', {}, ok.body.token)
  assert.equal(me.body.username, 'owner')
  const bad = await svc.call('auth.login', { pin: '0000' }, null, { 'x-heromarket-terminal': 't1' })
  assert.equal(bad.status, 401)
})

test('five wrong PINs lock the terminal out, even for the right PIN', async (t) => {
  if (!requireDb(t)) return
  const h = { 'x-heromarket-terminal': 'locked-terminal' }
  for (let i = 0; i < 5; i++) await svc.call('auth.login', { pin: '9999' }, null, h)
  const res = await svc.call('auth.login', { pin: '4821' }, null, h)
  assert.equal(res.status, 429)
  const other = await svc.call('auth.login', { pin: '4821' }, null, {
    'x-heromarket-terminal': 'other'
  })
  assert.equal(other.status, 200, 'other terminals are not affected')
})

test('rotating terminal names does not bypass the lockout: the source address is limited too', async (t) => {
  if (!requireDb(t)) return
  const from = (remoteAddress, terminal, pin) =>
    svc.app.inject({
      method: 'POST',
      url: '/api/auth.login',
      payload: { pin },
      remoteAddress,
      headers: { 'x-heromarket-terminal': terminal }
    })
  for (let i = 0; i < 20; i++) await from('10.0.0.9', `fake-${i}`, '9999')
  assert.equal((await from('10.0.0.9', 'fresh-name', '4821')).statusCode, 429)
  assert.equal(
    (await from('10.0.0.10', 'fresh-name', '4821')).statusCode,
    200,
    'other addresses unaffected'
  )
  svc.app.loginGuard.clear()
})

test('legacy SHA-256 and plain-text PINs log in once and are upgraded', async (t) => {
  if (!requireDb(t)) return
  const sha = crypto.createHash('sha256').update('5050').digest('hex')
  await svc.pool.query(
    "INSERT INTO users (username, password_hash, role) VALUES ('legacy_hash', $1, 'cashier'), ('legacy_plain', '6060', 'manager')",
    [sha]
  )
  await svc.prepare() // maps legacy role text to role_id
  const a = await svc.call('auth.login', { pin: '5050' })
  assert.equal(a.status, 200)
  assert.equal(a.body.user.roleKey, 'cashier')
  const b = await svc.call('auth.login', { pin: '6060' })
  assert.equal(b.body.user.roleKey, 'manager')
  const rows = (
    await svc.pool.query(
      "SELECT username, password_hash, pin_lookup IS NOT NULL AS upgraded, pin_hash LIKE 'scrypt$%' AS scrypt FROM users WHERE username LIKE 'legacy_%' ORDER BY username"
    )
  ).rows
  for (const r of rows) {
    assert.equal(r.password_hash, null, `${r.username}: weak hash removed`)
    assert.ok(r.upgraded && r.scrypt, `${r.username}: upgraded`)
  }
  const again = await svc.call('auth.login', { pin: '5050' })
  assert.equal(again.status, 200, 'upgraded PIN still works')
})

test('protected operations need a valid, unrevoked session', async (t) => {
  if (!requireDb(t)) return
  assert.equal((await svc.call('auth.me')).status, 401)
  assert.equal((await svc.call('auth.me', {}, 'forged-token')).status, 401)
  const s = await svc.call('auth.login', { pin: '4821' })
  assert.equal((await svc.call('auth.logout', {}, s.body.token)).status, 200)
  assert.equal((await svc.call('auth.me', {}, s.body.token)).status, 401, 'revoked on logout')
})

test('change PIN verifies the current PIN and keeps PINs unique', async (t) => {
  if (!requireDb(t)) return
  const s = await svc.call('auth.login', { pin: '5050' })
  const wrong = await svc.call(
    'auth.changePin',
    { currentPin: '1234', newPin: '7777' },
    s.body.token
  )
  assert.equal(wrong.status, 400)
  const taken = await svc.call(
    'auth.changePin',
    { currentPin: '5050', newPin: '6060' },
    s.body.token
  )
  assert.equal(taken.status, 409, 'PIN of another user refused')
  const ok = await svc.call('auth.changePin', { currentPin: '5050', newPin: '7777' }, s.body.token)
  assert.equal(ok.status, 200)
  assert.equal((await svc.call('auth.login', { pin: '7777' })).status, 200)
  assert.equal((await svc.call('auth.login', { pin: '5050' })).status, 401)
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
      pin: '1234',
      setupCode: '48213377'
    })
    assert.equal(weak.status, 400, 'guessable PIN refused for the first administrator')
    const noCode = await net.call('auth.setup', { username: 'intruder', pin: '4821' })
    assert.equal(noCode.status, 401)
    const wrong = await net.call('auth.setup', {
      username: 'intruder',
      pin: '4821',
      setupCode: '11111111'
    })
    assert.equal(wrong.status, 401)
    const ok = await net.call('auth.setup', {
      username: 'owner',
      pin: '4821',
      setupCode: '48213377'
    })
    assert.equal(ok.status, 200)
    assert.equal((await net.call('auth.status')).body.setupCodeRequired, false)
  } finally {
    await net.close()
    await db2.dispose()
  }
})
