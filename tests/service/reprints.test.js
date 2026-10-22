'use strict'
// POS-02 (D-077): reprinting a sale invoice, a supplier invoice or a closing report reads what was
// saved and changes nothing – no second sale, stock movement, supplier posting or shift close.
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

let db, svc, owner
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  owner = await login(svc, '8642')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES ('P', 'صنف', 5, 10, 9, 50, 'قطعة')`
  )
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

const TABLES = [
  'sales',
  'sale_items',
  'stock_movements',
  'supplier_purchases',
  'supplier_ledger',
  'safe_ledger',
  'treasury_ledger',
  'shift_closings',
  'shifts',
  'products'
]
const snapshot = async () => {
  const out = {}
  for (const t of TABLES)
    out[t] = (
      await svc.pool.query(
        `SELECT COUNT(*)::int n, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) h FROM ${t} x`
      )
    ).rows[0]
  return out
}

test('reprints read the saved documents and change nothing', async (t) => {
  if (!requireDb(t)) return
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
  const sale = ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'P', qty: 2 }]
      },
      owner
    )
  )
  const supplierId = ok(await svc.call('suppliers.create', { name: 'مورد' }, owner)).id
  ok(
    await svc.call(
      'suppliers.addPurchase',
      {
        supplierId,
        total_amount: 45,
        discount: 5,
        paid_amount: 0,
        payment_type: 'آجل',
        items: [{ barcode: 'P', qty: 10, unitCost: 5 }]
      },
      owner
    )
  )
  const purchaseId = (await svc.pool.query('SELECT max(id) id FROM supplier_purchases')).rows[0].id
  ok(
    await svc.call(
      'shifts.close',
      { shiftId: shift.id, actualCash: 20, clientRef: crypto.randomUUID() },
      owner
    )
  )
  const before = await snapshot()
  for (let i = 0; i < 3; i++) {
    const s = ok(await svc.call('sales.reprintData', { saleId: sale.saleId }, owner))
    assert.equal(s.items.length, 1)
    const p = ok(await svc.call('suppliers.purchaseDetail', { purchaseId }, owner))
    assert.deepEqual([p.purchase.gross, p.purchase.discount, p.purchase.total_amount], [50, 5, 45])
    const c = ok(await svc.call('shifts.closeReport', { shiftId: shift.id }, owner))
    assert.equal(c.report.actual.cash, 20)
  }
  assert.deepEqual(await snapshot(), before, 'nothing written by any reprint')
})
