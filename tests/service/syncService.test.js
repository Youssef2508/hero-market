'use strict'
// The background sync service and the desktop program on the same shop (Phase 2 milestone 4,
// D-104): only one holds the link to the cloud at a time, with a heartbeat the screens show; when it
// stops, the other takes over by itself; operations from the internet are carried out once either
// way. The service is the same agent the Windows task runs (src/main/syncService.js).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb } = require('./helpers')
const { makeTwin, ok } = require('./cloudHelpers')
const { SyncAgent } = require('../../src/server/sync/agent')
const { executeRemote } = require('../../src/server/sync/remoteOps')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await sleep(50)
  }
  return false
}

test('one holder of the link at a time; the other takes over when it stops; operations once either way', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ link: false })
  // The background service: the same agent, its own process in real life.
  const service = new SyncAgent({
    pool: twin.shop.pool,
    transport: twin.transport,
    execute: (op) => executeRemote(twin.shop.app, op),
    kind: 'service',
    version: 'test'
  })
  try {
    await twin.sync()
    const owner = await twin.signIn('8642')
    const state = async () => (await twin.shop.pool.query('SELECT * FROM sync_state')).rows[0]

    // The service starts first and holds the link; the desktop program waits.
    service.startLink({ timeoutMs: 300, holdRetryMs: 200 })
    assert.ok(await until(async () => (await state()).agent_kind === 'service'))
    twin.agent.kind = 'desktop'
    twin.agent.startLink({ timeoutMs: 300, holdRetryMs: 200 })
    await sleep(600)
    assert.equal((await state()).agent_kind, 'service', 'the desktop program does not take it')
    assert.ok(await until(() => twin.cloud.app.cloudLink.shopUp()))
    const status = ok(await twin.shop.call('sync.status', {}, twin.owner))
    assert.deepEqual([status.agent.kind, status.agent.alive], ['service', true])

    // An operation from the internet: carried out by the holder, once.
    const expense = (amount) =>
      twin.cloud.call(
        'expenses.create',
        { amount, category: 'عام', destination: 'treasury', clientRef: crypto.randomUUID() },
        owner,
        { 'x-heromarket-operation-id': crypto.randomUUID() }
      )
    ok(await expense(7))
    const count = async () =>
      Number((await twin.shop.pool.query('SELECT count(*) AS n FROM expenses')).rows[0].n)
    assert.equal(await count(), 1)

    // The service stops (closed, crashed, killed by an update): the desktop program takes over.
    service.stopLink()
    assert.ok(
      await until(async () => (await state()).agent_kind === 'desktop'),
      'the desktop program holds the link now'
    )
    assert.ok(await until(() => twin.cloud.app.cloudLink.shopUp()))
    // Right at the hand-over the answer may honestly be "not carried out" (nothing changed); a
    // person then tries again.
    let eight = await expense(8)
    if (eight.status === 502 && eight.body.error.code === 'not_executed') eight = await expense(8)
    ok(eight)
    assert.equal(await count(), 2)
    assert.equal(
      Number(
        (
          await twin.shop.pool.query(
            "SELECT count(*) AS n FROM remote_operations WHERE status = 'applied'"
          )
        ).rows[0].n
      ),
      2
    )
  } finally {
    service.stopLink()
    await twin.close()
  }
})

test('handing over: "never carried out" is decided once in the shop; a late copy then changes nothing', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ link: false })
  try {
    await twin.sync()
    const owner = await twin.shop.pool.query("SELECT id FROM users WHERE username = 'owner'")
    const op = {
      id: crypto.randomUUID(),
      operation: 'expenses.create',
      body: { amount: 9, category: 'عام', destination: 'treasury', clientRef: crypto.randomUUID() },
      userId: owner.rows[0].id,
      username: 'owner'
    }
    // The cloud asks about an operation it handed over; this holder has no record of it yet.
    const asked = new SyncAgent({
      pool: twin.shop.pool,
      transport: {
        wait: async () => ({ ops: [], check: [op.id], changes: 0 }),
        results: async (b) => {
          asked.reported = b
          return { settled: 1 }
        }
      }
    })
    await asked.linkOnce({ timeoutMs: 0 })
    assert.deepEqual(asked.reported.unknown, [op.id])
    // The copy that received it before the hand-over carries it out only now: nothing happens.
    const late = await executeRemote(twin.shop.app, op)
    assert.deepEqual([late.status, late.error.code], ['refused', 'not_executed'])
    const n = await twin.shop.pool.query('SELECT count(*)::int AS n FROM expenses')
    assert.equal(n.rows[0].n, 0, 'reported as not carried out, and not carried out')
  } finally {
    await twin.close()
  }
})
