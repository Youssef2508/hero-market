'use strict'
// An existing installation from an older release, rebuilt in a disposable database exactly as that
// version left it (tests/fixtures/old-stores, made by scripts/make-old-store-fixture.js with the
// released code itself): its schema (this repository's migrations up to that version's last one –
// released migrations never change), every row, and every sequence position.
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { Pool } = require('pg')
const { migrate, DEFAULT_DIR } = require('../../src/server/db/migrate')

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'old-stores')

function readOldStore(name) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, name))).toString('utf8'))
}

/** Build the old version's database from its fixture. Returns the fixture. */
async function loadOldStore(url, name) {
  const store = readOldStore(name)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-old-'))
  for (const f of fs.readdirSync(DEFAULT_DIR))
    if (f.slice(0, 4) <= store.schema) fs.copyFileSync(path.join(DEFAULT_DIR, f), path.join(dir, f))
  const pool = new Pool({ connectionString: url, max: 1 })
  try {
    await migrate(pool, { dir, logger: { info() {} } })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // As that PC's database is: its rows as stored, without running today's triggers on them.
      await client.query("SET LOCAL session_replication_role = 'replica'")
      const tables = (
        await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations'"
        )
      ).rows.map((r) => r.table_name)
      await client.query(
        `TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`
      )
      for (const [t, rows] of Object.entries(store.tables)) {
        const cols = (
          await client.query(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'`,
            [t]
          )
        ).rows.map((r) => `"${r.column_name}"`)
        await client.query(
          `INSERT INTO "${t}" (${cols.join(', ')}) OVERRIDING SYSTEM VALUE
           SELECT ${cols.join(', ')} FROM jsonb_populate_recordset(NULL::"${t}", $1::jsonb)`,
          [JSON.stringify(rows)]
        )
      }
      for (const [s, v] of Object.entries(store.sequences))
        await client.query('SELECT setval($1::regclass, $2::bigint, true)', [`"${s}"`, v])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
    fs.rmSync(dir, { recursive: true, force: true })
  }
  return store
}

module.exports = { loadOldStore, readOldStore }
