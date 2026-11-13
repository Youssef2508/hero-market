'use strict'
// Defects found by the pre-production audit (.docs/PRE_PRODUCTION_AUDIT_REPORT.md), each with the
// test that failed before its fix.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { Writable } = require('stream')
const { requireDb, freshDatabase, startService } = require('./helpers')

let db, svc
const logged = []

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  // A real logger, writing to memory: what the service records as its own failures.
  const stream = new Writable({
    write(chunk, _enc, done) {
      logged.push(JSON.parse(chunk))
      done()
    }
  })
  svc = await startService(db.url, { logger: { level: 'info', stream } })
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

const raw = (payload, headers = {}) =>
  svc.app.inject({
    method: 'POST',
    url: '/api/auth.login',
    payload,
    headers: { 'content-type': 'application/json', ...headers }
  })

test('AUD-03: a malformed or oversized request is the caller’s error (4xx), never “unexpected server error”', async (t) => {
  if (!requireDb(t)) return
  logged.length = 0

  const badJson = await raw('{"username":')
  assert.equal(badJson.statusCode, 400, badJson.body)
  assert.equal(JSON.parse(badJson.body).error.code, 'bad_request')

  const tooBig = await raw(JSON.stringify({ username: 'x'.repeat(3 * 1024 * 1024) }))
  assert.equal(tooBig.statusCode, 413, tooBig.body)
  assert.equal(JSON.parse(tooBig.body).error.code, 'payload_too_large')

  const badType = await raw('x', { 'content-type': 'application/xml' })
  assert.equal(badType.statusCode, 415, badType.body)

  // The answers say nothing about the inside, and none of it is logged as a failure of the service.
  for (const r of [badJson, tooBig, badType]) assert.doesNotMatch(r.body, /node_modules|at |stack/i)
  assert.deepEqual(
    logged.filter((l) => l.msg === 'unhandled error'),
    [],
    'client errors must not be logged as unhandled'
  )
})
