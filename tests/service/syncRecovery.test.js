'use strict'
// Recovery after restoring a backup (stage 4 phase 4, D-047): what reached the cloud after the
// backup is written back before work resumes; the replaced database can no longer write to the
// cloud; nothing is doubled (owner commands included). Same harness as sync.test.js.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, login, setupOwner } = require('./helpers')
const { makeSite, differences, figures, syncUntilConverged, ok } = require('./syncHelpers')
const { verifyLedger } = require('../../src/server/inventory/stock')

const q = async (pool, sql, p) => (await pool.query(sql, p)).rows
const one = async (pool, sql, p) => (await q(pool, sql, p))[0]

/** Work done after the backup: sales, a credit sale and its repayment, a return, a local
 * purchase, and an owner command – all synchronised before the "disaster". */
async function afterBackup(site) {
  const sale = ok(
    await site.sell([
      { barcode: 'RICE', qty: 3 },
      { barcode: 'SUGAR', qty: 1 }
    ])
  )
  const credit = ok(
    await site.sell([{ barcode: 'SUGAR', qty: 2 }], 'آجل', {
      client: { id: null, name: 'عميل بعد النسخة', phone: null, address: '' }
    })
  )
  const item = await one(site.pc.pool, 'SELECT id FROM sale_items WHERE sale_id = $1 LIMIT 1', [
    sale.saleId
  ])
  ok(await site.pc.call('sales.returnItem', { saleItemId: item.id, quantity: 1 }, site.owner))
  ok(
    await site.pc.call(
      'clients.repay',
      { clientId: credit.clientId, amount: 20, currentShiftId: site.ownerShift.id },
      site.owner
    )
  )
  ok(
    await site.pc.call(
      'suppliers.addPurchase',
      {
        supplierId: site.supplierId,
        invoice_ref: 'AFTER-BACKUP',
        total_amount: 100,
        items: [{ barcode: 'RICE', qty: 5, unitCost: 20 }]
      },
      site.owner
    )
  )
  const commandId = await site.command('stock_receipt', {
    items: [{ barcode: 'CAN', qty: 24, unitCost: 8 }]
  })
  return { sale, credit, commandId }
}

test('restore on the same PC: work pauses, the rows made after the backup come back from the cloud, nothing doubles', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    ok(await site.link())
    ok(await site.sell([{ barcode: 'RICE', qty: 1 }]))
    await syncUntilConverged(site)
    const backup = ok(await site.pc.call('backup.export', {}, site.owner))
    assert.equal(backup.sync.epoch, 1)
    assert.ok(Number(backup.sync.version) > 0)

    const { commandId } = await afterBackup(site)
    await syncUntilConverged(site)
    const lost = await figures(site.pc.pool) // what the shop had before the disaster
    assert.equal(
      (await one(site.cloud.pool, 'SELECT status FROM cloud_commands WHERE id = $1', [commandId]))
        .status,
      'applied'
    )

    ok(await site.pc.call('backup.restore', { backup, confirm: 'RESTORE' }, site.owner))
    const owner = await login(site.pc, '8642') // sessions end with a restore
    const cashier = await login(site.pc, '5173')
    // Work is paused until recovery: selling would reuse invoice numbers the cloud already holds.
    const paused = await site.pc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: site.shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'RICE', qty: 1 }]
      },
      cashier
    )
    assert.equal(paused.status, 423)
    assert.equal(paused.body.error.code, 'recovery_pending')
    assert.equal((await site.pc.call('sync.state', {}, cashier)).body.recoveryPending, true)
    assert.equal((await site.pc.call('sync.status', {}, cashier)).status, 403, 'admins only')
    const status = ok(await site.pc.call('sync.status', {}, owner))
    assert.equal(status.recoveryPending, true)
    assert.equal(status.hasToken, true)
    assert.equal(status.deviceToken, undefined, 'the token is never shown')
    // The background agent does nothing meanwhile.
    assert.deepEqual(await site.agent.runOnce(), { skipped: 'recovery_pending' })

    const r = ok(await site.pc.call('sync.recover', {}, owner))
    assert.equal(r.recovery.recovered, true)
    assert.ok(r.recovery.rows > 10)
    assert.deepEqual(r.recovery.ledgerFixes, [], 'recovered stock equals its movements')
    assert.deepEqual(await figures(site.pc.pool), lost, 'everything made after the backup is back')
    assert.deepEqual(await verifyLedger(site.pc.pool), [])
    // The recovered command is known as applied: it is not applied a second time.
    assert.equal(
      (
        await one(site.pc.pool, 'SELECT status FROM applied_commands WHERE command_id = $1', [
          commandId
        ])
      ).status,
      'applied'
    )
    // Work resumes in a new epoch; new rows get new numbers.
    const maxSale = Number((await one(site.pc.pool, 'SELECT max(id) AS m FROM sales')).m)
    const after = ok(
      await site.pc.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: site.shift.id,
          paymentType: 'نقدي',
          items: [{ barcode: 'CAN', qty: 1 }]
        },
        cashier
      )
    )
    assert.ok(after.saleId > maxSale)
    await syncUntilConverged(site)
    assert.equal((await one(site.pc.pool, 'SELECT epoch FROM sync_state')).epoch, 2)
    assert.deepEqual(await differences(site), [])
    assert.equal(
      Number(
        (await one(site.pc.pool, "SELECT stock_qty FROM products WHERE barcode = 'CAN'")).stock_qty
      ),
      1 + 24 - 1,
      'the remote receipt counted once'
    )
    const log = await one(
      site.pc.pool,
      "SELECT description FROM system_logs WHERE action_type = 'sync_recovery'"
    )
    assert.match(log.description, /استرجاع/)
  } finally {
    await site.close()
  }
})

test('replacement PC after a disk failure: link, restore the last backup, recover; the old PC can no longer write', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  let fresh
  try {
    ok(await site.link())
    await syncUntilConverged(site)
    const backup = ok(await site.pc.call('backup.export', {}, site.owner))
    await afterBackup(site)
    await syncUntilConverged(site)
    const lost = await figures(site.pc.pool)

    // The shop's PC dies. A new PC: first-run setup, link to the same cloud store, restore.
    fresh = await site.replacementPc()
    const setupOwnerToken = ok(await setupOwner(fresh.pc, { username: 'setup', pin: '1357' })).token
    ok(
      await fresh.pc.call(
        'sync.configure',
        {
          cloudUrl: 'http://127.0.0.1:9',
          storeId: site.storeId,
          deviceToken: site.token,
          enabled: true
        },
        setupOwnerToken
      )
    )
    ok(await fresh.pc.call('backup.restore', { backup, confirm: 'RESTORE' }, setupOwnerToken))
    const owner = await login(fresh.pc, '8642') // the store's own accounts are back
    ok(await fresh.pc.call('sync.recover', {}, owner))
    assert.deepEqual(await figures(fresh.pc.pool), lost)
    assert.deepEqual(await verifyLedger(fresh.pc.pool), [])

    // The old PC comes back to life and tries to push: refused (stale epoch).
    ok(await site.sell([{ barcode: 'RICE', qty: 1 }]))
    await assert.rejects(site.agent.runOnce(), /epoch/)
    const replacement = { ...site, pc: fresh.pc }
    assert.deepEqual(await differences(replacement), [])
  } finally {
    if (fresh) await fresh.close()
    await site.close()
  }
})

test('skipping recovery is an explicit, logged decision; the cloud then reports what it holds that the PC does not', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    ok(await site.link())
    await syncUntilConverged(site)
    const backup = ok(await site.pc.call('backup.export', {}, site.owner))
    await afterBackup(site)
    await syncUntilConverged(site)
    ok(await site.pc.call('backup.restore', { backup, confirm: 'RESTORE' }, site.owner))
    const owner = await login(site.pc, '8642')
    assert.equal((await site.pc.call('sync.skipRecovery', {}, owner)).status, 400, 'needs SKIP')
    ok(await site.pc.call('sync.skipRecovery', { confirm: 'SKIP' }, owner))
    assert.equal((await site.pc.call('sync.state', {}, owner)).body.recoveryPending, false)
    const log = await one(
      site.pc.pool,
      "SELECT username, description FROM system_logs WHERE action_type = 'sync_recovery'"
    )
    assert.equal(log.username, 'owner')
    assert.match(log.description, /تخطي/)
    const r = await site.agent.runOnce()
    assert.equal(r.epoch, 2)
    assert.equal(r.check.ok, false, 'rows made after the backup are only in the cloud – reported')
    assert.ok(r.check.detail.tables.some((x) => x.table === 'sales' && x.cloud > x.local))
    // Nothing was deleted from the cloud.
    assert.ok(
      (await differences(site)).every((d) => d.endsWith('only in cloud')),
      'the PC holds nothing the cloud lacks'
    )
  } finally {
    await site.close()
  }
})

test('a backup from another store cannot be recovered into this one; unlinked stores do not pause', async (t) => {
  if (!requireDb(t)) return
  const a = await makeSite()
  const b = await makeSite()
  try {
    ok(await a.link())
    await syncUntilConverged(a)
    const backupOfA = ok(await a.pc.call('backup.export', {}, a.owner))
    // Store B (linked) restores store A's backup by mistake.
    ok(await b.link())
    await syncUntilConverged(b)
    ok(await b.pc.call('backup.restore', { backup: backupOfA, confirm: 'RESTORE' }, b.owner))
    const ownerB = await login(b.pc, '8642')
    const r = await b.pc.call('sync.recover', {}, ownerB)
    assert.equal(r.status, 502)
    assert.match(r.body.error.message, /متجراً آخر/)
    assert.equal((await b.pc.call('sync.state', {}, ownerB)).body.recoveryPending, true)

    // Store A unlinks; restoring its own backup then does not pause anything.
    const ownerA = a.owner
    ok(await a.pc.call('sync.unlink', {}, ownerA))
    ok(await a.pc.call('backup.restore', { backup: backupOfA, confirm: 'RESTORE' }, ownerA))
    const cashierA = await login(a.pc, '5173')
    assert.equal((await a.pc.call('sync.state', {}, cashierA)).body.recoveryPending, false)
  } finally {
    await a.close()
    await b.close()
  }
})

test('link settings: administrators only, HTTPS required, token never returned, changes logged', async (t) => {
  if (!requireDb(t)) return
  const site = await makeSite()
  try {
    const cfg = (body, token = site.owner) => site.pc.call('sync.configure', body, token)
    const base = {
      cloudUrl: 'https://cloud.example',
      storeId: site.storeId,
      deviceToken: site.token,
      enabled: false
    }
    assert.equal((await cfg(base, site.cashier)).status, 403)
    assert.equal((await cfg({ ...base, cloudUrl: 'http://cloud.example' })).status, 400)
    assert.equal((await cfg({ ...base, storeId: 'not-a-uuid' })).status, 400)
    assert.equal((await cfg({ ...base, deviceToken: 'short' })).status, 400)
    const saved = ok(await cfg(base))
    assert.equal(saved.cloudUrl, 'https://cloud.example')
    assert.equal(saved.hasToken, true)
    assert.ok(!JSON.stringify(saved).includes(site.token))
    // Linked and synchronised: moving to another cloud store needs an explicit relink.
    ok(await site.link())
    await syncUntilConverged(site)
    const other = { ...base, storeId: crypto.randomUUID(), enabled: true }
    assert.equal((await cfg(other)).status, 409)
    const relinked = ok(await cfg({ ...other, relink: true }))
    assert.equal(relinked.epoch, null, 'starts over with the new store')
    const logs = await q(
      site.pc.pool,
      "SELECT description FROM system_logs WHERE action_type = 'sync_configure'"
    )
    assert.ok(logs.length >= 3)
    assert.ok(logs.every((l) => !l.description.includes(site.token)))
  } finally {
    await site.close()
  }
})
