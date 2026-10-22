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

/**
 * Invoice discounts earned on purchases (owner, 2026-10-22, D-066): product costs stay at the
 * lines' prices, so the discount is a gain of the purchase's date, less the part a purchase return
 * gives back (a return credits the supplier only the net of its lines). `purchaseCond` and
 * `returnCond` select the period on supplier_purchases.timestamp and the returns' created_at.
 */
const purchaseGainSql = (purchaseCond, returnCond) =>
  `SELECT ((SELECT COALESCE(SUM(discount), 0) FROM supplier_purchases ${purchaseCond})
          - (SELECT COALESCE(SUM(gross_value - credit_value), 0) FROM supplier_purchase_returns ${returnCond}))::float8 AS v`

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

  // The dashboard for any period (owner, 2026-10-21, D-065): today, this week, month, year or a
  // chosen range – inclusive local dates. Every figure is selected by its own record's time
  // (ANALYTICS-01). Sales are what was sold (returns already lower total_amount); customer
  // collections are shown apart and never added to sales; treasury transfers are not revenue.
  // Net profit is the same formula as reports.periodic.
  const DAY = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
  app.operation({
    name: 'reports.dashboard',
    permission: 'reports.view',
    schema: {
      type: 'object',
      required: ['from', 'to'],
      properties: { from: DAY, to: DAY, all: { type: 'boolean' } }
    },
    handler: async (ctx, { from, to, all }) => {
      if (from > to) [from, to] = [to, from]
      const db = ctx.pool
      // "الكل" (D-078) begins at the store's first record, so the charts do not span empty years.
      // A chosen range keeps its own days. The answer says which range was used.
      if (all) {
        const first = (
          await rows(
            db,
            `SELECT to_char(LEAST((SELECT min(timestamp) FROM sales), (SELECT min(timestamp) FROM expenses),
                                   (SELECT min(timestamp) FROM supplier_purchases))::date, 'YYYY-MM-DD') AS d`
          )
        )[0].d
        if (from < (first || to)) from = first && first <= to ? first : to
      }
      const p = [from, to]
      const inRange = (col) => `${col} >= $1::date AND ${col} < $2::date + 1`
      const days = (await rows(db, 'SELECT ($2::date - $1::date + 1) AS n', p))[0].n
      // Daily buckets up to about two months, monthly beyond.
      const unit = days <= 62 ? 'day' : 'month'
      const bucket = (col) =>
        unit === 'day' ? `to_char(${col}, 'YYYY-MM-DD')` : `to_char(${col}, 'YYYY-MM')`
      const one = async (sql) => (await rows(db, sql, p))[0]
      const sales = await one(
        `SELECT COALESCE(SUM(total_amount), 0)::float8 AS total, COUNT(*)::int AS count,
                COALESCE(SUM(total_amount) FILTER (WHERE payment_type IN ('آجل', 'دفع جزئي')), 0)::float8 AS "onAccount"
           FROM sales WHERE ${inRange('timestamp')}`
      )
      const profit = (
        await one(
          `SELECT COALESCE(SUM(${PROFIT}), 0)::float8 AS v FROM sale_items si JOIN sales s ON si.sale_id = s.id
             JOIN products p ON si.product_barcode = p.barcode WHERE ${inRange('s.timestamp')}`
        )
      ).v
      const expenses = (
        await one(
          `SELECT COALESCE(SUM(amount), 0)::float8 AS v FROM expenses WHERE ${inRange('timestamp')}`
        )
      ).v
      const damaged = (
        await one(
          `SELECT COALESCE(SUM(quantity * cost_price), 0)::float8 AS v FROM damaged_goods WHERE ${inRange('timestamp')}`
        )
      ).v
      const purchases = await one(
        `SELECT COALESCE(SUM(total_amount), 0)::float8 AS v, COUNT(*)::int AS n FROM supplier_purchases WHERE ${inRange('timestamp')}`
      )
      const pending = await one(
        `SELECT COALESCE(SUM(total), 0)::float8 AS v, COUNT(*)::int AS n FROM supplier_pending_invoices
          WHERE status = 'pending' AND ${inRange('created_at')}`
      )
      const purchaseGain = (
        await one(
          purchaseGainSql(`WHERE ${inRange('timestamp')}`, `WHERE ${inRange('created_at')}`)
        )
      ).v
      const purchaseReturns = await one(
        `SELECT COALESCE(SUM(credit_value), 0)::float8 AS v, COUNT(*)::int AS n FROM supplier_purchase_returns WHERE ${inRange('created_at')}`
      )
      // Cash flow of the period (from «الأداء والأرباح», merged here, D-078): sales paid at once
      // plus the drawers' other money in, less their money out.
      const cashFlow = (
        await one(
          `SELECT ((SELECT COALESCE(SUM(total_amount), 0) FROM sales
                     WHERE payment_type NOT IN ('آجل', 'دفع جزئي') AND ${inRange('timestamp')})
                 + (SELECT COALESCE(SUM(CASE WHEN type = 'inflow' THEN amount ELSE -amount END), 0)
                      FROM safe_ledger WHERE ${inRange('timestamp')}))::float8 AS v`
        )
      ).v
      const collections = (
        await one(
          `SELECT (SELECT COALESCE(SUM(amount), 0) FROM safe_ledger WHERE kind = 'customer_payment' AND ${inRange('timestamp')})
                + (SELECT COALESCE(SUM(amount), 0) FROM treasury_ledger WHERE kind = 'customer_payment' AND ${inRange('created_at')}) AS v`
        )
      ).v
      const byType = await rows(
        db,
        `SELECT payment_type, COALESCE(SUM(total_amount), 0)::float8 AS total, COUNT(*)::int AS count
           FROM sales WHERE ${inRange('timestamp')} GROUP BY payment_type`,
        p
      )
      const methodOfType = {
        نقدي: 'cash',
        فيزا: 'visa',
        محفظة: 'wallet',
        'فودافون كاش': 'wallet',
        'انستا باي': 'instapay',
        آجل: 'credit',
        'دفع جزئي': 'partial'
      }
      const salesByMethod = {}
      for (const r of byType) {
        const k = methodOfType[r.payment_type] || 'other'
        salesByMethod[k] = {
          total: Math.round(((salesByMethod[k]?.total || 0) + r.total) * 100) / 100,
          count: (salesByMethod[k]?.count || 0) + r.count
        }
      }
      const series = async (sql) =>
        Object.fromEntries((await rows(db, sql, p)).map((r) => [r.k, Number(r.v) || 0]))
      const sSales = await series(
        `SELECT ${bucket('timestamp')} AS k, SUM(total_amount) AS v FROM sales WHERE ${inRange('timestamp')} GROUP BY 1`
      )
      const sExp = await series(
        `SELECT ${bucket('timestamp')} AS k, SUM(amount) AS v FROM expenses WHERE ${inRange('timestamp')} GROUP BY 1`
      )
      const sPur = await series(
        `SELECT ${bucket('timestamp')} AS k, SUM(total_amount) AS v FROM supplier_purchases WHERE ${inRange('timestamp')} GROUP BY 1`
      )
      const keys = (
        await rows(
          db,
          unit === 'day'
            ? `SELECT to_char(d, 'YYYY-MM-DD') AS k FROM generate_series($1::date, $2::date, interval '1 day') d`
            : `SELECT to_char(d, 'YYYY-MM') AS k FROM generate_series(date_trunc('month', $1::date), $2::date, interval '1 month') d`,
          p
        )
      ).map((r) => r.k)
      const top = await rows(
        db,
        `SELECT si.product_barcode AS barcode, MAX(p.name) AS name,
                SUM((si.quantity - COALESCE(si.returned_qty, 0)) * si.unit_factor)::float8 AS qty,
                SUM(si.total_price - si.line_discount - si.cart_discount)::float8 AS revenue
           FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.barcode = si.product_barcode
          WHERE ${inRange('s.timestamp')}
          GROUP BY si.product_barcode ORDER BY revenue DESC LIMIT 10`,
        p
      )
      const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
      return {
        from,
        to,
        unit,
        totals: {
          sales: r2(sales.total),
          invoices: sales.count,
          onAccountSales: r2(sales.onAccount),
          expenses: r2(expenses),
          damaged: r2(damaged),
          purchases: r2(purchases.v),
          purchaseCount: purchases.n,
          pendingPurchases: r2(pending.v),
          pendingCount: pending.n,
          collections: r2(collections),
          purchaseReturns: r2(purchaseReturns.v),
          purchaseReturnCount: purchaseReturns.n,
          purchaseDiscounts: r2(purchaseGain),
          netProfit: r2(Number(profit) - Number(damaged) - Number(expenses) + Number(purchaseGain)),
          cashFlow: r2(cashFlow)
        },
        salesByMethod,
        series: keys.map((k) => ({
          key: k,
          sales: r2(sSales[k]),
          expenses: r2(sExp[k]),
          purchases: r2(sPur[k])
        })),
        topProducts: top.map((t) => ({ ...t, qty: r2(t.qty), revenue: r2(t.revenue) }))
      }
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
      const purchaseGain = (
        await rows(db, purchaseGainSql(since('timestamp'), since('created_at')))
      )[0].v
      // Owed by customers now (a balance, not a period figure).
      const outstanding = (await rows(db, 'SELECT SUM(debt_balance) AS t FROM clients'))[0].t
      const totalSales = Number(s.total) || 0
      const debtSales = Number(s.debt) || 0
      const totalExpenses = Number(expenses) || 0
      return {
        period,
        totalSales,
        netProfit:
          (Number(profit) || 0) -
          (Number(damaged) || 0) -
          totalExpenses +
          (Number(purchaseGain) || 0),
        purchaseDiscounts: Number(purchaseGain) || 0,
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
        purchaseDiscounts: await one(
          purchaseGainSql(`WHERE ${IN('timestamp')}`, `WHERE ${IN('created_at')}`)
        ),
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
