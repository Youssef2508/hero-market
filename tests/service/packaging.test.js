'use strict'
// Packages and loose units of one product (owner, 2026-10-21, Parts 9–10, D-065), with the owner's
// HoHos example: a box of 10 cakes. One stock in cakes; boxes are bought, sold and shown from it.
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

let db, svc, owner, cashier, shift, supplierId, boxId
const ref = () => crypto.randomUUID()
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const stock = async (b = 'HOHO') =>
  Number((await one('SELECT stock_qty FROM products WHERE barcode = $1', [b])).stock_qty)
const cost = async () =>
  Number((await one("SELECT cost_price FROM products WHERE barcode = 'HOHO'")).cost_price)
const sell = (items) =>
  svc.call(
    'pos.checkout',
    { clientRef: ref(), shiftId: shift.id, paymentType: 'نقدي', items },
    cashier
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
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES
     ('HOHO', 'هوهوز', 8, 10, 9, 0, 'قطعة'), ('PLAIN', 'صنف بلا عبوات', 3, 5, 4, 20, 'قطعة')`
  )
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الهوهوز' }, owner)).id
  shift = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a product without packages works as before', async (t) => {
  if (!requireDb(t)) return
  ok(await sell([{ barcode: 'PLAIN', qty: 3 }]))
  assert.equal(await stock('PLAIN'), 17)
  const r = ok(await svc.call('pos.resolve', { code: 'PLAIN' }, cashier))
  assert.deepEqual([r.unit.id, r.unit.factor, r.unit.price], [null, 1, 5])
})

test('the owner configures the box: own barcode, own selling and purchase price; invalid ones refused', async (t) => {
  if (!requireDb(t)) return
  const save = (units) => svc.call('productUnits.save', { barcode: 'HOHO', units }, owner)
  assert.equal((await save([{ name: 'علبة الهوهوز', factor: 0, retail_price: 90 }])).status, 400)
  assert.equal((await save([{ name: 'علبة الهوهوز', factor: 2.5, retail_price: 90 }])).status, 400)
  assert.equal(
    (await save([{ name: 'علبة الهوهوز', factor: 10 }])).status,
    400,
    'its price is required'
  )
  assert.equal(
    (await save([{ name: 'علبة الهوهوز', factor: 10, retail_price: 90, barcodes: ['PLAIN'] }]))
      .status,
    409,
    'a barcode of another product'
  )
  ok(
    await save([
      {
        name: 'علبة الهوهوز',
        factor: 10,
        retail_price: 90,
        purchase_cost: 80,
        barcodes: ['HOHO-BOX']
      }
    ])
  )
  const u = ok(await svc.call('productUnits.get', { barcode: 'HOHO' }, owner)).units[0]
  boxId = u.id
  assert.deepEqual(
    [u.name, Number(u.factor), Number(u.retail_price), Number(u.purchase_cost)],
    ['علبة الهوهوز', 10, 90, 80]
  )
  // The barcode decides the selling unit and its price.
  const loose = ok(await svc.call('pos.resolve', { code: 'HOHO' }, cashier))
  assert.deepEqual([loose.unit.factor, loose.unit.price], [1, 10])
  const box = ok(await svc.call('pos.resolve', { code: 'HOHO-BOX' }, cashier))
  assert.deepEqual([box.unit.name, box.unit.factor, box.unit.price], ['علبة الهوهوز', 10, 90])
})

test('10 boxes bought at 80 add 100 cakes once, at a cost of 8 per cake; the payable once', async (t) => {
  if (!requireDb(t)) return
  ok(
    await svc.call(
      'suppliers.addPurchase',
      {
        supplierId,
        total_amount: 800,
        paid_amount: 0,
        payment_type: 'آجل',
        items: [{ barcode: 'HOHO', unitId: boxId, qty: 10, unitCost: 80 }]
      },
      owner
    )
  )
  assert.equal(await stock(), 100)
  assert.equal(await cost(), 8)
  const line = await one(
    'SELECT qty::float8 q, unit_cost::float8 c, unit_name, unit_factor::float8 f FROM supplier_purchase_items'
  )
  assert.deepEqual([line.q, line.c, line.unit_name, line.f], [10, 80, 'علبة الهوهوز', 10])
  assert.equal(
    Number(
      (await one('SELECT debt_balance FROM suppliers WHERE id = $1', [supplierId])).debt_balance
    ),
    800
  )
  assert.equal((await q("SELECT 1 FROM stock_movements WHERE ref_type = 'purchase'")).length, 1)
})

test('selling 2 boxes takes 20 cakes, 5 loose cakes take 5: 75 left = 7 boxes and 5 cakes', async (t) => {
  if (!requireDb(t)) return
  const boxes = ok(await sell([{ barcode: 'HOHO', unitId: boxId, qty: 2 }]))
  assert.equal(boxes.total, 180, '2 boxes at the box price')
  assert.equal(await stock(), 80)
  const loose = ok(await sell([{ barcode: 'HOHO', qty: 5 }]))
  assert.equal(loose.total, 50)
  assert.equal(await stock(), 75)
  const { packagesOf } = await import('../../src/shared/packages.mjs')
  assert.deepEqual(packagesOf(await stock(), 10), { packages: 7, loose: 5 })
  // One sale line and one stock movement per sale – never box and cakes twice.
  const lines = await q(
    'SELECT quantity::float8 q, unit_factor::float8 f FROM sale_items WHERE sale_id = $1',
    [boxes.saleId]
  )
  assert.deepEqual(lines, [{ q: 2, f: 10 }])
  const moves = await q(
    "SELECT qty::float8 q FROM stock_movements WHERE ref_type = 'sale' AND ref_id = $1",
    [boxes.saleId]
  )
  assert.deepEqual(moves, [{ q: -20 }])
  // The product list shows the stock in boxes too.
  const row = ok(await svc.call('products.page', { search: 'HOHO' }, owner)).rows.find(
    (r) => r.barcode === 'HOHO'
  )
  assert.deepEqual([row.pack_name, row.pack_factor], ['علبة الهوهوز', 10])
  // A box returned goes back as 10 cakes.
  const item = await one('SELECT id FROM sale_items WHERE sale_id = $1', [boxes.saleId])
  ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: item.id, quantity: 1, reason: 'تالفة', currentShiftId: shift.id },
      owner
    )
  )
  assert.equal(await stock(), 85)
})

test('the box becomes 12 cakes: stock unchanged, history keeps 10', async (t) => {
  if (!requireDb(t)) return
  const before = await stock()
  ok(
    await svc.call(
      'productUnits.save',
      {
        barcode: 'HOHO',
        units: [
          { id: boxId, name: 'علبة الهوهوز', factor: 12, retail_price: 105, barcodes: ['HOHO-BOX'] }
        ]
      },
      owner
    )
  )
  assert.equal(await stock(), before, 'no cake added or removed')
  assert.deepEqual(
    (
      await q('SELECT DISTINCT unit_factor::float8 f FROM sale_items WHERE unit_id = $1', [boxId])
    ).map((r) => r.f),
    [10]
  )
  assert.equal(
    Number((await one('SELECT unit_factor FROM supplier_purchase_items')).unit_factor),
    10
  )
  ok(await sell([{ barcode: 'HOHO', unitId: boxId, qty: 1 }]))
  assert.equal(await stock(), before - 12, 'new sales use the new size')
})

test('a preliminary invoice moves no stock; completing it in boxes adds the cakes once and pays nothing again', async (t) => {
  if (!requireDb(t)) return
  const s0 = await stock()
  const inv = ok(
    await svc.call(
      'supplierInvoices.createPending',
      { supplierId, total: 480, paymentMode: 'cash', currentShiftId: shift.id, clientRef: ref() },
      cashier
    )
  ).invoice
  assert.equal(await stock(), s0)
  const pays = (await q("SELECT 1 FROM safe_ledger WHERE kind = 'supplier_payment'")).length
  ok(
    await svc.call(
      'supplierInvoices.convert',
      {
        invoiceId: inv.id,
        items: [{ barcode: 'HOHO', unitId: boxId, qty: 5, unitCost: 96 }],
        clientRef: ref()
      },
      owner
    )
  )
  assert.equal(await stock(), s0 + 60, '5 boxes of 12')
  assert.equal((await q("SELECT 1 FROM safe_ledger WHERE kind = 'supplier_payment'")).length, pays)
})
