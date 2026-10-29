'use strict'
// New selling and wholesale prices on purchase lines (owner, 2026-10-22, D-068). A filled field
// sets the product's price when the purchase is confirmed, even over a price an earlier purchase
// set; an empty field keeps it. Per product, the two prices independently; package prices never
// change; the purchase price rule and the invoice discount are untouched; atomic; in the activity log.
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

let db, svc, owner, supplierId, boxId
const ref = () => crypto.randomUUID()
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const product = async (b) =>
  (
    await svc.pool.query(
      'SELECT retail_price::float8 r, wholesale_price::float8 w, cost_price::float8 c, stock_qty::float8 s FROM products WHERE barcode = $1',
      [b]
    )
  ).rows[0]
const buy = (items, extra = {}) =>
  svc.call(
    'suppliers.addPurchase',
    {
      supplierId,
      total_amount: Math.round(items.reduce((a, i) => a + i.qty * i.unitCost, 0) * 100) / 100,
      paid_amount: 0,
      payment_type: 'آجل',
      items,
      ...extra
    },
    owner
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
     ('A', 'صنف أ', 0, 10, 9, 0, 'قطعة'), ('B', 'صنف ب', 0, 20, 18, 0, 'قطعة')`
  )
  ok(
    await svc.call(
      'productUnits.save',
      {
        barcode: 'A',
        units: [
          { name: 'علبة', factor: 10, retail_price: 95, wholesale_price: 90, purchase_cost: 70 }
        ]
      },
      owner
    )
  )
  boxId = ok(await svc.call('productUnits.get', { barcode: 'A' }, owner)).units[0].id
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الأسعار' }, owner)).id
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a filled selling price is set; empty fields and the package prices stay; cost follows the lines only', async (t) => {
  if (!requireDb(t)) return
  ok(
    await buy([
      { barcode: 'A', qty: 10, unitCost: 7, newRetailPrice: 12 },
      { barcode: 'B', qty: 5, unitCost: 15 }
    ])
  )
  assert.deepEqual(await product('A'), { r: 12, w: 9, c: 7, s: 10 })
  assert.deepEqual(await product('B'), { r: 20, w: 18, c: 15, s: 5 }, 'no field: unchanged')
  const box = (
    await svc.pool.query(
      'SELECT retail_price::float8 r, wholesale_price::float8 w FROM product_units WHERE id = $1',
      [boxId]
    )
  ).rows[0]
  assert.deepEqual(box, { r: 95, w: 90 }, 'package prices are never changed by a purchase')
  // The line keeps what it set and what it replaced; the change is in the activity log.
  const line = (
    await svc.pool.query(
      "SELECT new_retail_price::float8 n, old_retail_price::float8 o, new_wholesale_price w FROM supplier_purchase_items WHERE product_barcode = 'A'"
    )
  ).rows[0]
  assert.deepEqual(line, { n: 12, o: 10, w: null })
  const log = (
    await svc.pool.query(
      "SELECT description, details FROM system_logs WHERE action_type = 'product_price_change' ORDER BY id"
    )
  ).rows
  assert.equal(log.length, 1)
  assert.match(log[0].description, /سعر البيع "صنف أ" \(A\): 10\.00 ← 12\.00/)
})

test('wholesale alone, both together, and a later purchase overriding an earlier price', async (t) => {
  if (!requireDb(t)) return
  ok(await buy([{ barcode: 'B', qty: 1, unitCost: 15, newWholesalePrice: 17 }]))
  assert.deepEqual([(await product('B')).r, (await product('B')).w], [20, 17])
  ok(
    await buy([{ barcode: 'A', qty: 1, unitCost: 7, newRetailPrice: 11.5, newWholesalePrice: 10 }])
  )
  assert.deepEqual([(await product('A')).r, (await product('A')).w], [11.5, 10])
  // Bought in boxes: the field is still the price of one piece.
  ok(await buy([{ barcode: 'A', unitId: boxId, qty: 1, unitCost: 70, newRetailPrice: 13 }]))
  assert.equal((await product('A')).r, 13)
})

test('the same price again changes nothing and logs nothing', async (t) => {
  if (!requireDb(t)) return
  const n = async () =>
    (
      await svc.pool.query(
        "SELECT COUNT(*)::int n FROM system_logs WHERE action_type = 'product_price_change'"
      )
    ).rows[0].n
  const before = await n()
  ok(await buy([{ barcode: 'A', qty: 1, unitCost: 7, newRetailPrice: 13 }]))
  assert.equal(await n(), before)
})

test('two different prices for one product in one invoice, or a failing purchase: nothing changes', async (t) => {
  if (!requireDb(t)) return
  const was = await product('A')
  const purchases = async () =>
    (await svc.pool.query('SELECT COUNT(*)::int n FROM supplier_purchases')).rows[0].n
  const n0 = await purchases()
  assert.equal(
    (
      await buy([
        { barcode: 'A', qty: 1, unitCost: 7, newRetailPrice: 14 },
        { barcode: 'A', unitId: boxId, qty: 1, unitCost: 70, newRetailPrice: 15 }
      ])
    ).status,
    400
  )
  // Totals that do not match the lines: refused, and the new price is not applied.
  assert.equal(
    (await buy([{ barcode: 'A', qty: 1, unitCost: 7, newRetailPrice: 99 }], { total_amount: 8 }))
      .status,
    400
  )
  assert.deepEqual(await product('A'), was)
  assert.equal(await purchases(), n0)
})

test('with an invoice discount and when completing a preliminary invoice', async (t) => {
  if (!requireDb(t)) return
  ok(
    await buy([{ barcode: 'B', qty: 10, unitCost: 15, newRetailPrice: 22 }], {
      total_amount: 140,
      discount: 10
    })
  )
  const b = await product('B')
  assert.equal(b.r, 22)
  const p = (
    await svc.pool.query(
      'SELECT total_amount::float8 t, discount::float8 d FROM supplier_purchases ORDER BY id DESC LIMIT 1'
    )
  ).rows[0]
  assert.deepEqual(p, { t: 140, d: 10 }, 'the discount rule is unchanged')
  const inv = ok(
    await svc.call(
      'supplierInvoices.createPending',
      { supplierId, total: 15, paymentMode: 'credit', clientRef: ref() },
      owner
    )
  ).invoice
  ok(
    await svc.call(
      'supplierInvoices.convert',
      {
        invoiceId: inv.id,
        items: [{ barcode: 'B', qty: 1, unitCost: 15, newWholesalePrice: 19 }],
        clientRef: ref()
      },
      owner
    )
  )
  assert.equal((await product('B')).w, 19)
})
