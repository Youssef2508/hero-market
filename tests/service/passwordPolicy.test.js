'use strict'
// The password rule follows internet access (owner, 1.8.0, D-113). Someone who signs in only at
// the shop may choose any password that is not empty – 1234, letters only, one character. Whoever
// may sign in through the internet needs the strong rule, and gains that access only with a
// password that meets it. The service decides, from the user's own permissions; hashing, sessions
// and the wrong-password limits are as before.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, passwordFor, createUser } = require('./helpers')
const { makeTwin, inStep, ok } = require('./cloudHelpers')

const one = async (pool, sql, p) => (await pool.query(sql, p)).rows[0]

test('the password rule follows internet access, everywhere a password is set or access granted', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const { shop, cloud } = twin
    const signIn = (svc, username, password, terminal = 'test-pw') =>
      svc.call('auth.login', { username, password }, null, { 'x-heromarket-terminal': terminal })
    const session = async (username, password) => {
      const r = await signIn(shop, username, password)
      assert.equal(r.status, 200, JSON.stringify(r.body))
      return r.body.token
    }
    const roleId = async (name) =>
      (await one(shop.pool, 'SELECT id FROM roles WHERE name = $1 OR key = $1', [name])).id
    const user = (name) =>
      one(
        shop.pool,
        'SELECT id, role_id, password_strong, password_scrypt FROM users WHERE username = $1',
        [name]
      )
    const internetRole = await roleId('كاشير من الإنترنت')
    const cashierRole = await roleId('cashier')

    // ── A user who signs in only at the shop: any password that is not empty ──
    let current = passwordFor('6205')
    let token = await session('second', current)
    const me = ok(await shop.call('auth.me', {}, token))
    assert.equal(me.passwordPolicy, 'simple')
    for (const next of ['1234', 'abcd', 'ABCD', 'a1', 'x', '0000']) {
      const r = await shop.call(
        'auth.changePassword',
        { currentPassword: current, newPassword: next },
        token
      )
      assert.equal(r.status, 200, `${next}: ${JSON.stringify(r.body)}`)
      current = next
      // Signs in with it at the shop.
      token = await session('second', current)
    }
    assert.equal((await user('second')).password_strong, false)
    // Still a password: never empty, never only spaces, never longer than the maximum.
    for (const bad of ['   ', 'x'.repeat(129)]) {
      const r = await shop.call(
        'auth.changePassword',
        { currentPassword: current, newPassword: bad },
        token
      )
      assert.equal(r.status, 400, JSON.stringify(bad))
    }
    assert.equal(
      (await shop.call('auth.changePassword', { currentPassword: current, newPassword: '' }, token))
        .status,
      400
    )
    // Hashed as always; never written anywhere as typed.
    assert.match((await user('second')).password_scrypt, /^scrypt\$/)
    const logs = (await shop.pool.query('SELECT description, details FROM system_logs')).rows
    assert.ok(!JSON.stringify(logs).includes('"0000"'))

    // ── Internet access needs the strong rule ──
    const cashier = await session('cashier', passwordFor('5173'))
    assert.equal(ok(await shop.call('auth.me', {}, cashier)).passwordPolicy, 'strong')
    const weak = await shop.call(
      'auth.changePassword',
      { currentPassword: passwordFor('5173'), newPassword: '1234' },
      cashier
    )
    assert.equal(weak.status, 400)
    assert.equal(weak.body.error.details.code, 'weak_password')
    assert.equal((await user('cashier')).password_strong, true)

    // ── Granting internet access to a user with a simple password ──
    const grant = (extra = {}) =>
      shop.call(
        'users.update',
        { id: me.id, username: 'second', roleId: internetRole, ...extra },
        twin.owner
      )
    const refused = await grant()
    assert.equal(refused.status, 409)
    assert.equal(refused.body.error.details.code, 'weak_password_for_internet')
    assert.equal((await user('second')).role_id, cashierRole, 'nothing changed')
    // The way: grant with a reset – a strong temporary password; a strong one is chosen next.
    const granted = ok(await grant({ resetPassword: true, actorPassword: passwordFor('8642') }))
    assert.ok(granted.temporaryPassword)
    const after = await user('second')
    assert.deepEqual([after.role_id, after.password_strong], [internetRole, true])
    const first = ok(await signIn(shop, 'second', granted.temporaryPassword))
    assert.equal(first.passwordChangeRequired, true)
    assert.equal(first.passwordPolicy, 'strong')
    const tooSimple = await shop.call('auth.setPassword', {
      username: 'second',
      currentPassword: granted.temporaryPassword,
      newPassword: '1234'
    })
    assert.equal(tooSimple.status, 400)
    const strong = 'Mango-Tree-42'
    ok(
      await shop.call('auth.setPassword', {
        username: 'second',
        currentPassword: granted.temporaryPassword,
        newPassword: strong
      })
    )
    assert.equal((await user('second')).password_strong, true)

    // ── Taken away: a simple password is allowed again; given back: refused again ──
    ok(
      await shop.call(
        'users.update',
        { id: me.id, username: 'second', roleId: cashierRole },
        twin.owner
      )
    )
    let t2 = await session('second', strong)
    ok(await shop.call('auth.changePassword', { currentPassword: strong, newPassword: '55' }, t2))
    t2 = await session('second', '55')
    assert.equal((await grant()).status, 409)

    // ── Internet access added to a role whose users have simple passwords ──
    const role = ok(
      await shop.call(
        'roles.create',
        { name: 'كاشير محلي', description: '', permissions: ['pos.sell', 'shifts.operate'] },
        twin.owner
      )
    )
    await createUser(shop, { username: 'third', pin: '3141', roleKey: 'cashier' })
    const third = await user('third')
    ok(
      await shop.call(
        'users.update',
        { id: third.id, username: 'third', roleId: role.id },
        twin.owner
      )
    )
    const t3 = await session('third', passwordFor('3141'))
    ok(
      await shop.call(
        'auth.changePassword',
        { currentPassword: passwordFor('3141'), newPassword: '9' },
        t3
      )
    )
    const roleRefused = await shop.call(
      'roles.update',
      {
        id: role.id,
        name: 'كاشير محلي',
        description: '',
        permissions: ['pos.sell', 'shifts.operate', 'internet.access']
      },
      twin.owner
    )
    assert.equal(roleRefused.status, 409)
    assert.deepEqual(roleRefused.body.error.details.users, ['third'])
    const perms = (
      await shop.pool.query('SELECT permission FROM role_permissions WHERE role_id = $1', [role.id])
    ).rows.map((r) => r.permission)
    assert.ok(!perms.includes('internet.access'), 'the role is unchanged')

    // ── New accounts: an administrator's temporary password follows the role's rule ──
    const local = ok(
      await shop.call(
        'users.create',
        { username: 'fourth', password: '1234', roleId: cashierRole },
        twin.owner
      )
    )
    assert.equal(local.temporaryPassword, '1234')
    assert.equal((await user('fourth')).password_strong, false)
    const remote = await shop.call(
      'users.create',
      { username: 'fifth', password: '1234', roleId: internetRole },
      twin.owner
    )
    assert.equal(remote.status, 400)
    const generated = ok(
      await shop.call('users.create', { username: 'fifth', roleId: internetRole }, twin.owner)
    )
    assert.ok(generated.temporaryPassword.length >= 8)
    assert.equal((await user('fifth')).password_strong, true)

    // ── Through the internet ──
    assert.deepEqual(await inStep(twin), [])
    // Only-at-the-shop users: refused for having no internet access, whatever their password.
    const localNet = await signIn(cloud, 'second', '55')
    assert.equal(localNet.status, 403)
    assert.match(localNet.body.error.message, /الإنترنت/)
    // Internet access and a simple password met through synchronisation (granted on one side while
    // a simple password was chosen on the other): refused, and an open session stops working.
    const netSession = (await signIn(cloud, 'cashier', passwordFor('5173'), 'phone')).body.token
    assert.equal((await cloud.call('auth.me', {}, netSession)).status, 200)
    await cloud.pool.query("UPDATE users SET password_strong = false WHERE username = 'cashier'")
    const blocked = await signIn(cloud, 'cashier', passwordFor('5173'), 'phone')
    assert.equal(blocked.status, 403)
    assert.match(blocked.body.error.message, /بسيطة/)
    assert.equal((await cloud.call('auth.me', {}, netSession)).status, 403)
    await cloud.pool.query("UPDATE users SET password_strong = true WHERE username = 'cashier'")

    // ── The wrong-password limits are the same for simple passwords ──
    const terminal = `guard-${crypto.randomUUID().slice(0, 8)}`
    let status
    for (let i = 0; i < 7; i++) status = (await signIn(shop, 'fourth', 'wrong', terminal)).status
    assert.equal(status, 429)
  } finally {
    await twin.close()
  }
})
