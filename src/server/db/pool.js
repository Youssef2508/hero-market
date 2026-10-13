'use strict'
// PostgreSQL access for the HeroMarket service: one pool, parameterised queries, explicit transactions.
const { Pool, types } = require('pg')

// Return types the renderer already expects:
//  - numeric/int8 as JS numbers (the app has always used JS numbers for money and quantities),
//  - timestamp/date as the original text ('YYYY-MM-DD HH:MM:SS' / 'YYYY-MM-DD'), never converted through
//    the machine's time zone.
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)))
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : Number(v)))
types.setTypeParser(types.builtins.TIMESTAMP, (v) => v)
types.setTypeParser(types.builtins.DATE, (v) => v)

function createPool(connectionString, opts = {}) {
  if (!connectionString) throw new Error('HEROMARKET_DATABASE_URL is not configured')
  const pool = new Pool({
    connectionString,
    max: opts.max || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: opts.connectionTimeoutMillis || 5000,
    application_name: 'heromarket-service'
  })
  // A dropped idle connection must not crash the process; the next query reconnects.
  pool.on('error', (err) => {
    if (opts.logger) opts.logger.error({ err }, 'idle PostgreSQL client error')
  })
  return pool
}

/** Run fn(client) inside BEGIN/COMMIT; ROLLBACK on any error. */
async function withTransaction(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // connection already broken; the original error is what matters
    }
    throw err
  } finally {
    client.release()
  }
}

module.exports = { createPool, withTransaction }
