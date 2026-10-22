'use strict'
// Owner notes after phase D (2026-10-21, D-063): a product's barcode can be changed with its whole
// history; the manual invoice discount and the payment method correction need no reason.
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

let db, svc, owner, cashier, shift
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const sell = (body) =>
  svc.call(
    'pos.checkout',
    { clientRef: crypto.randomUUID(), shiftId: shift.id, paymentType: 'نقدي', ...body },
    owner
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES
     ('OLD1', 'صنف بباركود خطأ', 5, 10, 9, 50, 'قطعة'), ('OTHER', 'صنف آخر', 1, 2, 2, 5, 'قطعة')`
  )
  shift = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('changing a barcode keeps the product, its stock and its whole history', async (t) => {
  if (!requireDb(t)) return
  ok(await sell({ items: [{ barcode: 'OLD1', qty: 2 }] }))
  ok(
    await svc.call(
      'damaged.create',
      { barcode: 'OLD1', quantity: 1, reason: 'كسر', currentShiftId: shift.id },
      owner
    )
  )
  const stockBefore = Number(
    (await one("SELECT stock_qty FROM products WHERE barcode = 'OLD1'")).stock_qty
  )
  const counts = async (code) => ({
    lines: Number(
      (await one('SELECT COUNT(*) n FROM sale_items WHERE product_barcode = $1', [code])).n
    ),
    moves: Number(
      (await one('SELECT COUNT(*) n FROM stock_movements WHERE product_barcode = $1', [code])).n
    ),
    damaged: Number(
      (await one('SELECT COUNT(*) n FROM damaged_goods WHERE product_barcode = $1', [code])).n
    )
  })
  const before = await counts('OLD1')
  assert.ok(before.lines === 1 && before.moves >= 2 && before.damaged === 1)

  // Not for a cashier; not to a barcode already used.
  assert.equal(
    (await svc.call('products.changeBarcode', { barcode: 'OLD1', newBarcode: 'NEW1' }, cashier))
      .status,
    403
  )
  assert.equal(
    (await svc.call('products.changeBarcode', { barcode: 'OLD1', newBarcode: 'OTHER' }, owner))
      .status,
    409
  )

  ok(await svc.call('products.changeBarcode', { barcode: 'OLD1', newBarcode: ' NEW1 ' }, owner))
  assert.deepEqual(await counts('NEW1'), before)
  assert.deepEqual(await counts('OLD1'), { lines: 0, moves: 0, damaged: 0 })
  assert.equal(
    Number((await one("SELECT stock_qty FROM products WHERE barcode = 'NEW1'")).stock_qty),
    stockBefore
  )
  // Stock is still the sum of its movements, and the new barcode sells.
  const sum = Number(
    (await one("SELECT SUM(qty) s FROM stock_movements WHERE product_barcode = 'NEW1'")).s
  )
  assert.equal(sum, stockBefore)
  ok(await sell({ items: [{ barcode: 'NEW1', qty: 1 }] }))
  assert.equal(
    ok(await svc.call('pos.resolve', { code: 'OLD1' }, owner)),
    null,
    'the old barcode is gone'
  )
  // Stock movements stay immutable after the change.
  await assert.rejects(
    q("UPDATE stock_movements SET qty = 0 WHERE product_barcode = 'NEW1'"),
    /لا تُعدَّل/
  )
  assert.ok(await one("SELECT 1 FROM system_logs WHERE action_type = 'product_barcode_change'"))
})

test('a manual discount needs no reason', async (t) => {
  if (!requireDb(t)) return
  const sale = ok(
    await sell({ items: [{ barcode: 'NEW1', qty: 1 }], manualDiscount: { amount: 1 } })
  )
  const d = await one(
    "SELECT amount::float8 AS a, reason FROM sale_discounts WHERE sale_id = $1 AND scope = 'manual'",
    [sale.saleId]
  )
  assert.deepEqual([d.a, d.reason], [1, null])
})

test('a payment method correction needs no reason', async (t) => {
  if (!requireDb(t)) return
  const sale = ok(await sell({ items: [{ barcode: 'NEW1', qty: 1 }] }))
  ok(
    await svc.call(
      'sales.changePaymentMethod',
      { saleId: sale.saleId, method: 'visa', clientRef: crypto.randomUUID() },
      owner
    )
  )
  const c = await one('SELECT to_type, reason FROM sale_payment_corrections WHERE sale_id = $1', [
    sale.saleId
  ])
  assert.deepEqual([c.to_type, c.reason], ['فيزا', null])
})

test('a payment method is corrected after the shift closed: reclassified, no money moves, the saved close stays', async (t) => {
  if (!requireDb(t)) return
  const s2 = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier))
  const sale = ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: s2.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'NEW1', qty: 1 }]
      },
      cashier
    )
  )
  ok(
    await svc.call(
      'shifts.close',
      { shiftId: s2.id, actualCash: 10, clientRef: crypto.randomUUID() },
      cashier
    )
  )
  const saved = (await one('SELECT report FROM shift_closings WHERE shift_id = $1', [s2.id])).report
  const treasury = await q('SELECT * FROM treasury_ledger ORDER BY id')
  // Not for a cashier; for the owner, without a reason.
  const change = { saleId: sale.saleId, method: 'visa', clientRef: crypto.randomUUID() }
  assert.equal((await svc.call('sales.changePaymentMethod', change, cashier)).status, 403)
  ok(await svc.call('sales.changePaymentMethod', change, owner))
  const c = await one(
    'SELECT to_type, after_close, reason FROM sale_payment_corrections WHERE sale_id = $1',
    [sale.saleId]
  )
  assert.deepEqual([c.to_type, c.after_close, c.reason], ['فيزا', true, null])
  assert.equal(
    (await one('SELECT payment_type FROM sales WHERE id = $1', [sale.saleId])).payment_type,
    'فيزا'
  )
  // No money moved; the shift's saved close is exactly as confirmed; the correction is listed.
  assert.deepEqual(await q('SELECT * FROM treasury_ledger ORDER BY id'), treasury)
  assert.deepEqual(
    (await one('SELECT report FROM shift_closings WHERE shift_id = $1', [s2.id])).report,
    saved
  )
  const details = ok(await svc.call('shifts.details', { shiftId: s2.id }, owner))
  assert.deepEqual(details.report, saved)
  assert.equal(details.corrections.length, 1)
  assert.equal(details.corrections[0].after_close, true)
})
