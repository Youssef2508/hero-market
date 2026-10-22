'use strict'
// Which invoices a user may see and act on (owner, 1.5.1, D-081). With "كل الفواتير"
// (sales.view_all, administrators by default): every invoice, of any cashier and shift, open or
// closed. Anyone else – a cashier or a supervisor, whatever invoice permissions they were given –
// only the invoices of their own open shift: list, details, reprint, returns (also with a
// supervisor's approval), payment method changes, a customer's invoices. Asking for another
// cashier's invoice by its number is refused by the service (403, logged). Each action still needs
// its own permission: seeing an invoice never allows acting on it.
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

let db, svc
let owner, cashierA, cashierB, manager, auditor
let shiftA, shiftB
const sale = {}
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const refused = (r, what) => {
  assert.equal(r.status, 403, `${what}: ${JSON.stringify(r.body)}`)
  return r.body
}
const approver = { username: 'manager', password: passwordFor('9517') }
const sell = async (token, shiftId, extra = {}) =>
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId,
        paymentType: 'نقدي',
        items: [{ barcode: 'P1', qty: 2 }],
        ...extra
      },
      token
    )
  ).saleId
const itemOf = async (saleId) =>
  (await one('SELECT id FROM sale_items WHERE sale_id = $1 ORDER BY id LIMIT 1', [saleId])).id
const listed = async (token) => {
  const r = ok(await svc.call('sales.page', { page: 1 }, token))
  return { scope: r.scope, ids: r.rows.map((s) => s.id).sort((a, b) => a - b) }
}
const refusals = async () =>
  Number(
    (
      await one(
        "SELECT count(*) AS n FROM system_logs WHERE action_type = 'invoice_access_refused'"
      )
    ).n
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'manager', pin: '9517', roleKey: 'manager' })
  await createUser(svc, { username: 'auditor', pin: '7531', roleKey: 'auditor' })
  await createUser(svc, { username: 'cashierB', pin: '5174', roleKey: 'cashier' })
  await createUser(svc, { username: 'cashierA', pin: '5173', roleKey: 'cashier' })
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, retail_price, stock_qty, unit) VALUES ('P1', 'صنف', 10, 500, 'قطعة')"
  )
  owner = await login(svc, '8642')
  // Cashier A is given every invoice permission (rule 3): still only the own open shift.
  const role = ok(
    await svc.call(
      'roles.create',
      {
        name: 'كاشير بصلاحيات الفواتير',
        permissions: [
          ...(
            await q(
              "SELECT permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = 'cashier'"
            )
          ).map((r) => r.permission),
          'sales.view',
          'sales.reprint',
          'sales.return',
          'sales.change_payment'
        ]
      },
      owner
    )
  )
  await svc.pool.query("UPDATE users SET role_id = $1 WHERE username = 'cashierA'", [role.id])
  cashierA = await login(svc, '5173')
  cashierB = await login(svc, '5174')
  manager = await login(svc, '9517')
  auditor = await login(svc, '7531')
  shiftA = ok(await svc.call('shifts.open', { startingCash: 100 }, cashierA))
  shiftB = ok(await svc.call('shifts.open', { startingCash: 100 }, cashierB))
  sale.a1 = await sell(cashierA, shiftA.id)
  sale.a2 = await sell(cashierA, shiftA.id)
  sale.b1 = await sell(cashierB, shiftB.id, {
    client: { name: 'عميل الفواتير', phone: '01012345678' }
  })
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('the permission: administrators and the reviewer by default; never supervisors or cashiers', async (t) => {
  if (!requireDb(t)) return
  const holders = (
    await q(
      "SELECT r.key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission = 'sales.view_all' ORDER BY r.key"
    )
  ).map((r) => r.key)
  assert.deepEqual(holders, ['auditor', 'store_admin', 'super_admin'])
})

test('the list: everything for the administrator; the own open shift for a cashier given "view invoices"', async (t) => {
  if (!requireDb(t)) return
  const all = await listed(owner)
  assert.equal(all.scope, 'all')
  assert.deepEqual(
    all.ids,
    [sale.a1, sale.a2, sale.b1].sort((a, b) => a - b)
  )
  assert.deepEqual(await listed(cashierA), { scope: 'own_shift', ids: [sale.a1, sale.a2] })
  // A supervisor with "view invoices" but no open shift: nothing, not everyone's invoices.
  assert.deepEqual(await listed(manager), { scope: 'own_shift', ids: [] })
  // Searching for another cashier's invoice number never brings it up.
  const found = ok(await svc.call('sales.page', { search: String(sale.b1) }, cashierA))
  assert.ok(!found.rows.some((s) => s.id === sale.b1))
  assert.ok(found.rows.every((s) => s.shift_id === shiftA.id))
})

test("details: own invoice yes; another cashier's by its number refused and logged; the administrator any", async (t) => {
  if (!requireDb(t)) return
  ok(await svc.call('sales.detail', { saleId: sale.a1 }, cashierA))
  const before = await refusals()
  const r = refused(await svc.call('sales.detail', { saleId: sale.b1 }, cashierA), 'A opens B')
  assert.match(r.error.message, /ورديتك/)
  assert.equal(await refusals(), before + 1, 'the refusal is in the activity log')
  // A cashier with only "return request" opens own invoices by number, not others'.
  ok(await svc.call('sales.detail', { saleId: sale.b1 }, cashierB))
  refused(await svc.call('sales.detail', { saleId: sale.a1 }, cashierB), 'B opens A')
  refused(await svc.call('sales.detail', { saleId: sale.a1 }, manager), 'manager opens A')
  ok(await svc.call('sales.detail', { saleId: sale.b1 }, owner))
  ok(await svc.call('sales.detail', { saleId: sale.a1 }, auditor))
  // An invoice that does not exist is still "not found".
  assert.equal((await svc.call('sales.detail', { saleId: 999999 }, cashierA)).status, 404)
})

test("reprint: own invoice yes, another cashier's refused; seeing all invoices does not allow reprinting", async (t) => {
  if (!requireDb(t)) return
  ok(await svc.call('sales.reprintData', { saleId: sale.a1 }, cashierA))
  refused(await svc.call('sales.reprintData', { saleId: sale.b1 }, cashierA), 'A reprints B')
  refused(await svc.call('sales.reprintData', { saleId: sale.a1 }, manager), 'manager reprints A')
  ok(await svc.call('sales.reprintData', { saleId: sale.b1 }, owner))
  // The reviewer sees every invoice but has no reprint permission.
  refused(await svc.call('sales.reprintData', { saleId: sale.a1 }, auditor), 'auditor reprints')
})

test("returns: refused on another cashier's invoice even with a supervisor's approval; nothing changes", async (t) => {
  if (!requireDb(t)) return
  const stock = async () =>
    Number((await one("SELECT stock_qty FROM products WHERE barcode = 'P1'")).stock_qty)
  const before = await stock()
  const itemA = await itemOf(sale.a1)
  // Cashier B requests a return on cashier A's invoice, with the supervisor's password: refused.
  refused(
    await svc.call(
      'sales.returnItem',
      { saleItemId: itemA, quantity: 1, reason: 'طلب مرتجع', approver, currentShiftId: shiftB.id },
      cashierB
    ),
    'B returns A with approval'
  )
  refused(
    await svc.call(
      'sales.returnEntire',
      { saleId: sale.a1, reason: 'طلب مرتجع', approver, currentShiftId: shiftB.id },
      cashierB
    ),
    'B returns all of A'
  )
  // The supervisor's own "returns" permission does not reach a cashier's invoice either.
  refused(
    await svc.call('sales.returnItem', { saleItemId: itemA, quantity: 1 }, manager),
    'manager returns A'
  )
  // Cashier A (with "returns") cannot return B's invoice.
  refused(
    await svc.call('sales.returnEntire', { saleId: sale.b1, currentShiftId: shiftA.id }, cashierA),
    'A returns B'
  )
  // The reviewer sees it but may not return it.
  refused(
    await svc.call('sales.returnItem', { saleItemId: itemA, quantity: 1 }, auditor),
    'auditor returns'
  )
  assert.equal(await stock(), before, 'no refused attempt moved stock')
  assert.equal(Number((await one('SELECT count(*) AS n FROM sale_returns')).n), 0)

  // Allowed: B's own invoice with the supervisor's approval; A's own invoice directly.
  ok(
    await svc.call(
      'sales.returnItem',
      {
        saleItemId: await itemOf(sale.b1),
        quantity: 1,
        reason: 'طلب مرتجع',
        approver,
        currentShiftId: shiftB.id
      },
      cashierB
    )
  )
  ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: itemA, quantity: 1, currentShiftId: shiftA.id },
      cashierA
    )
  )
  assert.equal(await stock(), before + 2)
})

test("payment method: own invoice yes, another cashier's refused; the administrator any", async (t) => {
  if (!requireDb(t)) return
  const change = (saleId, token, method = 'visa') =>
    svc.call('sales.changePaymentMethod', { saleId, method, clientRef: crypto.randomUUID() }, token)
  // (Invoices with a return keep their method: fresh invoices here.)
  const b2 = await sell(cashierB, shiftB.id)
  ok(await change(sale.a2, cashierA))
  refused(await change(b2, cashierA), 'A changes B')
  ok(await change(b2, owner, 'wallet'))
  assert.equal(
    (await one('SELECT payment_type FROM sales WHERE id = $1', [b2])).payment_type,
    'محفظة'
  )
})

test("a customer's invoices follow the same scope; the balance stays visible", async (t) => {
  if (!requireDb(t)) return
  const clientId = (await one('SELECT client_id FROM sales WHERE id = $1', [sale.b1])).client_id
  const forOwner = ok(await svc.call('clients.profile', { clientId }, owner))
  assert.deepEqual(
    forOwner.purchases.map((p) => p.id),
    [sale.b1]
  )
  const forManager = ok(await svc.call('clients.profile', { clientId }, manager))
  assert.equal(forManager.invoiceScope, 'own_shift')
  assert.deepEqual(forManager.purchases, [])
  assert.deepEqual(forManager.saleItems, [])
  assert.equal(forManager.client.id, clientId, 'the customer and balance are still shown')
})

test('shift boundaries: after the close nothing of that shift; a new shift starts empty; the administrator keeps all', async (t) => {
  if (!requireDb(t)) return
  const supervisorShift = ok(await svc.call('shifts.open', { startingCash: 0 }, manager))
  const m1 = await sell(manager, supervisorShift.id)
  // A supervisor in a shift: own invoices of that shift, still not the cashiers'.
  assert.deepEqual(await listed(manager), { scope: 'own_shift', ids: [m1] })

  ok(
    await svc.call(
      'shifts.close',
      { shiftId: shiftA.id, actualCash: 0, clientRef: crypto.randomUUID() },
      cashierA
    )
  )
  assert.deepEqual(await listed(cashierA), { scope: 'own_shift', ids: [] })
  refused(await svc.call('sales.detail', { saleId: sale.a1 }, cashierA), 'closed shift details')
  refused(
    await svc.call('sales.reprintData', { saleId: sale.a1 }, cashierA),
    'closed shift reprint'
  )
  refused(
    await svc.call(
      'sales.changePaymentMethod',
      { saleId: sale.a1, method: 'visa', clientRef: crypto.randomUUID() },
      cashierA
    ),
    'closed shift payment change'
  )

  const next = ok(await svc.call('shifts.open', { startingCash: 0 }, cashierA))
  const a3 = await sell(cashierA, next.id)
  assert.deepEqual(await listed(cashierA), { scope: 'own_shift', ids: [a3] })
  refused(await svc.call('sales.detail', { saleId: sale.a1 }, cashierA), 'previous shift')

  // The administrator: every invoice, closed shift included, without any shift of their own.
  assert.equal((await listed(owner)).ids.length, 6)
  ok(await svc.call('sales.detail', { saleId: sale.a1 }, owner))
  ok(await svc.call('sales.reprintData', { saleId: sale.a1 }, owner))
  ok(
    await svc.call(
      'sales.changePaymentMethod',
      { saleId: sale.a2, method: 'instapay', clientRef: crypto.randomUUID() },
      owner
    )
  )
})
