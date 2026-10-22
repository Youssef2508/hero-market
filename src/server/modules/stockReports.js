'use strict'
// Stock value, the owner's snapshots and the store-wide stock movements (phase F, D-071).
//
// One rule for the value of stock, used by the report (PROD-02) and the dashboard (DASH-01):
//   * quantities are the product's base unit (stock_qty); packages are never counted apart;
//   * value at cost = stock × current moving-average cost; at selling price = stock × retail price;
//   * negative stock counts as 0 in totals (it is listed and flagged: goods sold before receipt);
//   * a product without a cost (0) adds 0 at cost and is counted as "بدون تكلفة";
//   * stopped (inactive) products are left out unless asked for.
// The movements screen (STOCK-01) reads the same stock_movements rows as each product's history.
const { badRequest } = require('../errors')

const PER_PAGE = 100
const KINDS = [
  'opening',
  'sale',
  'return',
  'purchase',
  'purchase_return',
  'adjustment',
  'count',
  'damaged',
  'damaged_reversal'
]
const STATUS = {
  all: '',
  instock: 'p.stock_qty > 0',
  zero: 'COALESCE(p.stock_qty, 0) = 0',
  negative: 'p.stock_qty < 0',
  nocost: 'COALESCE(p.cost_price, 0) = 0'
}
const ORDER = {
  name: 'p.name',
  barcode: 'p.barcode',
  stock: 'p.stock_qty',
  cost: 'value_cost',
  retail: 'value_retail'
}
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`)
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** WHERE clause and parameters of a valuation filter. */
function filterOf(f) {
  const where = []
  const params = []
  if (!f.includeInactive) where.push('p.is_active IS NOT FALSE')
  if (f.search) {
    params.push(likeEscape(f.search.trim()))
    where.push(
      `(p.name ILIKE '%' || $${params.length} || '%' ESCAPE '\\' OR p.barcode ILIKE '%' || $${params.length} || '%' ESCAPE '\\')`
    )
  }
  if (f.categoryId) {
    params.push(f.categoryId)
    where.push(`p.category_id = $${params.length}`)
  }
  if (f.kind) {
    params.push(f.kind)
    where.push(`p.unit_kind = $${params.length}`)
  }
  if (STATUS[f.status || 'all']) where.push(STATUS[f.status])
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
}

const VALUE_COST = 'GREATEST(COALESCE(p.stock_qty, 0), 0) * COALESCE(p.cost_price, 0)'
const VALUE_RETAIL = 'GREATEST(COALESCE(p.stock_qty, 0), 0) * COALESCE(p.retail_price, 0)'

async function totalsOf(db, where, params) {
  const t = (
    await db.query(
      `SELECT COUNT(*)::int AS products,
              COALESCE(SUM(${VALUE_COST}), 0)::float8 AS cost,
              COALESCE(SUM(${VALUE_RETAIL}), 0)::float8 AS retail,
              COUNT(*) FILTER (WHERE p.stock_qty < 0)::int AS negative,
              COUNT(*) FILTER (WHERE COALESCE(p.cost_price, 0) = 0 AND p.stock_qty > 0)::int AS no_cost
         FROM products p ${where}`,
      params
    )
  ).rows[0]
  return {
    products: t.products,
    cost: r2(t.cost),
    retail: r2(t.retail),
    negative: t.negative,
    noCost: t.no_cost
  }
}

module.exports = function stockReportsModule(app) {
  // PROD-02: every product's stock and value, with totals of the same filter.
  app.operation({
    name: 'inventory.valuation',
    permission: 'reports.valuation',
    schema: {
      type: 'object',
      properties: {
        search: { type: 'string', maxLength: 100 },
        categoryId: { type: ['integer', 'null'] },
        kind: { type: ['string', 'null'], maxLength: 40 },
        status: { type: 'string', enum: Object.keys(STATUS) },
        includeInactive: { type: 'boolean' },
        sort: { type: 'string', enum: Object.keys(ORDER) },
        asc: { type: 'boolean' },
        page: { type: 'integer', minimum: 1 }
      }
    },
    handler: async (ctx, f) => {
      const { where, params } = filterOf(f)
      const page = f.page || 1
      const rows = (
        await ctx.pool.query(
          `SELECT p.barcode, p.name, p.unit, p.unit_kind, COALESCE(c.name, p.category, '') AS category,
                  p.is_active, p.stock_qty::float8 AS stock, p.cost_price::float8 AS cost,
                  p.retail_price::float8 AS retail,
                  (${VALUE_COST})::float8 AS value_cost, (${VALUE_RETAIL})::float8 AS value_retail,
                  u.name AS pack_name, u.factor::float8 AS pack_factor
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN LATERAL (SELECT name, factor FROM product_units x WHERE x.product_barcode = p.barcode AND x.is_active
                                 ORDER BY x.factor DESC, x.id LIMIT 1) u ON true
             ${where}
            ORDER BY ${ORDER[f.sort || 'name']} ${f.asc === false ? 'DESC' : 'ASC'}, p.barcode
            LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`,
          params
        )
      ).rows
      const totals = await totalsOf(ctx.pool, where, params)
      // Reconciliation: stock must equal the sum of its movements (0 = healthy).
      const mismatches = Number(
        (
          await ctx.pool.query(
            `SELECT COUNT(*)::int n FROM products p
               LEFT JOIN (SELECT product_barcode, SUM(qty) s FROM stock_movements GROUP BY 1) m ON m.product_barcode = p.barcode
              WHERE COALESCE(p.stock_qty, 0) <> COALESCE(m.s, 0)`
          )
        ).rows[0].n
      )
      const inactive = Number(
        (await ctx.pool.query('SELECT COUNT(*)::int n FROM products WHERE is_active IS FALSE'))
          .rows[0].n
      )
      return { page, perPage: PER_PAGE, rows, totals, mismatches, inactive }
    }
  })

  // DASH-01: the owner's four figures, live (computed on every request; nothing cached).
  app.operation({
    name: 'dashboard.snapshots',
    permission: 'reports.valuation',
    handler: async (ctx) => {
      const { where, params } = filterOf({})
      const stock = await totalsOf(ctx.pool, where, params)
      const bal = (
        await ctx.pool.query(
          `SELECT (SELECT COALESCE(SUM(debt_balance) FILTER (WHERE debt_balance > 0), 0) FROM suppliers)::float8 AS supplier_owed,
                  (SELECT COALESCE(-SUM(debt_balance) FILTER (WHERE debt_balance < 0), 0) FROM suppliers)::float8 AS supplier_credit,
                  (SELECT COUNT(*) FILTER (WHERE debt_balance > 0) FROM suppliers)::int AS suppliers,
                  (SELECT COALESCE(SUM(debt_balance) FILTER (WHERE debt_balance > 0), 0) FROM clients)::float8 AS customer_owed,
                  (SELECT COALESCE(-SUM(debt_balance) FILTER (WHERE debt_balance < 0), 0) FROM clients)::float8 AS customer_credit,
                  (SELECT COUNT(*) FILTER (WHERE debt_balance > 0) FROM clients)::int AS customers`
        )
      ).rows[0]
      return {
        stockCost: stock.cost,
        stockRetail: stock.retail,
        negative: stock.negative,
        noCost: stock.noCost,
        supplierOwed: r2(bal.supplier_owed),
        supplierCredit: r2(bal.supplier_credit),
        suppliers: bal.suppliers,
        customerOwed: r2(bal.customer_owed),
        customerCredit: r2(bal.customer_credit),
        customers: bal.customers
      }
    }
  })

  // STOCK-01: all stock movements, newest first, from the same table as each product's history.
  app.operation({
    name: 'inventory.allMovements',
    permission: 'products.view',
    schema: {
      type: 'object',
      properties: {
        search: { type: 'string', maxLength: 100 },
        kinds: { type: 'array', maxItems: 20, items: { type: 'string', enum: KINDS } },
        from: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        to: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        page: { type: 'integer', minimum: 1 }
      }
    },
    handler: async (ctx, f) => {
      const where = []
      const params = []
      if (f.search) {
        params.push(likeEscape(f.search.trim()))
        where.push(
          `(p.name ILIKE '%' || $${params.length} || '%' ESCAPE '\\' OR m.product_barcode ILIKE '%' || $${params.length} || '%' ESCAPE '\\')`
        )
      }
      if (f.kinds?.length) {
        params.push(f.kinds)
        where.push(`m.kind = ANY($${params.length}::text[])`)
      }
      if (f.from) {
        params.push(f.from)
        where.push(`m.created_at >= $${params.length}::date`)
      }
      if (f.to) {
        params.push(f.to)
        where.push(`m.created_at < $${params.length}::date + 1`)
      }
      if (f.from && f.to && f.from > f.to) throw badRequest('تاريخ البداية بعد تاريخ النهاية.')
      const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const page = f.page || 1
      const base = `FROM stock_movements m JOIN products p ON p.barcode = m.product_barcode
                    LEFT JOIN users u ON u.id = m.user_id ${w}`
      const total = Number(
        (await ctx.pool.query(`SELECT COUNT(*)::int n ${base}`, params)).rows[0].n
      )
      let rows = (
        await ctx.pool.query(
          `SELECT m.id::int, m.product_barcode AS barcode, p.name, p.unit, m.qty::float8 AS qty, m.kind,
                  m.unit_cost::float8 AS cost, m.balance_after::float8 AS balance_after, m.ref_type,
                  m.ref_id, m.reason, m.created_at, u.username
             ${base} ORDER BY m.id DESC LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`,
          params
        )
      ).rows
      if (!ctx.can('products.view_cost')) rows = rows.map(({ cost: _c, ...r }) => r)
      return { page, perPage: PER_PAGE, total, rows }
    }
  })
}

module.exports.KINDS = KINDS
