'use strict'
// Rejecting or cancelling a supplier debt-payment request (owner, 1.5.2, D-100): who may approve
// (never the cashier who recorded it, unless an administrator), a cancel and a reject at the same
// moment reverse once, an administrator's reservation holds a cancel back, and the supplier's
// balance reconciles with the approved requests only.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

let db, svc, owner, both, cashier, ownerShift, bothShift, cashierShift, supplierId
const ref = () => crypto.randomUUID()
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r, what = '') => {
  assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`)
  return r.body
}
const r2 = (n) => Math.round(Number(n) * 100) / 100
const debt = async () =>
  r2((await one('SELECT debt_balance FROM suppliers WHERE id = $1', [supplierId])).debt_balance)
const drawer = async (shift) =>
  ok(await svc.call('shifts.liveSummary', { shiftId: shift.id }, owner)).drawer.expected
const request = async (amount, token, shift) =>
  ok(
    await svc.call(
      'supplierPayments.create',
      { supplierId, amount, currentShiftId: shift.id, clientRef: ref() },
      token
    )
  ).request
const reversals = async (id) =>
  (
    await one(
      `SELECT (SELECT count(*) FROM safe_ledger WHERE kind = 'supplier_payment_reversal' AND ref_id = $1)
            + (SELECT count(*) FROM treasury_ledger WHERE kind = 'supplier_payment_reversal' AND ref_id = $1) AS n`,
      [id]
    )
  ).n

// A copy of «كاشير» with the given extra permissions.
async function role(name, permissions) {
  await svc.pool.query('INSERT INTO roles (key, name, description) VALUES (NULL, $1, $1)', [name])
  const id = (await one('SELECT id FROM roles WHERE name = $1', [name])).id
  await svc.pool.query(
    `INSERT INTO role_permissions (role_id, permission)
     SELECT $1::int, permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = 'cashier'
     UNION SELECT $1::int, unnest($2::text[])`,
    [id, permissions]
  )
  return id
}

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'both', pin: '5173', roleKey: 'cashier' })
  await createUser(svc, { username: 'cashier', pin: '6205', roleKey: 'cashier' })
  const bothRole = await role('كاشير يعتمد', [
    'suppliers.payment_request',
    'suppliers.payment_approve'
  ])
  const payRole = await role('كاشير سداد', ['suppliers.payment_request'])
  await svc.pool.query("UPDATE users SET role_id = $1 WHERE username = 'both'", [bothRole])
  await svc.pool.query("UPDATE users SET role_id = $1 WHERE username = 'cashier'", [payRole])
  owner = await login(svc, '8642')
  both = await login(svc, '5173')
  cashier = await login(svc, '6205')
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الخضار' }, owner)).id
  ok(
    await svc.call(
      'suppliers.addPurchase',
      { supplierId, total_amount: 2000, paid_amount: 0, payment_type: 'آجل' },
      owner
    )
  )
  ownerShift = ok(await svc.call('shifts.open', { startingCash: 1000 }, owner))
  bothShift = ok(await svc.call('shifts.open', { startingCash: 1000 }, both))
  cashierShift = ok(await svc.call('shifts.open', { startingCash: 1000 }, cashier))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a cashier never approves their own request, even holding the approval; an administrator may', async (t) => {
  if (!requireDb(t)) return
  const d0 = await debt()
  const own = await request(50, both, bothShift)
  const refused = await svc.call('supplierPayments.approve', { requestId: own.id }, both)
  assert.equal(refused.status, 403)
  assert.equal(await debt(), d0, 'refused: the balance did not move')
  // Another cashier's request: the same user may approve it.
  const others = await request(30, cashier, cashierShift)
  ok(await svc.call('supplierPayments.approve', { requestId: others.id }, both))
  // The administrator approves the first one, and their own.
  ok(await svc.call('supplierPayments.approve', { requestId: own.id }, owner))
  const mine = await request(20, owner, ownerShift)
  ok(await svc.call('supplierPayments.approve', { requestId: mine.id }, owner))
  assert.equal(await debt(), r2(d0 - 50 - 30 - 20))
})

test('a cancel and a reject at the same moment: one reversal, one final state', async (t) => {
  if (!requireDb(t)) return
  for (let i = 0; i < 5; i++) {
    const r = await request(15, cashier, cashierShift)
    const d0 = await drawer(cashierShift)
    const debt0 = await debt()
    const [a, b] = await Promise.all([
      svc.call('supplierPayments.cancel', { requestId: r.id, note: 'سجلته بالخطأ' }, cashier),
      svc.call('supplierPayments.reject', { requestId: r.id, note: 'لا يوجد إيصال' }, owner)
    ])
    // The second one sees the first one's state and is refused (or, if the same, a duplicate).
    assert.equal([a.status, b.status].filter((s) => s === 200).length, 1, `${a.status} ${b.status}`)
    assert.equal(Number(await reversals(r.id)), 1)
    const row = await one('SELECT status FROM supplier_payment_requests WHERE id = $1', [r.id])
    assert.ok(['rejected', 'cancelled'].includes(row.status))
    assert.equal(await drawer(cashierShift), r2(d0 + 15))
    assert.equal(await debt(), debt0)
  }
})

test('an administrator deciding on a request holds back its cashier’s cancel', async (t) => {
  if (!requireDb(t)) return
  const r = await request(25, cashier, cashierShift)
  const held = ok(await svc.call('supplierPayments.reserve', { requestId: r.id }, owner))
  const refused = await svc.call(
    'supplierPayments.cancel',
    { requestId: r.id, note: 'سجلته بالخطأ' },
    cashier
  )
  assert.equal(refused.status, 409)
  assert.equal(Number(await reversals(r.id)), 0)
  ok(await svc.call('supplierPayments.release', { requestId: r.id, token: held.token }, owner))
  ok(await svc.call('supplierPayments.cancel', { requestId: r.id, note: 'سجلته بالخطأ' }, cashier))
  assert.equal(Number(await reversals(r.id)), 1)
  // Cancelled: no one approves or rejects it any more.
  assert.equal((await svc.call('supplierPayments.approve', { requestId: r.id }, owner)).status, 409)
  assert.equal(
    (await svc.call('supplierPayments.reject', { requestId: r.id, note: 'متأخر' }, owner)).status,
    409
  )
})

test('the supplier balance reconciles: purchases − approved requests; drawers net to zero for reversed ones', async (t) => {
  if (!requireDb(t)) return
  const sums = await one(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)::float8 approved,
            COALESCE(SUM(amount) FILTER (WHERE status IN ('rejected', 'cancelled')), 0)::float8 reversed
       FROM supplier_payment_requests WHERE supplier_id = $1`,
    [supplierId]
  )
  assert.equal(await debt(), r2(2000 - sums.approved))
  // Every reversed request: one outflow and one equal reversal, never an expense.
  const net = await q(
    `SELECT r.id,
            (SELECT COALESCE(SUM(CASE WHEN type = 'inflow' THEN amount ELSE -amount END), 0)
               FROM safe_ledger WHERE ref_type = 'supplier_payment_request' AND ref_id = r.id)
          + (SELECT COALESCE(SUM(amount), 0) FROM treasury_ledger
              WHERE kind = 'supplier_payment_reversal' AND ref_id = r.id) AS net
       FROM supplier_payment_requests r WHERE r.status IN ('rejected', 'cancelled')`
  )
  assert.ok(net.length >= 6)
  for (const x of net) assert.equal(r2(x.net), 0, `request #${x.id}`)
  assert.equal((await one('SELECT count(*)::int n FROM expenses')).n, 0)
  assert.ok(sums.reversed > 0)
})
