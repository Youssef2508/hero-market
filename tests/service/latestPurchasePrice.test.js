'use strict'
// The latest purchase price replaces the moving average (owner, 1.5.2, D-087). A confirmed purchase
// sets the product's purchase price (per base unit) to the price on its line; empty fields keep the
// current prices; sales keep the cost they were sold at; returns move at the cost of the
// transaction they reverse; migration 0026 starts every product from its latest purchase.
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

let db, svc, owner, cashier, shift, supplierId, cartonId
const ref = () => crypto.randomUUID()
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r, what = '') => {
  assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`)
  return r.body
}
const r2 = (n) => Math.round(Number(n) * 100) / 100
const product = (b) =>
  one(
    `SELECT stock_qty::float8 s, cost_price::float8 c, retail_price::float8 r, wholesale_price::float8 w
       FROM products WHERE barcode = $1`,
    [b]
  )
const debt = async () =>
  r2((await one('SELECT debt_balance FROM suppliers WHERE id = $1', [supplierId])).debt_balance)
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
const dash = async () =>
  ok(await svc.call('reports.dashboard', { from: today(), to: today() }, owner)).totals
// A purchase whose total is its lines (a line without a price counts at `atCost`).
const buy = (items, extra = {}, atCost = {}) =>
  svc.call(
    'suppliers.addPurchase',
    {
      supplierId,
      invoice_ref: `INV-${crypto.randomBytes(3).toString('hex')}`,
      total_amount: r2(
        items.reduce((a, i) => a + r2(i.qty * (i.unitCost ?? atCost[i.barcode] ?? 0)), 0)
      ),
      paid_amount: 0,
      payment_type: 'آجل',
      items,
      ...extra
    },
    owner
  )
const sell = async (barcode, qty) => {
  const p = await one('SELECT retail_price FROM products WHERE barcode = $1', [barcode])
  return ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: ref(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode, qty, unitPrice: Number(p.retail_price) }]
      },
      cashier
    )
  )
}

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
     ('ROUMY', 'جبنة رومي فرط', 200, 240, 225, 10, 'كيلو'),
     ('REP', 'صنف متكرر', 5, 10, 9, 20, 'قطعة'),
     ('KEEP', 'صنف بلا سعر جديد', 30, 45, 40, 5, 'قطعة'),
     ('PACK', 'عصير', 4, 6, 5.5, 0, 'قطعة'),
     ('SNAP', 'صنف البيع', 10, 15, 14, 50, 'قطعة'),
     ('RET', 'صنف المرتجع', 10, 15, 14, 0, 'قطعة'),
     ('NOBUY', 'صنف لم يُشترَ', 17.5, 25, 23, 3, 'قطعة'),
     ('RACE', 'صنف التزامن', 8, 12, 11, 0, 'قطعة')`
  )
  ok(
    await svc.call(
      'productUnits.save',
      {
        barcode: 'PACK',
        units: [
          { name: 'كرتونة', factor: 24, retail_price: 140, wholesale_price: 130, purchase_cost: 90 }
        ]
      },
      owner
    )
  )
  cartonId = ok(await svc.call('productUnits.get', { barcode: 'PACK' }, owner)).units[0].id
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الأسعار' }, owner)).id
  shift = ok(await svc.call('shifts.open', { startingCash: 500 }, cashier))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test("1. the owner's example: 200 → 220 bought, 260 selling; the package keeps its own price; never an average", async (t) => {
  if (!requireDb(t)) return
  // A typed package price (a 5 kg block) and an automatic one (a 2 kg roll).
  ok(
    await svc.call(
      'productUnits.save',
      {
        barcode: 'ROUMY',
        units: [
          { name: 'قالب 5 كيلو', factor: 5, retail_price: 1150 },
          { name: 'لفة 2 كيلو', factor: 2, retail_auto: true }
        ]
      },
      owner
    )
  )
  const r = ok(await buy([{ barcode: 'ROUMY', qty: 5, unitCost: 220, newRetailPrice: 260 }]))
  const p = await product('ROUMY')
  assert.deepEqual([p.s, p.c, p.r], [15, 220, 260])
  // The moving average would have been (10×200 + 5×220) ÷ 15 = 206.67 (and 207.69 for other
  // quantities): never.
  assert.notEqual(p.c, 206.6667)
  // The product screen shows the same: products.get answers the purchase price to the owner.
  const shown = ok(await svc.call('products.get', { barcode: 'ROUMY' }, owner))
  assert.deepEqual([Number(shown.cost_price), Number(shown.retail_price)], [220, 260])
  // Packages (D-096): the typed one keeps 1150; the automatic one follows 260 × 2; their
  // purchase prices follow the purchase (220 × 5, 220 × 2).
  const units = ok(await svc.call('productUnits.get', { barcode: 'ROUMY' }, owner)).units
  const block = units.find((u) => u.name === 'قالب 5 كيلو')
  const roll = units.find((u) => u.name === 'لفة 2 كيلو')
  assert.deepEqual(
    [Number(block.retail_price), block.retail_auto, Number(block.purchase_cost)],
    [1150, false, 1100]
  )
  assert.deepEqual(
    [roll.retail_price, roll.retail_auto, roll.auto_price, Number(roll.purchase_cost)],
    [null, true, 520, 440]
  )
  const atTill = ok(await svc.call('pos.resolve', { code: 'ROUMY' }, owner)).units
  assert.deepEqual(
    atTill.map((u) => [u.name, u.price]),
    [
      ['كيلو', 260],
      ['لفة 2 كيلو', 520],
      ['قالب 5 كيلو', 1150]
    ]
  )
  const log = await q(
    "SELECT details FROM system_logs WHERE action_type = 'product_price_change' AND details::jsonb->>'purchaseId' = $1",
    [String(r.purchaseId)]
  )
  assert.equal(log.length, 1, 'the selling price change is in the activity log')
})

test('2. repeated purchases: the latest price wins, cheaper or dearer, without averaging', async (t) => {
  if (!requireDb(t)) return
  for (const price of [6, 8, 4.25]) {
    ok(await buy([{ barcode: 'REP', qty: 10, unitCost: price }]))
    assert.equal((await product('REP')).c, price)
  }
  assert.equal((await product('REP')).s, 50)
})

test('3. an empty purchase price keeps the current price; the line counts at it', async (t) => {
  if (!requireDb(t)) return
  const before = await product('KEEP')
  const r = ok(
    await buy(
      [
        { barcode: 'KEEP', qty: 2, unitCost: null },
        { barcode: 'REP', qty: 1 } // omitted altogether
      ],
      {},
      { KEEP: 30, REP: 4.25 }
    )
  )
  assert.equal((await product('KEEP')).c, before.c)
  assert.equal((await product('KEEP')).s, before.s + 2)
  assert.equal((await product('REP')).c, 4.25)
  const lines = await q(
    'SELECT product_barcode b, unit_cost::float8 c, line_total::float8 t FROM supplier_purchase_items WHERE purchase_id = $1 ORDER BY product_barcode',
    [r.purchaseId]
  )
  assert.deepEqual(lines, [
    { b: 'KEEP', c: 30, t: 60 },
    { b: 'REP', c: 4.25, t: 4.25 }
  ])
})

test('4. an empty selling price keeps it; there is no wholesale price any more (D-096)', async (t) => {
  if (!requireDb(t)) return
  ok(await buy([{ barcode: 'KEEP', qty: 1, unitCost: 32 }]))
  assert.deepEqual(await product('KEEP'), { s: 8, c: 32, r: 45, w: 40 })
  ok(await buy([{ barcode: 'KEEP', qty: 1, unitCost: 33, newRetailPrice: 50 }]))
  assert.deepEqual(await product('KEEP'), { s: 9, c: 33, r: 50, w: 40 })
  // The former wholesale field from an old client is dropped; the old column keeps 40.
  ok(await buy([{ barcode: 'KEEP', qty: 1, unitCost: 33, newWholesalePrice: 44 }]))
  assert.deepEqual(await product('KEEP'), { s: 10, c: 33, r: 50, w: 40 })
})

test('5. a preliminary, cancelled or failed purchase changes no price', async (t) => {
  if (!requireDb(t)) return
  const before = await product('KEEP')
  const purchases = (await one('SELECT count(*)::int n FROM supplier_purchases')).n
  // A preliminary invoice (the draft) and its cancellation: no lines, no price.
  const pending = ok(
    await svc.call(
      'supplierInvoices.createPending',
      { supplierId, total: 100, paymentMode: 'credit', currentShiftId: shift.id, clientRef: ref() },
      cashier
    )
  ).invoice
  ok(
    await svc.call(
      'supplierInvoices.cancel',
      { invoiceId: pending.id, refund: 'none', clientRef: ref() },
      owner
    )
  )
  // Failed: the second line is unknown; the total does not match; a unit that is not for buying.
  const unknown = await buy([
    { barcode: 'KEEP', qty: 1, unitCost: 99, newRetailPrice: 99 },
    { barcode: 'NOPE', qty: 1, unitCost: 1 }
  ])
  assert.equal(unknown.status, 404)
  const mismatch = await buy([{ barcode: 'KEEP', qty: 1, unitCost: 99 }], { total_amount: 50 })
  assert.equal(mismatch.status, 400)
  assert.deepEqual(await product('KEEP'), before)
  assert.equal((await one('SELECT count(*)::int n FROM supplier_purchases')).n, purchases)
})

test('6. one confirmed purchase changes the prices exactly once', async (t) => {
  if (!requireDb(t)) return
  const r = ok(await buy([{ barcode: 'KEEP', qty: 3, unitCost: 34, newRetailPrice: 52 }]))
  const logs = await q(
    "SELECT details::jsonb->>'price' p FROM system_logs WHERE action_type = 'product_price_change' AND details::jsonb->>'purchaseId' = $1 ORDER BY 1",
    [String(r.purchaseId)]
  )
  assert.deepEqual(
    logs.map((x) => x.p),
    ['retail_price']
  )
  const moves = await q(
    "SELECT qty::float8 n, unit_cost::float8 c FROM stock_movements WHERE ref_type = 'purchase' AND ref_id = $1",
    [r.purchaseId]
  )
  assert.deepEqual(moves, [{ n: 3, c: 34 }])
  assert.deepEqual(await product('KEEP'), { s: 13, c: 34, r: 52, w: 40 })
})

test('7. pieces or cartons (owner, D-096): carton = its price, piece = carton ÷ 24, and back', async (t) => {
  if (!requireDb(t)) return
  const carton = () =>
    one(
      'SELECT purchase_cost::float8 c, retail_price::float8 r, retail_auto a FROM product_units WHERE id = $1',
      [cartonId]
    )
  // Bought by the carton at 120: the carton costs exactly 120, the piece 5. Selling prices: the
  // piece only where a new one was typed (6.5); the carton keeps its typed 140.
  ok(await buy([{ barcode: 'PACK', unitId: cartonId, qty: 2, unitCost: 120, newRetailPrice: 6.5 }]))
  const p = await product('PACK')
  assert.deepEqual([p.s, p.c, p.r], [48, 5, 6.5])
  assert.deepEqual(await carton(), { c: 120, r: 140, a: false })
  // Bought by the piece at 5.5: the piece costs 5.5 and the carton 5.5 × 24 = 132.
  ok(await buy([{ barcode: 'PACK', qty: 12, unitCost: 5.5 }]))
  assert.equal((await product('PACK')).c, 5.5)
  assert.equal((await carton()).c, 132)
  // A carton line with an empty price counts at 24 × the piece price and changes nothing.
  ok(await buy([{ barcode: 'PACK', unitId: cartonId, qty: 1, unitCost: null }], {}, { PACK: 132 }))
  assert.deepEqual([(await product('PACK')).c, (await carton()).c], [5.5, 132])
  // Pieces and cartons in one invoice: the later line wins (per piece and per carton).
  ok(
    await buy([
      { barcode: 'PACK', qty: 6, unitCost: 6 },
      { barcode: 'PACK', unitId: cartonId, qty: 1, unitCost: 126 }
    ])
  )
  assert.deepEqual([(await product('PACK')).c, (await carton()).c], [5.25, 126])
  // The carton's selling price was never touched by any purchase price.
  assert.equal((await carton()).r, 140)
})

test('8. completed sales keep their cost and profit after later price changes', async (t) => {
  if (!requireDb(t)) return
  const d0 = await dash()
  const sale = await sell('SNAP', 4)
  const line = await one('SELECT id, cost_price::float8 c FROM sale_items WHERE sale_id = $1', [
    sale.saleId
  ])
  assert.equal(line.c, 10)
  const d1 = await dash()
  assert.equal(r2(d1.netProfit - d0.netProfit), 20, '4 × (15 − 10)')
  ok(await buy([{ barcode: 'SNAP', qty: 10, unitCost: 13 }]))
  assert.equal(
    (await one('SELECT cost_price::float8 c FROM sale_items WHERE id = $1', [line.id])).c,
    10
  )
  assert.equal((await dash()).netProfit, d1.netProfit, 'a price change is not profit or loss')
  // The next sale takes the new price.
  const next = await sell('SNAP', 1)
  assert.equal(
    (await one('SELECT cost_price::float8 c FROM sale_items WHERE sale_id = $1', [next.saleId])).c,
    13
  )
})

test("9. returns: a customer's at the sale cost, a supplier's at the purchase line cost", async (t) => {
  if (!requireDb(t)) return
  const first = ok(await buy([{ barcode: 'RET', qty: 10, unitCost: 11 }]))
  const sale = await sell('RET', 3) // sold at 11
  ok(await buy([{ barcode: 'RET', qty: 10, unitCost: 14 }])) // price now 14
  const item = await one('SELECT id FROM sale_items WHERE sale_id = $1', [sale.saleId])
  ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: item.id, quantity: 1, currentShiftId: shift.id },
      owner
    )
  )
  const back = await one(
    "SELECT unit_cost::float8 c, qty::float8 n FROM stock_movements WHERE kind = 'return' AND ref_id = $1",
    [item.id]
  )
  assert.deepEqual(back, { c: 11, n: 1 })
  assert.equal((await product('RET')).c, 14, 'a customer return does not change the price')
  // The whole invoice back: the rest, also at 11.
  ok(await svc.call('sales.returnEntire', { saleId: sale.saleId, currentShiftId: shift.id }, owner))
  const all = await q(
    "SELECT unit_cost::float8 c, qty::float8 n FROM stock_movements WHERE kind = 'return' AND ref_id = $1 ORDER BY id",
    [item.id]
  )
  assert.deepEqual(all, [
    { c: 11, n: 1 },
    { c: 11, n: 2 }
  ])
  // Five of the first purchase go back to the supplier at 11; the price stays 14.
  const [line] = await q('SELECT id FROM supplier_purchase_items WHERE purchase_id = $1', [
    first.purchaseId
  ])
  const owed = await debt()
  ok(
    await svc.call(
      'suppliers.returnPurchase',
      {
        purchaseId: first.purchaseId,
        items: [{ purchaseItemId: line.id, qty: 5 }],
        clientRef: ref(),
        currentShiftId: shift.id
      },
      owner
    )
  )
  const out = await one(
    "SELECT unit_cost::float8 c, qty::float8 n FROM stock_movements WHERE kind = 'purchase_return' ORDER BY id DESC LIMIT 1"
  )
  assert.deepEqual(out, { c: 11, n: -5 })
  assert.equal(await debt(), r2(owed - 55))
  assert.equal((await product('RET')).c, 14)
})

test('10. valuation, cost of sales and profit follow the same latest price', async (t) => {
  if (!requireDb(t)) return
  const v = ok(await svc.call('inventory.valuation', { search: 'صنف البيع' }, owner))
  const row = v.rows.find((r) => r.barcode === 'SNAP')
  const p = await product('SNAP')
  assert.equal(row.cost, 13)
  assert.equal(r2(row.value_cost), r2(p.s * 13))
  // Profit of today's sales = net − Σ(quantity kept × the line's own cost); never the current price.
  const expected = await one(
    `SELECT COALESCE(SUM(si.total_price - si.line_discount - si.cart_discount - (si.quantity - si.returned_qty) * si.cost_price), 0)::float8 v
       FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.timestamp::date = $1::date`,
    [today()]
  )
  const d = await dash()
  assert.equal(
    r2(d.netProfit),
    r2(expected.v - d.damaged - d.expenses + d.purchaseDiscounts),
    'the dashboard profit is the sale lines with their snapshots'
  )
})

test('12. a product never bought keeps its price', async (t) => {
  if (!requireDb(t)) return
  ok(await buy([{ barcode: 'REP', qty: 1, unitCost: 4.5 }]))
  assert.equal((await product('NOBUY')).c, 17.5)
})

test('13. the same confirmation sent five times at once is recorded once', async (t) => {
  if (!requireDb(t)) return
  const clientRef = ref()
  const owed = await debt()
  const tries = await Promise.all(
    Array.from({ length: 5 }, () =>
      buy([{ barcode: 'RACE', qty: 4, unitCost: 9, newRetailPrice: 13 }], {
        clientRef,
        invoice_ref: 'RACE-1'
      })
    )
  )
  for (const r of tries) ok(r)
  const ids = new Set(tries.map((r) => r.body.purchaseId))
  assert.equal(ids.size, 1)
  assert.equal(tries.filter((r) => r.body.duplicate).length, 4)
  assert.equal(
    (await one("SELECT count(*)::int n FROM supplier_purchases WHERE invoice_ref = 'RACE-1'")).n,
    1
  )
  assert.deepEqual(await product('RACE'), { s: 4, c: 9, r: 13, w: 11 })
  assert.equal(await debt(), r2(owed + 36))
  assert.equal(
    (
      await one(
        "SELECT count(*)::int n FROM system_logs WHERE action_type = 'product_price_change' AND details::jsonb->>'barcode' = 'RACE'"
      )
    ).n,
    1
  )
  // Later, the same request again: still the first purchase.
  const again = ok(
    await buy([{ barcode: 'RACE', qty: 4, unitCost: 9 }], { clientRef, invoice_ref: 'RACE-1' })
  )
  assert.equal(again.purchaseId, [...ids][0])
  assert.equal((await product('RACE')).s, 4)
})

test('11 + 12. migration 0026: latest purchase per product; history, balances and stock untouched', async (t) => {
  if (!requireDb(t)) return
  const fresh = await freshDatabase()
  const pool = createPool(fresh.url, { max: 2 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig26-'))
  const quiet = { info() {} }
  try {
    for (const m of listMigrations().filter((x) => Number(x.version) <= 25))
      fs.copyFileSync(
        path.join(__dirname, '../../src/server/db/migrations', `${m.name}.sql`),
        path.join(tmp, `${m.name}.sql`)
      )
    await migrate(pool, { dir: tmp, logger: quiet })
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SELECT set_config('hm.bulk_load', 'on', true)")
      await c.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
      await c.query(`INSERT INTO users (id, username, role) VALUES (1, 'a', 'cashier')`)
      // Averages as 1.5.1 left them: A 206.6667 after 200 then 220; B a carton at 120 (24 pieces)
      // after loose 4.5; C bought the same second twice (the later line wins); N never bought;
      // Z bought free only.
      await c.query(`INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES
        ('A', 'رومي', 206.6667, 260, 240, 15, 'كيلو'), ('B', 'عصير', 4.8, 6, 5.5, 60, 'قطعة'),
        ('C', 'سكر', 21, 25, 24, 30, 'كيلو'), ('N', 'لم يشتر', 17.5, 25, 23, 3, 'قطعة'),
        ('Z', 'صفر', 0, 5, 4, 2, 'قطعة')`)
      await c.query(`INSERT INTO suppliers (id, name, debt_balance) VALUES (1, 'مورد', 4910)`)
      await c.query(`INSERT INTO supplier_purchases (id, supplier_id, invoice_ref, total_amount, paid_amount, remaining, payment_type, timestamp) VALUES
        (1, 1, 'P1', 2000, 0, 2000, 'آجل', '2026-09-01 10:00'), (2, 1, 'P2', 1100, 0, 1100, 'آجل', '2026-09-20 10:00'),
        (3, 1, 'P3', 1770, 0, 1770, 'آجل', '2026-09-25 10:00'), (4, 1, 'P4', 40, 0, 40, 'آجل', '2026-09-25 10:00')`)
      await c.query(`INSERT INTO supplier_purchase_items (id, purchase_id, product_barcode, qty, unit_cost, line_total, unit_factor) VALUES
        (1, 1, 'A', 10, 200, 2000, 1), (2, 2, 'A', 5, 220, 1100, 1),
        (3, 1, 'B', 10, 4.5, 45, 1), (4, 3, 'B', 2, 120, 240, 24),
        (5, 3, 'C', 10, 20, 200, 1), (6, 3, 'C', 10, 22, 220, 1), (7, 4, 'C', 2, 20, 40, 1),
        (8, 3, 'Z', 2, 0, 0, 1), (9, 4, 'A', 1, 0, 0, 1)`)
      await c.query(`INSERT INTO shifts (id, user_id, start_time, end_time, initial_cash, status)
        VALUES (1, 1, '2026-10-01 08:00', '2026-10-01 20:00', 0, 'closed')`)
      await c.query(`INSERT INTO sales (id, shift_id, user_id, timestamp, total_amount, original_amount, discount, payment_type)
        VALUES (1, 1, 1, '2026-10-01 09:00', 1285, 1285, 0, 'نقدي')`)
      // A line with its cost (kept), two without (frozen at the price the reports used), a box line.
      await c.query(`INSERT INTO sale_items (id, sale_id, product_barcode, quantity, unit_price, total_price, cost_price, unit_factor) VALUES
        (1, 1, 'A', 2, 260, 520, 205, 1), (2, 1, 'A', 2, 260, 520, 0, 1),
        (3, 1, 'B', 1, 140, 140, NULL, 24), (4, 1, 'N', 4, 25, 100, 0, 1), (5, 1, 'Z', 1, 5, 5, 0, 1)`)
      await c.query(
        `INSERT INTO system_logs (action_type, description, timestamp) VALUES ('x', 'سجل قديم', '2026-10-01 09:00')`
      )
      await c.query("SELECT hm_post_opening_balances('test seed')")
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    const fingerprint = async () =>
      (
        await pool.query(`SELECT
          (SELECT json_agg(json_build_object('b', barcode, 's', stock_qty::text, 'r', retail_price::text, 'w', wholesale_price::text) ORDER BY barcode) FROM products) AS products,
          (SELECT json_agg(json_build_object('id', id, 't', total_amount::text) ORDER BY id) FROM sales) AS sales,
          (SELECT json_agg(json_build_object('id', id, 'q', quantity::text, 'p', total_price::text) ORDER BY id) FROM sale_items) AS lines,
          (SELECT json_agg(json_build_object('id', id, 'c', unit_cost::text) ORDER BY id) FROM supplier_purchase_items) AS bought,
          (SELECT json_agg(debt_balance::text) FROM suppliers) AS debt,
          (SELECT count(*) FROM system_logs) AS logs,
          (SELECT count(*) FROM stock_movements) AS moves`)
      ).rows[0]
    const before = await fingerprint()
    await migrate(pool, { logger: quiet })
    assert.deepEqual(
      await fingerprint(),
      before,
      'nothing but purchase prices and empty line costs'
    )
    const costs = Object.fromEntries(
      (await pool.query('SELECT barcode, cost_price::float8 c FROM products')).rows.map((r) => [
        r.barcode,
        r.c
      ])
    )
    // A: the latest purchase, 220 (not 206.67). B: the carton 120 ÷ 24 = 5. C: the latest by time,
    // then the later purchase (P4, 20). A free line (A in P4) does not count. N: never bought,
    // keeps 17.5. Z: bought only free, keeps 0.
    assert.deepEqual(costs, { A: 220, B: 5, C: 20, N: 17.5, Z: 0 })
    const lines = (
      await pool.query('SELECT id, cost_price::float8 c FROM sale_items ORDER BY id')
    ).rows.map((r) => r.c)
    // Line 1 keeps 205; 2 and 3 get the price the reports used for them (206.6667, 4.8 × 24);
    // N's line is frozen at 17.5; Z had no price at all and stays 0.
    assert.deepEqual(lines, [205, 206.6667, 115.2, 17.5, 0])
    const backfill = (
      await pool.query(
        'SELECT sale_item_id id, old_cost::float8 o, cost::float8 c FROM sale_item_cost_backfill ORDER BY 1'
      )
    ).rows
    assert.deepEqual(backfill, [
      { id: 2, o: 0, c: 206.6667 },
      { id: 3, o: null, c: 115.2 },
      { id: 4, o: 0, c: 17.5 }
    ])
    const record = (
      await pool.query(
        'SELECT barcode, old_cost::float8 o, new_cost::float8 n, purchase_id p, purchase_item_id i FROM product_cost_migration ORDER BY barcode'
      )
    ).rows
    assert.deepEqual(record, [
      { barcode: 'A', o: 206.6667, n: 220, p: 2, i: 2 },
      { barcode: 'B', o: 4.8, n: 5, p: 3, i: 4 },
      { barcode: 'C', o: 21, n: 20, p: 4, i: 7 }
    ])
  } finally {
    await pool.end()
    await fresh.dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
