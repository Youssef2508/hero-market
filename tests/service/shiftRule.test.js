'use strict'
// Who must open a shift (1.4.0, owner decision): the owner never; the roles chosen in the settings
// (all roles that operate a shift by default); cash operations without a shift answer
// `shift_required` so the terminal can offer to open one.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  passwordFor,
  seedProducts
} = require('./helpers')

let db, svc, ownerToken
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const signIn = async (username, code) =>
  ok(await svc.call('auth.login', { username, password: passwordFor(code) }, null))
const roleId = async (key) =>
  (await svc.pool.query('SELECT id FROM roles WHERE key = $1', [key])).rows[0].id
const setRequired = async (value) =>
  ok(await svc.call('settings.update', { values: { shift_required_roles: value } }, ownerToken))

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await createUser(svc, { username: 'auditor', pin: '7319', roleKey: 'auditor' })
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('A', 'صنف أ', 5, 10, 100, 'قطعة')"
  )
  ownerToken = await login(svc, '8642')
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('by default every role that operates a shift must open one, never the owner', async (t) => {
  if (!requireDb(t)) return
  assert.equal((await signIn('owner', '8642')).shiftRequired, false)
  assert.equal((await signIn('cashier', '5173')).shiftRequired, true)
  // A role without shifts.operate never opens shifts.
  assert.equal((await signIn('auditor', '7319')).shiftRequired, false)
})

test('the setting chooses the roles; the owner stays exempt even when listed', async (t) => {
  if (!requireDb(t)) return
  const cashierRole = await roleId('cashier')
  const ownerRole = await roleId('super_admin')
  await setRequired([])
  assert.equal((await signIn('cashier', '5173')).shiftRequired, false)
  await setRequired([cashierRole, ownerRole])
  assert.equal((await signIn('cashier', '5173')).shiftRequired, true)
  assert.equal((await signIn('owner', '8642')).shiftRequired, false)
  // Stored normalised (sorted ids); null brings back the default.
  const stored = await svc.pool.query(
    "SELECT value FROM settings WHERE key = 'shift_required_roles'"
  )
  assert.deepEqual(
    JSON.parse(stored.rows[0].value),
    [cashierRole, ownerRole].sort((a, b) => a - b)
  )
  await setRequired(null)
  assert.equal((await signIn('cashier', '5173')).shiftRequired, true)
})

test('invalid role lists are refused', async (t) => {
  if (!requireDb(t)) return
  for (const bad of ['["cashier"]', [0], [-1], [1.5], 'not json', { a: 1 }]) {
    const r = await svc.call(
      'settings.update',
      { values: { shift_required_roles: bad } },
      ownerToken
    )
    assert.equal(r.status, 400, `accepted ${JSON.stringify(bad)}`)
  }
})

test('without a shift the owner can work, but drawer cash answers shift_required', async (t) => {
  if (!requireDb(t)) return
  // Work that does not touch the drawer.
  ok(await svc.call('products.page', { page: 1 }, ownerToken))
  const supplier = ok(await svc.call('suppliers.create', { name: 'مورد' }, ownerToken))
  const supplierId = supplier.id
  ok(
    await svc.call(
      'suppliers.addPurchase',
      { supplierId, total_amount: 50, paid_amount: 0, payment_type: 'آجل', currentShiftId: null },
      ownerToken
    )
  )
  // Paying cash from the drawer needs a shift.
  const paid = await svc.call(
    'suppliers.addPurchase',
    { supplierId, total_amount: 50, paid_amount: 50, payment_type: 'نقدي', currentShiftId: null },
    ownerToken
  )
  assert.equal(paid.status, 409)
  assert.equal(paid.body.error.code, 'shift_required')
  const expense = await svc.call(
    'expenses.create',
    { amount: 10, description: 'شاي', currentShiftId: null },
    ownerToken
  )
  assert.equal(expense.status, 409)
  assert.equal(expense.body.error.code, 'shift_required')
  // After opening a shift the same sale goes through.
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, ownerToken))
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'A', qty: 1 }]
      },
      ownerToken
    )
  )
})
