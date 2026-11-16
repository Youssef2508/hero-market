'use strict'
// Correcting a recorded purchase invoice (owner, 1.8.0, D-112): the owner's examples, each followed
// through the supplier's balance and ledger, the payments, the stock and its ledger, the purchase
// price, the sales and the invoice's own history. And the global invoice list with its filters,
// and corrections of a preliminary invoice that has no lines yet.
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
const { verifyLedger } = require('../../src/server/inventory/stock')

let db, svc, owner, keeper, cashier, shift
const ref = () => crypto.randomUUID()
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const num = async (sql, p) => Number(Object.values(await one(sql, p))[0])
const ok = (r, what = '') => {
  assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`)
  return r.body
}
const call = (op, body, who = owner) => svc.call(op, body, who)

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'keeper', pin: '4826', roleKey: 'inventory' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  keeper = await login(svc, '4826')
  cashier = await login(svc, '5173')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES
     ('A', 'أرز', 20, 40, 0, 'كيس'), ('B', 'سكر', 25, 45, 0, 'كيس'), ('C', 'زيت', 50, 80, 0, 'زجاجة'),
     ('D', 'شاي', 30, 50, 0, 'علبة'), ('E', 'بن', 100, 150, 0, 'كيس'), ('F', 'دقيق', 15, 25, 0, 'كيس')`
  )
  shift = ok(await call('shifts.open', { startingCash: 1000 }, cashier))
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

/** A supplier of its own and one recorded invoice: 100 × A at 30 = 3,000, `paid` paid with it. */
async function invoice({ name, paid = 0, items, total } = {}) {
  const supplierId = ok(await call('suppliers.create', { name })).id
  const lines = items || [{ barcode: 'A', qty: 100, unitCost: 30 }]
  const t = total ?? lines.reduce((a, l) => a + l.qty * l.unitCost, 0)
  const p = ok(
    await call('suppliers.addPurchase', {
      supplierId,
      invoice_ref: `INV-${name}`,
      total_amount: t,
      paid_amount: paid,
      payment_type: paid >= t ? 'نقدي' : paid > 0 ? 'دفع جزئي' : 'آجل',
      clientRef: ref(),
      items: lines
    })
  )
  return { supplierId, purchaseId: p.purchaseId }
}
const detail = async (purchaseId) =>
  ok(await call('suppliers.purchaseDetail', { purchaseId })).items.map((i) => ({
    itemId: i.id,
    barcode: i.barcode,
    unitId: null,
    qty: i.qty,
    unitCost: i.unit_cost
  }))
const balance = (supplierId) =>
  num('SELECT debt_balance FROM suppliers WHERE id = $1', [supplierId])
const stock = (b) => num('SELECT stock_qty FROM products WHERE barcode = $1', [b])
const cost = (b) => num('SELECT cost_price FROM products WHERE barcode = $1', [b])
const money = async () => ({
  treasury: await num('SELECT COALESCE(SUM(amount), 0) FROM treasury_ledger'),
  drawer: await num('SELECT COALESCE(SUM(amount), 0) FROM safe_ledger'),
  payments: await num("SELECT count(*) FROM supplier_ledger WHERE type = 'payment'")
})
async function revise(purchaseId, items, extra = {}) {
  const rev = Number(
    (await one('SELECT revision FROM supplier_purchases WHERE id = $1', [purchaseId])).revision
  )
  const body = { purchaseId, expectedRevision: rev, items, ...extra }
  const preview = ok(await call('suppliers.previewRevision', body), 'preview')
  const saved = ok(await call('suppliers.revisePurchase', { ...body, clientRef: ref() }), 'save')
  return { preview, saved }
}

test('3,000 → 3,500: the supplier is owed 500 more, once; the stock follows; history kept', async (t) => {
  if (!requireDb(t)) return
  const { supplierId, purchaseId } = await invoice({ name: 'زيادة' })
  assert.equal(await balance(supplierId), 3000)
  const stockBefore = await stock('A')
  const before = await money()
  const lines = await detail(purchaseId)
  const { preview, saved } = await revise(purchaseId, [{ ...lines[0], qty: 100, unitCost: 35 }], {
    reason: 'السعر الفعلي 35'
  })
  // The preview shows exactly what saving did, and wrote nothing itself (one revision only).
  for (const k of [
    'oldTotal',
    'newTotal',
    'delta',
    'supplierBalanceBefore',
    'supplierBalanceAfter'
  ])
    assert.equal(preview[k], saved[k], k)
  assert.deepEqual(preview.costChanges, saved.costChanges)
  assert.equal(saved.delta, 500)
  assert.equal(saved.supplierBalanceAfter, 3500)
  assert.equal(await balance(supplierId), 3500)
  assert.equal(
    await num('SELECT count(*) FROM supplier_purchase_revisions WHERE purchase_id = $1', [
      purchaseId
    ]),
    1
  )
  // One explicit ledger row of +500; no payment, cash or drawer movement.
  const adj = await q(
    "SELECT amount::float8 AS a FROM supplier_ledger WHERE supplier_id = $1 AND type = 'adjustment'",
    [supplierId]
  )
  assert.deepEqual(adj, [{ a: 500 }])
  assert.deepEqual(await money(), before)
  // Same quantity: the stock is unchanged; the price is the corrected one (the latest purchase).
  assert.equal(await stock('A'), stockBefore)
  assert.equal(await cost('A'), 35)
  const p = await one(
    'SELECT total_amount::float8 t, remaining::float8 r, revision FROM supplier_purchases WHERE id = $1',
    [purchaseId]
  )
  assert.deepEqual(p, { t: 3500, r: 3500, revision: 1 })
  const history = ok(await call('suppliers.purchaseRevisions', { purchaseId }))
  assert.equal(history.length, 1)
  assert.equal(history[0].reason, 'السعر الفعلي 35')
  assert.equal(history[0].oldLines[0].unitCost, 30)
  assert.equal(history[0].newLines[0].unitCost, 35)
  assert.match(
    (
      await one(
        "SELECT description FROM system_logs WHERE action_type = 'supplier_purchase_revise' ORDER BY id DESC LIMIT 1"
      )
    ).description,
    /3500\.00 بدل 3000\.00/
  )
})

test('3,000 → 2,500 (a line removed, quantities lowered): the payable falls by 500; stock leaves', async (t) => {
  if (!requireDb(t)) return
  const { supplierId, purchaseId } = await invoice({
    name: 'نقص',
    items: [
      { barcode: 'B', qty: 80, unitCost: 25 },
      { barcode: 'C', qty: 20, unitCost: 50 }
    ]
  })
  const lines = await detail(purchaseId)
  const b0 = await stock('B')
  const c0 = await stock('C')
  // C was never delivered; B is 100 not 80.
  const { saved } = await revise(purchaseId, [{ ...lines[0], qty: 100 }])
  assert.equal(saved.newTotal, 2500)
  assert.equal(saved.delta, -500)
  assert.equal(await balance(supplierId), 2500)
  assert.equal(await stock('B'), b0 + 20)
  assert.equal(await stock('C'), c0 - 20)
  const kinds = await q(
    "SELECT product_barcode b, qty::float8 q FROM stock_movements WHERE kind = 'purchase_correction' AND ref_id = $1 ORDER BY 1",
    [purchaseId]
  )
  assert.deepEqual(kinds, [
    { b: 'B', q: 20 },
    { b: 'C', q: -20 }
  ])
  assert.deepEqual(await verifyLedger(svc.pool), [])
  assert.equal(
    await num('SELECT count(*) FROM supplier_purchase_items WHERE purchase_id = $1', [purchaseId]),
    1
  )
})

test('partly paid (1,000 of 3,000) then corrected to 2,500: 1,500 still owed, the payment untouched', async (t) => {
  if (!requireDb(t)) return
  const { supplierId, purchaseId } = await invoice({ name: 'جزئي', paid: 1000 })
  assert.equal(await balance(supplierId), 2000)
  const before = await money()
  const lines = await detail(purchaseId)
  const { saved } = await revise(purchaseId, [{ ...lines[0], qty: 100, unitCost: 25 }])
  assert.equal(saved.outstanding, 1500)
  assert.equal(await balance(supplierId), 1500)
  assert.deepEqual(await money(), before)
  const p = await one(
    'SELECT paid_amount::float8 p, remaining::float8 r FROM supplier_purchases WHERE id = $1',
    [purchaseId]
  )
  assert.deepEqual(p, { p: 1000, r: 1500 })
})

test('fully paid (3,000) then corrected to 2,500: the supplier owes the store 500', async (t) => {
  if (!requireDb(t)) return
  const { supplierId, purchaseId } = await invoice({ name: 'مدفوع', paid: 3000 })
  assert.equal(await balance(supplierId), 0)
  const lines = await detail(purchaseId)
  const { saved } = await revise(purchaseId, [{ ...lines[0], qty: 100, unitCost: 25 }])
  assert.equal(saved.outstanding, -500)
  assert.equal(await balance(supplierId), -500, 'below zero: the supplier owes the store')
  const p = await one(
    'SELECT paid_amount::float8 p, remaining::float8 r FROM supplier_purchases WHERE id = $1',
    [purchaseId]
  )
  assert.deepEqual(p, { p: 3000, r: -500 })
})

test('corrected below what was paid (paid 3,000, now 2,000) after a later payment: a credit of 1,000', async (t) => {
  if (!requireDb(t)) return
  const { supplierId, purchaseId } = await invoice({ name: 'دائن', paid: 2000 })
  ok(
    await call('suppliers.repay', {
      supplierId,
      amount: 1000,
      destination: 'treasury',
      clientRef: ref()
    })
  )
  assert.equal(await balance(supplierId), 0)
  const lines = await detail(purchaseId)
  const { saved } = await revise(purchaseId, [{ ...lines[0], qty: 80, unitCost: 25 }])
  assert.equal(saved.newTotal, 2000)
  assert.equal(await balance(supplierId), -1000)
})

test('a product replaced: A leaves, D arrives, at its price; A’s price goes back to its previous purchase', async (t) => {
  if (!requireDb(t)) return
  // An earlier purchase of E at 90, then this invoice of E at 100 (so E's price is 100).
  const first = await invoice({ name: 'سابق', items: [{ barcode: 'E', qty: 5, unitCost: 90 }] })
  void first
  const { supplierId, purchaseId } = await invoice({
    name: 'استبدال',
    items: [{ barcode: 'E', qty: 10, unitCost: 100 }]
  })
  assert.equal(await cost('E'), 100)
  const e0 = await stock('E')
  const d0 = await stock('D')
  const lines = await detail(purchaseId)
  // The supplier delivered tea (D) at 100, not coffee (E).
  const { saved } = await revise(purchaseId, [{ ...lines[0], barcode: 'D', unitCost: 100 }])
  assert.equal(saved.delta, 0)
  assert.equal(await balance(supplierId), 1000)
  assert.equal(await stock('E'), e0 - 10)
  assert.equal(await stock('D'), d0 + 10)
  assert.equal(await cost('D'), 100, 'D takes the invoice’s price')
  assert.equal(await cost('E'), 90, 'E goes back to its purchase before this one')
  const sc = Object.fromEntries(saved.stockChanges.map((s) => [s.barcode, s.change]))
  assert.deepEqual(sc, { D: 10, E: -10 })
  assert.deepEqual(await verifyLedger(svc.pool), [])
})

test('a quantity corrected after some were sold: sales untouched, stock may go below zero, shown', async (t) => {
  if (!requireDb(t)) return
  const f0 = await stock('F')
  const { supplierId, purchaseId } = await invoice({
    name: 'مباع',
    items: [{ barcode: 'F', qty: 10, unitCost: 15 }]
  })
  const sale = ok(
    await call(
      'pos.checkout',
      {
        clientRef: ref(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'F', qty: 7 }]
      },
      cashier
    )
  )
  const saleLine = await one(
    'SELECT cost_price::float8 c, quantity::float8 q FROM sale_items WHERE sale_id = $1',
    [sale.saleId]
  )
  const lines = await detail(purchaseId)
  // Only 5 were delivered.
  const preview = ok(
    await call('suppliers.previewRevision', {
      purchaseId,
      expectedRevision: 0,
      items: [{ ...lines[0], qty: 5 }]
    })
  )
  assert.equal(preview.stockChanges[0].after, f0 + 10 - 7 - 5)
  assert.deepEqual(preview.soldSince, [{ barcode: 'F', name: 'دقيق', qty: 7 }])
  // The preview changed nothing.
  assert.equal(await stock('F'), f0 + 3)
  ok(
    await call('suppliers.revisePurchase', {
      purchaseId,
      expectedRevision: 0,
      items: [{ ...lines[0], qty: 5 }],
      clientRef: ref()
    })
  )
  assert.equal(await stock('F'), f0 - 2)
  assert.equal(await balance(supplierId), 75)
  // The sale keeps its quantity and the cost recorded when it was made.
  assert.deepEqual(
    await one(
      'SELECT cost_price::float8 c, quantity::float8 q FROM sale_items WHERE sale_id = $1',
      [sale.saleId]
    ),
    saleLine
  )
  assert.deepEqual(await verifyLedger(svc.pool), [])
})

test('a stale screen, a retry and two corrections at once: each correction applies exactly once', async (t) => {
  if (!requireDb(t)) return
  const { supplierId, purchaseId } = await invoice({ name: 'تزامن' })
  const lines = await detail(purchaseId)
  const body = (unitCost) => ({
    purchaseId,
    expectedRevision: 0,
    items: [{ ...lines[0], unitCost }],
    clientRef: ref()
  })
  const a = body(31)
  const [r1, r2] = await Promise.all([
    call('suppliers.revisePurchase', a),
    call('suppliers.revisePurchase', body(33))
  ])
  const statuses = [r1.status, r2.status].sort()
  assert.deepEqual(statuses, [200, 409], 'one wins; the other was prepared on the old revision')
  const loser = r1.status === 409 ? r1 : r2
  assert.equal(loser.body.error.code, 'conflict')
  assert.equal(loser.body.error.details.code, 'purchase_changed')
  const winner = r1.status === 200 ? 31 : 33
  assert.equal(await balance(supplierId), 100 * winner)
  // The same request again (a lost answer): the first result, nothing applied twice.
  if (r1.status === 200) {
    const again = ok(await call('suppliers.revisePurchase', a))
    assert.equal(again.duplicate, true)
  }
  assert.equal(await balance(supplierId), 100 * winner)
  assert.equal(
    await num('SELECT count(*) FROM supplier_purchase_revisions WHERE purchase_id = $1', [
      purchaseId
    ]),
    1
  )
})

test('returns limit a correction; refused corrections change nothing; permission required', async (t) => {
  if (!requireDb(t)) return
  const { supplierId, purchaseId } = await invoice({ name: 'مرتجع' })
  const lines = await detail(purchaseId)
  ok(
    await call('suppliers.returnPurchase', {
      purchaseId,
      items: [{ purchaseItemId: lines[0].itemId, qty: 40 }],
      clientRef: ref()
    })
  )
  const snapshot = async () => ({
    balance: await balance(supplierId),
    stock: await stock('A'),
    cost: await cost('A'),
    movements: await num('SELECT count(*) FROM stock_movements'),
    revisions: await num('SELECT count(*) FROM supplier_purchase_revisions')
  })
  const before = await snapshot()
  const refuse = async (items, what) => {
    const r = await call('suppliers.revisePurchase', {
      purchaseId,
      expectedRevision: 0,
      items,
      clientRef: ref()
    })
    assert.equal(r.status, 409, `${what}: ${JSON.stringify(r.body)}`)
  }
  await refuse([{ ...lines[0], qty: 30 }], 'below what was returned')
  await refuse([{ ...lines[0], barcode: 'B' }], 'the product of a line with returns')
  await refuse([{ barcode: 'B', qty: 10, unitCost: 25 }], 'removing a line with returns')
  // Without the permission: an inventory keeper manages suppliers but does not correct invoices.
  const denied = await call(
    'suppliers.revisePurchase',
    { purchaseId, expectedRevision: 0, items: [{ ...lines[0], qty: 90 }], clientRef: ref() },
    keeper
  )
  assert.equal(denied.status, 403)
  const stale = await call('suppliers.revisePurchase', {
    purchaseId,
    expectedRevision: 5,
    items: [{ ...lines[0], qty: 90 }],
    clientRef: ref()
  })
  assert.equal(stale.status, 409)
  assert.deepEqual(await snapshot(), before)
  // Allowed: down to what was returned, at its price; the returns' credit stands.
  const ok90 = ok(
    await call('suppliers.revisePurchase', {
      purchaseId,
      expectedRevision: 0,
      items: [{ ...lines[0], qty: 90 }],
      clientRef: ref()
    })
  )
  assert.equal(ok90.newTotal, 2700)
  assert.equal(ok90.credited, 1200)
  assert.equal(ok90.outstanding, 1500)
  assert.equal(await balance(supplierId), 3000 - 1200 - 300)
})

test('the list of every supplier’s invoices: today by default, inclusive dates, filters, pages', async (t) => {
  if (!requireDb(t)) return
  const s1 = await invoice({
    name: 'قائمة 1',
    paid: 0,
    items: [{ barcode: 'A', qty: 1, unitCost: 10 }]
  })
  const s2 = await invoice({
    name: 'قائمة 2',
    paid: 10,
    items: [{ barcode: 'A', qty: 1, unitCost: 10 }]
  })
  const s3 = await invoice({
    name: 'قائمة 3',
    paid: 4,
    items: [{ barcode: 'A', qty: 1, unitCost: 10 }]
  })
  // One from three days ago and one from yesterday's last second.
  await svc.pool.query(
    "UPDATE supplier_purchases SET timestamp = date_trunc('day', LOCALTIMESTAMP) - interval '3 days' + interval '10 hours' WHERE id = $1",
    [s1.purchaseId]
  )
  await svc.pool.query(
    "UPDATE supplier_purchases SET timestamp = date_trunc('day', LOCALTIMESTAMP) - interval '1 second' WHERE id = $1",
    [s2.purchaseId]
  )
  const page = async (f) => ok(await call('suppliers.purchasesPage', f))
  const today = await page({})
  const ids = today.rows.map((r) => r.id)
  assert.ok(ids.includes(s3.purchaseId))
  assert.ok(!ids.includes(s1.purchaseId) && !ids.includes(s2.purchaseId), 'only today')
  assert.equal(today.filters.from, today.today)
  // Newest first.
  const times = today.rows.map((r) => r.timestamp)
  assert.deepEqual(times, [...times].sort().reverse())
  const day = (n) =>
    new Date(Date.parse(`${today.today}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10)
  // Yesterday only: the last second of yesterday is in, today is out.
  const y = await page({ from: day(1), to: day(1) })
  assert.deepEqual(
    y.rows.map((r) => r.id),
    [s2.purchaseId]
  )
  // The whole history, one supplier.
  const all = await page({ from: null, to: null, supplierId: s1.supplierId })
  assert.deepEqual(
    all.rows.map((r) => r.id),
    [s1.purchaseId]
  )
  // Payment state, number search, revised.
  const credit = await page({ from: null, to: null, payment: 'credit' })
  assert.ok(credit.rows.every((r) => r.paid_amount === 0))
  const partial = await page({ from: null, to: null, payment: 'partial' })
  assert.ok(partial.rows.some((r) => r.id === s3.purchaseId))
  assert.ok(partial.rows.every((r) => r.payment_state === 'partial'))
  const found = await page({ from: null, to: null, search: 'INV-قائمة 2' })
  assert.deepEqual(
    found.rows.map((r) => r.id),
    [s2.purchaseId]
  )
  const byNumber = await page({ from: null, to: null, search: `#${s3.purchaseId}` })
  assert.ok(byNumber.rows.some((r) => r.id === s3.purchaseId))
  const revised = await page({ from: null, to: null, revised: true })
  assert.ok(revised.rows.length > 0 && revised.rows.every((r) => r.revision > 0))
  // Pages of 50 with the totals of the whole selection.
  const everything = await page({ from: null, to: null })
  assert.equal(everything.count, await num('SELECT count(*) FROM supplier_purchases'))
  assert.ok(everything.rows.length <= everything.perPage)
  // Only those who see suppliers.
  assert.equal((await call('suppliers.purchasesPage', {}, cashier)).status, 403)
})

test('a preliminary invoice without lines: its total corrected up or down, the payment kept', async (t) => {
  if (!requireDb(t)) return
  const supplierId = ok(await call('suppliers.create', { name: 'مبدئي' })).id
  const inv = ok(
    await call(
      'supplierInvoices.createPending',
      {
        supplierId,
        total: 3000,
        paymentMode: 'partial',
        paid: 1000,
        currentShiftId: shift.id,
        clientRef: ref()
      },
      cashier
    )
  ).invoice
  assert.equal(await balance(supplierId), 2000)
  const drawer = await num('SELECT COALESCE(SUM(amount), 0) FROM safe_ledger')
  const down = ok(await call('supplierInvoices.updatePending', { invoiceId: inv.id, total: 2500 }))
  assert.equal(down.delta, -500)
  assert.equal(await balance(supplierId), 1500)
  const up = ok(await call('supplierInvoices.updatePending', { invoiceId: inv.id, total: 3200 }))
  assert.equal(up.delta, 700)
  assert.equal(await balance(supplierId), 2200)
  // Below what was paid with it: refused – the delivery is completed with its lines instead.
  const below = await call('supplierInvoices.updatePending', { invoiceId: inv.id, total: 800 })
  assert.equal(below.status, 400)
  assert.equal(await balance(supplierId), 2200)
  assert.equal(await num('SELECT COALESCE(SUM(amount), 0) FROM safe_ledger'), drawer)
  assert.equal(
    await num(
      "SELECT count(*) FROM supplier_ledger WHERE supplier_id = $1 AND type = 'adjustment'",
      [supplierId]
    ),
    2
  )
  // Completed with its lines at 800 – less than the 1,000 paid with it (refused before 1.8.0): the
  // payable follows the detailed invoice, and the supplier owes the store 200.
  const done = ok(
    await call('supplierInvoices.convert', {
      invoiceId: inv.id,
      items: [{ barcode: 'A', qty: 40, unitCost: 20 }],
      clientRef: ref()
    })
  )
  assert.equal(done.difference, -2400)
  assert.equal(await balance(supplierId), -200)
  const conv = await one(
    'SELECT total_amount::float8 t, paid_amount::float8 p, remaining::float8 r FROM supplier_purchases WHERE id = $1',
    [done.purchaseId]
  )
  assert.deepEqual(conv, { t: 800, p: 1000, r: -200 })
  const again = await call('supplierInvoices.updatePending', { invoiceId: inv.id, total: 900 })
  assert.equal(again.status, 409, 'a completed one is corrected as a purchase')
  assert.equal(
    (await call('supplierInvoices.updatePending', { invoiceId: inv.id, total: 900 }, cashier))
      .status,
    403
  )
})
