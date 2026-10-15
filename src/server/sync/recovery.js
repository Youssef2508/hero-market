'use strict'
// Recovery after a restore (stage 4 phase 4, D-047): write back the rows that reached the cloud after
// the restored backup was taken – sales, payments, movements, receipts made on the lost database.
//
// Runs only while writes are paused (sync_state.recovery_pending), so no new local row can collide
// with a recovered one. Everything happens in one transaction: either the whole set is written back
// and the pause ends, or nothing changes and the pause stays.
const { TABLES, TRIGGER_TABLES } = require('../modules/backup')

// Users and roles reach the cloud through an allow-list (no password data); only those columns are
// written back. A user created after the backup comes back without a password: an administrator
// gives them a temporary one.
const PARTIAL = {
  users: ['id', 'username', 'role', 'role_id', 'is_active', 'created_at', 'updated_at'],
  roles: ['id', 'key', 'name', 'description']
}

async function columnsOf(db, table) {
  return (
    await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [table]
    )
  ).rows.map((r) => r.column_name)
}

/**
 * @param db     a client inside a transaction
 * @param rows   cloud rows newer than the backup: { t, k, deleted, r (JSON text), epoch, version }
 * @returns      { upserted: {table: n}, deleted: {table: n}, ledgerFixes, skipped }
 */
async function applyRecovered(db, rows) {
  const keys = Object.fromEntries(
    (await db.query('SELECT table_name, key_column FROM sync_tables')).rows.map((r) => [
      r.table_name,
      r.key_column
    ])
  )
  // Latest state per row (the list is in (epoch, version) order).
  const latest = new Map()
  for (const r of rows) latest.set(`${r.t}\u0000${r.k}`, r)
  const byTable = {}
  const skipped = []
  for (const r of latest.values()) {
    if (!keys[r.t]) {
      skipped.push(r.t)
      continue
    }
    ;(byTable[r.t] ||= []).push(r)
  }
  const order = [
    ...TABLES.filter((t) => keys[t]),
    ...Object.keys(keys).filter((t) => !TABLES.includes(t))
  ]

  await db.query("SELECT set_config('hm.sync_capture', 'off', true)")
  await db.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
  for (const t of TRIGGER_TABLES) await db.query(`ALTER TABLE "${t}" DISABLE TRIGGER USER`)

  const upserted = {}
  const deleted = {}
  for (const t of order) {
    const list = (byTable[t] || []).filter((r) => !r.deleted)
    if (!list.length) continue
    const key = keys[t]
    const all = await columnsOf(db, t)
    const cols = (PARTIAL[t] || all).filter((c) => all.includes(c))
    const q = (c) => `"${c}"`
    const sql = `INSERT INTO "${t}" (${cols.map(q).join(', ')}) OVERRIDING SYSTEM VALUE
      SELECT ${cols.map(q).join(', ')} FROM jsonb_populate_record(NULL::"${t}", $1::jsonb)
      ON CONFLICT ("${key}") DO UPDATE SET ${cols
        .filter((c) => c !== key)
        .map((c) => `${q(c)} = EXCLUDED.${q(c)}`)
        .join(', ')}`
    for (const r of list) await db.query(sql, [r.r])
    upserted[t] = list.length
  }
  for (const t of [...order].reverse()) {
    const list = (byTable[t] || []).filter((r) => r.deleted)
    if (!list.length) continue
    const res = await db.query(`DELETE FROM "${t}" WHERE "${keys[t]}"::text = ANY($1::text[])`, [
      list.map((r) => r.k)
    ])
    deleted[t] = res.rowCount
  }
  // Identity sequences continue after the highest recovered id.
  for (const t of Object.keys(upserted).filter((x) => keys[x] === 'id')) {
    const seq = (await db.query(`SELECT pg_get_serial_sequence($1, 'id') AS s`, [t])).rows[0]?.s
    if (seq)
      await db.query(
        `SELECT setval($1, GREATEST((SELECT COALESCE(max(id), 0) FROM "${t}"), (SELECT last_value FROM ${seq})))`,
        [seq]
      )
  }
  // Stock is the sum of its movements (phase 1 ledger). Recovered rows come from complete
  // transactions, so this normally changes nothing; any difference is corrected and reported.
  const fixes = await db.query(
    `UPDATE products p SET stock_qty = m.s
       FROM (SELECT product_barcode, SUM(qty) AS s FROM stock_movements GROUP BY product_barcode) m
      WHERE m.product_barcode = p.barcode AND COALESCE(p.stock_qty, 0) <> m.s
      RETURNING p.barcode`
  )
  for (const t of TRIGGER_TABLES) await db.query(`ALTER TABLE "${t}" ENABLE TRIGGER USER`)
  await db.query("SELECT set_config('hm.ledger_rebuild', 'off', true)")
  return {
    upserted,
    deleted,
    ledgerFixes: fixes.rows.map((r) => r.barcode),
    skipped: [...new Set(skipped)]
  }
}

module.exports = { applyRecovered }
