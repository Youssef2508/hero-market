'use strict'
// Integrity fixes from the 1.4.0 audit (migration 0011 and service changes):
//   - a closed shift is final (no sale, drawer movement, expense or till movement added, changed or
//     deleted afterwards), also under concurrency;
//   - one open shift per user, also for simultaneous requests;
//   - refunds go back through the customer's account before the drawer;
//   - the till never attaches a sale to another customer who merely shares a name;
//   - a supplier with a balance cannot be deleted; printer names cannot carry shell syntax;
//   - access is checked before the request body is validated.
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

let db, svc, owner, cashier
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const n = async (sql, p) => Number((await one(sql, p)).n)
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const sell = (token, shiftId, items, paymentType = 'نقدي', extra = {}) =>
  svc.call(
    'pos.checkout',
    { clientRef: crypto.randomUUID(), shiftId, paymentType, items, ...extra },
    token
  )
const debtOf = async (id) =>
  Number((await one('SELECT debt_balance FROM clients WHERE id = $1', [id])).debt_balance)
const drawerOut = async (shiftId) =>
  Number(
    (
      await one(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow'",
        [shiftId]
      )
    ).s
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('A', 'صنف أ', 5, 10, 500, 'قطعة'), ('B', 'صنف ب', 20, 50, 500, 'قطعة')"
  )
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a sale that commits while its shift is being closed is refused, not added to the closed shift', async (t) => {
  if (!requireDb(t)) return
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier))
  ok(await sell(cashier, shift.id, [{ barcode: 'A', qty: 1 }]))
  const before = await n('SELECT count(*) AS n FROM sales WHERE shift_id = $1', [shift.id])
  // Hold the shift exactly as shifts.close does while it computes the figures.
  const closer = await svc.pool.connect()
  try {
    await closer.query('BEGIN')
    await closer.query('SELECT 1 FROM shifts WHERE id = $1 FOR UPDATE', [shift.id])
    const pending = sell(cashier, shift.id, [{ barcode: 'A', qty: 1 }])
    const drawer = svc.pool
      .query(
        "INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES ($1, 'inflow', 5, 'x', LOCALTIMESTAMP(0))",
        [shift.id]
      )
      .then(
        () => null,
        (e) => e
      )
    await wait(400)
    await closer.query("UPDATE shifts SET status = 'closed' WHERE id = $1", [shift.id])
    await closer.query('COMMIT')
    const r = await pending
    assert.equal(r.status, 409, JSON.stringify(r.body))
    assert.match(r.body.error.message, /مغلقة/)
    assert.match(
      String((await drawer)?.message),
      /مغلقة/,
      'a drawer movement waiting for the close is refused too'
    )
  } finally {
    closer.release()
  }
  assert.equal(await n('SELECT count(*) AS n FROM sales WHERE shift_id = $1', [shift.id]), before)
})

test('a closed shift is final: drawer rows, expenses and till movements cannot be added, changed or deleted', async (t) => {
  if (!requireDb(t)) return
  const shift = ok(await svc.call('shifts.open', { startingCash: 100 }, owner))
  ok(
    await svc.call(
      'expenses.create',
      { amount: 12, description: 'كهرباء', currentShiftId: shift.id },
      owner
    )
  )
  const expense = await one('SELECT id FROM expenses WHERE shift_id = $1', [shift.id])
  const preview = ok(await svc.call('shifts.auditPreview', { shiftId: shift.id }, owner))
  ok(await svc.call('shifts.close', { shiftId: shift.id, actualCash: preview.expected }, owner))
  const saved = await one('SELECT expected_end_cash::text AS e FROM shifts WHERE id = $1', [
    shift.id
  ])

  const del = await svc.call('expenses.delete', { expenseId: expense.id }, owner)
  assert.equal(del.status, 409)
  assert.match(del.body.error.message, /مغلقة/)
  assert.equal(await n('SELECT count(*) AS n FROM expenses WHERE id = $1', [expense.id]), 1)
  for (const sql of [
    "INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES ($1, 'inflow', 1, 'x', LOCALTIMESTAMP(0))",
    'UPDATE safe_ledger SET amount = amount + 1 WHERE shift_id = $1',
    'DELETE FROM safe_ledger WHERE shift_id = $1'
  ])
    await assert.rejects(svc.pool.query(sql, [shift.id]), /مغلقة/, sql)
  assert.equal(
    (await one('SELECT expected_end_cash::text AS e FROM shifts WHERE id = $1', [shift.id])).e,
    saved.e
  )
})

test('two simultaneous "open shift" requests create exactly one open shift', async (t) => {
  if (!requireDb(t)) return
  await createUser(svc, { username: 'twin', pin: '2468', roleKey: 'cashier' })
  const twin = await login(svc, '2468')
  const results = await Promise.all(
    Array.from({ length: 4 }, () => svc.call('shifts.open', { startingCash: 0 }, twin))
  )
  assert.equal(results.filter((r) => r.status === 200).length, 1)
  assert.equal(
    await n(
      "SELECT count(*) AS n FROM shifts s JOIN users u ON u.id = s.user_id WHERE u.username = 'twin' AND s.status = 'open'"
    ),
    1
  )
})

test('cash refunds need an open drawer; they never go into a closed shift', async (t) => {
  if (!requireDb(t)) return
  await createUser(svc, { username: 'evening', pin: '1357', roleKey: 'cashier' })
  const evening = await login(svc, '1357')
  const s1 = ok(await svc.call('shifts.open', { startingCash: 0 }, evening))
  const sale = ok(await sell(evening, s1.id, [{ barcode: 'A', qty: 2 }]))
  const p = ok(await svc.call('shifts.auditPreview', { shiftId: s1.id }, owner))
  ok(await svc.call('shifts.close', { shiftId: s1.id, actualCash: p.expected }, evening))
  // The owner has no open shift now (closed above): refusing is better than changing a closed drawer.
  const item = await one('SELECT id FROM sale_items WHERE sale_id = $1', [sale.saleId])
  const refused = await svc.call('sales.returnItem', { saleItemId: item.id, quantity: 1 }, owner)
  assert.equal(refused.status, 409)
  assert.match(refused.body.error.message, /افتح وردية/)
  const closedOut = await drawerOut(s1.id)
  const s2 = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
  const r = ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: item.id, quantity: 1, currentShiftId: s2.id },
      owner
    )
  )
  assert.equal(r.cashRefund, 10)
  assert.equal(await drawerOut(s2.id), 10, 'paid from the open drawer')
  assert.equal(await drawerOut(s1.id), closedOut, 'the closed shift is untouched')
})

test('part-paid invoice: a return first reduces what is still owed, then pays cash', async (t) => {
  if (!requireDb(t)) return
  const sid = ok(await svc.call('shifts.current', {}, owner)).id // opened in the test above
  const sale = ok(
    await sell(owner, sid, [{ barcode: 'B', qty: 2 }], 'دفع جزئي', {
      paidAmount: 30,
      client: { id: null, name: 'عميل جزئي', phone: '01055500001', address: '' }
    })
  )
  assert.equal(sale.total, 100)
  assert.equal(await debtOf(sale.clientId), 70)
  const outBefore = await drawerOut(sid)
  const item = await one('SELECT id FROM sale_items WHERE sale_id = $1', [sale.saleId])
  // One of two items back (50): it comes off the 70 still owed; no cash leaves the drawer.
  const r1 = ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: item.id, quantity: 1, currentShiftId: sid },
      owner
    )
  )
  assert.deepEqual([r1.netRefund, r1.toAccount, r1.cashRefund], [50, 50, 0])
  assert.equal(await debtOf(sale.clientId), 20)
  assert.equal(await drawerOut(sid), outBefore)
  // The rest (50): 20 still owed, 30 in cash – exactly what the customer paid.
  const r2 = ok(
    await svc.call('sales.returnEntire', { saleId: sale.saleId, currentShiftId: sid }, owner)
  )
  assert.deepEqual([r2.refund, r2.toAccount, r2.cashRefund], [50, 20, 30])
  assert.equal(await debtOf(sale.clientId), 0)
  assert.equal(await drawerOut(sid), outBefore + 30)
  const s = await one(
    'SELECT on_account_open::text AS o, total_amount::text AS t FROM sales WHERE id = $1',
    [sale.saleId]
  )
  assert.deepEqual([Number(s.o), Number(s.t)], [0, 0])
})

test('store balance spent on an invoice comes back as balance, not cash', async (t) => {
  if (!requireDb(t)) return
  const sid = ok(await svc.call('shifts.current', {}, owner)).id
  const c = ok(
    await svc.call('clients.create', { name: 'عميل برصيد', phones: ['01055500002'] }, owner)
  )
  await svc.pool.query('UPDATE clients SET debt_balance = -100 WHERE id = $1', [c.id]) // store owes 100
  const sale = ok(
    await sell(
      owner,
      sid,
      [
        { barcode: 'B', qty: 1 },
        { barcode: 'A', qty: 1 }
      ],
      'نقدي',
      {
        client: { id: c.id, name: c.name },
        appliedCredit: 60,
        paidAmount: 0
      }
    )
  )
  assert.equal(sale.total, 0)
  assert.equal(await debtOf(c.id), -40)
  const outBefore = await drawerOut(sid)
  const r = ok(
    await svc.call('sales.returnEntire', { saleId: sale.saleId, currentShiftId: sid }, owner)
  )
  assert.deepEqual([r.refund, r.toAccount, r.cashRefund], [60, 60, 0])
  assert.equal(await debtOf(c.id), -100, 'the balance is back')
  assert.equal(await drawerOut(sid), outBefore, 'no cash for balance that was never paid in cash')
})

test('credit (آجل) and cash invoices refund as before', async (t) => {
  if (!requireDb(t)) return
  const sid = ok(await svc.call('shifts.current', {}, owner)).id
  const credit = ok(
    await sell(owner, sid, [{ barcode: 'A', qty: 3 }], 'آجل', {
      client: { id: null, name: 'عميل آجل', phone: '01055500003', address: '' }
    })
  )
  const outBefore = await drawerOut(sid)
  const r = ok(
    await svc.call('sales.returnEntire', { saleId: credit.saleId, currentShiftId: sid }, owner)
  )
  assert.deepEqual([r.toAccount, r.cashRefund], [30, 0])
  assert.equal(await debtOf(credit.clientId), 0)
  const cash = ok(await sell(owner, sid, [{ barcode: 'A', qty: 1 }]))
  const r2 = ok(
    await svc.call('sales.returnEntire', { saleId: cash.saleId, currentShiftId: sid }, owner)
  )
  assert.deepEqual([r2.toAccount, r2.cashRefund], [0, 10])
  assert.equal(await drawerOut(sid), outBefore + 10)
})

test('the till never puts a sale on another customer who only shares the name', async (t) => {
  if (!requireDb(t)) return
  const sid = ok(await svc.call('shifts.current', {}, owner)).id
  const ahmed = ok(
    await svc.call('clients.create', { name: 'أحمد علي', phones: ['01077700001'] }, owner)
  )
  // Same name, different phone: a new customer, not Ahmed's account.
  const other = ok(
    await sell(owner, sid, [{ barcode: 'A', qty: 1 }], 'آجل', {
      client: { id: null, name: 'أحمد علي', phone: '01077700002', address: '' }
    })
  )
  assert.notEqual(other.clientId, ahmed.id)
  assert.equal(await debtOf(ahmed.id), 0, "Ahmed's account is untouched")
  // The same phone (written differently) finds Ahmed.
  const same = ok(
    await sell(owner, sid, [{ barcode: 'A', qty: 1 }], 'نقدي', {
      client: { id: null, name: 'أ. علي', phone: '0107 770 0001', address: '' }
    })
  )
  assert.equal(same.clientId, ahmed.id)
  // A name alone shared by two customers is ambiguous: the cashier must choose.
  const amb = await sell(owner, sid, [{ barcode: 'A', qty: 1 }], 'نقدي', {
    client: { id: null, name: 'أحمد علي', phone: '', address: '' }
  })
  assert.equal(amb.status, 409)
  assert.match(amb.body.error.message, /أكثر من عميل/)
})

test('suppliers with a balance cannot be deleted; printer names cannot carry shell syntax', async (t) => {
  if (!requireDb(t)) return
  const sup = ok(await svc.call('suppliers.create', { name: 'مورد مدين' }, owner))
  await svc.pool.query('UPDATE suppliers SET debt_balance = 250 WHERE id = $1', [sup.id])
  const del = await svc.call('suppliers.delete', { supplierId: sup.id }, owner)
  assert.equal(del.status, 409)
  assert.equal(await n('SELECT count(*) AS n FROM suppliers WHERE id = $1', [sup.id]), 1)
  for (const bad of ['HP" & calc.exe & "', "Printer'; rm", 'P$env:x', 'A`b'])
    assert.equal(
      (await svc.call('settings.update', { values: { printer_name: bad } }, owner)).status,
      400,
      bad
    )
  ok(await svc.call('settings.update', { values: { printer_name: 'XP-80C (copy 1)' } }, owner))
})

test('access is checked before the body: no schema details for callers without access', async (t) => {
  if (!requireDb(t)) return
  const anon = await svc.call('users.create', { nonsense: true })
  assert.equal(anon.status, 401)
  assert.equal(anon.body.error.details, undefined)
  const denied = await svc.call('users.create', { nonsense: true }, cashier)
  assert.equal(denied.status, 403)
  const invalid = await svc.call('users.create', { nonsense: true }, owner)
  assert.equal(invalid.status, 400, 'an authorised caller still gets validation errors')
})
