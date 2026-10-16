'use strict'
// Safe updates of an installed store (1.4.0, .docs/UPDATE_GUIDE.md): Case A / Case B detection, the
// program never migrating by itself on an installed store, refusal of a database from a newer
// version, and the before/after checks the installer uses to decide whether to put its verified copy
// back. (The physical copy and restore are proven in Windows Sandbox and upgradeSnapshot.test.mjs.)
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts
} = require('./helpers')
const { createService } = require('../../src/server/app')
const { DEFAULT_DIR, migrate } = require('../../src/server/db/migrate')
const {
  schemaState,
  dataFingerprint,
  compareFingerprints,
  integrityProblems
} = require('../../src/server/db/upgrade')

const cleanups = []
after(async () => {
  for (const fn of cleanups.reverse()) await fn().catch(() => {})
})
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const quiet = { info() {}, warn() {}, error() {} }

/** A migrations folder = the shipped ones + extra files (a future version's migration). */
function migrationsWith(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig-'))
  for (const f of fs.readdirSync(DEFAULT_DIR))
    fs.copyFileSync(path.join(DEFAULT_DIR, f), path.join(dir, f))
  for (const [name, sql] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), sql)
  cleanups.push(async () => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A store with records: users, products with stock, a sale. */
async function storeWithData() {
  const db = await freshDatabase()
  cleanups.push(() => db.dispose())
  const svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('W', 'مياه', 4, 6, 50, 'زجاجة'), ('B', 'خبز', 1, 2, 80, 'رغيف')"
  )
  const cashier = await login(svc, '5173')
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier))
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'W', qty: 2 }]
      },
      cashier
    )
  )
  return { db, svc }
}

test('Case A when nothing is pending; Case B names exactly the new migrations', async (t) => {
  if (!requireDb(t)) return
  const { svc } = await storeWithData()
  try {
    const c = await svc.pool.connect()
    try {
      const a = await schemaState(c)
      assert.equal(a.case, 'A')
      assert.deepEqual([a.pending, a.unknown], [[], []])
      const dir = migrationsWith({
        '0099_future_report.sql': 'ALTER TABLE products ADD COLUMN shelf text;'
      })
      const shipped = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => f.slice(0, 4))
      const b = await schemaState(c, shipped)
      assert.equal(b.case, 'B')
      assert.deepEqual(b.pending, ['0099'])
    } finally {
      c.release()
    }
  } finally {
    await svc.close()
  }
})

test('an installed store never migrates by itself: the program refuses (setup_incomplete)', async (t) => {
  if (!requireDb(t)) return
  const { db, svc } = await storeWithData()
  await svc.close()
  const dir = migrationsWith({
    '0099_future_report.sql': 'ALTER TABLE products ADD COLUMN shelf text;'
  })
  const installed = await createService({
    databaseUrl: db.url,
    secret: 'x'.repeat(40),
    logger: false,
    migrationsDir: dir,
    migrationPolicy: 'refuse'
  })
  try {
    await assert.rejects(installed.prepare(), (e) => e.code === 'setup_incomplete')
    const col = await installed.pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'shelf'"
    )
    assert.equal(col.rowCount, 0, 'nothing was migrated')
  } finally {
    await installed.app.close()
  }
  // Development and the installer (policy auto) apply it.
  const dev = await createService({
    databaseUrl: db.url,
    secret: 'x'.repeat(40),
    logger: false,
    migrationsDir: dir
  })
  try {
    await dev.prepare()
    const col = await dev.pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'shelf'"
    )
    assert.equal(col.rowCount, 1)
  } finally {
    await dev.app.close()
  }
})

test('a database from a newer version is never opened by an older program (database_newer)', async (t) => {
  if (!requireDb(t)) return
  const { db, svc } = await storeWithData()
  await svc.pool.query(
    "INSERT INTO schema_migrations (version, name, checksum) VALUES ('0999', '0999_from_a_newer_version.sql', 'x')"
  )
  await svc.close()
  for (const migrationPolicy of ['auto', 'refuse']) {
    const older = await createService({
      databaseUrl: db.url,
      secret: 'x'.repeat(40),
      logger: false,
      migrationPolicy
    })
    try {
      await assert.rejects(older.prepare(), (e) => e.code === 'database_newer', migrationPolicy)
    } finally {
      await older.app.close()
    }
  }
})

test('the before/after check catches lost rows and changed totals; a clean migration passes', async (t) => {
  if (!requireDb(t)) return
  const { svc } = await storeWithData()
  try {
    const c = await svc.pool.connect()
    try {
      const before = await dataFingerprint(c)
      assert.ok(before.counts.sales >= 1 && before.counts.products === 2)
      // A harmless migration (new column): everything kept.
      await c.query('ALTER TABLE products ADD COLUMN shelf text')
      assert.deepEqual(compareFingerprints(before, await dataFingerprint(c)), [])
      assert.deepEqual(await integrityProblems(c), [])
      // A harmful one: a sale line lost, a product price changed through stock.
      await c.query("SET hm.bulk_load = 'on'")
      await c.query("SET hm.ledger_rebuild = 'on'") // simulate damage the guards would refuse
      await c.query('DELETE FROM sale_items')
      await c.query("UPDATE products SET stock_qty = stock_qty + 5 WHERE barcode = 'B'")
      const problems = compareFingerprints(before, await dataFingerprint(c))
      assert.ok(
        problems.some((p) => p.startsWith('sale_items:')),
        problems.join('; ')
      )
      assert.ok(
        problems.some((p) => p.startsWith('total stock:')),
        problems.join('; ')
      )
      assert.ok(
        (await integrityProblems(c)).some((p) => /stock differs from its movements/.test(p)),
        'stock no longer equal to its movements'
      )
    } finally {
      c.release()
    }
  } finally {
    await svc.close()
  }
})

test('a failing migration changes nothing: the records and the schema stay as they were', async (t) => {
  if (!requireDb(t)) return
  const { svc } = await storeWithData()
  try {
    const dir = migrationsWith({
      '0099_broken.sql':
        "ALTER TABLE products ADD COLUMN shelf text; UPDATE products SET shelf = 'A'; SELECT 1/0;"
    })
    const c = await svc.pool.connect()
    let before
    try {
      before = await dataFingerprint(c)
    } finally {
      c.release()
    }
    await assert.rejects(migrate(svc.pool, { dir, logger: quiet }), /division by zero/)
    const c2 = await svc.pool.connect()
    try {
      assert.deepEqual(compareFingerprints(before, await dataFingerprint(c2)), [])
      const col = await c2.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'shelf'"
      )
      assert.equal(col.rowCount, 0, 'the half-done migration was rolled back')
      assert.equal((await schemaState(c2)).case, 'A', 'not recorded as applied')
    } finally {
      c2.release()
    }
  } finally {
    await svc.close()
  }
})
