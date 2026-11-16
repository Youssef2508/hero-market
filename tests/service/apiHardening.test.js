'use strict'
// Every operation of the service, swept (QA campaign 1.8.0): no session is refused, a role without
// the permission is refused, and hostile but well-formed values never make the service fail
// (a 500). The list comes from the service itself, so a new operation is swept automatically.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts
} = require('./helpers')
const { kindOf } = require('../../src/server/sync/operationKinds')

let db, svc, owner, cashier, cashierPerms

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('A1', 'صنف', 1, 2, 10, 'قطعة')"
  )
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  cashierPerms = (await svc.call('auth.me', {}, cashier)).body.permissions
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

const ops = () => [...svc.operations.values()]

test('no session: every operation that is not deliberately public answers 401, none fails', async (t) => {
  if (!requireDb(t)) return
  const failures = []
  for (const o of ops()) {
    const r = await svc.call(o.name, {})
    if (r.status >= 500) failures.push(`${o.name}: ${r.status}`)
    else if (!o.public && r.status !== 401)
      failures.push(`${o.name}: ${r.status} without a session`)
  }
  assert.deepEqual(failures, [])
  // The public ones are exactly the sign-in steps and the sign-in screen's question.
  assert.deepEqual(
    ops()
      .filter((o) => o.public)
      .map((o) => o.name)
      .sort(),
    ['auth.login', 'auth.recover', 'auth.setPassword', 'auth.setup', 'auth.status']
  )
})

test('a cashier is refused every operation that needs a permission the cashier lacks', async (t) => {
  if (!requireDb(t)) return
  const leaks = []
  let checked = 0
  for (const o of ops()) {
    const all = o.permission ? [].concat(o.permission) : []
    const lacksAll = all.length && !all.every((p) => cashierPerms.includes(p))
    const lacksAny = o.anyPermission && !o.anyPermission.some((p) => cashierPerms.includes(p))
    if (!lacksAll && !lacksAny) continue
    checked += 1
    const r = await svc.call(o.name, {}, cashier)
    if (r.status !== 403) leaks.push(`${o.name}: ${r.status}`)
  }
  assert.ok(checked > 100, `${checked} operations checked`)
  assert.deepEqual(leaks, [], 'refused with 403, never carried out or answered')
})

/** A well-formed body for an operation's schema, filled with hostile values. */
function hostile(schema, variant) {
  const strings = [
    "' OR 1=1; DROP TABLE products; --",
    '%_\\%',
    '‮تجربة‬<script>alert(1)</script>',
    '0'.repeat(64),
    ''
  ]
  const ints = [0, -1, 2147483647, 1, -2147483648]
  const numbers = [0, -0.0001, 1e15, 0.005, 99999999.999]
  const value = (p, name) => {
    if (!p) return null
    const type = Array.isArray(p.type) ? p.type.find((x) => x !== 'null') : p.type
    if (p.enum) return p.enum[variant % p.enum.length]
    if (type === 'string') {
      let s = strings[variant % strings.length]
      if (p.pattern) {
        // Shaped values for patterned fields (dates, ids): still unusual ones.
        if (/\\d\{4\}/.test(p.pattern)) s = ['1900-01-01', '2999-12-31', '2026-02-29'][variant % 3]
        else return undefined
      }
      if (p.maxLength) s = s.slice(0, p.maxLength)
      if (p.minLength && s.length < p.minLength) s = s.padEnd(p.minLength, 'x')
      return s
    }
    if (type === 'integer') {
      let n = ints[variant % ints.length]
      if (p.minimum !== undefined) n = Math.max(n, p.minimum)
      if (p.maximum !== undefined) n = Math.min(n, p.maximum)
      return n
    }
    if (type === 'number') {
      let n = numbers[variant % numbers.length]
      if (p.minimum !== undefined) n = Math.max(n, p.minimum)
      if (p.exclusiveMinimum !== undefined) n = Math.max(n, p.exclusiveMinimum + 1)
      return n
    }
    if (type === 'boolean') return variant % 2 === 0
    if (type === 'array') return p.minItems ? [] : []
    if (type === 'object') return {}
    void name
    return null
  }
  const body = {}
  for (const [k, p] of Object.entries(schema?.properties || {})) {
    const v = value(p, k)
    if (v !== undefined) body[k] = v
  }
  return body
}

test('reads with hostile but well-formed values never make the service fail', async (t) => {
  if (!requireDb(t)) return
  const failures = []
  let calls = 0
  for (const o of ops()) {
    if (kindOf(o.name) !== 'read' || o.public) continue
    for (let v = 0; v < 5; v++) {
      const r = await svc.call(o.name, hostile(o.schema, v), owner)
      calls += 1
      if (r.status >= 500) failures.push(`${o.name} #${v}: ${r.status} ${JSON.stringify(r.body)}`)
    }
  }
  assert.ok(calls > 300, `${calls} calls`)
  assert.deepEqual(failures, [])
  // A date shaped right but not on the calendar is the caller's error (found by this sweep).
  for (const [op, body] of [
    ['shifts.list', { date: '2026-02-29' }],
    ['suppliers.purchasesPage', { from: '2026-02-29', to: '2026-13-01' }]
  ]) {
    const r = await svc.call(op, body, owner)
    assert.equal(r.status, 400, `${op}: ${JSON.stringify(r.body)}`)
  }
  // Nothing was changed by them: the one product is as it was.
  const p = (
    await svc.pool.query("SELECT stock_qty::float8 AS s FROM products WHERE barcode = 'A1'")
  ).rows[0]
  assert.equal(p.s, 10)
  assert.equal(Number((await svc.pool.query('SELECT count(*) AS n FROM products')).rows[0].n), 1)
})

test('malformed bodies are refused as the caller’s error, never a failure of the service', async (t) => {
  if (!requireDb(t)) return
  const failures = []
  for (const o of ops()) {
    if (o.public) continue
    for (const raw of ['[]', '"x"', 'null', '{"a":', '{"__proto__":{"x":1}}']) {
      const r = await svc.app.inject({
        method: 'POST',
        url: `/api/${o.name}`,
        payload: raw,
        headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' }
      })
      if (r.statusCode >= 500) failures.push(`${o.name} ${raw}: ${r.statusCode}`)
    }
  }
  assert.deepEqual(failures, [])
})
