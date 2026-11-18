'use strict'
// The update to 1.9.0 changes no product (D-117, owner, 2026-11-18): migration 0041 only adds the
// «صنف ميزان» columns, every product unmarked. Codes like 2000001 (the older way of registering a
// scale product), 1 and 01 stay exactly as they were, with every barcode, unit and price; nothing
// is inferred from a code. And a label scanned after the update names the product it named before.
// A 1.8.0 store (schema 0040) built by the migrations themselves, made-up rows.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { requireDb, freshDatabase } = require('./helpers')
const { createPool } = require('../../src/server/db/pool')
const { migrate, DEFAULT_DIR } = require('../../src/server/db/migrate')
const { parseScaleLabel, ean13CheckDigit } = require('../../src/server/inventory/units')
const { productForLabel } = require('../../src/server/inventory/scaleItems')

const SCALE = {
  enabled: true,
  length: 13,
  codeStart: 2,
  codeLength: 5,
  valueStart: 7,
  valueLength: 5,
  weightDivisor: 1000,
  priceDivisor: 100,
  prefixes: { 20: 'weight' },
  checkDigit: 'ean13'
}
const label = (code, grams) => {
  const t = `20${String(code).padStart(5, '0')}${String(grams).padStart(5, '0')}`
  return t + ean13CheckDigit(t)
}

/** The migrations up to `last`, in a folder of their own. */
function upTo(last) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hm-mig-${last}-`))
  for (const f of fs.readdirSync(DEFAULT_DIR))
    if (/^\d{4}_/.test(f) && f.slice(0, 4) <= last)
      fs.copyFileSync(path.join(DEFAULT_DIR, f), path.join(dir, f))
  return dir
}

/** Every product, unit and barcode as text, in a fixed order (the columns 1.8.0 has). */
async function snapshot(pool) {
  const q = async (sql) => (await pool.query(sql)).rows
  return {
    products: await q(
      `SELECT barcode, name, cost_price::text, retail_price::text, wholesale_price::text, stock_qty::text,
              reorder_limit::text, unit, category, unit_kind, category_id, is_active
         FROM products ORDER BY barcode`
    ),
    units: await q(
      'SELECT id, product_barcode, name, factor::text, retail_price::text FROM product_units ORDER BY id'
    ),
    barcodes: await q(
      'SELECT barcode, product_barcode, unit_id FROM product_barcodes ORDER BY barcode'
    ),
    movements: await q(
      'SELECT count(*)::int AS n, COALESCE(sum(qty), 0)::text AS q FROM stock_movements'
    )
  }
}

test('updating a 1.8.0 store to 1.9.0 changes no product, and every product is unmarked', async (t) => {
  if (!requireDb(t)) return
  const db = await freshDatabase()
  const pool = createPool(db.url)
  try {
    await migrate(pool, { dir: upTo('0040'), logger: null })
    assert.equal(
      (await pool.query('SELECT max(version) AS v FROM schema_migrations')).rows[0].v,
      '0040'
    )
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
      await c.query(
        `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, unit_kind, category) VALUES
         ('2000001', 'جبنة رومي (بكود الملصق)', 300, 400, 12.5, 'كيلو', 'weight', 'ألبان'),
         ('2000002', 'جبنة بيضاء (بكود الملصق)', 100, 140, 8, 'كيلو', 'weight', 'ألبان'),
         ('1', 'لانشون', 300, 396, 4.25, 'كيلو', 'weight', 'لحوم'),
         ('01', 'زيتون', 150, 200, 3, 'كيلو', 'weight', 'مخللات'),
         ('001', 'حلاوة', 100, 160, 2, 'كيلو', 'weight', 'حلويات'),
         ('6223001360063', 'بيبسي', 10, 13, 48, 'علبة', 'count', 'مشروبات')`
      )
      await c.query("SELECT hm_post_opening_balances('test seed')")
      const u = await c.query(
        "INSERT INTO product_units (product_barcode, name, factor, retail_price) VALUES ('6223001360063', 'كرتونة', 24, 300) RETURNING id"
      )
      await c.query(
        "INSERT INTO product_barcodes (barcode, product_barcode, unit_id) VALUES ('6223001360070', '6223001360063', $1), ('2000003', '01', NULL)",
        [u.rows[0].id]
      )
      await c.query("INSERT INTO settings (key, value) VALUES ('scale_labels', $1)", [
        JSON.stringify(SCALE)
      ])
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    const before = await snapshot(pool)
    // What each label named under 1.8.0 (its exact codes, in their order: pos.resolve as it was).
    const labels = [label(1, 125), label(2, 300), label(3, 250)]
    const was = []
    for (const l of labels) {
      const s = parseScaleLabel(SCALE, l)
      const spell = [
        ...new Set([
          s.fullCode,
          s.code,
          s.fullCode.slice(2),
          s.code.replace(/^0+/, ''),
          s.fullCode.slice(2).replace(/^0+/, '')
        ])
      ]
      was.push(
        (
          await pool.query(
            'SELECT barcode FROM products WHERE barcode = ANY($1::text[]) ORDER BY array_position($1::text[], barcode) LIMIT 1',
            [spell]
          )
        ).rows[0]?.barcode ?? null
      )
    }

    // The update.
    const applied = await migrate(pool, { logger: null })
    assert.ok(
      applied.some((f) => String(f).startsWith('0041')),
      JSON.stringify(applied)
    )

    // Every product, unit, barcode and movement exactly as before; nothing marked.
    assert.deepEqual(await snapshot(pool), before)
    assert.deepEqual(
      (await pool.query('SELECT barcode, scale_item, scale_key FROM products ORDER BY barcode'))
        .rows,
      before.products.map((p) => ({ barcode: p.barcode, scale_item: false, scale_key: null }))
    )
    // 2000001 is still 2000001, 1 is still 1, 01 is still 01.
    assert.deepEqual(
      before.products.map((p) => p.barcode),
      ['001', '01', '1', '2000001', '2000002', '6223001360063']
    )
    // The same label names the same product after the update (2000001…, 2000002…, and 2000003…
    // which named 1.8.0's extra barcode route: none of these codes is a product, so null as before).
    const now = []
    for (const l of labels)
      now.push((await productForLabel(pool, parseScaleLabel(SCALE, l)))?.barcode ?? null)
    assert.deepEqual(now, was)
    assert.deepEqual(was, ['2000001', '2000002', null])
  } finally {
    await pool.end()
    await db.dispose()
  }
})
