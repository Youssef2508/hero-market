'use strict'
// DATA-01 export and ROLE-01 permissions (owner, 2026-10-22, D-067). The export is written as a
// real .xlsx with the template's own sheets and headers, read back with the import reader and
// imported into a disposable empty database: products (with stock, cost and their package),
// customers and suppliers (with balances) come back the same. Export and import are separate
// permissions that an administrator grants to any role; nobody else holds them by default.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { pathToFileURL } = require('url')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

let source, svc, owner, cashier, manager
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const lib = () =>
  import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'shared', 'storeImport.mjs')).href)

const FILE = {
  products: [
    {
      row: 2,
      barcode: '0012345',
      name: 'هوهوز',
      retail_price: 10,
      cost_price: 8,
      wholesale_price: 9,
      stock_qty: 95,
      unit: 'قطعة',
      category: 'حلويات',
      reorder_limit: 20,
      pack_name: 'علبة',
      pack_factor: 10,
      pack_barcode: '0099887',
      pack_price: 90,
      pack_cost: 80
    },
    {
      row: 3,
      barcode: '6221000000017',
      name: 'جبنة رومي',
      retail_price: 240,
      cost_price: 200,
      stock_qty: 12.5,
      unit: 'كيلو',
      category: 'ألبان'
    },
    { row: 4, barcode: 'OIL-1', name: 'زيت', retail_price: 90, stock_qty: 3.25, unit: 'لتر' }
  ],
  customers: [
    { row: 2, name: 'محمد أحمد', phone: '01001234567', address: 'شارع النصر 12', balance: 350 },
    { row: 3, name: 'سعاد', phone: '01112223334', phone2: '0223456789', balance: -20 }
  ],
  suppliers: [
    {
      row: 2,
      name: 'شركة الألبان',
      phone: '0223456789',
      address: 'المنطقة الصناعية',
      contact_person: 'أ. سامي',
      balance: 1200
    }
  ]
}

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  source = await freshDatabase()
  svc = await startService(source.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await createUser(svc, { username: 'manager', pin: '5174', roleKey: 'manager' })
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  manager = await login(svc, '5174')
  ok(await svc.call('storeImport.apply', FILE, owner))
})

after(async () => {
  if (svc) await svc.close()
  if (source) await source.dispose()
})

/** Export → real .xlsx → read back with the import reader (as the screen does). */
async function exportFile(token) {
  const { exportSheets, readWorkbook } = await lib()
  const { default: writeExcelFile } = await import('write-excel-file/node')
  const { default: readExcelFile } = await import('read-excel-file/node')
  const data = ok(await svc.call('storeExport.data', {}, token))
  const buffer = await writeExcelFile(exportSheets(data)).toBuffer()
  return { data, read: readWorkbook(await readExcelFile(buffer)) }
}

const snapshot = async (pool) => ({
  products: (
    await pool.query(
      `SELECT p.barcode, p.name, p.retail_price::float8 r, p.cost_price::float8 c, p.wholesale_price::float8 w,
              p.stock_qty::float8 s, p.unit, p.unit_kind, p.category, p.reorder_limit::float8 rl,
              u.name pn, u.factor::float8 pf, u.retail_price::float8 pr, u.purchase_cost::float8 pc,
              (SELECT barcode FROM product_barcodes b WHERE b.unit_id = u.id) pb
         FROM products p LEFT JOIN product_units u ON u.product_barcode = p.barcode AND u.is_active
        ORDER BY p.barcode, u.factor DESC`
    )
  ).rows,
  customers: (
    await pool.query(
      'SELECT name, phone, phone2, address, debt_balance::float8 b FROM clients ORDER BY name'
    )
  ).rows,
  suppliers: (
    await pool.query(
      'SELECT name, phone, address, contact_person, debt_balance::float8 b FROM suppliers ORDER BY name'
    )
  ).rows
})

test('the export is the template: same sheets, headers and version, and it reads back clean', async (t) => {
  if (!requireDb(t)) return
  const { SHEETS, TEMPLATE_VERSION } = await lib()
  const { data, read } = await exportFile(owner)
  assert.deepEqual(read.errors, [])
  assert.equal(read.version, TEMPLATE_VERSION)
  assert.deepEqual(
    read.found,
    Object.values(SHEETS).map((s) => s.name)
  )
  assert.deepEqual(
    [read.products.length, read.customers.length, read.suppliers.length],
    [data.products.length, data.customers.length, data.suppliers.length]
  )
  // Leading zeros and long codes survive as text.
  assert.ok(read.products.some((p) => p.barcode === '0012345' && p.pack_barcode === '0099887'))
  // Nothing secret travels: no password, PIN, session or setting fields anywhere in the file.
  const text = JSON.stringify(data)
  for (const word of ['password', 'pin_', 'scrypt', 'session', 'token', 'secret'])
    assert.ok(!text.includes(word), word)
})

test('exported then imported into an empty store: products, packages, customers and suppliers match', async (t) => {
  if (!requireDb(t)) return
  // Make the source differ from the original file: a purchase moves stock and cost.
  const supplierId = (await svc.pool.query('SELECT id FROM suppliers LIMIT 1')).rows[0].id
  ok(
    await svc.call(
      'suppliers.addPurchase',
      {
        supplierId,
        total_amount: 1000,
        paid_amount: 0,
        payment_type: 'آجل',
        items: [{ barcode: '0012345', qty: 100, unitCost: 10 }]
      },
      owner
    )
  )
  const { read } = await exportFile(owner)
  const target = await freshDatabase()
  const other = await startService(target.url)
  try {
    await createUser(other, { username: 'owner2', pin: '9753', roleKey: 'super_admin' })
    const token = await login(other, '9753')
    const r = ok(
      await other.call(
        'storeImport.apply',
        { products: read.products, customers: read.customers, suppliers: read.suppliers },
        token
      )
    )
    assert.equal(r.written, true)
    const a = await snapshot(svc.pool)
    const b = await snapshot(other.pool)
    assert.deepEqual(b.products, a.products)
    assert.deepEqual(b.customers, a.customers)
    assert.deepEqual(b.suppliers, a.suppliers)
    // Stock arrives as one opening movement each, so the ledger is exact in the new store.
    const drift = await other.pool.query(
      `SELECT p.barcode FROM products p LEFT JOIN (SELECT product_barcode, SUM(qty) s FROM stock_movements GROUP BY 1) m
         ON m.product_barcode = p.barcode WHERE COALESCE(p.stock_qty, 0) <> COALESCE(m.s, 0)`
    )
    assert.equal(drift.rowCount, 0)
  } finally {
    await other.close()
    await target.dispose()
  }
})

test('what the export leaves out is counted and said, never silently dropped', async (t) => {
  if (!requireDb(t)) return
  const box = ok(await svc.call('productUnits.get', { barcode: '0012345' }, owner)).units[0]
  ok(
    await svc.call(
      'productUnits.save',
      {
        barcode: '0012345',
        units: [
          {
            id: box.id,
            name: 'علبة',
            factor: 10,
            retail_price: 90,
            purchase_cost: 80,
            barcodes: ['0099887']
          },
          { name: 'كرتونة', factor: 60, retail_price: 520 }
        ]
      },
      owner
    )
  )
  const { data, read } = await exportFile(owner)
  assert.equal(data.left.products_with_more_packages, 1)
  // The largest package is the one exported.
  assert.equal(read.products.find((p) => p.barcode === '0012345').pack_name, 'كرتونة')
})

test('package columns are checked like the units window; nothing is written on any error', async (t) => {
  if (!requireDb(t)) return
  const before = (await svc.pool.query('SELECT COUNT(*)::int n FROM products')).rows[0].n
  const row = (extra) => ({
    row: 2,
    barcode: 'NEW-1',
    name: 'جديد',
    retail_price: 5,
    unit: 'قطعة',
    ...extra
  })
  const check = async (extra, pattern) => {
    const r = ok(await svc.call('storeImport.apply', { products: [row(extra)] }, owner))
    assert.equal(r.ok, false)
    assert.match(r.errors.map((e) => e.message).join(' | '), pattern)
  }
  await check({ pack_name: 'علبة', pack_factor: 2.5, pack_price: 12 }, /عدداً صحيحاً/)
  await check({ pack_factor: 10, pack_price: 45 }, /اسم العبوة/)
  await check(
    { pack_name: 'علبة', pack_factor: 10, pack_price: 45, pack_barcode: 'NEW-1' },
    /نفس باركود الصنف/
  )
  await check(
    { pack_name: 'علبة', pack_factor: 10, pack_price: 45, pack_barcode: '0099887' },
    /مسجل بالفعل/
  )
  await check({ pack_name: 'قطعة', pack_factor: 10, pack_price: 45 }, /نفس وحدة الصنف/)
  assert.equal((await svc.pool.query('SELECT COUNT(*)::int n FROM products')).rows[0].n, before)
  // A package without a selling price is automatic (D-096): the unit's price × the count.
  const auto = ok(
    await svc.call(
      'storeImport.apply',
      {
        products: [
          row({ barcode: 'AUTO-1', pack_name: 'علبة', pack_factor: 10, pack_barcode: 'AUTO-BOX' })
        ]
      },
      owner
    )
  )
  assert.ok(auto.written, JSON.stringify(auto))
  const u = (
    await svc.pool.query(
      "SELECT retail_price, retail_auto FROM product_units WHERE product_barcode = 'AUTO-1'"
    )
  ).rows[0]
  assert.deepEqual([u.retail_price, u.retail_auto], [null, true])
  assert.equal(ok(await svc.call('pos.resolve', { code: 'AUTO-BOX' }, owner)).unit.price, 50)
})

test('a file of a newer template version is refused; an old file without a version still reads', async () => {
  const { readWorkbook, TEMPLATE_VERSION } = await lib()
  const sheet = [
    ['الباركود', 'اسم الصنف', 'سعر البيع'],
    ['1', 'أ', '5']
  ]
  const newer = readWorkbook([
    { sheet: 'تعليمات', data: [['إصدار القالب', TEMPLATE_VERSION + 1]] },
    { sheet: 'الأصناف', data: sheet }
  ])
  assert.equal(newer.products.length, 0)
  assert.match(newer.errors[0].message, /إصدار أحدث/)
  const old = readWorkbook([{ sheet: 'الأصناف', data: sheet }])
  assert.deepEqual([old.version, old.errors.length, old.products.length], [1, 0, 1])
})

test('export and import are separate permissions an administrator grants to any role', async (t) => {
  if (!requireDb(t)) return
  // Not held by default by cashiers or supervisors.
  for (const token of [cashier, manager]) {
    assert.equal((await svc.call('storeExport.data', {}, token)).status, 403)
    assert.equal(
      (await svc.call('storeImport.apply', { products: [], dryRun: true }, token)).status,
      403
    )
  }
  // The owner makes a role with export only and gives it to a user.
  const roleId = ok(
    await svc.call(
      'roles.create',
      { name: 'تصدير فقط', description: '', permissions: ['data.export'] },
      owner
    )
  ).id
  await createUser(svc, { username: 'exporter', pin: '2468', roleKey: 'cashier' })
  await svc.pool.query("UPDATE users SET role_id = $1 WHERE username = 'exporter'", [roleId])
  const exporter = await login(svc, '2468')
  ok(await svc.call('storeExport.data', {}, exporter))
  assert.equal(
    (await svc.call('storeImport.apply', { products: FILE.products, dryRun: true }, exporter))
      .status,
    403,
    'export does not imply import'
  )
  // Each export is in the activity log, with counts only.
  const log = (
    await svc.pool.query(
      "SELECT description FROM system_logs WHERE action_type = 'data_export' ORDER BY id DESC LIMIT 1"
    )
  ).rows[0]
  assert.match(log.description, /تصدير البيانات/)
})
