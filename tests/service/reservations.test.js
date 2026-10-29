'use strict'
// Reservations against concurrent editing (owner, 1.5.2, D-099): a preliminary supplier invoice
// being completed is reserved for 30 minutes, a supplier debt-payment request being decided on
// for 5. The clock is moved with HEROMARKET_TEST_CLOCK_OFFSET_SECONDS (read by the service on
// every check), so expiry is tested without waiting.
const { test, before, after, afterEach } = require('node:test')
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

let db, svc, owner, admin2, cashier, shift, shift2, supplierId
const ref = () => crypto.randomUUID()
const one = async (sql, p) => (await svc.pool.query(sql, p)).rows[0]
const ok = (r, what = '') => {
  assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`)
  return r.body
}
const minutes = (m) => {
  process.env.HEROMARKET_TEST_CLOCK_OFFSET_SECONDS = String(m * 60)
}
const pending = async (total = 100) =>
  ok(
    await svc.call(
      'supplierInvoices.createPending',
      { supplierId, total, paymentMode: 'credit', currentShiftId: shift.id, clientRef: ref() },
      cashier
    )
  ).invoice
const convert = (id, token, by = owner, clientRef = ref()) =>
  svc.call(
    'supplierInvoices.convert',
    {
      invoiceId: id,
      items: [{ barcode: 'P', qty: 10, unitCost: 10 }],
      clientRef,
      reservationToken: token
    },
    by
  )
const stock = async () =>
  Number((await one("SELECT stock_qty FROM products WHERE barcode = 'P'")).stock_qty)
const debt = async () =>
  Number((await one('SELECT debt_balance FROM suppliers WHERE id = $1', [supplierId])).debt_balance)

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'admin2', pin: '7314', roleKey: 'store_admin' })
  await createUser(svc, { username: 'cashier1', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  admin2 = await login(svc, '7314')
  cashier = await login(svc, '5173')
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('P', 'صنف', 10, 15, 0, 'قطعة')"
  )
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الحجز' }, owner)).id
  ok(
    await svc.call(
      'suppliers.addPurchase',
      { supplierId, total_amount: 1000, paid_amount: 0, payment_type: 'آجل' },
      owner
    )
  )
  shift = ok(await svc.call('shifts.open', { startingCash: 1000 }, cashier))
  // admin2 records the debt-payment requests from their own drawer.
  shift2 = ok(await svc.call('shifts.open', { startingCash: 500 }, admin2))
})

afterEach(() => minutes(0))
after(async () => {
  delete process.env.HEROMARKET_TEST_CLOCK_OFFSET_SECONDS
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('existing records start unreserved; the migration adds only empty columns', async (t) => {
  if (!requireDb(t)) return
  const inv = await pending()
  const row = await one(
    'SELECT reserved_by, reserved_until, reserve_token FROM supplier_pending_invoices WHERE id = $1',
    [inv.id]
  )
  assert.deepEqual(row, { reserved_by: null, reserved_until: null, reserve_token: null })
  const listed = ok(await svc.call('supplierInvoices.list', { status: 'pending' }, owner)).find(
    (x) => x.id === inv.id
  )
  assert.equal(listed.reserved_active, false)
  assert.equal('reserve_token' in listed, false, 'the token is never listed')
})

test('preliminary invoice: the first user reserves it for 30 minutes; the second is refused by name', async (t) => {
  if (!requireDb(t)) return
  const inv = await pending()
  const r = ok(await svc.call('supplierInvoices.reserve', { invoiceId: inv.id }, owner))
  assert.equal(r.minutes, 30)
  const span = await one(
    'SELECT EXTRACT(EPOCH FROM reserved_until - reserved_at)::int s FROM supplier_pending_invoices WHERE id = $1',
    [inv.id]
  )
  assert.equal(span.s, 30 * 60)
  // The list shows who is editing it, to everyone who may see it.
  const row = ok(await svc.call('supplierInvoices.list', { status: 'pending' }, admin2)).find(
    (x) => x.id === inv.id
  )
  assert.deepEqual(
    [row.reserved_active, row.reserved_by_name, row.reserved_mine],
    [true, 'owner', false]
  )
  assert.equal(Number(row.total), 100, 'supplier, amount and date stay visible')
  // Another administrator: refused to reserve, to complete, to cancel; the error names the holder.
  const again = await svc.call('supplierInvoices.reserve', { invoiceId: inv.id }, admin2)
  assert.equal(again.status, 409)
  assert.match(again.body.error.message, /«owner» بيعدل الفاتورة حاليًا/)
  assert.match(again.body.error.message, /عند إكمالها أو انتهاء الحجز/)
  const s0 = await stock()
  const d0 = await debt()
  assert.equal((await convert(inv.id, null, admin2)).status, 409, 'direct request without a token')
  assert.equal((await convert(inv.id, r.token, admin2)).status, 409, "even with the holder's token")
  const cancel = await svc.call(
    'supplierInvoices.cancel',
    { invoiceId: inv.id, refund: 'none', clientRef: ref() },
    admin2
  )
  assert.equal(cancel.status, 409)
  assert.equal(await stock(), s0, 'no stock moved')
  assert.equal(await debt(), d0, 'no balance changed')
  assert.equal(
    (await one('SELECT status FROM supplier_pending_invoices WHERE id = $1', [inv.id])).status,
    'pending'
  )
  // The holder opening it again renews it with the same token.
  const renewed = ok(await svc.call('supplierInvoices.reserve', { invoiceId: inv.id }, owner))
  assert.equal(renewed.token, r.token)
})

test('after 30 minutes another user may take it; the former holder cannot write any more', async (t) => {
  if (!requireDb(t)) return
  const inv = await pending()
  const first = ok(await svc.call('supplierInvoices.reserve', { invoiceId: inv.id }, owner))
  minutes(29)
  assert.equal(
    (await svc.call('supplierInvoices.reserve', { invoiceId: inv.id }, admin2)).status,
    409
  )
  minutes(31)
  const second = ok(await svc.call('supplierInvoices.reserve', { invoiceId: inv.id }, admin2))
  assert.notEqual(second.token, first.token)
  // The old screen (the owner's expired token): refused, nothing written.
  const s0 = await stock()
  const stale = await convert(inv.id, first.token, owner)
  assert.equal(stale.status, 409)
  assert.equal(await stock(), s0)
  // The new holder completes it: stock once, the reservation cleared with the completion.
  const clientRef = ref()
  ok(await convert(inv.id, second.token, admin2, clientRef))
  assert.equal(await stock(), s0 + 10)
  // The same request again: the first result, nothing twice.
  const dup = ok(await convert(inv.id, second.token, admin2, clientRef))
  assert.equal(dup.duplicate, true)
  assert.equal(await stock(), s0 + 10)
  const row = await one(
    'SELECT status, reserved_by, reserve_token FROM supplier_pending_invoices WHERE id = $1',
    [inv.id]
  )
  assert.deepEqual(row, { status: 'converted', reserved_by: null, reserve_token: null })
  // A completed invoice cannot be reserved.
  const done = await svc.call('supplierInvoices.reserve', { invoiceId: inv.id }, owner)
  assert.equal(done.status, 409)
  assert.match(done.body.error.message, /أُكملت/)
})

test('leaving without completing gives it back; a crashed screen frees it at the deadline', async (t) => {
  if (!requireDb(t)) return
  const inv = await pending()
  const r = ok(await svc.call('supplierInvoices.reserve', { invoiceId: inv.id }, owner))
  // Another user cannot release it, even naming the token.
  assert.deepEqual(
    ok(await svc.call('supplierInvoices.release', { invoiceId: inv.id, token: r.token }, admin2)),
    { released: false }
  )
  assert.deepEqual(
    ok(await svc.call('supplierInvoices.release', { invoiceId: inv.id, token: r.token }, owner)),
    { released: true }
  )
  ok(await svc.call('supplierInvoices.reserve', { invoiceId: inv.id }, admin2))
  // admin2's application closes: nothing releases it; at 30 minutes it is free again.
  minutes(30)
  ok(await svc.call('supplierInvoices.reserve', { invoiceId: inv.id }, owner))
  // Cancelling by the holder clears the reservation with the cancellation.
  ok(
    await svc.call(
      'supplierInvoices.cancel',
      { invoiceId: inv.id, refund: 'none', clientRef: ref() },
      owner
    )
  )
  const row = await one('SELECT status, reserved_by FROM supplier_pending_invoices WHERE id = $1', [
    inv.id
  ])
  assert.deepEqual(row, { status: 'cancelled', reserved_by: null })
})

test('two users reserving at the same moment: exactly one owner', async (t) => {
  if (!requireDb(t)) return
  const inv = await pending()
  const tries = await Promise.all(
    [owner, admin2, owner, admin2, admin2].map((tok) =>
      svc.call('supplierInvoices.reserve', { invoiceId: inv.id }, tok)
    )
  )
  const won = tries.filter((x) => x.status === 200)
  const holder = (
    await one(
      'SELECT u.username FROM supplier_pending_invoices p JOIN users u ON u.id = p.reserved_by WHERE p.id = $1',
      [inv.id]
    )
  ).username
  // The winner's own repeats renew; the other user is refused every time, by the holder's name.
  for (const x of tries.filter((y) => y.status !== 200)) {
    assert.equal(x.status, 409)
    assert.match(x.body.error.message, new RegExp(`«${holder}»`))
  }
  assert.ok(won.length >= 1)
  assert.equal(new Set(won.map((x) => x.body.token)).size, 1, 'one reservation, one token')
})

test('without a reservation the workflow is unchanged; unauthorized users cannot reserve', async (t) => {
  if (!requireDb(t)) return
  const inv = await pending(50)
  // Nobody holds it: completing without a reservation works as before.
  const s0 = await stock()
  ok(await convert(inv.id, null, owner))
  assert.equal(await stock(), s0 + 10)
  // A cashier (preliminary invoices only) cannot reserve or release.
  const other = await pending()
  assert.equal(
    (await svc.call('supplierInvoices.reserve', { invoiceId: other.id }, cashier)).status,
    403
  )
  assert.equal(
    (await svc.call('supplierInvoices.release', { invoiceId: other.id, token: 'x' }, cashier))
      .status,
    403
  )
  // The cashier's own cancel is refused only while someone else holds it.
  ok(await svc.call('supplierInvoices.reserve', { invoiceId: other.id }, owner))
  const refused = await svc.call(
    'supplierInvoices.cancel',
    { invoiceId: other.id, refund: 'none', clientRef: ref() },
    cashier
  )
  assert.equal(refused.status, 409)
  assert.match(refused.body.error.message, /«owner»/)
})

test('debt-payment request: 5 minutes; the decision needs the valid reservation; it never approves by itself', async (t) => {
  if (!requireDb(t)) return
  const req = ok(
    await svc.call(
      'supplierPayments.create',
      { supplierId, amount: 30, currentShiftId: shift2.id, clientRef: ref() },
      admin2
    )
  ).request
  const d0 = await debt()
  const r = ok(await svc.call('supplierPayments.reserve', { requestId: req.id }, owner))
  assert.equal(r.minutes, 5)
  assert.equal(r.request.status, 'pending', 'reserving approves nothing')
  assert.equal(await debt(), d0, 'reserving changes no balance')
  const listed = ok(await svc.call('supplierPayments.list', { status: 'open' }, admin2)).find(
    (x) => x.id === req.id
  )
  assert.deepEqual([listed.reserved_active, listed.reserved_by_name], [true, 'owner'])
  assert.equal('reserve_token' in listed, false)
  // admin2: refused to reserve, approve, reject; named holder.
  const busy = await svc.call('supplierPayments.reserve', { requestId: req.id }, admin2)
  assert.equal(busy.status, 409)
  assert.match(busy.body.error.message, /«owner» بيعدل طلب السداد حاليًا/)
  assert.equal(
    (await svc.call('supplierPayments.approve', { requestId: req.id }, admin2)).status,
    409
  )
  assert.equal(
    (await svc.call('supplierPayments.reject', { requestId: req.id, note: 'لا إيصال' }, admin2))
      .status,
    409
  )
  assert.equal(await debt(), d0)
  // At 5 minutes it is free: admin2 takes it; the owner's old token cannot decide any more.
  minutes(4)
  assert.equal(
    (await svc.call('supplierPayments.reserve', { requestId: req.id }, admin2)).status,
    409
  )
  minutes(5)
  const r2 = ok(await svc.call('supplierPayments.reserve', { requestId: req.id }, admin2))
  const stale = await svc.call(
    'supplierPayments.approve',
    { requestId: req.id, reservationToken: r.token },
    owner
  )
  assert.equal(stale.status, 409)
  assert.equal(await debt(), d0)
  // The holder approves: the balance falls once and the reservation is cleared.
  ok(
    await svc.call(
      'supplierPayments.approve',
      { requestId: req.id, reservationToken: r2.token },
      admin2
    )
  )
  ok(
    await svc.call(
      'supplierPayments.approve',
      { requestId: req.id, reservationToken: r2.token },
      admin2
    )
  )
  assert.equal(await debt(), d0 - 30)
  const row = await one('SELECT status, reserved_by FROM supplier_payment_requests WHERE id = $1', [
    req.id
  ])
  assert.deepEqual(row, { status: 'approved', reserved_by: null })
  // A decided request cannot be reserved.
  assert.equal(
    (await svc.call('supplierPayments.reserve', { requestId: req.id }, owner)).status,
    409
  )
  // Requesters (no approval permission) cannot reserve.
  assert.equal(
    (await svc.call('supplierPayments.reserve', { requestId: req.id }, cashier)).status,
    403
  )
})

test('debt-payment request: reserved at once by two administrators → one owner; release works', async (t) => {
  if (!requireDb(t)) return
  const req = ok(
    await svc.call(
      'supplierPayments.create',
      { supplierId, amount: 20, currentShiftId: shift2.id, clientRef: ref() },
      admin2
    )
  ).request
  const tries = await Promise.all(
    [owner, admin2].map((tok) => svc.call('supplierPayments.reserve', { requestId: req.id }, tok))
  )
  assert.equal(tries.filter((x) => x.status === 200).length, 1)
  assert.equal(tries.filter((x) => x.status === 409).length, 1)
  const winner = tries.find((x) => x.status === 200)
  const winnerToken = winner === tries[0] ? owner : admin2
  ok(
    await svc.call(
      'supplierPayments.release',
      { requestId: req.id, token: winner.body.token },
      winnerToken
    )
  )
  // Free again; rejecting without a reservation (no one holds one) works as before.
  ok(await svc.call('supplierPayments.reject', { requestId: req.id, note: 'خطأ في المبلغ' }, owner))
})
