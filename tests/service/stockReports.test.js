'use strict'
// Phase F (owner feedback, D-071): stock value at cost and selling price (PROD-02), the owner's
// four snapshots (DASH-01) and the store-wide stock movements (STOCK-01), against known data.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts
} = require('./helpers')

let db, svc, owner, cashier, manager, viewer
const ref = () => crypto.randomUUID()
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await createUser(svc, { username: 'manager', pin: '5174', roleKey: 'manager' })
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  manager = await login(svc, '5174')
  // A: 10 at 5 / 8. B: −3 (sold before receipt). C: no cost. D: stopped. E: weighed 2.5 kg.
  // F: 25 pieces with a box of 10 (counted once, in pieces).
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit, unit_kind, is_active) VALUES
     ('A', 'صنف عادي', 5, 8, 7, 10, 'قطعة', 'count', true),
     ('B', 'صنف بالسالب', 4, 6, 5, -3, 'قطعة', 'count', true),
     ('C', 'صنف بلا تكلفة', 0, 10, 9, 7, 'قطعة', 'count', true),
     ('D', 'صنف موقوف', 2, 3, 3, 5, 'قطعة', 'count', false),
     ('E', 'جبنة بالوزن', 100, 120, 110, 2.5, 'كيلو', 'weight', true),
     ('F', 'هوهوز', 8, 10, 9, 25, 'قطعة', 'count', true)`
  )
  ok(
    await svc.call(
      'productUnits.save',
      { barcode: 'F', units: [{ name: 'علبة', factor: 10, retail_price: 90 }] },
      owner
    )
  )
  ok(await svc.call('suppliers.create', { name: 'مورد له', openingBalance: 100 }, owner))
  ok(await svc.call('suppliers.create', { name: 'مورد علينا له', openingBalance: -30 }, owner))
  ok(
    await svc.call(
      'storeImport.apply',
      {
        customers: [
          { row: 2, name: 'عميل عليه', phone: '01001234567', balance: 50 },
          { row: 3, name: 'عميل له', phone: '01001234568', balance: -20 }
        ]
      },
      owner
    )
  )
  // Viewer: products and costs visible, nothing else.
  const roleId = ok(
    await svc.call(
      'roles.create',
      { name: 'عرض الأصناف', description: '', permissions: ['products.view'] },
      owner
    )
  ).id
  await createUser(svc, { username: 'viewer', pin: '2468', roleKey: 'cashier' })
  await svc.pool.query("UPDATE users SET role_id = $1 WHERE username = 'viewer'", [roleId])
  viewer = await login(svc, '2468')
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

// A 50/80, C 0/70, E 250/300, F 200/250 → cost 500, retail 700. B (negative) and D (stopped) add 0.
test('stock value: base units, negative stock as 0, no cost counted, stopped products left out', async (t) => {
  if (!requireDb(t)) return
  const r = ok(await svc.call('inventory.valuation', {}, owner))
  assert.deepEqual(r.totals, { products: 5, cost: 500, retail: 700, negative: 1, noCost: 1 })
  assert.equal(r.inactive, 1)
  assert.equal(r.mismatches, 0, 'stock equals its movements')
  const f = r.rows.find((x) => x.barcode === 'F')
  assert.deepEqual([f.stock, f.value_cost, f.pack_name, f.pack_factor], [25, 200, 'علبة', 10])
  const b = r.rows.find((x) => x.barcode === 'B')
  assert.deepEqual([b.stock, b.value_cost, b.value_retail], [-3, 0, 0])
  // Stopped products on request.
  const all = ok(await svc.call('inventory.valuation', { includeInactive: true }, owner))
  assert.deepEqual([all.totals.products, all.totals.cost], [6, 510])
})

test('filters change the rows and the totals together', async (t) => {
  if (!requireDb(t)) return
  const neg = ok(await svc.call('inventory.valuation', { status: 'negative' }, owner))
  assert.deepEqual(
    neg.rows.map((x) => x.barcode),
    ['B']
  )
  assert.deepEqual([neg.totals.products, neg.totals.cost], [1, 0])
  const noCost = ok(await svc.call('inventory.valuation', { status: 'nocost' }, owner))
  assert.deepEqual(
    noCost.rows.map((x) => x.barcode),
    ['C']
  )
  assert.equal(noCost.totals.retail, 70)
  const weight = ok(await svc.call('inventory.valuation', { kind: 'weight' }, owner))
  assert.deepEqual(
    [weight.totals.products, weight.totals.cost, weight.totals.retail],
    [1, 250, 300]
  )
  const search = ok(await svc.call('inventory.valuation', { search: 'هوهوز' }, owner))
  assert.deepEqual([search.rows.length, search.totals.cost], [1, 200])
  const sorted = ok(await svc.call('inventory.valuation', { sort: 'cost', asc: false }, owner))
  assert.equal(sorted.rows[0].barcode, 'E')
})

test('the four snapshots agree with the report and the balances', async (t) => {
  if (!requireDb(t)) return
  const s = ok(await svc.call('dashboard.snapshots', {}, owner))
  const r = ok(await svc.call('inventory.valuation', {}, owner))
  assert.deepEqual([s.stockCost, s.stockRetail], [r.totals.cost, r.totals.retail])
  assert.deepEqual(
    [s.supplierOwed, s.supplierCredit, s.suppliers, s.customerOwed, s.customerCredit, s.customers],
    [100, 30, 1, 50, 20, 1]
  )
  // Live: a sale changes them at once.
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: ref(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'A', qty: 2 }]
      },
      owner
    )
  )
  const s2 = ok(await svc.call('dashboard.snapshots', {}, owner))
  assert.deepEqual([s2.stockCost, s2.stockRetail], [490, 684])
})

test('only holders of the valuation permission see values', async (t) => {
  if (!requireDb(t)) return
  for (const token of [cashier, manager, viewer]) {
    assert.equal((await svc.call('inventory.valuation', {}, token)).status, 403)
    assert.equal((await svc.call('dashboard.snapshots', {}, token)).status, 403)
  }
})

test('stock movements: the same rows as each product’s history, filtered, costs hidden without permission', async (t) => {
  if (!requireDb(t)) return
  const all = ok(await svc.call('inventory.allMovements', {}, owner))
  const history = ok(await svc.call('inventory.movements', { barcode: 'A', limit: 500 }, owner))
  const ofA = all.rows.filter((m) => m.barcode === 'A').map((m) => m.id)
  assert.deepEqual(
    ofA,
    history.map((m) => m.id)
  )
  const sales = ok(await svc.call('inventory.allMovements', { kinds: ['sale'] }, owner))
  assert.deepEqual(
    sales.rows.map((m) => [m.barcode, m.qty, m.ref_type, m.username]),
    [['A', -2, 'sale', 'owner']]
  )
  assert.equal(sales.total, 1)
  const search = ok(await svc.call('inventory.allMovements', { search: 'هوهوز' }, owner))
  assert.ok(search.rows.every((m) => m.barcode === 'F'))
  const today = new Date().toLocaleDateString('en-CA')
  const dated = ok(
    await svc.call('inventory.allMovements', { from: today, to: today, kinds: ['sale'] }, owner)
  )
  assert.equal(dated.total, 1)
  assert.equal(
    (await svc.call('inventory.allMovements', { from: '2026-10-02', to: '2026-10-01' }, owner))
      .status,
    400
  )
  // Costs are hidden from a role without products.view_cost.
  const v = ok(await svc.call('inventory.allMovements', { kinds: ['sale'] }, viewer))
  assert.equal('cost' in v.rows[0], false)
  assert.equal((await svc.call('inventory.allMovements', {}, cashier)).status, 403)
})
