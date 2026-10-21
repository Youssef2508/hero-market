'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts,
  passwordFor
} = require('./helpers')

let db, svc, cashier, inventoryUser, admin, shift
const ref = () => crypto.randomUUID()
const q = async (sql, params) => (await svc.pool.query(sql, params)).rows

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'cashier1', pin: '1111', roleKey: 'cashier' })
  await createUser(svc, { username: 'stock1', pin: '2222', roleKey: 'inventory' })
  await createUser(svc, { username: 'super1', pin: '3333', roleKey: 'manager' })
  await createUser(svc, { username: 'owner1', pin: '4444', roleKey: 'super_admin' })
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, reorder_limit, unit, category) VALUES
    ('A1', 'منتج أ', 8, 10.5, 9, 100, 5, 'قطعة', 'عام'),
    ('B2', 'منتج ب', 2, 3.25, 3, 5, 1, 'قطعة', 'عام'),
    ('C3', 'جبنة', 150, 200, 190, 1.5, 0.5, 'كجم', 'ألبان')`
  )
  cashier = await login(svc, '1111')
  inventoryUser = await login(svc, '2222')
  admin = await login(svc, '4444')
  shift = (await svc.call('shifts.open', { startingCash: 200 }, cashier)).body
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('permissions: inventory role cannot sell or open a shift; cashier cannot enter multi-till floats', async (t) => {
  if (!requireDb(t)) return
  assert.equal((await svc.call('shifts.open', { startingCash: 100 }, inventoryUser)).status, 403)
  assert.equal((await svc.call('pos.searchProducts', { term: 'منتج' }, inventoryUser)).status, 403)
  assert.equal(
    (await svc.call('shifts.open', { startingCash: 1, momknStartBalance: 50 }, cashier)).status,
    403
  )
  assert.equal(shift.status, 'open')
  assert.equal(Number(shift.initial_cash), 200)
})

test('cash sale: server prices, items linked to their sale, stock deducted, user recorded', async (t) => {
  if (!requireDb(t)) return
  const r = await svc.call(
    'pos.checkout',
    {
      clientRef: ref(),
      shiftId: shift.id,
      paymentType: 'نقدي',
      paidAmount: 50,
      items: [
        { barcode: 'A1', qty: 2, unitPrice: 10.5 },
        { barcode: 'B2', qty: 3, unitPrice: 3.25 }
      ]
    },
    cashier
  )
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.subTotal, 30.75)
  assert.equal(r.body.total, 30.75)
  assert.equal(r.body.change, 19.25)
  const sale = (await q('SELECT * FROM sales WHERE id = $1', [r.body.saleId]))[0]
  assert.equal(Number(sale.total_amount), 30.75)
  assert.equal(Number(sale.original_amount), 30.75)
  assert.ok(sale.user_id, 'cashier recorded on the sale')
  const items = await q(
    'SELECT product_barcode, quantity, unit_price, total_price, cost_price FROM sale_items WHERE sale_id = $1 ORDER BY product_barcode',
    [r.body.saleId]
  )
  assert.deepEqual(
    items.map((i) => [
      i.product_barcode,
      Number(i.quantity),
      Number(i.total_price),
      Number(i.cost_price)
    ]),
    [
      ['A1', 2, 21, 8],
      ['B2', 3, 9.75, 2]
    ]
  )
  assert.equal(
    Number((await q("SELECT stock_qty FROM products WHERE barcode = 'B2'"))[0].stock_qty),
    2
  )
  const log = await q("SELECT * FROM system_logs WHERE action_type = 'checkout_sale'")
  assert.equal(log.length, 1)
})

test('retrying the same checkout returns the same sale and does not deduct stock twice', async (t) => {
  if (!requireDb(t)) return
  const key = ref()
  const body = {
    clientRef: key,
    shiftId: shift.id,
    paymentType: 'نقدي',
    items: [{ barcode: 'A1', qty: 1, unitPrice: 10.5 }]
  }
  const before = Number(
    (await q("SELECT stock_qty FROM products WHERE barcode = 'A1'"))[0].stock_qty
  )
  const [a, b] = await Promise.all([
    svc.call('pos.checkout', body, cashier),
    svc.call('pos.checkout', body, cashier)
  ])
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.equal(a.body.saleId, b.body.saleId)
  assert.equal(
    Number((await q("SELECT stock_qty FROM products WHERE barcode = 'A1'"))[0].stock_qty),
    before - 1
  )
  assert.equal(
    (await q('SELECT count(*)::int AS n FROM sales WHERE client_ref = $1', [key]))[0].n,
    1
  )
})

test('checkout status: tells a till whether an attempt whose reply was lost was recorded', async (t) => {
  if (!requireDb(t)) return
  const key = ref()
  const unknown = await svc.call('pos.checkoutStatus', { clientRef: key }, cashier)
  assert.equal(unknown.status, 200)
  assert.deepEqual(unknown.body, { recorded: false })
  const sale = await svc.call(
    'pos.checkout',
    {
      clientRef: key,
      shiftId: shift.id,
      paymentType: 'نقدي',
      items: [{ barcode: 'A1', qty: 1, unitPrice: 10.5 }]
    },
    cashier
  )
  assert.equal(sale.status, 200)
  const known = await svc.call('pos.checkoutStatus', { clientRef: key }, cashier)
  assert.deepEqual(known.body, { recorded: true, saleId: sale.body.saleId, total: 10.5 })
  // Only users who may sell can ask.
  assert.equal(
    (await svc.call('pos.checkoutStatus', { clientRef: key }, inventoryUser)).status,
    403
  )
})

test('a tampered or stale price is refused and nothing is written', async (t) => {
  if (!requireDb(t)) return
  const salesBefore = (await q('SELECT count(*)::int AS n FROM sales'))[0].n
  const r = await svc.call(
    'pos.checkout',
    {
      clientRef: ref(),
      shiftId: shift.id,
      paymentType: 'نقدي',
      items: [{ barcode: 'A1', qty: 1, unitPrice: 0.01 }]
    },
    cashier
  )
  assert.equal(r.status, 409)
  assert.match(r.body.error.message, /تغيّر سعر الصنف/)
  assert.equal((await q('SELECT count(*)::int AS n FROM sales'))[0].n, salesBefore)
})

// Owner decision (2026-10-14): selling more than the recorded stock is allowed; stock goes negative.
test('selling more than the recorded stock is allowed: stock goes negative and the ledger records it', async (t) => {
  if (!requireDb(t)) return
  const c3 = Number((await q("SELECT stock_qty FROM products WHERE barcode = 'C3'"))[0].stock_qty)
  const r = await svc.call(
    'pos.checkout',
    {
      clientRef: ref(),
      shiftId: shift.id,
      paymentType: 'نقدي',
      items: [{ barcode: 'C3', qty: c3 + 0.5 }]
    },
    cashier
  )
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const after = Number(
    (await q("SELECT stock_qty FROM products WHERE barcode = 'C3'"))[0].stock_qty
  )
  assert.equal(after, -0.5)
  const mv = await q(
    "SELECT qty, kind, balance_after, ref_type, ref_id FROM stock_movements WHERE product_barcode = 'C3' ORDER BY id DESC LIMIT 1"
  )
  assert.deepEqual(
    mv.map((m) => [Number(m.qty), m.kind, Number(m.balance_after), m.ref_type, m.ref_id]),
    [[-(c3 + 0.5), 'sale', -0.5, 'sale', r.body.saleId]]
  )
})

test('a failing line still rolls the whole sale back: no sale, no stock change, no movement', async (t) => {
  if (!requireDb(t)) return
  const salesBefore = (await q('SELECT count(*)::int AS n FROM sales'))[0].n
  const movesBefore = (await q('SELECT count(*)::int AS n FROM stock_movements'))[0].n
  const a1 = Number((await q("SELECT stock_qty FROM products WHERE barcode = 'A1'"))[0].stock_qty)
  const r = await svc.call(
    'pos.checkout',
    {
      clientRef: ref(),
      shiftId: shift.id,
      paymentType: 'نقدي',
      items: [
        { barcode: 'A1', qty: 1 },
        { barcode: 'NOPE', qty: 1 }
      ]
    },
    cashier
  )
  assert.equal(r.status, 404)
  assert.equal((await q('SELECT count(*)::int AS n FROM sales'))[0].n, salesBefore)
  assert.equal((await q('SELECT count(*)::int AS n FROM stock_movements'))[0].n, movesBefore)
  assert.equal(
    Number((await q("SELECT stock_qty FROM products WHERE barcode = 'A1'"))[0].stock_qty),
    a1,
    'first line rolled back too'
  )
})

test('credit sale needs a customer; a new customer is created in the same transaction', async (t) => {
  if (!requireDb(t)) return
  const noClient = await svc.call(
    'pos.checkout',
    { clientRef: ref(), shiftId: shift.id, paymentType: 'آجل', items: [{ barcode: 'A1', qty: 1 }] },
    cashier
  )
  assert.equal(noClient.status, 400)
  const r = await svc.call(
    'pos.checkout',
    {
      clientRef: ref(),
      shiftId: shift.id,
      paymentType: 'آجل',
      items: [{ barcode: 'A1', qty: 20 }],
      client: { name: 'عميل جديد', phone: '01000000100', address: 'شارع' }
    },
    cashier
  )
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const client = (await q('SELECT * FROM clients WHERE id = $1', [r.body.clientId]))[0]
  assert.equal(Number(client.debt_balance), 210)
  assert.equal(client.points, 2, 'one point per 100 EGP')
  const ledger = await q(
    'SELECT type, amount, description FROM client_ledger WHERE client_id = $1',
    [client.id]
  )
  assert.deepEqual(
    ledger.map((l) => [l.type, Number(l.amount), l.description]),
    [['sale', 210, `شراء آجل فاتورة رقم #${r.body.saleId}`]]
  )
})

// Owner decision (2026-10-15): no operator grants discounts; only the administrator's rules apply.
test('a manual discount is refused for every operator and nothing is written', async (t) => {
  if (!requireDb(t)) return
  const before = (await q('SELECT count(*)::int AS n FROM sales'))[0].n
  const r = await svc.call(
    'pos.checkout',
    {
      clientRef: ref(),
      shiftId: shift.id,
      paymentType: 'نقدي',
      discount: 5,
      items: [{ barcode: 'A1', qty: 1 }]
    },
    cashier
  )
  assert.equal(r.status, 403)
  assert.match(r.body.error.message, /تلقائياً/)
  assert.equal((await q('SELECT count(*)::int AS n FROM sales'))[0].n, before)
})

test('concurrent checkouts of the same product: every sale recorded once, stock = start − sold', async (t) => {
  if (!requireDb(t)) return
  // Bring B2 to 5 with a count movement (direct stock writes are refused by the ledger guard).
  const cur = Number((await q("SELECT stock_qty FROM products WHERE barcode = 'B2'"))[0].stock_qty)
  if (cur !== 5)
    await q(
      "INSERT INTO stock_movements (product_barcode, qty, kind, unit_cost, balance_after) VALUES ('B2', $1, 'count', 0, 0)",
      [5 - cur]
    )
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      svc.call(
        'pos.checkout',
        {
          clientRef: ref(),
          shiftId: shift.id,
          paymentType: 'نقدي',
          items: [{ barcode: 'B2', qty: 1 }]
        },
        cashier
      )
    )
  )
  assert.ok(
    results.every((r) => r.status === 200),
    JSON.stringify(results.map((r) => r.status))
  )
  assert.equal(new Set(results.map((r) => r.body.saleId)).size, 10, 'ten distinct sales')
  assert.equal(
    Number((await q("SELECT stock_qty FROM products WHERE barcode = 'B2'"))[0].stock_qty),
    -5
  )
  // Balances after each movement form an unbroken sequence 4, 3, …, −5 (no lost update).
  const balances = (
    await q(
      "SELECT balance_after FROM stock_movements WHERE product_barcode = 'B2' AND kind = 'sale' ORDER BY id DESC LIMIT 10"
    )
  ).map((m) => Number(m.balance_after))
  assert.deepEqual(balances, [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4])
  for (const r of results) {
    const items = await q('SELECT product_barcode FROM sale_items WHERE sale_id = $1', [
      r.body.saleId
    ])
    assert.deepEqual(
      items.map((i) => i.product_barcode),
      ['B2']
    )
  }
})

test('drawer audit and close use the legacy formulas; selling on a closed shift is refused', async (t) => {
  if (!requireDb(t)) return
  // The cashier may not see the expected drawer (blind close, PAY-01); the owner reads it.
  assert.equal((await svc.call('shifts.auditPreview', { shiftId: shift.id }, cashier)).status, 403)
  const preview = (await svc.call('shifts.auditPreview', { shiftId: shift.id }, admin)).body
  const cashSales = (
    await q(
      `SELECT SUM(COALESCE(NULLIF(original_amount, 0) - discount, total_amount))::float AS s FROM sales WHERE shift_id = $1 AND payment_type = 'نقدي'`,
      [shift.id]
    )
  )[0].s
  assert.equal(Math.round(preview.expected * 100), Math.round((200 + cashSales) * 100))
  const audit = (
    await svc.call('shifts.audit', { shiftId: shift.id, actualCash: preview.expected - 5 }, cashier)
  ).body
  assert.ok(audit.id > 0, 'audit id returned (deficit reason can be saved)')
  assert.equal(audit.expected, undefined, 'the blind count does not reveal the expected amount')
  assert.equal(
    (await svc.call('shifts.auditNote', { auditId: audit.id, notes: 'عجز فكة' }, cashier)).status,
    200
  )
  assert.equal(
    (await q('SELECT notes FROM shift_audits WHERE id = $1', [audit.id]))[0].notes,
    'عجز فكة'
  )
  // The count differs from the expected cash by more than EGP 50: a supervisor must acknowledge it
  // (phase 3); without one the shift stays open.
  const unacknowledged = await svc.call(
    'shifts.close',
    { shiftId: shift.id, actualCash: 300 },
    cashier
  )
  assert.equal(unacknowledged.status, 403)
  assert.equal(unacknowledged.body.error.code, 'approval_required')
  assert.equal((await q('SELECT status FROM shifts WHERE id = $1', [shift.id]))[0].status, 'open')
  const closed = await svc.call(
    'shifts.close',
    {
      shiftId: shift.id,
      actualCash: 300,
      approver: { username: 'super1', password: passwordFor('3333') }
    },
    cashier
  )
  assert.equal(closed.status, 200)
  assert.equal(Math.round(closed.body.expected * 100), Math.round((200 + cashSales) * 100))
  const r = await svc.call(
    'pos.checkout',
    {
      clientRef: ref(),
      shiftId: shift.id,
      paymentType: 'نقدي',
      items: [{ barcode: 'A1', qty: 1 }]
    },
    cashier
  )
  assert.equal(r.status, 409)
  assert.match(r.body.error.message, /الوردية مغلقة/)
})
