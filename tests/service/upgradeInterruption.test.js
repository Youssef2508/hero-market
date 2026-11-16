'use strict'
// Migration 0040 (1.8.0) on a 1.7.0 store (schema 0039) is all or nothing: a failure in the middle,
// or the program ended by force while it runs, leaves the store exactly as it was, and the next
// start applies it in full. Each migration runs in one transaction with the record that it ran
// (src/server/db/migrate.js). Throw-away databases, made-up rows.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { requireDb, freshDatabase } = require('./helpers')
const { createPool } = require('../../src/server/db/pool')
const { migrate, DEFAULT_DIR } = require('../../src/server/db/migrate')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A migrations folder up to 0039, plus 0040 as given. */
function folder(name, sql0040) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hm-mig-${name}-`))
  for (const f of fs.readdirSync(DEFAULT_DIR))
    if (f < '0040') fs.copyFileSync(path.join(DEFAULT_DIR, f), path.join(dir, f))
  if (sql0040 !== null)
    fs.writeFileSync(path.join(dir, '0040_revisions_password_policy.sql'), sql0040)
  return dir
}
const REAL_0040 = fs.readFileSync(
  path.join(DEFAULT_DIR, '0040_revisions_password_policy.sql'),
  'utf8'
)

/** What a 1.7.0 store holds, and its shape, as one comparable value. */
async function state(pool) {
  const q = async (sql) => (await pool.query(sql)).rows
  return {
    schema: (await q('SELECT max(version) AS v FROM schema_migrations'))[0].v,
    columns: await q(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('users', 'supplier_purchases', 'stock_movements') ORDER BY 1, 2"
    ),
    revisionsTable: (await q("SELECT to_regclass('public.supplier_purchase_revisions') AS t"))[0].t,
    users: await q('SELECT id, username, password_scrypt FROM users ORDER BY id'),
    products: await q('SELECT barcode, name, stock_qty::text FROM products ORDER BY barcode'),
    purchases: await q(
      'SELECT id, total_amount::text, paid_amount::text FROM supplier_purchases ORDER BY id'
    ),
    syncTables: (await q('SELECT count(*)::int AS n FROM sync_tables'))[0].n
  }
}

async function store039(name) {
  const db = await freshDatabase()
  const pool = createPool(db.url)
  await migrate(pool, { dir: folder(`${name}-base`, null), logger: null })
  await pool.query(
    `INSERT INTO users (username, role, password_scrypt, is_active, created_at)
     VALUES ('owner', 'admin', 'scrypt$16384$8$5$c2FsdA$aGFzaA', true, LOCALTIMESTAMP(0))`
  )
  await pool.query(
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit)
     VALUES ('1', 'صنف واحد', 1, 10, 0, 'قطعة'), ('01', 'صنف صفر واحد', 2, 20, 0, 'قطعة'), ('001', 'صنف ثلاثة أصفار', 3, 30, 0, 'قطعة')`
  )
  await pool.query("INSERT INTO suppliers (name, debt_balance) VALUES ('مورد', 200)")
  await pool.query(
    "INSERT INTO supplier_purchases (supplier_id, invoice_ref, total_amount, paid_amount, remaining, timestamp) SELECT id, 'P-1', 300, 100, 200, LOCALTIMESTAMP(0) FROM suppliers"
  )
  return { db, pool }
}

test('0040 failing half way changes nothing; the next start applies it in full', async (t) => {
  if (!requireDb(t)) return
  const { db, pool } = await store039('fail')
  try {
    const before = await state(pool)
    assert.equal(before.schema, '0039')
    // The real 0040, then an error at its very end (after every statement of it ran).
    const broken = folder('fail', `${REAL_0040}\nSELECT 1 / 0;\n`)
    await assert.rejects(
      migrate(pool, { dir: broken, logger: null }),
      /0040_revisions_password_policy/
    )
    assert.deepEqual(await state(pool), before, 'not a column, table or row of 0040 remains')
    // The real one, at the next start.
    await migrate(pool, { dir: folder('fail-ok', REAL_0040), logger: null })
    const after = await state(pool)
    assert.equal(after.schema, '0040')
    assert.equal(after.revisionsTable, 'supplier_purchase_revisions')
    for (const k of ['users', 'products', 'purchases']) assert.deepEqual(after[k], before[k], k)
    assert.equal(after.syncTables, before.syncTables + 1)
    assert.equal(
      (await pool.query('SELECT bool_and(password_strong) AS s FROM users')).rows[0].s,
      true,
      'existing passwords count as strong'
    )
  } finally {
    await pool.end()
    await db.dispose()
  }
})

test('the program ended by force while 0040 runs: the store as it was, then a full update', async (t) => {
  if (!requireDb(t)) return
  const { db, pool } = await store039('kill')
  try {
    const before = await state(pool)
    // 0040 with a pause in the middle (after its first statements), run by a separate process.
    const paused = REAL_0040.replace(
      '-- ── Purchase corrections (D-112)',
      'SELECT pg_sleep(30);\n-- ── Purchase corrections (D-112)'
    )
    assert.notEqual(paused, REAL_0040)
    const dir = folder('kill', paused)
    const child = spawn(
      process.execPath,
      [
        '-e',
        `const { createPool } = require(${JSON.stringify(path.resolve('src/server/db/pool'))});
         const { migrate } = require(${JSON.stringify(path.resolve('src/server/db/migrate'))});
         migrate(createPool(${JSON.stringify(db.url)}), { dir: ${JSON.stringify(dir)}, logger: null })`
      ],
      { stdio: 'ignore' }
    )
    // Until it is inside 0040 (its pause is running), then ended by force.
    let inside = false
    for (let i = 0; i < 200 && !inside; i++) {
      await sleep(50)
      inside =
        (
          await pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%pg_sleep(30)%' AND pid <> pg_backend_pid()"
          )
        ).rowCount > 0
    }
    assert.ok(inside, 'the update was running 0040')
    child.kill('SIGKILL')
    // Its connection ends; the server rolls back what it had done.
    for (let i = 0; i < 200; i++) {
      const busy = await pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%pg_sleep(30)%' AND pid <> pg_backend_pid()"
      )
      if (!busy.rowCount) break
      await pool.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%pg_sleep(30)%' AND pid <> pg_backend_pid() AND now() - query_start > interval '3 seconds'"
      )
      await sleep(100)
    }
    assert.deepEqual(await state(pool), before, 'nothing of the interrupted update remains')
    await migrate(pool, { dir: folder('kill-ok', REAL_0040), logger: null })
    const after = await state(pool)
    assert.equal(after.schema, '0040')
    for (const k of ['users', 'products', 'purchases']) assert.deepEqual(after[k], before[k], k)
  } finally {
    await pool.end()
    await db.dispose()
  }
})
