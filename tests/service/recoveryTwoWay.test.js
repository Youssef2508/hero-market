'use strict'
// Recovery with the cloud's own work in play (D-106). The shop's local backups stay the primary
// recovery source; the cloud keeps only a minimal copy of its own.
//   - The shop's database is lost and restored from a local backup: what reached the cloud after
//     the backup comes back – the shop's own work, work done from the phone through the shop, and
//     work done from the phone while the shop was unreachable, received or not – each exactly once.
//   - The cloud's database is lost: a new, empty cloud and a new pairing code; the existing shop
//     (not a fresh installation) pairs again and the cloud is rebuilt from it at once, identical.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, login, freshDatabase, startService } = require('./helpers')
const { makeTwin, copyDifferences } = require('./cloudHelpers')
const { InProcessTransport } = require('../../src/server/sync/transport')
const { SyncAgent } = require('../../src/server/sync/agent')
const { executeRemote } = require('../../src/server/sync/remoteOps')
const { newPairingCode } = require('../../src/server/cloud/pairing')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (r, what = '') => {
  assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`)
  return r.body
}
const expense = (svc, amount, token, headers = {}) =>
  svc.call(
    'expenses.create',
    { amount, category: 'عام', destination: 'treasury', clientRef: crypto.randomUUID() },
    token,
    headers
  )
const amounts = async (pool) =>
  (
    await pool.query(
      'SELECT amount::numeric::int AS a FROM expenses WHERE amount BETWEEN 10 AND 99 ORDER BY 1'
    )
  ).rows.map((r) => r.a)

test("the shop's database is restored from a local backup: everything after it comes back once, the phone's offline work included", async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const phone = await twin.signIn('8642')
    const fromPhone = (amount) =>
      expense(twin.cloud, amount, phone, { 'x-heromarket-operation-id': crypto.randomUUID() })
    const apart = async (down) => {
      twin.agent.stopLink()
      twin.transport.down = down
      if (down)
        for (let i = 0; i < 100 && twin.cloud.app.cloudLink.reachable(); i++) await sleep(50)
    }

    // A paired shop records its link (the test pair joins through a test transport).
    await twin.shop.pool.query(
      "UPDATE sync_state SET cloud_url = 'https://cloud.test', device_token = 'test-device', enabled = true"
    )
    // The shop's local backup.
    const backup = ok(await twin.shop.call('backup.export', {}, twin.owner), 'backup')

    // After it: the shop's own expense, and one from the phone carried out at the shop.
    ok(await expense(twin.shop, 11, twin.owner))
    ok(await fromPhone(13))
    // The shop unreachable: the phone works on the cloud; the shop then receives it.
    await apart(true)
    ok(await fromPhone(15))
    twin.transport.down = false
    await twin.sync()
    // Unreachable again: work the shop never receives before the disaster.
    await apart(true)
    ok(await fromPhone(17))
    assert.deepEqual(await amounts(twin.shop.pool), [11, 13, 15])
    assert.deepEqual(await amounts(twin.cloud.pool), [11, 13, 15, 17])

    // The disaster: the shop's database is replaced by the backup.
    twin.transport.down = false
    ok(
      await twin.shop.call('backup.restore', { backup, confirm: 'RESTORE' }, twin.owner),
      'restore'
    )
    const owner = await login(twin.shop, '8642')
    assert.deepEqual(await amounts(twin.shop.pool), [], 'the backup predates them all')
    ok(await twin.shop.call('sync.recover', {}, owner), 'recover')
    // The cloud's own work comes in on the next cycles (link.fetch), before anything new.
    for (let i = 0; i < 8; i++) {
      const r = await twin.agent.runOnce()
      await twin.agent.linkOnce({ timeoutMs: 0 })
      if (r.check?.ok) break
    }
    assert.deepEqual(await amounts(twin.shop.pool), [11, 13, 15, 17], 'all back, once each')
    assert.deepEqual(await amounts(twin.cloud.pool), [11, 13, 15, 17], 'nothing doubled')
    assert.deepEqual(await copyDifferences(twin), [])
    // Work goes on; the next expense is ordinary on both sides.
    ok(await expense(twin.shop, 19, owner))
    await twin.sync()
    assert.deepEqual(await amounts(twin.cloud.pool), [11, 13, 15, 17, 19])
  } finally {
    await twin.close()
  }
})

test("the cloud's database is lost: a new cloud, a new code, the existing shop pairs again and the cloud is rebuilt identical", async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ link: false })
  const newCloudDb = await freshDatabase()
  let cloud2, shop2, agent2
  try {
    await twin.sync()
    // Some history, including work from the phone that the shop has received.
    ok(await expense(twin.shop, 21, twin.owner))
    const phone = await twin.signIn('8642')
    twin.agent.startLink({ timeoutMs: 300 })
    for (let i = 0; i < 50 && !twin.cloud.app.cloudLink.reachable(); i++) await sleep(20)
    ok(await expense(twin.cloud, 23, phone, { 'x-heromarket-operation-id': crypto.randomUUID() }))
    twin.agent.stopLink()
    await twin.sync()
    const shopBefore = await twin.shop.pool.query(
      'SELECT (SELECT count(*) FROM sales)::int AS sales, (SELECT count(*) FROM expenses)::int AS expenses, (SELECT store_id FROM sync_state) AS store'
    )

    // The cloud is lost. A new one starts empty and makes a pairing code.
    const shopUrl = twin.shop.pool.options.connectionString
    await twin.cloud.close()
    cloud2 = await startService(newCloudDb.url, { role: 'cloud', linkGraceMs: 1500 })
    const { code } = await newPairingCode(cloud2.pool, { name: 'هيرو ماركت' })
    twin.agent.stop()
    await twin.agent.unlisten().catch(() => {})
    await twin.shop.close()
    shop2 = await startService(shopUrl, {
      pairRequest: async (body) => {
        const res = await cloud2.app.inject({
          method: 'POST',
          url: '/api/link.pair',
          payload: body
        })
        return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }
      },
      syncTransport: (st) =>
        new InProcessTransport({ app: cloud2.app, storeId: st.store_id, token: st.device_token })
    })
    // The shop has sales and shifts: it is not "fresh", and it may pair with an empty cloud.
    const paired = ok(
      await shop2.call('sync.pair', { cloudUrl: 'https://new-cloud.example', code }, twin.owner),
      'pair'
    )
    assert.equal(paired.recoveryPending, false, 'nothing to receive: the shop is the store')
    agent2 = new SyncAgent({
      pool: shop2.pool,
      transport: async () => {
        const st = (await shop2.pool.query('SELECT * FROM sync_state')).rows[0]
        return new InProcessTransport({
          app: cloud2.app,
          storeId: st.store_id,
          token: st.device_token
        })
      },
      execute: (op) => executeRemote(shop2.app, op)
    })
    const first = await agent2.runOnce()
    assert.equal(first.check?.ok, true, `rebuilt in one cycle: ${JSON.stringify(first.check)}`)
    assert.deepEqual(await copyDifferences({ shop: shop2, cloud: cloud2 }), [])
    // The shop itself is unchanged; the store keeps its identity; history is there once.
    const shopAfter = await shop2.pool.query(
      'SELECT (SELECT count(*) FROM sales)::int AS sales, (SELECT count(*) FROM expenses)::int AS expenses, (SELECT store_id FROM sync_state) AS store'
    )
    assert.deepEqual(shopAfter.rows[0], shopBefore.rows[0])
    assert.deepEqual(await amounts(cloud2.pool), [21, 23])
    // The same users sign in on the new cloud.
    assert.equal(
      (await cloud2.call('auth.login', { username: 'owner', password: 'Test-8642-pw' })).status,
      200
    )
  } finally {
    agent2?.stop()
    await shop2?.close()
    await cloud2?.close()
    await twin.close().catch(() => {})
    await newCloudDb.dispose()
  }
})
