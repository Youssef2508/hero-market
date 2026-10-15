'use strict'
// Legacy SQLite → PostgreSQL import: parity, idempotency, refusal rules and post-import behaviour.
// The source is built in the original SQLite format by scripts/init-dev-db.js, then given the awkward
// values real stores contain (binary floats, quotes, NULLs, deleted ids, a closed shift with sales).
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { DatabaseSync } = require('node:sqlite')
const { requireDb, freshDatabase, startService } = require('./helpers')
const { buildLegacyFixture } = require('../../scripts/init-dev-db')
const { createPool } = require('../../src/server/db/pool')
const { migrate } = require('../../src/server/db/migrate')
const { importLegacy, rebrandStoreName } = require('../../src/server/db/legacy-import')
const { verifyLedger } = require('../../src/server/inventory/stock')

const quiet = { info() {}, warn() {}, error() {}, log() {} }
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
let dir, source

function makeSource(name, extra) {
  const file = path.join(dir, name)
  buildLegacyFixture(file, { reset: true })
  const db = new DatabaseSync(file)
  db.exec(extra)
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()
  return file
}

async function migratedDatabase() {
  const db = await freshDatabase()
  const pool = createPool(db.url, { max: 2 })
  await migrate(pool, { logger: quiet })
  return { ...db, pool, close: async () => (await pool.end(), await db.dispose()) }
}

before(() => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-import-'))
  source = makeSource(
    'legacy.db',
    `
    INSERT INTO shifts (id, user_id, start_time, initial_cash, status) VALUES (2, 2, '2026-10-01 08:00:00', 200, 'open');
    INSERT INTO sales (id, shift_id, user_id, timestamp, total_amount, original_amount, discount, payment_type, client_name, client_id)
      VALUES (1, 2, 2, '2026-10-01 09:15:42', 0.30000000000000004, 0.30000000000000004, 0, 'نقدي', 'عميل "VIP" ''خاص''', 3);
    INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, cost_price, returned_qty)
      VALUES (1, '00515', 0.125, 2.4000000000000004, 0.30000000000000004, 0.1, 0);
    INSERT INTO sales (id, shift_id, user_id, timestamp, total_amount, payment_type) VALUES (2, 2, 2, '2026-10-01 09:20:00', 5, 'نقدي');
    DELETE FROM sales WHERE id = 2;
    INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES (3, 'debt', 12.5, NULL, '2026-10-01');
    INSERT INTO checks_register (check_type, party_name, due_date, amount) VALUES ('عميل', 'طرف', '2026-11-01', 1000);
    UPDATE shifts SET status = 'closed', end_time = '2026-10-01 17:00:00', expected_end_cash = 200.3, actual_end_cash = 200, difference = -0.3 WHERE id = 2;
    `
  )
})
after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

test('dry run verifies parity and leaves the target empty', async (t) => {
  if (!requireDb(t)) return
  const target = await migratedDatabase()
  try {
    const r = await importLegacy(target.pool, source, { dryRun: true, logger: quiet })
    assert.equal(r.mode, 'dry-run')
    assert.ok(r.parity.ok)
    const { rows } = await target.pool.query('SELECT count(*)::int AS n FROM products')
    assert.equal(rows[0].n, 0, 'rolled back')
  } finally {
    await target.close()
  }
})

test('import keeps every row and value; backup verified; source untouched; re-run only verifies', async (t) => {
  if (!requireDb(t)) return
  const target = await migratedDatabase()
  const before = sha(source)
  try {
    const backupDir = path.join(dir, 'backups')
    const r = await importLegacy(target.pool, source, { backupDir, logger: quiet })
    assert.equal(r.mode, 'import')
    assert.ok(r.parity.ok, JSON.stringify(r.parity.tables, null, 1))
    for (const [table, e] of Object.entries(r.parity.tables)) {
      assert.equal(e.sourceRows, e.targetRows, table)
      assert.equal(e.sourceHash, e.targetHash, table)
    }
    assert.equal(r.parity.tables.products.sourceRows, 9)
    assert.ok(Object.values(r.foreignKeyViolations).every((n) => n === 0))
    // Stock ledger (migration 0004): imported stock is explained by one opening movement each.
    assert.deepEqual(await verifyLedger(target.pool), [], 'stock = sum of movements')
    const withStock = (
      await target.pool.query(
        'SELECT count(*)::int AS n FROM products WHERE COALESCE(stock_qty, 0) <> 0'
      )
    ).rows[0].n
    assert.ok(withStock > 0)
    assert.equal(r.openingStockMovements, withStock)
    assert.equal(sha(source), before, 'source file not modified')
    assert.ok(r.backups.length >= 1 && r.backups.every((b) => fs.existsSync(b)))
    assert.equal(sha(r.backups[0]), before, 'backup is byte-identical')

    const q = async (sql) => (await target.pool.query(sql)).rows
    const [sale] = await q(
      'SELECT total_amount::text AS t, client_name, timestamp FROM sales WHERE id = 1'
    )
    assert.equal(sale.t, '0.30000000000000004', 'binary float kept exactly, not rounded')
    assert.equal(sale.client_name, `عميل "VIP" 'خاص'`)
    assert.equal(sale.timestamp, '2026-10-01 09:15:42', 'local time kept as written')
    const [ledger] = await q('SELECT description, timestamp FROM client_ledger')
    assert.deepEqual(ledger, { description: null, timestamp: '2026-10-01 00:00:00' })
    // Deleted id 2 must never be reused: the sequence continues after SQLite's high-water mark.
    const [next] = await q("SELECT nextval(pg_get_serial_sequence('sales', 'id'))::int AS id")
    assert.equal(next.id, 3)

    const again = await importLegacy(target.pool, source, { logger: quiet })
    assert.equal(again.mode, 'verify-existing')
    assert.ok(again.parity.ok)
    assert.equal((await q('SELECT count(*)::int AS n FROM products'))[0].n, 9, 'nothing duplicated')
  } finally {
    await target.close()
  }
})

test('after import: a legacy PIN is accepted once to choose a password, keeps the mapped role, then stops working', async (t) => {
  if (!requireDb(t)) return
  const target = await migratedDatabase()
  try {
    await importLegacy(target.pool, source, { logger: quiet })
    await target.pool.end()
    const svc = await startService(target.url)
    try {
      // Phase 3: username + the old (plain-text) PIN → no session yet, a password must be chosen.
      const first = await svc.call('auth.login', { username: 'admin', password: '1234' })
      assert.equal(first.status, 200)
      assert.equal(first.body.passwordChangeRequired, true)
      assert.equal(first.body.token, undefined, 'no session before a password is chosen')
      const r = await svc.call('auth.setPassword', {
        username: 'admin',
        currentPassword: '1234',
        newPassword: 'Store-Owner-2026'
      })
      assert.equal(r.status, 200)
      assert.equal(r.body.user.roleKey, 'super_admin')
      assert.match(
        r.body.recoveryCode,
        /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/,
        'owner gets a recovery code'
      )
      const [u] = (
        await svc.pool.query(
          "SELECT password_hash, pin_lookup, pin_hash, password_scrypt FROM users WHERE username = 'admin'"
        )
      ).rows
      assert.deepEqual(
        [u.password_hash, u.pin_lookup, u.pin_hash],
        [null, null, null],
        'PIN erased'
      )
      assert.ok(u.password_scrypt.startsWith('scrypt$'))
      assert.equal(
        (await svc.call('auth.login', { username: 'admin', password: '1234' })).status,
        401,
        'the old PIN no longer works'
      )
      const c = await svc.call('auth.setPassword', {
        username: 'cashier1',
        currentPassword: '1111',
        newPassword: 'Cashier-pass-1'
      })
      assert.equal(c.body.user.roleKey, 'cashier')
      const history = await svc.call('sales.page', { page: 1, pageSize: 10 }, r.body.token)
      assert.equal(history.status, 200)
    } finally {
      await svc.close()
    }
  } finally {
    await target.dispose()
  }
})

test('refuses a target that already holds other data, and sources with invalid values or orphans', async (t) => {
  if (!requireDb(t)) return
  const target = await migratedDatabase()
  try {
    await target.pool.query("INSERT INTO products (barcode, name) VALUES ('X1', 'existing data')")
    await assert.rejects(
      importLegacy(target.pool, source, { logger: quiet }),
      /Refusing to overwrite/
    )
    await target.pool.query("DELETE FROM products WHERE barcode = 'X1'")

    const bad = makeSource(
      'bad.db',
      "UPDATE products SET cost_price = 'abc' WHERE barcode = '00515';"
    )
    await assert.rejects(importLegacy(target.pool, bad, { logger: quiet }), /needs attention/)
    const orphan = makeSource(
      'orphan.db',
      "PRAGMA foreign_keys = OFF; INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price) VALUES (999, '00515', 1, 1, 1);"
    )
    await assert.rejects(importLegacy(target.pool, orphan, { logger: quiet }), /orphans/)
    const { rows } = await target.pool.query('SELECT count(*)::int AS n FROM users')
    assert.equal(rows[0].n, 0, 'nothing written by refused imports')
  } finally {
    await target.close()
  }
})

test('after import, the earlier default store name becomes HeroMarket (logged); chosen names are kept', async (t) => {
  if (!requireDb(t)) return
  const old = makeSource(
    'old-name.db',
    "UPDATE settings SET value = 'سوبر ماركت النجدي' WHERE key = 'store_name';"
  )
  const target = await migratedDatabase()
  try {
    const r = await importLegacy(target.pool, old, { logger: quiet })
    assert.ok(r.parity.ok, 'parity is checked on the data exactly as it was')
    assert.deepEqual(await rebrandStoreName(target.pool), {
      from: 'سوبر ماركت النجدي',
      to: 'هيرو ماركت'
    })
    const q = async (sql) => (await target.pool.query(sql)).rows
    assert.equal(
      (await q("SELECT value FROM settings WHERE key = 'store_name'"))[0].value,
      'هيرو ماركت'
    )
    const log = await q(
      "SELECT description, details FROM system_logs WHERE action_type = 'settings_update'"
    )
    assert.equal(
      JSON.parse(log[0].details).from,
      'سوبر ماركت النجدي',
      'previous value kept for audit'
    )
    assert.ok(
      !log[0].description.includes('النجدي'),
      'the visible log text does not repeat the old name'
    )
    assert.equal(await rebrandStoreName(target.pool), null, 'runs once')
    await target.pool.query("UPDATE settings SET value = 'ماركت الأمل' WHERE key = 'store_name'")
    assert.equal(await rebrandStoreName(target.pool), null, 'a name the store chose is kept')
  } finally {
    await target.close()
  }
})
