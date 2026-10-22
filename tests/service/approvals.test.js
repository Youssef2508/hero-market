'use strict'
// Supervisor approvals (stage 4 phase 3, owner decisions 2026-10-14):
//   - cashiers may return items or invoices only with a supervisor's approval and a reason;
//   - closing a shift with a cash difference above EGP 50 needs a supervisor's acknowledgement;
//   - approvals, refusals and failed attempts are all recorded; a refused or failed approval changes
//     nothing else.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts,
  passwordFor
} = require('./helpers')

let db, svc, owner, manager, cashier, cashier2, stock, shift
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const supervisor = (decision) => ({
  username: 'manager',
  password: passwordFor('9517'),
  ...(decision ? { decision } : {})
})
const sell = async (items, paymentType = 'نقدي', extra = {}) =>
  ok(
    await svc.call(
      'pos.checkout',
      { clientRef: crypto.randomUUID(), shiftId: shift.id, paymentType, items, ...extra },
      cashier
    )
  )
const itemOf = async (saleId) =>
  one('SELECT id FROM sale_items WHERE sale_id = $1 ORDER BY id LIMIT 1', [saleId])

/** Everything a return could change; compared before and after a refused attempt. */
async function state(saleId) {
  return {
    stock: (await one("SELECT stock_qty::text AS s FROM products WHERE barcode = 'W'")).s,
    sale: await one('SELECT total_amount::text, discount::text FROM sales WHERE id = $1', [saleId]),
    items: await q(
      'SELECT returned_qty::text, total_price::text FROM sale_items WHERE sale_id = $1 ORDER BY id',
      [saleId]
    ),
    movements: (await one('SELECT count(*)::int AS n FROM stock_movements')).n,
    drawer: (await one('SELECT count(*)::int AS n FROM safe_ledger')).n,
    returns: (await one('SELECT count(*)::int AS n FROM sale_returns')).n,
    debt: await q('SELECT id, debt_balance::text FROM clients ORDER BY id')
  }
}

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'manager', pin: '9517', roleKey: 'manager' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await createUser(svc, { username: 'cashier2', pin: '5174', roleKey: 'cashier' })
  await createUser(svc, { username: 'stock', pin: '2468', roleKey: 'inventory' })
  // A supervisor who has not chosen a password yet (still on the old PIN).
  await createUser(svc, {
    username: 'pinmanager',
    pin: '1357',
    roleKey: 'manager',
    legacyPin: true
  })
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('W', 'مياه', 4, 10, 100, 'زجاجة')"
  )
  owner = await login(svc, '8642')
  manager = await login(svc, '9517')
  cashier = await login(svc, '5173')
  cashier2 = await login(svc, '5174')
  stock = await login(svc, '2468')
  shift = ok(await svc.call('shifts.open', { startingCash: 100 }, cashier))
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a cashier can open an invoice by number but cannot return without a supervisor', async (t) => {
  if (!requireDb(t)) return
  const sale = await sell([{ barcode: 'W', qty: 3 }])
  const detail = ok(await svc.call('sales.detail', { saleId: sale.saleId }, cashier))
  assert.equal(detail.items.length, 1)
  const item = await itemOf(sale.saleId)
  const before = await state(sale.saleId)
  const approvalsBefore = (await one('SELECT count(*)::int AS n FROM approvals')).n

  const noReason = await svc.call(
    'sales.returnItem',
    { saleItemId: item.id, quantity: 1, approver: supervisor() },
    cashier
  )
  assert.equal(noReason.status, 400, 'a reason is mandatory')
  const noSupervisor = await svc.call(
    'sales.returnItem',
    { saleItemId: item.id, quantity: 1, reason: 'عبوة تالفة' },
    cashier
  )
  assert.equal(noSupervisor.status, 403)
  assert.equal(noSupervisor.body.error.code, 'approval_required')
  assert.equal(noSupervisor.body.error.details.amount, 10, 'the terminal can show the amount')
  const whole = await svc.call(
    'sales.returnEntire',
    { saleId: sale.saleId, reason: 'العميل ألغى' },
    cashier
  )
  assert.equal(whole.body.error.code, 'approval_required')
  assert.deepEqual(await state(sale.saleId), before, 'nothing changed')
  assert.equal((await one('SELECT count(*)::int AS n FROM approvals')).n, approvalsBefore)
  // Users without any return permission are refused outright.
  const inv = await svc.call(
    'sales.returnItem',
    { saleItemId: item.id, quantity: 1, reason: 'x x x', approver: supervisor() },
    stock
  )
  assert.equal(inv.status, 403)
  assert.equal(inv.body.error.code, 'forbidden')
})

test('failed and refused approvals are recorded and change nothing else', async (t) => {
  if (!requireDb(t)) return
  const sale = await sell([{ barcode: 'W', qty: 2 }])
  const item = await itemOf(sale.saleId)
  const before = await state(sale.saleId)
  const attempt = (approver) =>
    svc.call(
      'sales.returnItem',
      { saleItemId: item.id, quantity: 1, reason: 'منتهي الصلاحية', approver },
      cashier
    )
  const cases = [
    [{ username: 'manager', password: 'Wrong-pass-1' }, 'invalid_credentials'],
    [{ username: 'nobody', password: 'Wrong-pass-1' }, 'invalid_credentials'],
    [{ username: 'cashier2', password: passwordFor('5174') }, 'no_authority'],
    [{ username: 'cashier', password: passwordFor('5173') }, 'same_user'],
    [{ username: 'pinmanager', password: '1357' }, 'password_not_set'],
    [supervisor('refuse'), 'refused']
  ]
  for (const [approver, failure] of cases) {
    const r = await attempt(approver)
    assert.equal(r.status, 403, failure)
    assert.equal(r.body.error.code, 'approval_refused', failure)
    assert.equal(r.body.error.details.failure, failure)
  }
  assert.deepEqual(await state(sale.saleId), before, 'no stock, money or invoice change')
  const rows = await q(
    `SELECT decision, failure, approver_username, requested_username, subject_type, subject_id, amount::text, reason
       FROM approvals WHERE subject_id = $1 ORDER BY id`,
    [item.id]
  )
  assert.deepEqual(
    rows.map((r) => [r.decision, r.failure, r.approver_username]),
    [
      ['failed', 'invalid_credentials', 'manager'],
      ['failed', 'invalid_credentials', 'nobody'],
      ['failed', 'no_authority', 'cashier2'],
      ['failed', 'same_user', 'cashier'],
      ['failed', 'password_not_set', 'pinmanager'],
      ['refused', null, 'manager']
    ]
  )
  assert.ok(
    rows.every(
      (r) =>
        r.requested_username === 'cashier' &&
        r.subject_type === 'sale_item' &&
        r.amount === '10.00' &&
        r.reason === 'منتهي الصلاحية'
    )
  )
  const logs = await q(
    "SELECT action_type FROM system_logs WHERE action_type IN ('approval_failed', 'approval_refused')"
  )
  assert.equal(logs.length, 6, 'each failure and refusal is in the event log')
  // Wrong supervisor passwords count towards the sign-in lockout (the refusal above was a correct
  // password, which resets this terminal's counter).
  for (let i = 0; i < 5; i++) await attempt({ username: 'manager', password: `Bad-pass-${i}` })
  assert.equal((await attempt(supervisor())).status, 429, 'locked after 5 wrong passwords')
  svc.app.loginGuard.clear()
})

test('an approved cashier return is applied once, with the reason and the supervisor recorded', async (t) => {
  if (!requireDb(t)) return
  const sale = await sell([{ barcode: 'W', qty: 4 }])
  const item = await itemOf(sale.saleId)
  const stockBefore = Number(
    (await one("SELECT stock_qty FROM products WHERE barcode = 'W'")).stock_qty
  )
  const r = ok(
    await svc.call(
      'sales.returnItem',
      {
        saleItemId: item.id,
        quantity: 1,
        currentShiftId: shift.id,
        reason: 'عبوة مثقوبة',
        approver: supervisor()
      },
      cashier
    )
  )
  assert.equal(r.netRefund, 10)
  assert.equal(
    Number((await one("SELECT stock_qty FROM products WHERE barcode = 'W'")).stock_qty),
    stockBefore + 1
  )
  const ret = await one('SELECT * FROM sale_returns WHERE sale_item_id = $1', [item.id])
  assert.deepEqual(
    [ret.username, ret.reason, Number(ret.refund), Number(ret.quantity), ret.shift_id],
    ['cashier', 'عبوة مثقوبة', 10, 1, shift.id]
  )
  const appr = await one('SELECT * FROM approvals WHERE id = $1', [ret.approval_id])
  assert.deepEqual(
    [appr.decision, appr.approver_username, appr.requested_username, appr.self_approved],
    ['approved', 'manager', 'cashier', false]
  )
  assert.equal(Number(appr.amount), 10)
  const log = await one(
    "SELECT description FROM system_logs WHERE action_type = 'sale_return' ORDER BY id DESC LIMIT 1"
  )
  assert.match(log.description, /عبوة مثقوبة/)
  assert.match(log.description, /manager/)
  // The approval belonged to that request: the next return needs approval again.
  const again = await svc.call(
    'sales.returnItem',
    { saleItemId: item.id, quantity: 1, reason: 'عبوة مثقوبة' },
    cashier
  )
  assert.equal(again.body.error.code, 'approval_required')
  // A whole invoice, approved.
  const whole = ok(
    await svc.call(
      'sales.returnEntire',
      {
        saleId: sale.saleId,
        currentShiftId: shift.id,
        reason: 'العميل ألغى',
        approver: supervisor()
      },
      cashier
    )
  )
  assert.equal(whole.refund, 30)
  const all = await q(
    'SELECT sale_item_id, refund::text FROM sale_returns WHERE sale_id = $1 ORDER BY id',
    [sale.saleId]
  )
  assert.deepEqual(
    all.map((x) => [x.sale_item_id, x.refund]),
    [
      [item.id, '10.00'],
      [null, '30.00']
    ]
  )
})

test('supervisors and administrators return directly; the record still says who and why', async (t) => {
  if (!requireDb(t)) return
  const sale = await sell([{ barcode: 'W', qty: 2 }])
  const item = await itemOf(sale.saleId)
  ok(await svc.call('sales.returnItem', { saleItemId: item.id, quantity: 1 }, manager))
  ok(await svc.call('sales.returnEntire', { saleId: sale.saleId, reason: 'خطأ في الإدخال' }, owner))
  const rows = await q(
    'SELECT username, reason, approval_id FROM sale_returns WHERE sale_id = $1 ORDER BY id',
    [sale.saleId]
  )
  assert.deepEqual(
    rows.map((r) => [r.username, r.reason, r.approval_id]),
    [
      ['manager', null, null],
      ['owner', 'خطأ في الإدخال', null]
    ]
  )
})

test('credit sale: an approved return lowers the customer debt exactly once', async (t) => {
  if (!requireDb(t)) return
  const sale = await sell([{ barcode: 'W', qty: 5 }], 'آجل', {
    client: { id: null, name: 'عميل آجل', phone: '01011112222', address: '' }
  })
  const client = await one('SELECT id, debt_balance FROM clients WHERE id = $1', [sale.clientId])
  assert.equal(Number(client.debt_balance), 50)
  const item = await itemOf(sale.saleId)
  ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: item.id, quantity: 2, reason: 'زيادة في الطلب', approver: supervisor() },
      cashier
    )
  )
  assert.equal(
    Number((await one('SELECT debt_balance FROM clients WHERE id = $1', [client.id])).debt_balance),
    30
  )
})

// Owner, 2026-10-22 (D-073): a close is never refused, however large the difference – it is saved
// with the close and the owner deals with it from «الورديات». No approval is asked or recorded.
test('shift close: any shortage or surplus closes at once; the difference is in the report', async (t) => {
  if (!requireDb(t)) return
  const close = (token, s, actualCash, extra = {}) =>
    svc.call('shifts.close', { shiftId: s.id, actualCash, ...extra }, token)
  const expectedOf = async (s) =>
    ok(await svc.call('shifts.auditPreview', { shiftId: s.id }, owner)).expected

  // 6,000 short: closes, nothing to approve, the cashier sees the difference only now, in the report.
  const s1 = ok(await svc.call('shifts.open', { startingCash: 6000 }, cashier2))
  const short = ok(await close(cashier2, s1, (await expectedOf(s1)) - 6000))
  assert.equal(short.report.variance.cash, -6000)
  assert.equal(short.acknowledgedBy ?? null, null)
  const row = await one(
    'SELECT status, difference::float8 d, difference_approval_id FROM shifts WHERE id = $1',
    [s1.id]
  )
  assert.deepEqual([row.status, row.d, row.difference_approval_id], ['closed', -6000, null])

  // 6,000 over: closes the same way; an approver sent by an old till is ignored.
  const s2 = ok(await svc.call('shifts.open', { startingCash: 100 }, cashier2))
  const over = ok(
    await close(cashier2, s2, (await expectedOf(s2)) + 6000, { approver: supervisor() })
  )
  assert.equal(over.report.variance.cash, 6000)
  assert.equal(
    (await one('SELECT difference_approval_id FROM shifts WHERE id = $1', [s2.id]))
      .difference_approval_id,
    null
  )
  assert.equal(
    (await one("SELECT COUNT(*)::int n FROM approvals WHERE subject_type = 'shift'")).n,
    0,
    'no approval asked or recorded'
  )
  // The owner sees both in the shift details.
  const details = ok(await svc.call('shifts.details', { shiftId: s1.id }, owner))
  assert.equal(details.report.variance.cash, -6000)
})

test('approvals and returns are part of the backup', async (t) => {
  if (!requireDb(t)) return
  const { TABLES } = require('../../src/server/modules/backup')
  assert.ok(TABLES.includes('approvals') && TABLES.includes('sale_returns'))
  assert.ok(
    TABLES.indexOf('approvals') < TABLES.indexOf('shifts'),
    'approvals restored before the shifts that refer to them'
  )
})
