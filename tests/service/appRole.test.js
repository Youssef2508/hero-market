'use strict'
// 1.4.0 security review, option C: the app runs as an ORDINARY database role that owns the shop's
// objects, never as a superuser. Proves the whole app works that way (migrations from scratch, a
// sale, backup and restore, the 1.3 import) and that the role cannot reach the operating system,
// server files or server settings. Also proves an existing database (created by a superuser, as
// before 1.4.0) can be handed over to such a role.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Client } = require('pg')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts
} = require('./helpers')
const { ensureAppRole, transferOwnership, foreignOwned } = require('../../src/server/db/appRole')
const { createPool } = require('../../src/server/db/pool')
const { migrate } = require('../../src/server/db/migrate')
const { importLegacy } = require('../../src/server/db/legacy-import')
const { buildLegacyFixture } = require('../../scripts/init-dev-db')

const BASE = process.env.HEROMARKET_TEST_DATABASE_URL
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const urlFor = (database, user, password) => {
  const u = new URL(BASE)
  u.pathname = `/${database}`
  u.username = user
  u.password = password
  return u.toString()
}
const dbName = (url) => new URL(url).pathname.slice(1)
const superuserName = () => decodeURIComponent(new URL(BASE).username || 'postgres')
const roles = []
const cleanups = []

async function asSuper(database, fn) {
  const u = new URL(BASE)
  u.pathname = `/${database}`
  const c = new Client({ connectionString: u.toString() })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

async function newRole() {
  const role = `hm_app_${crypto.randomBytes(4).toString('hex')}`
  const password = crypto.randomBytes(18).toString('base64url')
  await asSuper('postgres', (c) => ensureAppRole(c, { role, password }))
  roles.push(role)
  return { role, password }
}

/** What an ordinary role must not be able to do. */
async function assertNotPrivileged(url) {
  const c = new Client({ connectionString: url })
  await c.connect()
  try {
    const me = (
      await c.query(
        'SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user'
      )
    ).rows[0]
    assert.deepEqual(me, { rolsuper: false, rolcreaterole: false, rolcreatedb: false })
    const refused = async (sql, why) => {
      await assert.rejects(
        c.query(sql),
        (e) => /permission denied|must be superuser|privileges/i.test(e.message),
        why
      )
    }
    await refused("COPY (SELECT 1) TO PROGRAM 'whoami'", 'no Windows commands through the database')
    await refused("SELECT pg_read_file('postgresql.conf')", 'no reading server files')
    await refused("ALTER SYSTEM SET archive_command = 'whoami'", 'no changing server settings')
    await refused('CREATE ROLE intruder SUPERUSER', 'no creating roles')
    await refused("COPY (SELECT 1) TO 'C:/Users/Public/hm-test.txt'", 'no writing server files')
  } finally {
    await c.end()
  }
}

before(async () => {
  if (!BASE) return
})
after(async () => {
  for (const fn of cleanups.reverse()) await fn().catch(() => {})
  if (BASE)
    await asSuper('postgres', async (c) => {
      for (const r of roles) await c.query(`DROP ROLE IF EXISTS "${r}"`).catch(() => {})
    })
})

test('an existing store database is handed over to an ordinary role and keeps working', async (t) => {
  if (!requireDb(t)) return
  // As before 1.4.0: everything created and owned by a superuser.
  const db = await freshDatabase()
  cleanups.push(() => db.dispose())
  let svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('W', 'مياه', 4, 6, 50, 'زجاجة')"
  )
  let cashier = await login(svc, '5173')
  let shift = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier))
  const sell = (s, tok, shiftId) =>
    s.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId,
        paymentType: 'نقدي',
        items: [{ barcode: 'W', qty: 1 }]
      },
      tok
    )
  ok(await sell(svc, cashier, shift.id))
  await svc.close()

  const { role, password } = await newRole()
  const moved = await asSuper(dbName(db.url), (c) =>
    transferOwnership(c, { database: dbName(db.url), from: superuserName(), to: role })
  )
  assert.ok(moved > 50, `tables, sequences and functions moved (${moved})`)
  assert.deepEqual(await asSuper(dbName(db.url), (c) => foreignOwned(c, role)), [])

  const appUrl = urlFor(dbName(db.url), role, password)
  svc = await startService(appUrl)
  try {
    cashier = await login(svc, '5173')
    const owner = await login(svc, '8642')
    shift = (await svc.pool.query("SELECT id FROM shifts WHERE status = 'open' LIMIT 1")).rows[0]
    ok(await sell(svc, cashier, shift.id))
    const backup = ok(await svc.call('backup.export', {}, owner))
    ok(await sell(svc, cashier, shift.id))
    ok(await svc.call('backup.restore', { backup, confirm: 'RESTORE' }, owner))
    const sales = (await svc.pool.query('SELECT count(*)::int AS n FROM sales')).rows[0].n
    assert.equal(sales, 2, 'restore (ownership-level trigger switching) works as the app role')
  } finally {
    await svc.close()
  }
  await assertNotPrivileged(appUrl)
})

test('a new store database owned by the ordinary role: migrations from scratch and the 1.3 import', async (t) => {
  if (!requireDb(t)) return
  const { role, password } = await newRole()
  const name = `hm_t_${crypto.randomBytes(5).toString('hex')}`
  await asSuper('postgres', (c) =>
    c.query(
      `CREATE DATABASE ${name} OWNER "${role}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`
    )
  )
  cleanups.push(() =>
    asSuper('postgres', (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`))
  )
  await asSuper(name, (c) => c.query(`ALTER SCHEMA public OWNER TO "${role}"`))
  const appUrl = urlFor(name, role, password)

  // The 1.3 import runs as the app role (first start after upgrading from 1.3).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-approle-'))
  cleanups.push(async () => fs.rmSync(dir, { recursive: true, force: true }))
  const legacy = path.join(dir, 'market_unified.db')
  buildLegacyFixture(legacy, { reset: true })
  const pool = createPool(appUrl, { max: 2 })
  try {
    const quiet = { info() {}, warn() {}, error() {} }
    await migrate(pool, { logger: quiet })
    const report = await importLegacy(pool, legacy, {
      backupDir: path.join(dir, 'backup'),
      logger: quiet
    })
    assert.equal(report.parity.ok, true, 'imported with parity as the app role')
  } finally {
    await pool.end()
  }
  assert.deepEqual(
    await asSuper(name, (c) => foreignOwned(c, role)),
    [],
    'everything owned by the app role'
  )
  const svc = await startService(appUrl)
  try {
    const users = (await svc.pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n
    assert.ok(users > 0)
  } finally {
    await svc.close()
  }
  await assertNotPrivileged(appUrl)
})
