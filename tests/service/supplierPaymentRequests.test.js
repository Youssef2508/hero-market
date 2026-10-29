'use strict'
// Supplier debt-payment requests (owner, 1.5.2, D-090, reversal D-100) and the itemized shift
// report (D-091).
// The cash leaves the drawer when the request is made; the supplier's balance falls only when an
// administrator approves, exactly once; a rejected or cancelled request is reversed in full (the
// cash back to its shift's drawer, or to the treasury once that shift has closed), never a loss.
// Every money event of the shift is itemized in its report.
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

let db, svc, owner, cashier, plain, shift, supplierId, otherSupplierId, clientId
const ref = () => crypto.randomUUID()
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r, what = '') => {
  assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`)
  return r.body
}
const r2 = (n) => Math.round(Number(n) * 100) / 100
const debtOf = async (id) =>
  r2((await one('SELECT debt_balance FROM suppliers WHERE id = $1', [id])).debt_balance)
const drawer = async () =>
  ok(await svc.call('shifts.liveSummary', { shiftId: shift.id }, owner)).drawer.expected
const treasuryBalance = async () =>
  r2((await one('SELECT COALESCE(SUM(amount), 0) b FROM treasury_ledger')).b)
const request = (amount, extra = {}, token = cashier) =>
  svc.call(
    'supplierPayments.create',
    { supplierId, amount, currentShiftId: shift.id, clientRef: ref(), ...extra },
    token
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await createUser(svc, { username: 'plain', pin: '6205', roleKey: 'cashier' })
  // The administrator grants the request (and collections) to one cashier's role, a copy of
  // «كاشير»: the other cashier keeps the default role.
  await svc.pool.query(`INSERT INTO roles (key, name, description)
    VALUES (NULL, 'كاشير سداد', 'كاشير يسدد الموردين') ON CONFLICT DO NOTHING`)
  const roleId = (await one("SELECT id FROM roles WHERE name = 'كاشير سداد'")).id
  await svc.pool.query(
    `INSERT INTO role_permissions (role_id, permission)
     SELECT $1::int, permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = 'cashier'
     UNION SELECT $1::int, 'suppliers.payment_request' UNION SELECT $1::int, 'customers.payments'`,
    [roleId]
  )
  await svc.pool.query("UPDATE users SET role_id = $1 WHERE username = 'cashier'", [roleId])
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  plain = await login(svc, '6205')
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('P', 'صنف', 10, 20, 100, 'قطعة')"
  )
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الألبان' }, owner)).id
  otherSupplierId = ok(await svc.call('suppliers.create', { name: 'مورد آخر' }, owner)).id
  for (const [id, total] of [
    [supplierId, 1000],
    [otherSupplierId, 300]
  ])
    ok(
      await svc.call(
        'suppliers.addPurchase',
        { supplierId: id, total_amount: total, paid_amount: 0, payment_type: 'آجل' },
        owner
      )
    )
  clientId = ok(
    await svc.call('clients.create', { name: 'أم أحمد', phone: '01012345678' }, owner)
  ).id
  ok(await svc.call('treasury.record', { kind: 'deposit', amount: 500, clientRef: ref() }, owner))
  shift = ok(await svc.call('shifts.open', { startingCash: 1000 }, cashier))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('the two permissions: administrators by default; a cashier only when granted', async (t) => {
  if (!requireDb(t)) return
  for (const p of ['suppliers.payment_request', 'suppliers.payment_approve']) {
    const holders = (
      await q(
        'SELECT r.key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission = $1 AND r.key IS NOT NULL ORDER BY 1',
        [p]
      )
    ).map((x) => x.key)
    assert.deepEqual(holders, ['store_admin', 'super_admin'], p)
  }
  const plainShift = ok(await svc.call('shifts.open', { startingCash: 100 }, plain))
  const refused = await svc.call(
    'supplierPayments.create',
    { supplierId, amount: 10, currentShiftId: plainShift.id, clientRef: ref() },
    plain
  )
  assert.equal(refused.status, 403)
  ok(
    await svc.call(
      'shifts.close',
      { shiftId: plainShift.id, actualCash: 100, clientRef: ref() },
      plain
    )
  )
  // The requester cannot approve.
  assert.equal((await svc.call('supplierPayments.pendingCount', {}, cashier)).status, 403)
  assert.equal((await svc.call('supplierPayments.approve', { requestId: 1 }, cashier)).status, 403)
})

test('a request: the cash leaves the drawer at once, the balance waits, the administrator is told', async (t) => {
  if (!requireDb(t)) return
  const d0 = await drawer()
  const r = ok(await request(250, { note: 'دفعة من حساب الشهر' })).request
  assert.equal(r.status, 'pending')
  assert.equal(r.status_label, 'بانتظار الاعتماد')
  assert.equal(await drawer(), r2(d0 - 250), 'out of the drawer now')
  assert.equal(await debtOf(supplierId), 1000, 'the balance does not fall before approval')
  const notice = ok(await svc.call('supplierPayments.pendingCount', {}, owner))
  assert.deepEqual([notice.pending, notice.pendingAmount], [1, 250])
  const move = await one('SELECT * FROM safe_ledger WHERE id = $1', [r.ledger_id])
  assert.equal(move.kind, 'supplier_payment_request')
  assert.deepEqual(
    [move.ref_type, move.ref_id, move.party, Number(move.amount), move.type],
    ['supplier_payment_request', r.id, 'مورد الألبان', 250, 'outflow']
  )
  // The requester sees their own; the administrator sees all.
  assert.equal(ok(await svc.call('supplierPayments.list', {}, cashier)).length, 1)
  assert.equal(
    ok(await svc.call('supplierPayments.list', { status: 'pending' }, owner))[0].id,
    r.id
  )
})

test('a double click or a retry records one request and one cash movement', async (t) => {
  if (!requireDb(t)) return
  const clientRef = ref()
  const d0 = await drawer()
  const tries = await Promise.all([1, 2, 3, 4].map(() => request(40, { clientRef })))
  tries.forEach((x) => ok(x))
  assert.equal(new Set(tries.map((x) => x.body.request.id)).size, 1)
  assert.equal(tries.filter((x) => x.body.duplicate).length, 3)
  assert.equal(await drawer(), r2(d0 - 40))
  assert.equal(
    (
      await one('SELECT count(*)::int n FROM supplier_payment_requests WHERE client_ref = $1', [
        clientRef
      ])
    ).n,
    1
  )
})

test('refused: more than is owed after pending requests, more than the drawer, no shift', async (t) => {
  if (!requireDb(t)) return
  // Owed 1000; 290 pending: at most 710.
  const over = await request(711)
  assert.equal(over.status, 400)
  assert.match(over.body.error.message, /710\.00/)
  // The drawer: 1000 − 290 = 710 expected; another supplier owed 300 cannot take 800 either way.
  const big = await svc.call(
    'supplierPayments.create',
    { supplierId: otherSupplierId, amount: 300, currentShiftId: shift.id, clientRef: ref() },
    cashier
  )
  ok(big)
  const drawerShort = await request(500)
  assert.equal(drawerShort.status, 400)
  assert.match(drawerShort.body.error.message, /النقدية المتوقعة في الدرج/)
  // An administrator with no shift: the cash comes from a drawer, so a shift is needed.
  const noShift = await svc.call(
    'supplierPayments.create',
    { supplierId, amount: 10, clientRef: ref() },
    owner
  )
  assert.equal(noShift.status, 409)
  assert.equal(noShift.body.error.code, 'shift_required')
})

test('approval: the balance falls exactly once, even approved twice at once; no second cash movement', async (t) => {
  if (!requireDb(t)) return
  const [r] = ok(await svc.call('supplierPayments.list', { status: 'pending' }, owner)).filter(
    (x) => x.amount === 250
  )
  const moves0 = (await one('SELECT count(*)::int n FROM safe_ledger')).n
  const t0 = await treasuryBalance()
  const d0 = await drawer()
  const tries = await Promise.all(
    [1, 2, 3].map(() => svc.call('supplierPayments.approve', { requestId: r.id }, owner))
  )
  tries.forEach((x) => ok(x))
  assert.equal(await debtOf(supplierId), 750)
  assert.equal(
    (
      await one(
        "SELECT count(*)::int n FROM supplier_ledger WHERE supplier_id = $1 AND type = 'payment' AND description LIKE $2",
        [supplierId, `%طلب #${r.id} %`]
      )
    ).n,
    1
  )
  assert.equal((await one('SELECT count(*)::int n FROM safe_ledger')).n, moves0)
  assert.equal(await treasuryBalance(), t0)
  assert.equal(await drawer(), d0)
  // Once approved it cannot be rejected or settled.
  assert.equal(
    (await svc.call('supplierPayments.reject', { requestId: r.id, note: 'خطأ' }, owner)).status,
    409
  )
  const log = await one(
    "SELECT description FROM system_logs WHERE action_type = 'supplier_payment_approve' ORDER BY id DESC LIMIT 1"
  )
  assert.match(log.description, /خُصم 250\.00/)
})

test('rejected or cancelled: the whole transaction reversed, once; the balance never moves (D-100)', async (t) => {
  if (!requireDb(t)) return
  const list = ok(await svc.call('supplierPayments.list', { status: 'pending' }, owner))
  const forty = list.find((x) => x.amount === 40)
  const other = list.find((x) => x.supplier_id === otherSupplierId)
  const d0 = await drawer()
  const debt0 = await debtOf(supplierId)
  const otherDebt0 = await debtOf(otherSupplierId)
  // A reason is required.
  assert.equal(
    (await svc.call('supplierPayments.reject', { requestId: forty.id, note: '' }, owner)).status,
    400
  )
  // The administrator rejects: the 40 goes back into the request's open shift drawer, once, even
  // rejected three times at once.
  const tries = await Promise.all(
    [1, 2, 3].map(() =>
      svc.call(
        'supplierPayments.reject',
        { requestId: forty.id, note: 'المورد ينكر الاستلام' },
        owner
      )
    )
  )
  tries.forEach((x) => ok(x))
  const rej = ok(await svc.call('supplierPayments.list', { status: 'rejected' }, owner)).find(
    (x) => x.id === forty.id
  )
  assert.deepEqual(
    [rej.status, rej.reversed_to, rej.restored_label],
    ['rejected', 'shift', 'أُعيد إلى درج الوردية']
  )
  assert.equal(await drawer(), r2(d0 + 40), 'the cash is back in the drawer')
  assert.equal(await debtOf(supplierId), debt0, 'the supplier balance never moved')
  const back = await q(
    "SELECT shift_id, type, amount::float8 a, kind FROM safe_ledger WHERE ref_type = 'supplier_payment_request' AND ref_id = $1 ORDER BY id",
    [forty.id]
  )
  assert.deepEqual(back, [
    { shift_id: shift.id, type: 'outflow', a: 40, kind: 'supplier_payment_request' },
    { shift_id: shift.id, type: 'inflow', a: 40, kind: 'supplier_payment_reversal' }
  ])
  // A rejected request cannot be approved, cancelled or rejected again into money.
  assert.equal(
    (await svc.call('supplierPayments.approve', { requestId: forty.id }, owner)).status,
    409
  )
  // The cashier cancels their own pending request: reversed the same way.
  const d1 = await drawer()
  assert.equal(
    (await svc.call('supplierPayments.cancel', { requestId: other.id, note: '' }, cashier)).status,
    400
  )
  ok(
    await svc.call(
      'supplierPayments.cancel',
      { requestId: other.id, note: 'سجلته بالخطأ' },
      cashier
    )
  )
  ok(
    await svc.call(
      'supplierPayments.cancel',
      { requestId: other.id, note: 'سجلته بالخطأ' },
      cashier
    )
  )
  assert.equal(await drawer(), r2(d1 + 300))
  assert.equal(await debtOf(otherSupplierId), otherDebt0)
  // Another user's request cannot be cancelled by a cashier; the plain cashier has no permission.
  const third = ok(await request(10)).request
  assert.equal(
    (await svc.call('supplierPayments.cancel', { requestId: third.id, note: 'ليس طلبي' }, plain))
      .status,
    403
  )
  // Nothing was an expense or a loss.
  assert.equal(
    (await one("SELECT count(*)::int n FROM expenses WHERE description LIKE '%سداد%'")).n,
    0
  )
  const audit = (
    await q(
      "SELECT action_type FROM system_logs WHERE action_type LIKE 'supplier_payment_%' ORDER BY id"
    )
  ).map((x) => x.action_type)
  for (const a of [
    'supplier_payment_request',
    'supplier_payment_approve',
    'supplier_payment_reject',
    'supplier_payment_cancel'
  ])
    assert.ok(audit.includes(a), a)
  assert.equal(audit.filter((x) => x === 'supplier_payment_reject').length, 1, 'logged once')
})

test('the shift report itemizes every money event and reconciles with the drawer', async (t) => {
  if (!requireDb(t)) return
  // A sale on credit for the customer, then her collection in the shift (cash and InstaPay).
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: ref(),
        shiftId: shift.id,
        paymentType: 'آجل',
        client: { id: clientId, name: 'أم أحمد' },
        items: [{ barcode: 'P', qty: 5 }]
      },
      cashier
    )
  )
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: ref(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'P', qty: 2 }]
      },
      cashier
    )
  )
  ok(
    await svc.call(
      'clients.repay',
      { clientId, amount: 60, currentShiftId: shift.id, destination: 'shift', clientRef: ref() },
      cashier
    )
  )
  ok(
    await svc.call(
      'clients.repay',
      {
        clientId,
        amount: 25,
        currentShiftId: shift.id,
        destination: 'shift',
        method: 'instapay',
        clientRef: ref()
      },
      cashier
    )
  )
  const live = ok(await svc.call('shifts.details', { shiftId: shift.id }, owner))
  const rep = live.report
  // Collections: one line each, with the customer, method, time and who; never a sale.
  assert.equal(rep.events.collections.count, 2)
  assert.deepEqual(
    rep.events.collections.lines.map((l) => [
      l.party.startsWith('أم أحمد'),
      l.method,
      l.amount,
      l.username,
      l.refType,
      l.refId
    ]),
    [
      [true, 'cash', 60, 'cashier', 'client', clientId],
      [true, 'instapay', 25, 'cashier', 'client', clientId]
    ]
  )
  assert.equal(rep.events.collections.total, rep.collections)
  assert.equal(rep.totalSales, 140, 'collections are not sales (5 × 20 on credit + 2 × 20 cash)')
  // Supplier payments: the four requests made in the shift, each with its status; the two
  // reversed ones came back into this drawer (D-100).
  const sp = rep.events.supplierPayments
  assert.equal(
    sp.total,
    r2(
      rep.supplierPayments.requests +
        rep.supplierPayments.withInvoices +
        rep.supplierPayments.settlements
    )
  )
  assert.deepEqual(
    sp.lines.map((l) => [l.party, l.amount, l.requestStatusLabel]),
    [
      ['مورد الألبان', 250, 'معتمد'],
      ['مورد الألبان', 40, 'مرفوض – أُعيد المبلغ'],
      ['مورد آخر', 300, 'ألغاه الكاشير – أُعيد المبلغ'],
      ['مورد الألبان', 10, 'بانتظار الاعتماد']
    ]
  )
  assert.deepEqual(
    rep.events.supplierReversals.lines.map((l) => [
      l.party,
      l.amount,
      l.type,
      l.requestStatusLabel
    ]),
    [
      ['مورد الألبان', 40, 'inflow', 'مرفوض – أُعيد المبلغ'],
      ['مورد آخر', 300, 'inflow', 'ألغاه الكاشير – أُعيد المبلغ']
    ]
  )
  assert.equal(rep.supplierPayments.reversed, 340)
  assert.deepEqual(
    [
      rep.supplierRequests.count,
      rep.supplierRequests.total,
      rep.supplierRequests.approved.total,
      rep.supplierRequests.reversed.toShift,
      rep.supplierRequests.pending.total
    ],
    [4, 600, 250, 340, 10]
  )
  // Reconciliation: opening + cash sales + cash collections − requests + reversals = drawer.
  assert.equal(rep.expected.cash, r2(1000 + 40 + 60 - 600 + 340))
  assert.equal(rep.expected.instapay, 25)
  // Close: the saved report keeps the lines, and the printed report lists them.
  const closed = ok(
    await svc.call(
      'shifts.close',
      { shiftId: shift.id, actualCash: 840, actual: { instapay: 25 }, clientRef: ref() },
      cashier
    )
  )
  const saved = (await one('SELECT report FROM shift_closings WHERE shift_id = $1', [shift.id]))
    .report
  const report = typeof saved === 'string' ? JSON.parse(saved) : saved
  assert.equal(report.events.supplierPayments.count, 4)
  assert.equal(report.variance.cash, 0)
  const { buildCloseReportLines } = await import('../../src/shared/reportLines.mjs')
  const lines = buildCloseReportLines(report, { store: { name: 'Hero Market' } })
  const textOf = lines.join('\n')
  assert.match(textOf, /تحصيلات ديون العملاء/)
  assert.match(textOf, /أم أحمد.*\(انستا باي\)\|25\.00/)
  assert.match(textOf, /مدفوعات الموردين/)
  assert.match(textOf, /طلب سداد #\d+ · بانتظار الاعتماد|طلب سداد #\d+ · معتمد/)
  assert.match(textOf, /طلبات سداد موردين من الدرج\|600\.00/)
  assert.match(textOf, /عاد للدرج من طلبات سداد مرفوضة\/ملغاة\|340\.00/)
  assert.match(textOf, /عودة مبالغ طلبات سداد مرفوضة أو ملغاة/)
  assert.ok(closed)
  // After the close, the last pending request is rejected: its 10 goes to the treasury, against
  // the closed shift and the request; the closed shift's saved close is not rewritten.
  const pendingReq = ok(await svc.call('supplierPayments.list', { status: 'pending' }, owner))[0]
  const t0 = await treasuryBalance()
  const debt0 = await debtOf(supplierId)
  const rejected = ok(
    await svc.call(
      'supplierPayments.reject',
      { requestId: pendingReq.id, note: 'لم يُسلَّم' },
      owner
    )
  ).request
  ok(
    await svc.call(
      'supplierPayments.reject',
      { requestId: pendingReq.id, note: 'لم يُسلَّم' },
      owner
    )
  )
  assert.deepEqual(
    [rejected.reversed_to, rejected.restored_label],
    ['treasury', 'أُعيد إلى الخزنة (الوردية مغلقة)']
  )
  assert.equal(await treasuryBalance(), r2(t0 + 10), 'credited to the treasury once')
  assert.equal(await debtOf(supplierId), debt0)
  const entry = await one(
    "SELECT kind, amount::float8 a, shift_id, ref_type, ref_id FROM treasury_ledger WHERE kind = 'supplier_payment_reversal'"
  )
  assert.deepEqual(entry, {
    kind: 'supplier_payment_reversal',
    a: 10,
    shift_id: shift.id,
    ref_type: 'supplier_payment_request',
    ref_id: pendingReq.id
  })
  const again = (await one('SELECT report FROM shift_closings WHERE shift_id = $1', [shift.id]))
    .report
  assert.deepEqual(
    typeof again === 'string' ? JSON.parse(again) : again,
    report,
    'the saved close stays'
  )
  // The shift's details list the treasury entry with the request (for audit and reporting).
  const after = ok(await svc.call('shifts.details', { shiftId: shift.id }, owner))
  assert.equal(after.saved, true)
  const treasuryRows = await q('SELECT kind FROM treasury_ledger WHERE shift_id = $1 ORDER BY id', [
    shift.id
  ])
  assert.ok(treasuryRows.some((x) => x.kind === 'supplier_payment_reversal'))
})

test('a backup restores the requests and their states exactly', async (t) => {
  if (!requireDb(t)) return
  const backup = JSON.parse(JSON.stringify(ok(await svc.call('backup.export', {}, owner))))
  const before = await q(
    'SELECT id, status, settlement, amount::text, ledger_id FROM supplier_payment_requests ORDER BY id'
  )
  const target = await freshDatabase()
  const other = await startService(target.url)
  try {
    await createUser(other, { username: 'restorer', pin: '1357', roleKey: 'super_admin' })
    const token = await login(other, '1357')
    ok(await other.call('backup.restore', { backup, confirm: 'RESTORE' }, token))
    const after = (
      await other.pool.query(
        'SELECT id, status, settlement, amount::text, ledger_id FROM supplier_payment_requests ORDER BY id'
      )
    ).rows
    assert.deepEqual(after, before)
    assert.equal(
      Number(
        (await other.pool.query('SELECT debt_balance FROM suppliers WHERE id = $1', [supplierId]))
          .rows[0].debt_balance
      ),
      await debtOf(supplierId)
    )
    // After the restore a new request continues normally.
    const n = (await other.pool.query('SELECT max(id) m FROM supplier_payment_requests')).rows[0].m
    assert.ok(n >= 4)
  } finally {
    await other.close()
    await target.dispose()
  }
})
