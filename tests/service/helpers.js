'use strict'
// Integration-test helpers: a fresh, migrated PostgreSQL database per test file and an in-process service.
// Needs HEROMARKET_TEST_DATABASE_URL (CI service container, or `npm run pg:dev` locally).
const crypto = require('crypto')
const { Client } = require('pg')
const { createService } = require('../../src/server/app')
const { pinLookup, hashPin } = require('../../src/server/auth/pin')

const BASE_URL = process.env.HEROMARKET_TEST_DATABASE_URL
const TEST_SECRET = 'test-secret-'.padEnd(40, 'x')

function requireDb(t) {
  if (!BASE_URL) {
    t.skip('HEROMARKET_TEST_DATABASE_URL not set')
    return false
  }
  return true
}

/** Create an empty database for one test file and return its URL (dropped by `dispose`). */
async function freshDatabase() {
  const name = `hm_t_${crypto.randomBytes(5).toString('hex')}`
  const admin = new Client({ connectionString: BASE_URL })
  await admin.connect()
  await admin.query(
    `CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`
  )
  await admin.end()
  const url = new URL(BASE_URL)
  url.pathname = `/${name}`
  return {
    url: url.toString(),
    dispose: async () => {
      const c = new Client({ connectionString: BASE_URL })
      await c.connect()
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await c.end()
    }
  }
}

async function startService(databaseUrl) {
  const svc = await createService({
    databaseUrl,
    secret: TEST_SECRET,
    logger: false,
    timeZone: 'Africa/Cairo'
  })
  await svc.prepare()
  await svc.app.ready()
  const call = async (op, body = {}, token = null, headers = {}) => {
    const res = await svc.app.inject({
      method: 'POST',
      url: `/api/${op}`,
      payload: body,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }
    })
    const json = res.body ? JSON.parse(res.body) : null
    return { status: res.statusCode, body: json }
  }
  return { ...svc, call, close: () => svc.app.close() }
}

/** Insert a user with a built-in role directly (for tests that do not exercise user management). */
async function createUser(svc, { username, pin, roleKey }) {
  const { rows } = await svc.pool.query(
    `INSERT INTO users (username, role, role_id, pin_lookup, pin_hash, is_active, created_at)
     VALUES ($1, $2, (SELECT id FROM roles WHERE key = $2), $3, $4, true, LOCALTIMESTAMP(0)) RETURNING id`,
    [username, roleKey, pinLookup(TEST_SECRET, pin), hashPin(pin)]
  )
  return rows[0].id
}

async function login(svc, pin) {
  const r = await svc.call('auth.login', { pin }, null, { 'x-heromarket-terminal': `test-${pin}` })
  if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`)
  return r.body.token
}

module.exports = { requireDb, freshDatabase, startService, createUser, login, TEST_SECRET }
