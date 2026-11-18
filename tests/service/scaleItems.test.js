'use strict'
// Scale items keep their own codes (1.9.0, D-117): a product marked «صنف ميزان» is found from a scale
// label by its own code (1, not 2000001), typed codes stay exact (1, 01, 001), and nothing that
// would let one label name two products can be saved – in either order, by any route, concurrently.
// The scale settings are the owner's own (prefix 20, item code at offsets 2–6, grams, EAN-13).
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
const { ean13CheckDigit } = require('../../src/server/inventory/units')

let db, svc, owner, cashier
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const SCALE = {
  enabled: true,
  length: 13,
  codeStart: 2,
  codeLength: 5,
  valueStart: 7,
  valueLength: 5,
  weightDivisor: 1000,
  priceDivisor: 100,
  prefixes: { 20: 'weight' },
  checkDigit: 'ean13'
}
/** A label of the owner's scale: prefix 20, item code (5 digits), grams (5 digits), check digit. */
const label = (code, grams) => {
  const twelve = `20${String(code).padStart(5, '0')}${String(grams).padStart(5, '0')}`
  return twelve + ean13CheckDigit(twelve)
}
const setScale = (barcode, enabled, who = owner) =>
  svc.call('products.setScaleItem', { barcode, enabled }, who)
const resolve = (code) => svc.call('pos.resolve', { code }, cashier)

before(async (t) => {
  if (!requireDb(t)) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  ok(await svc.call('settings.update', { values: { scale_labels: JSON.stringify(SCALE) } }, owner))
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, unit_kind, category) VALUES
     ('1', 'جبنة رومي', 300, 400, 20, 'كيلو', 'weight', 'ألبان'),
     ('01', 'جبنة بيضاء', 100, 140, 20, 'كيلو', 'weight', 'ألبان'),
     ('001', 'جبنة شيدر', 300, 380, 20, 'كيلو', 'weight', 'ألبان'),
     ('0001', 'لانشون', 300, 396, 20, 'كيلو', 'weight', 'لحوم'),
     ('2000005', 'زيتون (مسجل بكود الملصق)', 150, 200, 20, 'كيلو', 'weight', 'مخللات'),
     ('7', 'حلاوة سايبة', 100, 160, 20, 'كيلو', 'weight', 'حلويات'),
     ('07', 'طحينة سايبة', 100, 150, 20, 'كيلو', 'weight', 'حلويات'),
     ('12', 'بلح', 50, 80, 20, 'كيلو', 'weight', 'فاكهة'),
     ('PEPSI', 'بيبسي', 10, 13, 50, 'علبة', 'count', 'مشروبات'),
     ('6221234567890', 'بسكويت', 4, 5, 50, 'علبة', 'count', 'بسكويت')`
  )
})

after(async () => {
  await svc?.close()
  await db?.dispose()
})

test('a scale item keeps its code: typed 1 is 1, and its label 2000001 00125 7 is 1 with 0.125 kg', async (t) => {
  if (!requireDb(t)) return
  const r = ok(await setScale('1', true))
  assert.equal(r.scaleKey, '1')
  const p = await one('SELECT barcode, scale_item, scale_key FROM products WHERE barcode = $1', [
    '1'
  ])
  assert.deepEqual(
    p,
    { barcode: '1', scale_item: true, scale_key: '1' },
    'the code itself is unchanged'
  )
  // The owner's example label.
  assert.equal(label(1, 125), '2000001001257')
  const scanned = ok(await resolve('2000001001257'))
  assert.equal(scanned.product.barcode, '1')
  assert.equal(scanned.qty, 0.125)
  // Typed codes stay exact (D-110): 1, 01, 001 and 0001 are four products.
  for (const code of ['1', '01', '001', '0001'])
    assert.equal(ok(await resolve(code)).product.barcode, code, `typed ${code}`)
})

test('the same scale code is refused in either order: 1 then 01, 01 then 1, 001 then 0001', async (t) => {
  if (!requireDb(t)) return
  // 1 is a scale item (previous test): 01, 001 and 0001 would be read from the same label.
  for (const code of ['01', '001', '0001']) {
    const r = await setScale(code, true)
    assert.equal(r.status, 409, code)
    assert.equal(r.body.error.details.code, 'scale_conflict')
    assert.match(r.body.error.message, /الصنف المتعارض: جبنة رومي — الكود: 1/)
    assert.match(r.body.error.message, /غيّر كود أحد الصنفين أو عطّل خاصية الميزان للصنف الآخر/)
    assert.equal(
      (await one('SELECT scale_item FROM products WHERE barcode = $1', [code])).scale_item,
      false
    )
  }
  // The other order, 03 first then 3 (codes with no older product of the same key in the store).
  for (const code of ['03', '004', '0004'])
    ok(
      await svc.call(
        'products.create',
        {
          barcode: code,
          name: `صنف ${code}`,
          retail_price: 100,
          unit: 'كيلو',
          unit_kind: 'weight'
        },
        owner
      )
    )
  ok(await setScale('03', true))
  ok(
    await svc.call(
      'products.create',
      { barcode: '3', name: 'صنف 3', retail_price: 100, unit: 'كيلو', unit_kind: 'weight' },
      owner
    )
  )
  const back = await setScale('3', true)
  assert.equal(back.status, 409)
  assert.match(back.body.error.message, /صنف 03 — الكود: 03/)
  // 004 then 0004.
  ok(await setScale('004', true))
  assert.equal((await setScale('0004', true)).status, 409)
  // Unmarking and marking again is allowed once the other is off.
  ok(await setScale('004', false))
  ok(await setScale('0004', true))
  ok(await setScale('0004', false))
  // With 1 unmarked, 01 may be marked: an unmarked product is only its own code (owner,
  // 2026-11-18). The labels 2000001… then name 01; typing 1 is still 1.
  ok(await setScale('1', false))
  ok(await setScale('01', true))
  assert.equal(ok(await resolve(label(1, 125))).product.barcode, '01')
  assert.equal(ok(await resolve('1')).product.barcode, '1')
  ok(await setScale('01', false))
  ok(await setScale('1', true))
})

test('the shop case: 1 can be marked while an unmarked 00001 exists, and each stays itself', async (t) => {
  if (!requireDb(t)) return
  // Before anything is marked for the key, a label 2000001… finds 00001 (the older lookup order).
  ok(await setScale('1', false))
  ok(
    await svc.call(
      'products.create',
      { barcode: '00001', name: 'طبق فوم كبير', retail_price: 5, unit: 'قطعة' },
      owner
    )
  )
  // (00001 is sold by the piece, so that weight label is refused for it, as in 1.8.0.)
  const before = await resolve(label(1, 125))
  assert.equal(before.status, 400)
  assert.match(before.body.error.message, /طبق فوم كبير/)
  // Marking 1 is allowed: its labels now name 1 with the label's weight.
  ok(await setScale('1', true))
  const scanned = ok(await resolve(label(1, 125)))
  assert.equal(scanned.product.barcode, '1')
  assert.equal(scanned.qty, 0.125)
  // Typed codes are exact: 1 is 1, 00001 is 00001, unchanged and unmarked.
  assert.equal(ok(await resolve('1')).product.barcode, '1')
  assert.equal(ok(await resolve('00001')).product.barcode, '00001')
  assert.deepEqual(
    await one("SELECT scale_item, scale_key FROM products WHERE barcode = '00001'"),
    {
      scale_item: false,
      scale_key: null
    }
  )
  // The audit has nothing to say about it.
  assert.deepEqual(ok(await svc.call('products.scaleAudit', {}, owner)).problems, [])
})

test('two scale items with one key are impossible even in the database', async (t) => {
  if (!requireDb(t)) return
  await assert.rejects(
    svc.pool.query("UPDATE products SET scale_item = true, scale_key = '1' WHERE barcode = '01'"),
    /products_scale_key_unique/
  )
})

test('a product registered the older way under the label digits does not stop a scale item', async (t) => {
  if (!requireDb(t)) return
  // 2000005 (the label's digits), unmarked, answers labels of code 5 while nothing is marked. Marking
  // 5 takes those labels; 2000005 stays its own code.
  ok(
    await svc.call(
      'products.create',
      {
        barcode: '5',
        name: 'زبدة سايبة',
        retail_price: 350,
        cost_price: 300,
        unit: 'كيلو',
        unit_kind: 'weight'
      },
      owner
    )
  )
  assert.equal(ok(await resolve(label(5, 250))).product.barcode, '2000005')
  ok(await setScale('5', true))
  assert.equal(ok(await resolve(label(5, 250))).product.barcode, '5')
  assert.equal(ok(await resolve('2000005')).product.barcode, '2000005')
  // Unmarked again, the label goes back to the older registration.
  ok(await setScale('5', false))
  assert.equal(ok(await resolve(label(5, 250))).product.barcode, '2000005')
})

test('a barcode that is itself a label of a scale item cannot be given to another product', async (t) => {
  if (!requireDb(t)) return
  // As a new product's code.
  const asNew = await svc.call(
    'products.create',
    { barcode: label(1, 500), name: 'جبنة معبأة', retail_price: 200, unit: 'علبة' },
    owner
  )
  assert.equal(asNew.status, 409)
  assert.equal(asNew.body.error.details.code, 'scale_conflict')
  // As an extra barcode of another product.
  const units = await svc.call(
    'productUnits.save',
    { barcode: 'PEPSI', units: [], baseBarcodes: [label(1, 750)] },
    owner
  )
  assert.equal(units.status, 409, JSON.stringify(units.body))
  // A code that is not a whole label is only itself: 2000001 may be a product while 1 is marked,
  // and a label of 1 still names 1.
  ok(
    await svc.call(
      'products.create',
      { barcode: '2000001', name: 'صنف 2000001', retail_price: 10, unit: 'قطعة' },
      owner
    )
  )
  assert.equal(ok(await resolve(label(1, 300))).product.barcode, '1')
  assert.equal(ok(await resolve('2000001')).product.barcode, '2000001')
  // And the other way: a product whose own barcode is a label of code 12 stops 12 becoming a scale item.
  ok(
    await svc.call(
      'products.create',
      { barcode: label(12, 300), name: 'بلح معبأ', retail_price: 30, unit: 'علبة' },
      owner
    )
  )
  const twelve = await setScale('12', true)
  assert.equal(twelve.status, 409)
  assert.match(twelve.body.error.message, /بلح معبأ/)
})

test('changing a scale item code is checked as a scale code', async (t) => {
  if (!requireDb(t)) return
  // A second scale item, 7; changing its code to 01 would make it the same scale code as 1.
  ok(await setScale('7', true))
  const r = await svc.call('products.changeBarcode', { barcode: '7', newBarcode: '0000001' }, owner)
  assert.equal(r.status, 409)
  assert.ok(
    await one("SELECT 1 FROM products WHERE barcode = '7' AND scale_key = '7'"),
    'nothing changed'
  )
  // A free code is fine, and the key follows the code.
  ok(await svc.call('products.changeBarcode', { barcode: '7', newBarcode: '77' }, owner))
  assert.equal((await one("SELECT scale_key FROM products WHERE barcode = '77'")).scale_key, '77')
  assert.equal(ok(await resolve(label(77, 1000))).product.barcode, '77')
  ok(await svc.call('products.changeBarcode', { barcode: '77', newBarcode: '7' }, owner))
})

test('labels: wrong check digit, another prefix, zero weight and an unknown code never add another product', async (t) => {
  if (!requireDb(t)) return
  const good = label(1, 125)
  const badCheck = good.slice(0, 12) + ((Number(good[12]) + 1) % 10)
  const r = await resolve(badCheck)
  assert.equal(r.status, 400)
  assert.equal(r.body.error.details.scale, 'check_digit')
  // Prefix 21 is not configured: not a label, and no product has that code.
  const other = `21${good.slice(2, 12)}`
  assert.equal(ok(await resolve(other + ean13CheckDigit(other))), null)
  const zero = await resolve(label(1, 0))
  assert.equal(zero.status, 400)
  assert.equal(zero.body.error.details.scale, 'zero_value')
  const unknown = await resolve(label(999, 100))
  assert.equal(unknown.status, 404)
  assert.equal(unknown.body.error.details.scale, 'unknown_product')
})

test('products nobody marked resolve exactly as before 1.9.0; a mark takes its labels', async (t) => {
  if (!requireDb(t)) return
  // 7 and 07, both unmarked: a label of code 7 is 7, as in 1.8.0 (its exact code, never 07).
  ok(await setScale('7', false))
  assert.equal(ok(await resolve(label(7, 200))).product.barcode, '7')
  // A product registered the older way under the label's digits still comes first.
  assert.equal(ok(await resolve(label(5, 200))).product.barcode, '2000005')
  // Marking 07 takes the label from the unmarked 7; typing 7 is still 7.
  ok(await setScale('07', true))
  assert.equal(ok(await resolve(label(7, 200))).product.barcode, '07')
  assert.equal(ok(await resolve('7')).product.barcode, '7')
  ok(await setScale('07', false))
  assert.equal(ok(await resolve(label(7, 200))).product.barcode, '7')
})

test('a weight label on a product counted in pieces cannot be a scale item', async (t) => {
  if (!requireDb(t)) return
  ok(
    await svc.call(
      'products.create',
      { barcode: '44', name: 'شوكولاتة', retail_price: 10, unit: 'قطعة' },
      owner
    )
  )
  const r = await setScale('44', true)
  assert.equal(r.status, 400)
  assert.equal(r.body.error.details.code, 'scale_kind')
  // A code with letters, or longer than the label's item code, cannot be one either.
  assert.equal((await setScale('PEPSI', true)).status, 400)
  ok(
    await svc.call(
      'products.create',
      { barcode: '123456', name: 'كود طويل', retail_price: 10, unit: 'كيلو', unit_kind: 'weight' },
      owner
    )
  )
  assert.equal((await setScale('123456', true)).status, 400)
})

test('scale settings that a scale item no longer fits, or that make a label ambiguous, are refused', async (t) => {
  if (!requireDb(t)) return
  ok(
    await svc.call(
      'products.create',
      { barcode: '345', name: 'تمر', retail_price: 90, unit: 'كيلو', unit_kind: 'weight' },
      owner
    )
  )
  ok(await setScale('345', true))
  // A 2-digit item code cannot carry 345.
  const short = await svc.call(
    'settings.update',
    { values: { scale_labels: JSON.stringify({ ...SCALE, codeStart: 5, codeLength: 2 }) } },
    owner
  )
  assert.equal(short.status, 409)
  assert.ok(
    short.body.error.details.problems.some(
      (p) => p.barcode === '345' && /أطول من خانة كود الصنف/.test(p.message)
    ),
    JSON.stringify(short.body.error.details.problems)
  )
  // An unmarked product (01, whose code is now the label's item-code digits) is only its own code
  // and is not a problem: only what concerns a scale item is reported.
  assert.ok(
    !short.body.error.details.problems.some((p) => p.with?.barcode === '01'),
    JSON.stringify(short.body.error.details.problems)
  )
  // The saved settings are unchanged.
  assert.equal(
    JSON.parse((await one("SELECT value FROM settings WHERE key = 'scale_labels'")).value)
      .codeStart,
    2
  )
  // The audit lists what a change would break, and changes nothing.
  const audit = ok(await svc.call('products.scaleAudit', {}, owner))
  assert.equal(audit.problems.length, 0)
  assert.ok(audit.items >= 2)
})

test('two people marking 1 and 01 at the same moment: exactly one succeeds', async (t) => {
  if (!requireDb(t)) return
  ok(await setScale('1', false))
  const [a, b] = await Promise.all([setScale('1', true), setScale('01', true)])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  const marked = await q("SELECT barcode FROM products WHERE scale_key = '1'")
  assert.equal(marked.length, 1)
  if (marked[0].barcode === '01') {
    ok(await setScale('01', false))
    ok(await setScale('1', true))
  }
})

test('the import marks scale items and refuses rows a label could not tell apart', async (t) => {
  if (!requireDb(t)) return
  const base = { retail_price: 100, unit: 'كيلو', unit_kind: 'بالوزن' }
  // In the file: 8 and 008 both marked; 0001 against the store's scale item 1; a plain code 2000001.
  const bad = await svc.call(
    'storeImport.apply',
    {
      dryRun: true,
      products: [
        { row: 2, barcode: '8', name: 'فول', scale_item: 'نعم', ...base },
        { row: 3, barcode: '008', name: 'عدس', scale_item: 'نعم', ...base },
        { row: 4, barcode: '00001', name: 'أرز سايب', scale_item: '', ...base },
        { row: 5, barcode: '9', name: 'فاصوليا', scale_item: 'ربما', ...base }
      ],
      customers: [],
      suppliers: []
    },
    owner
  )
  const errors = ok(bad).errors
  const rows = errors.map((e) => e.row)
  assert.ok(rows.includes(3), JSON.stringify(errors))
  assert.ok(rows.includes(4), JSON.stringify(errors))
  assert.ok(rows.includes(5), JSON.stringify(errors))
  // A clean file: 9 is marked, 10 is not.
  const good = ok(
    await svc.call(
      'storeImport.apply',
      {
        products: [
          { row: 2, barcode: '9', name: 'فاصوليا', scale_item: 'نعم', ...base },
          { row: 3, barcode: '10', name: 'لوبيا', ...base }
        ],
        customers: [],
        suppliers: []
      },
      owner
    )
  )
  assert.deepEqual(good.errors, [])
  assert.deepEqual(
    await q(
      "SELECT barcode, scale_item, scale_key FROM products WHERE barcode IN ('9', '10') ORDER BY barcode"
    ),
    [
      { barcode: '10', scale_item: false, scale_key: null },
      { barcode: '9', scale_item: true, scale_key: '9' }
    ]
  )
  // The export writes it back.
  const exported = ok(await svc.call('storeExport.data', {}, owner))
  assert.equal(exported.products.find((p) => p.barcode === '9').scale_item, 'نعم')
  assert.equal(exported.products.find((p) => p.barcode === '10').scale_item, '')
})

test('a sale of a scanned scale item takes its weight off that product only', async (t) => {
  if (!requireDb(t)) return
  const shift = ok(await svc.call('shifts.open', { startingCash: 100 }, cashier))
  const before = await one(
    "SELECT barcode, stock_qty::float8 AS s FROM products WHERE barcode = '1'"
  )
  const others = await q(
    "SELECT barcode, stock_qty::float8 AS s FROM products WHERE barcode IN ('01', '001') ORDER BY barcode"
  )
  const scanned = ok(await resolve(label(1, 250)))
  const sale = ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: `scale-sale-${crypto.randomUUID()}`,
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: scanned.product.barcode, qty: scanned.qty }]
      },
      cashier
    )
  )
  assert.ok(sale.saleId || sale.id)
  assert.equal(
    (await one("SELECT stock_qty::float8 AS s FROM products WHERE barcode = '1'")).s,
    before.s - 0.25
  )
  assert.deepEqual(
    await q(
      "SELECT barcode, stock_qty::float8 AS s FROM products WHERE barcode IN ('01', '001') ORDER BY barcode"
    ),
    others
  )
  const line = await one(
    'SELECT product_barcode, quantity::float8 AS q, total_price::float8 AS t FROM sale_items ORDER BY id DESC LIMIT 1'
  )
  assert.deepEqual(line, { product_barcode: '1', q: 0.25, t: 100 })
})
