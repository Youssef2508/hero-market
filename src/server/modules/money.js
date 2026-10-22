'use strict'
// Treasury (TREAS-01) and the payment method correction of a sale (PAY-02).
// Formulas and rules: .docs/FINANCIAL_RECONCILIATION.md §4 and §8.
const { badRequest, conflict, notFound } = require('../errors')
const treasury = require('../money/treasury')
const { TYPES, CREDIT_TYPES, LABELS, METHODS, methodOf, round2 } = require('../money/methods')

const SALE_VALUE = 'COALESCE(NULLIF(original_amount, 0) - discount, total_amount)'
const date = { type: ['string', 'null'], pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' }
const ref = { type: 'string', minLength: 8, maxLength: 120 }

module.exports = function moneyModule(app) {
  app.operation({
    name: 'treasury.summary',
    permission: 'treasury.view',
    handler: async (ctx) => {
      const byKind = (
        await ctx.pool.query(
          `SELECT kind, COUNT(*)::int AS count, SUM(amount)::float8 AS total
             FROM treasury_ledger GROUP BY kind ORDER BY kind`
        )
      ).rows
      // D-064: one balance per payment method; their sum is the treasury total.
      return {
        balance: await treasury.balance(ctx.pool),
        balances: await treasury.balances(ctx.pool),
        byKind,
        labels: treasury.KIND_LABELS,
        methodLabels: LABELS
      }
    }
  })

  app.operation({
    name: 'treasury.entries',
    permission: 'treasury.view',
    schema: {
      type: 'object',
      properties: {
        from: date,
        to: date,
        kind: { type: ['string', 'null'], enum: [null, ...Object.keys(treasury.KIND_LABELS)] },
        method: { type: ['string', 'null'], enum: [null, ...METHODS] },
        userId: { type: ['integer', 'null'] },
        limit: { type: 'integer', minimum: 1, maximum: 1000 }
      }
    },
    handler: async (ctx, f) => {
      const where = []
      const p = []
      const add = (sql, v) => {
        p.push(v)
        where.push(sql.replace('?', `$${p.length}`))
      }
      if (f.from) add('t.created_at >= ?::date', f.from)
      if (f.to) add("t.created_at < ?::date + interval '1 day'", f.to)
      if (f.kind) add('t.kind = ?', f.kind)
      if (f.method) add('t.method = ?', f.method)
      if (f.userId) add('t.user_id = ?', f.userId)
      p.push(f.limit || 500)
      const rows = (
        await ctx.pool.query(
          `SELECT t.*, t.amount::float8 AS amount,
                  SUM(t.amount) OVER (ORDER BY t.id)::float8 AS running_balance,
                  r.id AS reversed_by
             FROM treasury_ledger t LEFT JOIN treasury_ledger r ON r.reverses_id = t.id
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY t.id DESC LIMIT $${p.length}`,
          p
        )
      ).rows
      // running_balance is computed over the filtered rows; the true balance comes from summary.
      return { rows, labels: treasury.KIND_LABELS, methodLabels: LABELS }
    }
  })

  // Deposits, withdrawals and corrections by the owner (TREAS-01). A correction states its reason.
  app.operation({
    name: 'treasury.record',
    permission: 'treasury.manage',
    schema: {
      type: 'object',
      required: ['kind', 'amount', 'clientRef'],
      properties: {
        kind: { type: 'string', enum: ['deposit', 'withdrawal', 'adjustment'] },
        // deposit / withdrawal: positive; adjustment: signed (+ adds to the treasury).
        amount: { type: 'number' },
        method: { type: 'string', enum: METHODS },
        reason: { type: 'string', maxLength: 300 },
        clientRef: ref
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const reason = (b.reason || '').trim()
        if (b.kind !== 'adjustment' && !(b.amount > 0)) throw badRequest('اكتب مبلغاً أكبر من صفر.')
        if (b.kind === 'adjustment' && (!b.amount || reason.length < 3))
          throw badRequest('التسوية تحتاج مبلغاً وسبباً واضحاً.')
        const amount = b.kind === 'withdrawal' ? -Math.abs(b.amount) : b.amount
        const entry = await treasury.post(db, ctx, {
          kind: b.kind,
          method: b.method || 'cash',
          amount,
          description: `${treasury.KIND_LABELS[b.kind]}${reason ? `: ${reason}` : ''}`,
          reason,
          idemKey: `treasury:${b.clientRef}`
        })
        if (!entry.duplicate)
          await ctx.audit(
            db,
            'treasury_' + b.kind,
            `${treasury.KIND_LABELS[b.kind]} ${round2(amount).toFixed(2)} ج.م${reason ? ` – ${reason}` : ''}`,
            { entryId: entry.id }
          )
        return { entry, balance: await treasury.balance(db) }
      })
  })

  // Undo a deposit, withdrawal or correction by a reversal (never by deleting it). Shift floats,
  // shift closes, expenses and debt payments are undone where they were made.
  app.operation({
    name: 'treasury.reverse',
    permission: 'treasury.manage',
    schema: {
      type: 'object',
      required: ['entryId', 'reason'],
      properties: { entryId: { type: 'integer' }, reason: { type: 'string', maxLength: 300 } }
    },
    handler: async (ctx, { entryId, reason }) =>
      ctx.tx(async (db) => {
        if (reason.trim().length < 3) throw badRequest('اكتب سبب العكس.')
        const e = (
          await db.query('SELECT * FROM treasury_ledger WHERE id = $1 FOR UPDATE', [entryId])
        ).rows[0]
        if (!e) throw notFound()
        if (!['deposit', 'withdrawal', 'adjustment'].includes(e.kind))
          throw conflict('تُعكس هذه الحركة من مكانها (الوردية أو المصروف أو حساب العميل/المورد).')
        const entry = await treasury.post(db, ctx, {
          kind: 'reversal',
          method: e.method,
          amount: -Number(e.amount),
          reversesId: e.id,
          description: `عكس الحركة #${e.id} (${treasury.KIND_LABELS[e.kind]})`,
          reason,
          idemKey: `reverse:${e.id}`
        })
        if (!entry.duplicate)
          await ctx.audit(db, 'treasury_reversal', `عكس حركة الخزنة #${e.id}: ${reason.trim()}`, {
            entryId: entry.id
          })
        return { entry, balance: await treasury.balance(db) }
      })
  })

  // PAY-02: change a sale's payment method while its shift is open. The sale keeps its total,
  // stock and customer debt; the shift's per-method figures move at once (sum unchanged).
  app.operation({
    name: 'sales.changePaymentMethod',
    permission: 'sales.change_payment',
    schema: {
      type: 'object',
      // No reason is asked (owner, 2026-10-21, D-063); one may still be sent.
      required: ['saleId', 'method', 'clientRef'],
      properties: {
        saleId: { type: 'integer' },
        method: { type: 'string', enum: Object.keys(TYPES) },
        reason: { type: 'string', maxLength: 300 },
        clientRef: ref
      }
    },
    handler: async (ctx, { saleId, method, reason: given, clientRef }) =>
      ctx.tx(async (db) => {
        const done = (
          await db.query('SELECT * FROM sale_payment_corrections WHERE client_ref = $1', [
            clientRef
          ])
        ).rows[0]
        if (done) return { correction: done, duplicate: true }
        const reason = (given || '').trim() || null
        const sale = (await db.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]))
          .rows[0]
        if (!sale) throw notFound('الفاتورة غير موجودة.')
        // Any invoice, also of a closed shift: this permission decides, not «عرض الفواتير» (D-082).
        const shift = (
          await db.query('SELECT status FROM shifts WHERE id = $1 FOR SHARE', [sale.shift_id])
        ).rows[0]
        if (!shift) throw conflict('وردية الفاتورة غير موجودة.')
        // D-065: a sale of a closed shift is reclassified too. No money moves (the treasury already
        // holds what was counted at close) and the shift's saved close is not rewritten; the
        // correction is listed with that shift.
        const afterClose = shift.status !== 'open'
        if (CREDIT_TYPES.includes(sale.payment_type) || !methodOf(sale.payment_type))
          throw conflict('فواتير الآجل والدفع الجزئي لا تُغيَّر طريقة دفعها.')
        const from = methodOf(sale.payment_type)
        if (from === method) throw badRequest('الفاتورة مدفوعة بهذه الطريقة بالفعل.')
        const returned = (
          await db.query('SELECT 1 FROM sale_returns WHERE sale_id = $1 LIMIT 1', [saleId])
        ).rows[0]
        if (returned)
          throw conflict('الفاتورة عليها مرتجع: صُرف بطريقة الدفع الأصلية، فلا يمكن تغييرها.')
        const amount = round2(
          (await db.query(`SELECT ${SALE_VALUE}::float8 AS v FROM sales WHERE id = $1`, [saleId]))
            .rows[0].v
        )
        const toType = TYPES[method][0]
        await db.query('UPDATE sales SET payment_type = $1 WHERE id = $2', [toType, saleId])
        const correction = (
          await db.query(
            `INSERT INTO sale_payment_corrections (sale_id, shift_id, from_type, to_type, amount, reason, user_id, username, client_ref, after_close)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [
              saleId,
              sale.shift_id,
              sale.payment_type,
              toType,
              amount,
              reason,
              ctx.user.id,
              ctx.user.username,
              clientRef,
              afterClose
            ]
          )
        ).rows[0]
        await ctx.audit(
          db,
          'sale_payment_change',
          `تغيير طريقة دفع الفاتورة #${saleId} من ${LABELS[from]} إلى ${LABELS[method]} (${amount.toFixed(2)} ج.م)${afterClose ? ' بعد إغلاق الوردية' : ''}${reason ? `: ${reason}` : ''}`,
          { saleId, from: sale.payment_type, to: toType, amount, afterClose }
        )
        return { correction }
      })
  })
}
