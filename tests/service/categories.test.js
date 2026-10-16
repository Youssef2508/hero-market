'use strict'
// Product categories and category browsing at the till (1.4.0, migration 0013).
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

let db, svc, admin, cashier, stock, shift
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const version = async () => ok(await svc.call('pos.catalogVersion', {}, cashier)).version
const browse = async (categoryId, extra = {}) =>
  ok(await svc.call('pos.categoryProducts', { categoryId, ...extra }, cashier))

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await createUser(svc, { username: 'stock', pin: '2468', roleKey: 'inventory' })
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, unit_kind) VALUES
     ('M1', 'لبن كامل', 20, 30, 40, 'علبة', 'count'),
     ('M2', 'زبادي', 5, 8, 100, 'كوب', 'count'),
     ('C1', 'جبنة رومي', 200, 280, 10, 'كجم', 'weight'),
     ('S1', 'شيبسي', 4, 5, 300, 'كيس', 'count'),
     ('N1', 'منظف', 30, 45, 12, 'زجاجة', 'count')`
  )
  admin = await login(svc, '8642')
  cashier = await login(svc, '5173')
  stock = await login(svc, '2468')
  shift = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier))
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('administrators create, rename, order and stop categories; names are unique', async (t) => {
  if (!requireDb(t)) return
  const dairy = ok(await svc.call('categories.save', { name: 'ألبان' }, admin))
  const snacks = ok(
    await svc.call('categories.save', { name: 'تسالي', description: 'شيبسي وحلويات' }, admin)
  )
  assert.equal(
    (await svc.call('categories.save', { name: ' أَلبان '.replace('َ', '') }, admin)).status,
    409
  )
  assert.equal(
    (await svc.call('categories.save', { name: 'الْبان' }, admin)).status,
    200,
    'a different name'
  )
  ok(
    await svc.call(
      'categories.save',
      { id: snacks.id, name: 'تسالي ومقرمشات', sortOrder: 0 },
      admin
    )
  )
  const list = ok(await svc.call('categories.list', {}, admin)).categories
  assert.equal(list[0].name, 'تسالي ومقرمشات', 'sorted by sort order')
  assert.ok(list.some((c) => c.id === dairy.id))
  const logs = await q(
    "SELECT count(*)::int AS n FROM system_logs WHERE action_type IN ('category_create','category_update')"
  )
  assert.ok(logs[0].n >= 4)
})

test('only users with categories.manage can change categories (direct calls included)', async (t) => {
  if (!requireDb(t)) return
  for (const [op, body] of [
    ['categories.save', { name: 'تصنيف الكاشير' }],
    ['categories.setActive', { id: 1, isActive: false }],
    ['categories.delete', { id: 1 }],
    ['categories.assign', { categoryId: 1, barcodes: ['M1'] }]
  ])
    assert.equal((await svc.call(op, body, cashier)).status, 403, op)
  // The inventory role manages categories by default.
  ok(await svc.call('categories.save', { name: 'منظفات' }, stock))
  // Everyone selling can browse.
  ok(await svc.call('pos.categories', {}, cashier))
  assert.equal((await svc.call('pos.categories', {})).status, 401)
})

test('assigning products: by product form and in bulk; uncategorised products stay sellable', async (t) => {
  if (!requireDb(t)) return
  const cats = Object.fromEntries(
    ok(await svc.call('categories.list', {}, admin)).categories.map((c) => [c.name, c.id])
  )
  ok(
    await svc.call(
      'categories.assign',
      { categoryId: cats['ألبان'], barcodes: ['M1', 'M2', 'C1'] },
      admin
    )
  )
  ok(
    await svc.call(
      'categories.assign',
      { categoryId: cats['تسالي ومقرمشات'], barcodes: ['S1'] },
      admin
    )
  )
  const p = (await q("SELECT * FROM products WHERE barcode = 'M1'"))[0]
  assert.equal(p.category, 'ألبان', 'the text column mirrors the name')
  // Through the product form.
  ok(
    await svc.call(
      'products.update',
      {
        barcode: 'N1',
        name: 'منظف',
        retail_price: 45,
        cost_price: 30,
        unit: 'زجاجة',
        category_id: cats['منظفات']
      },
      admin
    )
  )
  assert.equal(
    (await q("SELECT category FROM products WHERE barcode = 'N1'"))[0].category,
    'منظفات'
  )
  // An older form without category_id keeps the category.
  ok(
    await svc.call(
      'products.update',
      { barcode: 'N1', name: 'منظف أرضيات', retail_price: 45, cost_price: 30, unit: 'زجاجة' },
      admin
    )
  )
  assert.equal(
    (await q("SELECT category_id FROM products WHERE barcode = 'N1'"))[0].category_id,
    cats['منظفات']
  )
  // Unknown category or product: refused.
  assert.equal(
    (await svc.call('categories.assign', { categoryId: 99999, barcodes: ['M1'] }, admin)).status,
    400
  )
  assert.equal(
    (await svc.call('categories.assign', { categoryId: cats['ألبان'], barcodes: ['NOPE'] }, admin))
      .status,
    400
  )
  // Back to uncategorised: still found and sold.
  ok(await svc.call('categories.assign', { categoryId: null, barcodes: ['N1'] }, admin))
  const none = await browse(0)
  assert.deepEqual(
    none.products.map((x) => x.barcode),
    ['N1']
  )
  ok(await svc.call('categories.assign', { categoryId: cats['منظفات'], barcodes: ['N1'] }, admin))
})

test('browsing: active categories with counts; a stopped category hides its group but not its products', async (t) => {
  if (!requireDb(t)) return
  const res = ok(await svc.call('pos.categories', {}, cashier))
  const byName = Object.fromEntries(res.categories.map((c) => [c.name, c]))
  assert.equal(byName['ألبان'].products, 3)
  assert.equal(byName['الْبان'], undefined, 'empty categories are not shown at the till')
  const dairy = byName['ألبان']
  const page = await browse(dairy.id)
  assert.deepEqual(
    page.products.map((p) => p.name),
    ['جبنة رومي', 'زبادي', 'لبن كامل'],
    'alphabetical'
  )
  const cheese = page.products.find((p) => p.barcode === 'C1')
  assert.deepEqual([cheese.price, cheese.unitKind, cheese.unit], [280, 'weight', 'كجم'])
  // Stop the category: its group disappears; its products move to "بدون تصنيف" and stay sellable.
  ok(await svc.call('categories.setActive', { id: dairy.id, isActive: false }, admin))
  const after1 = ok(await svc.call('pos.categories', {}, cashier))
  assert.equal(
    after1.categories.find((c) => c.id === dairy.id),
    undefined
  )
  assert.ok((await browse(0)).products.some((p) => p.barcode === 'M1'))
  // Assigning to a stopped category is refused.
  assert.equal(
    (await svc.call('categories.assign', { categoryId: dairy.id, barcodes: ['S1'] }, admin)).status,
    400
  )
  ok(await svc.call('categories.setActive', { id: dairy.id, isActive: true }, admin))
})

test('a browsed product sells exactly like a scanned one: price, unit, automatic discounts', async (t) => {
  if (!requireDb(t)) return
  ok(
    await svc.call(
      'discounts.save',
      {
        scope: 'product',
        name: 'خصم اللبن',
        productBarcode: 'M1',
        valueType: 'percent',
        value: 10,
        isActive: true
      },
      admin
    )
  )
  const fromBrowse = (
    await browse((await q("SELECT category_id FROM products WHERE barcode = 'M1'"))[0].category_id)
  ).products.find((p) => p.barcode === 'M1')
  const resolved = ok(await svc.call('pos.resolve', { code: 'M1' }, cashier))
  assert.equal(fromBrowse.price, resolved.unit.price, 'same price as the scan')
  const preview = ok(await svc.call('pos.price', { items: [{ barcode: 'M1', qty: 2 }] }, cashier))
  assert.equal(preview.afterDiscount, 54)
  const sale = ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'M1', qty: 2, unitPrice: fromBrowse.price }],
        expectedTotal: 54
      },
      cashier
    )
  )
  assert.equal(sale.total, 54)
  // A price changed after the till cached the category: checkout refuses the old price.
  ok(
    await svc.call(
      'products.update',
      { barcode: 'M2', name: 'زبادي', retail_price: 9, cost_price: 5, unit: 'كوب' },
      admin
    )
  )
  const stale = await svc.call(
    'pos.checkout',
    {
      clientRef: crypto.randomUUID(),
      shiftId: shift.id,
      paymentType: 'نقدي',
      items: [{ barcode: 'M2', qty: 1, unitPrice: 8 }]
    },
    cashier
  )
  assert.equal(stale.status, 409)
})

test('a product stopped from sale disappears from search and browsing and is refused at checkout', async (t) => {
  if (!requireDb(t)) return
  ok(
    await svc.call(
      'products.update',
      {
        barcode: 'S1',
        name: 'شيبسي',
        retail_price: 5,
        cost_price: 4,
        unit: 'كيس',
        is_active: false
      },
      admin
    )
  )
  const search = ok(await svc.call('pos.searchProducts', { term: 'شيبسي' }, cashier))
  assert.equal(search.length, 0)
  const snacks = (await q("SELECT id FROM categories WHERE name = 'تسالي ومقرمشات'"))[0].id
  assert.equal((await browse(snacks)).products.length, 0)
  const scan = await svc.call('pos.resolve', { code: 'S1' }, cashier)
  assert.equal(scan.status, 409)
  assert.match(scan.body.error.message, /موقوف/)
  const sale = await svc.call(
    'pos.checkout',
    {
      clientRef: crypto.randomUUID(),
      shiftId: shift.id,
      paymentType: 'نقدي',
      items: [{ barcode: 'S1', qty: 1 }]
    },
    cashier
  )
  assert.equal(sale.status, 409)
  // Its history stays and it can be reactivated.
  ok(
    await svc.call(
      'products.update',
      {
        barcode: 'S1',
        name: 'شيبسي',
        retail_price: 5,
        cost_price: 4,
        unit: 'كيس',
        is_active: true
      },
      admin
    )
  )
  assert.equal(ok(await svc.call('pos.searchProducts', { term: 'شيبسي' }, cashier)).length, 1)
})

test('categories are deleted only when empty; products are never deleted with them', async (t) => {
  if (!requireDb(t)) return
  const dairy = (await q("SELECT id FROM categories WHERE name = 'ألبان'"))[0].id
  const r = await svc.call('categories.delete', { id: dairy }, admin)
  assert.equal(r.status, 409)
  assert.match(r.body.error.message, /3 صنف/)
  assert.equal(
    (await q('SELECT count(*)::int AS n FROM products WHERE category_id = $1', [dairy]))[0].n,
    3
  )
  const empty = (await q("SELECT id FROM categories WHERE name = 'الْبان'"))[0].id
  ok(await svc.call('categories.delete', { id: empty }, admin))
  // The database refuses deleting a used category even directly.
  await assert.rejects(q('DELETE FROM categories WHERE id = $1', [dairy]))
})

test('the catalogue version changes with names, prices, categories and status – not with sales', async (t) => {
  if (!requireDb(t)) return
  const v0 = await version()
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'M2', qty: 3 }]
      },
      cashier
    )
  )
  assert.equal(await version(), v0, 'a sale changes stock, not what the till browses')
  ok(
    await svc.call(
      'products.update',
      { barcode: 'M2', name: 'زبادي طبيعي', retail_price: 9, cost_price: 5, unit: 'كوب' },
      admin
    )
  )
  const v1 = await version()
  assert.ok(v1 > v0)
  ok(await svc.call('categories.save', { name: 'مجمدات' }, admin))
  assert.ok((await version()) > v1)
})

test('large categories: paged, ordered, fast (2,000 products in one category)', async (t) => {
  if (!requireDb(t)) return
  const big = ok(await svc.call('categories.save', { name: 'مخزن كبير' }, admin))
  const values = Array.from(
    { length: 2000 },
    (_, i) =>
      `('BIG${String(i).padStart(5, '0')}', 'صنف رقم ${String(i).padStart(5, '0')}', 1, 2, 0, 'قطعة', ${big.id})`
  ).join(',')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, category_id) VALUES ${values}`
  )
  const started = process.hrtime.bigint()
  const p1 = await browse(big.id)
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  assert.equal(p1.products.length, 200)
  assert.equal(p1.more, true)
  const p11 = await browse(big.id, { offset: 1800 })
  assert.equal(p11.products.length, 200)
  assert.equal(p11.more, false)
  assert.equal(p11.products.at(-1).barcode, 'BIG01999')
  t.diagnostic(`first page of a 2,000-product category in ${ms.toFixed(1)} ms`)
  assert.ok(ms < 500, `${ms} ms`)
})

test('migration 0013 turns the existing text categories into categories without inventing any', async (t) => {
  if (!requireDb(t)) return
  const fresh = await freshDatabase()
  const pool = createPool(fresh.url, { max: 2 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig13-'))
  try {
    for (const m of listMigrations().filter((x) => Number(x.version) < 13))
      fs.copyFileSync(
        path.join(__dirname, '../../src/server/db/migrations', `${m.name}.sql`),
        path.join(tmp, `${m.name}.sql`)
      )
    const quiet = { info() {} }
    await migrate(pool, { dir: tmp, logger: quiet })
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
      await c.query(`INSERT INTO products (barcode, name, retail_price, stock_qty, category) VALUES
        ('a', 'أ', 1, 5, 'بقوليات'), ('b', 'ب', 1, 0, ' بقوليات '), ('c', 'ج', 1, 0, 'مشروبات'), ('d', 'د', 1, 0, ''), ('e', 'هـ', 1, 0, NULL)`)
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    const beforeRows = (
      await pool.query(
        'SELECT barcode, name, retail_price::text, stock_qty::text FROM products ORDER BY barcode'
      )
    ).rows
    await migrate(pool, { logger: quiet })
    const afterRows = (
      await pool.query(
        'SELECT barcode, name, retail_price::text, stock_qty::text FROM products ORDER BY barcode'
      )
    ).rows
    assert.deepEqual(afterRows, beforeRows, 'products unchanged')
    const cats = (await pool.query('SELECT name FROM categories ORDER BY name')).rows.map(
      (r) => r.name
    )
    assert.deepEqual(cats, ['بقوليات', 'مشروبات'], 'only the existing classifications')
    const assigned = (
      await pool.query(
        'SELECT p.barcode, c.name FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.barcode'
      )
    ).rows.map((r) => [r.barcode, r.name])
    assert.deepEqual(assigned, [
      ['a', 'بقوليات'],
      ['b', 'بقوليات'],
      ['c', 'مشروبات'],
      ['d', null],
      ['e', null]
    ])
  } finally {
    await pool.end()
    await fresh.dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('the products screen: search by name or barcode and filter by category (regression)', async (t) => {
  if (!requireDb(t)) return
  const byName = ok(await svc.call('products.page', { search: 'لبن' }, admin))
  assert.deepEqual(
    byName.rows.map((r) => r.barcode),
    ['M1']
  )
  const byCode = ok(await svc.call('products.page', { search: 'C1' }, admin))
  assert.deepEqual(
    byCode.rows.map((r) => r.barcode),
    ['C1']
  )
  assert.equal(ok(await svc.call('products.page', { search: 'لا يوجد هذا' }, admin)).rows.length, 0)
  const dairy = (await q("SELECT id FROM categories WHERE name = 'ألبان'"))[0].id
  const inDairy = ok(await svc.call('products.page', { categoryId: dairy }, admin))
  assert.deepEqual(inDairy.rows.map((r) => r.barcode).sort(), ['C1', 'M1', 'M2'])
  assert.equal(inDairy.rows[0].category_name, 'ألبان')
  const both = ok(await svc.call('products.page', { categoryId: dairy, search: 'زبادي' }, admin))
  assert.deepEqual(
    both.rows.map((r) => r.barcode),
    ['M2']
  )
  const none = ok(await svc.call('products.page', { categoryId: 0 }, admin))
  assert.ok(none.rows.every((r) => r.category_id === null))
})

test('a new product saved without a category is automatically in "بدون تصنيف" at the till', async (t) => {
  if (!requireDb(t)) return
  const before = ok(await svc.call('pos.categories', {}, cashier)).uncategorised
  ok(
    await svc.call(
      'products.create',
      {
        barcode: 'NOCAT1',
        name: 'صنف جديد بلا تصنيف',
        retail_price: 12,
        cost_price: 8,
        unit: 'قطعة'
      },
      admin
    )
  )
  assert.equal(
    (await q("SELECT category_id FROM products WHERE barcode = 'NOCAT1'"))[0].category_id,
    null
  )
  assert.equal(ok(await svc.call('pos.categories', {}, cashier)).uncategorised, before + 1)
  const none = await browse(0)
  assert.ok(none.products.some((p) => p.barcode === 'NOCAT1' && p.price === 12))
  ok(await svc.call('pos.resolve', { code: 'NOCAT1' }, cashier))
  await q("DELETE FROM products WHERE barcode = 'NOCAT1'")
})
