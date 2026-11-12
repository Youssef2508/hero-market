'use strict'
// Coordinated updates (architecture §14.1, D-105): the cloud is updated first, then the shop. In
// between, the cloud refuses the shop's link and works alone, as in an outage; afterwards both
// sides' work comes together. The pairing, the checkpoints, unsent changes and an operation that
// was in flight at the update all survive: nothing is lost, nothing is carried out twice, no
// pairing again. "Version N" is today's migrations plus one test migration.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { requireDb, startService } = require('./helpers')
const { makeTwin, copyDifferences } = require('./cloudHelpers')
const { SyncAgent } = require('../../src/server/sync/agent')
const { executeRemote } = require('../../src/server/sync/remoteOps')
const { DEFAULT_DIR } = require('../../src/server/db/migrate')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NEXT = '9001_update_test'

/** Today's migrations plus one more: the next release's database version. */
function nextRelease() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-next-'))
  for (const f of fs.readdirSync(DEFAULT_DIR))
    fs.copyFileSync(path.join(DEFAULT_DIR, f), path.join(dir, f))
  fs.writeFileSync(
    path.join(dir, `${NEXT}.sql`),
    'ALTER TABLE products ADD COLUMN hm_update_test text;\n'
  )
  return dir
}

test('cloud first, then the shop: apart in between, then together; nothing lost or doubled, no pairing again', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  const next = nextRelease()
  let cloud2, shop2, agent2
  try {
    const versionOf = async (pool) =>
      (await pool.query('SELECT max(version) AS v FROM schema_migrations')).rows[0].v
    const today = await versionOf(twin.shop.pool)
    // The shop names its version from now on (as the real link does).
    twin.transport.inner.schema = today
    const identity = async (shop, cloud) => ({
      shop: (await shop.query('SELECT store_id, device_token, epoch FROM sync_state')).rows[0],
      cloud: (await cloud.query('SELECT store_id, token_hash FROM cloud_stores')).rows
    })
    const before = await identity(twin.shop.pool, twin.cloud.pool)
    const phone = await twin.signIn('8642')
    const expense = (svc, amount, token, headers = {}) =>
      svc.call(
        'expenses.create',
        { amount, category: 'عام', destination: 'treasury', clientRef: crypto.randomUUID() },
        token,
        headers
      )
    const fromPhone = (svc, amount) =>
      expense(svc, amount, phone, { 'x-heromarket-operation-id': crypto.randomUUID() })

    // 1. In flight at the update: the shop carries it out, its answer to the cloud is lost.
    twin.transport.loseResults = 1
    const inFlight = await fromPhone(twin.cloud, 3)
    assert.ok(
      inFlight.status === 200 || inFlight.body.error.code === 'pending_confirmation',
      JSON.stringify(inFlight.body)
    )

    // 2. The link goes down; each side works on its own.
    twin.agent.stopLink()
    twin.transport.down = true
    for (let i = 0; i < 100 && twin.cloud.app.cloudLink.reachable(); i++) await sleep(50)
    assert.equal((await expense(twin.shop, 5, twin.owner)).status, 200)
    assert.equal((await fromPhone(twin.cloud, 7)).status, 200)

    // 3. The cloud is updated: the same database, the next release's migrations.
    const cloudUrl = twin.cloud.pool.options.connectionString
    await twin.cloud.close()
    cloud2 = await startService(cloudUrl, {
      role: 'cloud',
      linkGraceMs: 1500,
      forwardTimeoutMs: 3000,
      migrationsDir: next
    })
    assert.equal(await versionOf(cloud2.pool), NEXT.slice(0, 4))
    twin.transport.inner.app = cloud2.app
    twin.transport.down = false
    // The shop, still on today's version, is refused; nothing is taken in.
    await assert.rejects(
      () => twin.agent.runOnce(),
      (e) => e.code === 'schema_mismatch'
    )
    // The sync screen shows both versions, and that an update is needed.
    const seen = (await twin.shop.call('sync.status', {}, twin.owner)).body.versions
    assert.equal(seen.cloud.schema, NEXT.slice(0, 4))
    assert.equal(seen.shop.schema, today)
    // The phone's session survived; the cloud works alone.
    assert.equal(cloud2.app.cloudLink.reachable(), false)
    assert.equal((await fromPhone(cloud2, 9)).status, 200)

    // 4. The shop is updated (the installer stops its service, migrates, starts it again).
    const shopUrl = twin.shop.pool.options.connectionString
    twin.agent.stop()
    await twin.agent.unlisten().catch(() => {})
    await twin.shop.close()
    shop2 = await startService(shopUrl, {
      migrationsDir: next,
      syncTransport: () => twin.transport
    })
    twin.transport.inner.schema = await versionOf(shop2.pool)
    agent2 = new SyncAgent({
      pool: shop2.pool,
      transport: twin.transport,
      batchSize: 200,
      execute: (op) => executeRemote(shop2.app, op)
    })
    let last
    for (let i = 0; i < 8; i++) {
      await agent2.linkOnce({ timeoutMs: 0 })
      last = await agent2.runOnce()
      if (last.check?.ok) break
    }
    assert.equal(last.check?.ok, true, JSON.stringify(last))
    await agent2.linkOnce({ timeoutMs: 0 })

    const after = (await shop2.call('sync.status', {}, twin.owner)).body.versions
    assert.equal(after.cloud.schema, after.shop.schema, 'the same version: no update needed')

    // Together again: one copy, every operation once.
    assert.deepEqual(await copyDifferences({ shop: shop2, cloud: cloud2 }), [])
    const amounts = async (pool) =>
      (
        await pool.query(
          'SELECT amount::numeric::int AS a FROM expenses WHERE amount IN (3, 5, 7, 9) ORDER BY 1'
        )
      ).rows.map((r) => r.a)
    assert.deepEqual(await amounts(shop2.pool), [3, 5, 7, 9])
    assert.deepEqual(await amounts(cloud2.pool), [3, 5, 7, 9])
    // The operation in flight: carried out once, and the cloud knows it.
    const ops = await cloud2.pool.query(
      "SELECT status FROM cloud_operations WHERE operation = 'expenses.create' AND body->>'amount' = '3'"
    )
    assert.deepEqual(
      ops.rows.map((r) => r.status),
      ['applied']
    )
    // The same pairing, identity and epoch: nothing to pair again, nothing sent again from scratch.
    assert.deepEqual(await identity(shop2.pool, cloud2.pool), before)
    const st = (await shop2.pool.query('SELECT recovery_pending, check_ok FROM sync_state')).rows[0]
    assert.deepEqual([st.recovery_pending, st.check_ok], [false, true])
    // The new column is there on both sides.
    for (const pool of [shop2.pool, cloud2.pool])
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'hm_update_test'"
          )
        ).rows[0].n,
        1
      )
  } finally {
    agent2?.stopLink()
    agent2?.stop()
    await shop2?.close()
    await cloud2?.close()
    await twin.close().catch(() => {})
    fs.rmSync(next, { recursive: true, force: true })
  }
})

test('starting again (after an update, or any start) sends nothing when nothing changed', async (t) => {
  if (!requireDb(t)) return
  const { freshDatabase } = require('./helpers')
  const { PERMISSIONS } = require('../../src/server/auth/permissions')
  const db = await freshDatabase()
  try {
    const waiting = async (svc) =>
      Number((await svc.pool.query('SELECT count(*) AS n FROM sync_outbox')).rows[0].n)
    const first = await startService(db.url)
    const before = await waiting(first)
    await first.close()
    // The installer's update step and the background service each start the service once more.
    for (let i = 0; i < 2; i++) {
      const again = await startService(db.url)
      assert.equal(await waiting(again), before, 'no change queued for the cloud by a start')
      const held = await again.pool.query(
        `SELECT array_agg(permission ORDER BY permission) AS p FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id WHERE r.key = 'super_admin'`
      )
      assert.deepEqual(
        held.rows[0].p,
        PERMISSIONS.map((x) => x.key).sort(),
        'still every permission'
      )
      await again.close()
    }
  } finally {
    await db.dispose()
  }
})
