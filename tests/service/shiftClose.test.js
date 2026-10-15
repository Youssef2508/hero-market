'use strict'
// K-24 (owner decision: option 1). The simple and detailed close dialogs, the hourly audit, the saved
// shift record and the printed report all show the same expected drawer cash.
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

let db, svc, admin
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const sell = (shiftId, items, paymentType = 'نقدي', extra = {}) =>
  svc.call(
    'pos.checkout',
    { clientRef: crypto.randomUUID(), shiftId, paymentType, items, ...extra },
    admin
  )
const itemId = async (saleId, barcode) =>
  (
    await q('SELECT id FROM sale_items WHERE sale_id = $1 AND product_barcode = $2', [
      saleId,
      barcode
    ])
  )[0].id

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, reorder_limit, unit, category) VALUES
    ('P80', 'منتج 80', 60, 80, 75, 100, 0, 'قطعة', 'عام'),
    ('P40', 'منتج 40', 30, 40, 38, 100, 0, 'قطعة', 'عام'),
    ('P20', 'منتج 20', 15, 20, 18, 100, 0, 'قطعة', 'عام'),
    ('P50', 'منتج 50', 35, 50, 45, 100, 0, 'قطعة', 'عام'),
    ('P30', 'منتج 30', 20, 30, 28, 100, 0, 'قطعة', 'عام')`
  )
  admin = await login(svc, '8642')
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('K-24: dialogs, hourly audit, saved close and printed report agree on the owner example (650)', async (t) => {
  if (!requireDb(t)) return
  // Yesterday's shift: a cash sale of 20 that is refunded today.
  const yesterday = ok(await svc.call('shifts.open', { startingCash: 0 }, admin))
  const old = ok(await sell(yesterday.id, [{ barcode: 'P20', qty: 1, unitPrice: 20 }]))
  ok(await svc.call('shifts.close', { shiftId: yesterday.id, actualCash: 20 }, admin))

  const shift = ok(await svc.call('shifts.open', { startingCash: 500 }, admin))
  // Cash sale of 200; 40 of it returned in the same shift.
  const cash = ok(
    await sell(shift.id, [
      { barcode: 'P80', qty: 2, unitPrice: 80 },
      { barcode: 'P40', qty: 1, unitPrice: 40 }
    ])
  )
  ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: await itemId(cash.saleId, 'P40'), quantity: 1, currentShiftId: shift.id },
      admin
    )
  )
  // Refund of yesterday's sale, paid from today's drawer.
  ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: await itemId(old.saleId, 'P20'), quantity: 1, currentShiftId: shift.id },
      admin
    )
  )
  // Credit sale of 50 (no cash), then the customer repays 25 in cash.
  const credit = ok(
    await sell(shift.id, [{ barcode: 'P50', qty: 1, unitPrice: 50 }], 'آجل', {
      client: { id: null, name: 'عميل آجل', phone: '01000000001', address: '' }
    })
  )
  ok(
    await svc.call(
      'clients.repay',
      { clientId: credit.clientId, amount: 25, currentShiftId: shift.id },
      admin
    )
  )
  // Expense of 15; wallet sale of 30 (does not touch the drawer).
  ok(
    await svc.call(
      'expenses.create',
      { amount: 15, category: 'عام', description: 'أكياس', currentShiftId: shift.id },
      admin
    )
  )
  ok(await sell(shift.id, [{ barcode: 'P30', qty: 1, unitPrice: 30 }], 'فودافون كاش'))

  // 500 + 200 + 25 − 40 − 20 − 15 = 650
  const live = ok(await svc.call('shifts.liveSummary', { shiftId: shift.id }, admin))
  assert.deepEqual(
    {
      expected: live.drawer.expected,
      cashSales: live.drawer.cashSales,
      inflow: live.drawer.inflow,
      returns: live.drawer.returns,
      expenses: live.drawer.expenses,
      nonCashSales: live.drawer.nonCashSales
    },
    { expected: 650, cashSales: 200, inflow: 25, returns: 60, expenses: 15, nonCashSales: 80 }
  )
  // The legacy dialog formulas this replaces (kept here as the regression record): 610 and 670.
  const r = live
  assert.equal(r.initial_cash + r.cash_sales + r.inflow - r.outflow, 610)
  assert.equal(
    r.initial_cash + r.cash_sales + r.inflow - (r.supplier_outflow + r.general_outflow),
    670
  )

  const audit = ok(await svc.call('shifts.auditPreview', { shiftId: shift.id }, admin))
  assert.equal(audit.expected, 650, 'hourly audit')

  const closed = ok(await svc.call('shifts.close', { shiftId: shift.id, actualCash: 640 }, admin))
  assert.equal(closed.expected, 650, 'close')
  assert.equal(closed.difference, -10)
  const saved = (
    await q('SELECT expected_end_cash, difference FROM shifts WHERE id = $1', [shift.id])
  )[0]
  assert.deepEqual([saved.expected_end_cash, saved.difference], [650, -10], 'saved shift record')

  // The printed report is built from the close response (usePOSController → print-report).
  const { buildShiftReportLines } = await import('../../src/shared/reportLines.mjs')
  const lines = buildShiftReportLines(
    {
      shift: closed.shift,
      cashSales: closed.figures.cashSales,
      inflow: closed.figures.inflow,
      outflow: closed.figures.outflow,
      expected: closed.expected,
      actual: closed.actual,
      difference: closed.difference
    },
    { store: { name: 'Hero Market' }, paper: '80mm', printedAt: 'test' }
  )
  const expectedLine = lines.find((l) => l.includes('المتوقع في الدرج'))
  assert.match(expectedLine, /650\.00/, 'printed report')
  assert.equal(closed.figures.cashSales + closed.figures.inflow - closed.figures.outflow + 500, 650)
})

test('K-24: an outflow without a description counts in the close exactly as in the hourly audit', async (t) => {
  if (!requireDb(t)) return
  const shift = ok(await svc.call('shifts.open', { startingCash: 100 }, admin))
  ok(await sell(shift.id, [{ barcode: 'P80', qty: 1, unitPrice: 80 }]))
  // Legacy rows can have a NULL description; the drawer still paid the amount.
  await q(
    `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES ($1, 'outflow', 30, NULL, LOCALTIMESTAMP(0))`,
    [shift.id]
  )
  const live = ok(await svc.call('shifts.liveSummary', { shiftId: shift.id }, admin))
  const audit = ok(await svc.call('shifts.auditPreview', { shiftId: shift.id }, admin))
  const closed = ok(await svc.call('shifts.close', { shiftId: shift.id, actualCash: 150 }, admin))
  assert.deepEqual([live.drawer.expected, audit.expected, closed.expected], [150, 150, 150])
  assert.equal(live.drawer.expenses, 30)
})

test('K-24: partial payment counts only the upfront cash; discounts count as sold', async (t) => {
  if (!requireDb(t)) return
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, admin))
  // Cash sale 160 with a discount of 10 → 150 into the drawer.
  ok(await sell(shift.id, [{ barcode: 'P80', qty: 2, unitPrice: 80 }], 'نقدي', { discount: 10 }))
  // Partial payment: 100 total, 40 paid now, 60 on the customer's account.
  ok(
    await sell(shift.id, [{ barcode: 'P50', qty: 2, unitPrice: 50 }], 'دفع جزئي', {
      paidAmount: 40,
      client: { id: null, name: 'عميل جزئي', phone: '01000000002', address: '' }
    })
  )
  const live = ok(await svc.call('shifts.liveSummary', { shiftId: shift.id }, admin))
  assert.equal(live.drawer.expected, 190)
  assert.equal(live.drawer.cashSales, 150)
  assert.equal(live.drawer.inflow, 40)
  const closed = ok(await svc.call('shifts.close', { shiftId: shift.id, actualCash: 190 }, admin))
  assert.equal(closed.expected, 190)
  assert.equal(closed.difference, 0)
})

test('K-36: change kept as customer credit is counted as drawer cash; wallet deposits are not', async (t) => {
  if (!requireDb(t)) return
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, admin))
  // Cash sale of 80, customer pays 100 and keeps 20 as credit: the drawer holds 100.
  const sale = ok(
    await sell(shift.id, [{ barcode: 'P80', qty: 1, unitPrice: 80 }], 'نقدي', {
      paidAmount: 100,
      depositChange: 20,
      client: { id: null, name: 'عميل رصيد', phone: '01000000003', address: '' }
    })
  )
  assert.equal(sale.deposit, 20)
  const client = (await q('SELECT debt_balance FROM clients WHERE id = $1', [sale.clientId]))[0]
  assert.equal(client.debt_balance, -20, 'customer holds 20 credit')
  // Wallet sale with an over-payment kept as credit: no drawer cash.
  ok(
    await sell(shift.id, [{ barcode: 'P30', qty: 1, unitPrice: 30 }], 'فودافون كاش', {
      paidAmount: 40,
      depositChange: 10,
      client: { id: sale.clientId, name: 'عميل رصيد', phone: '01000000003', address: '' }
    })
  )
  const live = ok(await svc.call('shifts.liveSummary', { shiftId: shift.id }, admin))
  assert.equal(live.drawer.expected, 100)
  const audit = ok(await svc.call('shifts.auditPreview', { shiftId: shift.id }, admin))
  const closed = ok(await svc.call('shifts.close', { shiftId: shift.id, actualCash: 100 }, admin))
  assert.deepEqual([audit.expected, closed.expected, closed.difference], [100, 100, 0])
})
