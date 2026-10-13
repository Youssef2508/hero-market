'use strict'
// Tills (TillsManagerTab, useMomknTill, useMobileMoneyTill, momkn/mobile_money DAOs).
const { notFound, conflict } = require('../errors')
const { loadShift } = require('./shifts').helpers

const SALE_VALUE = 'COALESCE(NULLIF(original_amount, 0) - discount, total_amount)'
const num = { type: 'number' }
const str = (max) => ({ type: ['string', 'null'], maxLength: max })

async function openOwnShift(db, ctx, shiftId) {
  const s = await loadShift(db, ctx, shiftId)
  if (s.status !== 'open') throw conflict('الوردية مغلقة.')
  return s
}

module.exports = function tillsModule(app) {
  app.operation({
    name: 'tills.drawerSummary',
    anyPermission: ['tills.operate', 'shifts.operate'],
    schema: { type: 'object', required: ['shiftId'], properties: { shiftId: { type: 'integer' } } },
    handler: async (ctx, { shiftId }) => {
      const shift = await loadShift(ctx.pool, ctx, shiftId)
      const r = (
        await ctx.pool.query(
          `SELECT
             COALESCE((SELECT SUM(${SALE_VALUE}) FROM sales WHERE shift_id = $1), 0) AS "allSalesTotal",
             COALESCE((SELECT SUM(${SALE_VALUE}) FROM sales WHERE shift_id = $1 AND payment_type = 'نقدي'), 0) AS "cashSalesTotal",
             COALESCE((SELECT SUM(${SALE_VALUE}) FROM sales WHERE shift_id = $1 AND payment_type = 'آجل'), 0) AS "debtSalesTotal",
             COALESCE((SELECT SUM(${SALE_VALUE}) FROM sales WHERE shift_id = $1 AND payment_type NOT IN ('نقدي', 'آجل')), 0) AS "digitalSalesTotal",
             COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'inflow'), 0) AS "repayTotal",
             COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND (description LIKE 'مرتجع%' OR description LIKE 'إرجاع%')), 0) AS "returnsTotal",
             COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND (description LIKE 'دفعة لمورد%' OR description LIKE 'سداد دين مورد%')), 0) AS "supplierTotal",
             COALESCE((SELECT SUM(amount) FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow' AND (description NOT LIKE 'مرتجع%' AND description NOT LIKE 'إرجاع%' AND description NOT LIKE 'دفعة لمورد%' AND description NOT LIKE 'سداد دين مورد%')), 0) AS "expensesTotal"`,
          [shift.id]
        )
      ).rows[0]
      return { shift, ...r }
    }
  })

  // ── Momkn ──────────────────────────────────────────────────
  app.operation({
    name: 'momkn.list',
    permission: 'tills.operate',
    schema: { type: 'object', required: ['shiftId'], properties: { shiftId: { type: 'integer' } } },
    handler: async (ctx, { shiftId }) => {
      const shift = await loadShift(ctx.pool, ctx, shiftId)
      const rows = (
        await ctx.pool.query(
          'SELECT * FROM momkn_transactions WHERE shift_id = $1 ORDER BY id DESC',
          [shift.id]
        )
      ).rows
      const t = (
        await ctx.pool.query(
          'SELECT SUM(digital_impact) AS d, SUM(cash_impact) AS c, SUM(commission) AS k FROM momkn_transactions WHERE shift_id = $1',
          [shift.id]
        )
      ).rows[0]
      const startBalance = Number(shift.momkn_start_balance) || 0
      const startCash = Number(shift.momkn_start_cash) || 0
      return {
        rows,
        summary: {
          startBalance,
          startCash,
          expectedDigitalBalance: startBalance + (t.d || 0),
          totalCashImpact: t.c || 0,
          expectedCash: startCash + (t.c || 0),
          totalCommission: t.k || 0
        }
      }
    }
  })

  app.operation({
    name: 'momkn.add',
    permission: 'tills.operate',
    schema: {
      type: 'object',
      required: ['shiftId', 'operationType', 'digitalImpact', 'cashImpact'],
      properties: {
        shiftId: { type: 'integer' },
        operationType: { type: 'string', maxLength: 60 },
        description: str(300),
        digitalImpact: num,
        cashImpact: num,
        commission: num,
        notes: str(1000)
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const shift = await openOwnShift(db, ctx, b.shiftId)
        await db.query(
          `INSERT INTO momkn_transactions (shift_id, timestamp, operation_type, description, digital_impact, cash_impact, commission, notes)
           VALUES ($1, LOCALTIMESTAMP(0), $2, $3, $4, $5, $6, $7)`,
          [
            shift.id,
            b.operationType,
            b.description || '',
            b.digitalImpact || 0,
            b.cashImpact || 0,
            b.commission || 0,
            b.notes || ''
          ]
        )
      })
  })

  app.operation({
    name: 'momkn.delete',
    permission: 'tills.manage',
    schema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'integer', minimum: 1 } }
    },
    handler: async (ctx, { id }) =>
      ctx.tx(async (db) => {
        const r = (await db.query('DELETE FROM momkn_transactions WHERE id = $1 RETURNING *', [id]))
          .rows[0]
        if (!r) throw notFound()
        await ctx.audit(db, 'till_delete', `حذف حركة مكن #${id} (${r.operation_type})`, {
          transaction: r
        })
      })
  })

  // ── Mobile money ───────────────────────────────────────────
  app.operation({
    name: 'mobileMoney.list',
    permission: 'tills.operate',
    schema: { type: 'object', required: ['shiftId'], properties: { shiftId: { type: 'integer' } } },
    handler: async (ctx, { shiftId }) => {
      const shift = await loadShift(ctx.pool, ctx, shiftId)
      const rows = (
        await ctx.pool.query(
          'SELECT * FROM mobile_money_transactions WHERE shift_id = $1 ORDER BY id DESC',
          [shift.id]
        )
      ).rows
      const t = (
        await ctx.pool.query(
          `SELECT SUM(CASE WHEN platform = 'vodafone_cash' THEN digital_impact ELSE 0 END) AS vf,
                  SUM(CASE WHEN platform = 'instapay' THEN digital_impact ELSE 0 END) AS ip,
                  SUM(CASE WHEN platform = 'bank_transfer' THEN digital_impact ELSE 0 END) AS bank,
                  SUM(digital_impact) AS d, SUM(cash_impact) AS c, SUM(commission) AS k
           FROM mobile_money_transactions WHERE shift_id = $1`,
          [shift.id]
        )
      ).rows[0]
      const startBalance = Number(shift.vfcash_start_balance) || 0
      const startCash = Number(shift.vfcash_start_cash) || 0
      return {
        rows,
        summary: {
          startBalance,
          startCash,
          expectedVfcashDigitalBalance: startBalance + (t.vf || 0),
          expectedInstapayDigitalBalance: t.ip || 0,
          expectedBankDigitalBalance: t.bank || 0,
          totalDigitalImpact: t.d || 0,
          totalCashImpact: t.c || 0,
          totalCommission: t.k || 0,
          expectedCash: startCash + (t.c || 0)
        }
      }
    }
  })

  app.operation({
    name: 'mobileMoney.add',
    permission: 'tills.operate',
    schema: {
      type: 'object',
      required: ['shiftId', 'platform', 'operationType', 'digitalImpact', 'cashImpact'],
      properties: {
        shiftId: { type: 'integer' },
        platform: { type: 'string', maxLength: 40 },
        operationType: { type: 'string', maxLength: 60 },
        digitalImpact: num,
        cashImpact: num,
        commission: num,
        recipientName: str(120),
        phoneOrAccount: str(80),
        notes: str(1000)
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const shift = await openOwnShift(db, ctx, b.shiftId)
        await db.query(
          `INSERT INTO mobile_money_transactions (shift_id, timestamp, platform, operation_type, digital_impact, cash_impact, commission, recipient_name, phone_or_account, notes)
           VALUES ($1, LOCALTIMESTAMP(0), $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            shift.id,
            b.platform,
            b.operationType,
            b.digitalImpact || 0,
            b.cashImpact || 0,
            b.commission || 0,
            b.recipientName || '',
            b.phoneOrAccount || '',
            b.notes || ''
          ]
        )
      })
  })

  app.operation({
    name: 'mobileMoney.delete',
    permission: 'tills.manage',
    schema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'integer', minimum: 1 } }
    },
    handler: async (ctx, { id }) =>
      ctx.tx(async (db) => {
        const r = (
          await db.query('DELETE FROM mobile_money_transactions WHERE id = $1 RETURNING *', [id])
        ).rows[0]
        if (!r) throw notFound()
        await ctx.audit(
          db,
          'till_delete',
          `حذف حركة محفظة #${id} (${r.platform} – ${r.operation_type})`,
          { transaction: r }
        )
      })
  })
}
