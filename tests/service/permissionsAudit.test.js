'use strict'
// ROLE-02 (D-075): permissions are enforced by the service, not by hiding buttons. Every operation
// needs a permission unless it is listed (with its reason) as public or for any signed-in user;
// every built-in role is refused – by a direct request, without the screens – every operation it
// does not hold; the owner-only money views stay owner-only by default; the permission matrix in
// .docs is the code's current state.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')
const { SYSTEM_ROLES } = require('../../src/server/auth/permissions')
const { buildMatrix, SIGNED_IN, PUBLIC, OUT } = require('../../scripts/permission-matrix')

let db, svc
const roleOf = (key) => SYSTEM_ROLES.find((r) => r.key === key)

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('every operation requires a permission, or is listed as open with its reason', async (t) => {
  if (!requireDb(t)) return
  const open = [...svc.operations.values()].filter((o) => !o.permission && !o.anyPermission)
  for (const o of open) {
    const listed = o.public ? PUBLIC : SIGNED_IN
    assert.ok(
      o.name in listed,
      `${o.name} has no permission: give it one, or list it in scripts/permission-matrix.js with why`
    )
  }
  // And nothing listed as open has quietly gained or lost that status.
  for (const name of Object.keys(PUBLIC)) assert.equal(svc.operations.get(name)?.public, true, name)
  for (const name of Object.keys(SIGNED_IN)) {
    const o = svc.operations.get(name)
    assert.ok(o && !o.public && !o.permission && !o.anyPermission, name)
  }
})

test('each built-in role is refused, by direct request, every operation it does not hold', async (t) => {
  if (!requireDb(t)) return
  let pin = 4000
  const refusedCounts = {}
  for (const role of SYSTEM_ROLES.filter((r) => r.key !== 'super_admin')) {
    const code = String(++pin)
    await createUser(svc, { username: `audit_${role.key}`, pin: code, roleKey: role.key })
    const token = await login(svc, code)
    let refused = 0
    for (const o of svc.operations.values()) {
      if (o.public) continue
      const all = o.permission ? [].concat(o.permission) : []
      const any = o.anyPermission || []
      const allowed =
        all.every((p) => role.permissions.includes(p)) &&
        (!any.length || any.some((p) => role.permissions.includes(p)))
      if (allowed) continue
      const r = await svc.call(o.name, {}, token)
      assert.equal(r.status, 403, `${role.key} → ${o.name} answered ${r.status}`)
      refused++
    }
    refusedCounts[role.key] = refused
  }
  t.diagnostic(`operations refused per role: ${JSON.stringify(refusedCounts)}`)
  assert.ok(refusedCounts.cashier > 80, 'a cashier is refused most of the back office')
  // Without signing in, everything but the public operations is refused.
  for (const o of svc.operations.values()) {
    if (o.public) continue
    assert.equal((await svc.call(o.name, {})).status, 401, o.name)
  }
})

test('owner-only money views stay with administrators by default', () => {
  const ownerOnly = [
    'shifts.view_expected', // expected amounts before the close (blind close, D-073)
    'treasury.view',
    'treasury.manage',
    'expenses.view_all',
    'reports.valuation', // stock value, owed to suppliers and by customers (D-071)
    'sales.change_payment',
    'suppliers.opening',
    'data.import',
    'data.export',
    'users.manage',
    'roles.manage',
    'system.reset'
  ]
  for (const key of ['cashier', 'manager', 'inventory', 'auditor'])
    for (const p of ownerOnly)
      assert.ok(!roleOf(key).permissions.includes(p), `${key} must not have ${p} by default`)
  for (const p of ownerOnly.filter((p) => p !== 'system.reset'))
    assert.ok(roleOf('store_admin').permissions.includes(p), `store_admin keeps ${p}`)
})

test('the permission matrix in .docs is the code’s current state', async (t) => {
  // The container images leave the documentation out (.dockerignore); the check runs wherever the
  // repository is checked out in full (development, the Linux and Windows CI jobs).
  if (!fs.existsSync(path.dirname(OUT))) return t.skip('no .docs folder in this image')
  const expected = await buildMatrix()
  const actual = fs.readFileSync(OUT, 'utf8')
  assert.equal(actual, expected, 'regenerate it: node scripts/permission-matrix.js')
})
