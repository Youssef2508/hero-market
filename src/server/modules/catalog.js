'use strict'
// Products (useProductsManager), reorder data (ReorderingTab), product lookup for damaged goods.
const { conflict, notFound } = require('../errors')
const { postMovement, adjustTo, verifyLedger } = require('../inventory/stock')

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
    // Negative stock is allowed (owner decision). On update, stock_qty is the target and
    // stock_base the stock the form showed when it was opened (K-37).
    stock_qty: { type: 'number' },
    stock_base: { type: ['number', 'null'] },
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
        const barcode = p.barcode.trim()
        await db.query(
          `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, reorder_limit, unit)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
          [
            barcode,
            p.name,
            p.cost_price || 0,
            p.retail_price || 0,
            p.wholesale_price || 0,
            p.reorder_limit || 0,
            p.unit || ''
          ]
        )
        if (Number(p.stock_qty)) {
          await postMovement(db, ctx, {
            barcode,
            qty: Number(p.stock_qty),
            kind: 'opening',
            refType: 'product',
            reason: 'رصيد أول عند إضافة الصنف'
          })
        }
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
          `UPDATE products SET name = $2, cost_price = $3, retail_price = $4, wholesale_price = $5, reorder_limit = $6, unit = $7
           WHERE barcode = $1`,
          [
            p.barcode,
            p.name,
            p.cost_price || 0,
            p.retail_price || 0,
            p.wholesale_price || 0,
            p.reorder_limit || 0,
            p.unit || ''
          ]
        )
        // K-37: the form's stock is a target relative to what it showed (stock_base), so sales
        // recorded while the form was open are kept. Without a base, a changed stock is refused.
        const wantsStock = p.stock_qty !== undefined && p.stock_qty !== null
        const hasBase = p.stock_base !== undefined && p.stock_base !== null
        let adjusted = null
        if (wantsStock && hasBase) {
          adjusted = await adjustTo(db, ctx, {
            barcode: p.barcode,
            target: p.stock_qty,
            base: p.stock_base,
            kind: 'adjustment',
            reason: 'تعديل الكمية من شاشة الصنف'
          })
        } else if (wantsStock && Number(p.stock_qty) !== (Number(before.stock_qty) || 0)) {
          throw conflict('تغيّر رصيد الصنف. أعد فتح الصنف ثم عدّل الكمية.', {
            stock: Number(before.stock_qty) || 0
          })
        }
        const changes = {}
        for (const k of [
          'name',
          'cost_price',
          'retail_price',
          'wholesale_price',
          'reorder_limit',
          'unit'
        ]) {
          const a = before[k] ?? ''
          const b = p[k] ?? (k === 'name' || k === 'unit' ? '' : 0)
          if (String(a) !== String(b)) changes[k] = { from: a, to: b }
        }
        if (adjusted)
          changes.stock_qty = {
            from: Number(before.stock_qty) || 0,
            to: adjusted.balanceAfter,
            movement: adjusted.id
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
          const used = await db.query(
            "SELECT 1 FROM stock_movements WHERE product_barcode = $1 AND kind <> 'opening' LIMIT 1",
            [barcode]
          )
          if (used.rowCount)
            throw conflict(
              'لا يمكن حذف هذا الصنف لأن له حركات مخزون مسجلة (بيع أو استلام أو تسوية). يمكنك جرد كميته إلى صفر بدلاً من حذفه.'
            )
          // Only an opening balance: remove it with the product (administrative rebuild).
          await db.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
          await db.query('DELETE FROM stock_movements WHERE product_barcode = $1', [barcode])
          await db.query("SELECT set_config('hm.ledger_rebuild', 'off', true)")
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
module.exports.registerInventory = function inventoryOperations(app) {
  // Movement history of one product, newest first.
  app.operation({
    name: 'inventory.movements',
    permission: 'products.view',
    schema: {
      type: 'object',
      required: ['barcode'],
      properties: {
        barcode: { type: 'string', minLength: 1, maxLength: 64 },
        limit: { type: 'integer', minimum: 1, maximum: 500 }
      }
    },
    handler: async (ctx, { barcode, limit }) => {
      const rows = (
        await ctx.pool.query(
          `SELECT m.id::int, m.qty, m.kind, m.unit_cost AS cost, m.balance_after, m.ref_type, m.ref_id, m.reason,
                  m.created_at, u.username
             FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
            WHERE m.product_barcode = $1 ORDER BY m.id DESC LIMIT $2`,
          [barcode, limit || 100]
        )
      ).rows
      return maskCost(ctx, rows)
    }
  })

  // Stock count: counted quantity against the stock shown when counting started (base).
  app.operation({
    name: 'inventory.count',
    permission: 'inventory.adjust',
    schema: {
      type: 'object',
      required: ['barcode', 'counted', 'reason'],
      properties: {
        barcode: { type: 'string', minLength: 1, maxLength: 64 },
        counted: { type: 'number' },
        base: { type: ['number', 'null'] },
        reason: { type: 'string', minLength: 2, maxLength: 300 }
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const row = (
          await db.query('SELECT stock_qty FROM products WHERE barcode = $1 FOR UPDATE', [
            b.barcode
          ])
        ).rows[0]
        if (!row) throw notFound('الصنف غير موجود.')
        const before = Number(row.stock_qty) || 0
        const mv = await adjustTo(db, ctx, {
          barcode: b.barcode,
          target: b.counted,
          base: b.base,
          kind: 'count',
          reason: b.reason
        })
        const stock = mv ? mv.balanceAfter : before
        if (mv)
          await ctx.audit(
            db,
            'stock_count',
            `جرد الصنف ${b.barcode}: المعدود ${b.counted}، الرصيد من ${before} إلى ${stock}`,
            { movement: mv.id, reason: b.reason, base: b.base ?? null }
          )
        return { stock, movementId: mv ? mv.id : null }
      })
  })

  // Products with negative stock (sold before their receipt was entered).
  app.operation({
    name: 'inventory.negative',
    permission: 'products.view',
    handler: async (ctx) =>
      (
        await ctx.pool.query(
          `SELECT barcode, name, unit, stock_qty AS stock,
                  (SELECT MAX(created_at) FROM stock_movements m WHERE m.product_barcode = p.barcode AND m.balance_after < 0) AS negative_since
             FROM products p WHERE stock_qty < 0 ORDER BY stock_qty, barcode`
        )
      ).rows
  })

  // Ledger check: every product's stock equals the sum of its movements (empty list = healthy).
  app.operation({
    name: 'inventory.verify',
    permission: 'reports.view',
    handler: async (ctx) => {
      const mismatches = await verifyLedger(ctx.pool)
      return { ok: mismatches.length === 0, mismatches }
    }
  })
}
