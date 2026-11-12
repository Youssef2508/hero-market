'use strict'
// Signing in from the internet (Phase 2 milestone 5, D-105): behind the reverse proxy each visitor
// is counted by their own address; one typed username is paused after repeated failures from any
// number of addresses, on the internet only; passwords hashed with older parameters are renewed at
// the next sign-in in the shop.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { requireDb } = require('./helpers')
const { makeTwin } = require('./cloudHelpers')
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
