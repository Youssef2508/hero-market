'use strict'
// Checks for a safe update of an installed store (1.4.0; .docs/UPDATE_GUIDE.md).
//
// Case A: the new version ships no migration the database lacks: only the program changes.
// Case B: migrations are pending: the installer applies them right after its verified copy of the
//         database, and compares the shop's records before and after. Any loss, any stock that no
//         longer matches its movements, or any broken reference makes the installer put the copy
//         back (src/main/serviceSetup.js).
// A database migrated by a NEWER version than the program is never opened (the older program could
// misread or damage it): restore that version's copy instead, or install the newer version.
const { listMigrations } = require('./migrate')

/** Versions applied in the database compared with the versions this program ships. */
async function schemaState(client, shipped = listMigrations().map((m) => m.version)) {
  const has = (await client.query("SELECT to_regclass('schema_migrations') IS NOT NULL AS ok"))
    .rows[0].ok
  const applied = has
    ? (await client.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(
        (r) => r.version
      )
    : []
  const known = new Set(shipped)
  const done = new Set(applied)
  return {
    applied,
    pending: shipped.filter((v) => !done.has(v)),
    unknown: applied.filter((v) => !known.has(v)), // from a newer version
    case: shipped.some((v) => !done.has(v)) ? 'B' : 'A'
  }
}

// The shop's records an update must keep: row counts that may never go down, and totals that a
// migration must not change.
const COUNTED = [
  'products',
  'product_units',
  'categories',
  'clients',
  'client_addresses',
  'suppliers',
  'supplier_purchases',
  'supplier_purchase_items',
  'sales',
  'sale_items',
  'stock_movements',
  'shifts',
  'safe_ledger',
  'expenses',
  'client_ledger',
  'supplier_ledger',
  'users',
  'discount_rules',
  'settings'
]

/** Row counts and money/stock totals of the shop's data (only tables that exist). */
async function dataFingerprint(client) {
  const out = { counts: {}, totals: {} }
  for (const t of COUNTED) {
    const exists = (await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${t}`]))
      .rows[0].ok
    if (exists)
      out.counts[t] = (await client.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n
  }
  const total = async (key, sql) => {
    try {
      out.totals[key] = String((await client.query(sql)).rows[0].v ?? '0')
    } catch {
      /* table or column not there in this schema */
    }
  }
  await total('stock', 'SELECT COALESCE(sum(stock_qty), 0)::text AS v FROM products')
  await total('sales', 'SELECT COALESCE(sum(total_amount), 0)::text AS v FROM sales')
  await total('clientDebt', 'SELECT COALESCE(sum(debt_balance), 0)::text AS v FROM clients')
  await total('supplierDebt', 'SELECT COALESCE(sum(debt_balance), 0)::text AS v FROM suppliers')
  await total('drawer', 'SELECT COALESCE(sum(amount), 0)::text AS v FROM safe_ledger')
  return out
}

/** What an update changed that it must not: fewer rows, other totals. Empty = all kept. */
function compareFingerprints(before, after) {
  const problems = []
  for (const [t, n] of Object.entries(before.counts)) {
    const now = after.counts[t]
    if (now === undefined) problems.push(`table ${t} is missing after the update`)
    else if (now < n) problems.push(`${t}: ${n} rows before, ${now} after`)
  }
  for (const [k, v] of Object.entries(before.totals)) {
    if (after.totals[k] !== undefined && Number(after.totals[k]) !== Number(v))
      problems.push(`total ${k}: ${v} before, ${after.totals[k]} after`)
  }
  return problems
}

/** Consistency of the data itself: stock = sum of its movements; no broken references. */
async function integrityProblems(client) {
  const problems = []
  const { verifyLedger } = require('../inventory/stock')
  try {
    const ledger = await verifyLedger(client)
    if (ledger.length)
      problems.push(`stock differs from its movements for ${ledger.length} product(s)`)
  } catch (e) {
    problems.push(`stock check failed: ${e.message}`)
  }
  const fks = await client.query(`
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`)
  for (const r of fks.rows) {
    const n = (
      await client.query(
        `SELECT count(*)::int AS n FROM "${r.table_name}" t WHERE t."${r.column_name}" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "${r.ref_table}" x WHERE x."${r.ref_column}" = t."${r.column_name}")`
      )
    ).rows[0].n
    if (n)
      problems.push(`${n} broken reference(s) ${r.table_name}.${r.column_name} -> ${r.ref_table}`)
  }
  return problems
}

/** Refuse a database migrated by a newer version (code database_newer). */
function assertNotNewer(state) {
  if (state.unknown.length) {
    const e = new Error(
      `قاعدة البيانات محدَّثة بنسخة أحدث من هذا البرنامج (${state.unknown.join(', ')}). ثبّت تلك النسخة الأحدث، أو استعد النسخة الاحتياطية المأخوذة قبل تحديثها.`
    )
    e.code = 'database_newer'
    throw e
  }
}

module.exports = {
  schemaState,
  dataFingerprint,
  compareFingerprints,
  integrityProblems,
  assertNotNewer,
  COUNTED
}
