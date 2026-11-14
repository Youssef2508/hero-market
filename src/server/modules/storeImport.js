'use strict'
// Import of the store's starting data from the owner's Excel template (1.4.0).
//
// The screen reads the workbook (src/shared/storeImport.mjs) and sends its rows here. The rows are
// checked and written by src/server/imports/storeData.js: nothing is written unless all rows are
// valid, then everything in one transaction, through the same rules as the screens. Existing
// records are never changed: a barcode or phone number already in the store is reported.
//
// storeImport.apply answers in the same request: the screen's check (dryRun) and small files. A
// large file is imported as a background job that survives a closed page or a lost connection
// (imports.start, src/server/modules/imports.js, 1.6.3).
// Permission data.import (ROLE-01), separate from data.export.
const path = require('path')
const { pathToFileURL } = require('url')
const { badRequest } = require('../errors')
const { checkRows, writeRows } = require('../imports/storeData')

const shared = {}
async function lib(name) {
  if (!shared[name])
    shared[name] = await import(
      pathToFileURL(path.join(__dirname, '..', '..', 'shared', `${name}.mjs`)).href
    )
  return shared[name]
}

const rowSchema = { type: 'object', properties: { row: { type: 'integer' } } }
const list = (max) => ({ type: 'array', maxItems: max, items: rowSchema })

module.exports = function storeImportModule(app) {
  app.operation({
    name: 'storeImport.apply',
    permission: 'data.import',
    bodyLimit: 64 * 1024 * 1024,
    schema: {
      type: 'object',
      properties: {
        products: list(20000),
        customers: list(20000),
        suppliers: list(2000),
        // true: check only, write nothing (the screen's preview).
        dryRun: { type: 'boolean' }
      }
    },
    handler: async (ctx, body) => {
      if (!body.products?.length && !body.customers?.length && !body.suppliers?.length)
        throw badRequest('لا توجد صفوف للاستيراد.')
      return ctx.tx(async (db) => {
        const { errors, summary, clean } = await checkRows(db, body)
        if (errors.length || body.dryRun)
          return { ok: !errors.length, errors, summary, written: false }
        // One transaction: any failure undoes everything.
        await writeRows(db, ctx, clean)
        await ctx.audit(
          db,
          'store_import',
          `استيراد بيانات المتجر: ${summary.products} صنف، ${summary.customers} عميل، ${summary.suppliers} مورد`,
          summary
        )
        return { ok: true, errors: [], summary, written: true }
      })
    }
  })

  // Export in the import template's layout (DATA-01, D-067): active products with their stock,
  // current cost and one package; customers and suppliers with their current balances. Read
  // only, in one snapshot; the screen writes the workbook and checks it by reading it back.
  // Not exported (see .docs/DATA_IMPORT_EXPORT.md): history (sales, purchases, shifts, money),
  // users and passwords, settings, inactive products, a product's extra barcodes and any package
  // beyond its largest one – the backup keeps all of these. The counts of what was left out are
  // returned so the screen can say so.
  app.operation({
    name: 'storeExport.data',
    permission: 'data.export',
    handler: async (ctx) => {
      const { TEMPLATE_VERSION } = await lib('storeImport')
      const client = await ctx.pool.connect()
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const q = async (sql) => (await client.query(sql)).rows
        const products = await q(
          `SELECT p.barcode, p.name, p.retail_price::float8 AS retail_price, p.cost_price::float8 AS cost_price,
                  p.stock_qty::float8 AS stock_qty, p.unit,
                  COALESCE(k.name, p.unit_kind) AS unit_kind, COALESCE(c.name, p.category, '') AS category,
                  p.reorder_limit::float8 AS reorder_limit,
                  u.name AS pack_name, u.factor::float8 AS pack_factor,
                  (SELECT MIN(b.barcode) FROM product_barcodes b WHERE b.unit_id = u.id) AS pack_barcode,
                  CASE WHEN u.retail_auto THEN NULL ELSE u.retail_price::float8 END AS pack_price,
                  u.purchase_cost::float8 AS pack_cost
             FROM products p
             LEFT JOIN measure_kinds k ON k.key = p.unit_kind
             LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN LATERAL (SELECT * FROM product_units x WHERE x.product_barcode = p.barcode AND x.is_active
                                 ORDER BY x.factor DESC, x.id LIMIT 1) u ON true
            WHERE p.is_active IS NOT FALSE
            ORDER BY p.barcode`
        )
        const customers = await q(
          `SELECT c.name, c.phone, c.phone2,
                  COALESCE((SELECT a.address FROM client_addresses a WHERE a.client_id = c.id AND a.is_default), c.address, '') AS address,
                  c.debt_balance::float8 AS balance
             FROM clients c ORDER BY c.id`
        )
        const suppliers = await q(
          `SELECT name, phone, address, contact_person, debt_balance::float8 AS balance
             FROM suppliers ORDER BY id`
        )
        const left = (
          await q(
            `SELECT (SELECT COUNT(*) FROM products WHERE is_active IS FALSE)::int AS inactive_products,
                    (SELECT COUNT(*) FROM (SELECT product_barcode FROM product_units WHERE is_active
                                            GROUP BY product_barcode HAVING COUNT(*) > 1) x)::int AS products_with_more_packages,
                    (SELECT COUNT(*) FROM product_barcodes WHERE unit_id IS NULL)::int AS extra_barcodes`
          )
        )[0]
        const stamp = (await q("SELECT to_char(LOCALTIMESTAMP, 'YYYY-MM-DD HH24:MI') AS t"))[0].t
        await client.query('COMMIT')
        await ctx.audit(
          ctx.pool,
          'data_export',
          `تصدير البيانات: ${products.length} صنف، ${customers.length} عميل، ${suppliers.length} مورد`,
          { products: products.length, customers: customers.length, suppliers: suppliers.length }
        )
        return { version: TEMPLATE_VERSION, createdAt: stamp, products, customers, suppliers, left }
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        client.release()
      }
    }
  })
}
