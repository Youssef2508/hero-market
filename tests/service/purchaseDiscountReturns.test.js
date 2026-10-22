'use strict'
// SUP-02 invoice discount and purchase returns (owner, 2026-10-22, D-066), with exact balances.
// Discount: invoice-level only; the lines keep their prices, so product costs and the owner's
// prices never move; the payable, payments and reports use the net; profit counts it as a gain.
// Returns: partial, never more than bought, stock out at the line's cost, the supplier credited
// line value × net ÷ gross, money recorded only when received, once per request.
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

let db, svc, owner, shift, supplierId, boxId
const ref = () => crypto.randomUUID()
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const r2 = (n) => Math.round(Number(n) * 100) / 100
const debt = async () =>
  r2((await one('SELECT debt_balance FROM suppliers WHERE id = $1', [supplierId])).debt_balance)
const product = async (b) =>
  one(
    `SELECT stock_qty::float8 s, cost_price::float8 c, retail_price::float8 r, wholesale_price::float8 w
       FROM products WHERE barcode = $1`,
    [b]
  )
const today = () => new Date().toLocaleDateString('en-CA')
const dash = async () =>
  ok(await svc.call('reports.dashboard', { from: today(), to: today() }, owner)).totals
const buy = (body) =>
  svc.call(
    'suppliers.addPurchase',
    { supplierId, payment_type: 'آجل', paid_amount: 0, currentShiftId: shift.id, ...body },
    owner
  )
const lastPurchase = async () =>
  one(
    'SELECT id, total_amount::float8 t, gross_amount::float8 g, discount::float8 d FROM supplier_purchases ORDER BY id DESC LIMIT 1'
  )
const itemsOf = async (purchaseId) =>
  q('SELECT id, qty::float8 q FROM supplier_purchase_items WHERE purchase_id = $1 ORDER BY id', [
    purchaseId
  ])
const giveBack = (purchaseId, items, extra = {}) =>
  svc.call(
    'suppliers.returnPurchase',
    { purchaseId, items, clientRef: ref(), currentShiftId: shift.id, ...extra },
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
     ('D1', 'صنف الخصم', 0, 10, 9, 0, 'قطعة'), ('R1', 'صنف المرتجع', 0, 12, 11, 0, 'قطعة'),
     ('A1', 'صنف المتوسط', 0, 9, 8, 0, 'قطعة')`
  )
  ok(
    await svc.call(
      'productUnits.save',
      {
        barcode: 'R1',
        units: [{ name: 'كرتونة', factor: 10, retail_price: 115, purchase_cost: 80 }]
      },
      owner
    )
  )
  boxId = ok(await svc.call('productUnits.get', { barcode: 'R1' }, owner)).units[0].id
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الخصم' }, owner)).id
  shift = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('no discount: the invoice and the payable are the lines’ value, as before', async (t) => {
  if (!requireDb(t)) return
  ok(await buy({ total_amount: 60, items: [{ barcode: 'D1', qty: 10, unitCost: 6 }] }))
  const p = await lastPurchase()
  assert.deepEqual([p.t, p.g, p.d], [60, 60, 0])
  assert.equal(await debt(), 60)
})

test('a discount lowers the invoice and the payable; product prices and costs do not move', async (t) => {
  if (!requireDb(t)) return
  const unitBefore = await one(
    'SELECT purchase_cost::float8 c, retail_price::float8 r FROM product_units WHERE id = $1',
    [boxId]
  )
  const d0 = await dash()
  const before = await debt()
  ok(
    await buy({
      total_amount: 54,
      discount: 6,
      items: [{ barcode: 'D1', qty: 10, unitCost: 6 }]
    })
  )
  const p = await lastPurchase()
  assert.deepEqual([p.t, p.g, p.d], [54, 60, 6])
  assert.equal(await debt(), r2(before + 54), 'owed the net, once')
  const ledger = await q(
    "SELECT amount::float8 a FROM supplier_ledger WHERE supplier_id = $1 AND type = 'purchase' ORDER BY id DESC LIMIT 1",
    [supplierId]
  )
  assert.deepEqual(ledger, [{ a: 54 }])
  // The moving average follows the lines (6), never the discount; the owner's prices are untouched.
  assert.deepEqual(await product('D1'), { s: 20, c: 6, r: 10, w: 9 })
  assert.deepEqual(
    await one(
      'SELECT purchase_cost::float8 c, retail_price::float8 r FROM product_units WHERE id = $1',
      [boxId]
    ),
    unitBefore
  )
  // Reports: purchases at the net, the discount a separate gain counted once in net profit.
  const d1 = await dash()
  assert.equal(r2(d1.purchases - d0.purchases), 54)
  assert.equal(r2(d1.purchaseDiscounts - d0.purchaseDiscounts), 6)
  assert.equal(r2(d1.netProfit - d0.netProfit), 6)
})

test('paid at once with a discount: the shift pays the net, nothing is left owed', async (t) => {
  if (!requireDb(t)) return
  const before = await debt()
  ok(
    await buy({
      total_amount: 90,
      discount: 10,
      paid_amount: 90,
      payment_type: 'نقدي',
      items: [{ barcode: 'D1', qty: 20, unitCost: 5 }]
    })
  )
  assert.equal(await debt(), before)
  const paid = await q(
    "SELECT amount::float8 a FROM safe_ledger WHERE kind = 'supplier_payment' ORDER BY id DESC LIMIT 1"
  )
  assert.deepEqual(paid, [{ a: 90 }])
})

test('a discount that does not match the lines, or paying more than the net, is refused', async (t) => {
  if (!requireDb(t)) return
  const n = (await q('SELECT 1 FROM supplier_purchases')).length
  assert.equal(
    (await buy({ total_amount: 60, discount: 6, items: [{ barcode: 'D1', qty: 10, unitCost: 6 }] }))
      .status,
    400
  )
  assert.equal(
    (
      await buy({
        total_amount: 54,
        discount: 6,
        paid_amount: 60,
        payment_type: 'نقدي',
        items: [{ barcode: 'D1', qty: 10, unitCost: 6 }]
      })
    ).status,
    400
  )
  assert.equal((await q('SELECT 1 FROM supplier_purchases')).length, n, 'nothing written')
})

test('a preliminary invoice completed with a discount: the net is the final total', async (t) => {
  if (!requireDb(t)) return
  const inv = ok(
    await svc.call(
      'supplierInvoices.createPending',
      { supplierId, total: 50, paymentMode: 'credit', clientRef: ref() },
      owner
    )
  ).invoice
  const before = await debt()
  assert.equal(
    (
      await svc.call(
        'supplierInvoices.convert',
        {
          invoiceId: inv.id,
          discount: 70,
          items: [{ barcode: 'D1', qty: 10, unitCost: 6 }],
          clientRef: ref()
        },
        owner
      )
    ).status,
    400,
    'a discount above the lines'
  )
  const r = ok(
    await svc.call(
      'supplierInvoices.convert',
      {
        invoiceId: inv.id,
        discount: 10,
        items: [{ barcode: 'D1', qty: 10, unitCost: 6 }],
        clientRef: ref()
      },
      owner
    )
  )
  assert.equal(r.difference, 0, '60 − 10 = the 50 already owed')
  assert.equal(await debt(), before)
  const p = await lastPurchase()
  assert.deepEqual([p.t, p.g, p.d], [50, 60, 10])
})

test('a partial return in boxes: stock out at its cost, payable down, twice the same request = once', async (t) => {
  if (!requireDb(t)) return
  ok(
    await buy({
      total_amount: 800,
      items: [{ barcode: 'R1', unitId: boxId, qty: 10, unitCost: 80 }]
    })
  )
  const pid = (await lastPurchase()).id
  const [item] = await itemsOf(pid)
  assert.deepEqual(await product('R1'), { s: 100, c: 8, r: 12, w: 11 })
  const before = await debt()
  const cRef = ref()
  const first = ok(await giveBack(pid, [{ purchaseItemId: item.id, qty: 3 }], { clientRef: cRef }))
  assert.deepEqual([first.grossValue, first.credit, first.refund], [240, 240, 0])
  assert.equal((await product('R1')).s, 70, '3 boxes = 30 pieces')
  assert.equal((await product('R1')).c, 8, 'returned at the cost it was bought at')
  assert.equal(await debt(), r2(before - 240))
  // The same request again: the first result, nothing moves twice.
  assert.equal(
    ok(await giveBack(pid, [{ purchaseItemId: item.id, qty: 3 }], { clientRef: cRef })).duplicate,
    true
  )
  assert.equal((await product('R1')).s, 70)
  assert.equal(await debt(), r2(before - 240))
  assert.equal((await q("SELECT 1 FROM stock_movements WHERE kind = 'purchase_return'")).length, 1)
  // Never more than bought: 7 boxes left.
  const over = await giveBack(pid, [{ purchaseItemId: item.id, qty: 8 }])
  assert.equal(over.status, 409)
  ok(await giveBack(pid, [{ purchaseItemId: item.id, qty: 7 }]))
  assert.equal((await product('R1')).s, 0)
  assert.equal((await giveBack(pid, [{ purchaseItemId: item.id, qty: 1 }])).status, 409)
  const detail = ok(await svc.call('suppliers.purchaseDetail', { purchaseId: pid }, owner))
  assert.equal(detail.items[0].returned, 10)
  assert.equal(detail.returns.length, 2)
})

test('the moving average falls back by exactly what left at its cost', async (t) => {
  if (!requireDb(t)) return
  ok(await buy({ total_amount: 50, items: [{ barcode: 'A1', qty: 10, unitCost: 5 }] }))
  ok(await buy({ total_amount: 70, items: [{ barcode: 'A1', qty: 10, unitCost: 7 }] }))
  assert.equal((await product('A1')).c, 6)
  const pid = (await lastPurchase()).id
  const [item] = await itemsOf(pid)
  ok(await giveBack(pid, [{ purchaseItemId: item.id, qty: 5 }]))
  const a = await product('A1')
  // (20 × 6 − 5 × 7) ÷ 15 = 5.6667: the stock is worth 120 − 35 = 85.
  assert.deepEqual([a.s, a.c], [15, 5.6667])
})

test('a return from a discounted invoice credits the net share and gives back that part of the gain', async (t) => {
  if (!requireDb(t)) return
  ok(
    await buy({
      total_amount: 90,
      discount: 10,
      items: [
        { barcode: 'D1', qty: 5, unitCost: 10 },
        { barcode: 'A1', qty: 5, unitCost: 10 }
      ]
    })
  )
  const pid = (await lastPurchase()).id
  const [lineD] = await itemsOf(pid)
  const d0 = await dash()
  const before = await debt()
  const r = ok(await giveBack(pid, [{ purchaseItemId: lineD.id, qty: 5 }]))
  assert.deepEqual([r.grossValue, r.credit], [50, 45], '50 of goods × 90 ÷ 100')
  assert.equal(await debt(), r2(before - 45))
  const d1 = await dash()
  assert.equal(r2(d1.purchaseDiscounts - d0.purchaseDiscounts), -5)
  assert.equal(r2(d1.purchaseReturns - d0.purchaseReturns), 45)
})

test('money given back: recorded once by its method where it arrives; the rest stays owed', async (t) => {
  if (!requireDb(t)) return
  ok(await buy({ total_amount: 100, items: [{ barcode: 'D1', qty: 10, unitCost: 10 }] }))
  const pid = (await lastPurchase()).id
  const [item] = await itemsOf(pid)
  const before = await debt()
  // More than the credit is refused, and nothing is written.
  assert.equal(
    (
      await giveBack(pid, [{ purchaseItemId: item.id, qty: 4 }], {
        refundAmount: 50,
        method: 'cash',
        destination: 'shift'
      })
    ).status,
    400
  )
  assert.equal(await debt(), before)
  // 4 back (40): the supplier hands 25 in InstaPay now; 15 stays owed by the supplier.
  const r = ok(
    await giveBack(pid, [{ purchaseItemId: item.id, qty: 4 }], {
      refundAmount: 25,
      method: 'instapay',
      destination: 'shift'
    })
  )
  assert.deepEqual([r.credit, r.refund], [40, 25])
  assert.equal(await debt(), r2(before - 40 + 25))
  const money = await q(
    "SELECT method, amount::float8 a, type FROM safe_ledger WHERE kind = 'supplier_refund'"
  )
  assert.deepEqual(money, [{ method: 'instapay', a: 25, type: 'inflow' }])
  // Into the treasury, by Visa.
  const t0 = Number(
    (
      await one(
        "SELECT COALESCE(SUM(amount), 0) s FROM treasury_ledger WHERE method = 'visa' AND kind = 'supplier_refund'"
      )
    ).s
  )
  ok(
    await giveBack(pid, [{ purchaseItemId: item.id, qty: 2 }], {
      refundAmount: 20,
      method: 'visa',
      destination: 'treasury'
    })
  )
  const t1 = Number(
    (
      await one(
        "SELECT COALESCE(SUM(amount), 0) s FROM treasury_ledger WHERE method = 'visa' AND kind = 'supplier_refund'"
      )
    ).s
  )
  assert.equal(r2(t1 - t0), 20)
})

test('goods already sold cannot go back: refused, and nothing is written', async (t) => {
  if (!requireDb(t)) return
  ok(await buy({ total_amount: 30, items: [{ barcode: 'A1', qty: 3, unitCost: 10 }] }))
  const pid = (await lastPurchase()).id
  const [item] = await itemsOf(pid)
  const stockNow = (await product('A1')).s
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: ref(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'A1', qty: stockNow }]
      },
      owner
    )
  )
  const before = await debt()
  const n = (await q('SELECT 1 FROM supplier_purchase_returns')).length
  const r = await giveBack(pid, [{ purchaseItemId: item.id, qty: 3 }])
  assert.equal(r.status, 409)
  assert.equal(await debt(), before)
  assert.equal((await q('SELECT 1 FROM supplier_purchase_returns')).length, n)
  assert.equal((await product('A1')).s, 0)
})
