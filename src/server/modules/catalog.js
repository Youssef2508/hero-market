'use strict'
// Products (useProductsManager), reorder data (ReorderingTab), product lookup for damaged goods.
const { conflict, notFound } = require('../errors')

const PER_PAGE = 12
const SORTABLE = ['name', 'barcode', 'stock_qty', 'retail_price', 'cost_price', 'reorder_limit'] // legacy whitelist
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`)

/** Hide cost figures from roles without products.view_cost. */
function maskCost(ctx, rows) {
  if (ctx.can('products.view_cost')) return rows
  return rows.map((r) => {
    const { cost_price: _c, cost: _k, ...rest } = r
    return rest
  })
}

const productSchema = {
  type: 'object',
  required: ['barcode', 'name'],
  properties: {
    barcode: { type: 'string', minLength: 1, maxLength: 64 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    cost_price: { type: 'number', minimum: 0 },
    retail_price: { type: 'number', minimum: 0 },
    wholesale_price: { type: 'number', minimum: 0 },
    stock_qty: { type: 'number', minimum: 0 },
    reorder_limit: { type: 'number', minimum: 0 },
    unit: { type: 'string', maxLength: 40 }
  }
}

module.exports = function catalogModule(app) {
  app.operation({
    name: 'products.page',
    permission: 'products.view',
    schema: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        search: { type: 'string', maxLength: 100 },
        sortField: { type: 'string' },
        sortAsc: { type: 'boolean' }
      }
    },
    handler: async (ctx, { page = 1, search = '', sortField = 'name', sortAsc = true }) => {
      const field = SORTABLE.includes(sortField) ? sortField : 'name'
      const params = []
      let where = ''
      if (search) {
        params.push(likeEscape(search))
        where = `WHERE barcode ILIKE '%' || $1 || '%' ESCAPE '\\' OR name ILIKE '%' || $1 || '%' ESCAPE '\\'`
      }
      const total = (
        await ctx.pool.query(`SELECT count(*) AS count FROM products ${where}`, params)
      ).rows[0].count
      const rows = (
        await ctx.pool.query(
          `SELECT * FROM products ${where} ORDER BY ${field} ${sortAsc ? 'ASC' : 'DESC'}, barcode LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`,
          params
        )
      ).rows
      return { total, page, perPage: PER_PAGE, field, rows: maskCost(ctx, rows) }
    }
  })

  app.operation({
    name: 'products.get',
    anyPermission: ['products.view', 'inventory.damaged'],
    schema: {
      type: 'object',
      required: ['barcode'],
      properties: { barcode: { type: 'string', maxLength: 64 } }
    },
    handler: async (ctx, { barcode }) => {
      const r = (await ctx.pool.query('SELECT * FROM products WHERE barcode = $1', [barcode])).rows
      return r.length ? maskCost(ctx, r)[0] : null
    }
  })

  app.operation({
    name: 'products.create',
    permission: 'products.manage',
    schema: productSchema,
    handler: async (ctx, p) =>
      ctx.tx(async (db) => {
        await db.query(
          `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, reorder_limit, unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            p.barcode.trim(),
            p.name,
            p.cost_price || 0,
            p.retail_price || 0,
            p.wholesale_price || 0,
            p.stock_qty || 0,
            p.reorder_limit || 0,
            p.unit || ''
          ]
        )
        await ctx.audit(db, 'product_create', `إضافة صنف "${p.name}" (${p.barcode})`)
      })
  })

  app.operation({
    name: 'products.update',
    permission: 'products.manage',
    schema: productSchema,
    handler: async (ctx, p) =>
      ctx.tx(async (db) => {
        const before = (
          await db.query('SELECT * FROM products WHERE barcode = $1 FOR UPDATE', [p.barcode])
        ).rows[0]
        if (!before) throw notFound('الصنف غير موجود.')
        await db.query(
          `UPDATE products SET name = $2, cost_price = $3, retail_price = $4, wholesale_price = $5, stock_qty = $6, reorder_limit = $7, unit = $8
           WHERE barcode = $1`,
          [
            p.barcode,
            p.name,
            p.cost_price || 0,
            p.retail_price || 0,
            p.wholesale_price || 0,
            p.stock_qty || 0,
            p.reorder_limit || 0,
            p.unit || ''
          ]
        )
        const changes = {}
        for (const k of [
          'name',
          'cost_price',
          'retail_price',
          'wholesale_price',
          'stock_qty',
          'reorder_limit',
          'unit'
        ]) {
          const a = before[k] ?? ''
          const b = p[k] ?? (k === 'name' || k === 'unit' ? '' : 0)
          if (String(a) !== String(b)) changes[k] = { from: a, to: b }
        }
        if (Object.keys(changes).length)
          await ctx.audit(db, 'product_update', `تعديل صنف "${p.name}" (${p.barcode})`, changes)
      })
  })

  app.operation({
    name: 'products.delete',
    permission: 'products.manage',
    schema: {
      type: 'object',
      required: ['barcode'],
      properties: { barcode: { type: 'string', maxLength: 64 } }
    },
    handler: async (ctx, { barcode }) =>
      ctx.tx(async (db) => {
        try {
          const r = await db.query('DELETE FROM products WHERE barcode = $1 RETURNING name', [
            barcode
          ])
          if (!r.rowCount) throw notFound('الصنف غير موجود.')
          await ctx.audit(db, 'product_delete', `حذف صنف "${r.rows[0].name}" (${barcode})`)
        } catch (e) {
          if (e.code === '23503') {
            throw conflict(
              'لا يمكن حذف هذا المنتج لأنه مرتبط بمبيعات أو فواتير سابقة في الداتا بيس.\nيمكنك بدلاً من حذفه تعديل كميته المتاحة إلى صفر.'
            )
          }
          throw e
        }
      })
  })

  // ReorderingTab: all products + quantities sold in shifts that started within the last 30 days.
  app.operation({
    name: 'inventory.reorderData',
    permission: 'inventory.reorder',
    handler: async (ctx) => {
      const products = (
        await ctx.pool.query(
          'SELECT barcode, name, stock_qty AS stock, reorder_limit, unit, cost_price AS cost, retail_price AS price FROM products ORDER BY barcode'
        )
      ).rows
      const sales = (
        await ctx.pool.query(
          `SELECT product_barcode, SUM(quantity) AS total_qty FROM sale_items si JOIN sales s ON si.sale_id = s.id
           WHERE s.shift_id IN (SELECT id FROM shifts WHERE start_time >= (CURRENT_DATE - 30)::timestamp)
           GROUP BY product_barcode`
        )
      ).rows
      return { products: maskCost(ctx, products), sales }
    }
  })
}

module.exports.maskCost = maskCost
