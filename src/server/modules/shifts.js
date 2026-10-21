'use strict'
// Shifts: open, hourly drawer audit, closing figures, close.
// One drawer formula (drawerFigures, K-24 option 1) serves the hourly audit, the saved close figure,
// the printed report and both close dialogs:
//   opening cash + cash sales as sold + cash inflows − every cash outflow (returns, suppliers, expenses).
// Returns reduce a sale's total_amount AND add an outflow, so sales are counted as sold (SALE_VALUE)
// and the refund is counted once, as the outflow – also for sales from earlier shifts.
// 1.5.0 (owner feedback phase D, .docs/FINANCIAL_RECONCILIATION.md): the same formula per payment
// method (methodFigures), the opening float comes from the treasury and the counted cash goes back
// to it, the close is blind for users without shifts.view_expected and is saved as a snapshot.
const { forbidden, notFound, conflict } = require('../errors')
const { authorize, approverSchema } = require('../auth/approvals')
const { METHODS, LABELS, TYPES, variance, varianceLabel, round2 } = require('../money/methods')
const treasury = require('../money/treasury')

// Owner decision 2026-10-14: closing with a cash difference above EGP 50 (over or short) needs a
// supervisor's acknowledgement. A difference of exactly 50.00 does not.
const DIFFERENCE_LIMIT = 50

const SALE_VALUE = 'COALESCE(NULLIF(original_amount, 0) - discount, total_amount)'

async function loadShift(db, ctx, shiftId, { own = true, lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM shifts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [shiftId]
  )
  const shift = rows[0]
  if (!shift) throw notFound('الوردية غير موجودة.')
  if (own && shift.user_id !== ctx.user.id && !ctx.can('shifts.view_all')) throw forbidden()
  return shift
}

/** Expected amounts are owner-only until the close is confirmed (PAY-01). */
function requireExpected(ctx) {
  if (!ctx.can('shifts.view_expected'))
    throw forbidden('المبالغ المتوقعة تظهر بعد تأكيد إغلاق الوردية فقط.')
}

/** Expected drawer cash and its parts (K-24). Every cash outflow falls in exactly one category. */
async function drawerFigures(db, shift) {
  const { rows } = await db.query(
    `WITH o AS (
       SELECT amount, COALESCE(description, '') AS d FROM safe_ledger
        WHERE shift_id = $1 AND type = 'outflow' AND method = 'cash'
     )
     SELECT
       COALESCE((SELECT SUM(${SALE_VALUE}) FROM sales WHERE shift_id = $1 AND payment_type = 'نقدي'), 0)::float8 AS "cashSales",
       COALESCE((SELECT SUM(${SALE_VALUE}) FROM sales WHERE shift_id = $1 AND payment_type <> 'نقدي'), 0)::float8 AS "nonCashSales",
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'inflow' AND method = 'cash'), 0)::float8 AS "inflow",
       COALESCE((SELECT SUM(amount) FROM o WHERE d LIKE 'مرتجع%'), 0)::float8 AS "returns",
       COALESCE((SELECT SUM(amount) FROM o WHERE d LIKE 'دفعة لمورد%' OR d LIKE 'سداد دين مورد%'), 0)::float8 AS "supplier",
       COALESCE((SELECT SUM(amount) FROM o WHERE d NOT LIKE 'مرتجع%' AND d NOT LIKE 'دفعة لمورد%' AND d NOT LIKE 'سداد دين مورد%'), 0)::float8 AS "expenses"`,
    [shift.id]
  )
  const r = rows[0]
  const initialCash = Number(shift.initial_cash) || 0
  const outflow = r.returns + r.supplier + r.expenses
  return {
    expected: round2(initialCash + r.cashSales + r.inflow - outflow),
    initialCash,
    cashSales: r.cashSales,
    nonCashSales: r.nonCashSales,
    inflow: r.inflow,
    outflow,
    returns: r.returns,
    supplier: r.supplier,
    expenses: r.expenses
  }
}

/**
 * Expected amount per payment method (FINANCIAL_RECONCILIATION.md §3). Cash is drawerFigures;
 * cashless = its sales as sold + its inflows − its outflows (refunds of cashless sales).
 */
async function methodFigures(db, shift) {
  const cash = await drawerFigures(db, shift)
  const out = {
    cash: {
      sales: cash.cashSales,
      inflow: cash.inflow,
      outflow: cash.outflow,
      opening: cash.initialCash,
      expected: cash.expected
    }
  }
  for (const m of METHODS.filter((x) => x !== 'cash')) {
    const r = (
      await db.query(
        `SELECT
           COALESCE((SELECT SUM(${SALE_VALUE}) FROM sales WHERE shift_id = $1 AND payment_type = ANY($2::text[])), 0)::float8 AS sales,
           COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'inflow' AND method = $3), 0)::float8 AS inflow,
           COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND method = $3), 0)::float8 AS outflow`,
        [shift.id, TYPES[m], m]
      )
    ).rows[0]
    out[m] = { ...r, opening: 0, expected: round2(r.sales + r.inflow - r.outflow) }
  }
  return { methods: out, drawer: cash }
}

/** Figures for the hourly drawer audit (same formula as the close). */
async function auditFigures(db, shift) {
  const f = await drawerFigures(db, shift)
  return {
    expected: f.expected,
    breakdown: {
      grossSales: f.cashSales + f.nonCashSales,
      debtSales: f.nonCashSales,
      refunds: f.outflow,
      repay: f.inflow,
      initialCash: f.initialCash
    }
  }
}

/** Expected drawer cash saved on close. */
const closeFigures = drawerFigures

/** Live figures for the close dialogs: the drawer figure plus the Momkn and wallet sections. */
async function liveDetails(db, shift) {
  const { rows } = await db.query(
    `SELECT
       COALESCE((SELECT SUM(total_amount) FROM sales WHERE shift_id = $1), 0) AS all_sales,
       COALESCE((SELECT SUM(total_amount) FROM sales WHERE shift_id = $1 AND payment_type = 'آجل'), 0) AS debt_sales,
       COALESCE((SELECT SUM(total_amount) FROM sales WHERE shift_id = $1 AND payment_type NOT IN ('نقدي', 'آجل')), 0) AS digital_sales,
       COALESCE((SELECT SUM(total_amount) FROM sales WHERE shift_id = $1 AND payment_type = 'نقدي'), 0) AS cash_sales,
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'inflow' AND method = 'cash'), 0) AS inflow,
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND method = 'cash'), 0) AS outflow,
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND method = 'cash' AND description LIKE 'مرتجع%'), 0) AS returns_outflow,
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND method = 'cash' AND (description LIKE 'دفعة لمورد%' OR description LIKE 'سداد دين مورد%')), 0) AS supplier_outflow,
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND method = 'cash' AND (description NOT LIKE 'مرتجع%' AND description NOT LIKE 'دفعة لمورد%' AND description NOT LIKE 'سداد دين مورد%')), 0) AS general_outflow,
       COALESCE((SELECT SUM(digital_impact) FROM momkn_transactions WHERE shift_id = $1), 0) AS momkn_digital_impact,
       COALESCE((SELECT SUM(cash_impact) FROM momkn_transactions WHERE shift_id = $1), 0) AS momkn_cash_impact,
       COALESCE((SELECT SUM(commission) FROM momkn_transactions WHERE shift_id = $1), 0) AS momkn_commission,
       COALESCE((SELECT SUM(digital_impact) FROM mobile_money_transactions WHERE shift_id = $1), 0) AS mm_digital_impact,
       COALESCE((SELECT SUM(cash_impact) FROM mobile_money_transactions WHERE shift_id = $1), 0) AS mm_cash_impact,
       COALESCE((SELECT SUM(commission) FROM mobile_money_transactions WHERE shift_id = $1), 0) AS mm_commission,
       COALESCE((SELECT SUM(digital_impact) FROM mobile_money_transactions WHERE shift_id = $1 AND platform = 'vodafone_cash'), 0) AS vfcash_digital_impact,
       COALESCE((SELECT SUM(digital_impact) FROM mobile_money_transactions WHERE shift_id = $1 AND platform = 'instapay'), 0) AS instapay_digital_impact,
       COALESCE((SELECT SUM(digital_impact) FROM mobile_money_transactions WHERE shift_id = $1 AND platform = 'bank_transfer'), 0) AS bank_digital_impact`,
    [shift.id]
  )
  // drawer: the figure both dialogs show, identical to what shifts.close saves and prints.
  const { methods, drawer } = await methodFigures(db, shift)
  return {
    initial_cash: Number(shift.initial_cash) || 0,
    ...rows[0],
    manualDiscounts: await manualDiscounts(db, shift),
    methods,
    drawer
  }
}

/** Manual invoice discounts of the shift (D-057): count, total and the invoices, with who and why. */
async function manualDiscounts(db, shift) {
  const manual = (
    await db.query(
      `SELECT s.id AS "saleId", d.amount::float AS amount, d.reason, u.username, d.created_at AS "at"
         FROM sale_discounts d JOIN sales s ON s.id = d.sale_id LEFT JOIN users u ON u.id = d.user_id
        WHERE s.shift_id = $1 AND d.scope = 'manual' ORDER BY s.id`,
      [shift.id]
    )
  ).rows
  return {
    count: manual.length,
    total: round2(manual.reduce((s, m) => s + m.amount, 0)),
    invoices: manual
  }
}

/**
 * The shift report (SHIFT-02): every figure the close receipt prints, from the persisted records.
 * With `actual`, it is the close report (expected, actual and variance per method).
 */
async function shiftReport(
  db,
  shift,
  { actual = null, closedAt = null, note = null, acknowledgedBy = null } = {}
) {
  const { methods, drawer } = await methodFigures(db, shift)
  const q = async (sql) => (await db.query(sql, [shift.id])).rows
  const cashier = (await db.query('SELECT username FROM users WHERE id = $1', [shift.user_id]))
    .rows[0]
  const totals = (
    await q(
      `SELECT COUNT(*)::int AS invoices, COALESCE(SUM(${SALE_VALUE}), 0)::float8 AS sales,
              COALESCE(SUM(${SALE_VALUE}) FILTER (WHERE payment_type IN ('آجل', 'دفع جزئي')), 0)::float8 AS "onAccount"
         FROM sales WHERE shift_id = $1`
    )
  )[0]
  const expenses = await q(
    `SELECT id, amount::float8 AS amount, category, description, timestamp AS at
       FROM expenses WHERE shift_id = $1 ORDER BY id`
  )
  const returns = await q(
    `SELECT r.id, r.sale_id AS "saleId", r.refund::float8 AS refund, r.reason, r.username, r.created_at AS at
       FROM sale_returns r WHERE r.shift_id = $1 ORDER BY r.id`
  )
  const report = {
    shiftId: shift.id,
    cashier: cashier?.username || '',
    openedAt: shift.start_time,
    closedAt: closedAt || shift.end_time || null,
    openingFloat: drawer.initialCash,
    invoiceCount: totals.invoices,
    totalSales: round2(totals.sales),
    onAccountSales: round2(totals.onAccount),
    salesByMethod: Object.fromEntries(METHODS.map((m) => [m, round2(methods[m].sales)])),
    cash: {
      sales: drawer.cashSales,
      inflow: drawer.inflow,
      expenses: drawer.expenses,
      refunds: drawer.returns,
      supplier: drawer.supplier
    },
    expenses: {
      count: expenses.length,
      total: round2(expenses.reduce((s, e) => s + e.amount, 0)),
      lines: expenses
    },
    returns: {
      count: returns.length,
      total: round2(returns.reduce((s, r) => s + r.refund, 0)),
      lines: returns
    },
    manualDiscounts: await manualDiscounts(db, shift),
    expected: Object.fromEntries(METHODS.map((m) => [m, methods[m].expected])),
    labels: LABELS,
    note: note || null,
    acknowledgedBy
  }
  if (actual) {
    report.actual = Object.fromEntries(METHODS.map((m) => [m, round2(actual[m] || 0)]))
    report.variance = Object.fromEntries(
      METHODS.map((m) => [m, variance(report.actual[m], report.expected[m])])
    )
    report.varianceLabels = Object.fromEntries(
      METHODS.map((m) => [m, varianceLabel(report.variance[m])])
    )
    report.netTotal = round2(METHODS.reduce((s, m) => s + report.actual[m], 0))
  }
  return { report, methods, drawer }
}

const money = { type: 'number', minimum: 0 }

module.exports = function shiftsModule(app) {
  app.operation({
    name: 'shifts.current',
    permission: 'shifts.operate',
    handler: async (ctx) => {
      const { rows } = await ctx.pool.query(
        "SELECT * FROM shifts WHERE user_id = $1 AND status = 'open' ORDER BY id LIMIT 1",
        [ctx.user.id]
      )
      return rows[0] || null
    }
  })

  app.operation({
    name: 'shifts.open',
    permission: 'shifts.operate',
    schema: {
      type: 'object',
      required: ['startingCash'],
      properties: {
        startingCash: money,
        momknStartBalance: money,
        momknStartCash: money,
        vfcashStartBalance: money,
        vfcashStartCash: money
      }
    },
    handler: async (ctx, b) => {
      const extra = [
        'momknStartBalance',
        'momknStartCash',
        'vfcashStartBalance',
        'vfcashStartCash'
      ].map((k) => Number(b[k] || 0))
      if (extra.some((v) => v !== 0) && !ctx.can('shifts.multi_till'))
        throw forbidden('إدخال أرصدة مكن والمحافظ يتطلب صلاحية الإدارة.')
      return ctx.tx(async (db) => {
        const start = Number(b.startingCash)
        const { rows } = await db.query(
          `INSERT INTO shifts (user_id, start_time, initial_cash, expected_end_cash, actual_end_cash, status,
                               momkn_start_balance, momkn_start_cash, vfcash_start_balance, vfcash_start_cash)
           VALUES ($1, LOCALTIMESTAMP(0), $2, $2, 0, 'open', $3, $4, $5, $6) RETURNING *`,
          [ctx.user.id, start, ...extra]
        )
        // CASH-01: the float leaves the treasury once, with the shift (one transaction).
        await treasury.post(db, ctx, {
          kind: 'opening_float',
          amount: -start,
          shiftId: rows[0].id,
          refType: 'shift',
          refId: rows[0].id,
          description: `عهدة افتتاح الوردية #${rows[0].id}`,
          idemKey: `shift-open:${rows[0].id}`
        })
        await ctx.audit(db, 'shift_open', `فتح وردية جديدة بمبلغ بداية ${start.toFixed(2)} ج.م`)
        return rows[0]
      })
    }
  })

  app.operation({
    name: 'shifts.auditPreview',
    permission: 'shifts.operate',
    schema: { type: 'object', required: ['shiftId'], properties: { shiftId: { type: 'integer' } } },
    handler: async (ctx, { shiftId }) => {
      requireExpected(ctx)
      return auditFigures(ctx.pool, await loadShift(ctx.pool, ctx, shiftId))
    }
  })

  app.operation({
    name: 'shifts.audit',
    permission: 'shifts.operate',
    schema: {
      type: 'object',
      required: ['shiftId', 'actualCash'],
      properties: {
        shiftId: { type: 'integer' },
        actualCash: money,
        notes: { type: 'string', maxLength: 2000 }
      }
    },
    handler: async (ctx, { shiftId, actualCash, notes }) =>
      ctx.tx(async (db) => {
        const shift = await loadShift(db, ctx, shiftId)
        if (shift.status !== 'open') throw conflict('الوردية مغلقة.')
        const { expected } = await auditFigures(db, shift)
        const difference = actualCash - expected
        const { rows } = await db.query(
          `INSERT INTO shift_audits (shift_id, timestamp, expected_cash, actual_cash, difference, notes)
           VALUES ($1, LOCALTIMESTAMP(0), $2, $3, $4, $5) RETURNING id`,
          [shift.id, expected, actualCash, difference, notes || '']
        )
        // Blind count: the cashier is told it was saved, never the expected amount (PAY-01).
        if (!ctx.can('shifts.view_expected')) return { id: rows[0].id }
        return { id: rows[0].id, expected, difference }
      })
  })

  app.operation({
    name: 'shifts.auditNote',
    permission: 'shifts.operate',
    schema: {
      type: 'object',
      required: ['auditId', 'notes'],
      properties: { auditId: { type: 'integer' }, notes: { type: 'string', maxLength: 2000 } }
    },
    handler: async (ctx, { auditId, notes }) =>
      ctx.tx(async (db) => {
        const { rows } = await db.query('SELECT shift_id FROM shift_audits WHERE id = $1', [
          auditId
        ])
        if (!rows.length) throw notFound()
        await loadShift(db, ctx, rows[0].shift_id)
        await db.query('UPDATE shift_audits SET notes = $1 WHERE id = $2', [notes, auditId])
      })
  })

  app.operation({
    name: 'shifts.liveSummary',
    permission: 'shifts.operate',
    schema: { type: 'object', required: ['shiftId'], properties: { shiftId: { type: 'integer' } } },
    handler: async (ctx, { shiftId }) => {
      requireExpected(ctx)
      return liveDetails(ctx.pool, await loadShift(ctx.pool, ctx, shiftId))
    }
  })

  // SHIFT-01: the open shifts, for the shifts screen (their figures come from shifts.details).
  app.operation({
    name: 'shifts.openList',
    permission: 'shifts.view_all',
    handler: async (ctx) =>
      (
        await ctx.pool.query(
          `SELECT s.id, s.user_id, s.start_time, s.initial_cash, u.username,
                  (SELECT COUNT(*)::int FROM sales WHERE shift_id = s.id) AS invoices
             FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.status = 'open' ORDER BY s.id`
        )
      ).rows
  })

  // SHIFT-01: the full details of any shift for the owner. An open shift is computed live from the
  // records; a closed one is its saved close (older closes, before 1.5.0, are computed again).
  app.operation({
    name: 'shifts.details',
    permission: 'shifts.view_all',
    schema: { type: 'object', required: ['shiftId'], properties: { shiftId: { type: 'integer' } } },
    handler: async (ctx, { shiftId }) => {
      const shift = await loadShift(ctx.pool, ctx, shiftId)
      const saved = (
        await ctx.pool.query('SELECT report FROM shift_closings WHERE shift_id = $1', [shift.id])
      ).rows[0]
      if (saved) return { shift, report: saved.report, saved: true }
      if (shift.status === 'open') requireExpected(ctx)
      const { report } = await shiftReport(ctx.pool, shift)
      return { shift, report, saved: false }
    }
  })

  // SHIFT-02: reprint the saved close report, exactly as confirmed (the cashier's own, or any for
  // shifts.view_all). Closes before 1.5.0 have no snapshot.
  app.operation({
    name: 'shifts.closeReport',
    permission: 'shifts.operate',
    schema: { type: 'object', required: ['shiftId'], properties: { shiftId: { type: 'integer' } } },
    handler: async (ctx, { shiftId }) => {
      const shift = await loadShift(ctx.pool, ctx, shiftId)
      const saved = (
        await ctx.pool.query('SELECT report FROM shift_closings WHERE shift_id = $1', [shift.id])
      ).rows[0]
      if (!saved) throw notFound('لا يوجد تقرير إغلاق محفوظ لهذه الوردية.')
      return { shift, report: saved.report }
    }
  })

  app.operation({
    name: 'shifts.close',
    permission: 'shifts.operate',
    schema: {
      type: 'object',
      required: ['shiftId', 'actualCash'],
      properties: {
        shiftId: { type: 'integer' },
        actualCash: money,
        // Counted cashless amounts (PAY-01). Missing means 0 (terminals before 1.5.0 sent cash only).
        actual: {
          type: 'object',
          properties: { visa: money, wallet: money, instapay: money },
          additionalProperties: false
        },
        // Same request id on a retry: the saved close is returned, nothing is posted twice.
        clientRef: { type: 'string', minLength: 8, maxLength: 120 },
        // Explanation of a large difference (optional), and the supervisor acknowledging it.
        note: { type: 'string', maxLength: 300 },
        approver: approverSchema
      }
    },
    handler: async (ctx, { shiftId, actualCash, actual = {}, clientRef, note, approver }) =>
      ctx.tx(async (db) => {
        // Lock first: money movements wait for the close, then find the shift closed (0011).
        const shift = await loadShift(db, ctx, shiftId, { lock: true })
        if (shift.status !== 'open') {
          const saved = clientRef
            ? (
                await db.query(
                  'SELECT * FROM shift_closings WHERE shift_id = $1 AND client_ref = $2',
                  [shift.id, clientRef]
                )
              ).rows[0]
            : null
          if (!saved) throw conflict('الوردية مغلقة بالفعل.')
          return closeResult(db, shift, saved, { duplicate: true })
        }
        const counted = {
          cash: actualCash,
          visa: actual.visa || 0,
          wallet: actual.wallet || 0,
          instapay: actual.instapay || 0
        }
        const f = await closeFigures(db, shift)
        const difference = actualCash - f.expected
        let approval = { approvalId: null, approver: null }
        if (Math.abs(round2(difference)) > DIFFERENCE_LIMIT) {
          const blind = !ctx.can('shifts.view_expected')
          if (blind && !approver) {
            // Every refused attempt is logged with what was counted, so recounting until the figure
            // matches is visible to the owner. The cashier is not told the expected amount.
            await ctx.audit(
              ctx.pool,
              'shift_close_attempt',
              `محاولة إغلاق الوردية #${shift.id} بفرق يحتاج اعتماد المشرف (الفعلي ${actualCash.toFixed(2)} ج.م)`,
              { shiftId: shift.id, counted, expected: f.expected, difference: round2(difference) }
            )
          }
          // Supervisors acknowledge their own shifts (recorded as such); others need a supervisor.
          approval = await authorize(ctx, db, {
            action: 'shift_difference',
            selfAllowed: ctx.can('pos.approve'),
            recordSelf: true,
            approverPermissions: ['pos.approve'],
            subjectType: 'shift',
            subjectId: shift.id,
            amount: round2(difference),
            reason: note,
            approver,
            // Blind: neither the difference nor the expected amount goes back to the cashier.
            details: blind
              ? { blind: true, amount: null }
              : { expected: f.expected, actual: actualCash, difference: round2(difference) }
          })
        }
        const closedAt = (await db.query('SELECT LOCALTIMESTAMP(0) AS t')).rows[0].t
        const { report } = await shiftReport(db, shift, {
          actual: counted,
          closedAt,
          note,
          acknowledgedBy: approval.approvalId ? approval.approver : null
        })
        // CASH-01: the counted cash goes to the treasury once (a transfer, not income).
        const entry = await treasury.post(db, ctx, {
          kind: 'shift_close',
          amount: actualCash,
          shiftId: shift.id,
          refType: 'shift',
          refId: shift.id,
          description: `توريد نقدية إغلاق الوردية #${shift.id}`,
          idemKey: `shift-close:${shift.id}`
        })
        await db.query(
          `INSERT INTO shift_closings (shift_id, closed_at, closed_by, client_ref, expected, actual, variance, report, treasury_entry_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            shift.id,
            closedAt,
            ctx.user.id,
            clientRef || null,
            JSON.stringify(report.expected),
            JSON.stringify(report.actual),
            JSON.stringify(report.variance),
            JSON.stringify(report),
            entry ? entry.id : null
          ]
        )
        await db.query(
          `UPDATE shifts SET end_time = $5, expected_end_cash = $1, actual_end_cash = $2, difference = $3, status = 'closed',
                  difference_approval_id = $6
           WHERE id = $4`,
          [f.expected, actualCash, difference, shift.id, closedAt, approval.approvalId]
        )
        await ctx.audit(
          db,
          'shift_close',
          `إغلاق الوردية رقم #${shift.id} (الفعلي: ${actualCash.toFixed(2)} ج.م، المتوقع: ${f.expected.toFixed(2)} ج.م، الفرق: ${difference.toFixed(2)} ج.م)${approval.approvalId ? ` – اعتمد الفرق: "${approval.approver}"` : ''}`
        )
        const saved = (
          await db.query('SELECT * FROM shift_closings WHERE shift_id = $1', [shift.id])
        ).rows[0]
        return closeResult(db, shift, saved)
      })
  })
}

/** What shifts.close returns: the saved snapshot, plus the fields terminals before 1.5.0 read. */
async function closeResult(db, shift, saved, extra = {}) {
  const row = (await db.query('SELECT * FROM shifts WHERE id = $1', [shift.id])).rows[0]
  const report = saved.report
  return {
    shift: row,
    expected: report.expected.cash,
    actual: report.actual.cash,
    difference: round2(report.actual.cash - report.expected.cash),
    acknowledgedBy: report.acknowledgedBy,
    figures: await drawerFigures(db, row),
    live: await liveDetails(db, row),
    report,
    ...extra
  }
}

module.exports.helpers = {
  DIFFERENCE_LIMIT,
  loadShift,
  auditFigures,
  closeFigures,
  drawerFigures,
  methodFigures,
  liveDetails,
  shiftReport,
  SALE_VALUE
}
