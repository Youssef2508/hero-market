'use strict'
// Schema migration runner: numbered SQL files, applied once each, in order, each in its own transaction.
// Applied files are recorded with a SHA-256 checksum; editing an applied file is refused.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const DEFAULT_DIR = path.join(__dirname, 'migrations')
const LOCK_KEY = 48151623 // pg_advisory_lock key: only one process migrates at a time

function listMigrations(dir = DEFAULT_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      return {
        version: file.slice(0, 4),
        name: file.replace(/\.sql$/, ''),
        sql,
        checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
      }
    })
}

/**
 * `table` names where applied files are recorded. The cloud's own few tables live in the same
 * database as its copy of the store and are recorded apart ('cloud_schema_migrations'), so their
 * numbers never meet the store's.
 */
async function migrate(
  pool,
  { dir = DEFAULT_DIR, logger = console, table = 'schema_migrations' } = {}
) {
  if (!/^[a-z_]+$/.test(table)) throw new Error('invalid migrations table name')
  const client = await pool.connect()
  const applied = []
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
    await client.query(`CREATE TABLE IF NOT EXISTS ${table} (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamp NOT NULL DEFAULT LOCALTIMESTAMP(0)
    )`)
    const { rows } = await client.query(`SELECT version, checksum FROM ${table}`)
    const done = new Map(rows.map((r) => [r.version, r.checksum]))
    for (const m of listMigrations(dir)) {
      if (done.has(m.version)) {
        if (done.get(m.version) !== m.checksum) {
          throw new Error(
            `Migration ${m.name} was modified after it was applied (checksum mismatch)`
          )
        }
        continue
      }
      await client.query('BEGIN')
      try {
        await client.query(m.sql)
        await client.query(`INSERT INTO ${table} (version, name, checksum) VALUES ($1, $2, $3)`, [
          m.version,
          m.name,
          m.checksum
        ])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        err.message = `Migration ${m.name} failed: ${err.message}`
        throw err
      }
      applied.push(m.name)
      if (logger && logger.info) logger.info(`[migrate] applied ${m.name}`)
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
    } catch {
      // ignore
    }
    client.release()
  }
  return applied
}

module.exports = { migrate, listMigrations, DEFAULT_DIR }
