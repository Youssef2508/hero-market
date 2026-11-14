'use strict'
// A first full send larger than one batch (D-109, migration 0039): every record reaches the
// cloud's copy, packages and their barcodes included, because each table is sent after the tables
// it points to. Before, the tables went alphabetically and the packages of a large store, sent a
// batch before their products, were skipped by the cloud.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { requireDb } = require('./helpers')
const { makeTwin, copyDifferences } = require('./cloudHelpers')

const num = async (pool, sql) => Number(Object.values((await pool.query(sql)).rows[0])[0])

test('every synchronised table is listed after the tables it references', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin({ link: false })
  try {
    const order = (
      await twin.shop.pool.query('SELECT table_name FROM hm_sync_table_order()')
    ).rows.map((r) => r.table_name)
    const all = (await twin.shop.pool.query('SELECT table_name FROM sync_tables')).rows
    assert.equal(order.length, all.length, 'every table once')
    const refs = (
      await twin.shop.pool.query(
        `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
           FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid <> c.confrelid`
      )
    ).rows.filter((r) => order.includes(r.child) && order.includes(r.parent))
    assert.ok(refs.length > 10)
    for (const r of refs)
      assert.ok(order.indexOf(r.parent) < order.indexOf(r.child), `${r.parent} before ${r.child}`)
    assert.ok(order.indexOf('products') < order.indexOf('product_units'))
    assert.ok(order.indexOf('product_units') < order.indexOf('product_barcodes'))
  } finally {
    await twin.close()
  }
})

test('a first full send of many batches: the cloud holds every record, packages included', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const products = Array.from({ length: 3000 }, (_, i) => ({
      row: i + 2,
      barcode: `SNAP${i}`,
      name: `صنف ${i}`,
      retail_price: 5,
      stock_qty: 3,
      unit: 'قطعة',
      ...(i % 2 ? { pack_name: 'كرتونة', pack_factor: 6, pack_barcode: `SNAPP${i}` } : {})
    }))
    const r = await twin.shop.call('storeImport.apply', { products }, twin.owner)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    // A first contact again (a new cloud, or a pairing after the import): one full snapshot.
    await twin.shop.pool.query('UPDATE sync_state SET epoch = NULL')
    for (let i = 0; i < 40; i++) {
      await twin.agent.runOnce({ check: false })
      if (!(await num(twin.shop.pool, 'SELECT count(*) FROM sync_outbox WHERE acked_at IS NULL')))
        break
    }
    assert.ok(
      (await num(twin.shop.pool, 'SELECT count(*) FROM sync_outbox')) > 4000,
      'more than one batch'
    )
    assert.deepEqual(await copyDifferences(twin), [])
    for (const table of ['products', 'product_units', 'product_barcodes', 'stock_movements'])
      assert.equal(
        await num(twin.cloud.pool, `SELECT count(*) FROM ${table}`),
        await num(twin.shop.pool, `SELECT count(*) FROM ${table}`),
        table
      )
  } finally {
    await twin.close()
  }
})
