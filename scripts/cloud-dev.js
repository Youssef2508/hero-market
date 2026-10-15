#!/usr/bin/env node
'use strict'
// Local test cloud for development and QA (stage 4 phase 4). Never a production deployment:
// it listens on 127.0.0.1 only, uses the development PostgreSQL (`npm run pg:dev`) and creates
// nothing outside this machine.
//
//   node scripts/cloud-dev.js serve [--port 8790]
//   node scripts/cloud-dev.js register <store-id> [name]      prints the device token once
//   node scripts/cloud-dev.js command <store-id> <type> '<json payload>'
//   node scripts/cloud-dev.js commands <store-id>              lists commands and their status
const { Client } = require('pg')
const pgDev = require('./pg-dev')
const { createCloudService, registerStore, createCommand } = require('../src/server/cloud/app')
const { createPool } = require('../src/server/db/pool')

const DB = 'heromarket_cloud_dev'

async function ensureDatabase() {
  const admin = new Client({ connectionString: pgDev.url('postgres') })
  await admin.connect()
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB])
  if (!exists.rowCount) await admin.query(`CREATE DATABASE ${DB} ENCODING 'UTF8'`)
  await admin.end()
  return pgDev.url(DB)
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  const url = await ensureDatabase()
  if (cmd === 'serve') {
    const i = args.indexOf('--port')
    const port = i >= 0 ? Number(args[i + 1]) : 8790
    const cloud = await createCloudService({ databaseUrl: url, logger: { level: 'info' } })
    await cloud.prepare()
    await cloud.app.listen({ host: '127.0.0.1', port })
    console.log(`test cloud on http://127.0.0.1:${port} (database ${DB})`)
    return
  }
  const cloud = await createCloudService({ databaseUrl: url, logger: false })
  await cloud.prepare()
  const pool = createPool(url, { max: 2 })
  try {
    if (cmd === 'register') {
      const { token } = await registerStore(pool, { storeId: args[0], name: args[1] || '' })
      console.log(`store ${args[0]} registered; device token (shown once): ${token}`)
    } else if (cmd === 'command') {
      const id = await createCommand(pool, args[0], { type: args[1], payload: JSON.parse(args[2]) })
      console.log(`queued command ${id}`)
    } else if (cmd === 'commands') {
      const { rows } = await pool.query(
        'SELECT id, type, status, result, created_at FROM cloud_commands WHERE store_id = $1 ORDER BY seq',
        [args[0]]
      )
      console.table(rows.map((r) => ({ ...r, result: JSON.stringify(r.result) })))
    } else {
      console.error(
        'usage: node scripts/cloud-dev.js serve | register <store-id> | command <store-id> <type> <json> | commands <store-id>'
      )
      process.exitCode = 2
    }
  } finally {
    await pool.end()
    await cloud.app.close()
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
