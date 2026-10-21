'use strict'
// Migration 0016 (money model) over a 1.4.0 database with history: an open and a closed shift with
// sales, drawer movements and expenses (with and without a category in the list). Nothing that
// existed changes; the new columns are filled from existing rows only; the treasury starts empty.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { requireDb, freshDatabase } = require('./helpers')
const { createPool } = require('../../src/server/db/pool')
const { migrate, listMigrations } = require('../../src/server/db/migrate')
const { drawerFigures } = require('../../src/server/modules/shifts').helpers

const quiet = { info() {} }

test('0016 keeps every figure of existing shifts and fills the new columns from existing rows', async (t) => {
  if (!requireDb(t)) return
  const fresh = await freshDatabase()
  const pool = createPool(fresh.url, { max: 2 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig16-'))
  try {
    for (const m of listMigrations().filter((x) => Number(x.version) < 16))
      fs.copyFileSync(
        path.join(__dirname, '../../src/server/db/migrations', `${m.name}.sql`),
        path.join(tmp, `${m.name}.sql`)
      )
    await migrate(pool, { dir: tmp, logger: quiet })
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SELECT set_config('hm.bulk_load', 'on', true)")
      await c.query(
        `INSERT INTO users (id, username, role) VALUES (1, 'a', 'cashier'), (2, 'b', 'cashier')`
      )
      await c.query(`INSERT INTO shifts (id, user_id, start_time, end_time, initial_cash, expected_end_cash, actual_end_cash, difference, status)
        VALUES (1, 1, '2026-10-01 08:00', '2026-10-01 20:00', 200, 330, 325, -5, 'closed'),
               (2, 2, '2026-10-02 08:00', NULL, 100, 100, 0, NULL, 'open')`)
      await c.query(`INSERT INTO sales (id, shift_id, user_id, timestamp, total_amount, original_amount, discount, payment_type)
        VALUES (1, 1, 1, '2026-10-01 09:00', 150, 150, 0, 'نقدي'), (2, 1, 1, '2026-10-01 10:00', 40, 40, 0, 'فودافون كاش'),
               (3, 2, 2, '2026-10-02 09:00', 60, 60, 0, 'نقدي')`)
      await c.query(`INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
        VALUES (1, 'outflow', 20, 'مصروفات - تصنيف: كهرباء - فاتورة', '2026-10-01 11:00'),
               (2, 'outflow', 5, 'مصروفات - تصنيف: نثريات خاصة - ', '2026-10-02 10:00')`)
      await c.query(`INSERT INTO expenses (shift_id, amount, category, description, timestamp)
        VALUES (1, 20, 'كهرباء', 'فاتورة', '2026-10-01 11:00'), (2, 5, 'نثريات خاصة', '', '2026-10-02 10:00')`)
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    const fig = async () => [
      await drawerFigures(pool, { id: 1, initial_cash: 200 }),
      await drawerFigures(pool, { id: 2, initial_cash: 100 })
    ]
    const keep = async () => ({
      shifts: (await pool.query('SELECT * FROM shifts ORDER BY id')).rows,
      sales: (await pool.query('SELECT * FROM sales ORDER BY id')).rows,
      ledger: (
        await pool.query(
          'SELECT id, shift_id, type, amount, description, timestamp FROM safe_ledger ORDER BY id'
        )
      ).rows,
      expenses: (
        await pool.query(
          'SELECT id, shift_id, amount, category, description, timestamp FROM expenses ORDER BY id'
        )
      ).rows
    })
    // drawerFigures of 1.5.0 needs safe_ledger.method; before the migration, compare the stored rows.
    const before = await keep()
    await migrate(pool, { logger: quiet })
    assert.deepEqual(await keep(), before, 'existing rows unchanged')
    const [closed, open] = await fig()
    assert.equal(closed.expected, 200 + 150 - 20, 'closed shift: same drawer formula as before')
    assert.equal(open.expected, 100 + 60 - 5)
    assert.equal(
      (await pool.query("SELECT COUNT(*)::int AS n FROM safe_ledger WHERE method <> 'cash'"))
        .rows[0].n,
      0
    )
    const x = (
      await pool.query('SELECT id, created_by, category_id, destination FROM expenses ORDER BY id')
    ).rows
    assert.deepEqual(
      x.map((r) => [r.id, r.created_by, r.destination]),
      [
        [1, 1, 'shift'],
        [2, 2, 'shift']
      ]
    )
    const cats = (await pool.query('SELECT id, name FROM expense_categories')).rows
    const name = (id) => cats.find((k) => k.id === id)?.name
    assert.equal(name(x[0].category_id), 'كهرباء')
    assert.equal(name(x[1].category_id), 'نثريات خاصة', 'a name used before becomes a category')
    assert.equal(
      (await pool.query('SELECT COUNT(*)::int AS n FROM treasury_ledger')).rows[0].n,
      0,
      'the treasury starts empty'
    )
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM shift_closings')).rows[0].n, 0)
    // The closed shift stays closed for money (0011) after the backfill.
    await assert.rejects(
      pool.query(
        "INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (1, 'inflow', 1, 'x', LOCALTIMESTAMP)"
      ),
      /مغلقة/
    )
  } finally {
    await pool.end()
    await fresh.dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('0018 classifies existing shift movements from their texts and keeps every amount', async (t) => {
  if (!requireDb(t)) return
  const fresh = await freshDatabase()
  const pool = createPool(fresh.url, { max: 2 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig18-'))
  try {
    for (const m of listMigrations().filter((x) => Number(x.version) < 18))
      fs.copyFileSync(
        path.join(__dirname, '../../src/server/db/migrations', `${m.name}.sql`),
        path.join(tmp, `${m.name}.sql`)
      )
    await migrate(pool, { dir: tmp, logger: quiet })
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SELECT set_config('hm.bulk_load', 'on', true)")
      await c.query(`INSERT INTO users (id, username, role) VALUES (1, 'a', 'cashier')`)
      await c.query(`INSERT INTO shifts (id, user_id, start_time, end_time, initial_cash, status)
        VALUES (1, 1, '2026-10-01 08:00', '2026-10-01 20:00', 100, 'closed')`)
      await c.query(`INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES
        (1, 'outflow', 5, 'مرتجع صنف أ للفاتورة #3', '2026-10-01 09:00'),
        (1, 'outflow', 7, 'دفعة لمورد: س - فاتورة #1', '2026-10-01 09:00'),
        (1, 'outflow', 8, 'سداد دين مورد: س', '2026-10-01 09:00'),
        (1, 'inflow', 9, 'سداد دين العميل: ع', '2026-10-01 09:00'),
        (1, 'inflow', 10, 'مقدم نقدي بيع دفع جزئي فاتورة رقم #4', '2026-10-01 09:00'),
        (1, 'inflow', 2, 'باقي محفوظ كرصيد للعميل فاتورة رقم #5', '2026-10-01 09:00'),
        (1, 'outflow', 11, 'مصروفات - تصنيف: عام', '2026-10-01 09:00'),
        (1, 'outflow', 1, 'شيء آخر', '2026-10-01 09:00')`)
      await c.query(
        `INSERT INTO treasury_ledger (kind, amount, description, idem_key) VALUES ('deposit', 50, 'إيداع', 'd1')`
      )
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    const amounts = async () =>
      (await pool.query('SELECT id, amount::text, type FROM safe_ledger ORDER BY id')).rows
    const before = await amounts()
    await migrate(pool, { logger: quiet })
    assert.deepEqual(await amounts(), before, 'amounts unchanged')
    const kinds = (await pool.query('SELECT kind FROM safe_ledger ORDER BY id')).rows.map(
      (r) => r.kind
    )
    assert.deepEqual(kinds, [
      'refund',
      'supplier_payment',
      'supplier_settlement',
      'customer_payment',
      'sale_upfront',
      'kept_change',
      'expense',
      'other'
    ])
    assert.equal((await pool.query('SELECT method FROM treasury_ledger')).rows[0].method, 'cash')
    // The closed shift stays closed for money after the backfill.
    await assert.rejects(
      pool.query(
        "INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (1, 'inflow', 1, 'x', LOCALTIMESTAMP)"
      ),
      /مغلقة/
    )
  } finally {
    await pool.end()
    await fresh.dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
