#!/usr/bin/env node
/* eslint-disable no-console */
'use strict'
// HeroMarket server for multi-till stores: one PostgreSQL database, several desktop terminals in
// "client" mode (see .docs/DATABASE_ARCHITECTURE.md §Deployment and .docs/DOCKER.md).
//
//   node src/server/cli.js serve      migrate, then listen on HOST:PORT
//   node src/server/cli.js cloud      the internet way in (D-101): a copy of one store, fed by its link
//   node src/server/cli.js cloud-register <store-id> [name]   pair that store; prints its token once
//   node src/server/cli.js migrate    apply pending migrations and exit
//   node src/server/cli.js health     exit 0 when the running server reports healthy (container probe)
//   node src/server/cli.js reset-password <username>
//                                      temporary password for a user who cannot sign in (printed once)
//
// Configuration (environment; *_FILE variants read the value from a file, e.g. a Docker secret):
//   HEROMARKET_DATABASE_URL[_FILE]  postgres://user:password@host:5432/heromarket   (required)
//   HEROMARKET_SECRET[_FILE]        ≥ 32 random characters; keep it with the database backups (required)
//   HEROMARKET_TIMEZONE             store time zone, e.g. Africa/Cairo (default: this machine's)
//   HOST / PORT                     listen address (default 127.0.0.1:8787)
//   HEROMARKET_SETUP_CODE           first-run code (default: random, printed to the log while no users exist)
//   HEROMARKET_LOG_LEVEL            info | warn | error | debug
//   HEROMARKET_SYNC_AGENT           1 = run the cloud sync agent here (once linked in the app)
//   HEROMARKET_TRUST_PROXY          cloud: the reverse proxy's address or network (X-Forwarded-For)
const fs = require('fs')
const crypto = require('crypto')
const { createService } = require('./app')
const { createPool } = require('./db/pool')
const { migrate } = require('./db/migrate')

function setting(name, { required = false } = {}) {
  const file = process.env[`${name}_FILE`]
  const value = file ? fs.readFileSync(file, 'utf8').trim() : process.env[name]
  if (required && !value) {
    console.error(`${name} (or ${name}_FILE) is required.`)
    process.exit(2)
  }
  return value
}

const cloudConfig = () => ({
  databaseUrl: setting('HEROMARKET_DATABASE_URL', { required: true }),
  secret: setting('HEROMARKET_SECRET', { required: true }),
  // The shop's time zone: the copy holds the shop's local times.
  timeZone: process.env.HEROMARKET_TIMEZONE || 'Africa/Cairo',
  role: 'cloud',
  // The browser build of the screens (npm run build:web), served next to the API.
  webRoot: process.env.HEROMARKET_WEB_ROOT || undefined,
  // Only for trying it on this machine over plain http: the session cookie without "Secure".
  insecureCookies: process.env.HEROMARKET_INSECURE_COOKIES === '1',
  // Named on every answer (architecture §14.1).
  appVersion: require('../../package.json').version,
  // The reverse proxy's address(es) or network, comma separated (D-105), e.g. 172.16.0.0/12 in
  // Docker: only these may say who the visitor is.
  trustProxy: process.env.HEROMARKET_TRUST_PROXY || undefined
})

// The internet way in (D-101): the same service on a copy of the store, fed by the shop PC's link.
// It has no first-run setup: its users are the shop's, received through the link.
async function cloud() {
  const svc = await createService(cloudConfig())
  await svc.prepare()
  await svc.app.listen({
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 8787)
  })
  const stop = async (signal) => {
    svc.app.log.info(`${signal} received, shutting down`)
    await svc.app.close()
    process.exit(0)
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}

// Make the cloud's one store record for a shop installation and print its device token, once.
// The store id is shown on the shop PC under «المزامنة السحابية».
async function cloudRegister() {
  const storeId = process.argv[3]
  if (!/^[0-9a-f-]{36}$/i.test(storeId || '')) {
    console.error('usage: node src/server/cli.js cloud-register <store-id> [name]')
    process.exit(2)
  }
  const { registerStore } = require('./cloud/app')
  const svc = await createService({ ...cloudConfig(), logger: false })
  try {
    await svc.prepare()
    const existing = await svc.pool.query('SELECT store_id FROM cloud_stores')
    if (existing.rowCount) {
      console.error(
        `This cloud already serves store ${existing.rows[0].store_id}. A cloud serves one store.`
      )
      process.exitCode = 1
      return
    }
    const { token } = await registerStore(svc.pool, { storeId, name: process.argv[4] || '' })
    console.log(`Store ${storeId} registered.`)
    console.log(`Device token (shown once; enter it on the shop PC): ${token}`)
  } finally {
    await svc.app.close()
  }
}

// Print a one-time pairing code for the shop PC (D-102): 15 minutes, one use, never stored plain.
// Pairing a second PC replaces the first one's access; the store's data here is not touched.
async function cloudPair() {
  const { newPairingCode } = require('./cloud/pairing')
  const svc = await createService({ ...cloudConfig(), logger: false })
  try {
    await svc.prepare()
    const existing = (await svc.pool.query('SELECT store_id, name FROM cloud_stores')).rows[0]
    const { code, minutes } = await newPairingCode(svc.pool, { name: process.argv[3] || '' })
    console.log(`Pairing code (valid ${minutes} minutes, one use): ${code}`)
    console.log('Enter it on the shop PC: المزامنة السحابية ← ربط برمز.')
    if (existing)
      console.log(
        `This cloud already serves store ${existing.store_id}. The PC that uses this code replaces the PC linked now, which will be refused from then on. The store's data is kept.`
      )
  } finally {
    await svc.app.close()
  }
}

async function serve() {
  const host = process.env.HOST || '127.0.0.1'
  const port = Number(process.env.PORT || 8787)
  const svc = await createService({
    databaseUrl: setting('HEROMARKET_DATABASE_URL', { required: true }),
    secret: setting('HEROMARKET_SECRET', { required: true }),
    timeZone: process.env.HEROMARKET_TIMEZONE,
    // Anyone on the network could otherwise claim the first administrator account.
    setupCode: setting('HEROMARKET_SETUP_CODE') || crypto.randomInt(10 ** 7, 10 ** 8).toString(),
    syncAgent: process.env.HEROMARKET_SYNC_AGENT === '1'
  })
  await svc.prepare()
  const { rows } = await svc.pool.query('SELECT count(*)::int AS n FROM users')
  if (rows[0].n === 0) {
    console.log(
      `HeroMarket first-run setup code: ${svc.app.config.setupCode} (enter it on the first terminal)`
    )
  }
  await svc.app.listen({ host, port })
  const stop = async (signal) => {
    svc.app.log.info(`${signal} received, shutting down`)
    await svc.app.close()
    process.exit(0)
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}

async function migrateOnly() {
  const pool = createPool(setting('HEROMARKET_DATABASE_URL', { required: true }), { max: 1 })
  try {
    const applied = await migrate(pool, { logger: console })
    console.log(`migrations up to date (${applied?.length ?? 0} applied now)`)
  } finally {
    await pool.end()
  }
}

async function health() {
  const port = Number(process.env.PORT || 8787)
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(4000)
  })
  const body = await res.json()
  if (res.status !== 200 || body.status !== 'ok') throw new Error(JSON.stringify(body))
}

async function resetPasswordCommand() {
  const username = process.argv[3]
  if (!username) {
    console.error('usage: node src/server/cli.js reset-password <username>')
    process.exit(2)
  }
  const { resetPassword } = require('./auth/reset')
  const pool = createPool(setting('HEROMARKET_DATABASE_URL', { required: true }), { max: 1 })
  try {
    const r = await resetPassword(pool, username, { via: 'cli' })
    console.log(`Temporary password for "${r.username}": ${r.temporaryPassword}`)
    console.log('It must be changed at the next sign-in. It is not shown again.')
  } finally {
    await pool.end()
  }
}

const commands = {
  serve,
  cloud,
  'cloud-register': cloudRegister,
  'cloud-pair': cloudPair,
  migrate: migrateOnly,
  health,
  'reset-password': resetPasswordCommand
}
const command = commands[process.argv[2]]
if (!command) {
  console.error(
    'usage: node src/server/cli.js serve | migrate | health | reset-password <username>'
  )
  process.exit(2)
}
command().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
