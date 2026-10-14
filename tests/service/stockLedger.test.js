'use strict'
// Stage 4, phase 1: stock movement ledger, negative stock, purchase receipts, moving-average cost.
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

let db, svc, admin, shift
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const stock = async (barcode) =>
  Number((await one('SELECT stock_qty FROM products WHERE barcode = $1', [barcode])).stock_qty)
const cost = async (barcode) =>
  Number((await one('SELECT cost_price FROM products WHERE barcode = $1', [barcode])).cost_price)
const sell = async (barcode, qty) => {
  const p = await one('SELECT retail_price FROM products WHERE barcode = $1', [barcode])
  return ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode, qty, unitPrice: Number(p.retail_price) }]
      },
      admin
    )
  )
}
let supplierId
const purchase = (items, extra = {}) => {
  const total = items.reduce((a, i) => a + Math.round(i.qty * i.unitCost * 100) / 100, 0)
  return svc.call(
    'suppliers.addPurchase',
    {
      supplierId,
      invoice_ref: `INV-${crypto.randomBytes(3).toString('hex')}`,
      total_amount: Math.round(total * 100) / 100,
      paid_amount: 0,
      items,
      ...extra
    },
    admin
  )
}

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, reorder_limit, unit, category) VALUES
      ('PEPSI', 'بيبسي كانز', 8, 12, 11, 1, 6, 'علبة', 'مشروبات'),
      ('AVG', 'صنف متوسط', 5, 10, 9, 10, 0, 'قطعة', 'عام'),
      ('K37', 'صنف تعديل', 3, 5, 4, 10, 0, 'قطعة', 'عام'),
      ('CNT', 'صنف جرد', 2, 4, 3, 20, 0, 'قطعة', 'عام'),
      ('RACE', 'صنف تزامن', 1, 2, 2, 50, 0, 'قطعة', 'عام')`
  )
  admin = await login(svc, '8642')
  shift = ok(await svc.call('shifts.open', { startingCash: 100 }, admin))
  supplierId = ok(
    await svc.call('suppliers.create', { name: 'مورد المشروبات', phone: '0100' }, admin)
  ).id
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('owner example: stock 1, sell 10 → −9, receive 24 → 15, with the full movement history', async (t) => {
  if (!requireDb(t)) return
  await sell('PEPSI', 10)
  assert.equal(await stock('PEPSI'), -9)
  const negative = ok(await svc.call('inventory.negative', {}, admin))
  assert.ok(negative.some((p) => p.barcode === 'PEPSI' && Number(p.stock) === -9))
  const r = ok(await purchase([{ barcode: 'PEPSI', qty: 24, unitCost: 8.5 }]))
  assert.equal(r.receivedItems, 1)
  assert.equal(await stock('PEPSI'), 15)
  const history = ok(await svc.call('inventory.movements', { barcode: 'PEPSI' }, admin))
  assert.deepEqual(
    history.map((m) => [m.kind, Number(m.qty), Number(m.balance_after)]),
    [
      ['purchase', 24, 15],
      ['sale', -10, -9],
      ['opening', 1, 1]
    ]
  )
  assert.equal(history[0].ref_type, 'purchase')
  assert.equal(history[0].ref_id, r.purchaseId)
  assert.equal(history[0].username, 'owner')
  assert.ok(!ok(await svc.call('inventory.negative', {}, admin)).some((p) => p.barcode === 'PEPSI'))
})

test('moving average: receipts average in; a receipt while stock is zero or negative sets the average', async (t) => {
  if (!requireDb(t)) return
  // 10 @ 5, receive 10 @ 7 → (50 + 70) / 20 = 6
  ok(await purchase([{ barcode: 'AVG', qty: 10, unitCost: 7 }]))
  assert.equal(await cost('AVG'), 6)
  // Sell 25: stock 20 → −5; every unit leaves at the current average 6.
  const s1 = await sell('AVG', 25)
  const line = await one('SELECT cost_price FROM sale_items WHERE sale_id = $1', [s1.saleId])
  assert.equal(Number(line.cost_price), 6)
  assert.equal(await stock('AVG'), -5)
  // Receipt while negative: average becomes the receipt cost; the 5 units already sold stay at 6.
  ok(await purchase([{ barcode: 'AVG', qty: 20, unitCost: 8 }]))
  assert.equal(await stock('AVG'), 15)
  assert.equal(await cost('AVG'), 8)
  assert.equal(
    Number(
      (await one('SELECT cost_price FROM sale_items WHERE sale_id = $1', [s1.saleId])).cost_price
    ),
    6,
    'past sales are not revalued'
  )
  // Next receipt with positive stock: (15·8 + 5·10) / 20 = 8.5
  ok(await purchase([{ barcode: 'AVG', qty: 5, unitCost: 10 }]))
  assert.equal(await cost('AVG'), 8.5)
  // A return re-enters at the current average and does not change it.
  const s2 = await sell('AVG', 2)
  const item = await one('SELECT id FROM sale_items WHERE sale_id = $1', [s2.saleId])
  ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: item.id, quantity: 1, currentShiftId: shift.id },
      admin
    )
  )
  assert.equal(await cost('AVG'), 8.5)
  const ret = await one(
    "SELECT unit_cost, qty FROM stock_movements WHERE product_barcode = 'AVG' AND kind = 'return'"
  )
  assert.deepEqual([Number(ret.qty), Number(ret.unit_cost)], [1, 8.5])
})

test('K-37: the product form never overwrites stock; sales made while it is open are kept', async (t) => {
  if (!requireDb(t)) return
  const shown = await stock('K37') // form opened: 10
  await sell('K37', 1) // another sale while the form is open → 9
  // The user types 34 (meaning +24 on what they saw): result 33, not 34.
  ok(
    await svc.call(
      'products.update',
      {
        barcode: 'K37',
        name: 'صنف تعديل',
        cost_price: 3,
        retail_price: 5,
        stock_qty: 34,
        stock_base: shown
      },
      admin
    )
  )
  assert.equal(await stock('K37'), 33)
  const adj = await one(
    "SELECT qty, kind FROM stock_movements WHERE product_barcode = 'K37' ORDER BY id DESC LIMIT 1"
  )
  assert.deepEqual([adj.kind, Number(adj.qty)], ['adjustment', 24])
  // An old client without stock_base cannot change stock.
  const stale = await svc.call(
    'products.update',
    { barcode: 'K37', name: 'صنف تعديل', cost_price: 3, retail_price: 5, stock_qty: 50 },
    admin
  )
  assert.equal(stale.status, 409)
  assert.equal(await stock('K37'), 33)
  // Editing only the price (stock unchanged) still works without a base, and writes no movement.
  const before = (
    await one("SELECT count(*)::int AS n FROM stock_movements WHERE product_barcode = 'K37'")
  ).n
  ok(
    await svc.call(
      'products.update',
      { barcode: 'K37', name: 'صنف تعديل', cost_price: 3, retail_price: 6, stock_qty: 33 },
      admin
    )
  )
  const afterN = (
    await one("SELECT count(*)::int AS n FROM stock_movements WHERE product_barcode = 'K37'")
  ).n
  assert.equal(afterN, before)
})

test('the ledger cannot be bypassed: direct stock writes and movement edits are refused', async (t) => {
  if (!requireDb(t)) return
  await assert.rejects(q("UPDATE products SET stock_qty = 999 WHERE barcode = 'K37'"), /حركة مخزون/)
  await assert.rejects(
    q("INSERT INTO products (barcode, name, stock_qty) VALUES ('DIRECT', 'x', 5)"),
    /حركة مخزون/
  )
  await assert.rejects(
    q("UPDATE stock_movements SET qty = 1000 WHERE product_barcode = 'K37'"),
    /لا تُعدَّل/
  )
  await assert.rejects(q("DELETE FROM stock_movements WHERE product_barcode = 'K37'"), /لا تُعدَّل/)
  // A new product's initial quantity is an opening movement.
  ok(
    await svc.call(
      'products.create',
      { barcode: 'NEW1', name: 'صنف جديد', cost_price: 2, retail_price: 3, stock_qty: 12 },
      admin
    )
  )
  const m = await one(
    "SELECT kind, qty, unit_cost FROM stock_movements WHERE product_barcode = 'NEW1'"
  )
  assert.deepEqual([m.kind, Number(m.qty), Number(m.unit_cost)], ['opening', 12, 2])
  // A product with only an opening balance can be deleted; one with sales cannot.
  ok(await svc.call('products.delete', { barcode: 'NEW1' }, admin))
  assert.equal((await svc.call('products.delete', { barcode: 'K37' }, admin)).status, 409)
})

test('K-38: purchase lines receive stock; totals must match; nothing is written on refusal', async (t) => {
  if (!requireDb(t)) return
  const movesBefore = (await one('SELECT count(*)::int AS n FROM stock_movements')).n
  const mismatch = await svc.call(
    'suppliers.addPurchase',
    {
      supplierId,
      invoice_ref: 'BAD',
      total_amount: 100,
      items: [{ barcode: 'CNT', qty: 10, unitCost: 5 }]
    },
    admin
  )
  assert.equal(mismatch.status, 400)
  const dup = await purchase([
    { barcode: 'CNT', qty: 1, unitCost: 1 },
    { barcode: 'CNT', qty: 1, unitCost: 1 }
  ])
  assert.equal(dup.status, 400)
  const unknown = await purchase([{ barcode: 'NOPE', qty: 1, unitCost: 1 }])
  assert.equal(unknown.status, 404)
  assert.equal((await one('SELECT count(*)::int AS n FROM stock_movements')).n, movesBefore)
  assert.equal(
    (await one("SELECT count(*)::int AS n FROM supplier_purchases WHERE invoice_ref = 'BAD'")).n,
    0
  )

  // Paid partly from the drawer: stock in, supplier debt for the rest, drawer outflow for the paid part.
  const debtBefore = Number(
    (await one('SELECT debt_balance FROM suppliers WHERE id = $1', [supplierId])).debt_balance
  )
  const r = ok(
    await purchase(
      [
        { barcode: 'CNT', qty: 10, unitCost: 2.5 },
        { barcode: 'K37', qty: 4, unitCost: 3.25 }
      ],
      { paid_amount: 20, currentShiftId: shift.id }
    )
  )
  const lines = await q(
    'SELECT product_barcode, qty, unit_cost, line_total FROM supplier_purchase_items WHERE purchase_id = $1 ORDER BY product_barcode',
    [r.purchaseId]
  )
  assert.deepEqual(
    lines.map((l) => [l.product_barcode, Number(l.qty), Number(l.unit_cost), Number(l.line_total)]),
    [
      ['CNT', 10, 2.5, 25],
      ['K37', 4, 3.25, 13]
    ]
  )
  const debtAfter = Number(
    (await one('SELECT debt_balance FROM suppliers WHERE id = $1', [supplierId])).debt_balance
  )
  assert.equal(Math.round((debtAfter - debtBefore) * 100), 1800)
  const drawer = await one(
    "SELECT amount FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND description LIKE 'دفعة لمورد%' ORDER BY id DESC LIMIT 1",
    [shift.id]
  )
  assert.equal(Number(drawer.amount), 20)
  // A supplier whose invoices received stock cannot be deleted.
  assert.equal((await svc.call('suppliers.delete', { supplierId }, admin)).status, 409)
})

test('stock count against the stock shown when counting started keeps later sales', async (t) => {
  if (!requireDb(t)) return
  const shown = await stock('CNT') // counting starts
  await sell('CNT', 2) // sold while counting
  // Counted 3 fewer than shown on the shelf at count time.
  const r = ok(
    await svc.call(
      'inventory.count',
      { barcode: 'CNT', counted: shown - 3, base: shown, reason: 'جرد شهري' },
      admin
    )
  )
  assert.equal(r.stock, shown - 3 - 2)
  const m = await one(
    "SELECT kind, qty, reason FROM stock_movements WHERE product_barcode = 'CNT' ORDER BY id DESC LIMIT 1"
  )
  assert.deepEqual([m.kind, Number(m.qty), m.reason], ['count', -3, 'جرد شهري'])
  // A reason is mandatory.
  assert.equal(
    (await svc.call('inventory.count', { barcode: 'CNT', counted: 1 }, admin)).status,
    400
  )
})

test('concurrent sales and receipts on one product: final stock = start − sold + received', async (t) => {
  if (!requireDb(t)) return
  const start = await stock('RACE')
  const ops = []
  for (let i = 0; i < 12; i++) ops.push(sell('RACE', 3))
  for (let i = 0; i < 6; i++)
    ops.push(purchase([{ barcode: 'RACE', qty: 5, unitCost: 1 }]).then(ok))
  await Promise.all(ops)
  assert.equal(await stock('RACE'), start - 36 + 30)
  const balances = (
    await q(
      "SELECT qty, balance_after FROM stock_movements WHERE product_barcode = 'RACE' ORDER BY id"
    )
  ).map((m) => [Number(m.qty), Number(m.balance_after)])
  // Each balance equals the previous balance plus the movement: no lost update.
  for (let i = 1; i < balances.length; i++)
    assert.equal(balances[i][1], balances[i - 1][1] + balances[i][0])
})

test('after everything above, every product stock equals the sum of its movements', async (t) => {
  if (!requireDb(t)) return
  assert.deepEqual(await verifyLedger(svc.pool), [])
  assert.deepEqual(ok(await svc.call('inventory.verify', {}, admin)), { ok: true, mismatches: [] })
})

test('migration 0004 on an existing store: opening movements reproduce today’s stock exactly', async (t) => {
  if (!requireDb(t)) return
  const fresh = await freshDatabase()
  const pool = createPool(fresh.url, { max: 2 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig-'))
  try {
    // Schema as installed before this change (migrations up to 0003) …
    for (const m of listMigrations().filter((x) => x.version < 4))
      fs.copyFileSync(
        path.join(__dirname, '../../src/server/db/migrations', `${m.name}.sql`),
        path.join(tmp, `${m.name}.sql`)
      )
    const quiet = { info() {} }
    await migrate(pool, { dir: tmp, logger: quiet })
    // … holding products with awkward stock values.
    await pool.query(`INSERT INTO products (barcode, name, cost_price, stock_qty) VALUES
      ('A', 'a', 1.5, 7), ('B', 'b', 2, 0), ('C', 'c', 3, 0.125), ('D', 'd', NULL, NULL), ('E', 'e', 4, 1234.5678)`)
    const beforeRows = (
      await pool.query('SELECT barcode, stock_qty::text AS s FROM products ORDER BY barcode')
    ).rows
    await migrate(pool, { logger: quiet })
    const afterRows = (
      await pool.query('SELECT barcode, stock_qty::text AS s FROM products ORDER BY barcode')
    ).rows
    assert.deepEqual(afterRows, beforeRows, 'stock values unchanged')
    assert.deepEqual(await verifyLedger(pool), [])
    const mv = (
      await pool.query(
        'SELECT product_barcode, qty::text AS q, unit_cost::text AS c FROM stock_movements ORDER BY product_barcode'
      )
    ).rows
    assert.deepEqual(mv, [
      { product_barcode: 'A', q: '7', c: '1.5' },
      { product_barcode: 'C', q: '0.125', c: '3' },
      { product_barcode: 'E', q: '1234.5678', c: '4' }
    ])
  } finally {
    await pool.end()
    await fresh.dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
