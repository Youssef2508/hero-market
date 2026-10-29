'use strict'
// The till's live list (owner, 1.5.2, D-092): it answers from the first character and narrows with
// every character, by name, main barcode and extra or packaging barcode; Arabic-Indic digits are
// digits; the exact code and what starts with the text come first; stopped products never show.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts
} = require('./helpers')

let db, svc, cashier
const search = async (term) => {
  const r = await svc.call('pos.searchProducts', { term }, cashier)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body.map((p) => p.barcode)
}

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, retail_price, stock_qty, unit, is_active) VALUES
     ('6221001', 'جبنة رومي', 240, 5, 'كيلو', true),
     ('6221002', 'جبنة بيضاء', 90, 5, 'كيلو', true),
     ('6222003', 'جبن شيدر', 300, 5, 'كيلو', true),
     ('5001', 'عصير جوافة', 10, 5, 'قطعة', true),
     ('7001', 'جبنة قديمة', 50, 0, 'كيلو', false)`
  )
  await svc.pool.query(
    "INSERT INTO product_barcodes (barcode, product_barcode) VALUES ('9990001', '5001')"
  )
  cashier = await login(svc, '5173')
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a name: from the first character, narrower with each one', async (t) => {
  if (!requireDb(t)) return
  const one = await search('ج')
  assert.ok(one.length >= 4, JSON.stringify(one))
  assert.deepEqual((await search('جبن')).sort(), ['6221001', '6221002', '6222003'])
  assert.deepEqual((await search('جبنة')).sort(), ['6221001', '6221002'])
  assert.deepEqual(await search('جبنة ر'), ['6221001'])
  assert.deepEqual(await search('جبنة رز'), [])
  assert.ok(!(await search('جبنة')).includes('7001'), 'a stopped product never shows')
})

test('a barcode: digit by digit, extra barcodes too, exact code first; Arabic digits', async (t) => {
  if (!requireDb(t)) return
  assert.deepEqual((await search('6')).slice(0, 3).sort(), ['6221001', '6221002', '6222003'])
  assert.deepEqual((await search('622')).sort(), ['6221001', '6221002', '6222003'])
  assert.deepEqual((await search('6221')).sort(), ['6221001', '6221002'])
  assert.deepEqual(await search('6221002'), ['6221002'])
  assert.deepEqual(await search('٦٢٢١٠٠٢'), ['6221002'], 'Arabic-Indic digits')
  assert.deepEqual(await search('99900'), ['5001'], 'an extra barcode finds its product')
  // "1" is inside every code: the code that starts with it… none here; "5" starts 5001 first.
  assert.equal((await search('5'))[0], '5001')
  assert.deepEqual(await search('   '), [])
})
