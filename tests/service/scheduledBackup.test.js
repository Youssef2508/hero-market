'use strict'
// Nightly backup against a real database (BACKUP-01, D-060): the copy is one consistent snapshot,
// restores row for row into a separate, disposable database, never blocks a sale while it runs,
// and its duration is measured on a larger store.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts
} = require('./helpers')
const { exportSnapshot, TABLES } = require('../../src/server/modules/backup')
const { listMigrations } = require('../../src/server/db/migrate')

let db, svc, owner, shift, job
const q = async (pool, sql, p) => (await pool.query(sql, p)).rows
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const sell = (qty = 1) =>
  svc.call(
    'pos.checkout',
    {
      clientRef: crypto.randomUUID(),
      shiftId: shift.id,
      paymentType: 'نقدي',
      items: [{ barcode: 'B1', qty }]
    },
    owner
  )
const schema = () => listMigrations().map((m) => m.version)

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  job = await import('../../src/main/backupJob.js')
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  owner = await login(svc, '8642')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES
     ('B1', 'صنف', 5, 10, 9, 100000, 'قطعة')`
  )
  shift = ok(await svc.call('shifts.open', { startingCash: 100 }, owner))
  for (let i = 0; i < 20; i++) ok(await sell())
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a nightly copy restores row for row into a separate database', async (t) => {
  if (!requireDb(t)) return
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-nightly-'))
  const r = await job.runBackup({
    dir,
    exportData: () => exportSnapshot(svc.pool),
    schema: schema(),
    now: new Date(2026, 9, 22, 0, 0)
  })
  assert.equal(r.result, 'done', r.reason)
  const copy = job.readCopy(path.join(dir, r.files[0].file))
  // Restore into a disposable database (never the one it came from).
  const target = await freshDatabase()
  const other = await startService(target.url)
  try {
    await createUser(other, { username: 'restorer', pin: '1357', roleKey: 'super_admin' })
    const token = await login(other, '1357')
    ok(await other.call('backup.restore', { backup: copy, confirm: 'RESTORE' }, token))
    for (const t of TABLES.filter((x) => !['sessions'].includes(x))) {
      const a = await q(svc.pool, `SELECT COUNT(*)::int AS n FROM "${t}"`)
      const b = await q(other.pool, `SELECT COUNT(*)::int AS n FROM "${t}"`)
      if (t === 'system_logs') continue // the restore itself adds its log entry
      assert.equal(b[0].n, a[0].n, `${t} row count`)
    }
    const sum = async (pool) =>
      (await q(pool, 'SELECT SUM(total_amount)::text s, MAX(id) m FROM sales'))[0]
    assert.deepEqual(await sum(other.pool), await sum(svc.pool))
    const stock = async (pool) =>
      (await q(pool, "SELECT stock_qty::text s FROM products WHERE barcode = 'B1'"))[0].s
    assert.equal(await stock(other.pool), await stock(svc.pool))
  } finally {
    await other.close()
    await target.dispose()
  }
})

test('sales go on while a backup runs, and the copy is one consistent moment', async (t) => {
  if (!requireDb(t)) return
  // Hold a snapshot open (as the backup does) and sell meanwhile: nothing waits for it.
  const client = await svc.pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const before = (await client.query('SELECT COUNT(*)::int n FROM sales')).rows[0].n
    const t0 = Date.now()
    ok(await sell())
    const ms = Date.now() - t0
    t.diagnostic(`a sale during an open backup snapshot took ${ms} ms`)
    assert.ok(ms < 2000, `${ms} ms`)
    // The snapshot still sees the moment it started: no half-written sale.
    const inside = (await client.query('SELECT COUNT(*)::int n FROM sales')).rows[0].n
    const items = (
      await client.query(
        'SELECT COUNT(*)::int n FROM sale_items i LEFT JOIN sales s ON s.id = i.sale_id WHERE s.id IS NULL'
      )
    ).rows[0].n
    assert.equal(inside, before)
    assert.equal(items, 0)
    await client.query('COMMIT')
  } finally {
    client.release()
  }
  // A whole backup with sales racing it: the copy restores without a broken reference.
  const racing = Promise.all(Array.from({ length: 10 }, () => sell()))
  const copy = await exportSnapshot(svc.pool)
  await racing
  const saleIds = new Set(copy.tables.sales.rows.map((r) => r[0]))
  const col = copy.tables.sale_items.columns.indexOf('sale_id')
  assert.ok(
    copy.tables.sale_items.rows.every((r) => saleIds.has(r[col])),
    'every line has its sale'
  )
})

test('duration on a larger store is measured (performance)', async (t) => {
  if (!requireDb(t)) return
  // About 20,000 invoices with 60,000 lines, written directly (bulk load).
  const c = await svc.pool.connect()
  try {
    await c.query('BEGIN')
    await c.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
    await c.query(
      `INSERT INTO sales (shift_id, user_id, timestamp, total_amount, original_amount, discount, payment_type)
       SELECT $1, (SELECT id FROM users LIMIT 1), LOCALTIMESTAMP(0), 30, 30, 0, 'نقدي' FROM generate_series(1, 20000)`,
      [shift.id]
    )
    await c.query(
      `INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, cost_price)
       SELECT s.id, 'B1', 1, 10, 10, 5 FROM sales s CROSS JOIN generate_series(1, 3)`
    )
    await c.query('COMMIT')
  } finally {
    c.release()
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-nightly-big-'))
  const t0 = Date.now()
  const r = await job.runBackup({
    dir,
    exportData: () => exportSnapshot(svc.pool),
    schema: schema(),
    now: new Date(2026, 9, 23, 0, 0)
  })
  const seconds = (Date.now() - t0) / 1000
  assert.equal(r.result, 'done', r.reason)
  t.diagnostic(
    `${r.rows} rows in ${seconds.toFixed(1)} s (export ${r.exportSeconds} s), file ${(r.files[0].bytes / 1048576).toFixed(1)} MB`
  )
  // While it ran, a sale still went through at normal speed.
  const s0 = Date.now()
  const during = job.runBackup({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'hm-nightly-big2-')),
    exportData: () => exportSnapshot(svc.pool),
    schema: schema(),
    now: new Date(2026, 9, 24, 0, 0)
  })
  ok(await sell())
  const saleMs = Date.now() - s0
  await during
  t.diagnostic(`a sale while the big backup ran: ${saleMs} ms`)
  assert.ok(saleMs < 5000, `${saleMs} ms`)
})
