'use strict'
// Treasury ledger (owner feedback CASH-01 / TREAS-01, .docs/FINANCIAL_RECONCILIATION.md §4): the
// store's cash outside the drawers. Every posting goes through post(); rows are never changed.
const { badRequest, forbidden, conflict, shiftRequired } = require('../errors')
const { round2 } = require('./methods')

const KIND_LABELS = {
  opening_float: 'عهدة افتتاح وردية',
  shift_close: 'توريد إغلاق وردية',
  deposit: 'إيداع',
  withdrawal: 'سحب',
  expense: 'مصروف من الخزنة',
  customer_payment: 'تحصيل من عميل',
  supplier_payment: 'سداد لمورد',
  adjustment: 'تسوية',
  reversal: 'عكس حركة'
}

/**
 * Post one treasury row in the caller's transaction. amount is signed (+ in, − out). With an
 * idempotency key, a second posting with the same key returns the first row (duplicate: true)
 * and posts nothing; a different amount or kind under the same key is refused.
 */
async function post(db, ctx, e) {
  const amount = round2(e.amount)
  if (!amount) return null
  const values = [
    e.kind,
    amount,
    e.shiftId ?? null,
    e.refType ?? null,
    e.refId ?? null,
    e.reversesId ?? null,
    String(e.description).slice(0, 300),
    e.reason ? String(e.reason).trim().slice(0, 300) : null,
    ctx.user?.id ?? null,
    ctx.user?.username ?? null,
    e.idemKey ?? null
  ]
  const ins = await db.query(
    `INSERT INTO treasury_ledger (kind, amount, shift_id, ref_type, ref_id, reverses_id, description, reason, user_id, username, idem_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, LOCALTIMESTAMP(0))
     ON CONFLICT (idem_key) DO NOTHING RETURNING *`,
    values
  )
  if (ins.rows[0]) return ins.rows[0]
  const prior = (await db.query('SELECT * FROM treasury_ledger WHERE idem_key = $1', [e.idemKey]))
    .rows[0]
  if (!prior || prior.kind !== e.kind || round2(prior.amount) !== amount)
    throw conflict('هذا الطلب سُجّل من قبل ببيانات مختلفة.')
  return { ...prior, duplicate: true }
}

async function balance(db) {
  return round2(
    (await db.query('SELECT COALESCE(SUM(amount), 0)::float8 AS b FROM treasury_ledger')).rows[0].b
  )
}

/**
 * Where a payment by the current user goes (EXP-03, CUST-02):
 *   'treasury' – needs treasury.manage; no shift is involved;
 *   'shift'    – the user's own open shift (currentShiftId, else their open shift).
 * Without a destination: a request naming its shift (currentShiftId, as every terminal before 1.5.0
 * sent) is a shift payment; with no shift open, a treasury manager pays from the treasury; a user
 * who could do either and named neither must choose (never guessed).
 */
async function resolveDestination(db, ctx, { destination, currentShiftId }) {
  const ownShift = async () => {
    if (currentShiftId) {
      const s = (
        await db.query(
          "SELECT * FROM shifts WHERE id = $1 AND user_id = $2 AND status = 'open' FOR SHARE",
          [currentShiftId, ctx.user.id]
        )
      ).rows[0]
      if (s) return s
    }
    return (
      await db.query(
        "SELECT * FROM shifts WHERE user_id = $1 AND status = 'open' ORDER BY id LIMIT 1 FOR SHARE",
        [ctx.user.id]
      )
    ).rows[0]
  }
  if (destination === 'treasury') {
    if (!ctx.can('treasury.manage'))
      throw forbidden('التسجيل على الخزنة مباشرة يتطلب صلاحية الخزنة.')
    return { destination: 'treasury', shift: null }
  }
  if (destination === 'shift' || currentShiftId) {
    const shift = await ownShift()
    if (!shift) throw shiftRequired('لا توجد وردية مفتوحة لك: افتح وردية أو اختر الخزنة.')
    return { destination: 'shift', shift }
  }
  const shift = await ownShift()
  if (ctx.can('treasury.manage')) {
    if (shift)
      throw badRequest('اختر الوجهة: درج الوردية الحالية أو الخزنة.', {
        code: 'destination_required'
      })
    return { destination: 'treasury', shift: null }
  }
  if (!shift) throw shiftRequired('يجب فتح وردية أولاً.')
  return { destination: 'shift', shift }
}

module.exports = { KIND_LABELS, post, balance, resolveDestination }
