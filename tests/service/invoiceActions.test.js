'use strict'
// Invoice actions by invoice number, without «عرض الفواتير» (owner, 1.5.1, D-082). Returns,
// reprint and payment method change each have their own screen and permission. The invoice is
// found by its number (sales.lookup) among every cashier's invoices, closed shifts included, and
// only what the action needs comes back. Finding an invoice allows nothing: each action checks its
// own permission. None of them lets the user browse invoices.
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
let owner, seller, other, requester
const user = {} // tokens by role name
const shift = {}
const inv = {}
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r, what = '') => {
  assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`)
  return r.body
}
const status = async (op, body, token) => (await svc.call(op, body, token)).status
const lookup = (saleId, action, token) => svc.call('sales.lookup', { saleId, action }, token)
const approver = { username: 'manager', password: passwordFor('9517') }
const sell = async (token, shiftId) =>
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId,
        paymentType: 'نقدي',
        items: [{ barcode: 'P1', qty: 3 }]
      },
      token
    ),
    'sale'
  ).saleId
const itemOf = async (saleId) =>
  (await one('SELECT id FROM sale_items WHERE sale_id = $1 ORDER BY id LIMIT 1', [saleId])).id
// Everything an action could change; a refused or read-only call must leave it as it was.
const fingerprint = async () =>
  one(`SELECT (SELECT count(*) FROM sales)::int AS sales,
              (SELECT COALESCE(sum(total_amount), 0)::text FROM sales) AS sales_total,
              (SELECT string_agg(id || ':' || payment_type, ',' ORDER BY id) FROM sales) AS methods,
              (SELECT count(*) FROM sale_returns)::int AS returns,
              (SELECT count(*) FROM stock_movements)::int AS movements,
              (SELECT stock_qty::text FROM products WHERE barcode = 'P1') AS stock,
              (SELECT count(*) FROM safe_ledger)::int AS drawer,
              (SELECT count(*) FROM sale_payment_corrections)::int AS corrections`)

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'manager', pin: '9517', roleKey: 'manager' })
  await createUser(svc, { username: 'seller', pin: '5101', roleKey: 'cashier' })
  await createUser(svc, { username: 'other', pin: '5102', roleKey: 'cashier' })
  await createUser(svc, { username: 'requester', pin: '5103', roleKey: 'cashier' })
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, retail_price, stock_qty, unit) VALUES ('P1', 'صنف', 10, 500, 'قطعة')"
  )
  owner = await login(svc, '8642')
  // Roles built from the cashier's selling permissions, without «طلب مرتجع» and without «عرض الفواتير».
  const base = (
    await q(
      "SELECT permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = 'cashier' AND permission <> 'sales.return_request'"
    )
  ).map((r) => r.permission)
  assert.ok(!base.includes('sales.view'))
  const ROLES = {
    ret: ['sales.return'],
    rep: ['sales.reprint'],
    pay: ['sales.change_payment'],
    combo: ['sales.reprint', 'sales.change_payment'],
    all3: ['sales.return', 'sales.reprint', 'sales.change_payment'],
    viewer: ['sales.view'],
    none: []
  }
  let pin = 6100
  for (const [key, extra] of Object.entries(ROLES)) {
    const role = ok(
      await svc.call(
        'roles.create',
        { name: `دور ${key}`, permissions: [...base, ...extra] },
        owner
      ),
      key
    )
    const code = String(++pin)
    await createUser(svc, { username: `u_${key}`, pin: code, roleKey: 'cashier' })
    await svc.pool.query('UPDATE users SET role_id = $1 WHERE username = $2', [role.id, `u_${key}`])
    user[key] = await login(svc, code)
  }
  seller = await login(svc, '5101')
  other = await login(svc, '5102')
  requester = await login(svc, '5103')
  // The seller's invoices, then the seller's shift is closed; another cashier's shift stays open.
  shift.seller = ok(await svc.call('shifts.open', { startingCash: 200 }, seller))
  for (const k of ['c1', 'c2', 'c3', 'c4']) inv[k] = await sell(seller, shift.seller.id)
  ok(
    await svc.call(
      'shifts.close',
      { shiftId: shift.seller.id, actualCash: 320, clientRef: crypto.randomUUID() },
      seller
    ),
    'close'
  )
  shift.other = ok(await svc.call('shifts.open', { startingCash: 200 }, other))
  for (const k of ['o1', 'o2']) inv[k] = await sell(other, shift.other.id)
  // Cash refunds are paid from the returning user's own drawer.
  for (const k of ['ret', 'all3'])
    shift[k] = ok(await svc.call('shifts.open', { startingCash: 200 }, user[k]))
  shift.requester = ok(await svc.call('shifts.open', { startingCash: 200 }, requester))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('each lookup needs its own action permission; looking up allows nothing else', async (t) => {
  if (!requireDb(t)) return
  const allowed = {
    ret: ['return'],
    rep: ['reprint'],
    pay: ['payment'],
    combo: ['reprint', 'payment'],
    all3: ['return', 'reprint', 'payment'],
    viewer: [],
    none: []
  }
  for (const [key, actions] of Object.entries(allowed))
    for (const action of ['return', 'reprint', 'payment'])
      assert.equal(
        (await lookup(inv.c1, action, user[key])).status,
        actions.includes(action) ? 200 : 403,
        `${key} looks up for ${action}`
      )
  // A plain cashier holds «طلب مرتجع»: the return lookup, nothing else.
  assert.equal((await lookup(inv.o1, 'return', requester)).status, 200)
  assert.equal((await lookup(inv.o1, 'reprint', requester)).status, 403)
  assert.equal((await lookup(inv.o1, 'payment', requester)).status, 403)
  assert.equal((await lookup(999999, 'reprint', user.rep)).status, 404)
  assert.equal(
    (await svc.call('sales.lookup', { saleId: inv.c1, action: 'browse' }, user.all3)).status,
    400
  )
})

test('any cashier, closed shifts included; only what the action needs comes back', async (t) => {
  if (!requireDb(t)) return
  const reprint = ok(await lookup(inv.c1, 'reprint', user.rep)) // closed shift, another cashier
  assert.deepEqual(Object.keys(reprint.sale).sort(), [
    'id',
    'payment_type',
    'timestamp',
    'total_amount'
  ])
  assert.equal(reprint.items, undefined, 'no lines for a reprint lookup')
  const payment = ok(await lookup(inv.c1, 'payment', user.pay))
  assert.equal(payment.sale.shift_open, false)
  assert.equal(payment.sale.has_return, false)
  assert.equal(payment.items, undefined)
  const ret = ok(await lookup(inv.o1, 'return', user.ret)) // open shift, another cashier
  assert.equal(ret.items.length, 1)
  assert.deepEqual(Object.keys(ret.items[0]).sort(), [
    'id',
    'name',
    'product_barcode',
    'quantity',
    'returned_qty',
    'unit_name',
    'unit_price'
  ])
  for (const r of [reprint, payment, ret]) {
    assert.equal(r.sale.username, undefined, 'not who sold it')
    assert.equal(r.sale.cost_price, undefined)
  }
})

test('no action permission opens browsing: the list and invoice details stay closed', async (t) => {
  if (!requireDb(t)) return
  for (const key of ['ret', 'rep', 'pay', 'combo', 'all3', 'none']) {
    assert.equal(await status('sales.page', { page: 1 }, user[key]), 403, `${key} lists`)
    assert.equal(await status('sales.detail', { saleId: inv.o1 }, user[key]), 403, `${key} details`)
  }
  assert.equal(await status('sales.page', { page: 1 }, requester), 403)
  assert.equal(await status('sales.detail', { saleId: inv.o1 }, requester), 403)
  // «عرض الفواتير» alone: its own shift only, and no action lookup.
  assert.equal(await status('sales.detail', { saleId: inv.o1 }, user.viewer), 403)
})

test('reprint: any invoice with «إعادة طباعة»; it changes nothing; other actions refused', async (t) => {
  if (!requireDb(t)) return
  const before = await fingerprint()
  const r = ok(await svc.call('sales.reprintData', { saleId: inv.c1 }, user.rep))
  assert.equal(r.sale.id, inv.c1)
  ok(await svc.call('sales.reprintData', { saleId: inv.o1 }, user.combo))
  assert.deepEqual(await fingerprint(), before, 'printing records nothing')
  // Without the permission: refused, whatever was looked up.
  for (const key of ['ret', 'pay', 'viewer', 'none'])
    assert.equal(await status('sales.reprintData', { saleId: inv.c1 }, user[key]), 403, key)
  assert.equal(
    await status('sales.returnEntire', { saleId: inv.c1, currentShiftId: null }, user.rep),
    403
  )
  assert.equal(
    await status(
      'sales.changePaymentMethod',
      { saleId: inv.c1, method: 'visa', clientRef: crypto.randomUUID() },
      user.rep
    ),
    403
  )
  assert.deepEqual(await fingerprint(), before, 'refused attempts change nothing')
})

test('payment method: any invoice, also of a closed shift, recorded and logged; other actions refused', async (t) => {
  if (!requireDb(t)) return
  const logs = async () =>
    Number(
      (await one("SELECT count(*) AS n FROM system_logs WHERE action_type = 'sale_payment_change'"))
        .n
    )
  const l0 = await logs()
  const closed = ok(
    await svc.call(
      'sales.changePaymentMethod',
      { saleId: inv.c2, method: 'visa', clientRef: crypto.randomUUID() },
      user.pay
    )
  ).correction
  assert.equal(closed.after_close, true, 'a reclassification of a closed shift (D-065)')
  const open = ok(
    await svc.call(
      'sales.changePaymentMethod',
      { saleId: inv.o2, method: 'wallet', clientRef: crypto.randomUUID() },
      user.combo
    )
  ).correction
  assert.equal(open.after_close, false)
  assert.equal(await logs(), l0 + 2)
  assert.equal(
    (await one('SELECT payment_type FROM sales WHERE id = $1', [inv.c2])).payment_type,
    'فيزا'
  )
  // The other cashier's open shift moved its figures: the sale counts as wallet now.
  const live = (await one('SELECT payment_type FROM sales WHERE id = $1', [inv.o2])).payment_type
  assert.equal(live, 'محفظة')
  const before = await fingerprint()
  for (const key of ['ret', 'rep', 'viewer', 'none'])
    assert.equal(
      await status(
        'sales.changePaymentMethod',
        { saleId: inv.c3, method: 'visa', clientRef: crypto.randomUUID() },
        user[key]
      ),
      403,
      key
    )
  assert.equal(await status('sales.reprintData', { saleId: inv.c3 }, user.pay), 403)
  assert.equal(
    await status('sales.returnEntire', { saleId: inv.c3, currentShiftId: null }, user.pay),
    403
  )
  assert.deepEqual(await fingerprint(), before)
})

test('returns: any invoice with the existing rules (quantities, stock, refund, approval, log)', async (t) => {
  if (!requireDb(t)) return
  const stock = async () =>
    Number((await one("SELECT stock_qty FROM products WHERE barcode = 'P1'")).stock_qty)
  const s0 = await stock()
  const itemC3 = await itemOf(inv.c3)
  // More than what is left: refused as before.
  assert.equal(
    await status(
      'sales.returnItem',
      { saleItemId: itemC3, quantity: 4, currentShiftId: shift.ret.id },
      user.ret
    ),
    400
  )
  // A closed shift's invoice of another cashier: returned directly with «المرتجعات»; the cash
  // refund leaves the returning user's own open drawer.
  const r = ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: itemC3, quantity: 1, currentShiftId: shift.ret.id },
      user.ret
    ),
    'return'
  )
  assert.equal(r.netRefund, 10)
  assert.equal(await stock(), s0 + 1)
  const row = await one('SELECT username, shift_id FROM sale_returns WHERE sale_id = $1', [inv.c3])
  assert.deepEqual([row.username, row.shift_id], ['u_ret', shift.ret.id])
  const out = await one(
    "SELECT amount::float AS amount FROM safe_ledger WHERE shift_id = $1 AND kind = 'refund'",
    [shift.ret.id]
  )
  assert.equal(out.amount, 10)
  ok(
    await svc.call(
      'sales.returnEntire',
      { saleId: inv.c4, currentShiftId: shift.all3.id },
      user.all3
    ),
    'whole invoice'
  )
  assert.equal(await stock(), s0 + 4)
  // «طلب مرتجع» (a plain cashier): another cashier's invoice by number, with a reason and the
  // supervisor's approval; without the approval it is refused as before.
  const itemO1 = await itemOf(inv.o1)
  const s1 = await stock()
  assert.notEqual(
    await status(
      'sales.returnItem',
      { saleItemId: itemO1, quantity: 1, reason: 'عبوة تالفة', currentShiftId: shift.requester.id },
      requester
    ),
    200
  )
  assert.equal(await stock(), s1, 'no approval, no return')
  ok(
    await svc.call(
      'sales.returnItem',
      {
        saleItemId: itemO1,
        quantity: 1,
        reason: 'عبوة تالفة',
        approver,
        currentShiftId: shift.requester.id
      },
      requester
    ),
    'approved request'
  )
  assert.equal(await stock(), s1 + 1)
  assert.ok(
    (await one('SELECT approval_id FROM sale_returns WHERE sale_id = $1', [inv.o1])).approval_id,
    'the approval is recorded'
  )
  // Without a return permission: refused.
  for (const key of ['rep', 'pay', 'combo', 'viewer', 'none'])
    assert.equal(
      await status(
        'sales.returnItem',
        { saleItemId: itemO1, quantity: 1, currentShiftId: null },
        user[key]
      ),
      403,
      key
    )
  // A return keeps the invoice's payment method: the change is refused afterwards.
  assert.equal(
    (
      await svc.call(
        'sales.changePaymentMethod',
        { saleId: inv.c3, method: 'visa', clientRef: crypto.randomUUID() },
        user.all3
      )
    ).status,
    409
  )
  const pay = ok(await lookup(inv.c3, 'payment', user.all3))
  assert.equal(pay.sale.has_return, true)
})

test('all three permissions together, still without browsing', async (t) => {
  if (!requireDb(t)) return
  for (const action of ['return', 'reprint', 'payment'])
    ok(await lookup(inv.o2, action, user.all3), action)
  ok(await svc.call('sales.reprintData', { saleId: inv.o2 }, user.all3))
  assert.equal(await status('sales.page', { page: 1 }, user.all3), 403)
  assert.equal(await status('sales.detail', { saleId: inv.o2 }, user.all3), 403)
  // The owner keeps everything, from the invoices screen too.
  ok(await svc.call('sales.detail', { saleId: inv.c1 }, owner))
  ok(await lookup(inv.c1, 'return', owner))
})
