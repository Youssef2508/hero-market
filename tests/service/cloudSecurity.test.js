'use strict'
// Signing in from the internet (Phase 2 milestone 5, D-105): behind the reverse proxy each visitor
// is counted by their own address; one typed username is paused after repeated failures from any
// number of addresses, on the internet only; passwords hashed with older parameters are renewed at
// the next sign-in in the shop.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { requireDb } = require('./helpers')
const { makeTwin } = require('./cloudHelpers')
const { InProcessTransport } = require('../../src/server/sync/transport')
const { hashPin } = require('../../src/server/auth/pin')
const { PARAMS } = require('../../src/server/auth/password')

const PASSWORD = 'Test-8642-pw' // the owner's, as the test helpers make it

test('the internet way in: limits per visitor address and per typed username, never in the shop', async (t) => {
  if (!requireDb(t)) return
  // The proxy is this machine (inject comes from 127.0.0.1): only it may name the visitor.
  const twin = await makeTwin({ link: false, cloudOptions: { trustProxy: '127.0.0.1' } })
  try {
    await twin.sync()
    const from = (address, username, password, terminal = 'Internet - Browser') =>
      twin.cloud.call('auth.login', { username, password }, null, {
        'x-forwarded-for': address,
        'x-heromarket-terminal': terminal
      })

    // One visitor guessing under ever-new terminal names: locked by its own address after 20;
    // another visitor is not affected.
    for (let i = 0; i < 20; i++)
      assert.equal((await from('203.0.113.5', `nobody${i}`, 'wrong-guess', `t${i}`)).status, 401)
    assert.equal((await from('203.0.113.5', 'cashier', 'Test-5173-pw')).status, 429)
    assert.equal((await from('198.51.100.7', 'cashier', 'Test-5173-pw')).status, 200)

    // Ten wrong passwords for one name from ten addresses: that name pauses on the internet, even
    // with the right password; other names and other addresses are not affected.
    for (let i = 0; i < 10; i++)
      assert.equal((await from(`192.0.2.${10 + i}`, 'owner', 'not-the-password')).status, 401)
    const paused = await from('192.0.2.99', 'OWNER ', PASSWORD)
    assert.equal(paused.status, 429)
    assert.match(paused.body.error.message, /حاول مرة أخرى بعد/)
    assert.equal((await from('192.0.2.99', 'cashier', 'Test-5173-pw')).status, 200)
    // An unknown name is counted the same way: the answer never tells whether an account exists.
    for (let i = 0; i < 10; i++) await from(`192.0.2.${40 + i}`, 'ghost', 'x-wrong-x')
    assert.equal((await from('192.0.2.98', 'ghost', 'x-wrong-x')).status, 429)

    // The shop's tills are not affected by the internet's pause.
    const atShop = await twin.shop.call('auth.login', { username: 'owner', password: PASSWORD })
    assert.equal(atShop.status, 200)
  } finally {
    await twin.close()
  }
})

test('a password hashed with the older parameters still signs in and is renewed in the shop only', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ link: false })
  try {
    const old = hashPin(PASSWORD) // scrypt N=2^14, r=8, p=1: the format before D-105
    await twin.shop.pool.query("UPDATE users SET password_scrypt = $1 WHERE username = 'owner'", [
      old
    ])
    await twin.sync()
    const stored = async (svc) =>
      (await svc.pool.query("SELECT password_scrypt FROM users WHERE username = 'owner'")).rows[0]
        .password_scrypt

    // On the cloud: signs in; the cloud does not change the user's record itself.
    const web = await twin.cloud.call('auth.login', { username: 'owner', password: PASSWORD })
    assert.equal(web.status, 200)
    assert.equal(await stored(twin.cloud), old)

    // In the shop: signs in, and the hash is replaced with today's parameters.
    assert.equal(
      (await twin.shop.call('auth.login', { username: 'owner', password: PASSWORD })).status,
      200
    )
    const renewed = await stored(twin.shop)
    assert.notEqual(renewed, old)
    assert.deepEqual(renewed.split('$').slice(1, 4).map(Number), [PARAMS.N, PARAMS.r, PARAMS.p])
    assert.equal(
      (await twin.shop.call('auth.login', { username: 'owner', password: PASSWORD })).status,
      200
    )
    assert.equal(
      (await twin.shop.call('auth.login', { username: 'owner', password: 'Test-8642-px' })).status,
      401
    )
    // The renewed hash reaches the cloud with the user's record, and works there.
    await twin.sync()
    assert.equal(await stored(twin.cloud), renewed)
    assert.equal(
      (await twin.cloud.call('auth.login', { username: 'owner', password: PASSWORD })).status,
      200
    )
  } finally {
    await twin.close()
  }
})

test('a shop on another database version is refused by the cloud until both are updated', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ link: false })
  try {
    await twin.sync()
    const st = (await twin.shop.pool.query('SELECT store_id FROM sync_state')).rows[0]
    const token = twin.transport.inner?.token ?? twin.transport.token
    const version = (await twin.shop.pool.query('SELECT max(version) AS v FROM schema_migrations'))
      .rows[0].v
    const via = (schema) =>
      new InProcessTransport({ app: twin.cloud.app, storeId: st.store_id, token, schema })

    // The same version: the link works.
    await via(version).results({ results: [], unknown: [] })
    // Another version: refused, with a message that says what to do; nothing is taken in.
    const before = await twin.cloud.pool.query('SELECT count(*)::int AS n FROM cloud_rows')
    await assert.rejects(
      () => via('9999_newer').push({ epoch: 1, rows: [] }),
      (e) => e.status === 409 && e.code === 'schema_mismatch' && /حدّث الاثنين/.test(e.message)
    )
    await assert.rejects(
      () => via('0001_older').wait({ timeoutMs: 0 }),
      (e) => e.code === 'schema_mismatch'
    )
    const after = await twin.cloud.pool.query('SELECT count(*)::int AS n FROM cloud_rows')
    assert.equal(after.rows[0].n, before.rows[0].n)

    // Pairing from a PC on another version is refused before any code is used.
    const pairing = await twin.cloud.app.inject({
      method: 'POST',
      url: '/api/link.pair',
      payload: {
        code: 'ABCD-EFGH-JKMN',
        storeId: st.store_id,
        secretHash: 'a'.repeat(64),
        schema: '9999_newer'
      }
    })
    assert.equal(pairing.statusCode, 409)
    assert.equal(JSON.parse(pairing.body).error.code, 'schema_mismatch')
  } finally {
    await twin.close()
  }
})

test('D-106: a password changed at the shop signs that user out of the cloud; a renewed hash does not', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ link: false })
  try {
    // The cashier's hash is in the older format: their next sign-in at the shop renews it.
    await twin.shop.pool.query("UPDATE users SET password_scrypt = $1 WHERE username = 'cashier'", [
      hashPin('Test-5173-pw')
    ])
    await twin.sync()
    const owner = await twin.signIn('8642')
    const cashier = await twin.signIn('5173')
    const alive = async (token) => (await twin.cloud.call('shifts.current', {}, token)).status
    assert.deepEqual([await alive(owner), await alive(cashier)], [200, 200])

    // The cashier signs in at the shop (hash renewed) and the owner changes their password there.
    assert.equal(
      (await twin.shop.call('auth.login', { username: 'cashier', password: 'Test-5173-pw' }))
        .status,
      200
    )
    assert.equal(
      (
        await twin.shop.call(
          'auth.changePassword',
          { currentPassword: PASSWORD, newPassword: 'Keeper-Gate-2027' },
          twin.owner
        )
      ).status,
      200
    )
    await twin.sync()
    assert.equal(await alive(owner), 401, 'the owner is signed out of the cloud (a lost phone)')
    assert.equal(await alive(cashier), 200, 'a renewed hash is not a new password')
    assert.equal(
      (await twin.cloud.call('auth.login', { username: 'owner', password: 'Keeper-Gate-2027' }))
        .status,
      200
    )
    assert.equal((await twin.shop.call('shifts.current', {}, twin.owner)).status, 200, 'kept here')
  } finally {
    await twin.close()
  }
})

test('D-106: internet access withdrawn at the shop is refused there before the cloud hears of it', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ link: false })
  try {
    await twin.sync()
    const crypto = require('crypto')
    const { executeRemote } = require('../../src/server/sync/remoteOps')
    const cashierId = (
      await twin.shop.pool.query("SELECT id, role_id FROM users WHERE username = 'cashier'")
    ).rows[0]
    await twin.shop.pool.query(
      "DELETE FROM role_permissions WHERE role_id = $1 AND permission = 'internet.access'",
      [cashierId.role_id]
    )
    const r = await executeRemote(twin.shop.app, {
      id: crypto.randomUUID(),
      operation: 'expenses.create',
      body: { amount: 4, category: 'عام', destination: 'treasury', clientRef: crypto.randomUUID() },
      userId: cashierId.id,
      username: 'cashier'
    })
    assert.equal(r.status, 'refused')
    assert.equal(r.httpStatus, 403)
    assert.equal(
      Number((await twin.shop.pool.query('SELECT count(*) AS n FROM expenses')).rows[0].n),
      0
    )
  } finally {
    await twin.close()
  }
})

test('D-106: the recovery code hash never reaches the cloud', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ link: false })
  try {
    await twin.shop.pool.query("UPDATE users SET recovery_hash = $1 WHERE username = 'owner'", [
      hashPin('RECOVERY-CODE')
    ])
    await twin.sync()
    const cloudUser = await twin.cloud.pool.query(
      "SELECT recovery_hash FROM users WHERE username = 'owner'"
    )
    assert.equal(cloudUser.rows[0].recovery_hash, null)
    const stored = await twin.cloud.pool.query(
      "SELECT count(*)::int AS n FROM cloud_rows WHERE table_name = 'users' AND row_data ? 'recovery_hash'"
    )
    assert.equal(stored.rows[0].n, 0)
    // Still there in the shop, where recovery happens.
    const shopUser = await twin.shop.pool.query(
      "SELECT recovery_hash FROM users WHERE username = 'owner'"
    )
    assert.ok(shopUser.rows[0].recovery_hash)
  } finally {
    await twin.close()
  }
})
