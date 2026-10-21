'use strict'
// Read-only reporting. Each operation returns the same rows the legacy renderer queries produced
// (useAdminController, useBestSellersManager, useAdvancedAnalytics, useCashierPerformance), so the
// hooks keep their own post-processing unchanged. SQLite functions are mapped 1:1:
// DATE(ts) → to_char(ts, 'YYYY-MM-DD'), strftime('%H', ts) → EXTRACT(HOUR …).
// Line net = gross − its discount shares (automatic discounts; 0 on legacy invoices).
const PROFIT = `si.total_price - si.line_discount - si.cart_discount - ((si.quantity - si.returned_qty) * COALESCE(NULLIF(si.cost_price, 0), p.cost_price * si.unit_factor))`
const PROFIT_SAFE = `si.total_price - si.line_discount - si.cart_discount - ((si.quantity - COALESCE(si.returned_qty, 0)) * COALESCE(NULLIF(si.cost_price, 0), COALESCE(p.cost_price, 0) * si.unit_factor))`
const PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30 }
const TS = '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$'
const rangeSchema = {
  type: 'object',
  required: ['from', 'to'],
  properties: { from: { type: 'string', pattern: TS }, to: { type: 'string', pattern: TS } }
}

const rows = async (db, sql, params = []) => (await db.query(sql, params)).rows

/** Shift ids whose start falls on/after the start of the day `days` days ago (legacy "period" rule). */
/**
 * Start of a reporting period, in the store's local time (timestamps are stored as local time).
 * Periods count calendar days including today: today = from 00:00 today; weekly = today and the
 * 6 days before; monthly = today and the 29 days before; all = no start (null).
 * Owner feedback ANALYTICS-01: records are selected by THEIR OWN time (sale, expense, damage,
 * drawer movement), never by the start of the shift they belong to – a shift left open for days
 * used to put all its sales in every period, and "today" used to start yesterday.
 */
function periodStartSql(period) {
  if (period === 'all') return null
  return `(CURRENT_DATE - ${(PERIOD_DAYS[period] || 7) - 1})::timestamp`
}

module.exports = function reportsModule(app) {
  app.operation({
    name: 'dashboard.stats',
    anyPermission: ['pos.sell', 'products.view', 'reports.view'],
    handler: async (ctx) => {
      const total = await rows(ctx.pool, 'SELECT count(*) AS count FROM products')
      const low = await rows(
        ctx.pool,
        'SELECT name, stock_qty, reorder_limit, unit FROM products WHERE stock_qty <= reorder_limit AND reorder_limit > 0 ORDER BY barcode'
      )
      return { totalItems: total[0].count || 0, lowStock: low.length, lowStockItems: low }
    }
  })

  // useAdminController.fetchAnalytics (performance & profit screen, overview KPIs)
  app.operation({
    name: 'reports.periodic',
    permission: 'reports.view',
    schema: {
      type: 'object',
      properties: { period: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'all'] } }
    },
    handler: async (ctx, { period = 'weekly' }) => {
      const db = ctx.pool
      const start = periodStartSql(period)
      const since = (col) => (start ? `WHERE ${col} >= ${start}` : '')
      const s = (
        await rows(
          db,
          `SELECT SUM(total_amount) AS total, COUNT(*) AS count,
                  SUM(CASE WHEN payment_type = 'آجل' THEN total_amount ELSE 0 END) AS debt
           FROM sales ${since('timestamp')}`
        )
      )[0]
      const profit = (
        await rows(
          db,
          `SELECT SUM(${PROFIT}) AS profit FROM sale_items si JOIN sales s ON si.sale_id = s.id
           JOIN products p ON si.product_barcode = p.barcode ${since('s.timestamp')}`
        )
      )[0].profit
      const damaged = (
        await rows(
          db,
          `SELECT SUM(quantity * cost_price) AS t FROM damaged_goods ${since('timestamp')}`
        )
      )[0].t
      const expenses = (
        await rows(db, `SELECT SUM(amount) AS t FROM expenses ${since('timestamp')}`)
      )[0].t
      const safe = (
        await rows(
          db,
          `SELECT SUM(CASE WHEN type = 'inflow' THEN amount ELSE 0 END) AS inflows,
                  SUM(CASE WHEN type = 'outflow' THEN amount ELSE 0 END) AS outflows
           FROM safe_ledger ${since('timestamp')}`
        )
      )[0]
      // Owed by customers now (a balance, not a period figure).
      const outstanding = (await rows(db, 'SELECT SUM(debt_balance) AS t FROM clients'))[0].t
      const totalSales = Number(s.total) || 0
      const debtSales = Number(s.debt) || 0
      const totalExpenses = Number(expenses) || 0
      return {
        period,
        totalSales,
        netProfit: (Number(profit) || 0) - (Number(damaged) || 0) - totalExpenses,
        totalExpenses,
        invoiceCount: Number(s.count) || 0,
        debtSales,
        outstandingDebt: Number(outstanding) || 0,
        netCashFlow:
          totalSales - debtSales + (Number(safe.inflows) || 0) - (Number(safe.outflows) || 0)
      }
    }
  })

  app.operation({
    name: 'reports.shiftsHistory',
    permission: 'shifts.view_all',
    handler: async (ctx) =>
      rows(
        ctx.pool,
        `SELECT s.*, u.username FROM shifts s JOIN users u ON s.user_id = u.id WHERE s.status = 'closed' ORDER BY s.id DESC`
      )
  })

  app.operation({
    name: 'reports.shiftAudits',
    permission: 'shifts.view_all',
    handler: async (ctx) =>
      rows(
        ctx.pool,
        `SELECT a.*, u.username FROM shift_audits a JOIN shifts s ON a.shift_id = s.id JOIN users u ON s.user_id = u.id ORDER BY a.id DESC`
      )
  })

  // useBestSellersManager.fetchBestSellers
  app.operation({
    name: 'reports.bestSellers',
    permission: 'reports.view',
    schema: {
      type: 'object',
      properties: { period: { type: 'string', enum: ['daily', 'weekly', 'monthly'] } }
    },
    handler: async (ctx, { period = 'weekly' }) => {
      const db = ctx.pool
      const start = periodStartSql(period)
      const slowBase = `SELECT p.barcode, p.name, p.unit, p.retail_price AS price, p.cost_price AS cost, p.stock_qty AS stock, p.reorder_limit AS reorder_limit
                        FROM products p WHERE p.stock_qty > 0`
      const top = await rows(
        db,
        `SELECT si.product_barcode AS barcode, p.name AS name, p.unit AS unit, p.retail_price AS price, p.cost_price AS cost,
                p.stock_qty AS stock, SUM((si.quantity - si.returned_qty) * si.unit_factor) AS total_qty_sold, SUM(si.total_price - si.line_discount - si.cart_discount) AS total_revenue,
                COUNT(DISTINCT CASE WHEN (si.quantity - si.returned_qty) > 0 THEN si.sale_id END) AS times_ordered
         FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_barcode = p.barcode
         WHERE s.timestamp >= ${start}
         GROUP BY si.product_barcode, p.barcode
         HAVING SUM((si.quantity - si.returned_qty) * si.unit_factor) > 0
         ORDER BY total_qty_sold DESC, si.product_barcode LIMIT 30`
      )
      const slow = await rows(
        db,
        `${slowBase} AND p.barcode NOT IN (
           SELECT DISTINCT si.product_barcode FROM sale_items si JOIN sales s ON si.sale_id = s.id
           WHERE s.timestamp >= ${start} AND (si.quantity - si.returned_qty) > 0)
         ORDER BY p.stock_qty DESC, p.barcode LIMIT 50`
      )
      return { top, slow }
    }
  })

  // useAdvancedAnalytics.runAnalysis – raw rows; the hook computes the summary as before.
  app.operation({
    name: 'reports.advanced',
    permission: 'reports.view',
    schema: rangeSchema,
    handler: async (ctx, { from, to }) => {
      const db = ctx.pool
      const shifts = await rows(
        db,
        `SELECT s.id, s.start_time, s.end_time, s.initial_cash, s.expected_end_cash, s.actual_end_cash, s.difference, s.status, u.username
         FROM shifts s JOIN users u ON s.user_id = u.id
         WHERE s.start_time <= $2::timestamp AND COALESCE(s.end_time, LOCALTIMESTAMP) >= $1::timestamp
         ORDER BY s.id ASC`,
        [from, to]
      )
      if (!shifts.length) return { shifts: [] }
      // ANALYTICS-01: sales, expenses, damage and drawer movements are those dated in the range
      // (a shift overlapping the range contributes only its records inside it).
      const ids = [from, to]
      const one = async (sql) => (await rows(db, sql, ids))[0]
      const IN = (col) => `${col} BETWEEN $1::timestamp AND $2::timestamp`
      return {
        shifts,
        salesSum:
          await one(`SELECT SUM(total_amount) AS total, COUNT(*) AS count, AVG(total_amount) AS avg_amount, MAX(total_amount) AS max_amount,
                                    SUM(CASE WHEN payment_type = 'آجل' THEN total_amount ELSE 0 END) AS debt,
                                    SUM(CASE WHEN payment_type != 'آجل' THEN total_amount ELSE 0 END) AS cash
                             FROM sales WHERE ${IN('timestamp')}`),
        profit:
          await one(`SELECT SUM(${PROFIT}) AS profit FROM sale_items si JOIN sales s ON si.sale_id = s.id
                           JOIN products p ON si.product_barcode = p.barcode WHERE ${IN('s.timestamp')}`),
        damaged: await one(
          `SELECT SUM(quantity * cost_price) AS total_cost FROM damaged_goods WHERE ${IN('timestamp')}`
        ),
        expenses: await one(`SELECT SUM(amount) AS total FROM expenses WHERE ${IN('timestamp')}`),
        returns:
          await one(`SELECT SUM(CASE WHEN type = 'outflow' AND description LIKE 'مرتجع%' THEN amount ELSE 0 END) AS returns_total,
                                   COUNT(CASE WHEN type = 'outflow' AND description LIKE 'مرتجع%' THEN 1 END) AS returns_count
                            FROM safe_ledger WHERE ${IN('timestamp')}`),
        safe: await one(`SELECT SUM(CASE WHEN type = 'inflow' THEN amount ELSE 0 END) AS inflows,
                                SUM(CASE WHEN type = 'outflow' THEN amount ELSE 0 END) AS outflows
                         FROM safe_ledger WHERE ${IN('timestamp')}`),
        perShiftSales: await rows(
          db,
          `SELECT shift_id, SUM(total_amount) AS sales, COUNT(*) AS invoices, SUM(CASE WHEN payment_type = 'آجل' THEN total_amount ELSE 0 END) AS debt
           FROM sales WHERE ${IN('timestamp')} GROUP BY shift_id`,
          ids
        ),
        perShiftProfit: await rows(
          db,
          `SELECT s.shift_id, SUM(${PROFIT}) AS profit FROM sale_items si JOIN sales s ON si.sale_id = s.id
           JOIN products p ON si.product_barcode = p.barcode WHERE ${IN('s.timestamp')} GROUP BY s.shift_id`,
          ids
        ),
        perShiftExpenses: await rows(
          db,
          `SELECT shift_id, SUM(amount) AS expenses FROM expenses WHERE ${IN('timestamp')} GROUP BY shift_id`,
          ids
        ),
        hourly: await rows(
          db,
          `SELECT EXTRACT(HOUR FROM timestamp)::int AS hour, COUNT(*) AS invoice_count, SUM(total_amount) AS total_sales, AVG(total_amount) AS avg_sale
           FROM sales WHERE ${IN('timestamp')} GROUP BY 1 ORDER BY 1 ASC`,
          ids
        ),
        daily: await rows(
          db,
          `SELECT to_char(timestamp, 'YYYY-MM-DD') AS day, COUNT(*) AS invoice_count, SUM(total_amount) AS total_sales
           FROM sales WHERE ${IN('timestamp')} GROUP BY 1 ORDER BY 1 ASC`,
          ids
        ),
        top: await rows(
          db,
          `SELECT si.product_barcode, p.name AS product_name, SUM((si.quantity - si.returned_qty) * si.unit_factor) AS qty_sold, SUM(si.total_price - si.line_discount - si.cart_discount) AS revenue,
                  SUM(${PROFIT}) AS profit
           FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_barcode = p.barcode
           WHERE ${IN('s.timestamp')} GROUP BY si.product_barcode, p.barcode ORDER BY qty_sold DESC, si.product_barcode LIMIT 10`,
          ids
        ),
        payments: await rows(
          db,
          `SELECT payment_type, COUNT(*) AS count, SUM(total_amount) AS total FROM sales WHERE ${IN('timestamp')} GROUP BY payment_type ORDER BY payment_type`,
          ids
        )
      }
    }
  })

  // useCashierPerformance.runAnalysis – raw rows
  app.operation({
    name: 'reports.cashierPerformance',
    permission: 'reports.view',
    schema: rangeSchema,
    handler: async (ctx, { from, to }) => {
      const db = ctx.pool
      const shifts = await rows(
        db,
        `SELECT s.id AS shift_id, s.user_id, s.difference, s.start_time, s.end_time, s.initial_cash, s.actual_end_cash, s.expected_end_cash, u.username
         FROM shifts s JOIN users u ON s.user_id = u.id
         WHERE s.start_time >= $1::timestamp AND s.start_time <= $2::timestamp ORDER BY s.id ASC`,
        [from, to]
      )
      if (!shifts.length) return { shifts: [], sales: [], profit: [], expenses: [] }
      const ids = [shifts.map((s) => s.shift_id)]
      return {
        shifts,
        sales: await rows(
          db,
          `SELECT shift_id, COUNT(*) AS invoices, SUM(total_amount) AS sales, AVG(total_amount) AS avg_invoice, MAX(total_amount) AS max_invoice,
                  SUM(CASE WHEN payment_type = 'آجل' THEN total_amount ELSE 0 END) AS debt_sales
           FROM sales WHERE shift_id = ANY($1::int[]) GROUP BY shift_id`,
          ids
        ),
        profit: await rows(
          db,
          `SELECT s.shift_id, SUM(${PROFIT_SAFE}) AS profit, SUM(COALESCE(si.returned_qty, 0) * si.unit_factor) AS returned_qty,
                  SUM(CASE WHEN COALESCE(si.returned_qty, 0) > 0 THEN 1 ELSE 0 END) AS return_count
           FROM sale_items si JOIN sales s ON si.sale_id = s.id LEFT JOIN products p ON si.product_barcode = p.barcode
           WHERE s.shift_id = ANY($1::int[]) GROUP BY s.shift_id`,
          ids
        ),
        expenses: await rows(
          db,
          `SELECT shift_id, SUM(amount) AS expenses FROM expenses WHERE shift_id = ANY($1::int[]) GROUP BY shift_id`,
          ids
        )
      }
    }
  })

  app.operation({
    name: 'reports.cashierDrilldown',
    permission: 'reports.view',
    schema: {
      ...rangeSchema,
      required: ['userId', 'from', 'to'],
      properties: { ...rangeSchema.properties, userId: { type: 'integer' } }
    },
    handler: async (ctx, { userId, from, to }) => {
      const db = ctx.pool
      const shifts = await rows(
        db,
        `SELECT id AS shift_id, start_time, end_time, difference, status FROM shifts
         WHERE user_id = $1 AND start_time >= $2::timestamp AND start_time <= $3::timestamp ORDER BY id ASC`,
        [userId, from, to]
      )
      if (!shifts.length) return { shifts: [] }
      const ids = [shifts.map((s) => s.shift_id)]
      return {
        shifts,
        shiftSales: await rows(
          db,
          `SELECT shift_id, COUNT(*) AS invoices, SUM(total_amount) AS sales FROM sales WHERE shift_id = ANY($1::int[]) GROUP BY shift_id`,
          ids
        ),
        shiftProfit: await rows(
          db,
          `SELECT s.shift_id, SUM(${PROFIT_SAFE}) AS profit FROM sale_items si JOIN sales s ON si.sale_id = s.id
           LEFT JOIN products p ON si.product_barcode = p.barcode WHERE s.shift_id = ANY($1::int[]) GROUP BY s.shift_id`,
          ids
        ),
        daily: await rows(
          db,
          `SELECT to_char(timestamp, 'YYYY-MM-DD') AS day, SUM(total_amount) AS sales, COUNT(*) AS invoices
           FROM sales WHERE shift_id = ANY($1::int[]) GROUP BY 1 ORDER BY 1 ASC`,
          ids
        ),
        // K-25: the legacy query read a non-existent sale_items.product_name; the name comes from products.
        topProducts: await rows(
          db,
          `SELECT p.name AS product_name, SUM((si.quantity - COALESCE(si.returned_qty, 0)) * si.unit_factor) AS qty, SUM(si.total_price - si.line_discount - si.cart_discount) AS revenue
           FROM sale_items si JOIN sales s ON si.sale_id = s.id LEFT JOIN products p ON si.product_barcode = p.barcode
           WHERE s.shift_id = ANY($1::int[]) GROUP BY si.product_barcode, p.name ORDER BY qty DESC, si.product_barcode LIMIT 5`,
          ids
        ),
        peakHours: await rows(
          db,
          `SELECT EXTRACT(HOUR FROM timestamp)::int AS hour, COUNT(*) AS invoices, SUM(total_amount) AS sales
           FROM sales WHERE shift_id = ANY($1::int[]) GROUP BY 1 ORDER BY 1 ASC`,
          ids
        ),
        payment: await rows(
          db,
          `SELECT payment_type, COUNT(*) AS count, SUM(total_amount) AS total FROM sales WHERE shift_id = ANY($1::int[]) GROUP BY payment_type ORDER BY payment_type`,
          ids
        )
      }
    }
  })
}
