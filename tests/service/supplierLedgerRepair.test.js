'use strict'
// QA-03 (1.8.0): a preliminary invoice cancelled with its payment given back by the supplier left
// the supplier's account, read as a statement, saying the store owed what had come back. Now the
// cancellation enters both sides; a store holding such a cancellation from before is put right
// once at its next start (money/repairs.js) – its balance never changes.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

const statement = async (pool, id) =>
  (
    await pool.query(
      `SELECT s.debt_balance::float8 AS balance,
              COALESCE(SUM(CASE WHEN l.type = 'payment' THEN -l.amount ELSE l.amount END), 0)::float8 AS statement,
              count(l.id)::int AS rows
         FROM suppliers s LEFT JOIN supplier_ledger l ON l.supplier_id = s.id WHERE s.id = $1 GROUP BY s.id`,
      [id]
    )
  ).rows[0]

test('a cancelled preliminary invoice whose payment came back: the account agrees with the balance', async (t) => {
  if (!requireDb(t)) return
  const db = await freshDatabase()
  let svc = await startService(db.url)
  try {
    await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
    const owner = await login(svc, '8642')
    const shift = (await svc.call('shifts.open', { startingCash: 500 }, owner)).body
    const supplierId = (await svc.call('suppliers.create', { name: 'مورد' }, owner)).body.id
    const create = async (mode) =>
      (
        await svc.call(
          'supplierInvoices.createPending',
          {
            supplierId,
            total: 100,
            paymentMode: mode,
            paid: mode === 'partial' ? 40 : null,
            currentShiftId: shift.id,
            clientRef: crypto.randomUUID()
          },
          owner
        )
      ).body.invoice
    for (const mode of ['partial', 'cash']) {
      const inv = await create(mode)
      const r = await svc.call(
        'supplierInvoices.cancel',
        {
          invoiceId: inv.id,
          refund: 'returned',
          destination: 'shift',
          currentShiftId: shift.id,
          clientRef: crypto.randomUUID()
        },
        owner
      )
      assert.equal(r.status, 200)
    }
    let s = await statement(svc.pool, supplierId)
    assert.equal(s.balance, 0)
    assert.equal(s.statement, 0, 'the account reads as the balance')

    // A store from before 1.8.0: the cancellation of the payment was not entered.
    await svc.pool.query(
      "DELETE FROM supplier_ledger WHERE supplier_id = $1 AND type = 'adjustment' AND description LIKE '%أعاده المورد'",
      [supplierId]
    )
    s = await statement(svc.pool, supplierId)
    assert.equal(s.statement, 140, 'the earlier fault: the statement showed 40 + 100 owed')
    assert.equal(s.balance, 0)
    // Its next start puts it right, once; the balance is not touched.
    await svc.close()
    svc = await startService(db.url)
    s = await statement(svc.pool, supplierId)
    assert.deepEqual([s.balance, s.statement], [0, 0])
    const rows = s.rows
    await svc.close()
    svc = await startService(db.url)
    s = await statement(svc.pool, supplierId)
    assert.equal(s.rows, rows, 'a second start adds nothing')
    const marked = await svc.pool.query(
      "SELECT count(*)::int AS n FROM supplier_ledger WHERE description LIKE '%(تصحيح سجل الحساب، 1.8.0)'"
    )
    assert.equal(marked.rows[0].n, 2)
  } finally {
    await svc.close()
    await db.dispose()
  }
})

test('the cloud never runs the repair (the shop’s rows reach it by synchronisation)', async (t) => {
  if (!requireDb(t)) return
  const db = await freshDatabase()
  const svc = await startService(db.url, { role: 'cloud' })
  try {
    // A cloud copy holding the earlier fault keeps it until the shop's repair arrives.
    await svc.pool.query("INSERT INTO suppliers (id, name, debt_balance) VALUES (7, 'مورد', 0)")
    await svc.pool.query(
      `INSERT INTO supplier_pending_invoices (supplier_id, total, paid, payment_mode, method, destination, status, cancel_refund, cancelled_at)
       VALUES (7, 100, 100, 'cash', 'cash', 'treasury', 'cancelled', 'returned', LOCALTIMESTAMP(0))`
    )
    await svc.close()
    const again = await startService(db.url, { role: 'cloud' })
    const n = (await again.pool.query('SELECT count(*)::int AS n FROM supplier_ledger')).rows[0].n
    await again.close()
    assert.equal(n, 0)
  } finally {
    await db.dispose()
  }
})
