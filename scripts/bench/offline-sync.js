#!/usr/bin/env node
'use strict'
// Before the test helpers are loaded: they read the address once (HEROMARKET_TEST_DATABASE_URL,
// or the development PostgreSQL of npm run pg:dev).
process.env.HEROMARKET_TEST_DATABASE_URL ||= require('../pg-dev').url('postgres')
// A paired shop that loses its internet, keeps selling, and gets it back (1.6.3): how long until
// the cloud holds every invoice, and why. Runs the sync agent exactly as the shop runs it (the
// 15-second cycle, the push on every change, the open link held 25 seconds at a time) against a
// cloud on throw-away databases; only the link between them is cut and restored. Made-up data.
//
//   node scripts/bench/offline-sync.js [--invoices 2,10,50,100,500] [--offline 60] [--latency 0]
//
//   --offline  seconds the internet stays away, counted from the cut (the agent's waits grow with
//              each failed attempt, so a longer outage is a different case, not just a longer one)
//   --latency  milliseconds added to every request in each direction (a slow connection)
//
// One JSON line per workload: events per invoice, requests, batches, retries, the time from the
// return of the internet to the first request and to the last change confirmed, and whether both
// sides then hold the same business records.
const crypto = require('crypto')
const { makeTwin, copyDifferences } = require('../../tests/service/cloudHelpers')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const INVOICES = arg('invoices', '2,10,50,100,500').split(',').map(Number)
const OFFLINE_S = Number(arg('offline', 60))
const LATENCY = Number(arg('latency', 0))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PRODUCTS = Array.from({ length: 40 }, (_, i) => `BENCH${String(i).padStart(3, '0')}`)

async function workload(n) {
  const twin = await makeTwin()
  const { shop, cloud, agent, transport } = twin
  const num = async (pool, sql, p) => Number(Object.values((await pool.query(sql, p)).rows[0])[0])
  try {
    // Products with enough stock for every workload, sent before the cut.
    const c = await shop.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
      for (const [i, b] of PRODUCTS.entries())
        await c.query(
          `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, category)
           VALUES ($1, $2, 8, $3, 100000, 'قطعة', 'تجربة')`,
          [b, `صنف قياس ${i}`, 10 + i]
        )
      await c.query("SELECT hm_post_opening_balances('offline sync benchmark')")
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    await twin.sync()

    // The agent as the shop runs it (src/server/modules/sync.js): production timings.
    agent.stopLink()
    await sleep(500)
    agent.batchSize = 500
    agent.start(15000)
    await agent.listen()
    agent.startLink()

    // Every request the shop makes to the cloud, timed.
    const calls = []
    for (const m of [
      'push',
      'wait',
      'fetch',
      'newEpoch',
      'pullCommands',
      'checksums',
      'ack',
      'results'
    ]) {
      const inner = transport[m]
      if (typeof inner !== 'function') continue
      transport[m] = async (...a) => {
        const at = Date.now()
        if (LATENCY) await sleep(LATENCY)
        try {
          const r = await inner.apply(transport, a)
          if (LATENCY) await sleep(LATENCY)
          calls.push({
            m,
            at,
            ms: Date.now() - at,
            ok: true,
            rows: m === 'push' ? a[0].rows.length : undefined
          })
          return r
        } catch (e) {
          calls.push({ m, at, ms: Date.now() - at, ok: false })
          throw e
        }
      }
    }
    for (let i = 0; i < 100 && !(await cloud.app.cloudLink.shopUp()); i++) await sleep(100)

    // ── The internet goes away; the till keeps selling ──
    const cutAt = Date.now()
    transport.down = true
    const before = await num(shop.pool, 'SELECT count(*) FROM sync_outbox')
    const t0 = Date.now()
    let credit = 0
    for (let i = 0; i < n; i++) {
      const lines = 1 + (i % 4)
      const items = Array.from({ length: lines }, (_, k) => ({
        barcode: PRODUCTS[(i * 3 + k) % PRODUCTS.length],
        qty: 1 + ((i + k) % 3)
      }))
      const onAccount = i % 5 === 4
      if (onAccount) credit += 1
      const r = await shop.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: twin.shift.id,
          paymentType: onAccount ? 'آجل' : i % 3 ? 'نقدي' : 'فيزا',
          items,
          ...(onAccount
            ? { client: { id: twin.clientId, name: 'أم أحمد', phone: '01012345678', address: '' } }
            : {})
        },
        twin.cashier
      )
      if (r.status !== 200) throw new Error(`checkout ${i}: ${r.status} ${JSON.stringify(r.body)}`)
    }
    const createMs = Date.now() - t0
    const events = (await num(shop.pool, 'SELECT count(*) FROM sync_outbox')) - before
    // Stay offline for the rest of the outage.
    await sleep(Math.max(0, OFFLINE_S * 1000 - (Date.now() - cutAt)))
    const failuresAtReturn = agent.failures

    // ── The internet is back ──
    const backAt = Date.now()
    transport.down = false
    let confirmedAt = null
    for (let i = 0; i < 20 * 60 * 10; i++) {
      const left = await num(shop.pool, 'SELECT count(*) FROM sync_outbox WHERE acked_at IS NULL')
      if (!left) {
        confirmedAt = Date.now()
        break
      }
      await sleep(100)
    }
    const after = calls.filter((x) => x.at >= backAt)
    const firstPush = after.find((x) => x.m === 'push' && x.ok)
    const diffs = await copyDifferences(twin)
    const sales = {
      shop: await num(shop.pool, 'SELECT count(*) FROM sales'),
      cloud: await num(cloud.pool, 'SELECT count(*) FROM sales')
    }
    const totalMs = confirmedAt ? confirmedAt - backAt : null
    const pushes = after.filter((x) => x.m === 'push' && x.ok)
    return {
      invoices: n,
      creditInvoices: credit,
      offlineSeconds: OFFLINE_S,
      latencyMs: LATENCY,
      createMs,
      events,
      eventsPerInvoice: Math.round((events / n) * 10) / 10,
      failedAttemptsWhileOffline: failuresAtReturn,
      firstPushAfterReturnMs: firstPush ? firstPush.at - backAt : null,
      allConfirmedAfterReturnMs: totalMs,
      eventsPerSecond: totalMs ? Math.round(events / (totalMs / 1000)) : null,
      requestsAfterReturn: after.length,
      pushRequests: pushes.length,
      batchRows: pushes.map((x) => x.rows),
      failedRequestsAfterReturn: after.filter((x) => !x.ok).length,
      sameRecords: diffs.length === 0,
      differences: diffs.slice(0, 3),
      sales
    }
  } finally {
    await twin.close()
  }
}

;(async () => {
  for (const n of INVOICES) console.log(JSON.stringify(await workload(n)))
  process.exit(0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
