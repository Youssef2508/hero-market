'use strict'
// The sync cycle's schedule (D-105): changes go every cycle; the whole-table comparison only every
// checkEveryMs, and at once again while the last one found a difference or could not run.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SyncAgent } = require('../../src/server/sync/agent')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function scripted(outcomes) {
  const agent = new SyncAgent({ pool: {}, transport: null })
  const calls = []
  agent.runOnce = async ({ check }) => {
    calls.push(check)
    if (!check) return { pushed: 0 }
    const ok = outcomes.length ? outcomes.shift() : true
    return { check: { ok } }
  }
  return { agent, calls }
}

test('a comparison that matched is not repeated until its interval has passed', async () => {
  const { agent, calls } = scripted([true])
  agent.start(5, { checkEveryMs: 400 })
  await sleep(150)
  const early = [...calls]
  await sleep(400)
  agent.stop()
  assert.equal(early[0], true, 'the first cycle compares')
  assert.ok(early.length >= 5 && early.slice(1).every((c) => c === false), JSON.stringify(early))
  assert.ok(calls.slice(early.length).includes(true), 'compares again once the interval passed')
})

test('a difference, or a comparison that could not run, is compared again on the next cycle', async () => {
  const { agent, calls } = scripted([false, null, true])
  agent.start(5, { checkEveryMs: 60000 })
  await sleep(200)
  agent.stop()
  assert.deepEqual(calls.slice(0, 3), [true, true, true])
  assert.ok(
    calls.slice(3).every((c) => c === false),
    JSON.stringify(calls)
  )
})
