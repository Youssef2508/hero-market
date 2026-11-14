'use strict'
// Import jobs from the website (1.6.3, D-108). While the shop can be reached the job is stored and
// carried out in the shop, like every change from the internet (D-101), and the website follows it
// in the cloud's copy; the answer to the start never waits for the import. While the shop cannot
// be reached the cloud carries it out itself and the shop receives the records when it is back
// (D-103). Either way the two sides end with the same records, each product once.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb } = require('./helpers')
const { makeTwin, inStep, copyDifferences } = require('./cloudHelpers')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const num = async (pool, sql, p) => Number(Object.values((await pool.query(sql, p)).rows[0])[0])
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}

function products(n, prefix) {
  return Array.from({ length: n }, (_, i) => ({
    row: i + 2,
    barcode: i % 11 === 3 ? '' : `${prefix}${String(i).padStart(7, '0')}`,
    name: `صنف ${prefix}${i}`,
    retail_price: 12,
    cost_price: 9,
    stock_qty: i % 2 ? 3 : 0,
    unit: 'قطعة',
    category: `فئة ${prefix} ${i % 3}`
  }))
}

async function finished(call, id, ms = 30000) {
  const until = Date.now() + ms
  for (;;) {
    const r = await call('imports.get', { id })
    if (r.status === 200 && !['queued', 'processing'].includes(r.body.status)) return r.body
    if (Date.now() > until) throw new Error(`job ${id}: ${JSON.stringify(r.body)}`)
    await sleep(100)
  }
}

test('from the website with the shop connected: stored and carried out in the shop, followed in the cloud', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const owner = await twin.signIn('8642')
    const rows = products(1500, 'WEB')
    const id = crypto.randomUUID()
    const t0 = Date.now()
    const started = ok(
      await twin.cloud.call('imports.start', { id, filename: 'web.xlsx', products: rows }, owner)
    )
    // The answer comes before the import is done (the cloud waits 3 s at most in these tests).
    assert.ok(Date.now() - t0 < 3000, `start answered after ${Date.now() - t0} ms`)
    assert.equal(started.id, id)
    // The job and its rows are in the shop; the cloud never holds the rows.
    assert.equal(
      await num(twin.shop.pool, 'SELECT count(*) FROM import_jobs WHERE id = $1', [id]),
      1
    )
    assert.equal(await num(twin.cloud.pool, 'SELECT count(*) FROM import_job_data'), 0)

    const shopCall = (op, body) => twin.shop.call(op, body, twin.owner)
    const inShop = await finished(shopCall, id)
    assert.equal(inShop.status, 'completed', JSON.stringify(inShop))
    assert.equal(inShop.successfulRows, 1500)
    // The cloud's copy receives the records and the job's end with the shop's other changes.
    assert.deepEqual(await inStep(twin, 20000), [])
    const onCloud = ok(await twin.cloud.call('imports.get', { id }, owner))
    assert.equal(onCloud.status, 'completed')
    assert.equal(onCloud.successfulRows, 1500)
    assert.ok(ok(await twin.cloud.call('imports.list', {}, owner)).jobs.some((j) => j.id === id))
    for (const pool of [twin.shop.pool, twin.cloud.pool])
      assert.equal(
        await num(pool, "SELECT count(*) FROM products WHERE name LIKE 'صنف WEB%'"),
        1500
      )
    assert.equal(await num(twin.cloud.pool, 'SELECT count(*) FROM import_job_data'), 0)
    assert.equal(await num(twin.shop.pool, 'SELECT count(*) FROM import_job_data'), 0)
  } finally {
    await twin.close()
  }
})

test('from the website with the shop unreachable: the cloud carries it out; the shop receives it once', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const owner = await twin.signIn('8642')
    twin.transport.down = true
    for (let i = 0; i < 100 && (await twin.cloud.app.cloudLink.shopUp()); i++) await sleep(50)
    assert.equal(await twin.cloud.app.cloudLink.shopUp(), false)

    const rows = products(800, 'APART')
    const id = crypto.randomUUID()
    ok(
      await twin.cloud.call('imports.start', { id, filename: 'apart.xlsx', products: rows }, owner)
    )
    const cloudCall = (op, body) => twin.cloud.call(op, body, owner)
    const done = await finished(cloudCall, id)
    assert.equal(done.status, 'completed', JSON.stringify(done))
    assert.equal(
      await num(twin.cloud.pool, "SELECT count(*) FROM products WHERE name LIKE 'صنف APART%'"),
      800
    )
    assert.equal(
      await num(twin.shop.pool, "SELECT count(*) FROM products WHERE name LIKE 'صنف APART%'"),
      0
    )

    // The link is back: the shop takes the cloud's records, each once.
    twin.transport.down = false
    for (let i = 0; i < 8; i++) {
      const r = await twin.agent.runOnce()
      if (r.check?.ok && !(await copyDifferences(twin)).length) break
    }
    assert.deepEqual(await copyDifferences(twin), [])
    for (const pool of [twin.shop.pool, twin.cloud.pool]) {
      assert.equal(
        await num(pool, "SELECT count(*) FROM products WHERE name LIKE 'صنف APART%'"),
        800
      )
      assert.equal(
        await num(pool, "SELECT count(*) FROM import_jobs WHERE id = $1 AND status = 'completed'", [
          id
        ]),
        1
      )
    }
    // Nothing to settle by hand.
    assert.equal(
      await num(twin.shop.pool, "SELECT count(*) FROM sync_attention WHERE status = 'open'"),
      0
    )
  } finally {
    await twin.close()
  }
})
