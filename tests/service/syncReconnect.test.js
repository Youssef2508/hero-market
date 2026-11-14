'use strict'
// Back online after a long outage (D-109): the sales made meanwhile reach the cloud within seconds.
// Before 1.6.3 the agent's cycle waited longer after every failed attempt, up to 5 minutes, and the
// link's return did not send anything: two invoices could take five minutes to arrive.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb } = require('./helpers')
const { makeTwin, copyDifferences } = require('./cloudHelpers')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const num = async (pool, sql) => Number(Object.values((await pool.query(sql)).rows[0])[0])

test('after a long outage, the changes made meanwhile are confirmed within seconds of the return', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  const { agent, transport } = twin
  try {
    // The agent as the shop runs it (src/server/modules/sync.js).
    agent.stopLink()
    await sleep(500)
    agent.start(15000)
    await agent.listen()
    agent.startLink()

    transport.down = true
    for (let i = 0; i < 2; i++) {
      const r = await twin.shop.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: twin.shift.id,
          paymentType: 'نقدي',
          items: [
            { barcode: 'RICE', qty: 1 },
            { barcode: 'SUGAR', qty: 2 }
          ]
        },
        twin.cashier
      )
      assert.equal(r.status, 200, JSON.stringify(r.body))
    }
    await sleep(3000)
    // What a long outage leaves: many failed attempts, so the next cycle is a long wait away.
    agent.failures = 8
    agent.stop()
    agent.start(15000)
    await sleep(200)
    const waiting = await num(
      twin.shop.pool,
      'SELECT count(*) FROM sync_outbox WHERE acked_at IS NULL'
    )
    assert.ok(waiting > 0, 'changes wait while offline')

    const back = Date.now()
    transport.down = false
    let left = waiting
    while (left && Date.now() - back < 20000) {
      await sleep(200)
      left = await num(twin.shop.pool, 'SELECT count(*) FROM sync_outbox WHERE acked_at IS NULL')
    }
    assert.equal(left, 0, `still ${left} changes after ${Date.now() - back} ms`)
    assert.deepEqual(await copyDifferences(twin), [])
    assert.equal(agent.failures, 0)
  } finally {
    agent.stop()
    await twin.close()
  }
})
