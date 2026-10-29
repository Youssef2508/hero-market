'use strict'
// Recorded supplier invoices can be opened and corrected (owner, 1.5.2, D-088). Everyone who sees
// suppliers can open an invoice with all its lines and returns; with «إدارة الموردين» its reference
// number and notes can be changed (logged); quantities, prices and amounts are never edited in
// place: stock, cost and the supplier's balance stay exactly as recorded.
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

let db, svc, owner, auditor, cashier, supplierId, purchaseId, boxId
const ref = () => crypto.randomUUID()
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const state = async () =>
  one(
    `SELECT (SELECT json_agg(json_build_object('b', barcode, 's', stock_qty::text, 'c', cost_price::text) ORDER BY barcode) FROM products) p,
            (SELECT debt_balance::text FROM suppliers WHERE id = $1) d,
            (SELECT json_agg(json_build_object('q', qty::text, 'c', unit_cost::text, 't', line_total::text) ORDER BY id) FROM supplier_purchase_items) i,
            (SELECT json_agg(json_build_object('t', total_amount::text, 'p', paid_amount::text, 'r', remaining::text) ORDER BY id) FROM supplier_purchases) s,
            (SELECT count(*) FROM stock_movements) m`,
    [supplierId]
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'auditor', pin: '4826', roleKey: 'auditor' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  auditor = await login(svc, '4826')
  cashier = await login(svc, '5173')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES
     ('A', 'أرز', 20, 25, 0, 'كيلو'), ('B', 'عصير', 4, 6, 0, 'قطعة')`
  )
  ok(
    await svc.call(
      'productUnits.save',
      { barcode: 'B', units: [{ name: 'كرتونة', factor: 24, retail_price: 140 }] },
      owner
    )
  )
  boxId = ok(await svc.call('productUnits.get', { barcode: 'B' }, owner)).units[0].id
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد العرض' }, owner)).id
  purchaseId = ok(
    await svc.call(
      'suppliers.addPurchase',
      {
        supplierId,
        invoice_ref: 'INV-1',
        total_amount: 310,
        discount: 10,
        paid_amount: 0,
        payment_type: 'آجل',
        notes: 'أول توريد',
        clientRef: ref(),
        items: [
          { barcode: 'A', qty: 10, unitCost: 22 },
          { barcode: 'B', unitId: boxId, qty: 1, unitCost: 100 }
        ]
      },
      owner
    )
  ).purchaseId
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('the invoice opens with every line, unit and return, for anyone who sees suppliers', async (t) => {
  if (!requireDb(t)) return
  // A partial return, so the detail shows it.
  const [lineA] = await q(
    "SELECT id FROM supplier_purchase_items WHERE purchase_id = $1 AND product_barcode = 'A'",
    [purchaseId]
  )
  ok(
    await svc.call(
      'suppliers.returnPurchase',
      { purchaseId, items: [{ purchaseItemId: lineA.id, qty: 2 }], clientRef: ref() },
      owner
    )
  )
  for (const token of [owner, auditor]) {
    const d = ok(await svc.call('suppliers.purchaseDetail', { purchaseId }, token))
    assert.equal(d.purchase.invoice_ref, 'INV-1')
    assert.deepEqual(
      [d.purchase.gross, d.purchase.discount, d.purchase.total_amount],
      [320, 10, 310]
    )
    assert.deepEqual(
      d.items.map((l) => [
        l.barcode,
        l.name,
        l.qty,
        l.unit_cost,
        l.line_total,
        l.unit_name,
        l.unit_factor,
        l.returned
      ]),
      [
        ['A', 'أرز', 10, 22, 220, 'كيلو', 1, 2],
        ['B', 'عصير', 1, 100, 100, 'كرتونة', 24, 0]
      ]
    )
    assert.equal(d.returns.length, 1)
  }
  // Without the suppliers permissions: refused.
  assert.equal((await svc.call('suppliers.purchaseDetail', { purchaseId }, cashier)).status, 403)
  assert.equal(
    (await svc.call('suppliers.purchaseDetail', { purchaseId: 9999 }, owner)).status,
    404
  )
})

test('reference and notes are corrected and logged; nothing else changes', async (t) => {
  if (!requireDb(t)) return
  const before = await state()
  const r = ok(
    await svc.call(
      'suppliers.updatePurchase',
      { purchaseId, invoiceRef: '  INV-1/أ ', notes: 'تصحيح رقم الفاتورة' },
      owner
    )
  )
  assert.equal(r.changed, true)
  const d = ok(await svc.call('suppliers.purchaseDetail', { purchaseId }, owner))
  assert.deepEqual([d.purchase.invoice_ref, d.purchase.notes], ['INV-1/أ', 'تصحيح رقم الفاتورة'])
  assert.deepEqual(await state(), before, 'stock, cost, lines, amounts and balance untouched')
  const log = await one(
    "SELECT description, details FROM system_logs WHERE action_type = 'supplier_purchase_edit' ORDER BY id DESC LIMIT 1"
  )
  assert.match(log.description, /رقم الفاتورة «INV-1» ← «INV-1\/أ»/)
  assert.deepEqual(JSON.parse(log.details).changes.notes, {
    from: 'أول توريد',
    to: 'تصحيح رقم الفاتورة'
  })
  // The same values again: no change, no log.
  const n = (
    await one(
      "SELECT count(*)::int n FROM system_logs WHERE action_type = 'supplier_purchase_edit'"
    )
  ).n
  assert.equal(
    ok(
      await svc.call(
        'suppliers.updatePurchase',
        { purchaseId, invoiceRef: 'INV-1/أ', notes: 'تصحيح رقم الفاتورة' },
        owner
      )
    ).changed,
    false
  )
  assert.equal(
    (
      await one(
        "SELECT count(*)::int n FROM system_logs WHERE action_type = 'supplier_purchase_edit'"
      )
    ).n,
    n
  )
})

test('permissions and validation: view-only users cannot edit; amounts are never edited', async (t) => {
  if (!requireDb(t)) return
  const before = await state()
  assert.equal(
    (await svc.call('suppliers.updatePurchase', { purchaseId, notes: 'x' }, auditor)).status,
    403
  )
  assert.equal(
    (await svc.call('suppliers.updatePurchase', { purchaseId, notes: 'x' }, cashier)).status,
    403
  )
  // Financial fields are not part of the edit: the service drops them (Fastify removes unknown
  // fields), so only the notes change.
  ok(
    await svc.call(
      'suppliers.updatePurchase',
      { purchaseId, notes: 'ملاحظة', total_amount: 1, paid_amount: 999, items: [] },
      owner
    )
  )
  assert.equal(
    (await svc.call('suppliers.updatePurchase', { purchaseId, invoiceRef: 'x'.repeat(81) }, owner))
      .status,
    400
  )
  assert.equal(
    (await svc.call('suppliers.updatePurchase', { purchaseId: 9999, notes: 'x' }, owner)).status,
    404
  )
  assert.deepEqual(await state(), before, 'amounts, lines, stock and balance untouched')
})

test('an invoice completed from a preliminary one opens and edits the same way', async (t) => {
  if (!requireDb(t)) return
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
  const pending = ok(
    await svc.call(
      'supplierInvoices.createPending',
      { supplierId, total: 50, paymentMode: 'credit', currentShiftId: shift.id, clientRef: ref() },
      owner
    )
  ).invoice
  const conv = ok(
    await svc.call(
      'supplierInvoices.convert',
      { invoiceId: pending.id, items: [{ barcode: 'A', qty: 2, unitCost: 25 }], clientRef: ref() },
      owner
    )
  )
  const id = conv.invoice.purchase_id
  const d = ok(await svc.call('suppliers.purchaseDetail', { purchaseId: id }, auditor))
  assert.deepEqual(
    d.items.map((l) => [l.barcode, l.qty, l.unit_cost]),
    [['A', 2, 25]]
  )
  ok(await svc.call('suppliers.updatePurchase', { purchaseId: id, notes: 'من المبدئية' }, owner))
  assert.equal(
    ok(await svc.call('suppliers.purchaseDetail', { purchaseId: id }, owner)).purchase.notes,
    'من المبدئية'
  )
})
