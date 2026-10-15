/* eslint-disable no-console */
// Go-live rehearsal on a COPY of a legacy store (.docs/GO_LIVE_TEST_PLAN.md, checks A1–A5).
//
//   node scripts/golive-check.js --sqlite <copy of market_unified.db> --admin-url <postgres://…/postgres>
//        [--report <file.json>] [--keep]
//
// What it does, all on disposable copies:
//   A1 copies the SQLite file (and any -wal/-shm) into a temporary folder and records the SHA-256 of
//      the given file before and after: the given file must be unchanged.
//   A2 imports the copy into a new, empty PostgreSQL database and checks row-level parity.
//   A3 compares what the store sees: stock and prices per product, customer and supplier balances,
//      sales count and total per day and payment type.
//   A4 if HEROMARKET_GOLIVE_PIN is set: logs in with that existing PIN (legacy hash upgrade path).
//   A5 exports a backup through the service, restores it into a second new database through the
//      service, and repeats A3 between the two databases.
//   A6 checks that every product's stock equals the sum of its stock movements after the import.
// The admin URL needs CREATEDB; both databases are dropped at the end unless --keep is given.
// Exit code 0 only when every check that ran passed.
'use strict'
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Client } = require('pg')
const { createService } = require('../src/server/app')
const { importLegacy } = require('../src/server/db/legacy-import')
const { verifyLedger } = require('../src/server/inventory/stock')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v))
const day = (t) => (String(t || '').match(/\d{4}-\d{2}-\d{2}/) || ['(no date)'])[0]
const round = (n) => Math.round(n * 100) / 100

/** Business view of a store: what the owner compares before and after the move. */
function businessView({ products, clients, suppliers, sales }) {
  const byDay = {}
  for (const s of sales) {
    const k = `${day(s.timestamp)} ${s.payment_type || '-'}`
    const e = (byDay[k] ||= { count: 0, total: 0 })
    e.count++
    e.total = round(e.total + num(s.total_amount))
  }
  return {
    products: Object.fromEntries(
      products.map((p) => [p.barcode, [num(p.stock_qty), num(p.retail_price), num(p.cost_price)]])
    ),
    clients: Object.fromEntries(clients.map((c) => [c.id, num(c.debt_balance)])),
    suppliers: Object.fromEntries(suppliers.map((c) => [c.id, num(c.debt_balance)])),
    salesByDay: byDay,
    totals: {
      products: products.length,
      stockUnits: round(products.reduce((a, p) => a + num(p.stock_qty), 0)),
      stockValueAtCost: round(
        products.reduce((a, p) => a + num(p.stock_qty) * num(p.cost_price), 0)
      ),
      customerDebt: round(clients.reduce((a, c) => a + num(c.debt_balance), 0)),
      supplierDebt: round(suppliers.reduce((a, c) => a + num(c.debt_balance), 0)),
      sales: sales.length,
      salesTotal: round(sales.reduce((a, s) => a + num(s.total_amount), 0))
    }
  }
}

const QUERIES = {
  products: 'SELECT barcode, stock_qty, retail_price, cost_price FROM products',
  clients: 'SELECT id, debt_balance FROM clients',
  suppliers: 'SELECT id, debt_balance FROM suppliers',
  sales: 'SELECT id, timestamp, total_amount, payment_type FROM sales'
}

function sqliteView(file) {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const has = (t) =>
      !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)
    const rows = (t) => (has(t) ? db.prepare(QUERIES[t]).all() : [])
    return businessView(Object.fromEntries(Object.keys(QUERIES).map((t) => [t, rows(t)])))
  } finally {
    db.close()
  }
}

async function pgView(pool) {
  const out = {}
  for (const [t, q] of Object.entries(QUERIES)) {
    // Text casts keep the values exactly as stored (no float conversion in the driver).
    const sql = q.replace(/timestamp,/, 'timestamp::text AS timestamp,')
    out[t] = (await pool.query(sql)).rows
  }
  return businessView(out)
}

/** Lists every difference between two business views (empty = identical). */
function compareViews(a, b) {
  const diffs = []
  for (const part of ['products', 'clients', 'suppliers', 'salesByDay']) {
    const keys = new Set([...Object.keys(a[part]), ...Object.keys(b[part])])
    for (const k of keys) {
      const x = JSON.stringify(a[part][k])
      const y = JSON.stringify(b[part][k])
      if (x !== y) diffs.push(`${part} ${k}: ${x} → ${y}`)
    }
  }
  for (const k of Object.keys(a.totals))
    if (a.totals[k] !== b.totals[k]) diffs.push(`total ${k}: ${a.totals[k]} → ${b.totals[k]}`)
  return diffs
}

async function newDatabase(adminUrl, label) {
  const name = `hm_golive_${label}_${crypto.randomBytes(4).toString('hex')}`
  const c = new Client({ connectionString: adminUrl })
  await c.connect()
  await c.query(
    `CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`
  )
  await c.end()
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  return { name, url: url.toString() }
}

async function dropDatabase(adminUrl, name) {
  const c = new Client({ connectionString: adminUrl })
  await c.connect()
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  await c.end()
}

async function service(url, secret) {
  const svc = await createService({ databaseUrl: url, secret, logger: false })
  await svc.prepare()
  await svc.app.ready()
  svc.call = async (op, body = {}, token = null) => {
    const res = await svc.app.inject({
      method: 'POST',
      url: `/api/${op}`,
      payload: body,
      headers: {
        'x-heromarket-terminal': 'golive-check',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    })
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }
  }
  return svc
}

/** Session for the backup check: a temporary administrator that exists only in the disposable copy. */
async function temporaryAdmin(svc, secret) {
  const { pinLookup, hashPin } = require('../src/server/auth/pin')
  const pin = String(crypto.randomInt(10_000_000, 99_999_999))
  await svc.pool.query(
    `INSERT INTO users (username, role, role_id, pin_lookup, pin_hash, is_active, created_at)
     VALUES ('golive-check', 'admin', (SELECT id FROM roles WHERE key = 'super_admin'), $1, $2, true, LOCALTIMESTAMP(0))`,
    [pinLookup(secret, pin), hashPin(pin)]
  )
  const r = await svc.call('auth.login', { pin })
  if (r.status !== 200) throw new Error(`temporary admin login failed: ${JSON.stringify(r.body)}`)
  return r.body.token
}

async function main() {
  const source = arg('sqlite')
  const adminUrl = arg('admin-url', process.env.HEROMARKET_TEST_DATABASE_URL)
  if (!source || !adminUrl || !fs.existsSync(source)) {
    console.error(
      'usage: node scripts/golive-check.js --sqlite <copy of the store .db> --admin-url <postgres://…/postgres> [--report file] [--keep]'
    )
    process.exit(2)
  }
  const keep = process.argv.includes('--keep')
  const secret = crypto.randomBytes(32).toString('hex')
  const report = { startedAt: new Date().toISOString(), source: path.resolve(source), checks: {} }
  const record = (id, ok, detail) => {
    report.checks[id] = { ok, ...detail }
    console.log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${id}  ${detail.summary}`)
  }

  // A1 – work on a copy; the given file must not change
  const before = sha256File(source)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-golive-'))
  const copy = path.join(work, path.basename(source))
  for (const suffix of ['', '-wal', '-shm'])
    if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, copy + suffix)

  const dbs = []
  const services = []
  try {
    // A2 – import into an empty database, row-level parity
    const a = await newDatabase(adminUrl, 'import')
    dbs.push(a)
    const svcA = await service(a.url, secret)
    services.push(svcA)
    const imp = await importLegacy(svcA.pool, copy, {
      backupDir: path.join(work, 'backups'),
      logger: { info: () => {}, warn: console.warn, error: console.error }
    })
    const tables = Object.entries(imp.parity.tables)
    const fkBad = Object.entries(imp.foreignKeyViolations || {}).filter(([, n]) => n > 0)
    record('A2-import-parity', imp.parity.ok && !fkBad.length, {
      summary: `${tables.length} tables, ${tables.reduce((s, [, e]) => s + e.targetRows, 0)} rows, parity ${imp.parity.ok ? 'passed' : 'FAILED'}, FK violations ${fkBad.length}`,
      tables: Object.fromEntries(
        tables.map(([t, e]) => [t, [e.sourceRows, e.targetRows, e.match]])
      ),
      foreignKeyViolations: fkBad
    })

    // A6 – stock ledger: imported stock is exactly explained by the opening movements
    const ledger = await verifyLedger(svcA.pool)
    record('A6-stock-ledger', ledger.length === 0, {
      summary: ledger.length
        ? `${ledger.length} products whose stock differs from their movements, first: ${JSON.stringify(ledger[0])}`
        : `stock of every product = sum of its movements (${imp.openingStockMovements} opening movements)`,
      mismatches: ledger.slice(0, 50)
    })

    // A3 – business comparison legacy → PostgreSQL
    const legacy = sqliteView(copy)
    const imported = await pgView(svcA.pool)
    const d3 = compareViews(legacy, imported)
    record('A3-business-view', d3.length === 0, {
      summary: d3.length
        ? `${d3.length} differences, first: ${d3[0]}`
        : `identical: ${legacy.totals.products} products (${legacy.totals.stockUnits} units), customer debt ${legacy.totals.customerDebt}, supplier debt ${legacy.totals.supplierDebt}, ${legacy.totals.sales} sales totalling ${legacy.totals.salesTotal} over ${Object.keys(legacy.salesByDay).length} day/payment groups`,
      totals: legacy.totals,
      differences: d3.slice(0, 50)
    })

    // A4 – an existing PIN still logs in (optional, PIN from the environment, never printed)
    const pin = process.env.HEROMARKET_GOLIVE_PIN
    if (pin) {
      const r = await svcA.call('auth.login', { pin })
      const u = r.body?.user
      record('A4-existing-pin', r.status === 200, {
        summary:
          r.status === 200
            ? `logged in as ${u?.username} (${u?.roleName || u?.role})`
            : `refused: ${r.body?.error?.message}`
      })
    } else {
      record('A4-existing-pin', null, {
        summary: 'not run: set HEROMARKET_GOLIVE_PIN to an existing administrator PIN'
      })
    }

    // A5 – backup through the service, restore into a second empty database, compare
    const token = await temporaryAdmin(svcA, secret)
    const exp = await svcA.call('backup.export', {}, token)
    if (exp.status !== 200) throw new Error(`backup.export: ${JSON.stringify(exp.body)}`)
    const backupFile = path.join(work, 'heromarket-backup.json')
    fs.writeFileSync(backupFile, JSON.stringify(exp.body))
    const b = await newDatabase(adminUrl, 'restore')
    dbs.push(b)
    const svcB = await service(b.url, secret)
    services.push(svcB)
    const tokenB = await temporaryAdmin(svcB, secret)
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'))
    const res = await svcB.call('backup.restore', { backup, confirm: 'RESTORE' }, tokenB)
    const d5 =
      res.status === 200 ? compareViews(await pgView(svcA.pool), await pgView(svcB.pool)) : []
    record('A5-backup-restore', res.status === 200 && d5.length === 0, {
      summary:
        res.status !== 200
          ? `restore refused: ${res.body?.error?.message}`
          : d5.length
            ? `${d5.length} differences after restore, first: ${d5[0]}`
            : `backup of ${(fs.statSync(backupFile).size / 1024).toFixed(0)} KB restored into a new database; business view identical`,
      restored: res.body?.restored
    })
  } finally {
    for (const s of services) await s.app.close().catch(() => {})
    if (!keep) for (const d of dbs) await dropDatabase(adminUrl, d.name).catch(() => {})
    fs.rmSync(work, { recursive: true, force: true })
    // A1 last: also proves that nothing above wrote to the given file
    const after = sha256File(source)
    record('A1-source-untouched', before === after, {
      summary: `SHA-256 ${before.slice(0, 16)}… before and ${after === before ? 'unchanged' : 'CHANGED'} after`,
      sha256: before
    })
    if (keep) console.log(`kept databases: ${dbs.map((d) => d.name).join(', ')}`)
  }

  const ran = Object.values(report.checks).filter((c) => c.ok !== null)
  report.ok = ran.length > 0 && ran.every((c) => c.ok)
  const out = arg('report')
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(report.ok ? '\nAll automated go-live checks passed.' : '\nSome checks FAILED.')
  process.exit(report.ok ? 0 : 1)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = { businessView, compareViews }
