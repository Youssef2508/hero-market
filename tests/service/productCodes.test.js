'use strict'
// Product codes are text, never numbers (D-110): 1, 01 and 001 are three products. Every way a
// product is found by its code – the till's field and its list, a click on a result, a scanner, a
// packaging barcode, product management, purchases and returns – gives the product of exactly that
// code. The only other spelling is the scanner's: a 12-digit UPC-A finds the 13-digit EAN-13 of the
// same article (a leading 0), and only when nothing is registered under the exact code.
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

const ok = (r, what = '') => {
  if (r.status !== 200) throw new Error(`${what} ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}

let db
let svc
let admin
let shift
let supplierId

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  // Inserted out of order, so the database's own row order would pick the wrong one.
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, reorder_limit, unit) VALUES
      ('001', 'صنف ثلاثة أصفار', 3, 30, 50, 0, 'قطعة'),
      ('01', 'صنف صفر واحد', 2, 20, 50, 0, 'قطعة'),
      ('1', 'صنف واحد', 1, 10, 50, 0, 'قطعة'),
      ('0012345678905', 'صنف EAN-13', 5, 50, 50, 0, 'قطعة'),
      ('765432109876', 'صنف UPC-A', 6, 60, 50, 0, 'قطعة'),
      ('0765432109876', 'صنف EAN بنفس الأرقام', 7, 70, 50, 0, 'قطعة'),
      ('BOX', 'صنف بعبوة', 4, 40, 240, 0, 'قطعة'),
      ('07', 'صنف صفر سبعة', 2, 20, 50, 0, 'قطعة'),
      ('123456789012', 'صنف UPC بلا مكافئ', 8, 80, 50, 0, 'قطعة'),
      ('XL', 'صنف بباركود إضافي', 9, 90, 50, 0, 'قطعة')`
  )
  admin = await login(svc, '8642')
  shift = ok(await svc.call('shifts.open', { startingCash: 0 }, admin))
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الأكواد' }, admin)).id
  // An extra barcode of XL that is exactly the 13-digit spelling of another product's 12-digit code:
  // typed exactly, it is XL's – the exact code wins over another product's other spelling.
  ok(
    await svc.call(
      'productUnits.save',
      { barcode: 'XL', baseBarcodes: ['0123456789012'], units: [] },
      admin
    )
  )
  // A packaging barcode that is spelled like a short code: still its own barcode.
  ok(
    await svc.call(
      'productUnits.save',
      {
        barcode: 'BOX',
        baseBarcodes: [],
        units: [{ name: 'كرتونة', factor: 24, retail_price: 900, barcodes: ['0001'] }]
      },
      admin
    )
  )
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

const resolve = async (code) => ok(await svc.call('pos.resolve', { code }, admin), code)

test('the till resolves exactly the typed or scanned code: 1, 01 and 001 are three products', async (t) => {
  if (!requireDb(t)) return
  for (const code of ['1', '01', '001']) {
    const r = await resolve(code)
    assert.equal(r.product.barcode, code, `typed ${code}`)
    assert.equal(r.unit.id, null)
  }
  // With spaces around it, as a hand-typed code may have.
  assert.equal((await resolve(' 01 ')).product.barcode, '01')
  // A code that exists only with other zeros is not found: never a "numerically equal" product.
  assert.equal(ok(await svc.call('pos.resolve', { code: '0000001' }, admin)), null)
  assert.equal(ok(await svc.call('pos.resolve', { code: '00001' }, admin)), null)
})

test('a packaging barcode is its own code: 0001 is the carton, not product 1, 01 or 001', async (t) => {
  if (!requireDb(t)) return
  const r = await resolve('0001')
  assert.equal(r.product.barcode, 'BOX')
  assert.equal(r.unit.name, 'كرتونة')
  assert.equal(r.unit.factor, 24)
})

test('the scanner’s spelling: a UPC-A finds its EAN-13 only when nothing has the exact code', async (t) => {
  if (!requireDb(t)) return
  // 012345678905 is registered only as the EAN-13 0012345678905.
  assert.equal((await resolve('012345678905')).product.barcode, '0012345678905')
  // Both spellings registered as two products: each finds itself.
  assert.equal((await resolve('765432109876')).product.barcode, '765432109876')
  assert.equal((await resolve('0765432109876')).product.barcode, '0765432109876')
  // Short codes never get a zero added or taken away: 7 is not 07.
  assert.equal(ok(await svc.call('pos.resolve', { code: '0BOX' }, admin)), null)
  assert.equal(ok(await svc.call('pos.resolve', { code: '7' }, admin)), null)
  assert.equal((await resolve('07')).product.barcode, '07')
  // The exact code (an extra barcode of XL) wins over the other spelling of another product.
  assert.equal((await resolve('0123456789012')).product.barcode, 'XL')
  assert.equal((await resolve('123456789012')).product.barcode, '123456789012')
})

test('the till’s list puts the exact code first, and the chosen result is the product added', async (t) => {
  if (!requireDb(t)) return
  for (const code of ['1', '01', '001']) {
    const list = ok(await svc.call('pos.searchProducts', { term: code }, admin))
    assert.equal(list[0].barcode, code, `list for ${code}`)
    // A click on (or Enter with) the highlighted result resolves that row's own code.
    for (const row of list.filter((r) => ['1', '01', '001'].includes(r.barcode)))
      assert.equal((await resolve(row.barcode)).product.barcode, row.barcode)
  }
})

test('a sale of the chosen code sells that product and its stock only', async (t) => {
  if (!requireDb(t)) return
  const stock = async () =>
    Object.fromEntries(
      (
        await svc.pool.query(
          "SELECT barcode, stock_qty::float8 AS s FROM products WHERE barcode IN ('1', '01', '001')"
        )
      ).rows.map((r) => [r.barcode, r.s])
    )
  const before = await stock()
  const r = await resolve('01')
  const sale = ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: 'codes-sale-0001',
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: r.product.barcode, qty: 2 }]
      },
      admin
    )
  )
  const after = await stock()
  assert.deepEqual(after, { ...before, '01': before['01'] - 2 })
  const lines = (
    await svc.pool.query('SELECT product_barcode FROM sale_items WHERE sale_id = $1', [sale.saleId])
  ).rows
  assert.deepEqual(lines, [{ product_barcode: '01' }])
})

test('product management and the purchase picker list the exact code first; lookups are exact', async (t) => {
  if (!requireDb(t)) return
  for (const code of ['1', '01', '001']) {
    const page = ok(await svc.call('products.page', { search: code, page: 1 }, admin))
    assert.equal(page.rows[0].barcode, code, `products.page for ${code}`)
    // The sort the user chose still applies after the exact code.
    const desc = ok(
      await svc.call(
        'products.page',
        { search: code, page: 1, sortField: 'name', sortAsc: false },
        admin
      )
    )
    assert.equal(desc.rows[0].barcode, code)
    assert.equal(Number(desc.total), Number(page.total))
    assert.equal(ok(await svc.call('products.get', { barcode: code }, admin)).barcode, code)
  }
  // With a category filter as well (its own parameter after the search).
  const none = ok(await svc.call('products.page', { search: '01', categoryId: 0, page: 1 }, admin))
  assert.equal(none.rows[0].barcode, '01')
})

test('a purchase of 001 receives 001 only, and its return takes from 001 only', async (t) => {
  if (!requireDb(t)) return
  const before = (
    await svc.pool.query(
      "SELECT barcode, stock_qty::float8 AS s FROM products WHERE barcode IN ('1', '01', '001') ORDER BY barcode"
    )
  ).rows
  const p = ok(
    await svc.call(
      'suppliers.addPurchase',
      {
        supplierId,
        invoice_ref: 'CODES-1',
        total_amount: 30,
        paid_amount: 0,
        payment_type: 'آجل',
        clientRef: 'codes-purchase-0001',
        items: [{ barcode: '001', qty: 10, unitCost: 3 }]
      },
      admin
    )
  )
  const detail = ok(await svc.call('suppliers.purchaseDetail', { purchaseId: p.purchaseId }, admin))
  assert.deepEqual(
    detail.items.map((i) => i.barcode),
    ['001']
  )
  ok(
    await svc.call(
      'suppliers.returnPurchase',
      {
        purchaseId: p.purchaseId,
        items: [{ purchaseItemId: detail.items[0].id, qty: 4 }],
        clientRef: 'codes-return-0001'
      },
      admin
    )
  )
  const after = (
    await svc.pool.query(
      "SELECT barcode, stock_qty::float8 AS s FROM products WHERE barcode IN ('1', '01', '001') ORDER BY barcode"
    )
  ).rows
  const was = Object.fromEntries(before.map((r) => [r.barcode, r.s]))
  assert.deepEqual(Object.fromEntries(after.map((r) => [r.barcode, r.s])), {
    ...was,
    '001': was['001'] + 6
  })
})

test('the codes keep their zeros in the data export, and are stored as text', async (t) => {
  if (!requireDb(t)) return
  const type = (
    await svc.pool.query(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'barcode'"
    )
  ).rows[0].data_type
  assert.equal(type, 'text')
  const exp = ok(await svc.call('storeExport.data', {}, admin))
  const codes = JSON.stringify(exp)
  for (const code of ['"1"', '"01"', '"001"'])
    assert.ok(codes.includes(code), `export holds ${code}`)
})
