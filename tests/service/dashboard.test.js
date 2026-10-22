'use strict'
// Dashboard periods (owner, 2026-10-21, D-065) against known data: every figure follows the chosen
// range by its own record's date, across month and year boundaries; collections and treasury
// transfers are never sales; nothing is counted twice.
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

let db, svc, owner, shift, clientId
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const dash = (from, to) => svc.call('reports.dashboard', { from, to }, owner)

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES
     ('D1', 'صنف أ', 6, 10, 9, 1000, 'قطعة'), ('D2', 'صنف ب', 15, 25, 22, 1000, 'قطعة')`
  )
  clientId = ok(await svc.call('clients.create', { name: 'عميل', phone: '01033334444' }, owner)).id
  shift = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
  const sell = (items, extra = {}) =>
    svc.call(
      'pos.checkout',
      { clientRef: crypto.randomUUID(), shiftId: shift.id, paymentType: 'نقدي', items, ...extra },
      owner
    )
  // Three sales, then moved to known dates: 2025-12-31, 2026-01-01, 2026-01-15.
  const a = ok(await sell([{ barcode: 'D1', qty: 1 }])).saleId // 10
  const b = ok(await sell([{ barcode: 'D2', qty: 2 }], { paymentType: 'فيزا' })).saleId // 50
  const c = ok(
    await sell([{ barcode: 'D1', qty: 3 }], {
      paymentType: 'آجل',
      client: { id: clientId, name: 'عميل' }
    })
  ).saleId // 30
  await svc.pool.query("UPDATE sales SET timestamp = '2025-12-31 23:30:00' WHERE id = $1", [a])
  await svc.pool.query("UPDATE sales SET timestamp = '2026-01-01 00:15:00' WHERE id = $1", [b])
  await svc.pool.query("UPDATE sales SET timestamp = '2026-01-15 12:00:00' WHERE id = $1", [c])
  // An expense on 2026-01-01 and a collection of the credit sale on 2026-01-20.
  ok(
    await svc.call(
      'expenses.create',
      { amount: 7, category: 'عام', destination: 'shift', currentShiftId: shift.id },
      owner
    )
  )
  await svc.pool.query("UPDATE expenses SET timestamp = '2026-01-01 10:00:00'")
  ok(
    await svc.call(
      'clients.repay',
      {
        clientId,
        amount: 30,
        destination: 'shift',
        currentShiftId: shift.id,
        clientRef: crypto.randomUUID()
      },
      owner
    )
  )
  await svc.pool.query(
    "UPDATE safe_ledger SET timestamp = '2026-01-20 09:00:00' WHERE kind = 'customer_payment'"
  )
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a range follows each record by its own date, across the year boundary', async (t) => {
  if (!requireDb(t)) return
  // New Year's Eve only: one 10 sale.
  let d = ok(await dash('2025-12-31', '2025-12-31'))
  assert.deepEqual([d.totals.sales, d.totals.invoices], [10, 1])
  // 2026-01-01: the Visa sale (50) and the expense (7).
  d = ok(await dash('2026-01-01', '2026-01-01'))
  assert.deepEqual([d.totals.sales, d.totals.invoices, d.totals.expenses], [50, 1, 7])
  assert.deepEqual(d.salesByMethod, { visa: { total: 50, count: 1 } })
  // Across the boundary, both years: everything, once.
  d = ok(await dash('2025-12-01', '2026-01-31'))
  assert.deepEqual([d.totals.sales, d.totals.invoices], [90, 3])
  assert.equal(d.totals.onAccountSales, 30)
  // Profit = (10−6) + (50−30) + (30−18) = 36; minus expenses 7 = 29.
  assert.equal(d.totals.netProfit, 29)
  // The collection of the credit sale is not a sale, only a collection.
  assert.equal(d.totals.collections, 30)
  // Reversed bounds are put in order; the series has one bucket per day.
  const back = ok(await dash('2026-01-31', '2025-12-01'))
  assert.deepEqual(back.totals, d.totals)
  assert.equal(d.unit, 'day')
  assert.equal(d.series.length, 62)
  assert.equal(d.series.find((s) => s.key === '2026-01-15').sales, 30)
  assert.equal(d.topProducts[0].barcode, 'D2')
})

test('«الكل» starts at the first record; a chosen range keeps its days; cash flow (D-078)', async (t) => {
  if (!requireDb(t)) return
  const all = ok(
    await svc.call('reports.dashboard', { from: '2000-01-01', to: '2026-01-31', all: true }, owner)
  )
  assert.equal(all.from, '2025-12-31')
  assert.equal(all.totals.sales, 90)
  // Without «الكل» the range is the one asked for.
  assert.equal(ok(await dash('2000-01-01', '2026-01-31')).from, '2000-01-01')
  // Cash flow: a sale paid at once counts; a collection is drawer money in.
  assert.equal(ok(await dash('2025-12-31', '2025-12-31')).totals.cashFlow, 10)
  assert.equal(ok(await dash('2026-01-20', '2026-01-20')).totals.cashFlow, 30)
})

test('a year shows monthly buckets; an empty period is zero, not missing', async (t) => {
  if (!requireDb(t)) return
  const y = ok(await dash('2026-01-01', '2026-12-31'))
  assert.equal(y.unit, 'month')
  assert.equal(y.series.length, 12)
  assert.equal(y.series[0].sales, 80)
  const empty = ok(await dash('2024-03-01', '2024-03-31'))
  assert.deepEqual([empty.totals.sales, empty.totals.invoices, empty.topProducts.length], [0, 0, 0])
  // Treasury movements are never revenue: a deposit changes nothing here.
  ok(
    await svc.call(
      'treasury.record',
      { kind: 'deposit', amount: 500, clientRef: crypto.randomUUID() },
      owner
    )
  )
  assert.deepEqual(ok(await dash('2026-01-01', '2026-12-31')).totals, y.totals)
  // Only those with reports.
  const cashier = await login(svc, '5173')
  assert.equal(
    (await svc.call('reports.dashboard', { from: '2026-01-01', to: '2026-01-31' }, cashier)).status,
    403
  )
  void (await q('SELECT 1'))
})
