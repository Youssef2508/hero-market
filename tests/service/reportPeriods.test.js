'use strict'
// Report periods (owner feedback ANALYTICS-01): records are selected by their own date, in local
// calendar days. Before: a shift left open for days put all its sales in every period, and
// "today" started yesterday, so today / 7 days / 30 days showed the same figures.
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

let db, svc, owner
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
// Local midnight N days ago, as the service stores timestamps (local time, no zone).
const daysAgo = async (n, time = '12:00:00') =>
  (await q(`SELECT to_char(CURRENT_DATE - $1::int, 'YYYY-MM-DD') || ' ' || $2 AS t`, [n, time]))[0]
    .t

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  owner = await login(svc, '8642')
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('T', 'اليوم', 5, 10, 100, 'قطعة'), ('Y', 'أمس', 5, 20, 100, 'قطعة'), ('W', 'أسبوع', 5, 40, 100, 'قطعة'), ('M', 'قديم', 5, 80, 100, 'قطعة')"
  )
  // One shift, opened 45 days ago and still open (the case the owner saw).
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
  await q('UPDATE shifts SET start_time = $1 WHERE id = $2', [
    await daysAgo(45, '08:00:00'),
    shift.id
  ])
  const sell = async (barcode, when) => {
    const r = ok(
      await svc.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: shift.id,
          paymentType: 'نقدي',
          items: [{ barcode, qty: 1 }]
        },
        owner
      )
    )
    await q('UPDATE sales SET timestamp = $1 WHERE id = $2', [when, r.saleId])
  }
  await sell('T', await daysAgo(0, '00:00:01')) // just after midnight today
  await sell('Y', await daysAgo(1, '23:59:59')) // last second of yesterday
  await sell('W', await daysAgo(6, '10:00:00')) // inside "7 days"
  await sell('M', await daysAgo(40, '10:00:00')) // only in "all"
  const expense = async (amount, when) => {
    ok(
      await svc.call(
        'expenses.create',
        { amount, category: 'عام', description: 'اختبار', currentShiftId: shift.id },
        owner
      )
    )
    // expenses.create returns no id: back-date the newest expense.
    await q('UPDATE expenses SET timestamp = $1 WHERE id = (SELECT max(id) FROM expenses)', [when])
  }
  await expense(1, await daysAgo(0))
  await expense(2, await daysAgo(20))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('today, 7 days, 30 days and all show different, correct figures', async (t) => {
  if (!requireDb(t)) return
  const get = async (period) => ok(await svc.call('reports.periodic', { period }, owner))
  const daily = await get('daily')
  const weekly = await get('weekly')
  const monthly = await get('monthly')
  const all = await get('all')
  assert.deepEqual(
    [daily.totalSales, weekly.totalSales, monthly.totalSales, all.totalSales],
    [10, 70, 70, 150]
  )
  assert.deepEqual(
    [daily.invoiceCount, weekly.invoiceCount, monthly.invoiceCount, all.invoiceCount],
    [1, 3, 3, 4]
  )
  assert.deepEqual(
    [daily.totalExpenses, weekly.totalExpenses, monthly.totalExpenses, all.totalExpenses],
    [1, 1, 3, 3]
  )
  // Profit = (price − cost) of the period's sales − its expenses.
  assert.equal(daily.netProfit, 10 - 5 - 1)
  assert.equal(all.netProfit, 150 - 20 - 3)
})

test('advanced report: a custom range takes only the records dated inside it', async (t) => {
  if (!requireDb(t)) return
  const yesterday = (await daysAgo(1, '00:00:00')).slice(0, 10)
  const r = ok(
    await svc.call(
      'reports.advanced',
      { from: `${yesterday} 00:00:00`, to: `${yesterday} 23:59:59` },
      owner
    )
  )
  assert.equal(r.shifts.length, 1) // the long shift overlaps the range
  assert.equal(Number(r.salesSum.total), 20)
  assert.equal(Number(r.salesSum.count), 1)
  assert.equal(r.expenses.total, null)
  assert.deepEqual(
    r.daily.map((d) => [d.day, Number(d.total_sales)]),
    [[yesterday, 20]]
  )
  // A range with no records: zero, not the whole shift.
  const empty = ok(
    await svc.call(
      'reports.advanced',
      {
        from: `${(await daysAgo(30)).slice(0, 10)} 00:00:00`,
        to: `${(await daysAgo(30)).slice(0, 10)} 23:59:59`
      },
      owner
    )
  )
  assert.equal(empty.salesSum.total, null)
})

test("best sellers of today are only today's sales", async (t) => {
  if (!requireDb(t)) return
  const r = ok(await svc.call('reports.bestSellers', { period: 'daily' }, owner))
  assert.deepEqual(
    r.top.map((x) => x.barcode),
    ['T']
  )
  const w = ok(await svc.call('reports.bestSellers', { period: 'weekly' }, owner))
  assert.deepEqual(w.top.map((x) => x.barcode).sort(), ['T', 'W', 'Y'])
})
