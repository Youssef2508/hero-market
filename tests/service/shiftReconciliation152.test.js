'use strict'
// A realistic shift (1.5.2 release gate): cash, card, credit and partial sales; customer
// collections in cash and InstaPay; an item return and a whole-invoice return; an expense; a
// supplier purchase paid from the drawer at the latest purchase price; supplier debt-payment
// requests approved, pending and rejected-then-returned; and operations that fail and must leave
// no trace. Every figure is worked out by hand below and checked against the drawer, the
// treasury, the supplier and customer balances, stock, cost and the saved closing report.
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

let db, svc, owner, cashier, shift, supplierId, clientId
const ref = () => crypto.randomUUID()
const one = async (sql, p) => (await svc.pool.query(sql, p)).rows[0]
const ok = (r, what = '') => {
  assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`)
  return r.body
}
const r2 = (n) => Math.round(Number(n) * 100) / 100
const sell = (body) =>
  svc.call('pos.checkout', { clientRef: ref(), shiftId: shift.id, ...body }, cashier)

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'store_admin' })
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES
     ('RICE', 'أرز', 20, 30, 28, 100, 'كيلو'), ('OIL', 'زيت', 50, 70, 65, 100, 'قطعة')`
  )
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الوردية' }, owner)).id
  ok(
    await svc.call(
      'suppliers.addPurchase',
      { supplierId, total_amount: 1000, paid_amount: 0, payment_type: 'آجل' },
      owner
    )
  )
  clientId = ok(await svc.call('clients.create', { name: 'عميل الوردية' }, owner)).id
  ok(await svc.call('treasury.record', { kind: 'deposit', amount: 2000, clientRef: ref() }, owner))
  shift = ok(await svc.call('shifts.open', { startingCash: 500 }, cashier))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a mixed shift reconciles to the piastre everywhere', async (t) => {
  if (!requireDb(t)) return
  const tre0 = r2((await one('SELECT SUM(amount) s FROM treasury_ledger')).s)
  // ── Sales ───────────────────────────────────────────────────
  // 1. Cash: 2 rice (60) + 1 oil (70) = 130.
  const cash = ok(
    await sell({
      paymentType: 'نقدي',
      items: [
        { barcode: 'RICE', qty: 2 },
        { barcode: 'OIL', qty: 1 }
      ]
    })
  )
  // 2. Card: 1 oil = 70.
  ok(await sell({ paymentType: 'فيزا', items: [{ barcode: 'OIL', qty: 1 }] }))
  // 3. Credit: 3 rice = 90 to the customer.
  ok(
    await sell({
      paymentType: 'آجل',
      client: { id: clientId, name: 'عميل الوردية' },
      items: [{ barcode: 'RICE', qty: 3 }]
    })
  )
  // 4. Partial: 2 oil = 140, 40 now in cash, 100 owed.
  ok(
    await sell({
      paymentType: 'دفع جزئي',
      paidAmount: 40,
      client: { id: clientId, name: 'عميل الوردية' },
      items: [{ barcode: 'OIL', qty: 2 }]
    })
  )
  // ── Collections: 50 cash, 30 InstaPay (the customer now owes 190 − 80 = 110).
  ok(
    await svc.call(
      'clients.repay',
      { clientId, amount: 50, currentShiftId: shift.id, destination: 'shift', clientRef: ref() },
      cashier
    )
  )
  ok(
    await svc.call(
      'clients.repay',
      {
        clientId,
        amount: 30,
        currentShiftId: shift.id,
        destination: 'shift',
        method: 'instapay',
        clientRef: ref()
      },
      cashier
    )
  )
  // ── Returns: one rice of the cash sale (30 back in cash) ─────────
  const riceLine = await one(
    "SELECT id FROM sale_items WHERE sale_id = $1 AND product_barcode = 'RICE'",
    [cash.saleId]
  )
  ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: riceLine.id, quantity: 1, currentShiftId: shift.id },
      cashier
    )
  )
  // ── An expense: 25 cash.
  ok(
    await svc.call(
      'expenses.create',
      {
        amount: 25,
        category: 'نظافة',
        currentShiftId: shift.id,
        destination: 'shift',
        clientRef: ref()
      },
      cashier
    )
  )
  // ── A purchase paid from the drawer: 10 rice at 22 = 220, 100 paid now, 120 owed.
  const purchase = ok(
    await svc.call(
      'suppliers.addPurchase',
      {
        supplierId,
        total_amount: 220,
        paid_amount: 100,
        payment_type: 'دفع جزئي',
        currentShiftId: shift.id,
        clientRef: ref(),
        items: [{ barcode: 'RICE', qty: 10, unitCost: 22, newRetailPrice: 32 }]
      },
      cashier
    )
  )
  // ── Supplier debt-payment requests: 200 approved, 75 pending, 60 rejected then returned.
  const req = async (amount) =>
    ok(
      await svc.call(
        'supplierPayments.create',
        { supplierId, amount, currentShiftId: shift.id, clientRef: ref() },
        cashier
      )
    ).request
  const a = await req(200)
  await req(75)
  const c = await req(60)
  ok(await svc.call('supplierPayments.approve', { requestId: a.id }, owner))
  ok(await svc.call('supplierPayments.reject', { requestId: c.id, note: 'بدون إيصال' }, owner))
  ok(
    await svc.call(
      'supplierPayments.settle',
      { requestId: c.id, outcome: 'returned', note: 'أعادها للمالك', destination: 'treasury' },
      owner
    )
  )
  // ── Failures that must leave nothing behind ──────────────────
  const failures = [
    // A purchase whose lines do not match its total.
    await svc.call(
      'suppliers.addPurchase',
      {
        supplierId,
        total_amount: 999,
        paid_amount: 50,
        currentShiftId: shift.id,
        items: [{ barcode: 'RICE', qty: 1, unitCost: 22 }]
      },
      cashier
    ),
    // A request above what is owed after pending ones.
    await svc.call(
      'supplierPayments.create',
      { supplierId, amount: 5000, currentShiftId: shift.id, clientRef: ref() },
      cashier
    ),
    // A sale of an unknown product.
    await sell({ paymentType: 'نقدي', items: [{ barcode: 'NOPE', qty: 1 }] }),
    // Returning more than was sold.
    await svc.call(
      'sales.returnItem',
      { saleItemId: riceLine.id, quantity: 5, currentShiftId: shift.id },
      cashier
    )
  ]
  for (const f of failures) assert.notEqual(f.status, 200, JSON.stringify(f.body))
  // A retried sale (same request id) is recorded once.
  const again = ref()
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: again,
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'OIL', qty: 1 }]
      },
      cashier
    )
  )
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: again,
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'OIL', qty: 1 }]
      },
      cashier
    )
  )
  // That is one more cash sale of 70 (sold at the oil's price, 70).

  // ── Expected, worked out by hand ─────────────────────────────
  // Cash: 500 opening + cash sales as sold (130 + 70) + 40 upfront + 50 collection − 30 refund
  //       (the drawer counts a sale as sold and its refund as an outflow, K-40) − 25 expense
  //       − 100 purchase − (200 + 75 + 60) requests.
  const cashSales = 130 + 70 // as sold
  const expectedCash = r2(500 + cashSales + 40 + 50 - 30 - 25 - 100 - 335)
  const live = ok(await svc.call('shifts.details', { shiftId: shift.id }, owner)).report
  assert.equal(live.expected.cash, expectedCash, JSON.stringify(live.cash))
  assert.equal(live.expected.visa, 70)
  assert.equal(live.expected.instapay, 30)
  assert.equal(live.collections, 80, 'collections are their own figure')
  assert.equal(live.events.collections.total, 80)
  assert.equal(live.supplierPayments.withInvoices, 100)
  assert.equal(live.supplierPayments.requests, 335)
  assert.equal(live.events.supplierPayments.total, 435)
  assert.deepEqual(
    [
      live.supplierRequests.approved.total,
      live.supplierRequests.pending.total,
      live.supplierRequests.settled.total
    ],
    [200, 75, 60]
  )
  assert.equal(live.expenses.total, 25)
  assert.equal(live.returns.total, 30)
  // Sales as sold (K-40): 130 + 70 + 90 + 140 + 70 = 500; the 30 returned is its own outflow
  // (returns above), never netted twice.
  assert.equal(live.totalSales, 500)
  assert.equal(r2(live.totalSales - live.returns.total), 470)
  // ── Balances ────────────────────────────────────────────────
  // Supplier: 1000 + 120 (purchase remainder) − 200 (approved) = 920; the pending 75 and the
  // returned 60 do not change it.
  assert.equal(
    r2((await one('SELECT debt_balance d FROM suppliers WHERE id = $1', [supplierId])).d),
    920
  )
  // Customer: 90 + 100 − 80 = 110.
  assert.equal(
    r2((await one('SELECT debt_balance d FROM clients WHERE id = $1', [clientId])).d),
    110
  )
  // Treasury: + 60 returned by the supplier; nothing else of this shift until its close.
  assert.equal(r2((await one('SELECT SUM(amount) s FROM treasury_ledger')).s), r2(tre0 + 60))
  // Stock and cost: rice 100 − 2 + 1 − 3 + 10 = 106 at the latest purchase price 22; oil
  // 100 − 1 − 1 − 2 − 1 = 95.
  const rice = await one(
    "SELECT stock_qty::float8 s, cost_price::float8 c, retail_price::float8 r FROM products WHERE barcode = 'RICE'"
  )
  assert.deepEqual([rice.s, rice.c, rice.r], [106, 22, 32])
  assert.equal((await one("SELECT stock_qty::float8 s FROM products WHERE barcode = 'OIL'")).s, 95)
  // The ledger explains stock exactly.
  const drift = await one(
    `SELECT count(*)::int n FROM products p LEFT JOIN (SELECT product_barcode, SUM(qty) s FROM stock_movements GROUP BY 1) m
       ON m.product_barcode = p.barcode WHERE COALESCE(p.stock_qty, 0) <> COALESCE(m.s, 0)`
  )
  assert.equal(drift.n, 0)
  // ── Close with the exact counts: no variance; the saved report is the same.
  ok(
    await svc.call(
      'shifts.close',
      {
        shiftId: shift.id,
        actualCash: expectedCash,
        actual: { visa: 70, instapay: 30 },
        clientRef: ref()
      },
      cashier
    )
  )
  const saved = (await one('SELECT report FROM shift_closings WHERE shift_id = $1', [shift.id]))
    .report
  const rep = typeof saved === 'string' ? JSON.parse(saved) : saved
  assert.equal(rep.varianceTotal, 0)
  assert.equal(rep.expected.cash, expectedCash)
  assert.equal(rep.events.supplierPayments.count, 4)
  // At close the counted money goes to the treasury.
  assert.equal(
    r2((await one('SELECT SUM(amount) s FROM treasury_ledger')).s),
    r2(tre0 + 60 + expectedCash + 70 + 30)
  )
  // The purchase is recorded once with its source.
  assert.deepEqual(
    await one('SELECT paid_from, shift_id FROM supplier_purchases WHERE id = $1', [
      purchase.purchaseId
    ]),
    { paid_from: 'shift', shift_id: shift.id }
  )
})
