'use strict'
// Writing synchronised rows into the store's tables, as they are (no business rule runs: they are
// records that already exist on the other side).
//   - Recovery after a restore (stage 4 phase 4, D-047): the rows that reached the cloud after the
//     restored backup was taken are written back to the PC. Runs only while writes are paused
//     (sync_state.recovery_pending), in one transaction with the end of the pause.
//   - The cloud's copy of the store (Phase 2 milestone 1, D-101): every row the PC sends is written
//     into the cloud's own tables, inside the transaction that accepted the batch.
const { TABLES, TRIGGER_TABLES } = require('../modules/backup')

async function columnsOf(db, table) {
  return (
    await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [table]
    )
  ).rows.map((r) => r.column_name)
}

const q = (c) => `"${c}"`

/**
 * @param db     a client inside a transaction
 * @param rows   { t, k, deleted, r (JSON text) } in the order they were made
 * @param opts.fixStock  re-check stock against its movements afterwards (recovery; default true).
 *                       The cloud's copy takes the PC's stock as sent and skips this whole-table pass.
 * @returns      { upserted: {table: n}, deleted: {table: n}, ledgerFixes, skipped }
 */
async function applyRecovered(db, rows, { fixStock = true } = {}) {
  const keys = Object.fromEntries(
    (await db.query('SELECT table_name, key_column FROM sync_tables')).rows.map((r) => [
      r.table_name,
      r.key_column
    ])
  )
  // Latest state per row (the list is in the order the changes were made).
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
  const touched = TRIGGER_TABLES.filter((t) => byTable[t])
  for (const t of touched) await db.query(`ALTER TABLE "${t}" DISABLE TRIGGER USER`)

  const upserted = {}
  const deleted = {}
  for (const t of order) {
    const list = (byTable[t] || []).filter((r) => !r.deleted)
    if (!list.length) continue
    const keyCols = keys[t].split(',')
    const all = await columnsOf(db, t)
    const statements = new Map() // the columns a row carries → its statement
    for (const r of list) {
      // A row carries the columns its sender sends (a user row comes without the old PIN
      // columns): only those are written, the others keep what they hold here.
      const sent = Object.keys(JSON.parse(r.r))
      const cols = all.filter((c) => sent.includes(c))
      const id = cols.join(',')
      if (!statements.has(id)) {
        const rest = cols.filter((c) => !keyCols.includes(c))
        statements.set(
          id,
          `INSERT INTO "${t}" (${cols.map(q).join(', ')}) OVERRIDING SYSTEM VALUE
           SELECT ${cols.map(q).join(', ')} FROM jsonb_populate_record(NULL::"${t}", $1::jsonb)
           ON CONFLICT (${keyCols.map(q).join(', ')}) ${
             rest.length
               ? `DO UPDATE SET ${rest.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ')}`
               : 'DO NOTHING'
           }`
        )
      }
      await db.query(statements.get(id), [r.r])
    }
    upserted[t] = list.length
  }
  for (const t of [...order].reverse()) {
    const list = (byTable[t] || []).filter((r) => r.deleted)
    if (!list.length) continue
    const res = keys[t].includes(',')
      ? await db.query(
          `DELETE FROM "${t}" x WHERE hm_sync_key($2, to_jsonb(x)) = ANY($1::text[])`,
          [list.map((r) => r.k), keys[t]]
        )
      : await db.query(`DELETE FROM "${t}" WHERE "${keys[t]}"::text = ANY($1::text[])`, [
          list.map((r) => r.k)
        ])
    deleted[t] = res.rowCount
  }
  // Number counters continue after the highest written number of this side's own book (the
  // other side's numbers, from its own book, never move them: migration 0033).
  await db.query('SELECT hm_keep_id_range()')
  // Stock is the sum of its movements (phase 1 ledger). Recovered rows come from complete
  // transactions, so this normally changes nothing; any difference is corrected and reported.
  const fixes = fixStock
    ? await db.query(
        `UPDATE products p SET stock_qty = m.s
           FROM (SELECT product_barcode, SUM(qty) AS s FROM stock_movements GROUP BY product_barcode) m
          WHERE m.product_barcode = p.barcode AND COALESCE(p.stock_qty, 0) <> m.s
          RETURNING p.barcode`
      )
    : { rows: [] }
  for (const t of touched) await db.query(`ALTER TABLE "${t}" ENABLE TRIGGER USER`)
  await db.query("SELECT set_config('hm.ledger_rebuild', 'off', true)")
  return {
    upserted,
    deleted,
    ledgerFixes: fixes.rows.map((r) => r.barcode),
    skipped: [...new Set(skipped)]
  }
}

module.exports = { applyRecovered }
