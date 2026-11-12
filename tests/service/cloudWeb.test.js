'use strict'
// The browser's way in (Phase 2 milestone 2): the session is an HTTP-only cookie the page cannot
// read, a request must carry our own header (cross-site forgery), and the cloud serves the built
// pages without ever serving a file outside them.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { requireDb, passwordFor } = require('./helpers')
const { makeTwin } = require('./cloudHelpers')

const WEB = { 'x-heromarket-web': '1' }

test('browser sessions: cookie only, our header required, sign-out clears it; the pages are served safely', async (t) => {
  if (!requireDb(t)) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-web-'))
  fs.mkdirSync(path.join(root, 'assets'))
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>HeroMarket</title>')
  fs.writeFileSync(path.join(root, 'assets', 'app-abc123.js'), 'console.log(1)')
  fs.writeFileSync(path.join(root, '..', 'hm-web-secret.txt'), 'outside')
  const twin = await makeTwin({ cloudOptions: { webRoot: root } })
  const inject = (o) => twin.cloud.app.inject(o)
  const post = (op, body, headers = {}) =>
    inject({ method: 'POST', url: `/api/${op}`, payload: body, headers })
  try {
    const signIn = await post(
      'auth.login',
      { username: 'owner', password: passwordFor('8642') },
      WEB
    )
    assert.equal(signIn.statusCode, 200)
    const body = JSON.parse(signIn.body)
    assert.equal(body.user.username, 'owner')
    assert.ok(!('token' in body), 'the page never receives the session token')
    const set = String(signIn.headers['set-cookie'])
    assert.match(
      set,
      /^hm_session=[\w-]{40,}; Path=\/api; HttpOnly; SameSite=Strict; Secure; Max-Age=43200$/
    )
    const cookie = set.split(';')[0]

    // With the cookie and our header: in. With the cookie alone (what another site could cause): out.
    assert.equal((await post('auth.me', {}, { ...WEB, cookie })).statusCode, 200)
    assert.equal((await post('auth.me', {}, { cookie })).statusCode, 401)
    assert.equal((await post('suppliers.list', {}, { ...WEB, cookie })).statusCode, 200)
    // A change from the browser session is carried out in the shop, like any other.
    const made = await post('suppliers.create', { name: 'مورد من المتصفح' }, { ...WEB, cookie })
    assert.equal(made.statusCode, 200)
    assert.equal(
      (
        await twin.shop.pool.query(
          "SELECT count(*)::int AS n FROM suppliers WHERE name = 'مورد من المتصفح'"
        )
      ).rows[0].n,
      1
    )
    // Sign-out ends the session and empties the cookie.
    const out = await post('auth.logout', {}, { ...WEB, cookie })
    assert.match(String(out.headers['set-cookie']), /^hm_session=; .*Max-Age=0$/)
    assert.equal((await post('auth.me', {}, { ...WEB, cookie })).statusCode, 401)
    // A program that is not a browser still signs in with a token, as the desktop does.
    const api = await post('auth.login', { username: 'owner', password: passwordFor('8642') })
    assert.ok(JSON.parse(api.body).token)
    assert.equal(api.headers['set-cookie'], undefined)

    // The pages.
    const home = await inject({ method: 'GET', url: '/' })
    assert.deepEqual(
      [
        home.statusCode,
        home.headers['content-type'],
        home.headers['cache-control'],
        home.headers['x-frame-options']
      ],
      [200, 'text/html; charset=utf-8', 'no-cache', 'DENY']
    )
    const script = await inject({ method: 'GET', url: '/assets/app-abc123.js' })
    assert.deepEqual(
      [
        script.statusCode,
        script.headers['cache-control'],
        script.headers['x-content-type-options']
      ],
      [200, 'public, max-age=31536000, immutable', 'nosniff']
    )
    // An address inside the application is the application; a missing file is not.
    assert.match((await inject({ method: 'GET', url: '/shifts?x=1' })).body, /HeroMarket/)
    assert.equal((await inject({ method: 'GET', url: '/assets/none.js' })).statusCode, 404)
    // Nothing outside the build folder, however the address is written.
    for (const url of [
      '/../hm-web-secret.txt',
      '/%2e%2e/hm-web-secret.txt',
      '/assets/..%2f..%2fhm-web-secret.txt',
      '/..%5chm-web-secret.txt'
    ]) {
      const r = await inject({ method: 'GET', url })
      assert.ok(!r.body.includes('outside'), url)
    }
    // The API is untouched by the pages' catch-all.
    assert.equal((await inject({ method: 'GET', url: '/api/health' })).statusCode, 200)
  } finally {
    await twin.close()
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(path.join(root, '..', 'hm-web-secret.txt'), { force: true })
  }
})
