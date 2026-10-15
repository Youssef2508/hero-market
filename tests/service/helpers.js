'use strict'
// Integration-test helpers: a fresh, migrated PostgreSQL database per test file and an in-process service.
// Needs HEROMARKET_TEST_DATABASE_URL (CI service container, or `npm run pg:dev` locally).
const crypto = require('crypto')
const { Client } = require('pg')
const { createService } = require('../../src/server/app')
const { pinLookup, hashPin } = require('../../src/server/auth/pin')
const { hashPassword } = require('../../src/server/auth/password')

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

async function startService(databaseUrl, options = {}) {
  const svc = await createService({
    databaseUrl,
    secret: TEST_SECRET,
    logger: false,
    timeZone: 'Africa/Cairo',
    ...options
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

// Tests identify their users by a short code ("pin"); since stage 4 phase 3 the user signs in with
// username + password, so the code maps to the username and a password derived from it.
const usersByCode = new Map()
const passwordFor = (code) => `Test-${code}-pw`

/** First-run setup through the service (auth.setup); the owner then logs in with `login(svc, pin)`. */
async function setupOwner(svc, { username, pin, setupCode }) {
  const r = await svc.call('auth.setup', { username, password: passwordFor(pin), setupCode })
  if (r.status === 200) usersByCode.set(String(pin), username)
  return r
}

/**
 * A user created by an administrator signs in with the temporary password and chooses
 * `passwordFor(code)`; returns the session token (and `login(svc, code)` works afterwards).
 */
async function activateUser(svc, username, temporaryPassword, code) {
  const r = await svc.call('auth.setPassword', {
    username,
    currentPassword: temporaryPassword,
    newPassword: passwordFor(code)
  })
  if (r.status !== 200) throw new Error(`activation failed: ${JSON.stringify(r.body)}`)
  usersByCode.set(String(code), username)
  return r.body.token
}

/**
 * Insert a user with a built-in role directly (for tests that do not exercise user management).
 * The user has a password (`passwordFor(pin)`); `legacyPin: true` instead stores only a PIN, as an
 * account from before the password change.
 */
async function createUser(svc, { username, pin, roleKey, legacyPin = false }) {
  const { rows } = legacyPin
    ? await svc.pool.query(
        `INSERT INTO users (username, role, role_id, pin_lookup, pin_hash, is_active, created_at)
         VALUES ($1, $2, (SELECT id FROM roles WHERE key = $2), $3, $4, true, LOCALTIMESTAMP(0)) RETURNING id`,
        [username, roleKey, pinLookup(TEST_SECRET, pin), hashPin(pin)]
      )
    : await svc.pool.query(
        `INSERT INTO users (username, role, role_id, password_scrypt, is_active, created_at)
         VALUES ($1, $2, (SELECT id FROM roles WHERE key = $2), $3, true, LOCALTIMESTAMP(0)) RETURNING id`,
        [username, roleKey, hashPassword(passwordFor(pin))]
      )
  usersByCode.set(String(pin), username)
  return rows[0].id
}

async function login(svc, pin) {
  const username = usersByCode.get(String(pin))
  if (!username) throw new Error(`no test user with code ${pin}`)
  const r = await svc.call('auth.login', { username, password: passwordFor(pin) }, null, {
    'x-heromarket-terminal': `test-${pin}`
  })
  if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`)
  return r.body.token
}

/**
 * Insert products with stock for a test, the way an import does: the rows are written as an
 * administrative rebuild and their stock becomes opening movements (stock ledger, migration 0004).
 */
async function seedProducts(svc, insertSql, params = []) {
  const c = await svc.pool.connect()
  try {
    await c.query('BEGIN')
    await c.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
    await c.query(insertSql, params)
    await c.query("SELECT hm_post_opening_balances('test seed')")
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    c.release()
  }
}

module.exports = {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts,
  TEST_SECRET,
  passwordFor,
  setupOwner,
  activateUser
}
