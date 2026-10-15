'use strict'
// Manual weighing (owner, 2026-10-15): the cashier weighs on an ordinary scale, selects the product
// and types the weight. No scale labels. Bramili cheese at EGP 240/kg.
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
const { verifyLedger } = require('../../src/server/inventory/stock')

let db, svc, admin, cashier, shift
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const stock = async () =>
  Number((await one("SELECT stock_qty FROM products WHERE barcode = 'BRAM'")).stock_qty)
const sell = (items, token) =>
  svc.call(
    'pos.checkout',
    { clientRef: crypto.randomUUID(), shiftId: shift.id, paymentType: 'نقدي', items },
    token
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, unit_kind) VALUES
      ('BRAM', 'جبنة برميلي', 180, 240, 5, 'كجم', 'weight')`
  )
  admin = await login(svc, '8642')
  cashier = await login(svc, '5173')
  shift = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier))
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a cashier finds the weighed product by name or by its own code; no scale label involved', async (t) => {
  if (!requireDb(t)) return
  const found = ok(await svc.call('pos.searchProducts', { term: 'برميلي' }, cashier))
  assert.deepEqual(
    found.map((p) => p.barcode),
    ['BRAM']
  )
  const r = ok(await svc.call('pos.resolve', { code: 'BRAM' }, cashier))
  // No quantity: the till asks for the weight (weight entry), priced per kilogram.
  assert.deepEqual(
    [r.product.unit_kind, r.qty, r.unit.price, r.unit.name],
    ['weight', null, 240, 'كجم']
  )
})

test('100 g, 250 g, 300 g and 1 kg: price per kilogram, stock in kilograms, invoice lines', async (t) => {
  if (!requireDb(t)) return
  const start = await stock()
  const sale = ok(await sell([{ barcode: 'BRAM', qty: 0.25, unitPrice: 240 }], cashier))
  assert.equal(sale.total, 60, '250 g × 240 = 60.00')
  for (const [kg, total] of [
    [0.1, 24],
    [0.3, 72],
    [1, 240]
  ]) {
    const r = ok(await sell([{ barcode: 'BRAM', qty: kg, unitPrice: 240 }], cashier))
    assert.equal(r.total, total, `${kg} kg`)
  }
  assert.equal(await stock(), Math.round((start - 1.65) * 1000) / 1000)
  const line = await one(
    'SELECT quantity, unit_name, unit_factor, unit_price, total_price FROM sale_items WHERE sale_id = $1',
    [sale.saleId]
  )
  assert.deepEqual(
    [
      Number(line.quantity),
      line.unit_name,
      Number(line.unit_factor),
      Number(line.unit_price),
      Number(line.total_price)
    ],
    [0.25, 'كجم', 1, 240, 60]
  )
  const mv = await one(
    "SELECT qty, balance_after FROM stock_movements WHERE ref_type = 'sale' AND ref_id = $1",
    [sale.saleId]
  )
  assert.equal(Number(mv.qty), -0.25)
})

test('invalid weights are refused before anything is written', async (t) => {
  if (!requireDb(t)) return
  const sales = (await one('SELECT count(*)::int AS n FROM sales')).n
  for (const kg of [0.2505, 0.0001, 0, -0.25]) {
    const r = await sell([{ barcode: 'BRAM', qty: kg, unitPrice: 240 }], cashier)
    assert.equal(r.status, 400, `${kg} kg refused`)
  }
  assert.equal((await one('SELECT count(*)::int AS n FROM sales')).n, sales)
})

test('return part of a weighed line: 100 g of a 300 g line refunds 24.00 and restocks 0.100 kg', async (t) => {
  if (!requireDb(t)) return
  const sale = ok(await sell([{ barcode: 'BRAM', qty: 0.3, unitPrice: 240 }], cashier))
  const item = await one('SELECT id FROM sale_items WHERE sale_id = $1', [sale.saleId])
  const s = await stock()
  const r = ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: item.id, quantity: 0.1, currentShiftId: shift.id },
      admin
    )
  )
  assert.equal(r.netRefund, 24)
  assert.equal(await stock(), Math.round((s + 0.1) * 1000) / 1000)
  // Half a gram cannot be returned.
  assert.equal(
    (await svc.call('sales.returnItem', { saleItemId: item.id, quantity: 0.0005 }, admin)).status,
    400
  )
  const after = await one('SELECT returned_qty, total_price FROM sale_items WHERE id = $1', [
    item.id
  ])
  assert.deepEqual([Number(after.returned_qty), Number(after.total_price)], [0.1, 48])
})

test('reports and the reprint keep kilograms; the ledger matches', async (t) => {
  if (!requireDb(t)) return
  const best = ok(await svc.call('reports.bestSellers', { period: 'weekly' }, admin))
  const bram = best.top.find((p) => p.barcode === 'BRAM')
  // 0.25 + 0.1 + 0.3 + 1 + 0.3 − 0.1 returned = 1.85 kg
  assert.equal(Math.round(Number(bram.total_qty_sold) * 1000) / 1000, 1.85)
  const lastSale = (await one('SELECT max(id) AS id FROM sales')).id
  const reprint = ok(await svc.call('sales.reprintData', { saleId: lastSale }, admin))
  assert.deepEqual([reprint.items[0].unit_kind, reprint.items[0].unit_name], ['weight', 'كجم'])
  assert.deepEqual(await verifyLedger(svc.pool), [])
})
