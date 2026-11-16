'use strict'
// The shop's connection as the cloud reports it to the screens (D-114): the last successful
// contact on the cloud's clock, kept in its database, and four states – unknown (never in contact),
// connected, delayed, offline – with no "connected" after the shop stops calling. Real shop and
// cloud services; the link is cut by the test. Thresholds are shortened for the test: healthy
// 600 ms, offline 1.5 s (the real ones are 25 s and 40 s, chosen from the measured link).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { requireDb, startService, login } = require('./helpers')
const { makeTwin, ok } = require('./cloudHelpers')
const { InProcessTransport } = require('../../src/server/sync/transport')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OPTIONS = { linkGraceMs: 1500, linkHealthyMs: 600, linkSeenStepMs: 100 }

test('never in contact: unknown, never connected; then connected once the shop calls', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ link: false, cloudOptions: OPTIONS })
  try {
    // Nothing has come from the shop yet (not even its users): the cloud's own view.
    const s0 = await twin.cloud.app.cloudLink.describe()
    assert.equal(s0.connectivity, 'unknown')
    assert.equal(s0.lastContactAt, null)
    assert.equal(s0.timeZone, twin.cloud.app.config.timeZone)
    await twin.sync()
    twin.agent.startLink({ timeoutMs: 300 })
    for (let i = 0; i < 50 && !twin.cloud.app.cloudLink.reachable(); i++) await sleep(20)
    const owner = await twin.signIn('8642')
    const s1 = ok(await twin.cloud.call('link.state', {}, owner))
    assert.equal(s1.connectivity, 'connected')
    // The contact is the cloud's own observation: within a second of the cloud's clock.
    assert.ok(Math.abs(Date.parse(s1.serverTime) - Date.parse(s1.lastContactAt)) < 1000)
    const stored = (
      await twin.cloud.pool.query('SELECT last_seen_at FROM cloud_stores WHERE store_id = $1', [
        twin.storeId
      ])
    ).rows[0].last_seen_at
    assert.ok(Date.parse(s1.lastContactAt) >= new Date(stored).getTime() - 1)
  } finally {
    await twin.close()
  }
})

test('the shop stops calling: delayed, then offline – announced; back: connected again', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ cloudOptions: OPTIONS })
  try {
    const owner = await twin.signIn('8642')
    const state = async () => ok(await twin.cloud.call('link.state', {}, owner))
    assert.equal((await state()).connectivity, 'connected')
    const before = await state()
    twin.transport.down = true
    const t0 = Date.now()
    // Watch for the announcement of the loss (the screens' open request returns by itself).
    const watching = twin.cloud.call('link.watch', { after: before.seq, timeoutMs: 5000 }, owner)
    const seen = []
    while (Date.now() - t0 < 2500) {
      const s = await state()
      seen.push([Date.now() - t0, s.connectivity])
      await sleep(100)
    }
    const watched = ok(await watching)
    assert.ok(watched.seq > before.seq, 'the loss is announced to the screens')
    assert.equal(watched.connectivity, 'offline')
    // Never connected once the contact is older than the healthy time; offline by the end.
    const lastContact = Date.parse(before.lastContactAt)
    for (const [ms, c] of seen)
      if (t0 + ms - lastContact > 700) assert.notEqual(c, 'connected', `at ${ms} ms`)
    assert.ok(
      seen.some(([, c]) => c === 'delayed'),
      JSON.stringify(seen)
    )
    assert.equal(seen.at(-1)[1], 'offline')
    // The last contact shown is the real one, not the moment of asking.
    const off = await state()
    assert.equal(off.lastContactAt, (await state()).lastContactAt)
    assert.ok(Date.parse(off.serverTime) - Date.parse(off.lastContactAt) > 1500)

    // Back: connected only after a new contact.
    twin.transport.down = false
    let back
    for (let i = 0; i < 100; i++) {
      back = await state()
      if (back.connectivity === 'connected') break
      await sleep(50)
    }
    assert.equal(back.connectivity, 'connected')
    assert.ok(Date.parse(back.lastContactAt) > Date.parse(off.lastContactAt))
  } finally {
    await twin.close()
  }
})

test('a screen learns of newer contacts without polling; a reload reads the truth', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ cloudOptions: OPTIONS })
  try {
    const owner = await twin.signIn('8642')
    const s = ok(await twin.cloud.call('link.state', {}, owner))
    // Nothing else changed, yet the open request returns once the contact is newer.
    const t0 = Date.now()
    const w = ok(
      await twin.cloud.call(
        'link.watch',
        { after: s.seq, timeoutMs: 10000, seenAt: Date.parse(s.lastContactAt) },
        owner
      )
    )
    assert.ok(Date.now() - t0 < 3000, `returned after ${Date.now() - t0} ms`)
    assert.equal(w.seq, s.seq, 'no data change announced')
    assert.ok(Date.parse(w.lastContactAt) >= Date.parse(s.lastContactAt) + 100)
    // A screen reloaded while the shop is away gets the cloud's state, not a remembered one.
    twin.transport.down = true
    await sleep(1800)
    const reloaded = ok(await twin.cloud.call('link.state', {}, owner))
    assert.equal(reloaded.connectivity, 'offline')
  } finally {
    await twin.close()
  }
})

test('the cloud restarts: the last contact is kept, never newer; connected after a new contact', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ cloudOptions: OPTIONS })
  let second = null
  try {
    const owner = await twin.signIn('8642')
    const before = ok(await twin.cloud.call('link.state', {}, owner))
    assert.equal(before.connectivity, 'connected')
    twin.agent.stopLink()
    await sleep(400)
    // A new cloud process on the same database: nothing of the link in memory.
    second = await startService(twin.cloud.pool.options.connectionString, {
      role: 'cloud',
      ...OPTIONS
    })
    const signed = await login(second, '8642')
    const after = ok(await second.call('link.state', {}, signed))
    // Remembered from the database, never refreshed by the restart itself.
    assert.ok(after.lastContactAt)
    assert.ok(Date.parse(after.lastContactAt) <= Date.parse(before.serverTime) + 1000)
    assert.notEqual(after.connectivity, 'connected', 'not before the shop calls again')
    // The shop calls the restarted cloud.
    twin.transport.inner = new InProcessTransport({
      app: second.app,
      storeId: twin.storeId,
      token: twin.transport.inner.token
    })
    twin.agent.startLink({ timeoutMs: 300 })
    let s
    for (let i = 0; i < 100; i++) {
      s = ok(await second.call('link.state', {}, signed))
      if (s.connectivity === 'connected') break
      await sleep(50)
    }
    assert.equal(s.connectivity, 'connected')
    assert.ok(Date.parse(s.lastContactAt) > Date.parse(after.lastContactAt))
  } finally {
    twin.agent.stopLink()
    await sleep(400)
    if (second) await second.close()
    await twin.close()
  }
})
