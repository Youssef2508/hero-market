'use strict'
// Manual fixed-amount invoice discount (owner decision 2026-10-21, D-057, DISC-01).
// Only users holding pos.manual_discount may apply it; it comes after the automatic rules, never
// changes the product's price or stock, is recorded with who and why, appears in the shift's
// figures, and returns refund exactly what was paid.
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

let db, svc, owner, cashier, ownerShift
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const stock = async (b) =>
  Number((await one('SELECT stock_qty FROM products WHERE barcode = $1', [b])).stock_qty)
const checkout = (token, shiftId, items, extra = {}) =>
  svc.call(
    'pos.checkout',
    { clientRef: crypto.randomUUID(), shiftId, paymentType: 'نقدي', items, ...extra },
    token
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('YOG', 'زبادي', 15, 20, 10, 'علبة'), ('BIS', 'بسكويت', 30, 50, 10, 'علبة')"
  )
  ownerShift = ok(await svc.call('shifts.open', { startingCash: 0 }, owner)).id
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a cashier without the permission is refused, in the preview and at checkout, and it is logged', async (t) => {
  if (!requireDb(t)) return
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier)).id
  const md = { amount: 2, reason: 'خصم زبادي' }
  const preview = await svc.call(
    'pos.price',
    { items: [{ barcode: 'YOG', qty: 1 }], manualDiscount: md },
    cashier
  )
  assert.equal(preview.status, 403)
  const sale = await checkout(cashier, shift, [{ barcode: 'YOG', qty: 1 }], { manualDiscount: md })
  assert.equal(sale.status, 403)
  assert.equal(await stock('YOG'), 10, 'nothing sold')
  const logged = await q(
    "SELECT username FROM system_logs WHERE action_type = 'manual_discount_refused' ORDER BY id"
  )
  assert.deepEqual(
    logged.map((l) => l.username),
    ['cashier', 'cashier']
  )
  // The old free "discount" field stays refused for everyone (D-044).
  assert.equal(
    (await checkout(owner, ownerShift, [{ barcode: 'YOG', qty: 1 }], { discount: 2 })).status,
    403
  )
  // Built-in roles: only the administrators hold it by default.
  const holders = await q(
    "SELECT r.key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission = 'pos.manual_discount' ORDER BY r.key"
  )
  assert.deepEqual(
    holders.map((h) => h.key),
    ['store_admin', 'super_admin']
  )
})

test("the owner's yogurt case: EGP 2 off, price and stock untouched, recorded with who and why", async (t) => {
  if (!requireDb(t)) return
  const md = { amount: 2, reason: 'خصم زبادي فات وقت الاستلام' }
  const preview = ok(
    await svc.call('pos.price', { items: [{ barcode: 'YOG', qty: 1 }], manualDiscount: md }, owner)
  )
  assert.deepEqual([preview.subTotal, preview.manualDiscount, preview.afterDiscount], [20, 2, 18])
  const sale = ok(
    await checkout(owner, ownerShift, [{ barcode: 'YOG', qty: 1 }], {
      manualDiscount: md,
      expectedTotal: preview.afterDiscount
    })
  )
  assert.deepEqual([sale.total, sale.discount, sale.manualDiscount], [18, 2, 2])
  assert.equal(
    Number((await one("SELECT retail_price FROM products WHERE barcode = 'YOG'")).retail_price),
    20,
    'price unchanged'
  )
  assert.equal(await stock('YOG'), 9, 'one piece sold')
  const s = await one('SELECT total_amount, discount, manual_discount FROM sales WHERE id = $1', [
    sale.saleId
  ])
  assert.deepEqual(
    [Number(s.total_amount), Number(s.discount), Number(s.manual_discount)],
    [18, 2, 2]
  )
  const d = await one(
    "SELECT d.amount, d.reason, d.created_at, u.username FROM sale_discounts d JOIN users u ON u.id = d.user_id WHERE d.sale_id = $1 AND d.scope = 'manual'",
    [sale.saleId]
  )
  assert.deepEqual([Number(d.amount), d.reason, d.username], [2, md.reason, 'owner'])
  assert.ok(d.created_at)
  assert.ok(
    await one(
      "SELECT 1 FROM system_logs WHERE action_type = 'manual_discount' AND description LIKE $1",
      [`%#${sale.saleId}%`]
    )
  )
  // Invoice details show it.
  const detail = ok(await svc.call('sales.detail', { saleId: sale.saleId }, owner))
  assert.deepEqual(
    detail.discounts.map((x) => [x.scope, x.amount, x.reason, x.username]),
    [['manual', 2, md.reason, 'owner']]
  )
  // Return of the piece refunds what was paid: 18, not 20.
  const line = await one('SELECT id FROM sale_items WHERE sale_id = $1', [sale.saleId])
  const ret = ok(await svc.call('sales.returnItem', { saleItemId: line.id, quantity: 1 }, owner))
  assert.equal(ret.netRefund, 18)
  assert.equal(await stock('YOG'), 10)
})

test('after automatic rules, capped at what is left; partial returns add up to what was paid', async (t) => {
  if (!requireDb(t)) return
  ok(
    await svc.call(
      'discounts.save',
      {
        name: 'بسكويت 10%',
        scope: 'product',
        productBarcode: 'BIS',
        valueType: 'percent',
        value: 10
      },
      owner
    )
  )
  const items = [{ barcode: 'BIS', qty: 3 }]
  // 3 × 50 = 150; rule 10% = 15 → 135; manual 10 → 125.
  const p = ok(
    await svc.call(
      'pos.price',
      { items, manualDiscount: { amount: 10, reason: 'تقريب للعميل' } },
      owner
    )
  )
  assert.deepEqual(
    [p.subTotal, p.afterRules, p.manualDiscount, p.afterDiscount],
    [150, 135, 10, 125]
  )
  // More than what is left after the rules: refused.
  const tooMuch = await svc.call(
    'pos.price',
    { items, manualDiscount: { amount: 135.01, reason: 'كثير' } },
    owner
  )
  assert.equal(tooMuch.status, 400)
  // No reason is needed (owner, 2026-10-21, D-063, was required under D-057); whole piastres only.
  assert.equal(
    (await svc.call('pos.price', { items, manualDiscount: { amount: 5 } }, owner)).status,
    200
  )
  assert.equal(
    (
      await svc.call(
        'pos.price',
        { items, manualDiscount: { amount: 1.005, reason: 'كسر' } },
        owner
      )
    ).status,
    400
  )
  const sale = ok(
    await checkout(owner, ownerShift, items, {
      manualDiscount: { amount: 10, reason: 'تقريب للعميل' },
      expectedTotal: 125
    })
  )
  assert.equal(sale.total, 125)
  const line = await one(
    'SELECT id, total_price, line_discount, cart_discount FROM sale_items WHERE sale_id = $1',
    [sale.saleId]
  )
  assert.deepEqual(
    [Number(line.total_price), Number(line.line_discount), Number(line.cart_discount)],
    [150, 15, 10]
  )
  // Three partial returns of one piece each refund exactly 125 in total.
  let refunded = 0
  for (let i = 0; i < 3; i++)
    refunded += ok(
      await svc.call('sales.returnItem', { saleItemId: line.id, quantity: 1 }, owner)
    ).netRefund
  assert.equal(Math.round(refunded * 100) / 100, 125)
})

test("the shift's figures list the manual discounts; a role granted it can use it; backups keep it", async (t) => {
  if (!requireDb(t)) return
  const live = ok(await svc.call('shifts.liveSummary', { shiftId: ownerShift }, owner))
  assert.equal(live.manualDiscounts.count, 2)
  assert.equal(live.manualDiscounts.total, 12)
  assert.deepEqual(
    live.manualDiscounts.invoices.map((m) => [m.amount, m.username]),
    [
      [2, 'owner'],
      [10, 'owner']
    ]
  )

  // The owner gives the permission to a custom role.
  const role = ok(
    await svc.call(
      'roles.create',
      {
        name: 'كاشير بخصم',
        permissions: ['pos.sell', 'shifts.operate', 'pos.manual_discount']
      },
      owner
    )
  )
  const roleId = role.id ?? role.role?.id
  await createUser(svc, { username: 'senior', pin: '7319', roleKey: 'cashier' })
  await q("UPDATE users SET role_id = $1 WHERE username = 'senior'", [roleId])
  const senior = await login(svc, '7319')
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, senior)).id
  const sale = ok(
    await checkout(senior, shift, [{ barcode: 'YOG', qty: 1 }], {
      manualDiscount: { amount: 1, reason: 'عرض' },
      expectedTotal: 19
    })
  )
  assert.equal(sale.total, 19)

  // Backup and restore keep the manual columns.
  const backup = ok(await svc.call('backup.export', {}, owner))
  assert.ok(backup.tables.sales.columns.includes('manual_discount'))
  assert.ok(backup.tables.sale_discounts.columns.includes('reason'))
  ok(await svc.call('backup.restore', { backup, confirm: 'RESTORE' }, owner))
  const again = await login(svc, '8642')
  const after = ok(await svc.call('sales.detail', { saleId: sale.saleId }, again))
  assert.deepEqual(
    after.discounts.map((x) => [x.scope, x.amount, x.reason]),
    [['manual', 1, 'عرض']]
  )
})
