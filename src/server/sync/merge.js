'use strict'
// Bringing the other side's changes into this database (Phase 2 milestone 3, D-103).
//
// While the shop and the cloud can reach each other, every change is made in the shop and the
// cloud only copies it. While they cannot, each keeps working; afterwards each applies the other's
// changes here, in the order they were made, by four rules:
//   - a new record (sale, return, payment, movement, shift…) is added: its number cannot collide,
//     the two sides number from different books (migration 0033);
//   - a running total the other side changed (a balance, stock, a returned quantity) moves by the
//     other side's difference, so both sides' work adds up in any order;
//   - any other field the other side changed is taken if this side did not change it too;
//     changed on both sides, the shop's value stays (on both sides) and the shop lists the case;
//   - the current purchase price follows the latest purchase by its own date (owner, Q6).
// Nothing a person did is undone and no entry is invented: what breaks a business limit after the
// merge (stock below zero from both sides, a line returned twice, a balance paid twice) is listed
// in sync_attention for a person to settle with the ordinary operations.
//
// Rows are { t, k, op, r, p }: table, key, 'upsert' | 'delete', the row as JSON text, and the row
// before the change (updates only). Runs in the caller's transaction; a row that cannot be stored
// (a uniqueness rule, a missing reference) is skipped with its whole content kept in the list.

const FLOOR = 1000000000

// Running totals: the other side's change is a difference to add.
const ADDITIVE = {
  products: ['stock_qty'],
  clients: ['debt_balance', 'points'],
  suppliers: ['debt_balance'],
  sales: ['on_account_open', 'credit_open', 'total_amount'],
  sale_items: ['returned_qty', 'total_price', 'line_discount', 'cart_discount']
}
// Bookkeeping times: the later one is kept, never a conflict.
const LATEST = new Set(['updated_at', 'last_seen_at'])

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const q = (c) => `"${c}"`

async function columnsOf(db, table, cache) {
  if (!cache.has(table))
    cache.set(
      table,
      (
        await db.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
          [table]
        )
      ).rows.map((r) => r.column_name)
    )
  return cache.get(table)
}

const where = (keyCols, n) =>
  keyCols.length === 1
    ? `${q(keyCols[0])}::text = $${n}`
    : `hm_sync_key('${keyCols.join(',')}', to_jsonb(x)) = $${n}`

/** Which side's latest purchase of this product is the newer one (by the purchase's own time). */
async function newerPurchase(db, barcode) {
  const r = (
    await db.query(
      `SELECT max(created_at) FILTER (WHERE id < $2) AS shop, max(created_at) FILTER (WHERE id >= $2) AS cloud
         FROM stock_movements WHERE product_barcode = $1 AND kind = 'purchase'`,
      [barcode, FLOOR]
    )
  ).rows[0]
  if (!r.cloud) return 'shop'
  if (!r.shop) return 'cloud'
  return String(r.cloud) > String(r.shop) ? 'cloud' : 'shop'
}

/**
 * @param db       a client inside a transaction
 * @param rows     the other side's changes, in the order they were made
 * @param receiver 'shop' | 'cloud' – which side this database is
 * @returns        { applied, skipped, conflicts, attention: [ids] }
 */
async function applyChanges(db, rows, { receiver }) {
  const shop = receiver === 'shop'
  const keys = Object.fromEntries(
    (await db.query('SELECT table_name, key_column FROM sync_tables')).rows.map((r) => [
      r.table_name,
      r.key_column.split(',')
    ])
  )
  const cache = new Map()
  const items = []
  const touched = {
    products: new Set(),
    clients: new Set(),
    suppliers: new Set(),
    sales: new Set()
  }
  let applied = 0
  let skipped = 0
  let conflicts = 0

  // The selling-time guards step aside for records that already happened on the other side; the
  // shop's own capture marks what it writes here as echoes (sent on, never applied twice).
  await db.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
  await db.query("SELECT set_config('hm.sync_capture', $1, true)", [shop ? 'echo' : 'off'])

  // A row that points to one later in the batch (a first full send lists tables alphabetically)
  // waits for another pass; only what still fails after every pass is skipped.
  let pending = rows
  for (let pass = 0; pending.length && pass < 6; pass++) {
    const later = []
    const last = pass === 5
    for (const row of pending) {
      const keyCols = keys[row.t]
      if (!keyCols) continue
      await db.query('SAVEPOINT hm_merge_row')
      try {
        if (row.op === 'delete') {
          await db.query(`DELETE FROM "${row.t}" x WHERE ${where(keyCols, 1)}`, [row.k])
        } else {
          const r = JSON.parse(row.r)
          const p = row.p ? JSON.parse(row.p) : null
          const all = await columnsOf(db, row.t, cache)
          const local = (
            await db.query(
              `SELECT to_jsonb(x)::text AS j FROM "${row.t}" x WHERE ${where(keyCols, 1)} FOR UPDATE`,
              [row.k]
            )
          ).rows[0]
          if (!local) {
            const cols = all.filter((c) => c in r)
            await db.query(
              `INSERT INTO "${row.t}" (${cols.map(q).join(', ')}) OVERRIDING SYSTEM VALUE
             SELECT ${cols.map(q).join(', ')} FROM jsonb_populate_record(NULL::"${row.t}", $1::jsonb)`,
              [row.r]
            )
          } else {
            const l = JSON.parse(local.j)
            const take = {}
            const add = {}
            const clash = []
            for (const c of all.filter((x) => x in r && !keyCols.includes(x))) {
              if (p && same(r[c], p[c])) continue // the other side did not change it
              if (same(l[c], r[c])) continue // already the same here
              if (p && (ADDITIVE[row.t] || []).includes(c)) {
                add[c] = Number(r[c] ?? 0) - Number(p[c] ?? 0)
                continue
              }
              if (p && same(l[c], p[c])) {
                take[c] = r[c] // only the other side changed it
                continue
              }
              if (LATEST.has(c)) {
                if (String(r[c] ?? '') > String(l[c] ?? '')) take[c] = r[c]
                continue
              }
              if (row.t === 'products' && c === 'cost_price') {
                // Changed on both sides: the price of the newer purchase stands, on both sides.
                const newer = await newerPurchase(db, row.k)
                if ((newer === 'cloud') === shop) take[c] = r[c]
                continue
              }
              // Changed on both sides: the shop's value stands.
              if (!shop) take[c] = r[c]
              clash.push({
                column: c,
                base: p ? (p[c] ?? null) : null,
                shop: shop ? l[c] : r[c],
                cloud: shop ? r[c] : l[c]
              })
            }
            const sets = [
              ...Object.keys(take).map(
                (c) => `${q(c)} = (jsonb_populate_record(NULL::"${row.t}", $2::jsonb)).${q(c)}`
              ),
              ...Object.keys(add).map(
                (c, i) => `${q(c)} = COALESCE(${q(c)}, 0) + $${i + 3}::numeric`
              )
            ]
            if (sets.length)
              await db.query(
                // $2 is always named, so its type is known even when no field is taken as it is.
                `UPDATE "${row.t}" x SET ${sets.join(', ')} WHERE ${where(keyCols, 1)} AND $2::jsonb IS NOT NULL`,
                [row.k, JSON.stringify(take), ...Object.values(add).map((v) => String(v))]
              )
            if (clash.length) {
              conflicts += 1
              if (shop)
                items.push({
                  kind: 'conflict',
                  table: row.t,
                  key: row.k,
                  detail: { columns: clash }
                })
            }
          }
          if (touched[row.t]) touched[row.t].add(row.k)
          if (row.t === 'stock_movements') touched.products.add(r.product_barcode)
          if (row.t === 'sale_items') touched.sales.add(String(r.sale_id))
        }
        await db.query('RELEASE SAVEPOINT hm_merge_row')
        applied += 1
      } catch (e) {
        await db.query('ROLLBACK TO SAVEPOINT hm_merge_row')
        if (e.code === '23503' && !last) {
          later.push(row)
          continue
        }
        skipped += 1
        if (shop)
          items.push({
            kind: row.op === 'delete' ? 'delete_kept' : 'not_applied',
            table: row.t,
            key: row.k,
            detail: {
              reason: String(e.message).slice(0, 300),
              row: row.r ? JSON.parse(row.r) : null
            }
          })
      }
    }
    if (later.length === pending.length) {
      pending = later
      if (pass < 5) pass = 4 // no progress: one last pass records them
      continue
    }
    pending = later
  }

  await db.query("SELECT set_config('hm.ledger_rebuild', 'off', true)")
  // Received numbers never move this side's counters out of its own book.
  await db.query('SELECT hm_keep_id_range()')
  if (shop) items.push(...(await afterMerge(db, touched)))

  // The list is the shop's: written with ordinary capture, so it reaches the cloud like any record.
  await db.query("SELECT set_config('hm.sync_capture', 'on', true)")
  const ids = []
  for (const it of items) {
    const open = await db.query(
      "SELECT id FROM sync_attention WHERE status = 'open' AND kind = $1 AND table_name IS NOT DISTINCT FROM $2 AND row_key IS NOT DISTINCT FROM $3 AND kind <> 'conflict'",
      [it.kind, it.table || null, it.key || null]
    )
    if (open.rowCount) continue // already listed and not settled yet
    ids.push(
      (
        await db.query(
          'INSERT INTO sync_attention (kind, table_name, row_key, detail) VALUES ($1, $2, $3, $4) RETURNING id',
          [it.kind, it.table || null, it.key || null, JSON.stringify(it.detail || {})]
        )
      ).rows[0].id
    )
  }
  await db.query("SELECT set_config('hm.sync_capture', '', true)")
  return { applied, skipped, conflicts, attention: ids }
}

/** What breaks a business limit once both sides' records are together (the shop only). */
async function afterMerge(db, touched) {
  const out = []
  const products = [...touched.products]
  if (products.length)
    for (const p of (
      await db.query(
        'SELECT barcode, name, stock_qty FROM products WHERE barcode = ANY($1::text[]) AND stock_qty < 0',
        [products]
      )
    ).rows)
      out.push({
        kind: 'stock_negative',
        table: 'products',
        key: p.barcode,
        detail: { name: p.name, stock: Number(p.stock_qty) }
      })
  for (const [table, label] of [
    ['clients', 'العميل'],
    ['suppliers', 'المورد']
  ]) {
    const ids = [...touched[table]].map(Number).filter(Number.isInteger)
    if (!ids.length) continue
    for (const x of (
      await db.query(
        `SELECT id, name, debt_balance FROM "${table}" WHERE id = ANY($1::int[]) AND debt_balance < 0`,
        [ids]
      )
    ).rows)
      out.push({
        kind: 'overpaid',
        table,
        key: String(x.id),
        detail: { name: x.name, balance: Number(x.debt_balance), who: label }
      })
  }
  const sales = [...touched.sales].map(Number).filter(Number.isInteger)
  if (sales.length)
    for (const s of (
      await db.query(
        `SELECT si.id, si.sale_id, si.product_barcode, si.quantity, si.returned_qty
           FROM sale_items si WHERE si.sale_id = ANY($1::int[]) AND si.returned_qty > si.quantity`,
        [sales]
      )
    ).rows)
      out.push({
        kind: 'returned_twice',
        table: 'sale_items',
        key: String(s.id),
        detail: {
          sale: s.sale_id,
          barcode: s.product_barcode,
          sold: Number(s.quantity),
          returned: Number(s.returned_qty)
        }
      })
  for (const s of (
    await db.query(
      `SELECT DISTINCT s.shift_id FROM sales s JOIN shifts sh ON sh.id = s.shift_id
        WHERE s.id >= $1 AND sh.status = 'closed' AND sh.end_time < s.timestamp`,
      [FLOOR]
    )
  ).rows)
    out.push({
      kind: 'after_close',
      table: 'shifts',
      key: String(s.shift_id),
      detail: { shift: s.shift_id }
    })
  for (const u of (
    await db.query(
      "SELECT user_id, array_agg(id ORDER BY id) AS shifts FROM shifts WHERE status = 'open' GROUP BY user_id HAVING count(*) > 1"
    )
  ).rows)
    out.push({
      kind: 'two_open_shifts',
      table: 'users',
      key: String(u.user_id),
      detail: { shifts: u.shifts }
    })
  return out
}

module.exports = { applyChanges, FLOOR, ADDITIVE }
