'use strict'
// An administrator buying from a supplier with no open shift (owner, 1.5.2, D-089): the paid amount
// is recorded on the treasury automatically, no shift is touched; with a shift, the drawer pays as
// before; anyone else still needs a shift. Every case reconciles the supplier, drawer and treasury.
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

let db, svc, owner, storeAdmin, manager, supplierId
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
const treasuryBalance = async () =>
  r2((await one('SELECT COALESCE(SUM(amount), 0) b FROM treasury_ledger')).b)
const drawerOut = async (shiftId) =>
  r2(
    (
      await one(
        "SELECT COALESCE(SUM(amount), 0) a FROM safe_ledger WHERE shift_id = $1 AND kind = 'supplier_payment'",
        [shiftId]
      )
    ).a
  )
const buy = (token, { paid, total = 100, shiftId = null, clientRef = ref() }) =>
  svc.call(
    'suppliers.addPurchase',
    {
      supplierId,
      invoice_ref: `T-${crypto.randomBytes(3).toString('hex')}`,
      total_amount: total,
      paid_amount: paid,
      payment_type: paid >= total ? 'نقدي' : 'آجل',
      currentShiftId: shiftId,
      clientRef,
      items: [{ barcode: 'P', qty: total / 10, unitCost: 10 }]
    },
    token
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'storeadmin', pin: '7314', roleKey: 'store_admin' })
  await createUser(svc, { username: 'manager', pin: '9517', roleKey: 'manager' })
  owner = await login(svc, '8642')
  storeAdmin = await login(svc, '7314')
  manager = await login(svc, '9517')
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('P', 'صنف', 10, 15, 0, 'قطعة')"
  )
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الخزنة' }, owner)).id
  // The treasury holds money to pay with.
  ok(
    await svc.call(
      'treasury.record',
      { kind: 'deposit', amount: 1000, reason: 'رصيد', clientRef: ref() },
      owner
    )
  )
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('an administrator with no shift: paid cash goes to the treasury, cash, partial and credit', async (t) => {
  if (!requireDb(t)) return
  for (const [token, who] of [
    [owner, 'مدير النظام'],
    [storeAdmin, 'مدير المتجر']
  ]) {
    const t0 = await treasuryBalance()
    const d0 = await debt()
    // Paid in full.
    const full = ok(await buy(token, { paid: 100 }))
    // Partial: 40 of 100.
    const partial = ok(await buy(token, { paid: 40 }))
    // Credit: nothing paid, nothing on the treasury.
    const credit = ok(await buy(token, { paid: 0 }))
    assert.equal(await treasuryBalance(), r2(t0 - 140), who)
    assert.equal(await debt(), r2(d0 + 60 + 100), who)
    const rows = await q(
      "SELECT ref_id, amount::float8 a, method, shift_id FROM treasury_ledger WHERE ref_type = 'supplier_purchase' AND ref_id = ANY($1) ORDER BY ref_id",
      [[full.purchaseId, partial.purchaseId, credit.purchaseId]]
    )
    assert.deepEqual(rows, [
      { ref_id: full.purchaseId, a: -100, method: 'cash', shift_id: null },
      { ref_id: partial.purchaseId, a: -40, method: 'cash', shift_id: null }
    ])
    const src = await q(
      'SELECT id, paid_from, shift_id FROM supplier_purchases WHERE id = ANY($1) ORDER BY id',
      [[full.purchaseId, partial.purchaseId, credit.purchaseId]]
    )
    assert.deepEqual(
      src.map((r) => [r.paid_from, r.shift_id]),
      [
        ['treasury', null],
        ['treasury', null],
        [null, null]
      ]
    )
  }
  // No shift was opened or touched.
  assert.equal((await one('SELECT count(*)::int n FROM shifts')).n, 0)
  assert.equal((await one('SELECT count(*)::int n FROM safe_ledger')).n, 0)
  const log = await one(
    "SELECT description FROM system_logs WHERE action_type = 'supplier_purchase' ORDER BY id DESC LIMIT 2 OFFSET 1"
  )
  assert.match(log.description, /مدفوع 40\.00 ج\.م من الخزنة/)
})

test('a retried confirmation pays the treasury once', async (t) => {
  if (!requireDb(t)) return
  const t0 = await treasuryBalance()
  const clientRef = ref()
  const tries = await Promise.all([1, 2, 3].map(() => buy(owner, { paid: 50, clientRef })))
  tries.forEach(ok)
  assert.equal(new Set(tries.map((r) => r.body.purchaseId)).size, 1)
  assert.equal(await treasuryBalance(), r2(t0 - 50))
})

test('an administrator with an open shift: the drawer pays, as before; the treasury is untouched', async (t) => {
  if (!requireDb(t)) return
  const shift = ok(await svc.call('shifts.open', { startingCash: 500 }, storeAdmin))
  const t0 = await treasuryBalance()
  const r = ok(await buy(storeAdmin, { paid: 70, shiftId: shift.id }))
  assert.equal(await drawerOut(shift.id), 70)
  assert.equal(await treasuryBalance(), t0)
  const row = await one('SELECT paid_from, shift_id FROM supplier_purchases WHERE id = $1', [
    r.purchaseId
  ])
  assert.deepEqual(row, { paid_from: 'shift', shift_id: shift.id })
  // With a shift open but not named, the rule is unchanged: refused, never the treasury.
  const unnamed = await buy(storeAdmin, { paid: 10 })
  assert.equal(unnamed.status, 409, JSON.stringify(unnamed.body))
  assert.equal(await treasuryBalance(), t0)
  assert.equal(await drawerOut(shift.id), 70)
  // The shift's summary counts the drawer payment only; the treasury payments are not in it.
  const live = ok(await svc.call('shifts.liveSummary', { shiftId: shift.id }, storeAdmin))
  assert.ok(JSON.stringify(live).includes('70'), JSON.stringify(live))
  assert.ok(!JSON.stringify(live).includes('140'))
})

test('a non-administrator with no shift is still refused, and nothing is written', async (t) => {
  if (!requireDb(t)) return
  const t0 = await treasuryBalance()
  const d0 = await debt()
  const n0 = (await one('SELECT count(*)::int n FROM supplier_purchases')).n
  const refused = await buy(manager, { paid: 30 })
  assert.equal(refused.status, 409, JSON.stringify(refused.body))
  assert.equal(await treasuryBalance(), t0)
  assert.equal(await debt(), d0)
  assert.equal((await one('SELECT count(*)::int n FROM supplier_purchases')).n, n0)
  // On credit (nothing paid) a supervisor may record it without a shift, as before.
  ok(await buy(manager, { paid: 0 }))
  assert.equal(await treasuryBalance(), t0)
})
