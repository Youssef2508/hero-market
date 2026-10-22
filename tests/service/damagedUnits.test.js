'use strict'
// WASTE-01 (D-071): damaged goods entered in a package (2 cartons) leave stock in the base unit,
// once, at the current cost; a unit of another product or a broken quantity is refused.
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

let db, svc, owner, boxId, otherBoxId
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const stock = async (b) =>
  Number(
    (await svc.pool.query('SELECT stock_qty FROM products WHERE barcode = $1', [b])).rows[0]
      .stock_qty
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  owner = await login(svc, '8642')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES
     ('W', 'عصير', 4, 6, 5, 100, 'علبة'), ('X', 'آخر', 1, 2, 2, 10, 'قطعة')`
  )
  for (const [b, name] of [
    ['W', 'كرتونة'],
    ['X', 'شدة']
  ])
    ok(
      await svc.call(
        'productUnits.save',
        { barcode: b, units: [{ name, factor: 10, retail_price: 50 }] },
        owner
      )
    )
  boxId = ok(await svc.call('productUnits.get', { barcode: 'W' }, owner)).units[0].id
  otherBoxId = ok(await svc.call('productUnits.get', { barcode: 'X' }, owner)).units[0].id
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('2 damaged cartons take 20 cans once, recorded in cans at the current cost', async (t) => {
  if (!requireDb(t)) return
  ok(
    await svc.call(
      'damaged.create',
      { barcode: 'W', quantity: 2, unitId: boxId, reason: 'كسر' },
      owner
    )
  )
  assert.equal(await stock('W'), 80)
  const d = (
    await svc.pool.query(
      "SELECT quantity::float8 q, cost_price::float8 c FROM damaged_goods WHERE product_barcode = 'W'"
    )
  ).rows
  assert.deepEqual(d, [{ q: 20, c: 4 }])
  const m = (
    await svc.pool.query("SELECT qty::float8 q FROM stock_movements WHERE kind = 'damaged'")
  ).rows
  assert.deepEqual(m, [{ q: -20 }])
  const log = (
    await svc.pool.query("SELECT description FROM system_logs WHERE action_type = 'damaged_create'")
  ).rows[0]
  assert.match(log.description, /2 كرتونة \(= 20 علبة\)/)
  // In the base unit, as before.
  ok(await svc.call('damaged.create', { barcode: 'W', quantity: 3, reason: 'كسر' }, owner))
  assert.equal(await stock('W'), 77)
})

test('a unit of another product or half a can is refused, and nothing changes', async (t) => {
  if (!requireDb(t)) return
  const before = await stock('W')
  assert.equal(
    (await svc.call('damaged.create', { barcode: 'W', quantity: 1, unitId: otherBoxId }, owner))
      .status,
    400
  )
  assert.equal(
    (await svc.call('damaged.create', { barcode: 'W', quantity: 0.5 }, owner)).status,
    400
  )
  assert.equal(await stock('W'), before)
})
