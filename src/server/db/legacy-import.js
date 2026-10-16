'use strict'
// One-off import of a legacy (pre-PostgreSQL) HeroMarket SQLite database into PostgreSQL, with parity verification.
// Guarantees (see .docs/DATABASE_MIGRATION.md):
//  - the SQLite file is opened read-only and copied to a backup first;
//  - every row and column is copied with its original id; nothing is dropped or regenerated;
//  - the whole import is one transaction (all or nothing);
//  - re-running with the same source verifies instead of importing twice;
//  - a non-empty target that was not filled from this source is never overwritten.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Import order respects foreign keys.
const LEGACY_TABLES = [
  'users',
  'products',
  'clients',
  'client_ledger',
  'shifts',
  'sales',
  'sale_items',
  'suppliers',
  'supplier_ledger',
  'supplier_purchases',
  'checks_register',
  'expenses',
  'damaged_goods',
  'settings',
  'shift_audits',
  'system_logs',
  'momkn_transactions',
  'mobile_money_transactions',
  'safe_ledger'
]
const PRIMARY_KEY = { products: 'barcode', settings: 'key' } // all others: id
const TRIGGER_TABLES = ['products', 'sales', 'shifts']
// Columns added by later migrations; not part of the legacy data set.
const NON_LEGACY_COLUMNS = {
  users: [
    'role_id',
    'pin_lookup',
    'pin_hash',
    'is_active',
    'created_at',
    'updated_at',
    'password_scrypt',
    'must_change_password',
    'password_changed_at',
    'recovery_hash',
    'recovery_created_at'
  ],
  sales: ['client_ref']
}

const TS_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?)?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function openSqlite(file) {
  // node:sqlite is built into Node ≥ 22.5; read-only so the source can never be modified.
  const { DatabaseSync } = require('node:sqlite')
  return new DatabaseSync(file, { readOnly: true })
}

/**
 * A private working copy of the SQLite file (+ -wal/-shm) in a temporary folder. The import reads
 * only this copy: even a read-only SQLite connection may update the -shm index of a WAL database,
 * and the original folder of the previous version must stay exactly as it was (1.4.0 checks).
 */
function workingCopy(file) {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hm-legacy-'))
  const copy = path.join(dir, path.basename(file))
  for (const suffix of ['', '-wal', '-shm'])
    if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, copy + suffix)
  return { file: copy, dispose: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

/** Copy the SQLite file (+ -wal/-shm) to backupDir and verify the copy byte for byte. */
function backupSource(file, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const base = path.basename(file, path.extname(file))
  const copies = []
  for (const suffix of ['', '-wal', '-shm']) {
    const src = file + suffix
    if (!fs.existsSync(src)) continue
    const dst = path.join(backupDir, `${base}-${stamp}${path.extname(file)}${suffix}`)
    fs.copyFileSync(src, dst)
    if (sha256File(src) !== sha256File(dst))
      throw new Error(`Backup verification failed for ${src}`)
    copies.push(dst)
  }
  return copies
}

/** Canonical text of a value as stored in SQLite, according to the target column type. */
function canonicalSource(value, type) {
  if (value === null || value === undefined) return null
  if (type === 'numeric' || type === 'integer' || type === 'bigint') {
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'number') return normaliseDecimal(String(value))
    if (typeof value === 'string' && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value.trim())) {
      return normaliseDecimal(String(Number(value.trim())))
    }
    throw new Error(`non-numeric value ${JSON.stringify(value)}`)
  }
  if (type === 'timestamp without time zone') {
    const s = String(value)
    if (!TS_RE.test(s)) throw new Error(`unrecognised date-time ${JSON.stringify(value)}`)
    return s.length === 10 ? `${s} 00:00:00` : s.length === 16 ? `${s}:00` : s
  }
  if (type === 'date') {
    const s = String(value)
    if (!DATE_RE.test(s)) throw new Error(`unrecognised date ${JSON.stringify(value)}`)
    return s
  }
  if (type === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

/** Remove insignificant zeros so 119 / 119.0 / 119.000 compare equal (value, not format). */
function normaliseDecimal(s) {
  if (/[eE]/.test(s)) s = Number(s).toFixed(20)
  let [int, frac = ''] = s.split('.')
  frac = frac.replace(/0+$/, '')
  if (int === '-0') int = '0'
  return frac ? `${int}.${frac}` : int
}

async function targetColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table]
  )
  return rows
}

function sourceColumns(db, table) {
  return db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((c) => c.name)
}

function sourceHasTable(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
}

async function ensureRunTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS legacy_import_runs (
    id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    source_path   text NOT NULL,
    source_sha256 text NOT NULL,
    started_at    timestamp NOT NULL DEFAULT LOCALTIMESTAMP(0),
    finished_at   timestamp,
    status        text NOT NULL,
    report        jsonb
  )`)
}

/** Build the column plan for one table; throws on anything that would lose data. */
async function planTable(client, db, table) {
  const tcols = await targetColumns(client, table)
  if (!tcols.length) throw new Error(`target table ${table} is missing (run migrations first)`)
  const types = Object.fromEntries(tcols.map((c) => [c.column_name, c.data_type]))
  if (!sourceHasTable(db, table))
    return { table, present: false, columns: [], types, missingInSource: [] }
  const scols = sourceColumns(db, table)
  const extra = scols.filter((c) => !(c in types))
  if (extra.length) throw new Error(`${table}: source columns not in target: ${extra.join(', ')}`)
  const legacyTarget = tcols
    .map((c) => c.column_name)
    .filter((c) => !(NON_LEGACY_COLUMNS[table] || []).includes(c))
  const missingInSource = legacyTarget.filter((c) => !scols.includes(c))
  return { table, present: true, columns: scols, types, missingInSource }
}

function pkOf(table) {
  return PRIMARY_KEY[table] || 'id'
}

function readSourceRows(db, plan) {
  if (!plan.present) return []
  const cols = plan.columns.map((c) => `"${c}"`).join(', ')
  return db.prepare(`SELECT ${cols} FROM "${plan.table}" ORDER BY "${pkOf(plan.table)}"`).all()
}

/** Validate and convert every source value; collects all problems instead of stopping at the first. */
function convertRows(plan, rows) {
  const problems = []
  const out = rows.map((row) =>
    plan.columns.map((col) => {
      try {
        return canonicalSource(row[col], plan.types[col])
      } catch (e) {
        problems.push(
          `${plan.table}.${col} (${pkOf(plan.table)}=${row[pkOf(plan.table)]}): ${e.message}`
        )
        return null
      }
    })
  )
  return { values: out, problems }
}

async function findOrphans(db) {
  // Foreign keys as declared in the legacy schema; SQLite did not always enforce them.
  const checks = [
    ['client_ledger', 'client_id', 'clients', 'id'],
    ['shifts', 'user_id', 'users', 'id'],
    ['sales', 'shift_id', 'shifts', 'id'],
    ['sales', 'client_id', 'clients', 'id'],
    ['sale_items', 'sale_id', 'sales', 'id'],
    ['sale_items', 'product_barcode', 'products', 'barcode'],
    ['supplier_ledger', 'supplier_id', 'suppliers', 'id'],
    ['supplier_purchases', 'supplier_id', 'suppliers', 'id'],
    ['damaged_goods', 'product_barcode', 'products', 'barcode'],
    ['shift_audits', 'shift_id', 'shifts', 'id'],
    ['momkn_transactions', 'shift_id', 'shifts', 'id'],
    ['mobile_money_transactions', 'shift_id', 'shifts', 'id'],
    ['safe_ledger', 'shift_id', 'shifts', 'id']
  ]
  const orphans = []
  for (const [t, c, rt, rc] of checks) {
    if (!sourceHasTable(db, t) || !sourceHasTable(db, rt)) continue
    if (!sourceColumns(db, t).includes(c)) continue
    const rows = db
      .prepare(
        `SELECT "${pkOf(t)}" AS pk, "${c}" AS ref FROM "${t}" WHERE "${c}" IS NOT NULL AND "${c}" NOT IN (SELECT "${rc}" FROM "${rt}")`
      )
      .all()
    for (const r of rows) orphans.push(`${t}.${c}=${r.ref} (row ${r.pk}) has no ${rt}.${rc}`)
  }
  return orphans
}

async function targetRowCounts(client) {
  const counts = {}
  for (const t of LEGACY_TABLES) {
    counts[t] = Number((await client.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n)
  }
  return counts
}

async function insertRows(client, plan, values) {
  if (!values.length) return
  const cols = plan.columns.map((c) => `"${c}"`).join(', ')
  // Identity columns accept explicit ids because they are GENERATED BY DEFAULT.
  const batch = 200
  for (let i = 0; i < values.length; i += batch) {
    const chunk = values.slice(i, i + batch)
    const params = []
    const tuples = chunk.map((row) => {
      const ph = row.map((v, j) => {
        params.push(v)
        const type = plan.types[plan.columns[j]]
        const cast =
          type === 'timestamp without time zone' ? 'timestamp' : type === 'jsonb' ? 'jsonb' : type
        return `$${params.length}::${cast}`
      })
      return `(${ph.join(', ')})`
    })
    await client.query(`INSERT INTO "${plan.table}" (${cols}) VALUES ${tuples.join(', ')}`, params)
  }
}

async function resetSequences(client, db) {
  const seq = sourceHasTable(db, 'sqlite_sequence')
    ? Object.fromEntries(
        db
          .prepare('SELECT name, seq FROM sqlite_sequence')
          .all()
          .map((r) => [r.name, Number(r.seq)])
      )
    : {}
  const result = {}
  for (const t of LEGACY_TABLES) {
    if (pkOf(t) !== 'id') continue
    const max = Number(
      (await client.query(`SELECT COALESCE(max(id), 0)::int AS m FROM "${t}"`)).rows[0].m
    )
    // AUTOINCREMENT never reuses ids, so continue after the highest id SQLite ever issued.
    const last = Math.max(max, seq[t] || 0)
    const seqName = (await client.query(`SELECT pg_get_serial_sequence($1, 'id') AS s`, [t]))
      .rows[0].s
    if (last > 0) await client.query('SELECT setval($1, $2, true)', [seqName, last])
    else await client.query('SELECT setval($1, 1, false)', [seqName])
    result[t] = { maxId: max, sqliteSequence: seq[t] ?? null, nextId: last + 1 }
  }
  return result
}

/** Row-level parity: canonical rows from both sides, compared per row and hashed per table. */
async function verifyParity(client, db) {
  const tables = {}
  let ok = true
  for (const table of LEGACY_TABLES) {
    const plan = await planTable(client, db, table)
    const srcRows = readSourceRows(db, plan)
    const { values: src, problems } = convertRows(plan, srcRows)
    const pk = pkOf(table)
    const cols = plan.columns
    const exprs = cols.map((c) => {
      const t = plan.types[c]
      if (t === 'numeric' || t === 'integer' || t === 'bigint') return `"${c}"::text AS "${c}"`
      if (t === 'timestamp without time zone')
        return `to_char("${c}", 'YYYY-MM-DD HH24:MI:SS') || CASE WHEN date_part('microseconds', "${c}")::int % 1000000 <> 0 THEN '.' || rtrim(lpad((date_part('microseconds', "${c}")::int % 1000000)::text, 6, '0'), '0') ELSE '' END AS "${c}"`
      if (t === 'date') return `to_char("${c}", 'YYYY-MM-DD') AS "${c}"`
      return `"${c}"::text AS "${c}"`
    })
    const tgtRows = cols.length
      ? (await client.query(`SELECT ${exprs.join(', ')} FROM "${table}" ORDER BY "${pk}"`)).rows
      : (await client.query(`SELECT 1 FROM "${table}"`)).rows
    const tgt = tgtRows.map((r) =>
      cols.map((c) => {
        const v = r[c]
        if (v === null || v === undefined) return null
        const t = plan.types[c]
        return t === 'numeric' || t === 'integer' || t === 'bigint' ? normaliseDecimal(v) : v
      })
    )
    const srcCanon = src.map((row) => JSON.stringify(row))
    const tgtCanon = tgt.map((row) => JSON.stringify(row))
    const mismatches = []
    const n = Math.max(srcCanon.length, tgtCanon.length)
    for (let i = 0; i < n && mismatches.length < 5; i++) {
      if (srcCanon[i] !== tgtCanon[i])
        mismatches.push({ index: i, source: srcCanon[i] ?? null, target: tgtCanon[i] ?? null })
    }
    const hash = (rows) => crypto.createHash('sha256').update(rows.join('\n')).digest('hex')
    const entry = {
      sourceRows: srcCanon.length,
      targetRows: tgtCanon.length,
      sourceHash: hash(srcCanon),
      targetHash: hash(tgtCanon),
      columns: cols.length,
      missingInSource: plan.missingInSource,
      problems,
      mismatches
    }
    entry.match =
      entry.sourceRows === entry.targetRows &&
      entry.sourceHash === entry.targetHash &&
      !problems.length
    if (!entry.match) ok = false
    tables[table] = entry
  }
  return { ok, tables }
}

/**
 * Import `sqlitePath` into the PostgreSQL database behind `pool` (already migrated).
 * Returns a report object; throws (after rollback) on any data problem.
 */
async function importLegacy(
  pool,
  sqlitePath,
  { backupDir, dryRun = false, logger = console } = {}
) {
  const sourcePath = path.resolve(sqlitePath)
  if (!fs.existsSync(sourcePath)) throw new Error(`SQLite file not found: ${sourcePath}`)
  const sourceSha256 = sha256File(sourcePath)
  const report = { sourcePath, sourceSha256, startedAt: new Date().toISOString(), dryRun }
  report.backups = backupDir ? backupSource(sourcePath, backupDir) : []
  const work = workingCopy(sourcePath)
  let db
  try {
    db = openSqlite(work.file)
  } catch (e) {
    work.dispose()
    throw e
  }
  const integrity = db.prepare('PRAGMA integrity_check').all()
  report.sourceIntegrity = integrity.map((r) => Object.values(r)[0])
  if (report.sourceIntegrity.join() !== 'ok') {
    db.close()
    work.dispose()
    throw new Error(`Source integrity_check failed: ${report.sourceIntegrity.join('; ')}`)
  }

  const client = await pool.connect()
  try {
    await ensureRunTable(client)
    const previous = (
      await client.query(
        "SELECT id, finished_at FROM legacy_import_runs WHERE source_sha256 = $1 AND status = 'completed' ORDER BY id DESC LIMIT 1",
        [sourceSha256]
      )
    ).rows[0]
    const counts = await targetRowCounts(client)
    const targetHasData = Object.values(counts).some((n) => n > 0)
    if (previous) {
      logger.info(
        `[import] this source was already imported (run ${previous.id}); verifying parity only`
      )
      report.mode = 'verify-existing'
    } else if (targetHasData) {
      throw new Error(
        'Target database already contains data that was not imported from this source. Refusing to overwrite. ' +
          `Row counts: ${JSON.stringify(counts)}`
      )
    } else {
      report.mode = dryRun ? 'dry-run' : 'import'
      const plans = []
      const problems = []
      for (const t of LEGACY_TABLES) {
        const plan = await planTable(client, db, t)
        const rows = readSourceRows(db, plan)
        const conv = convertRows(plan, rows)
        problems.push(...conv.problems)
        plans.push({ plan, values: conv.values })
      }
      const orphans = await findOrphans(db)
      report.orphans = orphans
      if (problems.length || orphans.length) {
        report.problems = problems
        throw new Error(
          `Source data needs attention before import (${problems.length} value problems, ${orphans.length} orphans): ${[...problems, ...orphans].slice(0, 10).join(' | ')}`
        )
      }
      await client.query('BEGIN')
      try {
        const run = await client.query(
          "INSERT INTO legacy_import_runs (source_path, source_sha256, status) VALUES ($1, $2, 'running') RETURNING id",
          [sourcePath, sourceSha256]
        )
        // Historical rows (e.g. sales on shifts that are closed today) must not be re-validated by triggers.
        await client.query("SELECT set_config('hm.bulk_load', 'on', true)")
        for (const t of TRIGGER_TABLES)
          await client.query(`ALTER TABLE "${t}" DISABLE TRIGGER USER`)
        for (const { plan, values } of plans) await insertRows(client, plan, values)
        for (const t of TRIGGER_TABLES) await client.query(`ALTER TABLE "${t}" ENABLE TRIGGER USER`)
        report.sequences = await resetSequences(client, db)
        // Stock ledger: the imported stock becomes one opening movement per product (migration 0004).
        report.openingStockMovements = (
          await client.query('SELECT hm_post_opening_balances($1) AS n', [
            'رصيد افتتاحي من النسخة السابقة (استيراد)'
          ])
        ).rows[0].n
        report.parity = await verifyParity(client, db)
        if (!report.parity.ok)
          throw new Error('Parity verification failed inside the import transaction')
        report.finishedAt = new Date().toISOString()
        if (dryRun) {
          await client.query('ROLLBACK')
          return report
        }
        await client.query(
          "UPDATE legacy_import_runs SET status = 'completed', finished_at = LOCALTIMESTAMP(0), report = $2 WHERE id = $1",
          [run.rows[0].id, JSON.stringify(report)]
        )
        await client.query('COMMIT')
        report.runId = run.rows[0].id
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
    report.parity = await verifyParity(client, db)
    report.targetCounts = await targetRowCounts(client)
    report.foreignKeyViolations = await countFkViolations(client)
    report.finishedAt = new Date().toISOString()
    return report
  } finally {
    client.release()
    db.close()
    work.dispose()
  }
}

/** Every declared foreign key re-checked in the target (should always be 0). */
async function countFkViolations(client) {
  const { rows } = await client.query(`
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`)
  const out = {}
  for (const r of rows) {
    const n = (
      await client.query(
        `SELECT count(*)::int AS n FROM "${r.table_name}" t WHERE t."${r.column_name}" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "${r.ref_table}" x WHERE x."${r.ref_column}" = t."${r.column_name}")`
      )
    ).rows[0].n
    out[`${r.table_name}.${r.column_name}->${r.ref_table}.${r.ref_column}`] = n
  }
  return out
}

// Owner decision (2026-10-14): the store is "هيرو ماركت" (HeroMarket). Installations of the earlier
// versions carry the original project's default store name in their settings; after a verified import
// it is replaced once and the change is logged. Only that exact shipped default is replaced – a name
// the store chose itself is never changed. The previous value stays in the log details, the import
// report and the untouched SQLite file; the visible log text does not repeat it.
const HEROMARKET_STORE_NAME = 'هيرو ماركت'
const PRE_REBRAND_DEFAULT_NAMES = new Set(['سوبر ماركت النجدي'])

async function rebrandStoreName(pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      "SELECT value FROM settings WHERE key = 'store_name' FOR UPDATE"
    )
    const current = rows[0]?.value
    if (!current || !PRE_REBRAND_DEFAULT_NAMES.has(current.trim())) {
      await client.query('ROLLBACK')
      return null
    }
    await client.query("UPDATE settings SET value = $1 WHERE key = 'store_name'", [
      HEROMARKET_STORE_NAME
    ])
    await client.query(
      `INSERT INTO system_logs (timestamp, user_id, username, action_type, description, details)
       VALUES (LOCALTIMESTAMP(0), NULL, 'system', 'settings_update', $1, $2)`,
      [
        `تعيين اسم المتجر "${HEROMARKET_STORE_NAME}" بدلاً من الاسم الافتراضي للنسخة السابقة`,
        JSON.stringify({ key: 'store_name', from: current, to: HEROMARKET_STORE_NAME })
      ]
    )
    await client.query('COMMIT')
    return { from: current, to: HEROMARKET_STORE_NAME }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  importLegacy,
  rebrandStoreName,
  verifyParity,
  LEGACY_TABLES,
  canonicalSource,
  normaliseDecimal,
  openSqlite
}
