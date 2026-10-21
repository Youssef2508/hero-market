'use strict'
// Supplier payables and customer receivables (owner, 2026-10-21, D-064), end to end with exact
// balances: preliminary supplier invoices (paid, partial, credit), their conversion into detailed
// purchases (stock and moving-average cost, never a second payment), later settlements, credit and
// partial sales, later collections, retries, and how the shift report tells them apart.
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

let db, svc, owner, cashier, shift, ownerShift, supplierId, clientId
const ref = () => crypto.randomUUID()
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const r2 = (n) => Math.round(Number(n) * 100) / 100
const debt = async () =>
  r2((await one('SELECT debt_balance FROM suppliers WHERE id = $1', [supplierId])).debt_balance)
const clientDebt = async () =>
  r2((await one('SELECT debt_balance FROM clients WHERE id = $1', [clientId])).debt_balance)
const product = async (b) =>
  await one(
    'SELECT stock_qty::float8 AS stock, cost_price::float8 AS cost FROM products WHERE barcode = $1',
    [b]
  )
const moves = async (shiftId) =>
  q(
    'SELECT method, kind, type, amount::float8 AS amount FROM safe_ledger WHERE shift_id = $1 ORDER BY id',
    [shiftId]
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
     ('RICE', 'أرز', 20, 30, 28, 10, 'كيس'), ('OIL', 'زيت', 50, 70, 65, 0, 'زجاجة')`
  )
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الأرز' }, owner)).id
  clientId = ok(
    await svc.call('clients.create', { name: 'عميل آجل', phone: '01022223333' }, owner)
  ).id
  shift = ok(await svc.call('shifts.open', { startingCash: 500 }, cashier))
  ownerShift = null
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('preliminary invoices: paid, partial and credit move money and payable only – never stock', async (t) => {
  if (!requireDb(t)) return
  const rice = await product('RICE')
  const create = (body) =>
    svc.call(
      'supplierInvoices.createPending',
      { supplierId, currentShiftId: shift.id, clientRef: ref(), ...body },
      cashier
    )
  // Paid in full in cash: 300 leaves the drawer, nothing owed.
  const full = ok(await create({ total: 300, paymentMode: 'cash' })).invoice
  assert.deepEqual([Number(full.paid), full.status], [300, 'pending'])
  assert.equal(await debt(), 0)
  // Partial, 100 of 400 by InstaPay: 100 leaves the InstaPay balance, 300 owed.
  const partialRef = ref()
  const partial = ok(
    await svc.call(
      'supplierInvoices.createPending',
      {
        supplierId,
        total: 400,
        paymentMode: 'partial',
        paid: 100,
        method: 'instapay',
        currentShiftId: shift.id,
        clientRef: partialRef
      },
      cashier
    )
  ).invoice
  assert.equal(await debt(), 300)
  // The same request again (double click): recorded once.
  const again = ok(
    await svc.call(
      'supplierInvoices.createPending',
      {
        supplierId,
        total: 400,
        paymentMode: 'partial',
        paid: 100,
        method: 'instapay',
        currentShiftId: shift.id,
        clientRef: partialRef
      },
      cashier
    )
  )
  assert.equal(again.duplicate, true)
  assert.equal(await debt(), 300)
  // Entirely on credit: no money moves at all.
  const credit = ok(await create({ total: 150, paymentMode: 'credit' })).invoice
  assert.equal(Number(credit.paid), 0)
  assert.equal(await debt(), 450)
  // Partial must be more than nothing and less than the total.
  assert.equal((await create({ total: 50, paymentMode: 'partial', paid: 50 })).status, 400)
  // Money: exactly two supplier payments in the shift, by their methods.
  const m = (await moves(shift.id)).filter((x) => x.kind === 'supplier_payment')
  assert.deepEqual(
    m.map((x) => [x.method, x.amount]),
    [
      ['cash', 300],
      ['instapay', 100]
    ]
  )
  // Stock and cost untouched; no stock movement for any of them.
  assert.deepEqual(await product('RICE'), rice)
  assert.equal(
    (await one("SELECT COUNT(*)::int n FROM stock_movements WHERE ref_type = 'purchase'")).n,
    0
  )
  // A cashier cannot convert.
  assert.equal(
    (
      await svc.call(
        'supplierInvoices.convert',
        {
          invoiceId: full.id,
          items: [{ barcode: 'RICE', qty: 10, unitCost: 30 }],
          clientRef: ref()
        },
        cashier
      )
    ).status,
    403
  )
  t.diagnostic(`invoices ${full.id}, ${partial.id}, ${credit.id}`)
})

test('conversion moves stock and moving-average cost once, never the payment; a different total adjusts the payable', async (t) => {
  if (!requireDb(t)) return
  const list = ok(await svc.call('supplierInvoices.list', { status: 'pending' }, owner))
  const byTotal = (n) => list.find((x) => Number(x.total) === n)
  const cashBefore = (await moves(shift.id)).length
  // 300 paid in full; the detailed invoice is exactly 300: 10 rice at 30.
  const convRef = ref()
  const conv = ok(
    await svc.call(
      'supplierInvoices.convert',
      {
        invoiceId: byTotal(300).id,
        items: [{ barcode: 'RICE', qty: 10, unitCost: 30 }],
        clientRef: convRef
      },
      owner
    )
  )
  assert.equal(conv.difference, 0)
  const rice = await product('RICE')
  assert.equal(rice.stock, 20)
  assert.equal(rice.cost, 25, 'moving average: (10×20 + 10×30) / 20')
  assert.equal(await debt(), 450, 'payable unchanged')
  assert.equal((await moves(shift.id)).length, cashBefore, 'no second payment')
  // Retried conversion returns the first result; a different request is refused.
  assert.equal(
    ok(
      await svc.call(
        'supplierInvoices.convert',
        {
          invoiceId: byTotal(300).id,
          items: [{ barcode: 'RICE', qty: 10, unitCost: 30 }],
          clientRef: convRef
        },
        owner
      )
    ).duplicate,
    true
  )
  assert.equal(
    (
      await svc.call(
        'supplierInvoices.convert',
        {
          invoiceId: byTotal(300).id,
          items: [{ barcode: 'RICE', qty: 10, unitCost: 30 }],
          clientRef: ref()
        },
        owner
      )
    ).status,
    409
  )
  assert.equal((await product('RICE')).stock, 20, 'stock moved once')
  // 400 (100 paid): the detailed invoice is 420 – the payable grows by 20, explicitly.
  const c2 = ok(
    await svc.call(
      'supplierInvoices.convert',
      {
        invoiceId: byTotal(400).id,
        items: [{ barcode: 'OIL', qty: 7, unitCost: 60 }],
        clientRef: ref()
      },
      owner
    )
  )
  assert.equal(c2.difference, 20)
  assert.equal(await debt(), 470)
  assert.ok(
    await one(
      "SELECT 1 FROM supplier_ledger WHERE supplier_id = $1 AND type = 'adjustment' AND amount = 20",
      [supplierId]
    )
  )
  const purchase = await one(
    'SELECT total_amount::float8 t, paid_amount::float8 p, remaining::float8 r FROM supplier_purchases WHERE id = $1',
    [c2.purchaseId]
  )
  assert.deepEqual([purchase.t, purchase.p, purchase.r], [420, 100, 320])
  // 150 on credit; the detailed invoice is 140 – the payable falls by 10.
  const c3 = ok(
    await svc.call(
      'supplierInvoices.convert',
      {
        invoiceId: byTotal(150).id,
        items: [{ barcode: 'RICE', qty: 5, unitCost: 28 }],
        clientRef: ref()
      },
      owner
    )
  )
  assert.equal(c3.difference, -10)
  assert.equal(await debt(), 460)
  // Links kept: the preliminary invoice points to its purchase.
  const linked = await one(
    'SELECT status, purchase_id, final_total::float8 f FROM supplier_pending_invoices WHERE id = $1',
    [byTotal(150).id]
  )
  assert.deepEqual([linked.status, linked.purchase_id, linked.f], ['converted', c3.purchaseId, 140])
})

test('a failed conversion changes nothing (one transaction)', async (t) => {
  if (!requireDb(t)) return
  const inv = ok(
    await svc.call(
      'supplierInvoices.createPending',
      { supplierId, total: 60, paymentMode: 'credit', currentShiftId: shift.id, clientRef: ref() },
      cashier
    )
  ).invoice
  const before = [await debt(), await product('RICE')]
  const bad = await svc.call(
    'supplierInvoices.convert',
    {
      invoiceId: inv.id,
      items: [
        { barcode: 'RICE', qty: 2, unitCost: 10 },
        { barcode: 'NOPE', qty: 1, unitCost: 40 }
      ],
      clientRef: ref()
    },
    owner
  )
  assert.equal(bad.status, 404)
  assert.deepEqual([await debt(), await product('RICE')], before)
  assert.equal(
    (await one('SELECT status FROM supplier_pending_invoices WHERE id = $1', [inv.id])).status,
    'pending'
  )
})

test('later supplier settlements pay what is paid, by its method, once – no stock or cost change', async (t) => {
  if (!requireDb(t)) return
  const rice = await product('RICE')
  const d0 = await debt()
  const settle = {
    supplierId,
    amount: 200,
    method: 'wallet',
    destination: 'shift',
    currentShiftId: shift.id,
    clientRef: ref()
  }
  // The cashier has no supplier management permission; the owner settles from his own shift.
  ownerShift = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
  settle.currentShiftId = ownerShift.id
  ok(await svc.call('suppliers.repay', settle, owner))
  ok(await svc.call('suppliers.repay', settle, owner))
  assert.equal(await debt(), r2(d0 - 200), 'settled once')
  const m = (await moves(ownerShift.id)).filter((x) => x.kind === 'supplier_settlement')
  assert.deepEqual(
    m.map((x) => [x.method, x.amount]),
    [['wallet', 200]]
  )
  assert.deepEqual(await product('RICE'), rice)
})

test('credit and partial sales, later collections: receivables exact, collections are not sales', async (t) => {
  if (!requireDb(t)) return
  const sell = (body) =>
    svc.call(
      'pos.checkout',
      {
        clientRef: ref(),
        shiftId: shift.id,
        items: [{ barcode: 'RICE', qty: 1 }],
        client: { id: clientId, name: 'عميل آجل' },
        ...body
      },
      cashier
    )
  // Fully paid (cash), fully credit (30 on account), partial 30 with 10 now by Visa (20 on account).
  ok(await sell({ paymentType: 'نقدي' }))
  ok(await sell({ paymentType: 'آجل' }))
  ok(await sell({ paymentType: 'دفع جزئي', paidAmount: 10, upfrontMethod: 'visa' }))
  assert.equal(await clientDebt(), 50)
  const salesBefore = (await one('SELECT COUNT(*)::int n, SUM(total_amount)::float8 s FROM sales'))
    .n
  // A collection of 35 by wallet, retried once: recorded once, no new sale.
  const pay = {
    clientId,
    amount: 35,
    method: 'wallet',
    destination: 'shift',
    currentShiftId: shift.id,
    clientRef: ref()
  }
  // The cashier collects with the customers.payments permission? Use the owner's shift otherwise.
  const who = (await svc.call('clients.repay', pay, cashier)).status === 403 ? owner : cashier
  if (who === owner) pay.currentShiftId = ownerShift.id
  ok(await svc.call('clients.repay', pay, who))
  ok(await svc.call('clients.repay', pay, who))
  assert.equal(await clientDebt(), 15)
  assert.equal((await one('SELECT COUNT(*)::int n FROM sales')).n, salesBefore, 'no new sale')
  const collectShift = who === owner ? ownerShift.id : shift.id
  const col = (await moves(collectShift)).filter((x) => x.kind === 'customer_payment')
  assert.deepEqual(
    col.map((x) => [x.method, x.amount]),
    [['wallet', 35]]
  )
  // The partial sale's part paid at once is a Visa movement of the selling shift.
  const up = (await moves(shift.id)).filter((x) => x.kind === 'sale_upfront')
  assert.deepEqual(
    up.map((x) => [x.method, x.amount]),
    [['visa', 10]]
  )
  // The shift report keeps them apart.
  const rep = ok(await svc.call('shifts.details', { shiftId: shift.id }, owner)).report
  assert.deepEqual(rep.creditSales, { count: 1, total: 30 })
  assert.deepEqual(rep.partialSales, { count: 1, total: 30, paidNow: 10, unpaid: 20 })
  assert.equal(rep.supplierPayments.withInvoices, 400)
  assert.equal(rep.salesByMethod.cash, 30, 'only the paid-in-full sale counts as cash sales')
  assert.equal(rep.movements.visa.sale_upfront, 10)
  assert.equal(rep.movements.instapay.supplier_payment, -100)
  // Expected per method: cash 500 + 30 − 300 = 230; Visa 10; InstaPay −100.
  assert.equal(rep.expected.cash, 230)
  assert.equal(rep.expected.visa, 10)
  assert.equal(rep.expected.instapay, -100)
  // Collections in the report of the shift that received the money.
  const rep2 = ok(await svc.call('shifts.details', { shiftId: collectShift }, owner)).report
  assert.equal(rep2.collections, 35)
})

test('the cashier cannot read expected amounts through any operation before closing', async (t) => {
  if (!requireDb(t)) return
  for (const [op, body] of [
    ['shifts.liveSummary', { shiftId: shift.id }],
    ['shifts.auditPreview', { shiftId: shift.id }],
    ['shifts.details', { shiftId: shift.id }],
    ['shifts.list', {}],
    ['shifts.closeReport', { shiftId: shift.id }],
    ['treasury.summary', {}],
    ['treasury.entries', {}],
    ['supplierInvoices.list', {}]
  ]) {
    const r = await svc.call(op, body, cashier)
    assert.notEqual(r.status, 200, `${op} must not answer the cashier`)
  }
  const tills = ok(await svc.call('tills.drawerSummary', { shiftId: shift.id }, cashier))
  assert.deepEqual(Object.keys(tills).sort(), ['blind', 'shift'])
  const counted = ok(await svc.call('shifts.audit', { shiftId: shift.id, actualCash: 1 }, cashier))
  assert.deepEqual(Object.keys(counted), ['id'])
})

test('backup and restore keep preliminary invoices, kinds and per-method treasury rows', async (t) => {
  if (!requireDb(t)) return
  const tables = [
    'supplier_pending_invoices',
    'safe_ledger',
    'treasury_ledger',
    'supplier_ledger',
    'supplier_purchases'
  ]
  const snap = async () => {
    const out = {}
    for (const tb of tables) out[tb] = await q(`SELECT * FROM ${tb} ORDER BY 1`)
    return out
  }
  const exported = ok(await svc.call('backup.export', {}, owner))
  const before = await snap()
  ok(await svc.call('backup.restore', { backup: exported, confirm: 'RESTORE' }, owner))
  assert.deepEqual(await snap(), before)
})
