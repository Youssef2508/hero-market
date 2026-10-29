'use strict'
// Stage 4, phase 2: units and packaging, weighed products, scale labels, snapshots on lines.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts
} = require('./helpers')
const { createPool } = require('../../src/server/db/pool')
const { migrate, listMigrations } = require('../../src/server/db/migrate')
const { verifyLedger } = require('../../src/server/inventory/stock')

let db, svc, admin, shift, supplierId
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const stock = async (b) =>
  Number((await one('SELECT stock_qty FROM products WHERE barcode = $1', [b])).stock_qty)
const checkout = (items, extra = {}) =>
  svc.call(
    'pos.checkout',
    { clientRef: crypto.randomUUID(), shiftId: shift.id, paymentType: 'نقدي', items, ...extra },
    admin
  )
let cartonId

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, reorder_limit, unit, unit_kind) VALUES
      ('CAKE', 'كيك شوكولاتة', 2, 3, 2.8, 48, 0, 'قطعة', 'count'),
      ('CHZ', 'جبنة رومي', 120, 180, 170, 5, 0, 'كجم', 'weight'),
      ('00777', 'جبنة ميزان', 100, 180, 170, 10, 0, 'كجم', 'weight'),
      ('WATER', 'مياه', 4, 6, 5, 100, 0, 'زجاجة', 'count')`
  )
  admin = await login(svc, '8642')
  shift = ok(await svc.call('shifts.open', { startingCash: 0 }, admin))
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الحلويات' }, admin)).id
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('define packaging: carton = 24 pieces with its own barcode and price; extra base barcode', async (t) => {
  if (!requireDb(t)) return
  ok(
    await svc.call(
      'productUnits.save',
      {
        barcode: 'CAKE',
        baseBarcodes: ['CAKE-ALT'],
        units: [
          { name: 'كرتونة', factor: 24, retail_price: 60, barcodes: ['CAKE-CTN'] },
          // Typed package prices (D-065, D-096: here the same 3 × 6, typed, so kept as typed).
          { name: 'علبة 6', factor: 6, retail_price: 18, purchasable: false, barcodes: [] }
        ]
      },
      admin
    )
  )
  const u = ok(await svc.call('productUnits.get', { barcode: 'CAKE' }, admin))
  assert.deepEqual(u.baseBarcodes, ['CAKE-ALT'])
  assert.deepEqual(
    u.units.map((x) => [x.name, Number(x.factor), x.barcodes]),
    [
      ['علبة 6', 6, []],
      ['كرتونة', 24, ['CAKE-CTN']]
    ]
  )
  cartonId = u.units.find((x) => x.name === 'كرتونة').id

  // Scans: carton barcode → carton unit; extra barcode → base unit; the box at its own 18.
  const c = ok(await svc.call('pos.resolve', { code: 'CAKE-CTN' }, admin))
  assert.deepEqual(
    [c.product.barcode, c.unit.name, c.unit.factor, c.unit.price],
    ['CAKE', 'كرتونة', 24, 60]
  )
  assert.deepEqual(
    c.units.map((x) => [x.name, x.price]),
    [
      ['قطعة', 3],
      ['علبة 6', 18],
      ['كرتونة', 60]
    ]
  )
  const alt = ok(await svc.call('pos.resolve', { code: 'CAKE-ALT' }, admin))
  assert.deepEqual([alt.unit.id, alt.unit.factor], [null, 1])

  // Invalid definitions are refused.
  const bad = async (units, re) => {
    const r = await svc.call('productUnits.save', { barcode: 'CAKE', units }, admin)
    assert.ok([400, 409].includes(r.status), JSON.stringify(r.body))
    if (re) assert.match(r.body.error.message, re)
  }
  // Each case has a price (D-065), so only the rule it is about refuses it.
  await bad([{ name: 'كسر', factor: 2.5, retail_price: 1 }], /عدداً صحيحاً/)
  await bad(
    [
      { name: 'كرتونة', factor: 24, retail_price: 1 },
      { name: 'كرتونة', factor: 12, retail_price: 1 }
    ],
    /مكرر/
  )
  await bad([{ name: 'واحد', factor: 1, retail_price: 1 }], /مطابقة/)
  await bad([{ name: 'سرقة', factor: 2, retail_price: 1, barcodes: ['WATER'] }], /مستخدم بالفعل/)
  // A package marked as typed (not automatic) needs its price (D-096; an empty price without the
  // mark is automatic, tested in twoPrices.test.js).
  await bad([{ name: 'علبة بلا سعر', factor: 4, retail_auto: false }], /اكتب سعر بيع/)
  // A new product cannot take an existing extra barcode.
  const clash = await svc.call(
    'products.create',
    { barcode: 'CAKE-CTN', name: 'تضارب', retail_price: 1 },
    admin
  )
  assert.equal(clash.status, 409)
})

test('sell a carton and loose pieces of one product: stock moves by the base equivalent', async (t) => {
  if (!requireDb(t)) return
  const r = ok(
    await checkout([
      { barcode: 'CAKE', unitId: cartonId, qty: 1, unitPrice: 60 },
      { barcode: 'CAKE', qty: 5, unitPrice: 3 }
    ])
  )
  assert.equal(r.total, 75)
  assert.equal(await stock('CAKE'), 48 - 24 - 5)
  const lines = await q(
    'SELECT unit_id, unit_name, unit_factor, quantity, unit_price, cost_price, total_price FROM sale_items WHERE sale_id = $1 ORDER BY id',
    [r.saleId]
  )
  assert.deepEqual(
    lines.map((l) => [
      l.unit_id,
      l.unit_name,
      Number(l.unit_factor),
      Number(l.quantity),
      Number(l.unit_price),
      Number(l.cost_price),
      Number(l.total_price)
    ]),
    [
      [cartonId, 'كرتونة', 24, 1, 60, 48, 60],
      [null, 'قطعة', 1, 5, 3, 2, 15]
    ]
  )
  const mv = await q(
    "SELECT qty, unit_cost FROM stock_movements WHERE ref_type = 'sale' AND ref_id = $1 ORDER BY id",
    [r.saleId]
  )
  assert.deepEqual(
    mv.map((m) => [Number(m.qty), Number(m.unit_cost)]),
    [
      [-24, 2],
      [-5, 2]
    ]
  )
  // Half a carton is 12 pieces (allowed); 0.3 carton is 7.2 pieces (refused); 1.5 pieces refused.
  ok(await checkout([{ barcode: 'CAKE', unitId: cartonId, qty: 0.5, unitPrice: 60 }]))
  assert.equal(await stock('CAKE'), 19 - 12)
  assert.equal(
    (await checkout([{ barcode: 'CAKE', unitId: cartonId, qty: 0.3, unitPrice: 60 }])).status,
    400
  )
  assert.equal((await checkout([{ barcode: 'CAKE', qty: 1.5, unitPrice: 3 }])).status, 400)
  // A stale carton price is refused like a stale base price.
  const stale = await checkout([{ barcode: 'CAKE', unitId: cartonId, qty: 1, unitPrice: 72 }])
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error.details.price, 60)
  // The same line twice is refused; carton + pieces is not.
  assert.equal(
    (
      await checkout([
        { barcode: 'CAKE', qty: 1, unitPrice: 3 },
        { barcode: 'CAKE', qty: 2, unitPrice: 3 }
      ])
    ).status,
    400
  )
})

test('weighed product: 200 g, 250 g, 1.25 kg at a per-kilogram price; 3 decimals only', async (t) => {
  if (!requireDb(t)) return
  const start = await stock('CHZ')
  for (const [kg, total] of [
    [0.2, 36],
    [0.25, 45],
    [0.75, 135],
    [1.25, 225]
  ]) {
    const r = ok(await checkout([{ barcode: 'CHZ', qty: kg, unitPrice: 180 }]))
    assert.equal(r.total, total, `${kg} kg`)
  }
  assert.equal(await stock('CHZ'), Math.round((start - 2.45) * 1000) / 1000)
  assert.equal((await checkout([{ barcode: 'CHZ', qty: 0.2505, unitPrice: 180 }])).status, 400)
  // A "half kilo" unit at the price the owner enters (D-065).
  ok(
    await svc.call(
      'productUnits.save',
      {
        barcode: 'CHZ',
        units: [{ name: 'نصف كيلو', factor: 0.5, retail_price: 90, barcodes: ['CHZ-HALF'] }]
      },
      admin
    )
  )
  const half = ok(await svc.call('pos.resolve', { code: 'CHZ-HALF' }, admin))
  assert.deepEqual([half.unit.factor, half.unit.price], [0.5, 90])
  const before = await stock('CHZ')
  ok(await checkout([{ barcode: 'CHZ', unitId: half.unit.id, qty: 2, unitPrice: 90 }]))
  assert.equal(await stock('CHZ'), Math.round((before - 1) * 1000) / 1000)
})

test('scale labels follow the store settings (weight and price), including custom prefixes', async (t) => {
  if (!requireDb(t)) return
  // Off by default (manual weighing): a label is not resolved until the owner enables labels.
  assert.equal(ok(await svc.call('pos.resolve', { code: '2000777002502' }, admin)), null)
  const initial = JSON.parse((await svc.call('settings.get', {}, admin)).body.settings.scale_labels)
  ok(
    await svc.call(
      'settings.update',
      { values: { scale_labels: JSON.stringify({ ...initial, enabled: true }) } },
      admin
    )
  )
  // Default layout: 20 + code 00777 + 00250 g + EAN-13 check digit → 0.250 kg
  const w = ok(await svc.call('pos.resolve', { code: '2000777002502' }, admin))
  assert.deepEqual([w.product.barcode, w.qty, w.unit.id], ['00777', 0.25, null])
  // 22 + code + 04500 (45.00 EGP) → 45 / 180 = 0.25 kg
  const p = ok(await svc.call('pos.resolve', { code: '2200777045008' }, admin))
  assert.equal(p.qty, 0.25)
  // Unknown prefix: no product.
  assert.equal(ok(await svc.call('pos.resolve', { code: '2900777002505' }, admin)), null)
  // The owner adds prefix 29 for weight.
  const cfg = JSON.parse((await svc.call('settings.get', {}, admin)).body.settings.scale_labels)
  cfg.prefixes['29'] = 'weight'
  ok(await svc.call('settings.update', { values: { scale_labels: JSON.stringify(cfg) } }, admin))
  assert.equal(ok(await svc.call('pos.resolve', { code: '2900777001256' }, admin)).qty, 0.125)
  // Invalid settings are refused.
  const bad = await svc.call(
    'settings.update',
    { values: { scale_labels: JSON.stringify({ ...cfg, codeStart: 12 }) } },
    admin
  )
  assert.equal(bad.status, 400)
})

test("the owner's tomato label 2000001001257 sells 0.125 kg for 2.50; bad labels add nothing (SCALE-01)", async (t) => {
  if (!requireDb(t)) return
  // Labels on (the previous test enabled them); tomatoes registered under the label's code.
  ok(
    await svc.call(
      'products.create',
      {
        barcode: '2000001',
        name: 'طماطم',
        retail_price: 20,
        cost_price: 12,
        unit: 'كجم',
        unit_kind: 'weight',
        stock_qty: 10
      },
      admin
    )
  )
  const r = ok(await svc.call('pos.resolve', { code: '2000001001257' }, admin))
  assert.deepEqual(
    [r.product.barcode, r.qty, r.unit.id, r.unit.price],
    ['2000001', 0.125, null, 20]
  )
  const sale = ok(await checkout([{ barcode: '2000001', qty: r.qty, unitPrice: 20 }]))
  assert.equal(Number(sale.total), 2.5)
  assert.equal(await stock('2000001'), 9.875)
  const mv = await one(
    "SELECT qty FROM stock_movements WHERE product_barcode = '2000001' AND kind = 'sale' ORDER BY id DESC LIMIT 1"
  )
  assert.equal(Number(mv.qty), -0.125)
  // Return the 0.125 kg: stock back to 10.
  const line = await one('SELECT id FROM sale_items WHERE sale_id = $1', [sale.saleId])
  ok(await svc.call('sales.returnItem', { saleItemId: line.id, quantity: 0.125 }, admin))
  assert.equal(await stock('2000001'), 10)

  // A wrong check digit is explained and adds nothing.
  const bad = await svc.call('pos.resolve', { code: '2000001001250' }, admin)
  assert.equal(bad.status, 400)
  assert.match(bad.body.error.message, /رقم التحقق/)
  // A valid label of an unregistered code: explained (not a silent "not found").
  const unknown = await svc.call('pos.resolve', { code: '2000009001259' }, admin)
  assert.equal(unknown.status, 404)
  assert.match(unknown.body.error.message, /2000009/)
  // A weight label on a product sold by the piece is refused.
  ok(
    await svc.call(
      'products.create',
      { barcode: '2000002', name: 'علبة', retail_price: 5, unit_kind: 'count' },
      admin
    )
  )
  const mismatch = await svc.call('pos.resolve', { code: '2000002001256' }, admin)
  assert.equal(mismatch.status, 400)
  assert.match(mismatch.body.error.message, /يباع بالعدد/)
  // Zero weight: refused.
  const zero = await svc.call('pos.resolve', { code: '2000001000007' }, admin)
  assert.equal(zero.status, 400)
  // A normal product barcode still resolves as before.
  assert.equal(ok(await svc.call('pos.resolve', { code: '2000001' }, admin)).qty, null)
})

test('purchase by the carton: stock and purchase price per piece; line keeps the carton snapshot', async (t) => {
  if (!requireDb(t)) return
  const s = await stock('CAKE')
  const r = ok(
    await svc.call(
      'suppliers.addPurchase',
      {
        supplierId,
        invoice_ref: 'CTN-1',
        total_amount: 100,
        items: [{ barcode: 'CAKE', unitId: cartonId, qty: 2, unitCost: 50 }]
      },
      admin
    )
  )
  assert.equal(await stock('CAKE'), s + 48)
  // The latest purchase price per piece (D-087): 50 ÷ 24, whatever the stock held before.
  const cost = Number(
    (await one("SELECT cost_price FROM products WHERE barcode = 'CAKE'")).cost_price
  )
  assert.equal(cost, Math.round((50 / 24) * 10000) / 10000)
  const line = await one(
    'SELECT unit_name, unit_factor, qty, unit_cost, line_total FROM supplier_purchase_items WHERE purchase_id = $1',
    [r.purchaseId]
  )
  assert.deepEqual(
    [
      line.unit_name,
      Number(line.unit_factor),
      Number(line.qty),
      Number(line.unit_cost),
      Number(line.line_total)
    ],
    ['كرتونة', 24, 2, 50, 100]
  )
  // A unit that is not purchasable is refused, and nothing is written.
  const box6 = ok(await svc.call('productUnits.get', { barcode: 'CAKE' }, admin)).units.find(
    (u) => u.name === 'علبة 6'
  )
  const refused = await svc.call(
    'suppliers.addPurchase',
    {
      supplierId,
      invoice_ref: 'BOX',
      total_amount: 10,
      items: [{ barcode: 'CAKE', unitId: box6.id, qty: 1, unitCost: 10 }]
    },
    admin
  )
  assert.equal(refused.status, 400)
  assert.equal(
    (await one("SELECT count(*)::int AS n FROM supplier_purchases WHERE invoice_ref = 'BOX'")).n,
    0
  )
})

test('returns in the line unit use the snapshot factor, even after the unit was changed', async (t) => {
  if (!requireDb(t)) return
  const sale = ok(await checkout([{ barcode: 'CAKE', unitId: cartonId, qty: 1, unitPrice: 60 }]))
  const item = await one('SELECT id FROM sale_items WHERE sale_id = $1', [sale.saleId])
  // Return 6 pieces = 0.25 carton: refund 15, stock +6.
  let s = await stock('CAKE')
  const r1 = ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: item.id, quantity: 0.25, currentShiftId: shift.id },
      admin
    )
  )
  assert.equal(r1.netRefund, 15)
  assert.equal(await stock('CAKE'), s + 6)
  // 0.1 carton = 2.4 pieces: refused.
  assert.equal(
    (await svc.call('sales.returnItem', { saleItemId: item.id, quantity: 0.1 }, admin)).status,
    400
  )
  // The owner now redefines the carton as 20 pieces at 50: history is unchanged.
  ok(
    await svc.call(
      'productUnits.save',
      {
        barcode: 'CAKE',
        baseBarcodes: ['CAKE-ALT'],
        units: [
          { id: cartonId, name: 'كرتونة', factor: 20, retail_price: 50, barcodes: ['CAKE-CTN'] }
        ]
      },
      admin
    )
  )
  const line = await one('SELECT unit_factor, unit_price FROM sale_items WHERE id = $1', [item.id])
  assert.deepEqual([Number(line.unit_factor), Number(line.unit_price)], [24, 60])
  // Returning the remaining 0.75 carton puts back 18 pieces (24-piece snapshot), not 15.
  s = await stock('CAKE')
  ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: item.id, quantity: 0.75, currentShiftId: shift.id },
      admin
    )
  )
  assert.equal(await stock('CAKE'), s + 18)
  // The removed "box of 6" unit is deactivated (kept for history) and can no longer be sold.
  const units = ok(await svc.call('productUnits.get', { barcode: 'CAKE' }, admin)).units
  assert.deepEqual(
    units.map((u) => u.name),
    ['كرتونة']
  )
  const box = await one("SELECT id, is_active FROM product_units WHERE name = 'علبة 6'")
  assert.equal(box.is_active, false)
  assert.equal((await checkout([{ barcode: 'CAKE', unitId: box.id, qty: 1 }])).status, 400)
})

test('reports count quantities in base units; ledger holds after every unit operation', async (t) => {
  if (!requireDb(t)) return
  const best = ok(await svc.call('reports.bestSellers', { period: 'weekly' }, admin))
  const cake = best.top.find((p) => p.barcode === 'CAKE')
  const soldPieces = Number(
    (
      await one(
        "SELECT SUM((quantity - returned_qty) * unit_factor) AS n FROM sale_items WHERE product_barcode = 'CAKE'"
      )
    ).n
  )
  assert.equal(Number(cake.total_qty_sold), soldPieces)
  // 24 + 5 + 12 (+24 − 6 − 18 returned) = 41 pieces
  assert.equal(soldPieces, 41)
  assert.deepEqual(await verifyLedger(svc.pool), [])
})

test('product kind: switching to whole pieces is refused while stock or factors are fractional', async (t) => {
  if (!requireDb(t)) return
  const r = await svc.call(
    'products.update',
    {
      barcode: 'CHZ',
      name: 'جبنة رومي',
      retail_price: 180,
      cost_price: 120,
      unit: 'كجم',
      unit_kind: 'count'
    },
    admin
  )
  assert.equal(r.status, 400)
  // Damaged goods follow the kind: 0.5 piece of water is refused, 0.125 kg of cheese is fine.
  assert.equal(
    (await svc.call('damaged.create', { barcode: 'WATER', quantity: 0.5 }, admin)).status,
    400
  )
  ok(await svc.call('damaged.create', { barcode: 'CHZ', quantity: 0.125 }, admin))
})

test('migration 0005 on an existing store: kinds inferred, old lines become base-unit lines', async (t) => {
  if (!requireDb(t)) return
  const fresh = await freshDatabase()
  const pool = createPool(fresh.url, { max: 2 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig5-'))
  try {
    for (const m of listMigrations().filter((x) => Number(x.version) < 5))
      fs.copyFileSync(
        path.join(__dirname, '../../src/server/db/migrations', `${m.name}.sql`),
        path.join(tmp, `${m.name}.sql`)
      )
    const quiet = { info() {} }
    await migrate(pool, { dir: tmp, logger: quiet })
    const c = await pool.connect()
    await c.query('BEGIN')
    await c.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
    await c.query(`INSERT INTO products (barcode, name, unit, stock_qty) VALUES
      ('K1', 'جبنة', 'كجم', 2), ('K2', 'زيتون فرط', 'قطعة', 1.5), ('K3', 'بسكويت', 'قطعة', 10),
      ('K4', 'زيت', 'لتر', 3), ('K5', 'لب', 'كيس', 4)`)
    await c.query("SELECT hm_post_opening_balances('t')")
    await c.query('COMMIT')
    c.release()
    await pool.query("INSERT INTO users (id, username) VALUES (1, 'old-cashier')")
    await pool.query(
      "INSERT INTO shifts (id, user_id, start_time, initial_cash, status) VALUES (1, 1, LOCALTIMESTAMP(0), 0, 'open')"
    )
    await pool.query('INSERT INTO sales (id, shift_id, total_amount) VALUES (1, 1, 10)')
    await pool.query(
      "INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price) VALUES (1, 'K5', 0.5, 20, 10)"
    )
    await migrate(pool, { logger: quiet })
    const kinds = (await pool.query('SELECT barcode, unit_kind FROM products ORDER BY barcode'))
      .rows
    assert.deepEqual(
      kinds.map((k) => [k.barcode, k.unit_kind]),
      [
        ['K1', 'weight'],
        ['K2', 'weight'],
        ['K3', 'count'],
        ['K4', 'volume'],
        ['K5', 'weight']
      ]
    )
    const line = (await pool.query('SELECT unit_factor, unit_id FROM sale_items')).rows[0]
    assert.deepEqual([Number(line.unit_factor), line.unit_id], [1, null])
    assert.deepEqual(await verifyLedger(pool), [])
  } finally {
    await pool.end()
    await fresh.dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
