'use strict'
// Cancelling a preliminary supplier invoice (owner, 2026-10-21, D-065), with exact balances: the
// payable it created is reversed; money it paid either came back (a real movement now, by its
// method, in the current shift or the treasury) or not (the supplier owes it); a converted
// invoice is refused; a cancelled one cannot be converted; once only; nothing is deleted.
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

let db, svc, owner, cashier, cashier2, shift, supplierId
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
const treasuryBy = async () =>
  Object.fromEntries(
    (await q('SELECT method, SUM(amount)::float8 s FROM treasury_ledger GROUP BY method')).map(
      (r) => [r.method, r.s]
    )
  )
const create = (token, body, shiftId) =>
  svc.call(
    'supplierInvoices.createPending',
    { supplierId, currentShiftId: shiftId, clientRef: ref(), ...body },
    token
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await createUser(svc, { username: 'cashier2', pin: '5174', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  cashier2 = await login(svc, '5174')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES ('C1', 'صنف', 5, 8, 7, 0, 'قطعة')`
  )
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الإلغاء' }, owner)).id
  shift = ok(await svc.call('shifts.open', { startingCash: 100 }, cashier))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a credit invoice cancelled: its payable goes, no money moves, the record stays', async (t) => {
  if (!requireDb(t)) return
  const inv = ok(await create(cashier, { total: 120, paymentMode: 'credit' }, shift.id)).invoice
  assert.equal(await debt(), 120)
  const moves = (await q('SELECT COUNT(*)::int n FROM safe_ledger')).length
  const cRef = ref()
  ok(
    await svc.call(
      'supplierInvoices.cancel',
      { invoiceId: inv.id, refund: 'none', clientRef: cRef },
      cashier
    )
  )
  assert.equal(await debt(), 0)
  assert.equal((await q('SELECT COUNT(*)::int n FROM safe_ledger')).length, moves)
  const row = await one(
    'SELECT status, cancel_refund, cancelled_by FROM supplier_pending_invoices WHERE id = $1',
    [inv.id]
  )
  assert.equal(row.status, 'cancelled')
  assert.equal(row.cancel_refund, 'none')
  // Once: the same request returns the first result; another is refused.
  assert.equal(
    ok(
      await svc.call(
        'supplierInvoices.cancel',
        { invoiceId: inv.id, refund: 'none', clientRef: cRef },
        cashier
      )
    ).duplicate,
    true
  )
  assert.equal(
    (
      await svc.call(
        'supplierInvoices.cancel',
        { invoiceId: inv.id, refund: 'none', clientRef: ref() },
        cashier
      )
    ).status,
    409
  )
  assert.equal(await debt(), 0)
  // A cancelled invoice cannot be completed.
  assert.equal(
    (
      await svc.call(
        'supplierInvoices.convert',
        { invoiceId: inv.id, items: [{ barcode: 'C1', qty: 1, unitCost: 120 }], clientRef: ref() },
        owner
      )
    ).status,
    409
  )
})

test('paid in full, not returned: no money comes back, the supplier owes it to the store', async (t) => {
  if (!requireDb(t)) return
  const before = await debt()
  const inv = ok(await create(cashier, { total: 80, paymentMode: 'cash' }, shift.id)).invoice
  assert.equal(await debt(), before)
  const inflowBefore = (
    await one("SELECT COALESCE(SUM(amount),0)::float8 s FROM safe_ledger WHERE type = 'inflow'")
  ).s
  ok(
    await svc.call(
      'supplierInvoices.cancel',
      { invoiceId: inv.id, refund: 'none', clientRef: ref() },
      cashier
    )
  )
  assert.equal(await debt(), r2(before - 80), 'a credit of 80 on the supplier')
  assert.equal(
    (await one("SELECT COALESCE(SUM(amount),0)::float8 s FROM safe_ledger WHERE type = 'inflow'"))
      .s,
    inflowBefore
  )
  // The original payment stays in the shift's history.
  assert.ok(await one("SELECT 1 FROM safe_ledger WHERE kind = 'supplier_payment' AND amount = 80"))
})

test('partial, returned now: a real InstaPay movement back in the current shift; payable reversed', async (t) => {
  if (!requireDb(t)) return
  const before = await debt()
  const inv = ok(
    await create(
      cashier,
      { total: 300, paymentMode: 'partial', paid: 100, method: 'instapay' },
      shift.id
    )
  ).invoice
  assert.equal(await debt(), r2(before + 200))
  ok(
    await svc.call(
      'supplierInvoices.cancel',
      {
        invoiceId: inv.id,
        refund: 'returned',
        method: 'instapay',
        destination: 'shift',
        currentShiftId: shift.id,
        clientRef: ref()
      },
      cashier
    )
  )
  assert.equal(await debt(), before)
  const back = await one(
    "SELECT method, amount::float8 a FROM safe_ledger WHERE kind = 'supplier_refund'"
  )
  assert.deepEqual([back.method, back.a], ['instapay', 100])
  // The shift's InstaPay: −100 paid, +100 back = 0.
  const rep = ok(await svc.call('shifts.details', { shiftId: shift.id }, owner)).report
  assert.equal(rep.expected.instapay, 0)
  assert.equal(rep.supplierRefunds, 100)
})

test('paid from a shift that is closed and transferred: the return goes to the treasury, the closed shift is untouched', async (t) => {
  if (!requireDb(t)) return
  const s2 = ok(await svc.call('shifts.open', { startingCash: 60 }, cashier2))
  ok(await svc.call('treasury.record', { kind: 'deposit', amount: 500, clientRef: ref() }, owner))
  const inv = ok(await create(cashier2, { total: 60, paymentMode: 'cash' }, s2.id)).invoice
  // The shift had 60 − 60 = 0 cash; counted 0: no difference.
  ok(await svc.call('shifts.close', { shiftId: s2.id, actualCash: 0, clientRef: ref() }, cashier2))
  const saved = (await one('SELECT report FROM shift_closings WHERE shift_id = $1', [s2.id])).report
  const t0 = await treasuryBy()
  // The owner (no shift) records that the supplier gave the 60 back in cash, into the treasury.
  ok(
    await svc.call(
      'supplierInvoices.cancel',
      {
        invoiceId: inv.id,
        refund: 'returned',
        method: 'cash',
        destination: 'treasury',
        clientRef: ref()
      },
      owner
    )
  )
  const t1 = await treasuryBy()
  assert.equal(r2(t1.cash - t0.cash), 60)
  assert.deepEqual(
    (await one('SELECT report FROM shift_closings WHERE shift_id = $1', [s2.id])).report,
    saved
  )
  // Another cashier's invoice is not theirs to cancel.
  const mine = ok(await create(cashier, { total: 10, paymentMode: 'credit' }, shift.id)).invoice
  assert.equal(
    (
      await svc.call(
        'supplierInvoices.cancel',
        { invoiceId: mine.id, refund: 'none', clientRef: ref() },
        cashier2
      )
    ).status,
    404
  )
})

test('a converted invoice cannot be cancelled here (stock and cost need a purchase return)', async (t) => {
  if (!requireDb(t)) return
  const inv = ok(await create(cashier, { total: 50, paymentMode: 'credit' }, shift.id)).invoice
  ok(
    await svc.call(
      'supplierInvoices.convert',
      { invoiceId: inv.id, items: [{ barcode: 'C1', qty: 10, unitCost: 5 }], clientRef: ref() },
      owner
    )
  )
  const stock = (await one("SELECT stock_qty::float8 s FROM products WHERE barcode = 'C1'")).s
  const r = await svc.call(
    'supplierInvoices.cancel',
    { invoiceId: inv.id, refund: 'none', clientRef: ref() },
    owner
  )
  assert.equal(r.status, 409)
  assert.match(r.body.error.message, /مرتجع مشتريات/)
  assert.equal(
    (await one("SELECT stock_qty::float8 s FROM products WHERE barcode = 'C1'")).s,
    stock
  )
})

test('a cancellation that fails changes nothing (one transaction)', async (t) => {
  if (!requireDb(t)) return
  const inv = ok(await create(cashier, { total: 40, paymentMode: 'cash' }, shift.id)).invoice
  const before = await debt()
  // Returned to the treasury by a cashier without treasury rights: refused, nothing written.
  const r = await svc.call(
    'supplierInvoices.cancel',
    { invoiceId: inv.id, refund: 'returned', destination: 'treasury', clientRef: ref() },
    cashier
  )
  assert.equal(r.status, 403)
  assert.equal(await debt(), before)
  assert.equal(
    (await one('SELECT status FROM supplier_pending_invoices WHERE id = $1', [inv.id])).status,
    'pending'
  )
})
