'use strict'
// Store data import (1.4.0): every row is checked first and nothing is written on any error;
// then products (with opening stock movements and categories), customers and suppliers (with
// opening balances) are written in one transaction. Existing records are never changed.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

let db, svc, owner, cashier
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const counts = async () =>
  one(
    `SELECT (SELECT count(*) FROM products)::int AS products, (SELECT count(*) FROM clients)::int AS clients,
            (SELECT count(*) FROM suppliers)::int AS suppliers, (SELECT count(*) FROM categories)::int AS categories,
            (SELECT count(*) FROM stock_movements)::int AS movements`
  )

const FILE = {
  products: [
    {
      row: 2,
      barcode: '6221234567890',
      name: 'زبادي',
      retail_price: 7.5,
      cost_price: 6,
      stock_qty: 48,
      unit: 'علبة',
      category: 'ألبان',
      reorder_limit: 10
    },
    {
      row: 3,
      barcode: '',
      name: 'جبنة رومي',
      retail_price: 240,
      cost_price: 200,
      stock_qty: 12.5,
      unit: 'كيلو',
      category: 'البان'
    },
    {
      row: 4,
      barcode: '0012345',
      name: 'زيت',
      retail_price: 90,
      stock_qty: 3.25,
      unit: 'لتر',
      unit_kind: 'بالحجم',
      category: 'زيوت'
    },
    { row: 5, barcode: '', name: 'قماش', retail_price: 40, stock_qty: 10.5, unit_kind: 'بالمتر' },
    { row: 6, barcode: 'SUGAR1', name: 'سكر', retail_price: 30, category: 'منظفات' }
  ],
  customers: [
    { row: 2, name: 'محمد أحمد', phone: '01001234567', address: 'شارع النصر 12', balance: 350 },
    { row: 3, name: 'منى', phone: '0100 765 4321', phone2: '01111111111', balance: -20 },
    { row: 4, name: 'بدون هاتف', balance: 0 }
  ],
  suppliers: [
    { row: 2, name: 'شركة الألبان', phone: '0223456789', contact_person: 'أ. سامي', balance: 1200 }
  ]
}

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  // An existing category ("ألبان", written "البان" in the file) and an owner-added kind.
  ok(await svc.call('categories.save', { name: 'ألبان' }, owner))
  ok(await svc.call('measureKinds.save', { name: 'بالمتر', unit: 'متر', decimals: 2 }, owner))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('only someone who manages products, customers and suppliers may import', async (t) => {
  if (!requireDb(t)) return
  const r = await svc.call('storeImport.apply', { ...FILE, dryRun: true }, cashier)
  assert.equal(r.status, 403)
})

test('any error: everything is reported with its row, and nothing is written', async (t) => {
  if (!requireDb(t)) return
  const before = await counts()
  const bad = {
    products: [
      ...FILE.products,
      { row: 7, barcode: '6221234567890', name: 'مكرر', retail_price: 1 },
      { row: 8, name: 'بدون سعر' },
      { row: 9, name: 'كسر', retail_price: 5, stock_qty: 2.5, unit: 'قطعة' },
      { row: 10, name: 'طريقة غريبة', retail_price: 5, unit_kind: 'بالقيراط' },
      { row: 11, name: 'تكلفة سالبة', retail_price: 5, cost_price: -1 }
    ],
    customers: [
      ...FILE.customers,
      { row: 5, name: 'نفس الهاتف', phone: '01001234567' },
      { row: 6, name: 'هاتف خطأ', phone: '123' }
    ],
    suppliers: [{ row: 3, name: '' }]
  }
  const r = ok(await svc.call('storeImport.apply', bad, owner))
  assert.equal(r.ok, false)
  assert.equal(r.written, false)
  const at = (sheet, row) =>
    r.errors
      .filter((e) => e.sheet === sheet && e.row === row)
      .map((e) => e.message)
      .join(' | ')
  assert.match(at('الأصناف', 7), /مكرر في الملف \(الصف 2\)/)
  assert.match(at('الأصناف', 8), /سعر البيع مطلوب/)
  assert.match(at('الأصناف', 9), /عدداً صحيحاً/)
  assert.match(at('الأصناف', 10), /غير معروفة/)
  assert.match(at('الأصناف', 11), /لا يكون بالسالب/)
  assert.match(at('العملاء', 5), /مكرر في الملف \(الصف 2\)/)
  assert.ok(at('العملاء', 6))
  assert.match(at('الموردون', 3), /مطلوب/)
  assert.deepEqual(await counts(), before)
})

test('a check (dryRun) of a clean file writes nothing and gives the summary', async (t) => {
  if (!requireDb(t)) return
  const before = await counts()
  const r = ok(await svc.call('storeImport.apply', { ...FILE, dryRun: true }, owner))
  assert.equal(r.ok, true)
  assert.equal(r.written, false)
  assert.deepEqual(
    [
      r.summary.products,
      r.summary.withoutBarcode,
      r.summary.customers,
      r.summary.customerDebt,
      r.summary.suppliers,
      r.summary.supplierDebt
    ],
    [5, 2, 3, 330, 1, 1200]
  )
  assert.deepEqual(await counts(), before)
})

test('import: products, stock movements, categories, customers and suppliers with balances', async (t) => {
  if (!requireDb(t)) return
  const r = ok(await svc.call('storeImport.apply', FILE, owner))
  assert.equal(r.written, true)

  const p = Object.fromEntries(
    (
      await q(
        'SELECT name, barcode, unit_kind, stock_qty, cost_price, retail_price, category FROM products'
      )
    ).map((x) => [x.name, x])
  )
  assert.equal(p['زبادي'].barcode, '6221234567890')
  assert.equal(p['زيت'].barcode, '0012345') // leading zeros kept
  assert.match(p['جبنة رومي'].barcode, /^HM\d{6}$/)
  assert.match(p['قماش'].barcode, /^HM\d{6}$/)
  assert.notEqual(p['جبنة رومي'].barcode, p['قماش'].barcode)
  assert.deepEqual(
    ['زبادي', 'جبنة رومي', 'زيت', 'قماش', 'سكر'].map((n) => [
      p[n].unit_kind,
      Number(p[n].stock_qty)
    ]),
    [
      ['count', 48],
      ['weight', 12.5], // from the unit "كيلو"
      ['volume', 3.25],
      [(await one("SELECT key FROM measure_kinds WHERE name = 'بالمتر'")).key, 10.5],
      ['count', 0]
    ]
  )
  // Stock comes from opening movements, so stock equals its movements.
  const mv = await q(
    "SELECT product_barcode, qty FROM stock_movements WHERE kind = 'opening' AND ref_type = 'import'"
  )
  assert.equal(mv.length, 4)
  // "البان" and "ألبان" are the same category (alef forms match): only زيوت and منظفات are new.
  const cats = (await q('SELECT name FROM categories ORDER BY id')).map((c) => c.name)
  assert.deepEqual(cats, ['ألبان', 'زيوت', 'منظفات'])
  assert.equal(p['جبنة رومي'].category, 'ألبان')

  const c = Object.fromEntries((await q('SELECT * FROM clients')).map((x) => [x.name, x]))
  assert.equal(Number(c['محمد أحمد'].debt_balance), 350)
  assert.equal(c['محمد أحمد'].address, 'شارع النصر 12')
  assert.equal(c['منى'].phone, '01007654321')
  assert.equal(c['منى'].phone2, '01111111111')
  assert.equal(Number(c['منى'].debt_balance), -20)
  assert.equal(c['بدون هاتف'].phone, null)
  const addr = await q(
    'SELECT label, address, is_default FROM client_addresses WHERE client_id = $1',
    [c['محمد أحمد'].id]
  )
  assert.deepEqual(addr, [{ label: 'other', address: 'شارع النصر 12', is_default: true }])
  const cl = await q(
    "SELECT client_id, amount FROM client_ledger WHERE type = 'opening' ORDER BY client_id"
  )
  assert.equal(cl.length, 2)

  const s = await one('SELECT * FROM suppliers')
  assert.equal(Number(s.debt_balance), 1200)
  assert.equal(s.contact_person, 'أ. سامي')
  assert.equal((await q("SELECT 1 FROM supplier_ledger WHERE type = 'opening'")).length, 1)
  assert.equal((await q("SELECT 1 FROM system_logs WHERE action_type = 'store_import'")).length, 1)

  // The imported products sell normally.
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier))
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: '6221234567890', qty: 2 }]
      },
      cashier
    )
  )
  assert.equal(
    Number((await one("SELECT stock_qty FROM products WHERE barcode = '6221234567890'")).stock_qty),
    46
  )
})

test('importing the same file again changes nothing: existing barcodes and phones are reported', async (t) => {
  if (!requireDb(t)) return
  const before = await counts()
  const r = ok(await svc.call('storeImport.apply', FILE, owner))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /مسجل بالفعل في البرنامج/.test(e.message)))
  assert.ok(r.errors.some((e) => /مسجل لعميل آخر/.test(e.message)))
  assert.deepEqual(await counts(), before)
})
