#!/usr/bin/env node
/* eslint-disable no-console */
'use strict'
// HeroMarket server for multi-till stores: one PostgreSQL database, several desktop terminals in
// "client" mode (see .docs/DATABASE_ARCHITECTURE.md §Deployment and .docs/DOCKER.md).
//
//   node src/server/cli.js serve      migrate, then listen on HOST:PORT
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

async function serve() {
  const host = process.env.HOST || '127.0.0.1'
  const port = Number(process.env.PORT || 8787)
  const svc = await createService({
    databaseUrl: setting('HEROMARKET_DATABASE_URL', { required: true }),
    secret: setting('HEROMARKET_SECRET', { required: true }),
    timeZone: process.env.HEROMARKET_TIMEZONE,
    // Anyone on the network could otherwise claim the first administrator account.
    setupCode: setting('HEROMARKET_SETUP_CODE') || crypto.randomInt(10 ** 7, 10 ** 8).toString()
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

const commands = { serve, migrate: migrateOnly, health, 'reset-password': resetPasswordCommand }
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
