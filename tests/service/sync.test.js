'use strict'
// Synchronisation proof suite (stage 4 phase 4, owner requirement 2026-10-15): sales, payments,
// stock movements and supplier receipts can be neither lost nor applied twice – under duplicated,
// delayed, reordered and partially applied operations, lost answers, outages and restarts.
//
// Every scenario ends with the convergence oracle (syncHelpers.differences): every synchronised
// row of the PC is in the cloud with identical content, and the cloud holds nothing else. Scenario
// "replay" also compares the PC's business figures with a fault-free run of the same operations.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb } = require('./helpers')
const { makeSite, differences, figures, syncUntilConverged, ok } = require('./syncHelpers')
const { applyCommand } = require('../../src/server/sync/commands')

const q = async (pool, sql, p) => (await pool.query(sql, p)).rows
const one = async (pool, sql, p) => (await q(pool, sql, p))[0]
const count = async (pool, sql, p) => Number((await one(pool, sql, p)).n)
const pendingOutbox = (site) =>
  count(site.pc.pool, 'SELECT count(*) AS n FROM sync_outbox WHERE acked_at IS NULL')
const cloudCount = (site, table) =>
  count(
    site.cloud.pool,
    'SELECT count(*) AS n FROM cloud_rows WHERE store_id = $1 AND table_name = $2 AND NOT deleted',
    [site.storeId, table]
  )
const stockOf = async (site, barcode) =>
  Number(
    (await one(site.pc.pool, 'SELECT stock_qty FROM products WHERE barcode = $1', [barcode]))
      .stock_qty
  )

/** A mix of everything that moves money or stock at the shop. */
async function shopDay(site, { tag = 'a', sales = 4 } = {}) {
  const made = []
  for (let i = 0; i < sales; i++)
    made.push(
      ok(
        await site.sell([
          { barcode: 'RICE', qty: 1 },
          { barcode: 'SUGAR', qty: 2 }
        ])
      )
    )
  const credit = ok(
    await site.sell([{ barcode: 'RICE', qty: 4 }], 'آجل', {
      client: { id: null, name: `عميل ${tag}`, phone: null, address: '' }
    })
  )
  const item = await one(site.pc.pool, 'SELECT id FROM sale_items WHERE sale_id = $1', [
    made[0].saleId
  ])
  ok(await site.pc.call('sales.returnItem', { saleItemId: item.id, quantity: 1 }, site.owner))
  ok(
    await site.pc.call(
      'clients.repay',
      { clientId: credit.clientId, amount: 30, currentShiftId: site.ownerShift.id },
      site.owner
    )
  )
  ok(
    await site.pc.call(
      'suppliers.addPurchase',
      {
        supplierId: site.supplierId,
        invoice_ref: `LOCAL-${tag}`,
        total_amount: 200,
        paid_amount: 50,
        currentShiftId: site.ownerShift.id,
        items: [{ barcode: 'SUGAR', qty: 8, unitCost: 25 }]
      },
      site.owner
    )
  )
  ok(
    await site.pc.call(
      'suppliers.repay',
      { supplierId: site.supplierId, amount: 20, currentShiftId: site.ownerShift.id },
      site.owner
    )
  )
  return { made, credit }
}

test('capture: a change is queued in the same transaction; a failed sale queues nothing; no secrets leave the PC', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    const before = await count(site.pc.pool, 'SELECT count(*) AS n FROM sync_outbox')
    const sale = ok(await site.sell([{ barcode: 'RICE', qty: 2 }]))
    const queued = await q(
      site.pc.pool,
      'SELECT table_name, pk FROM sync_outbox WHERE id > (SELECT COALESCE(max(id), 0) FROM sync_outbox) - 100 ORDER BY id'
    )
    const tables = new Set(queued.map((r) => r.table_name))
    for (const tname of ['sales', 'sale_items', 'stock_movements', 'products'])
      assert.ok(tables.has(tname), `${tname} queued with the sale`)
    assert.ok(queued.some((r) => r.table_name === 'sales' && r.pk === String(sale.saleId)))

    const mid = await count(site.pc.pool, 'SELECT count(*) AS n FROM sync_outbox')
    assert.ok(mid > before)
    const salesBefore = await count(site.pc.pool, 'SELECT count(*) AS n FROM sales')
    const bad = await site.sell([
      { barcode: 'RICE', qty: 1 },
      { barcode: 'NO-SUCH', qty: 1 }
    ])
    assert.notEqual(bad.status, 200)
    assert.equal(await count(site.pc.pool, 'SELECT count(*) AS n FROM sales'), salesBefore)
    assert.equal(
      await count(site.pc.pool, 'SELECT count(*) AS n FROM sync_outbox'),
      mid,
      'a rolled-back sale leaves no outbox rows'
    )

    await syncUntilConverged(site)
    const users = await q(
      site.cloud.pool,
      "SELECT row_data FROM cloud_rows WHERE table_name = 'users' AND store_id = $1",
      [site.storeId]
    )
    assert.ok(users.length >= 2)
    for (const u of users)
      assert.deepEqual(
        Object.keys(u.row_data).sort(),
        ['created_at', 'id', 'is_active', 'role', 'role_id', 'updated_at', 'username'],
        'only the allow-listed user fields are sent'
      )
    const secretTables = await q(
      site.cloud.pool,
      "SELECT DISTINCT table_name FROM cloud_rows WHERE table_name IN ('sessions', 'role_permissions', 'receipt_templates', 'sync_outbox', 'schema_migrations')"
    )
    assert.deepEqual(secretTables, [])
    assert.deepEqual(await differences(site), [])
  } finally {
    await site.close()
  }
})

test('first registration sends the existing data once, then only changes; the cloud matches the PC exactly', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    await shopDay(site)
    const first = await syncUntilConverged(site)
    assert.equal(first.epoch, 1)
    assert.equal(await pendingOutbox(site), 0)
    assert.deepEqual(await differences(site), [])
    const pushesBefore = site.transport.pushes
    const quiet = await site.agent.runOnce()
    assert.equal(quiet.pushed, 0, 'nothing new, nothing sent')
    assert.equal(site.transport.pushes, pushesBefore)
    assert.equal(quiet.check.ok, true)
    await shopDay(site, { tag: 'b', sales: 2 })
    const next = await syncUntilConverged(site)
    assert.ok(next.pushed > 0 && next.pushed < 200, 'only the new changes')
    assert.deepEqual(await differences(site), [])
  } finally {
    await site.close()
  }
})

test('duplicated delivery: every batch arrives twice, and old acknowledged batches are replayed – nothing doubles', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    site.transport.duplicate = true
    await shopDay(site)
    await syncUntilConverged(site)
    assert.deepEqual(await differences(site), [])
    // Replay every batch the PC ever sent, straight to the cloud.
    const sent = await q(
      site.pc.pool,
      'SELECT id, table_name, pk, op, row_data::text AS row_text, version FROM sync_outbox ORDER BY id'
    )
    const replay = sent.map((x) => ({
      id: Number(x.id),
      t: x.table_name,
      k: x.pk,
      op: x.op,
      r: x.row_text,
      v: Number(x.version)
    }))
    for (let i = 0; i < replay.length; i += 40)
      await site.transport.inner.push({ epoch: 1, rows: replay.slice(i, i + 40) })
    assert.deepEqual(await differences(site), [], 'replayed history changes nothing')
    for (const tname of ['sales', 'sale_items', 'stock_movements', 'safe_ledger', 'client_ledger'])
      assert.equal(
        await cloudCount(site, tname),
        await count(site.pc.pool, `SELECT count(*) AS n FROM ${tname}`),
        `${tname}: one cloud row per PC row`
      )
  } finally {
    await site.close()
  }
})

test('lost answers: the cloud committed but the PC never heard – the re-send is harmless', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    await syncUntilConverged(site)
    await shopDay(site)
    const waiting = await pendingOutbox(site)
    site.transport.loseResponse = 3
    for (let i = 0; i < 3; i++) await assert.rejects(site.agent.runOnce(), /answer lost/)
    assert.equal(await pendingOutbox(site), waiting, 'still unacknowledged on the PC')
    assert.ok((await cloudCount(site, 'sales')) > 0, 'although the cloud already has them')
    const state = await one(site.pc.pool, 'SELECT last_error FROM sync_state')
    assert.match(state.last_error, /answer lost/)
    await syncUntilConverged(site)
    assert.equal(await pendingOutbox(site), 0)
    assert.deepEqual(await differences(site), [])
    assert.equal((await one(site.pc.pool, 'SELECT last_error FROM sync_state')).last_error, null)
  } finally {
    await site.close()
  }
})

test('delayed and reordered delivery: stale batches arriving after newer ones change nothing', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    await syncUntilConverged(site)
    site.transport.hold = true
    ok(await site.sell([{ barcode: 'RICE', qty: 1 }]))
    await assert.rejects(site.agent.runOnce(), /delayed/)
    ok(await site.sell([{ barcode: 'RICE', qty: 3 }]))
    await assert.rejects(site.agent.runOnce(), /delayed/)
    assert.equal(site.transport.held.length, 2)
    site.transport.hold = false
    await syncUntilConverged(site)
    const cloudRice = async () =>
      await one(
        site.cloud.pool,
        "SELECT row_data->>'stock_qty' AS s, version FROM cloud_rows WHERE table_name = 'products' AND pk = 'RICE'"
      )
    const fresh = await cloudRice()
    assert.equal(Number(fresh.s), await stockOf(site, 'RICE'))
    // The delayed batches now arrive, newest first then oldest: both are older than the cloud.
    assert.equal(await site.transport.deliverHeld({ newestFirst: true }), 2)
    assert.deepEqual(await cloudRice(), fresh)
    assert.deepEqual(await differences(site), [])
  } finally {
    await site.close()
  }
})

test('partially applied batches: a cloud failure mid-batch rolls the batch back; finished batches stay; nothing is lost or doubled', async (t) => {
  if (!requireDb(t)) return
  let failOn = 0
  let calls = 0
  const site = await makeSite({
    cloudHooks: {
      beforeCommit: async () => {
        calls += 1
        if (calls === failOn) throw new Error('cloud crashed before commit (test)')
      }
    }
  })
  try {
    await syncUntilConverged(site)
    await shopDay(site, { sales: 12 }) // well over one batch of 50 rows
    const waiting = await pendingOutbox(site)
    assert.ok(waiting > 100)
    const cloudRowsBefore = await count(
      site.cloud.pool,
      'SELECT count(*) AS n FROM cloud_rows WHERE store_id = $1',
      [site.storeId]
    )
    calls = 0
    failOn = 3 // batches 1 and 2 commit, batch 3 fails inside the cloud transaction
    await assert.rejects(site.agent.runOnce(), /500|crashed|internal/)
    const left = await pendingOutbox(site)
    assert.ok(left > 0 && left < waiting, 'two batches acknowledged, the rest still waiting')
    const cloudRowsAfter = await count(
      site.cloud.pool,
      'SELECT count(*) AS n FROM cloud_rows WHERE store_id = $1',
      [site.storeId]
    )
    assert.ok(cloudRowsAfter > cloudRowsBefore)
    assert.ok(cloudRowsAfter - cloudRowsBefore <= waiting - left, 'nothing from the failed batch')
    // Every local transaction (a sale, a return, a receipt…) is in the cloud entirely or not at all.
    const split = await q(
      site.pc.pool,
      `SELECT tx_id::text FROM sync_outbox GROUP BY tx_id
        HAVING bool_or(acked_at IS NULL) AND bool_or(acked_at IS NOT NULL)`
    )
    assert.deepEqual(split, [], 'no transaction was split between batches')
    failOn = 0
    await syncUntilConverged(site)
    assert.deepEqual(await differences(site), [])
  } finally {
    await site.close()
  }
})

test('outage and restart: a backlog built offline survives an agent restart and arrives once', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    await syncUntilConverged(site)
    site.transport.offlineAll = true
    await shopDay(site, { sales: 10 })
    for (let i = 0; i < 3; i++) await assert.rejects(site.agent.runOnce(), /offline/)
    const backlog = await pendingOutbox(site)
    assert.ok(backlog > 50)
    // The app restarts: a brand-new agent, same database.
    site.agent.stop()
    const restarted = site.newAgent()
    site.transport.offlineAll = false
    await syncUntilConverged(site, restarted)
    assert.equal(await pendingOutbox(site), 0)
    assert.deepEqual(await differences(site), [])
  } finally {
    await site.close()
  }
})

test('a sale committing while the agent pushes is sent on the next push, never skipped', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    await syncUntilConverged(site)
    const c = await site.pc.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query(
        `INSERT INTO expenses (amount, description, timestamp, shift_id) VALUES (12.5, 'تذكرة', LOCALTIMESTAMP(0), $1)`,
        [site.ownerShift.id]
      )
      // Meanwhile later changes commit and are pushed.
      ok(await site.sell([{ barcode: 'RICE', qty: 1 }]))
      const r = await site.agent.runOnce()
      assert.equal(r.check.ok, true, 'the uncommitted expense is not visible yet')
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    await syncUntilConverged(site)
    assert.equal(await cloudCount(site, 'expenses'), 1)
    assert.deepEqual(await differences(site), [])
  } finally {
    await site.close()
  }
})

test('deletions and key changes reach the cloud as deletions; a key used again comes back', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    const expense = ok(
      await site.pc.call(
        'expenses.create',
        { amount: 40, description: 'كهرباء', currentShiftId: site.ownerShift.id },
        site.owner
      )
    )
    await site.pc.pool.query(
      "INSERT INTO product_barcodes (barcode, product_barcode) VALUES ('ALT1', 'RICE')"
    )
    await syncUntilConverged(site)
    const expenseId =
      expense.id ?? (await one(site.pc.pool, 'SELECT max(id) AS id FROM expenses')).id
    ok(await site.pc.call('expenses.delete', { expenseId }, site.owner))
    await site.pc.pool.query("UPDATE product_barcodes SET barcode = 'ALT2' WHERE barcode = 'ALT1'")
    await syncUntilConverged(site)
    const state = async (tname, k) =>
      (
        await one(
          site.cloud.pool,
          'SELECT deleted FROM cloud_rows WHERE store_id = $1 AND table_name = $2 AND pk = $3',
          [site.storeId, tname, String(k)]
        )
      )?.deleted
    assert.equal(await state('expenses', expenseId), true)
    assert.equal(await state('product_barcodes', 'ALT1'), true)
    assert.equal(await state('product_barcodes', 'ALT2'), false)
    await site.pc.pool.query(
      "INSERT INTO product_barcodes (barcode, product_barcode) VALUES ('ALT1', 'SUGAR')"
    )
    await syncUntilConverged(site)
    assert.equal(await state('product_barcodes', 'ALT1'), false)
    assert.deepEqual(await differences(site), [])
  } finally {
    await site.close()
  }
})

test("the PC's database connections are killed in the middle of a sync cycle: no crash, nothing lost, nothing doubled", async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    await syncUntilConverged(site)
    await shopDay(site)
    // Like a PostgreSQL restart on the PC right after the cloud committed a batch: every
    // connection – including the agent's lock connection – is cut.
    site.transport.afterPush = async () => {
      const { Client } = require('pg')
      const c = new Client({ connectionString: site.pcUrl })
      await c.connect()
      await c.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()'
      )
      await c.end()
    }
    await site.agent.runOnce().catch(() => {}) // may fail or finish on fresh connections
    // The process is still alive, and the agent's lock died with its connection.
    await syncUntilConverged(site, site.newAgent())
    assert.equal(await pendingOutbox(site), 0)
    assert.deepEqual(await differences(site), [])
    for (const tname of ['sales', 'stock_movements', 'safe_ledger'])
      assert.equal(
        await cloudCount(site, tname),
        await count(site.pc.pool, `SELECT count(*) AS n FROM ${tname}`)
      )
  } finally {
    await site.close()
  }
})

test("owner's example: 1 can, 10 sold offline, 24 received remotely → 15; the receipt applies once whatever happens", async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    await syncUntilConverged(site)
    site.transport.offlineAll = true
    for (let i = 0; i < 10; i++) ok(await site.sell([{ barcode: 'CAN', qty: 1 }]))
    assert.equal(await stockOf(site, 'CAN'), -9)
    const id = await site.command('stock_receipt', {
      items: [{ barcode: 'CAN', qty: 24, unitCost: 8 }]
    })
    const status = async () =>
      (await one(site.cloud.pool, 'SELECT status FROM cloud_commands WHERE id = $1', [id])).status
    assert.equal(await status(), 'pending', 'waiting for the shop')
    site.transport.offlineAll = false
    // The PC pulls and applies the command but the outcome is not pushed yet (simulated by
    // applying from a pull directly): the cloud still says pending.
    const pulled = await site.transport.inner.pullCommands()
    assert.equal(pulled.length, 1)
    const first = await applyCommand(site.pc.pool, pulled[0])
    assert.equal(first.status, 'applied')
    assert.equal(await stockOf(site, 'CAN'), 15)
    assert.equal(await status(), 'pending', 'not reported as applied before the PC result arrives')
    // Re-delivered (the cloud still lists it): skipped, not applied again.
    const again = await applyCommand(site.pc.pool, pulled[0])
    assert.equal(again.duplicate, true)
    const r = await site.agent.runOnce()
    assert.ok(
      r.commands.every((c) => c.duplicate),
      'a re-pulled command is skipped'
    )
    await syncUntilConverged(site)
    assert.equal(await status(), 'applied')
    assert.equal(await stockOf(site, 'CAN'), 15)
    assert.equal(
      await count(
        site.pc.pool,
        "SELECT count(*) AS n FROM stock_movements WHERE product_barcode = 'CAN' AND kind = 'purchase'"
      ),
      1
    )
    assert.deepEqual(await differences(site), [])
    // Pulled again later: no longer pending, so not delivered at all.
    assert.equal((await site.transport.inner.pullCommands()).length, 0)
  } finally {
    await site.close()
  }
})

test('a command interrupted half way leaves nothing behind and is applied exactly once later', async (t) => {
  if (!requireDb(t)) return
  let crash = true
  const site = await makeSite()
  try {
    await syncUntilConverged(site)
    const agent = site.newAgent({
      commandHooks: {
        afterEffects: async () => {
          if (crash) throw new Error('power cut before commit (test)')
        }
      }
    })
    const debtBefore = Number(
      (
        await one(site.pc.pool, 'SELECT debt_balance FROM suppliers WHERE id = $1', [
          site.supplierId
        ])
      ).debt_balance
    )
    const sugarBefore = await stockOf(site, 'SUGAR')
    const id = await site.command('supplier_invoice', {
      supplierId: site.supplierId,
      invoice_ref: 'REMOTE-1',
      paid_amount: 100,
      items: [
        { barcode: 'SUGAR', qty: 10, unitCost: 26 },
        { barcode: 'RICE', qty: 5, unitCost: 21 }
      ]
    })
    await assert.rejects(agent.runOnce(), /power cut/)
    const nothing = {
      purchases: await count(
        site.pc.pool,
        "SELECT count(*) AS n FROM supplier_purchases WHERE invoice_ref = 'REMOTE-1'"
      ),
      movements: await count(
        site.pc.pool,
        "SELECT count(*) AS n FROM stock_movements WHERE kind = 'purchase' AND reason LIKE '%REMOTE-1%'"
      ),
      claimed: await count(
        site.pc.pool,
        'SELECT count(*) AS n FROM applied_commands WHERE command_id = $1',
        [id]
      )
    }
    assert.deepEqual(nothing, { purchases: 0, movements: 0, claimed: 0 }, 'all or nothing')
    assert.equal(await stockOf(site, 'SUGAR'), sugarBefore)
    crash = false
    await syncUntilConverged(site, agent)
    assert.equal(await stockOf(site, 'SUGAR'), sugarBefore + 10)
    assert.equal(
      await count(
        site.pc.pool,
        "SELECT count(*) AS n FROM supplier_purchases WHERE invoice_ref = 'REMOTE-1'"
      ),
      1
    )
    const debtAfter = Number(
      (
        await one(site.pc.pool, 'SELECT debt_balance FROM suppliers WHERE id = $1', [
          site.supplierId
        ])
      ).debt_balance
    )
    assert.equal(debtAfter, debtBefore + (260 + 105 - 100), 'only the unpaid remainder is owed')
    assert.equal(
      await count(
        site.pc.pool,
        "SELECT count(*) AS n FROM safe_ledger WHERE description LIKE '%REMOTE-1%'"
      ),
      0,
      'paid outside the drawer: the shift is untouched'
    )
    const cmd = await one(
      site.cloud.pool,
      'SELECT status, result FROM cloud_commands WHERE id = $1',
      [id]
    )
    assert.equal(cmd.status, 'applied')
    assert.ok(cmd.result.purchaseId > 0)
    // Audited on the PC as the remote owner, with the command id.
    const log = await one(
      site.pc.pool,
      "SELECT username, details FROM system_logs WHERE action_type = 'supplier_purchase' AND description LIKE '%REMOTE-1%'"
    )
    assert.equal(log.username, 'المالك (عن بعد)')
    assert.equal(JSON.parse(log.details).commandId, id)
    assert.deepEqual(await differences(site), [])
  } finally {
    await site.close()
  }
})

test('conflicts: fields changed on the PC since the owner looked are kept and reported; the rest is applied', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    await syncUntilConverged(site)
    // While the owner edits from the cloud, the shop changes the retail price locally.
    await site.pc.pool.query("UPDATE products SET retail_price = 11 WHERE barcode = 'CAN'")
    const priceId = await site.command('price_edit', {
      barcode: 'CAN',
      fields: { retail_price: 12, wholesale_price: 9.5 },
      base: { retail_price: 10, wholesale_price: 9 }
    })
    const soda = ok(await site.pc.call('categories.save', { name: 'مياه غازية' }, site.owner))
    const nameId = await site.command('product_edit', {
      barcode: 'CAN',
      fields: { name: 'كانز 330 مل', category_id: soda.id },
      base: { name: 'كانز', category_id: null }
    })
    const allConflict = await site.command('product_edit', {
      barcode: 'RICE',
      fields: { name: 'أرز مصري' },
      base: { name: 'أرز أبيض' }
    })
    await syncUntilConverged(site)
    const can = await one(site.pc.pool, "SELECT * FROM products WHERE barcode = 'CAN'")
    assert.deepEqual(
      [
        Number(can.retail_price),
        Number(can.wholesale_price),
        can.name,
        can.category,
        can.category_id
      ],
      [11, 9.5, 'كانز 330 مل', 'مياه غازية', soda.id]
    )
    const cmds = Object.fromEntries(
      (await q(site.cloud.pool, 'SELECT id::text, status, result FROM cloud_commands')).map((c) => [
        c.id,
        c
      ])
    )
    assert.equal(cmds[priceId].status, 'partially_applied')
    assert.deepEqual(cmds[priceId].result.applied, ['wholesale_price'])
    assert.deepEqual(
      cmds[priceId].result.conflicts.map((c) => [c.field, c.base, Number(c.local), c.remote]),
      [['retail_price', 10, 11, 12]]
    )
    assert.equal(cmds[nameId].status, 'applied')
    assert.equal(cmds[allConflict].status, 'rejected')
    assert.equal(cmds[allConflict].result.reason, 'conflict')
    assert.equal(
      (await one(site.pc.pool, "SELECT name FROM products WHERE barcode = 'RICE'")).name,
      'أرز'
    )
    assert.deepEqual(await differences(site), [])
  } finally {
    await site.close()
  }
})

test('refused commands are recorded once and never retried; unknown types are refused', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    await syncUntilConverged(site)
    const unknownProduct = await site.command('stock_receipt', {
      items: [{ barcode: 'GHOST', qty: 5, unitCost: 1 }]
    })
    const badType = await site.command('drawer_withdrawal', { amount: 1000 })
    const negative = await site.command('stock_receipt', {
      items: [
        { barcode: 'RICE', qty: 5, unitCost: 20 },
        { barcode: 'SUGAR', qty: -3, unitCost: 25 }
      ]
    })
    // Half a bag of a product sold by the piece: refused like at the shop.
    const fractional = await site.command('stock_receipt', {
      items: [{ barcode: 'RICE', qty: 2.5, unitCost: 20 }]
    })
    const riceBefore = await stockOf(site, 'RICE')
    await syncUntilConverged(site)
    const rows = await q(
      site.cloud.pool,
      'SELECT id::text, status, result FROM cloud_commands ORDER BY seq'
    )
    for (const id of [unknownProduct, badType, negative, fractional]) {
      const c = rows.find((r) => r.id === id)
      assert.equal(c.status, 'rejected', id)
      assert.ok(c.result.reason)
    }
    assert.equal(
      await stockOf(site, 'RICE'),
      riceBefore,
      'a refused command applies none of its lines'
    )
    const r = await site.agent.runOnce()
    assert.deepEqual(r.commands, [], 'not delivered again')
  } finally {
    await site.close()
  }
})

test('stale epoch: once the store has moved to a new epoch, an old copy of the PC cannot overwrite the cloud', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    await shopDay(site)
    await syncUntilConverged(site)
    const snapshot = await q(
      site.cloud.pool,
      'SELECT table_name, pk, version FROM cloud_rows WHERE store_id = $1 ORDER BY 1, 2',
      [site.storeId]
    )
    // The store restored a backup on a new PC, which took epoch 2.
    assert.deepEqual(await site.transport.inner.newEpoch(), { epoch: 2 })
    // The old PC keeps selling and tries to push in epoch 1.
    ok(await site.sell([{ barcode: 'RICE', qty: 1 }]))
    await assert.rejects(site.agent.runOnce(), /epoch/)
    assert.deepEqual(
      await q(
        site.cloud.pool,
        'SELECT table_name, pk, version FROM cloud_rows WHERE store_id = $1 ORDER BY 1, 2',
        [site.storeId]
      ),
      snapshot,
      'nothing from the old copy was accepted'
    )
  } finally {
    await site.close()
  }
})

test('the cloud refuses requests without the store token', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    const call = (headers) =>
      site.cloud.app.inject({ method: 'POST', url: '/api/sync.commands', payload: {}, headers })
    assert.equal((await call({})).statusCode, 401)
    assert.equal(
      (await call({ 'x-store-id': site.storeId, authorization: 'Bearer wrong-token' })).statusCode,
      401
    )
    assert.equal(
      (await call({ 'x-store-id': crypto.randomUUID(), authorization: `Bearer ${site.token}` }))
        .statusCode,
      401
    )
    assert.equal(
      (await call({ 'x-store-id': site.storeId, authorization: `Bearer ${site.token}` }))
        .statusCode,
      200
    )
  } finally {
    await site.close()
  }
})

test('replay: with every fault at once, the PC ends exactly where a fault-free run of the same operations ends', async (t) => {
  if (!requireDb(t)) return
  const faulty = await makeSite()
  const clean = await makeSite()
  try {
    const commandIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    const commands = [
      ['stock_receipt', { items: [{ barcode: 'CAN', qty: 24, unitCost: 8 }] }],
      [
        'supplier_invoice',
        {
          supplierId: null, // set per site below
          invoice_ref: 'REMOTE-R',
          paid_amount: 0,
          items: [{ barcode: 'RICE', qty: 10, unitCost: 22 }]
        }
      ],
      ['price_edit', { barcode: 'SUGAR', fields: { retail_price: 32 }, base: { retail_price: 30 } }]
    ]
    const queue = async (site) => {
      for (const [i, [type, payload]] of commands.entries())
        await site.command(
          type,
          type === 'supplier_invoice' ? { ...payload, supplierId: site.supplierId } : payload,
          commandIds[i]
        )
    }

    // Faulty site: outages, lost answers, duplicates, delays, a crash in the middle of a command.
    let crashes = 1
    const agent = faulty.newAgent({
      commandHooks: {
        afterEffects: async () => {
          if (crashes-- > 0) throw new Error('crash (test)')
        }
      }
    })
    await syncUntilConverged(faulty, agent)
    faulty.transport.offlineAll = true
    await shopDay(faulty, { tag: 'r', sales: 6 })
    await queue(faulty)
    await assert.rejects(agent.runOnce())
    faulty.transport.offlineAll = false
    faulty.transport.loseResponse = 2
    faulty.transport.duplicate = true
    for (let i = 0; i < 4; i++) await agent.runOnce().catch(() => {})
    faulty.transport.hold = true
    for (let i = 0; i < 2; i++) ok(await faulty.sell([{ barcode: 'CAN', qty: 2 }]))
    await agent.runOnce().catch(() => {})
    faulty.transport.hold = false
    faulty.transport.duplicate = false
    await syncUntilConverged(faulty, agent)
    await faulty.transport.deliverHeld()
    await syncUntilConverged(faulty, agent)

    // Clean site: the same operations, the commands applied once, no sync at all.
    await shopDay(clean, { tag: 'r', sales: 6 })
    await queue(clean)
    for (const c of await clean.transport.inner.pullCommands()) await applyCommand(clean.pc.pool, c)
    for (let i = 0; i < 2; i++) ok(await clean.sell([{ barcode: 'CAN', qty: 2 }]))

    const a = await figures(faulty.pc.pool)
    const b = await figures(clean.pc.pool)
    assert.deepEqual(a, b, 'stock, costs, balances, drawer and command outcomes match')
    assert.equal(Number(a.products.find((p) => p.barcode === 'CAN').stock_qty), 21, '1 + 24 − 4')
    assert.deepEqual(await differences(faulty), [])
    const statuses = (
      await q(faulty.cloud.pool, 'SELECT status FROM cloud_commands ORDER BY seq')
    ).map((r) => r.status)
    assert.deepEqual(statuses, ['applied', 'applied', 'applied'])
  } finally {
    await faulty.close()
    await clean.close()
  }
})

test('backlog: a busy week offline (400 sales) catches up in well under a minute', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    await syncUntilConverged(site)
    site.transport.offlineAll = true
    for (let i = 0; i < 400; i++)
      ok(
        await site.sell([
          { barcode: 'RICE', qty: 1 },
          { barcode: 'SUGAR', qty: 1 }
        ])
      )
    const backlog = await pendingOutbox(site)
    site.transport.offlineAll = false
    const agent = site.newAgent({ batchSize: 500 })
    const started = Date.now()
    await syncUntilConverged(site, agent)
    const ms = Date.now() - started
    t.diagnostic(`backlog of ${backlog} changes synchronised in ${ms} ms`)
    assert.ok(ms < 60000, `${ms} ms`)
    assert.deepEqual(await differences(site), [])
  } finally {
    await site.close()
  }
})
