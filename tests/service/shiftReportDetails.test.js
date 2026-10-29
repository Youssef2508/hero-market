'use strict'
// Everything a shift's report itemizes (owner's review, 1.5.2, D-098), checked against the source
// records: expenses, customer returns (partial and full, with what was returned), credit and
// partial sales with what each customer owes (named or not), supplier invoices – final and
// preliminary – by payment status (a credit invoice keeps its real total and shows 0 paid),
// purchase returns with money back, supplier debt payments, the shift's treasury entries; each
// list adds up to its figure, nothing is counted twice, and the printed close lists every line.
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
const sum = (xs, k) => r2(xs.reduce((a, x) => a + Number(x[k]), 0))
const sell = async (body) =>
  ok(await svc.call('pos.checkout', { clientRef: ref(), shiftId: shift.id, ...body }, cashier))

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
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES
     ('TEA', 'شاي', 30, 40, 100, 'علبة'), ('SUG', 'سكر', 20, 25, 100, 'كيلو')`
  )
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد التفاصيل' }, owner)).id
  clientId = ok(await svc.call('clients.create', { name: 'سعاد', phone: '01055550000' }, owner)).id
  shift = ok(await svc.call('shifts.open', { startingCash: 2000 }, cashier))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('every event of the shift is itemized, reconciled and printed', async (t) => {
  if (!requireDb(t)) return
  // ── Sales ─────────────────────────────────────────────────────
  const cash1 = await sell({
    paymentType: 'نقدي',
    items: [
      { barcode: 'TEA', qty: 2 },
      { barcode: 'SUG', qty: 4 }
    ]
  }) // 80 + 100 = 180
  const cash2 = await sell({ paymentType: 'نقدي', items: [{ barcode: 'TEA', qty: 1 }] }) // 40
  const credit = await sell({
    paymentType: 'آجل',
    client: { id: clientId, name: 'سعاد' },
    items: [{ barcode: 'SUG', qty: 2 }]
  }) // 50 owed
  const partial = await sell({
    paymentType: 'دفع جزئي',
    paidAmount: 30,
    client: { id: clientId, name: 'سعاد' },
    items: [{ barcode: 'TEA', qty: 3 }]
  }) // 120, 30 now, 90 owed
  // ── Returns: part of cash1 (1 sugar), and the whole of cash2 ──
  const sugLine = await one(
    "SELECT id FROM sale_items WHERE sale_id = $1 AND product_barcode = 'SUG'",
    [cash1.saleId]
  )
  ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: sugLine.id, quantity: 1, currentShiftId: shift.id },
      cashier
    )
  )
  ok(
    await svc.call(
      'sales.returnEntire',
      { saleId: cash2.saleId, currentShiftId: shift.id },
      cashier
    )
  )
  // ── An expense ───────────────────────────────────────────────
  ok(
    await svc.call(
      'expenses.create',
      {
        amount: 15,
        category: 'بوفيه',
        description: 'شاي للعمال',
        currentShiftId: shift.id,
        destination: 'shift',
        clientRef: ref()
      },
      cashier
    )
  )
  // ── Supplier invoices: credit, paid in full, partial (final, with lines) ──
  const buy = async (paid, qty) =>
    ok(
      await svc.call(
        'suppliers.addPurchase',
        {
          supplierId,
          invoice_ref: `S-${paid}`,
          total_amount: qty * 30,
          paid_amount: paid,
          payment_type: paid === 0 ? 'آجل' : 'نقدي',
          currentShiftId: shift.id,
          clientRef: ref(),
          items: [{ barcode: 'TEA', qty, unitCost: 30 }]
        },
        cashier
      )
    )
  const p0 = await buy(0, 10) // 300, nothing paid
  await buy(60, 2) // 60, all paid
  await buy(100, 5) // 150, 100 paid
  // ── Preliminary invoices: credit, cash, partial ──
  const pend = (body) =>
    svc.call(
      'supplierInvoices.createPending',
      { supplierId, currentShiftId: shift.id, clientRef: ref(), destination: 'shift', ...body },
      cashier
    )
  ok(await pend({ total: 400, paymentMode: 'credit' }))
  ok(await pend({ total: 70, paymentMode: 'cash' }))
  ok(await pend({ total: 200, paymentMode: 'partial', paid: 50 }))
  // ── A purchase return of 2 teas from the credit invoice, 60 given back now ──
  const [line] = (
    await svc.pool.query('SELECT id FROM supplier_purchase_items WHERE purchase_id = $1', [
      p0.purchaseId
    ])
  ).rows
  ok(
    await svc.call(
      'suppliers.returnPurchase',
      {
        purchaseId: p0.purchaseId,
        items: [{ purchaseItemId: line.id, qty: 2 }],
        refundAmount: 60,
        method: 'cash',
        destination: 'shift',
        currentShiftId: shift.id,
        clientRef: ref()
      },
      cashier
    )
  )
  // ── A supplier debt-payment request, approved ──
  const req = ok(
    await svc.call(
      'supplierPayments.create',
      { supplierId, amount: 40, currentShiftId: shift.id, clientRef: ref() },
      cashier
    )
  ).request
  ok(await svc.call('supplierPayments.approve', { requestId: req.id }, owner))

  const rep = ok(await svc.call('shifts.details', { shiftId: shift.id }, owner)).report

  // A. Expenses: the lines make the total.
  assert.equal(rep.expenses.count, 1)
  assert.equal(sum(rep.expenses.lines, 'amount'), rep.expenses.total)
  assert.deepEqual(
    [
      rep.expenses.lines[0].category,
      rep.expenses.lines[0].description,
      rep.expenses.lines[0].username
    ],
    ['بوفيه', 'شاي للعمال', 'cashier']
  )

  // B. Returns: the partial names its product and quantity, the full one its invoice's lines.
  const [part, full] = rep.returns.lines
  assert.deepEqual(
    [part.saleId, part.kind, part.items, part.refund],
    [cash1.saleId, 'partial', [{ name: 'سكر', qty: 1, unit: 'كيلو' }], 25]
  )
  assert.deepEqual(
    [full.saleId, full.kind, full.kindLabel, full.items.map((i) => [i.name, i.qty]), full.refund],
    [cash2.saleId, 'full', 'مرتجع الفاتورة كاملة', [['شاي', 1]], 40]
  )
  assert.match(part.customer, /عميل بدون اسم – فاتورة #/)
  assert.equal(sum(rep.returns.lines, 'refund'), rep.returns.total)

  // C. Credit and partial sales, each with what the customer still owes; not sales twice.
  assert.deepEqual(
    rep.creditSales.lines.map((l) => [
      l.saleId,
      l.customer.startsWith('سعاد'),
      l.total,
      l.paidNow,
      l.unpaid
    ]),
    [[credit.saleId, true, 50, 0, 50]]
  )
  assert.deepEqual(
    rep.partialSales.lines.map((l) => [l.saleId, l.total, l.paidNow, l.unpaid]),
    [[partial.saleId, 120, 30, 90]]
  )
  assert.equal(sum(rep.creditSales.lines, 'total'), rep.creditSales.total)
  assert.equal(sum(rep.partialSales.lines, 'paidNow'), rep.partialSales.paidNow)
  assert.equal(
    r2((await one('SELECT debt_balance d FROM clients WHERE id = $1', [clientId])).d),
    r2(sum(rep.creditSales.lines, 'unpaid') + sum(rep.partialSales.lines, 'unpaid')),
    'the customer owes exactly the unpaid amounts listed'
  )

  // D. Supplier invoices: the credit one keeps its real total and shows 0 paid.
  const byRef = Object.fromEntries(rep.supplierInvoices.purchases.lines.map((p) => [p.ref, p]))
  assert.deepEqual(
    [byRef['S-0'].total, byRef['S-0'].paid, byRef['S-0'].remaining, byRef['S-0'].status],
    [300, 0, 300, 'آجل (لم يُدفع شيء)']
  )
  assert.deepEqual(
    [byRef['S-60'].total, byRef['S-60'].paid, byRef['S-60'].status],
    [60, 60, 'مدفوعة بالكامل']
  )
  assert.deepEqual(
    [byRef['S-100'].total, byRef['S-100'].paid, byRef['S-100'].remaining, byRef['S-100'].status],
    [150, 100, 50, 'دفع جزئي']
  )
  const pre = rep.supplierInvoices.preliminary
  assert.deepEqual(
    pre.lines.map((p) => [p.total, p.paid, p.remaining, p.status, p.stateLabel]),
    [
      [400, 0, 400, 'آجل (لم يُدفع شيء)', 'بانتظار الأصناف'],
      [70, 70, 0, 'مدفوعة بالكامل', 'بانتظار الأصناف'],
      [200, 50, 150, 'دفع جزئي', 'بانتظار الأصناف']
    ]
  )
  // What was paid now from the drawer equals the supplier payments of the shift, once each.
  assert.equal(
    r2(rep.supplierInvoices.purchases.paid + pre.paid),
    rep.supplierPayments.withInvoices,
    'invoice payments: 60 + 100 + 70 + 50'
  )

  // E. The debt payment: one line, approved.
  const reqLine = rep.events.supplierPayments.lines.find(
    (l) => l.kind === 'supplier_payment_request'
  )
  assert.deepEqual(
    [reqLine.amount, reqLine.requestStatusLabel, reqLine.refId],
    [40, 'معتمد', req.id]
  )

  // F. The purchase return with money back: listed, and the same 60 as the supplier refunds.
  assert.deepEqual(
    rep.purchaseReturns.lines.map((r) => [
      r.supplier,
      r.refund,
      r.items.map((i) => [i.name, i.qty])
    ]),
    [['مورد التفاصيل', 60, [['شاي', 2]]]]
  )
  assert.equal(rep.purchaseReturns.refund, rep.supplierRefunds)

  // The drawer: 2000 + cash sales as sold (180 + 40) + 30 upfront + 60 supplier refund
  //   − returns (25 + 40) − expense 15 − invoice payments (60 + 100 + 70 + 50) − request 40.
  const expected = r2(2000 + 220 + 30 + 60 - 65 - 15 - 280 - 40)
  assert.equal(rep.expected.cash, expected)
  // Nothing listed twice: each money movement appears in exactly one place.
  const moves = (
    await svc.pool.query('SELECT count(*)::int n FROM safe_ledger WHERE shift_id = $1', [shift.id])
  ).rows[0].n
  const listed =
    rep.events.collections.count +
    rep.events.supplierPayments.count +
    rep.events.supplierRefunds.count +
    rep.events.other.count +
    rep.expenses.count +
    rep.returns.lines.filter((x) => x.paidBack > 0).length +
    rep.partialSales.lines.filter((x) => x.paidNow > 0).length
  assert.equal(listed, moves, 'every drawer movement is listed once')

  // Close: the treasury entry of the shift is listed; the printed close shows every line.
  ok(
    await svc.call(
      'shifts.close',
      { shiftId: shift.id, actualCash: expected, clientRef: ref() },
      cashier
    )
  )
  const saved = (await one('SELECT report FROM shift_closings WHERE shift_id = $1', [shift.id]))
    .report
  const report = typeof saved === 'string' ? JSON.parse(saved) : saved
  const { buildCloseReportLines } = await import('../../src/shared/reportLines.mjs')
  const printed = buildCloseReportLines(report, { store: { name: 'Hero Market' } }).join('\n')
  for (const needle of [
    'المصروفات',
    'بوفيه – شاي للعمال',
    'مرتجعات العملاء',
    'مرتجع جزئي',
    'مرتجع الفاتورة كاملة',
    'سكر × 1 كيلو',
    'مبيعات آجل (على حساب العميل)',
    'المتبقي على العميل 90.00 ج.م',
    'فواتير شراء من الموردين',
    'S-0',
    'آجل (لم يُدفع شيء) · مدفوع 0.00 ج.م · متبقي 300.00 ج.م',
    'فواتير موردين مبدئية',
    'مرتجعات للموردين',
    'شاي × 2',
    'مدفوعات الموردين'
  ])
    assert.ok(printed.includes(needle), `printed: ${needle}`)
  // The credit invoice's printed line carries its total, never 0.
  assert.match(printed, /S-0 مورد التفاصيل\|300\.00 ج\.م/)
  // Every return, sale and invoice line is printed (none left out).
  const count = (re) => (printed.match(re) || []).length
  assert.equal(count(/^فاتورة #\d+ (?!مرتجع)/gm), 2, 'one line per credit and partial sale')
  // Three purchases, and the purchase return that names its purchase (S-0).
  assert.equal(count(/^S-\d+ /gm), 4)
  assert.equal(count(/^#\d+ مورد التفاصيل/gm), 3, 'the three preliminary invoices')
  // Right to left: printer tags only at the start, no stray separators inside values.
  for (const l of printed.split('\n')) assert.ok((l.match(/\|/g) || []).length <= 1, l)
})
