'use strict'
// The owner's requests of 2026-11-13 (1.6.1, D-107), on the shared service – so the shop PC and the
// website behave the same:
//   1. a supplier payment from the drawer for any supplier, also beyond what is owed (an advance)
//      and beyond the cash in the drawer (a negative shift); the balance still falls only when an
//      administrator approves; the same for preliminary invoices paid from the drawer;
//   2/5. preliminary invoices carry their date and time, and the cashier's view keeps those
//      completed or cancelled during the current shift until it ends;
//   3. the notice of preliminary invoices waiting for their items;
//   4. who is editing a preliminary invoice is seen by everyone, from the shop and the website;
//   7. customer codes: the next of the store's series is suggested and used; a code typed by hand
//      is checked for uniqueness, at the till too.
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
const { makeTwin } = require('./cloudHelpers')

let db, svc, owner, cashier, plain, shift, owedId, newId
const ref = () => crypto.randomUUID()
const one = async (sql, p) => (await svc.pool.query(sql, p)).rows[0]
const ok = (r, what = '') => {
  assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`)
  return r.body
}
const r2 = (n) => Math.round(Number(n) * 100) / 100
const debtOf = async (id) =>
  r2((await one('SELECT debt_balance FROM suppliers WHERE id = $1', [id])).debt_balance)
const drawerOf = async (s) =>
  ok(await svc.call('shifts.liveSummary', { shiftId: s.id }, owner)).drawer.expected

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await createUser(svc, { username: 'plain', pin: '6205', roleKey: 'cashier' })
  // The cashier may hand supplier payments from the drawer (granted, as an owner would).
  await svc.pool.query(`INSERT INTO roles (key, name, description)
    VALUES (NULL, 'كاشير سداد', 'كاشير يسدد الموردين') ON CONFLICT DO NOTHING`)
  const roleId = (await one("SELECT id FROM roles WHERE name = 'كاشير سداد'")).id
  await svc.pool.query(
    `INSERT INTO role_permissions (role_id, permission)
     SELECT $1::int, permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = 'cashier'
     UNION SELECT $1::int, 'suppliers.payment_request'`,
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
  owedId = ok(await svc.call('suppliers.create', { name: 'مورد عليه فاتورة' }, owner)).id
  newId = ok(await svc.call('suppliers.create', { name: 'مورد بلا فواتير' }, owner)).id
  ok(
    await svc.call(
      'suppliers.addPurchase',
      { supplierId: owedId, total_amount: 300, paid_amount: 0, payment_type: 'آجل' },
      owner
    )
  )
  shift = ok(await svc.call('shifts.open', { startingCash: 100 }, cashier))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('1. any supplier may be paid from the drawer: beyond what is owed and beyond the cash; the balance waits for approval', async (t) => {
  if (!requireDb(t)) return
  const list = ok(await svc.call('supplierPayments.suppliers', {}, cashier))
  assert.deepEqual(
    list.map((s) => [s.name, s.open]).sort(),
    [
      ['مورد بلا فواتير', 0],
      ['مورد عليه فاتورة', 300]
    ],
    'every supplier, with what is owed (0 when nothing is)'
  )
  const before = await drawerOf(shift)
  assert.equal(before, 100)
  // 250 to a supplier owed nothing (its invoice not recorded yet), with 100 in the drawer.
  const advance = ok(
    await svc.call(
      'supplierPayments.create',
      { supplierId: newId, amount: 250, currentShiftId: shift.id, clientRef: ref() },
      cashier
    )
  ).request
  assert.equal(await drawerOf(shift), -150, 'the shift may go negative')
  assert.equal(await debtOf(newId), 0, 'the balance waits for the approval')
  // 400 to a supplier owed 300: an advance of 100 beyond the invoice.
  const beyond = ok(
    await svc.call(
      'supplierPayments.create',
      { supplierId: owedId, amount: 400, currentShiftId: shift.id, clientRef: ref() },
      cashier
    )
  ).request
  assert.equal(await debtOf(owedId), 300)
  // The audit says what was unusual.
  const log = await one(
    "SELECT description FROM system_logs WHERE action_type = 'supplier_payment_request' AND description LIKE $1",
    [`%#${advance.id}:%`]
  )
  assert.match(log.description, /دفعة مقدمة: المستحق كان 0\.00/)
  assert.match(log.description, /الدرج كان 100\.00/)
  // Approval: the balance falls once, below zero for an advance (the store's credit).
  ok(await svc.call('supplierPayments.approve', { requestId: advance.id }, owner))
  ok(await svc.call('supplierPayments.approve', { requestId: beyond.id }, owner))
  assert.equal(await debtOf(newId), -250)
  assert.equal(await debtOf(owedId), -100)
  assert.equal(await drawerOf(shift), -550, 'approval moves no cash again')
  // The invoice recorded later settles against the advance.
  ok(
    await svc.call(
      'suppliers.addPurchase',
      { supplierId: newId, total_amount: 250, paid_amount: 0, payment_type: 'آجل' },
      owner
    )
  )
  assert.equal(await debtOf(newId), 0)
  // Still refused: without an open shift (the cash leaves a drawer), and without the permission.
  const noShift = await svc.call(
    'supplierPayments.create',
    { supplierId: newId, amount: 10, clientRef: ref() },
    owner
  )
  assert.equal(noShift.body.error.code, 'shift_required')
  const noRight = await svc.call(
    'supplierPayments.create',
    { supplierId: newId, amount: 10, clientRef: ref() },
    plain
  )
  assert.equal(noRight.status, 403)
})

test('1. preliminary invoices: any supplier, paid from a drawer with less cash than the amount', async (t) => {
  if (!requireDb(t)) return
  const names = ok(await svc.call('supplierInvoices.suppliers', {}, cashier)).map((s) => s.name)
  assert.ok(names.includes('مورد بلا فواتير') && names.includes('مورد عليه فاتورة'))
  const s = ok(await svc.call('shifts.open', { startingCash: 20 }, plain))
  const inv = ok(
    await svc.call(
      'supplierInvoices.createPending',
      {
        supplierId: newId,
        total: 500,
        paymentMode: 'cash',
        currentShiftId: s.id,
        clientRef: ref()
      },
      plain
    )
  ).invoice
  assert.equal(Number(inv.paid), 500)
  assert.equal(await drawerOf(s), -480)
  ok(
    await svc.call(
      'shifts.close',
      { shiftId: s.id, actualCash: 0, note: 'دفعة أكبر من الدرج' },
      plain
    ),
    'a negative drawer closes like any other'
  )
})

test('2/5. preliminary invoices: date and time; completed ones stay in the cashier view until the shift ends', async (t) => {
  if (!requireDb(t)) return
  const mk = async (total) =>
    ok(
      await svc.call(
        'supplierInvoices.createPending',
        {
          supplierId: owedId,
          total,
          paymentMode: 'credit',
          currentShiftId: shift.id,
          clientRef: ref()
        },
        cashier
      )
    ).invoice
  const a = await mk(70)
  const b = await mk(80)
  const view = async (token, since) =>
    ok(
      await svc.call(
        'supplierInvoices.list',
        { status: 'pending', ...(since ? { doneSince: since } : {}) },
        token
      )
    )
  const start = (
    await one(
      "SELECT to_char(start_time, 'YYYY-MM-DD HH24:MI:SS') AS t FROM shifts WHERE id = $1",
      [shift.id]
    )
  ).t
  const rowA = (await view(cashier, start)).find((x) => x.id === a.id)
  assert.match(rowA.created_at_text, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'its date and time')
  // The administrator completes one; the cashier cancels the other.
  ok(
    await svc.call(
      'supplierInvoices.convert',
      { invoiceId: a.id, items: [{ barcode: 'P', qty: 7, unitCost: 10 }], clientRef: ref() },
      owner
    )
  )
  ok(
    await svc.call(
      'supplierInvoices.cancel',
      { invoiceId: b.id, refund: 'none', clientRef: ref() },
      cashier
    )
  )
  // Waiting only: both gone, as before.
  const waiting = await view(cashier)
  assert.ok(!waiting.some((x) => x.id === a.id || x.id === b.id))
  // The cashier's view during the shift: both kept, with who did it and when.
  const shown = await view(cashier, start)
  const doneA = shown.find((x) => x.id === a.id)
  const doneB = shown.find((x) => x.id === b.id)
  assert.deepEqual([doneA.status, doneA.converted_by_name], ['converted', 'owner'])
  assert.deepEqual([doneB.status, doneB.cancelled_by_name], ['cancelled', 'cashier'])
  assert.match(doneA.done_at_text, /^\d{4}-\d{2}-\d{2} /)
  assert.ok(
    shown.findIndex((x) => x.status === 'pending') <= shown.findIndex((x) => x.id === a.id),
    'waiting ones first'
  )
  // A later shift starts clean; the records themselves are all kept.
  const later = await view(cashier, '2999-01-01 00:00:00')
  assert.ok(!later.some((x) => x.id === a.id || x.id === b.id))
  const history = ok(await svc.call('supplierInvoices.list', {}, owner))
  assert.ok(history.some((x) => x.id === a.id) && history.some((x) => x.id === b.id))
})

test('3. the notice of preliminary invoices waiting for their items', async (t) => {
  if (!requireDb(t)) return
  const before = ok(await svc.call('supplierInvoices.pendingCount', {}, owner))
  ok(
    await svc.call(
      'supplierInvoices.createPending',
      {
        supplierId: owedId,
        total: 45,
        paymentMode: 'credit',
        currentShiftId: shift.id,
        clientRef: ref()
      },
      cashier
    )
  )
  const after = ok(await svc.call('supplierInvoices.pendingCount', {}, owner))
  assert.equal(after.pending, before.pending + 1)
  assert.equal(r2(after.pendingTotal - before.pendingTotal), 45)
  assert.match(after.oldestAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  assert.equal((await svc.call('supplierInvoices.pendingCount', {}, cashier)).status, 403)
})

test('7. customer codes: the next of the series is suggested and used; typed codes checked, at the till too', async (t) => {
  if (!requireDb(t)) return
  const suggest = async (token) => ok(await svc.call('clients.suggestCode', {}, token)).code
  const first = await suggest(owner)
  assert.match(first, /^C\d{5}$/)
  assert.equal(await suggest(cashier), first, 'the till sees the same suggestion')
  // Saved without a code typed: exactly the suggestion.
  const a = ok(await svc.call('clients.create', { name: 'أول عميل' }, owner))
  assert.equal(a.code, first)
  const second = await suggest(owner)
  assert.equal(Number(second.slice(1)), Number(first.slice(1)) + 1, 'the next number follows')
  // A typed code: accepted when free, refused clearly when taken (ignoring case).
  const vip = ok(await svc.call('clients.create', { name: 'عميل مميز', code: 'VIP-1' }, owner))
  assert.equal(vip.code, 'VIP-1')
  const taken = await svc.call('clients.create', { name: 'آخر', code: 'vip-1' }, owner)
  assert.equal(taken.status, 409)
  assert.match(taken.body.error.message, /مستخدم للعميل "عميل مميز"/)
  // At the till: a new customer on a credit sale, with a typed code (with the permission) …
  const sale = (client, token) =>
    svc.call(
      'pos.checkout',
      {
        clientRef: ref(),
        shiftId: shift.id,
        paymentType: 'آجل',
        client,
        items: [{ barcode: 'P', qty: 1 }]
      },
      token
    )
  const ownerShift = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
  const ownerSale = await svc.call(
    'pos.checkout',
    {
      clientRef: ref(),
      shiftId: ownerShift.id,
      paymentType: 'آجل',
      client: { id: null, name: 'عميل الكاشير', phone: '', address: '', code: 'TILL-7' },
      items: [{ barcode: 'P', qty: 1 }]
    },
    owner
  )
  ok(ownerSale)
  assert.equal((await one("SELECT code FROM clients WHERE name = 'عميل الكاشير'")).code, 'TILL-7')
  // … refused when taken, and nothing is sold.
  const sales0 = (await one('SELECT count(*)::int AS n FROM sales')).n
  const dup = await svc.call(
    'pos.checkout',
    {
      clientRef: ref(),
      shiftId: ownerShift.id,
      paymentType: 'آجل',
      client: { id: null, name: 'عميل ثان', phone: '', address: '', code: 'till-7' },
      items: [{ barcode: 'P', qty: 1 }]
    },
    owner
  )
  assert.equal(dup.status, 409)
  assert.match(dup.body.error.message, /مستخدم للعميل "عميل الكاشير"/)
  assert.equal((await one('SELECT count(*)::int AS n FROM sales')).n, sales0)
  // A cashier without «تحديد كود العميل يدوياً»: the suggested code; typing one is refused.
  const auto = await suggest(cashier)
  ok(await sale({ id: null, name: 'عميل تلقائي', phone: '', address: '' }, cashier))
  assert.equal((await one("SELECT code FROM clients WHERE name = 'عميل تلقائي'")).code, auto)
  const typed = await sale(
    { id: null, name: 'عميل بكود', phone: '', address: '', code: 'X-1' },
    cashier
  )
  assert.equal(typed.status, 403)
})

test('4 and 7 across the shop and the website: who is editing is seen on both; offline phone customers get W codes', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const phone = await twin.signIn('8642')
    const created = ok(
      await twin.shop.call(
        'supplierInvoices.createPending',
        { supplierId: twin.supplierId, total: 60, paymentMode: 'credit', clientRef: ref() },
        twin.cashier
      )
    ).invoice
    await twin.sync()
    // The cashier recorded it; the owner opens it on the phone: the cashier's screen at the shop
    // shows who is editing it.
    ok(await twin.cloud.call('supplierInvoices.reserve', { invoiceId: created.id }, phone))
    let atShop
    for (let i = 0; i < 40; i++) {
      await twin.sync().catch(() => {})
      atShop = ok(
        await twin.shop.call('supplierInvoices.list', { status: 'pending' }, twin.cashier)
      ).find((x) => x.id === created.id)
      if (atShop?.reserved_active) break
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.deepEqual([atShop.reserved_active, atShop.reserved_by_name], [true, 'owner'])
    // While the shop is connected, the website suggests the shop's next code, and the shop saves
    // the customer with it.
    const shown = ok(await twin.cloud.call('clients.suggestCode', {}, phone)).code
    assert.match(shown, /^C\d{5}$/)
    const viaWeb = ok(
      await twin.cloud.call('clients.create', { name: 'عميل عبر الموقع' }, phone, {
        'x-heromarket-operation-id': crypto.randomUUID()
      })
    )
    assert.equal(viaWeb.code ?? viaWeb.client?.code, shown)
    // A customer added on the phone while the shop is unreachable: the W series, never a C clash.
    twin.agent.stopLink()
    twin.transport.down = true
    for (let i = 0; i < 100 && twin.cloud.app.cloudLink.reachable(); i++)
      await new Promise((r) => setTimeout(r, 50))
    assert.match(ok(await twin.cloud.call('clients.suggestCode', {}, phone)).code, /^W\d{5}$/)
    const away = ok(
      await twin.cloud.call('clients.create', { name: 'عميل من الهاتف' }, phone, {
        'x-heromarket-operation-id': crypto.randomUUID()
      })
    )
    assert.match(away.code, /^W\d{5}$/)
    twin.transport.down = false
    await twin.sync()
    const shopCode = (
      await twin.shop.pool.query("SELECT code FROM clients WHERE name = 'عميل من الهاتف'")
    ).rows[0].code
    assert.equal(shopCode, away.code, 'the same code at the shop')
    assert.match(ok(await twin.shop.call('clients.suggestCode', {}, twin.owner)).code, /^C\d{5}$/)
  } finally {
    await twin.close()
  }
})
