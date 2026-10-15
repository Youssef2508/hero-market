'use strict'
// Business flows ported from the legacy SQLite simulation suites (tests/simulate_*.js), now executed
// through the real service operations against PostgreSQL. Legacy scenarios that exercised SQL the app
// never ran (purchase-driven stock increases, points redemption) are listed in TESTING_AND_KNOWN_ISSUES.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

let db, svc, admin, cashier, shift, client, supplier
const ref = () => crypto.randomUUID()
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.ok(r.status === 200, JSON.stringify(r.body))
  return r.body
}
const sell = (body, token = admin) =>
  svc.call(
    'pos.checkout',
    { clientRef: ref(), shiftId: shift.id, paymentType: 'نقدي', ...body },
    token
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  admin = ok(await svc.call('auth.setup', { username: 'owner', pin: '9191' })).token
  await createUser(svc, { username: 'c1', pin: '2121', roleKey: 'cashier' })
  cashier = await login(svc, '2121')
  shift = ok(await svc.call('shifts.open', { startingCash: 200 }, admin))
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('FLOWS 2–4: customer, supplier and product creation; duplicate barcode refused', async (t) => {
  if (!requireDb(t)) return
  client = ok(
    await svc.call(
      'clients.create',
      { name: "عميل 'تجربة'", phone: '01000000001', address: 'شارع "النصر"' },
      admin
    )
  )
  assert.equal(client.name, "عميل 'تجربة'", 'quotes stored exactly (no SQL injection, no mangling)')
  supplier = ok(await svc.call('suppliers.create', { name: 'تست مورد', phone: '0200' }, admin))
  ok(
    await svc.call(
      'products.create',
      {
        barcode: 'P28',
        name: 'صنف تجربة 28',
        cost_price: 10,
        retail_price: 15,
        stock_qty: 100,
        reorder_limit: 5
      },
      admin
    )
  )
  const dup = await svc.call('products.create', { barcode: 'P28', name: 'مكرر' }, admin)
  assert.equal(dup.status, 409)
  // K-26: two customers without a phone are allowed
  ok(await svc.call('clients.create', { name: 'بدون هاتف 1', phone: '' }, admin))
  ok(await svc.call('clients.create', { name: 'بدون هاتف 2', phone: '' }, admin))
})

test('FLOWS 5–9: cash, customer (points), credit, discounted and delivery sales', async (t) => {
  if (!requireDb(t)) return
  const cash = ok(await sell({ items: [{ barcode: 'P28', qty: 10 }] }))
  assert.equal(cash.total, 150)
  const withClient = ok(
    await sell({
      items: [{ barcode: 'P28', qty: 10 }],
      client: { id: client.id, name: client.name }
    })
  )
  assert.equal(
    (await one('SELECT points FROM clients WHERE id = $1', [client.id])).points,
    1,
    '150 EGP → 1 point'
  )
  const credit = ok(
    await sell({
      paymentType: 'آجل',
      items: [{ barcode: 'P28', qty: 10 }],
      client: { id: client.id, name: client.name }
    })
  )
  assert.equal(
    Number((await one('SELECT debt_balance FROM clients WHERE id = $1', [client.id])).debt_balance),
    150
  )
  const disc = ok(await sell({ discount: 10, items: [{ barcode: 'P28', qty: 10 }] }))
  assert.equal(disc.total, 140)
  const sale = await one(
    'SELECT original_amount, discount, total_amount FROM sales WHERE id = $1',
    [disc.saleId]
  )
  assert.deepEqual(
    [Number(sale.original_amount), Number(sale.discount), Number(sale.total_amount)],
    [150, 10, 140]
  )
  const delivery = ok(
    await sell({
      isDelivery: true,
      items: [{ barcode: 'P28', qty: 1 }],
      client: { name: 'زبون توصيل', phone: '0111', address: 'المعادي' }
    })
  )
  const dsale = await one('SELECT client_name, client_id FROM sales WHERE id = $1', [
    delivery.saleId
  ])
  assert.equal(
    dsale.client_name,
    'زبون توصيل (0111) - المعادي',
    'legacy client_name format for delivery'
  )
  assert.ok(dsale.client_id, 'new customer created inside the sale transaction')
  assert.equal(
    Number((await one("SELECT stock_qty FROM products WHERE barcode = 'P28'")).stock_qty),
    59
  )
  Object.assign(module.exports, { cash, withClient, credit, disc })
})

test('FLOWS 10–13: full and partial returns for cash and credit sales; no double refund', async (t) => {
  if (!requireDb(t)) return
  const { cash, disc, credit } = module.exports
  // Full return of a cash sale
  ok(await svc.call('sales.returnEntire', { saleId: cash.saleId, currentShiftId: shift.id }, admin))
  const s1 = await one('SELECT total_amount, discount FROM sales WHERE id = $1', [cash.saleId])
  assert.deepEqual([Number(s1.total_amount), Number(s1.discount)], [0, 0])
  const out1 = await one(`SELECT amount FROM safe_ledger WHERE description = $1`, [
    `مرتجع كامل الفاتورة #${cash.saleId}`
  ])
  assert.equal(Number(out1.amount), 150)
  assert.equal(
    (await svc.call('sales.returnEntire', { saleId: cash.saleId, currentShiftId: shift.id }, admin))
      .status,
    409,
    'second full return refused'
  )
  // Partial return (2 units) of the discounted sale: refund keeps the discount ratio (10/150)
  const item = await one('SELECT id FROM sale_items WHERE sale_id = $1', [disc.saleId])
  const r = ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: item.id, quantity: 2, currentShiftId: shift.id },
      admin
    )
  )
  assert.equal(r.netRefund, 28, '2 × 15 = 30 minus 2.00 discount share')
  assert.equal(
    (
      await svc.call(
        'sales.returnItem',
        { saleItemId: item.id, quantity: 9, currentShiftId: shift.id },
        admin
      )
    ).status,
    400,
    'over-return refused'
  )
  // Full return of a credit sale reduces the debt instead of paying cash
  ok(
    await svc.call('sales.returnEntire', { saleId: credit.saleId, currentShiftId: shift.id }, admin)
  )
  assert.equal(
    Number((await one('SELECT debt_balance FROM clients WHERE id = $1', [client.id])).debt_balance),
    0
  )
  const led = await one(`SELECT type, amount FROM client_ledger WHERE description = $1`, [
    `إرجاع كامل فاتورة آجل #${credit.saleId}`
  ])
  assert.deepEqual([led.type, Number(led.amount)], ['payment', 150])
  // Stock restored: 59 + 10 (cash) + 2 (partial) + 10 (credit)
  assert.equal(
    Number((await one("SELECT stock_qty FROM products WHERE barcode = 'P28'")).stock_qty),
    81
  )
  assert.equal(
    (await svc.call('sales.returnItem', { saleItemId: item.id, quantity: 1 }, cashier)).status,
    403,
    'cashier cannot return'
  )
})

test('FLOWS 14–17: customer repayment and supplier purchase / payment move the drawer correctly', async (t) => {
  if (!requireDb(t)) return
  ok(
    await sell({
      paymentType: 'آجل',
      items: [{ barcode: 'P28', qty: 2 }],
      client: { id: client.id, name: client.name }
    })
  )
  const repaid = ok(
    await svc.call(
      'clients.repay',
      { clientId: client.id, amount: 10, currentShiftId: shift.id },
      admin
    )
  )
  assert.equal(Number(repaid.debt_balance), 20)
  assert.equal(
    (await svc.call('clients.repay', { clientId: client.id, amount: 5 }, admin)).status,
    409,
    'repayment needs an open shift'
  )
  // Overpayment creates a credit balance (legacy rule, after confirmation in the UI)
  const over = ok(
    await svc.call(
      'clients.repay',
      { clientId: client.id, amount: 50, currentShiftId: shift.id },
      admin
    )
  )
  assert.equal(Number(over.debt_balance), -30)
  assert.equal(
    (await svc.call('clients.delete', { clientId: client.id }, admin)).status,
    409,
    'customer with a balance cannot be deleted'
  )

  const sp = ok(
    await svc.call(
      'suppliers.addPurchase',
      {
        supplierId: supplier.id,
        invoice_ref: 'INV-1',
        total_amount: 500,
        paid_amount: 100,
        currentShiftId: shift.id
      },
      admin
    )
  )
  assert.equal(Number(sp.debt_balance), 400)
  const paidOut = await one(`SELECT amount FROM safe_ledger WHERE description = $1`, [
    `دفعة لمورد: ${supplier.name} - فاتورة #INV-1`
  ])
  assert.equal(Number(paidOut.amount), 100)
  const rp = ok(
    await svc.call(
      'suppliers.repay',
      { supplierId: supplier.id, amount: 40, currentShiftId: shift.id },
      admin
    )
  )
  assert.equal(Number(rp.debt_balance), 360)
  assert.ok(
    await one(`SELECT 1 FROM safe_ledger WHERE description = $1 AND amount = 40`, [
      `سداد دين مورد: ${supplier.name}`
    ])
  )
})

test('FLOWS 18–20: price change keeps historical sale lines; damaged goods move stock', async (t) => {
  if (!requireDb(t)) return
  const before = await q(
    "SELECT unit_price, cost_price FROM sale_items WHERE product_barcode = 'P28' ORDER BY id"
  )
  // The form sends the stock it showed (stock_base); the change becomes an adjustment movement.
  const shown = Number(
    (await one("SELECT stock_qty FROM products WHERE barcode = 'P28'")).stock_qty
  )
  ok(
    await svc.call(
      'products.update',
      {
        barcode: 'P28',
        name: 'صنف تجربة 28',
        cost_price: 12,
        retail_price: 16,
        stock_qty: 80,
        stock_base: shown,
        reorder_limit: 5
      },
      admin
    )
  )
  const afterRows = await q(
    "SELECT unit_price, cost_price FROM sale_items WHERE product_barcode = 'P28' ORDER BY id"
  )
  assert.deepEqual(afterRows, before, 'historical prices and costs untouched')
  ok(
    await svc.call(
      'damaged.create',
      { barcode: 'P28', quantity: 2, reason: 'تلف / كسر', currentShiftId: shift.id },
      admin
    )
  )
  assert.equal(
    Number((await one("SELECT stock_qty FROM products WHERE barcode = 'P28'")).stock_qty),
    78
  )
  const dmg = await one('SELECT id, cost_price FROM damaged_goods ORDER BY id DESC LIMIT 1')
  assert.equal(Number(dmg.cost_price), 12, 'damage valued at the current cost')
  // Negative stock is allowed (owner decision): more damaged than recorded stock goes negative.
  ok(await svc.call('damaged.create', { barcode: 'P28', quantity: 1000 }, admin))
  assert.equal(
    Number((await one("SELECT stock_qty FROM products WHERE barcode = 'P28'")).stock_qty),
    -922
  )
  const big = await one('SELECT id FROM damaged_goods ORDER BY id DESC LIMIT 1')
  ok(await svc.call('damaged.delete', { damagedId: big.id }, admin))
  ok(await svc.call('damaged.delete', { damagedId: dmg.id }, admin))
  assert.equal(
    Number((await one("SELECT stock_qty FROM products WHERE barcode = 'P28'")).stock_qty),
    80
  )
  const kinds = (
    await q(
      "SELECT kind, qty FROM stock_movements WHERE product_barcode = 'P28' AND kind LIKE 'damaged%' ORDER BY id"
    )
  ).map((m) => `${m.kind}:${Number(m.qty)}`)
  assert.deepEqual(kinds, [
    'damaged:-2',
    'damaged:-1000',
    'damaged_reversal:1000',
    'damaged_reversal:2'
  ])
  assert.equal(
    (await svc.call('products.delete', { barcode: 'P28' }, admin)).status,
    409,
    'product with sales cannot be deleted'
  )
})

test('FLOWS 24–27: cheques and expenses (one drawer row per expense)', async (t) => {
  if (!requireDb(t)) return
  const today = (await one("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d")).d
  ok(
    await svc.call(
      'checks.create',
      { check_type: 'مورد', party_name: 'مورد شيكات', due_date: today, amount: 1000 },
      admin
    )
  )
  const list = ok(await svc.call('checks.list', {}, admin))
  assert.equal(list.dueToday.length, 1)
  ok(await svc.call('checks.markPaid', { checkId: list.all[0].id }, admin))
  assert.equal((await one('SELECT status FROM checks_register')).status, 'مسدد')
  ok(await svc.call('checks.delete', { checkId: list.all[0].id }, admin))
  // Two identical expenses → deleting one removes exactly one drawer outflow (K-28)
  ok(
    await svc.call(
      'expenses.create',
      { amount: 150, category: 'عام', description: 'كهرباء', currentShiftId: shift.id },
      admin
    )
  )
  ok(
    await svc.call(
      'expenses.create',
      { amount: 150, category: 'عام', description: 'كهرباء', currentShiftId: shift.id },
      admin
    )
  )
  const ex = await one('SELECT id FROM expenses ORDER BY id DESC LIMIT 1')
  ok(await svc.call('expenses.delete', { expenseId: ex.id }, admin))
  const rows = await q(
    "SELECT 1 FROM safe_ledger WHERE description = 'مصروفات - تصنيف: عام - كهرباء'"
  )
  assert.equal(rows.length, 1)
})

test('Tills: cashier records Momkn / wallet operations; only managers of tills may delete', async (t) => {
  if (!requireDb(t)) return
  const cshift = ok(await svc.call('shifts.open', { startingCash: 50 }, cashier))
  ok(
    await svc.call(
      'momkn.add',
      {
        shiftId: cshift.id,
        operationType: 'شحن رصيد',
        digitalImpact: -100,
        cashImpact: 100,
        commission: 2
      },
      cashier
    )
  )
  ok(
    await svc.call(
      'mobileMoney.add',
      {
        shiftId: cshift.id,
        platform: 'vodafone_cash',
        operationType: 'إيداع',
        digitalImpact: -200,
        cashImpact: 200,
        commission: 3
      },
      cashier
    )
  )
  const m = ok(await svc.call('momkn.list', { shiftId: cshift.id }, cashier))
  assert.deepEqual([m.summary.totalCashImpact, m.summary.totalCommission], [100, 2])
  assert.equal(
    (await svc.call('momkn.list', { shiftId: shift.id }, cashier)).status,
    403,
    "cashier cannot read another user's shift"
  )
  assert.equal((await svc.call('momkn.delete', { id: m.rows[0].id }, cashier)).status, 403)
  ok(await svc.call('momkn.delete', { id: m.rows[0].id }, admin))
  const live = ok(await svc.call('shifts.liveSummary', { shiftId: cshift.id }, cashier))
  assert.equal(Number(live.mm_cash_impact), 200)
})

test('FLOW 28 / shortage & overage: closing figures follow the legacy formula', async (t) => {
  if (!requireDb(t)) return
  const f = await one(
    `SELECT COALESCE(SUM(COALESCE(NULLIF(original_amount, 0) - discount, total_amount)) FILTER (WHERE payment_type = 'نقدي'), 0)::float AS cash,
            (SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'inflow'), 0) FROM safe_ledger WHERE shift_id = $1)::float AS inflow,
            (SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'outflow'), 0) FROM safe_ledger WHERE shift_id = $1)::float AS outflow
     FROM sales WHERE shift_id = $1`,
    [shift.id]
  )
  const expected = 200 + f.cash + f.inflow - f.outflow
  const closed = ok(
    await svc.call('shifts.close', { shiftId: shift.id, actualCash: expected - 50 }, admin)
  )
  assert.equal(Math.round(closed.expected * 100), Math.round(expected * 100))
  assert.equal(Math.round(closed.difference * 100), -5000, 'shortage recorded as −50')
  const p = ok(await svc.call('reports.periodic', { period: 'all' }, admin))
  const total = Number((await one('SELECT SUM(total_amount) AS s FROM sales')).s)
  assert.equal(
    Math.round(p.totalSales * 100),
    Math.round(total * 100),
    'report total equals the stored sales'
  )
})

test('Validation: zero quantity and unknown payment types are rejected; prices are rounded like the cart', async (t) => {
  if (!requireDb(t)) return
  const s2 = ok(await svc.call('shifts.open', { startingCash: 0 }, admin))
  ok(
    await svc.call(
      'products.create',
      { barcode: 'R3', name: 'كسر عشري', retail_price: 15.3333333333333, stock_qty: 10 },
      admin
    )
  )
  const zero = await svc.call(
    'pos.checkout',
    { clientRef: ref(), shiftId: s2.id, paymentType: 'نقدي', items: [{ barcode: 'R3', qty: 0 }] },
    admin
  )
  assert.equal(zero.status, 400)
  const badType = await svc.call(
    'pos.checkout',
    {
      clientRef: ref(),
      shiftId: s2.id,
      paymentType: 'بيتكوين',
      items: [{ barcode: 'R3', qty: 1 }]
    },
    admin
  )
  assert.equal(badType.status, 400)
  const r = ok(
    await svc.call(
      'pos.checkout',
      { clientRef: ref(), shiftId: s2.id, paymentType: 'نقدي', items: [{ barcode: 'R3', qty: 3 }] },
      admin
    )
  )
  assert.equal(r.total, 46, 'round2(15.3333333333333 × 3) = 46.00, as the cart computes it')
})
