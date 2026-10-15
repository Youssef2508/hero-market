'use strict'
// Administrator-managed automatic discounts (owner decision 2026-10-15).
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

let db, svc, owner, storeAdmin, manager, cashier, shift
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const sell = (items, token = cashier, extra = {}) =>
  svc.call(
    'pos.checkout',
    { clientRef: crypto.randomUUID(), shiftId: shift.id, paymentType: 'نقدي', items, ...extra },
    token
  )
const rule = async (body) => ok(await svc.call('discounts.save', body, owner))
const off = (id) => svc.call('discounts.setActive', { id, isActive: false }, owner)
const sumCents = (xs) => xs.reduce((s, x) => s + Math.round(Number(x) * 100), 0)

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'storeadmin', pin: '7531', roleKey: 'store_admin' })
  await createUser(svc, { username: 'supervisor', pin: '9517', roleKey: 'manager' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, unit_kind) VALUES
      ('A', 'صنف أ', 60, 100, 500, 'قطعة', 'count'),
      ('B', 'صنف ب', 20, 33.33, 500, 'قطعة', 'count'),
      ('C', 'صنف ج', 5, 10.01, 500, 'قطعة', 'count'),
      ('CHZ', 'جبنة برميلي', 180, 240, 50, 'كجم', 'weight'),
      ('T499', 'حد 499.99', 1, 499.99, 50, 'قطعة', 'count'),
      ('T500', 'حد 500', 1, 500, 50, 'قطعة', 'count'),
      ('T999', 'حد 999.99', 1, 999.99, 50, 'قطعة', 'count'),
      ('T1000', 'حد 1000', 1, 1000, 50, 'قطعة', 'count')`
  )
  owner = await login(svc, '8642')
  storeAdmin = await login(svc, '7531')
  manager = await login(svc, '9517')
  cashier = await login(svc, '5173')
  shift = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier))
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('only administrators manage discounts; cashiers and supervisors are refused by the API', async (t) => {
  if (!requireDb(t)) return
  const body = { name: 'محاولة', scope: 'cart', valueType: 'percent', value: 50, minTotal: 0 }
  for (const token of [cashier, manager]) {
    assert.equal((await svc.call('discounts.save', body, token)).status, 403)
    assert.equal((await svc.call('discounts.list', {}, token)).status, 403)
    assert.equal(
      (await svc.call('discounts.setActive', { id: 1, isActive: true }, token)).status,
      403
    )
  }
  const r = ok(await svc.call('discounts.save', { ...body, name: 'تجربة' }, storeAdmin))
  ok(await off(r.id))
  // Invalid rules are refused.
  for (const bad of [
    { ...body, value: 101 },
    { ...body, value: 0 },
    { name: 'بدون صنف', scope: 'product', valueType: 'percent', value: 5 },
    { ...body, startsAt: '2026-11-02 00:00', endsAt: '2026-11-01 00:00' }
  ])
    assert.equal((await svc.call('discounts.save', bad, owner)).status, 400, JSON.stringify(bad))
  // A manual discount is refused for an administrator operating the till too.
  assert.equal((await sell([{ barcode: 'A', qty: 1 }], owner, { discount: 1 })).status, 403)
})

test('product discount applies automatically and identically for a cashier and an administrator', async (t) => {
  if (!requireDb(t)) return
  const r = await rule({
    name: 'أ 10%',
    scope: 'product',
    productBarcode: 'A',
    valueType: 'percent',
    value: 10
  })
  const byCashier = ok(await sell([{ barcode: 'A', qty: 2, unitPrice: 100 }], cashier))
  // The administrator sells on their own shift: same items, same automatic result.
  const ownerShift = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
  const byOwner = ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: ownerShift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'A', qty: 2, unitPrice: 100 }]
      },
      owner
    )
  )
  ok(await svc.call('shifts.close', { shiftId: ownerShift.id, actualCash: 180 }, owner))
  for (const s of [byCashier, byOwner]) {
    assert.deepEqual([s.subTotal, s.discount, s.total], [200, 20, 180])
    assert.deepEqual(
      s.discounts.map((d) => [d.name, d.amount]),
      [['أ 10%', 20]]
    )
  }
  const line = await one(
    'SELECT line_discount, cart_discount, total_price FROM sale_items WHERE sale_id = $1',
    [byCashier.saleId]
  )
  assert.deepEqual(
    [Number(line.total_price), Number(line.line_discount), Number(line.cart_discount)],
    [200, 20, 0]
  )
  const sale = await one(
    'SELECT original_amount, discount, total_amount, pricing_version FROM sales WHERE id = $1',
    [byCashier.saleId]
  )
  assert.deepEqual(
    [
      Number(sale.original_amount),
      Number(sale.discount),
      Number(sale.total_amount),
      sale.pricing_version
    ],
    [200, 20, 180, 2]
  )
  // A larger product rule wins; rules never stack on one line.
  const r2 = await rule({
    name: 'أ 15 للقطعة',
    scope: 'product',
    productBarcode: 'A',
    valueType: 'amount',
    value: 15
  })
  const best = ok(await sell([{ barcode: 'A', qty: 2, unitPrice: 100 }]))
  assert.deepEqual([best.discount, best.discounts.map((d) => d.name)], [30, ['أ 15 للقطعة']])
  ok(await off(r.id))
  ok(await off(r2.id))
})

test('weighed product: an amount per kilogram is applied to the weight sold', async (t) => {
  if (!requireDb(t)) return
  const r = await rule({
    name: 'جبنة 20 للكيلو',
    scope: 'product',
    productBarcode: 'CHZ',
    valueType: 'amount',
    value: 20
  })
  const s = ok(await sell([{ barcode: 'CHZ', qty: 0.25, unitPrice: 240 }]))
  assert.deepEqual([s.subTotal, s.discount, s.total], [60, 5, 55])
  ok(await off(r.id))
})

test('cart tiers: 5% from EGP 500 and 10% from EGP 1,000, exactly at the threshold', async (t) => {
  if (!requireDb(t)) return
  const t1 = await rule({
    name: '5% من 500',
    scope: 'cart',
    valueType: 'percent',
    value: 5,
    minTotal: 500
  })
  const t2 = await rule({
    name: '10% من 1000',
    scope: 'cart',
    valueType: 'percent',
    value: 10,
    minTotal: 1000
  })
  const cases = [
    ['T499', 499.99, 0],
    ['T500', 500, 25],
    ['T999', 999.99, 50],
    ['T1000', 1000, 100]
  ]
  for (const [code, price, discount] of cases) {
    const s = ok(await sell([{ barcode: code, qty: 1, unitPrice: price }]))
    assert.equal(s.discount, discount, `${price}`)
    assert.equal(s.total, Math.round((price - discount) * 100) / 100)
    assert.ok(s.discounts.length <= 1, 'tiers do not stack')
  }
  // The preview gives the till the same figures checkout will apply.
  const preview = ok(
    await svc.call('pos.price', { items: [{ barcode: 'T1000', qty: 1 }] }, cashier)
  )
  assert.deepEqual(
    [preview.discount, preview.afterDiscount, preview.applied[0].name],
    [100, 900, '10% من 1000']
  )
  ok(await off(t1.id))
  ok(await off(t2.id))
})

test('thresholds use the total after product discounts; shares add up exactly across lines', async (t) => {
  if (!requireDb(t)) return
  const pr = await rule({
    name: 'أ 30 للقطعة',
    scope: 'product',
    productBarcode: 'A',
    valueType: 'amount',
    value: 30
  })
  const tier = await rule({
    name: '5% من 500',
    scope: 'cart',
    valueType: 'percent',
    value: 5,
    minTotal: 500
  })
  // Gross 520 (A×2 + T... ) → after product discount 520 − 60 = 460 < 500: no cart discount.
  const below = ok(
    await sell([
      { barcode: 'A', qty: 2, unitPrice: 100 },
      { barcode: 'B', qty: 3, unitPrice: 33.33 },
      { barcode: 'C', qty: 22, unitPrice: 10.01 }
    ])
  )
  assert.equal(below.subTotal, 520.21)
  assert.deepEqual(
    below.discounts.map((d) => d.name),
    ['أ 30 للقطعة']
  )
  // Above the threshold after product discounts: awkward amounts, shares sum to the cart discount.
  const above = ok(
    await sell([
      { barcode: 'A', qty: 4, unitPrice: 100 },
      { barcode: 'B', qty: 3, unitPrice: 33.33 },
      { barcode: 'C', qty: 7, unitPrice: 10.01 }
    ])
  )
  // Gross 400 + 99.99 + 70.07 = 570.06; product discount 120 → eligible 450.06 < 500: none.
  assert.equal(above.discounts.length, 1)
  const big = ok(
    await sell([
      { barcode: 'A', qty: 6, unitPrice: 100 },
      { barcode: 'B', qty: 3, unitPrice: 33.33 },
      { barcode: 'C', qty: 7, unitPrice: 10.01 }
    ])
  )
  // Gross 600 + 99.99 + 70.07 = 770.06; product 180 → eligible 590.06; 5% = 29.50
  const cartD = big.discounts.find((d) => d.scope === 'cart')
  assert.equal(cartD.amount, 29.5)
  const lines = await q(
    'SELECT line_discount, cart_discount, total_price FROM sale_items WHERE sale_id = $1 ORDER BY id',
    [big.saleId]
  )
  assert.equal(sumCents(lines.map((l) => l.cart_discount)), 2950)
  for (const l of lines)
    assert.ok(Number(l.cart_discount) <= Number(l.total_price) - Number(l.line_discount))
  assert.equal(big.total, Math.round((770.06 - 180 - 29.5) * 100) / 100)
  ok(await off(pr.id))
  ok(await off(tier.id))
})

test('returns: partial and full refunds add up to what was paid; drawer counts the sale as sold (K-40)', async (t) => {
  if (!requireDb(t)) return
  const pr = await rule({
    name: 'أ 10%',
    scope: 'product',
    productBarcode: 'A',
    valueType: 'percent',
    value: 10
  })
  const tier = await rule({
    name: '5% من 500',
    scope: 'cart',
    valueType: 'percent',
    value: 5,
    minTotal: 500
  })
  const s2 = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
  const s = ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: s2.id,
        paymentType: 'نقدي',
        items: [
          { barcode: 'A', qty: 7, unitPrice: 100 },
          { barcode: 'C', qty: 3, unitPrice: 10.01 }
        ]
      },
      owner
    )
  )
  // Gross 700 + 30.03; product 70 → eligible 660.03; 5% = 33.00 → paid 627.03
  assert.equal(s.total, 627.03)
  const [la, lc] = await q('SELECT id FROM sale_items WHERE sale_id = $1 ORDER BY id', [s.saleId])
  const refunds = []
  for (const [id, qty] of [
    [la.id, 2],
    [la.id, 3],
    [lc.id, 1]
  ])
    refunds.push(
      ok(
        await svc.call(
          'sales.returnItem',
          { saleItemId: id, quantity: qty, currentShiftId: s2.id },
          owner
        )
      ).netRefund
    )
  refunds.push(
    Number((await one('SELECT total_amount FROM sales WHERE id = $1', [s.saleId])).total_amount)
  )
  ok(await svc.call('sales.returnEntire', { saleId: s.saleId, currentShiftId: s2.id }, owner))
  assert.equal(sumCents(refunds), 62703, `refunds ${refunds.join(' + ')} = paid`)
  const sale = await one('SELECT discount, total_amount FROM sales WHERE id = $1', [s.saleId])
  assert.deepEqual(
    [Number(sale.discount), Number(sale.total_amount)],
    [103, 0],
    'discount kept as sold'
  )
  // Drawer: sold 627.03 in cash, everything refunded from the drawer → expected 0.
  const live = ok(await svc.call('shifts.liveSummary', { shiftId: s2.id }, owner))
  assert.equal(live.drawer.expected, 0)
  ok(await svc.call('shifts.close', { shiftId: s2.id, actualCash: 0 }, owner))
  ok(await off(pr.id))
  ok(await off(tier.id))
})

test('history is preserved after price and rule changes; activation window and deactivation', async (t) => {
  if (!requireDb(t)) return
  const r = await rule({
    name: 'ب 10%',
    scope: 'product',
    productBarcode: 'B',
    valueType: 'percent',
    value: 10
  })
  const s = ok(await sell([{ barcode: 'B', qty: 3, unitPrice: 33.33 }]))
  // The owner changes the price and the rule afterwards.
  ok(
    await svc.call(
      'products.update',
      { barcode: 'B', name: 'صنف ب', cost_price: 20, retail_price: 40, unit: 'قطعة' },
      owner
    )
  )
  ok(
    await svc.call(
      'discounts.save',
      {
        id: r.id,
        version: r.version,
        name: 'ب 50%',
        scope: 'product',
        productBarcode: 'B',
        valueType: 'percent',
        value: 50
      },
      owner
    )
  )
  const line = await one('SELECT unit_price, line_discount FROM sale_items WHERE sale_id = $1', [
    s.saleId
  ])
  assert.deepEqual([Number(line.unit_price), Number(line.line_discount)], [33.33, 10])
  const saved = await q('SELECT name, value, amount FROM sale_discounts WHERE sale_id = $1', [
    s.saleId
  ])
  assert.deepEqual(
    saved.map((d) => [d.name, Number(d.value), Number(d.amount)]),
    [['ب 10%', 10, 10]]
  )
  // A stale edit (old version) is refused.
  assert.equal(
    (
      await svc.call(
        'discounts.save',
        {
          id: r.id,
          version: r.version,
          name: 'قديم',
          scope: 'product',
          productBarcode: 'B',
          valueType: 'percent',
          value: 5
        },
        owner
      )
    ).status,
    409
  )
  // Not yet started / already ended / deactivated → not applied.
  ok(await off(r.id))
  const future = await rule({
    name: 'مستقبلي',
    scope: 'product',
    productBarcode: 'C',
    valueType: 'percent',
    value: 50,
    startsAt: '2099-01-01 00:00'
  })
  const past = await rule({
    name: 'منتهي',
    scope: 'product',
    productBarcode: 'C',
    valueType: 'percent',
    value: 50,
    startsAt: '2020-01-01 00:00',
    endsAt: '2020-02-01 00:00'
  })
  const none = ok(await sell([{ barcode: 'C', qty: 1, unitPrice: 10.01 }]))
  assert.equal(none.discount, 0)
  const nowRule = await rule({
    name: 'ساري',
    scope: 'product',
    productBarcode: 'C',
    valueType: 'percent',
    value: 50,
    startsAt: '2020-01-01 00:00',
    endsAt: '2099-01-01 00:00'
  })
  assert.equal(ok(await sell([{ barcode: 'C', qty: 1, unitPrice: 10.01 }])).discount, 5.01)
  for (const x of [future, past, nowRule]) ok(await off(x.id))
  assert.equal(ok(await sell([{ barcode: 'C', qty: 1, unitPrice: 10.01 }])).discount, 0)
})

test('a total that changed since the till showed it is refused, and nothing is written', async (t) => {
  if (!requireDb(t)) return
  const shown = ok(await svc.call('pos.price', { items: [{ barcode: 'A', qty: 1 }] }, cashier))
  assert.equal(shown.afterDiscount, 100)
  const r = await rule({
    name: 'أ مفاجئ',
    scope: 'product',
    productBarcode: 'A',
    valueType: 'amount',
    value: 10
  })
  const before = (await one('SELECT count(*)::int AS n FROM sales')).n
  const stale = await sell([{ barcode: 'A', qty: 1, unitPrice: 100 }], cashier, {
    expectedTotal: 100
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error.details.total, 90)
  assert.equal((await one('SELECT count(*)::int AS n FROM sales')).n, before)
  ok(await sell([{ barcode: 'A', qty: 1, unitPrice: 100 }], cashier, { expectedTotal: 90 }))
  ok(await off(r.id))
})

test('reports use net amounts; every rule change is audited', async (t) => {
  if (!requireDb(t)) return
  const best = ok(await svc.call('reports.bestSellers', { period: 'weekly' }, owner))
  const a = best.top.find((p) => p.barcode === 'A')
  const net = Number(
    (
      await one(
        "SELECT SUM(total_price - line_discount - cart_discount) AS n FROM sale_items WHERE product_barcode = 'A'"
      )
    ).n
  )
  assert.equal(Number(a.total_revenue), net)
  const audit = await q(
    "SELECT action_type FROM system_logs WHERE action_type LIKE 'discount_%' ORDER BY id"
  )
  const kinds = new Set(audit.map((x) => x.action_type))
  for (const k of ['discount_create', 'discount_update', 'discount_deactivate'])
    assert.ok(kinds.has(k), k)
  const upd = await one(
    "SELECT details FROM system_logs WHERE action_type = 'discount_update' ORDER BY id DESC LIMIT 1"
  )
  assert.match(String(upd.details), /50/)
})
