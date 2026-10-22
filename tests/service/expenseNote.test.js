'use strict'
// Expense note is optional (owner feedback EXP-02, part 1): amount and category are enough.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

let db, svc, owner, shiftId
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  owner = await login(svc, '8642')
  shiftId = ok(await svc.call('shifts.open', { startingCash: 100 }, owner)).id
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('an expense without a note is recorded, with a clean drawer line', async (t) => {
  if (!requireDb(t)) return
  for (const body of [
    { amount: 15, category: 'صيانة', currentShiftId: shiftId },
    { amount: 5, category: 'عام', description: '', currentShiftId: shiftId },
    { amount: 7, category: 'عام', description: null, currentShiftId: shiftId }
  ])
    ok(await svc.call('expenses.create', body, owner))
  const rows = (
    await svc.pool.query('SELECT amount, category, description FROM expenses ORDER BY id')
  ).rows
  assert.deepEqual(
    rows.map((r) => [Number(r.amount), r.category, r.description]),
    [
      [15, 'صيانة', ''],
      [5, 'عام', ''],
      [7, 'عام', '']
    ]
  )
  const ledger = (
    await svc.pool.query("SELECT description FROM safe_ledger WHERE type = 'outflow' ORDER BY id")
  ).rows.map((r) => r.description)
  assert.deepEqual(ledger, [
    'مصروفات - تصنيف: صيانة',
    'مصروفات - تصنيف: عام',
    'مصروفات - تصنيف: عام'
  ])
  // A note is still kept when given; the amount is still required.
  ok(
    await svc.call(
      'expenses.create',
      { amount: 3, category: 'عام', description: 'شاي', currentShiftId: shiftId },
      owner
    )
  )
  const last = (
    await svc.pool.query('SELECT description FROM safe_ledger ORDER BY id DESC LIMIT 1')
  ).rows[0].description
  assert.equal(last, 'مصروفات - تصنيف: عام - شاي')
  const noAmount = await svc.call(
    'expenses.create',
    { category: 'عام', currentShiftId: shiftId },
    owner
  )
  assert.equal(noAmount.status, 400)
})
