'use strict'
// Shifts: open, hourly drawer audit, closing figures, close. Formulas are the legacy ones, unchanged
// (usePOSController.handleConfirmCloseShift, App.triggerAuditCheck, CloseShiftModal queries).
const { forbidden, notFound, conflict } = require('../errors')

const SALE_VALUE = 'COALESCE(NULLIF(original_amount, 0) - discount, total_amount)'

async function loadShift(db, ctx, shiftId, { own = true } = {}) {
  const { rows } = await db.query('SELECT * FROM shifts WHERE id = $1', [shiftId])
  const shift = rows[0]
  if (!shift) throw notFound('الوردية غير موجودة.')
  if (own && shift.user_id !== ctx.user.id && !ctx.can('shifts.view_all')) throw forbidden()
  return shift
}

/** Figures for the hourly drawer audit (App.triggerAuditCheck). */
async function auditFigures(db, shift) {
  const { rows } = await db.query(
    `SELECT
       COALESCE((SELECT SUM(${SALE_VALUE}) FROM sales WHERE shift_id = $1), 0) AS "grossSales",
       COALESCE((SELECT SUM(${SALE_VALUE}) FROM sales WHERE shift_id = $1 AND payment_type = 'آجل'), 0) AS "debtSales",
       COALESCE((SELECT SUM(${SALE_VALUE}) FROM sales WHERE shift_id = $1 AND payment_type NOT IN ('نقدي', 'آجل')), 0) AS "digitalSales",
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'inflow'), 0) AS "repayTotal",
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow'), 0) AS "refundTotal"`,
    [shift.id]
  )
  const r = rows[0]
  const initialCash = Number(shift.initial_cash) || 0
  const expected =
    initialCash + r.grossSales - r.debtSales - r.digitalSales + r.repayTotal - r.refundTotal
  return {
    expected,
    breakdown: {
      grossSales: r.grossSales,
      debtSales: r.debtSales + r.digitalSales,
      refunds: r.refundTotal,
      repay: r.repayTotal,
      initialCash
    }
  }
}

/** Expected drawer cash saved on close (usePOSController.handleConfirmCloseShift). */
async function closeFigures(db, shift) {
  const { rows } = await db.query(
    `SELECT
       COALESCE((SELECT SUM(${SALE_VALUE}) FROM sales WHERE shift_id = $1 AND payment_type = 'نقدي'), 0) AS "cashSales",
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'inflow'), 0) AS "repayTotal",
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND description LIKE 'مرتجع%'), 0) AS "returnsTotal",
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND (description LIKE 'دفعة لمورد%' OR description LIKE 'سداد دين مورد%')), 0) AS "supplierTotal",
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND (description NOT LIKE 'مرتجع%' AND description NOT LIKE 'دفعة لمورد%' AND description NOT LIKE 'سداد دين مورد%')), 0) AS "expensesTotal"`,
    [shift.id]
  )
  const r = rows[0]
  const initialCash = Number(shift.initial_cash) || 0
  const outflow = r.returnsTotal + r.supplierTotal + r.expensesTotal
  return {
    expected: initialCash + r.cashSales + r.repayTotal - outflow,
    cashSales: r.cashSales,
    inflow: r.repayTotal,
    outflow
  }
}

/** Live figures for the close dialogs (CloseShiftModal simple + detailed queries). */
async function liveDetails(db, shift) {
  const { rows } = await db.query(
    `SELECT
       COALESCE((SELECT SUM(total_amount) FROM sales WHERE shift_id = $1), 0) AS all_sales,
       COALESCE((SELECT SUM(total_amount) FROM sales WHERE shift_id = $1 AND payment_type = 'آجل'), 0) AS debt_sales,
       COALESCE((SELECT SUM(total_amount) FROM sales WHERE shift_id = $1 AND payment_type NOT IN ('نقدي', 'آجل')), 0) AS digital_sales,
       COALESCE((SELECT SUM(total_amount) FROM sales WHERE shift_id = $1 AND payment_type = 'نقدي'), 0) AS cash_sales,
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'inflow'), 0) AS inflow,
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow'), 0) AS outflow,
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND description LIKE 'مرتجع%'), 0) AS returns_outflow,
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND (description LIKE 'دفعة لمورد%' OR description LIKE 'سداد دين مورد%')), 0) AS supplier_outflow,
       COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND (description NOT LIKE 'مرتجع%' AND description NOT LIKE 'دفعة لمورد%' AND description NOT LIKE 'سداد دين مورد%')), 0) AS general_outflow,
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
  return { initial_cash: Number(shift.initial_cash) || 0, ...rows[0] }
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
        await ctx.audit(db, 'shift_open', `فتح وردية جديدة بمبلغ بداية ${start.toFixed(2)} ج.م`)
        return rows[0]
      })
    }
  })

  app.operation({
    name: 'shifts.auditPreview',
    permission: 'shifts.operate',
    schema: { type: 'object', required: ['shiftId'], properties: { shiftId: { type: 'integer' } } },
    handler: async (ctx, { shiftId }) =>
      auditFigures(ctx.pool, await loadShift(ctx.pool, ctx, shiftId))
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
    handler: async (ctx, { shiftId }) =>
      liveDetails(ctx.pool, await loadShift(ctx.pool, ctx, shiftId))
  })

  app.operation({
    name: 'shifts.close',
    permission: 'shifts.operate',
    schema: {
      type: 'object',
      required: ['shiftId', 'actualCash'],
      properties: { shiftId: { type: 'integer' }, actualCash: money }
    },
    handler: async (ctx, { shiftId, actualCash }) =>
      ctx.tx(async (db) => {
        const shift = await loadShift(db, ctx, shiftId)
        if (shift.status !== 'open') throw conflict('الوردية مغلقة بالفعل.')
        const f = await closeFigures(db, shift)
        const difference = actualCash - f.expected
        const { rows } = await db.query(
          `UPDATE shifts SET end_time = LOCALTIMESTAMP(0), expected_end_cash = $1, actual_end_cash = $2, difference = $3, status = 'closed'
           WHERE id = $4 RETURNING *`,
          [f.expected, actualCash, difference, shift.id]
        )
        await ctx.audit(
          db,
          'shift_close',
          `إغلاق الوردية رقم #${shift.id} (الفعلي: ${actualCash.toFixed(2)} ج.م، المتوقع: ${f.expected.toFixed(2)} ج.م، الفرق: ${difference.toFixed(2)} ج.م)`
        )
        const live = await liveDetails(db, shift)
        return {
          shift: rows[0],
          expected: f.expected,
          actual: actualCash,
          difference,
          figures: f,
          live
        }
      })
  })
}

module.exports.helpers = { loadShift, auditFigures, closeFigures, liveDetails, SALE_VALUE }
