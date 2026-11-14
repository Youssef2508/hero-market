'use strict'
// A reloaded or reopened browser page continues its session (1.6.3): auth.session answers the
// same as a sign-in from the session cookie alone, makes no new session, and refuses an expired,
// revoked, unknown or withdrawn session. The page's side is in tests/unit/sessionResume.test.mjs
// and the real browser in scripts/e2e/session.js.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { requireDb, passwordFor } = require('./helpers')
const { makeTwin } = require('./cloudHelpers')

const WEB = { 'x-heromarket-web': '1' }

test('browser session: reload continues it; expiry, revocation, sign-out and bad cookies end it', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  const post = (op, body, headers = {}) =>
    twin.cloud.app.inject({ method: 'POST', url: `/api/${op}`, payload: body, headers })
  const json = (r) => (r.body ? JSON.parse(r.body) : null)
  const sessions = async () =>
    (
      await twin.cloud.pool.query(
        'SELECT count(*)::int AS n, count(*) FILTER (WHERE revoked_at IS NULL)::int AS live FROM sessions'
      )
    ).rows[0]
  const signIn = async () => {
    const r = await post('auth.login', { username: 'owner', password: passwordFor('8642') }, WEB)
    assert.equal(r.statusCode, 200)
    return String(r.headers['set-cookie']).split(';')[0]
  }
  try {
    const cookie = await signIn()
    const before = await sessions()

    // 1, 2. Reloads: the same session, answered like a sign-in, never a new one.
    for (let i = 0; i < 5; i++) {
      const r = await post('auth.session', {}, { ...WEB, cookie })
      assert.equal(r.statusCode, 200, r.body)
      const b = json(r)
      assert.equal(b.user.username, 'owner')
      assert.ok(Array.isArray(b.user.permissions) && b.user.permissions.includes('reports.view'))
      assert.ok('openShift' in b && 'shiftRequired' in b)
      assert.ok(!('token' in b))
      assert.equal(r.headers['set-cookie'], undefined, 'no new cookie on a reload')
    }
    assert.deepEqual(await sessions(), before)

    // 8, 10. Requests right after a reload, and several tabs at once with the one cookie.
    const tabs = await Promise.all(
      ['auth.session', 'products.page', 'auth.session', 'suppliers.list', 'link.state'].map((op) =>
        post(op, {}, { ...WEB, cookie })
      )
    )
    assert.deepEqual(
      tabs.map((r) => r.statusCode),
      [200, 200, 200, 200, 200]
    )
    assert.deepEqual(await sessions(), before)

    // The cookie alone (another site's request) is refused, as for every operation.
    assert.equal((await post('auth.session', {}, { cookie })).statusCode, 401)

    // 7. An unknown or malformed cookie, and none at all.
    for (const bad of ['hm_session=not-a-session', 'hm_session=', 'other=1'])
      assert.equal((await post('auth.session', {}, { ...WEB, cookie: bad })).statusCode, 401, bad)
    assert.equal((await post('auth.session', {}, WEB)).statusCode, 401)

    // 4. Expired: refused, and stays refused.
    await twin.cloud.pool.query(
      "UPDATE sessions SET expires_at = LOCALTIMESTAMP(0) - interval '1 minute' WHERE revoked_at IS NULL"
    )
    assert.equal((await post('auth.session', {}, { ...WEB, cookie })).statusCode, 401)

    // 6. Revoked (e.g. the password was changed elsewhere).
    const second = await signIn()
    assert.equal((await post('auth.session', {}, { ...WEB, cookie: second })).statusCode, 200)
    await twin.cloud.pool.query('UPDATE sessions SET revoked_at = LOCALTIMESTAMP(0)')
    assert.equal((await post('auth.session', {}, { ...WEB, cookie: second })).statusCode, 401)

    // 5. Signing out ends it for every tab.
    const third = await signIn()
    assert.equal((await post('auth.logout', {}, { ...WEB, cookie: third })).statusCode, 200)
    assert.equal((await post('auth.session', {}, { ...WEB, cookie: third })).statusCode, 401)
    assert.equal((await post('products.page', {}, { ...WEB, cookie: third })).statusCode, 401)
  } finally {
    await twin.close()
  }
})
