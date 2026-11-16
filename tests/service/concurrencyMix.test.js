'use strict'
// Many people on one product at the same moment (QA campaign 1.8.0): sales from two tills, a
// customer return, a purchase return, a stock count and purchase corrections of the same invoice,
// all at once and repeated. Nothing deadlocks or fails; every request is either carried out once
// or refused as stale; afterwards the stock equals its ledger, the supplier's balance equals its
// account, and the invoice has exactly the revisions that were accepted.
const { test } = require('node:test')
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

test('sales, returns, a count and purchase corrections of one product at once: consistent', async (t) => {
  if (!requireDb(t)) return
  const db = await freshDatabase()
  const svc = await startService(db.url)
  try {
    await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
    await createUser(svc, { username: 'c1', pin: '5173', roleKey: 'cashier' })
    await createUser(svc, { username: 'c2', pin: '6205', roleKey: 'cashier' })
    await seedProducts(
      svc,
      "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('X', 'صنف مزدحم', 10, 15, 0, 'قطعة')"
    )
    const owner = await login(svc, '8642')
    const tills = [await login(svc, '5173'), await login(svc, '6205')]
    const shifts = []
    for (const t2 of tills)
      shifts.push((await svc.call('shifts.open', { startingCash: 100 }, t2)).body.id)
    const supplierId = (await svc.call('suppliers.create', { name: 'مورد' }, owner)).body.id
    const purchase = (
      await svc.call(
        'suppliers.addPurchase',
        {
          supplierId,
          invoice_ref: 'C-1',
          total_amount: 1000,
          paid_amount: 0,
          payment_type: 'آجل',
          clientRef: crypto.randomUUID(),
          items: [{ barcode: 'X', qty: 100, unitCost: 10 }]
        },
        owner
      )
    ).body
    const itemId = (
      await svc.call('suppliers.purchaseDetail', { purchaseId: purchase.purchaseId }, owner)
    ).body.items[0].id
    const sale = (i) =>
      svc.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: shifts[i % 2],
          paymentType: 'نقدي',
          items: [{ barcode: 'X', qty: 1 }]
        },
        tills[i % 2]
      )
    const statuses = []
    for (let round = 0; round < 5; round++) {
      const rev = (
        await svc.pool.query('SELECT revision FROM supplier_purchases WHERE id = $1', [
          purchase.purchaseId
        ])
      ).rows[0].revision
      const jobs = [
        ...Array.from({ length: 8 }, (_, i) => sale(i)),
        svc.call(
          'suppliers.returnPurchase',
          {
            purchaseId: purchase.purchaseId,
            items: [{ purchaseItemId: itemId, qty: 1 }],
            clientRef: crypto.randomUUID()
          },
          owner
        ),
        // Two corrections prepared on the same revision: one is accepted, the other is stale.
        svc.call(
          'suppliers.revisePurchase',
          {
            purchaseId: purchase.purchaseId,
            expectedRevision: rev,
            items: [{ itemId, barcode: 'X', qty: 100 + round, unitCost: 10 }],
            clientRef: crypto.randomUUID()
          },
          owner
        ),
        svc.call(
          'suppliers.revisePurchase',
          {
            purchaseId: purchase.purchaseId,
            expectedRevision: rev,
            items: [{ itemId, barcode: 'X', qty: 100 + round, unitCost: 11 }],
            clientRef: crypto.randomUUID()
          },
          owner
        ),
        svc.call('inventory.count', { barcode: 'X', counted: 50, reason: 'جرد', base: null }, owner)
      ]
      const res = await Promise.race([
        Promise.all(jobs),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('stuck: a deadlock or a lost lock')), 60000)
        )
      ])
      for (const r of res) statuses.push(r.status)
    }
    // Only "done" or a refusal the person can act on – never a failure of the service.
    assert.ok(
      statuses.every((s) => s === 200 || s === 409 || s === 400),
      statuses.join(',')
    )
    assert.deepEqual(await verifyLedger(svc.pool), [], 'the stock equals its ledger')
    const s = (
      await svc.pool.query(
        `SELECT s.debt_balance::float8 AS b,
                COALESCE(SUM(CASE WHEN l.type = 'payment' THEN -l.amount ELSE l.amount END), 0)::float8 AS st
           FROM suppliers s LEFT JOIN supplier_ledger l ON l.supplier_id = s.id WHERE s.id = $1 GROUP BY s.id`,
        [supplierId]
      )
    ).rows[0]
    assert.ok(Math.abs(s.b - s.st) < 0.005, `balance ${s.b} vs account ${s.st}`)
    const revisions = (
      await svc.pool.query(
        'SELECT revision FROM supplier_purchase_revisions WHERE purchase_id = $1 ORDER BY revision',
        [purchase.purchaseId]
      )
    ).rows.map((r) => r.revision)
    const current = (
      await svc.pool.query('SELECT revision FROM supplier_purchases WHERE id = $1', [
        purchase.purchaseId
      ])
    ).rows[0].revision
    assert.deepEqual(
      revisions,
      Array.from({ length: current }, (_, i) => i + 1),
      'one revision per accepted correction, in order'
    )
    const sales = (
      await svc.pool.query(
        'SELECT count(*)::int AS n, count(DISTINCT client_ref)::int AS u FROM sales'
      )
    ).rows[0]
    assert.equal(sales.n, sales.u)
  } finally {
    await svc.close()
    await db.dispose()
  }
})
