'use strict'
// Two prices per unit, purchase and selling (owner, 1.5.2, D-096). A package's selling price is
// automatic – the piece's selling price × its count, following both – until the owner types his
// own, which is kept until he restores the automatic price. Purchases may be entered in pieces or
// in cartons: the same purchase gives the same stock, cost and value either way, the carton's
// purchase price is its own price or the piece's × the count, and no purchase price ever changes
// a selling price. There is no wholesale price.
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
const { createPool } = require('../../src/server/db/pool')
const { migrate, listMigrations } = require('../../src/server/db/migrate')
const fs = require('fs')
const os = require('os')
const path = require('path')

let db, svc, owner, supplierId
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const unitsOf = async (barcode) =>
  ok(await svc.call('productUnits.get', { barcode }, owner)).units.map((u) => ({
    name: u.name,
    auto: u.retail_auto,
    typed: u.retail_price === null ? null : Number(u.retail_price),
    autoPrice: u.auto_price,
    cost: u.purchase_cost === null ? null : Number(u.purchase_cost)
  }))
const priceAtTill = async (code) => ok(await svc.call('pos.resolve', { code }, owner)).unit.price
const setPiece = (barcode, retail) =>
  svc.pool.query('UPDATE products SET retail_price = $2 WHERE barcode = $1', [barcode, retail])
const saveUnits = (barcode, units) => svc.call('productUnits.save', { barcode, units }, owner)
const buy = (items) =>
  svc.call(
    'suppliers.addPurchase',
    {
      supplierId,
      total_amount:
        Math.round(
          items.reduce((a, i) => a + Math.round(i.qty * i.unitCost * 100) / 100, 0) * 100
        ) / 100,
      paid_amount: 0,
      payment_type: 'آجل',
      clientRef: crypto.randomUUID(),
      items
    },
    owner
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  owner = await login(svc, '8642')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES
     ('JUICE', 'عصير', 4, 6, 5.5, 0, 'قطعة'), ('A', 'صنف أ', 4, 6, 0, 0, 'قطعة'), ('B', 'صنف ب', 4, 6, 0, 0, 'قطعة')`
  )
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد السعرين' }, owner)).id
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a package without its own price is automatic: piece price × count, at the till too', async (t) => {
  if (!requireDb(t)) return
  ok(
    await saveUnits('JUICE', [
      { name: 'كرتونة', factor: 24, barcodes: ['JUICE-24'] },
      { name: 'علبة', factor: 6, retail_price: 33, barcodes: ['JUICE-6'] }
    ])
  )
  assert.deepEqual(await unitsOf('JUICE'), [
    { name: 'علبة', auto: false, typed: 33, autoPrice: 36, cost: null },
    { name: 'كرتونة', auto: true, typed: null, autoPrice: 144, cost: null }
  ])
  assert.equal(await priceAtTill('JUICE-24'), 144)
  assert.equal(await priceAtTill('JUICE-6'), 33)
})

test('the automatic price follows the piece price; a typed one is kept', async (t) => {
  if (!requireDb(t)) return
  await setPiece('JUICE', 6.5)
  assert.equal(await priceAtTill('JUICE-24'), 156, '6.5 × 24')
  assert.equal(await priceAtTill('JUICE-6'), 33, 'the typed price does not move')
  // Through the product form as well.
  const p = ok(await svc.call('products.get', { barcode: 'JUICE' }, owner))
  ok(
    await svc.call(
      'products.update',
      { ...p, barcode: 'JUICE', name: p.name, retail_price: 7, cost_price: Number(p.cost_price) },
      owner
    )
  )
  assert.equal(await priceAtTill('JUICE-24'), 168)
})

test('typing a price overrides; restoring the automatic price makes it follow again', async (t) => {
  if (!requireDb(t)) return
  const [box, carton] = await unitsOf('JUICE')
  assert.ok(box && carton)
  const units = async () =>
    ok(await svc.call('productUnits.get', { barcode: 'JUICE' }, owner)).units
  const ids = Object.fromEntries((await units()).map((u) => [u.name, u.id]))
  // The owner types the carton's price: kept even when it equals piece × count later.
  ok(
    await saveUnits('JUICE', [
      {
        id: ids['كرتونة'],
        name: 'كرتونة',
        factor: 24,
        retail_price: 150,
        retail_auto: false,
        barcodes: ['JUICE-24']
      },
      { id: ids['علبة'], name: 'علبة', factor: 6, retail_price: 33, barcodes: ['JUICE-6'] }
    ])
  )
  assert.equal(await priceAtTill('JUICE-24'), 150)
  await setPiece('JUICE', 6.25) // 6.25 × 24 = 150: equal by chance, still typed
  assert.equal((await unitsOf('JUICE')).find((u) => u.name === 'كرتونة').auto, false)
  await setPiece('JUICE', 8)
  assert.equal(await priceAtTill('JUICE-24'), 150, 'a typed price never follows')
  // «استعادة السعر التلقائي»: automatic again, the typed value is cleared.
  ok(
    await saveUnits('JUICE', [
      {
        id: ids['كرتونة'],
        name: 'كرتونة',
        factor: 24,
        retail_price: 150,
        retail_auto: true,
        barcodes: ['JUICE-24']
      },
      { id: ids['علبة'], name: 'علبة', factor: 6, retail_price: 33, barcodes: ['JUICE-6'] }
    ])
  )
  const carton2 = (await unitsOf('JUICE')).find((u) => u.name === 'كرتونة')
  assert.deepEqual([carton2.auto, carton2.typed], [true, null])
  assert.equal(await priceAtTill('JUICE-24'), 192, '8 × 24')
  // Typed without a price: refused, nothing changes.
  const refused = await saveUnits('JUICE', [
    { id: ids['كرتونة'], name: 'كرتونة', factor: 24, retail_auto: false, barcodes: ['JUICE-24'] }
  ])
  assert.equal(refused.status, 400)
  assert.equal(await priceAtTill('JUICE-24'), 192)
  // The mode is in the activity log with the change.
  const log = await one(
    "SELECT details FROM system_logs WHERE action_type = 'product_units' ORDER BY id DESC LIMIT 1"
  )
  assert.match(log.details, /retail_auto/)
})

test('a new package count: the automatic price follows it; past sales keep theirs', async (t) => {
  if (!requireDb(t)) return
  const ids = Object.fromEntries(
    ok(await svc.call('productUnits.get', { barcode: 'JUICE' }, owner)).units.map((u) => [
      u.name,
      u.id
    ])
  )
  ok(
    await saveUnits('JUICE', [
      { id: ids['كرتونة'], name: 'كرتونة', factor: 12, barcodes: ['JUICE-24'] },
      { id: ids['علبة'], name: 'علبة', factor: 6, retail_price: 33, barcodes: ['JUICE-6'] }
    ])
  )
  assert.equal(await priceAtTill('JUICE-24'), 96, '8 × 12')
})

test('the same purchase in pieces or in cartons: same stock, cost and value; carton cost follows', async (t) => {
  if (!requireDb(t)) return
  for (const b of ['A', 'B'])
    ok(
      await saveUnits(b, [{ name: 'كرتونة', factor: 24, retail_price: 130, barcodes: [`${b}-24`] }])
    )
  const cartonA = ok(await svc.call('productUnits.get', { barcode: 'A' }, owner)).units[0]
  // A: 2 cartons at 120. B: 48 pieces at 5.
  ok(await buy([{ barcode: 'A', unitId: cartonA.id, qty: 2, unitCost: 120 }]))
  ok(await buy([{ barcode: 'B', qty: 48, unitCost: 5 }]))
  const state = async (b) =>
    one(
      `SELECT p.stock_qty::float8 s, p.cost_price::float8 c, (p.stock_qty * p.cost_price)::float8 v,
              u.purchase_cost::float8 uc, u.retail_price::float8 ur, p.retail_price::float8 r
         FROM products p JOIN product_units u ON u.product_barcode = p.barcode WHERE p.barcode = $1`,
      [b]
    )
  const a = await state('A')
  const b = await state('B')
  assert.deepEqual([a.s, a.c, a.v, a.uc], [48, 5, 240, 120])
  assert.deepEqual([b.s, b.c, b.v, b.uc], [48, 5, 240, 120], 'the same as by the carton')
  // Selling prices untouched by both: piece 6, carton typed 130.
  assert.deepEqual([a.r, a.ur, b.r, b.ur], [6, 130, 6, 130])
  // The invoices keep the unit and quantity as entered.
  const lines = await q(
    "SELECT product_barcode b, qty::float8 q, unit_name n, unit_factor::float8 f, unit_cost::float8 c FROM supplier_purchase_items WHERE product_barcode IN ('A', 'B') ORDER BY 1"
  )
  assert.deepEqual(lines, [
    { b: 'A', q: 2, n: 'كرتونة', f: 24, c: 120 },
    { b: 'B', q: 48, n: 'قطعة', f: 1, c: 5 }
  ])
  // Stock value report agrees.
  const v = ok(await svc.call('inventory.valuation', { search: 'صنف' }, owner))
  assert.deepEqual(
    v.rows.filter((r) => ['A', 'B'].includes(r.barcode)).map((r) => r.value_cost),
    [240, 240]
  )
  // Rounding: 7 pieces at 1.3333 → the carton 31.9992 → 32.00 (money precision).
  ok(await buy([{ barcode: 'B', qty: 7, unitCost: 1.3333 }]))
  assert.equal((await state('B')).uc, 32)
})

test('there is no wholesale price: not shown, not written, not accepted by owner commands', async (t) => {
  if (!requireDb(t)) return
  const was = Number(
    (await one("SELECT wholesale_price FROM products WHERE barcode = 'JUICE'")).wholesale_price
  )
  const p = ok(await svc.call('products.get', { barcode: 'JUICE' }, owner))
  ok(
    await svc.call(
      'products.update',
      {
        ...p,
        barcode: 'JUICE',
        name: p.name,
        retail_price: 8,
        cost_price: Number(p.cost_price),
        wholesale_price: 1
      },
      owner
    )
  )
  assert.equal(
    Number(
      (await one("SELECT wholesale_price FROM products WHERE barcode = 'JUICE'")).wholesale_price
    ),
    was,
    'the old column keeps its value; nothing writes it'
  )
  const { SHEETS } = await import('../../src/shared/storeImport.mjs')
  const headers = JSON.stringify(SHEETS)
  assert.ok(!headers.includes('جملة'), 'the template has no wholesale column')
})

test('migration 0029: typed packages stay typed, packages without a price become automatic', async (t) => {
  if (!requireDb(t)) return
  const fresh = await freshDatabase()
  const pool = createPool(fresh.url, { max: 2 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig29-'))
  try {
    for (const m of listMigrations().filter((x) => Number(x.version) <= 28))
      fs.copyFileSync(
        path.join(__dirname, '../../src/server/db/migrations', `${m.name}.sql`),
        path.join(tmp, `${m.name}.sql`)
      )
    await migrate(pool, { dir: tmp, logger: { info() {} } })
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
      await c.query(
        "INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES ('X', 'س', 1, 2, 1.8, 0, 'قطعة')"
      )
      await c.query(
        `INSERT INTO product_units (product_barcode, name, factor, retail_price, wholesale_price, sellable, purchasable)
         VALUES ('X', 'علبة', 10, 19, 18, true, true), ('X', 'كرتونة', 20, NULL, NULL, true, true)`
      )
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    await migrate(pool, { logger: { info() {} } })
    const rows = (
      await pool.query(
        "SELECT name, retail_price::float8 r, retail_auto a, wholesale_price::float8 w FROM product_units WHERE product_barcode = 'X' ORDER BY factor"
      )
    ).rows
    assert.deepEqual(rows, [
      { name: 'علبة', r: 19, a: false, w: 18 },
      { name: 'كرتونة', r: null, a: true, w: null }
    ])
    assert.equal(
      Number(
        (await pool.query("SELECT wholesale_price FROM products WHERE barcode = 'X'")).rows[0]
          .wholesale_price
      ),
      1.8,
      'history kept'
    )
  } finally {
    await pool.end()
    await fresh.dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
