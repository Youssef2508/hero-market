'use strict'
// Backup and restore audit (owner, 2026-10-22, D-067). A store using every feature – sales by every
// method, credit and partial sales, returns, payment corrections, collections, expenses, damaged
// goods, packages, purchases with a discount, purchase returns with money back, preliminary
// invoices completed and cancelled, the treasury per method and a closed shift – is backed up and
// restored into a separate, disposable database. Every backed-up table must come back row for row
// (compared by content, not only by count), balances and stock must agree, the restored store must
// keep working, and a restore that fails must change nothing. Every table of the schema is either
// backed up or listed here with the reason it is not.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')
const { TABLES } = require('../../src/server/modules/backup')

// Tables deliberately outside the backup, and why.
const NOT_BACKED_UP = {
  sessions: 'everyone signs in again after a restore',
  schema_migrations: 'a backup restores only into the same schema version',
  sync_outbox: 'synchronisation restarts in a new epoch after a restore (D-047)',
  sync_row_versions: 'same',
  sync_state: 'the store’s own link to the cloud stays as it is',
  sync_tables: 'fixed list written by the migrations',
  applied_commands: 'cloud commands; the new sync epoch governs them after a restore (D-047)',
  catalog_state: 'a cache version counter the tills re-read'
}

let db, svc, owner, cashier, backup
const ref = () => crypto.randomUUID()
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const one = async (pool, sql, p) => (await pool.query(sql, p)).rows[0]

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')

  ok(
    await svc.call(
      'storeImport.apply',
      {
        products: [
          {
            row: 2,
            barcode: 'HOHO',
            name: 'هوهوز',
            retail_price: 10,
            cost_price: 8,
            stock_qty: 100,
            unit: 'قطعة',
            category: 'حلويات',
            pack_name: 'علبة',
            pack_factor: 10,
            pack_barcode: 'HOHO-BOX',
            pack_price: 90,
            pack_cost: 80
          },
          {
            row: 3,
            barcode: 'CHEESE',
            name: 'جبنة',
            retail_price: 240,
            cost_price: 200,
            stock_qty: 10.5,
            unit: 'كيلو'
          },
          { row: 4, barcode: 'OIL', name: 'زيت', retail_price: 90, cost_price: 70, stock_qty: 30 }
        ],
        customers: [{ row: 2, name: 'عميل آجل', phone: '01001234567', balance: 100 }],
        suppliers: [{ row: 2, name: 'مورد', phone: '0223456789', balance: 500 }]
      },
      owner
    )
  )
  const clientId = (await one(svc.pool, 'SELECT id FROM clients LIMIT 1')).id
  const supplierId = (await one(svc.pool, 'SELECT id FROM suppliers LIMIT 1')).id
  const boxId = (await one(svc.pool, 'SELECT id FROM product_units LIMIT 1')).id
  const shift = ok(await svc.call('shifts.open', { startingCash: 100 }, cashier))
  const sell = (body) =>
    svc.call(
      'pos.checkout',
      { clientRef: ref(), shiftId: shift.id, paymentType: 'نقدي', ...body },
      cashier
    )
  const cashSale = ok(await sell({ items: [{ barcode: 'OIL', qty: 2 }] }))
  ok(await sell({ paymentType: 'فيزا', items: [{ barcode: 'HOHO', unitId: boxId, qty: 1 }] }))
  ok(
    await sell({
      paymentType: 'آجل',
      client: { id: clientId, name: 'عميل آجل' },
      items: [{ barcode: 'CHEESE', qty: 0.5 }]
    })
  )
  ok(
    await sell({
      paymentType: 'دفع جزئي',
      paidAmount: 50,
      upfrontMethod: 'instapay',
      client: { id: clientId, name: 'عميل آجل' },
      items: [
        { barcode: 'OIL', qty: 1 },
        { barcode: 'HOHO', qty: 3 }
      ]
    })
  )
  const item = await one(svc.pool, 'SELECT id FROM sale_items WHERE sale_id = $1', [
    cashSale.saleId
  ])
  ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: item.id, quantity: 1, reason: 'تالف', currentShiftId: shift.id },
      owner
    )
  )
  const visaLater = ok(await sell({ items: [{ barcode: 'HOHO', qty: 2 }] }))
  ok(
    await svc.call(
      'sales.changePaymentMethod',
      { saleId: visaLater.saleId, method: 'visa', clientRef: ref() },
      owner
    )
  )
  ok(
    await svc.call(
      'clients.repay',
      { clientId, amount: 40, method: 'wallet', destination: 'treasury', clientRef: ref() },
      owner
    )
  )
  ok(
    await svc.call(
      'expenses.create',
      { amount: 15, destination: 'treasury', method: 'cash', clientRef: ref() },
      owner
    )
  )
  ok(await svc.call('damaged.create', { barcode: 'OIL', quantity: 1 }, owner))
  ok(await svc.call('treasury.record', { kind: 'deposit', amount: 1000, clientRef: ref() }, owner))
  // Purchases: a discounted invoice in boxes, a return of part of it with money back.
  ok(
    await svc.call(
      'suppliers.addPurchase',
      {
        supplierId,
        total_amount: 760,
        discount: 40,
        paid_amount: 0,
        payment_type: 'آجل',
        items: [{ barcode: 'HOHO', unitId: boxId, qty: 10, unitCost: 80 }]
      },
      owner
    )
  )
  const purchaseId = (await one(svc.pool, 'SELECT max(id) id FROM supplier_purchases')).id
  const pItem = (
    await one(svc.pool, 'SELECT id FROM supplier_purchase_items WHERE purchase_id = $1', [
      purchaseId
    ])
  ).id
  ok(
    await svc.call(
      'suppliers.returnPurchase',
      {
        purchaseId,
        items: [{ purchaseItemId: pItem, qty: 2 }],
        refundAmount: 100,
        method: 'cash',
        destination: 'treasury',
        clientRef: ref()
      },
      owner
    )
  )
  // Preliminary invoices: one completed, one cancelled with its money returned in the shift.
  const pending = (body) =>
    svc.call(
      'supplierInvoices.createPending',
      { supplierId, currentShiftId: shift.id, clientRef: ref(), ...body },
      cashier
    )
  const p1 = ok(await pending({ total: 70, paymentMode: 'credit' })).invoice
  ok(
    await svc.call(
      'supplierInvoices.convert',
      { invoiceId: p1.id, items: [{ barcode: 'OIL', qty: 1, unitCost: 70 }], clientRef: ref() },
      owner
    )
  )
  const p2 = ok(await pending({ total: 30, paymentMode: 'cash' })).invoice
  ok(
    await svc.call(
      'supplierInvoices.cancel',
      {
        invoiceId: p2.id,
        refund: 'returned',
        method: 'cash',
        destination: 'shift',
        currentShiftId: shift.id,
        clientRef: ref()
      },
      cashier
    )
  )
  // The close: counted = expected for every method, transferred to the treasury.
  const expected = ok(await svc.call('shifts.details', { shiftId: shift.id }, owner)).report
    .expected
  ok(
    await svc.call(
      'shifts.close',
      {
        shiftId: shift.id,
        actualCash: expected.cash,
        actual: { visa: expected.visa, wallet: expected.wallet, instapay: expected.instapay },
        clientRef: ref()
      },
      cashier
    )
  )
  backup = JSON.parse(JSON.stringify(ok(await svc.call('backup.export', {}, owner))))
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

/** Each table's rows as one fingerprint (all columns; rows in a total order of their text). */
async function fingerprints(pool) {
  const out = {}
  for (const t of TABLES) {
    const r = await one(
      pool,
      `SELECT COUNT(*)::int n, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) h FROM "${t}" x`
    )
    out[t] = `${r.n}:${r.h}`
  }
  return out
}

const money = async (pool) =>
  one(
    pool,
    `SELECT (SELECT json_object_agg(method, s) FROM (SELECT method, SUM(amount)::text s FROM treasury_ledger GROUP BY method) x) AS treasury,
            (SELECT SUM(debt_balance)::text FROM clients) AS clients,
            (SELECT SUM(debt_balance)::text FROM suppliers) AS suppliers,
            (SELECT json_object_agg(barcode, stock_qty::text ORDER BY barcode) FROM products) AS stock,
            (SELECT json_object_agg(barcode, cost_price::text ORDER BY barcode) FROM products) AS cost`
  )

test('every table is backed up, or deliberately left out for a stated reason', async (t) => {
  if (!requireDb(t)) return
  const all = (
    await svc.pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    )
  ).rows.map((r) => r.table_name)
  const missing = all.filter((x) => !TABLES.includes(x) && !(x in NOT_BACKED_UP))
  assert.deepEqual(missing, [], 'a new table must be added to the backup or listed with its reason')
  assert.deepEqual(
    TABLES.filter((x) => !all.includes(x)),
    []
  )
  // The copy holds every column of every backed-up table.
  for (const name of TABLES) {
    const cols = (
      await svc.pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [name]
      )
    ).rows.map((r) => r.column_name)
    assert.deepEqual(backup.tables[name].columns, cols, name)
  }
})

test('restored into a disposable database: every table identical, balances and stock agree, and it keeps working', async (t) => {
  if (!requireDb(t)) return
  const before = await fingerprints(svc.pool)
  const beforeMoney = await money(svc.pool)
  // Every feature above left rows behind (the fixture really covers them).
  for (const name of [
    'sale_returns',
    'sale_payment_corrections',
    'supplier_pending_invoices',
    'supplier_purchase_returns',
    'supplier_purchase_return_items',
    'shift_closings',
    'treasury_ledger',
    'product_units',
    'product_barcodes',
    'damaged_goods',
    'expenses',
    'client_ledger',
    'supplier_ledger',
    'stock_movements'
  ])
    assert.ok(Number(before[name].split(':')[0]) > 0, `${name} has rows in the fixture`)

  const target = await freshDatabase()
  const other = await startService(target.url)
  try {
    await createUser(other, { username: 'restorer', pin: '1357', roleKey: 'super_admin' })
    const token = await login(other, '1357')
    ok(await other.call('backup.restore', { backup, confirm: 'RESTORE' }, token))
    const after = await fingerprints(other.pool)
    for (const name of TABLES) {
      if (name === 'system_logs') continue // the restore adds its own entry
      assert.equal(after[name], before[name], `${name} restored row for row`)
    }
    assert.deepEqual(await money(other.pool), beforeMoney)
    const drift = await other.pool.query(
      `SELECT p.barcode FROM products p LEFT JOIN (SELECT product_barcode, SUM(qty) s FROM stock_movements GROUP BY 1) m
         ON m.product_barcode = p.barcode WHERE COALESCE(p.stock_qty, 0) <> COALESCE(m.s, 0)`
    )
    assert.equal(drift.rowCount, 0, 'stock equals its movements')

    // The restored store works: the restored users sign in, sell, buy and return; new ids follow.
    const maxSale = (await one(other.pool, 'SELECT max(id) m FROM sales')).m
    const o2 = await login(other, '8642')
    const c2 = await login(other, '5173')
    const s2 = ok(await other.call('shifts.open', { startingCash: 0 }, c2))
    const sale = ok(
      await other.call(
        'pos.checkout',
        {
          clientRef: ref(),
          shiftId: s2.id,
          paymentType: 'نقدي',
          items: [{ barcode: 'OIL', qty: 1 }]
        },
        c2
      )
    )
    assert.ok(sale.saleId > maxSale)
    const purchaseId = (await one(other.pool, 'SELECT max(id) id FROM supplier_purchases')).id
    const pItem = (
      await one(
        other.pool,
        'SELECT id FROM supplier_purchase_items WHERE purchase_id = $1 ORDER BY id LIMIT 1',
        [purchaseId]
      )
    ).id
    ok(
      await other.call(
        'suppliers.returnPurchase',
        { purchaseId, items: [{ purchaseItemId: pItem, qty: 1 }], clientRef: ref() },
        o2
      )
    )
    // Returned quantities survived the restore: the 70 bought once cannot go back twice.
    assert.equal(
      (
        await other.call(
          'suppliers.returnPurchase',
          { purchaseId, items: [{ purchaseItemId: pItem, qty: 1 }], clientRef: ref() },
          o2
        )
      ).status,
      409
    )
  } finally {
    await other.close()
    await target.dispose()
  }
})

test('a restore that fails part-way changes nothing', async (t) => {
  if (!requireDb(t)) return
  const target = await freshDatabase()
  const other = await startService(target.url)
  try {
    await createUser(other, { username: 'restorer', pin: '1357', roleKey: 'super_admin' })
    const token = await login(other, '1357')
    const before = await fingerprints(other.pool)
    // A copy whose last sale line points at a sale that does not exist.
    const broken = JSON.parse(JSON.stringify(backup))
    const items = broken.tables.sale_items
    const col = items.columns.indexOf('sale_id')
    items.rows[items.rows.length - 1][col] = '999999'
    const r = await other.call('backup.restore', { backup: broken, confirm: 'RESTORE' }, token)
    assert.notEqual(r.status, 200)
    const now = await fingerprints(other.pool)
    for (const name of TABLES)
      if (name !== 'system_logs') assert.equal(now[name], before[name], name)
    // Another schema version is refused before anything is touched.
    const older = { ...backup, schema: backup.schema.slice(0, -1) }
    assert.equal(
      (await other.call('backup.restore', { backup: older, confirm: 'RESTORE' }, token)).status,
      400
    )
  } finally {
    await other.close()
    await target.dispose()
  }
})
