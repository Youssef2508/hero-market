'use strict'
// Supplier debt-payment requests (owner, 1.5.2, D-090). A cashier with «طلب سداد دين مورد من الدرج»
// hands cash from the drawer to a supplier for an older debt: the cash leaves the drawer at once
// (a supplier_payment_request movement of the shift), and the supplier's balance does not change.
// An administrator with «اعتماد طلبات سداد الموردين» then:
//   approves  → the balance falls by the amount, once; no cash moves again;
//   rejects   → the request is disputed: the cash already left, so nothing is put back by itself.
// A disputed request is settled by what really happened, explicitly and logged:
//   returned  → the supplier gave the money back: an inflow where it arrives now (shift or treasury);
//   applied   → it was a valid payment after all: the balance falls, as on approval;
//   loss      → the money is lost: nothing moves; the request stays on record as a loss.
const { badRequest, conflict, notFound, shiftRequired } = require('../errors')
const treasury = require('../money/treasury')
const { addMovement } = require('../money/shiftLedger')
const { METHODS, round2 } = require('../money/methods')
const { drawerFigures } = require('./shifts').helpers

const ref = { type: 'string', minLength: 8, maxLength: 120 }
const note = { type: ['string', 'null'], maxLength: 300 }
const STATUS_LABELS = {
  pending: 'بانتظار الاعتماد',
  approved: 'معتمد',
  disputed: 'مرفوض بعد الدفع (بانتظار التسوية)',
  settled: 'تمت التسوية'
}
const SETTLEMENT_LABELS = {
  returned: 'استُرد المبلغ من المورد',
  applied: 'احتُسب سداداً للمورد',
  loss: 'سُجّل خسارة'
}

/** A request with its supplier, shift and people. */
async function requestRow(db, id, lock = false) {
  return (
    await db.query(
      `SELECT r.*, r.amount::float8 AS amount, s.name AS supplier_name, s.debt_balance::float8 AS supplier_debt,
              cu.username AS created_by_name, du.username AS decided_by_name, su.username AS settled_by_name,
              sh.status AS shift_status
         FROM supplier_payment_requests r
         JOIN suppliers s ON s.id = r.supplier_id
         JOIN shifts sh ON sh.id = r.shift_id
         LEFT JOIN users cu ON cu.id = r.created_by
         LEFT JOIN users du ON du.id = r.decided_by
         LEFT JOIN users su ON su.id = r.settled_by
        WHERE r.id = $1${lock ? ' FOR UPDATE OF r' : ''}`,
      [id]
    )
  ).rows[0]
}

/** What a supplier is still owed, less the requests waiting for approval (never paid twice). */
async function openForRequests(db, supplierId) {
  return round2(
    (
      await db.query(
        `SELECT s.debt_balance - COALESCE((SELECT SUM(amount) FROM supplier_payment_requests
                                             WHERE supplier_id = s.id AND status = 'pending'), 0) AS v
           FROM suppliers s WHERE s.id = $1`,
        [supplierId]
      )
    ).rows[0]?.v || 0
  )
}

/** The supplier's balance falls by the request, once (approval, or a disputed one applied). */
async function payBalance(db, r, text) {
  await db.query('UPDATE suppliers SET debt_balance = debt_balance - $1 WHERE id = $2', [
    r.amount,
    r.supplier_id
  ])
  await db.query(
    `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, 'payment', $2, $3, LOCALTIMESTAMP(0))`,
    [r.supplier_id, r.amount, text]
  )
}

const withLabels = (r) => ({
  ...r,
  status_label: STATUS_LABELS[r.status],
  settlement_label: r.settlement ? SETTLEMENT_LABELS[r.settlement] : null
})

module.exports = function supplierPaymentsModule(app) {
  // The suppliers a request may be made for, with what is still owed to each.
  app.operation({
    name: 'supplierPayments.suppliers',
    permission: 'suppliers.payment_request',
    handler: async (ctx) =>
      (
        await ctx.pool.query(
          `SELECT s.id, s.name, s.debt_balance::float8 AS debt,
                  COALESCE((SELECT SUM(amount) FROM supplier_payment_requests r WHERE r.supplier_id = s.id AND r.status = 'pending'), 0)::float8 AS pending
             FROM suppliers s WHERE s.debt_balance > 0 ORDER BY s.name, s.id`
        )
      ).rows.map((s) => ({ ...s, open: round2(s.debt - s.pending) }))
  })

  app.operation({
    name: 'supplierPayments.create',
    permission: 'suppliers.payment_request',
    schema: {
      type: 'object',
      required: ['supplierId', 'amount', 'clientRef'],
      properties: {
        supplierId: { type: 'integer' },
        amount: { type: 'number', exclusiveMinimum: 0 },
        currentShiftId: { type: ['integer', 'null'] },
        note,
        clientRef: ref
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        // The same request twice (double click, retry): recorded once.
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`spr:${b.clientRef}`])
        const prior = (
          await db.query('SELECT id FROM supplier_payment_requests WHERE client_ref = $1', [
            b.clientRef
          ])
        ).rows[0]
        if (prior) return { request: withLabels(await requestRow(db, prior.id)), duplicate: true }
        const shift = (
          await db.query(
            `SELECT * FROM shifts WHERE user_id = $1 AND status = 'open' ${b.currentShiftId ? 'AND id = $2' : ''} ORDER BY id LIMIT 1 FOR SHARE`,
            b.currentShiftId ? [ctx.user.id, b.currentShiftId] : [ctx.user.id]
          )
        ).rows[0]
        if (!shift) throw shiftRequired('يجب فتح وردية: المبلغ يخرج من درج الوردية.')
        const s = (
          await db.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [b.supplierId])
        ).rows[0]
        if (!s) throw notFound('المورد غير موجود.')
        const amount = round2(b.amount)
        const open = await openForRequests(db, s.id)
        if (amount > open + 0.005)
          throw badRequest(
            open > 0
              ? `المبلغ (${amount.toFixed(2)}) أكبر من المستحق للمورد "${s.name}" بعد الطلبات المعلقة (${open.toFixed(2)} ج.م).`
              : `لا يوجد مستحق للمورد "${s.name}" يمكن سداده (بعد الطلبات المعلقة).`
          )
        // The drawer must hold the cash that is handed over.
        const drawer = await drawerFigures(db, shift)
        if (amount > drawer.expected + 0.005)
          throw badRequest(
            `النقدية المتوقعة في الدرج (${drawer.expected.toFixed(2)} ج.م) أقل من المبلغ المطلوب.`
          )
        const id = (
          await db.query(
            `INSERT INTO supplier_payment_requests (supplier_id, amount, shift_id, note, created_by, client_ref)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [s.id, amount, shift.id, (b.note || '').trim() || null, ctx.user.id, b.clientRef]
          )
        ).rows[0].id
        // Read by the drawer formula as a supplier payment (its text), and as its own kind.
        const m = await addMovement(db, {
          shiftId: shift.id,
          type: 'outflow',
          amount,
          description: `سداد دين مورد (بانتظار الاعتماد): ${s.name} – طلب #${id}`,
          method: 'cash',
          kind: 'supplier_payment_request',
          refType: 'supplier_payment_request',
          refId: id,
          party: s.name,
          userId: ctx.user.id
        })
        await db.query('UPDATE supplier_payment_requests SET ledger_id = $1 WHERE id = $2', [
          m.id,
          id
        ])
        await ctx.audit(
          db,
          'supplier_payment_request',
          `طلب سداد #${id}: ${amount.toFixed(2)} ج.م نقداً من درج الوردية #${shift.id} للمورد "${s.name}" (بانتظار اعتماد المدير)`,
          { requestId: id, supplierId: s.id, amount, shiftId: shift.id }
        )
        return { request: withLabels(await requestRow(db, id)) }
      })
  })

  // Administrators see every request; a requester sees their own.
  app.operation({
    name: 'supplierPayments.list',
    anyPermission: ['suppliers.payment_approve', 'suppliers.payment_request'],
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'all', ...Object.keys(STATUS_LABELS)] },
        shiftId: { type: ['integer', 'null'] }
      }
    },
    handler: async (ctx, { status = 'all', shiftId = null }) => {
      const where = []
      const params = []
      if (status === 'open') where.push("r.status IN ('pending', 'disputed')")
      else if (status !== 'all') {
        params.push(status)
        where.push(`r.status = $${params.length}`)
      }
      if (shiftId) {
        params.push(shiftId)
        where.push(`r.shift_id = $${params.length}`)
      }
      if (!ctx.can('suppliers.payment_approve')) {
        params.push(ctx.user.id)
        where.push(`r.created_by = $${params.length}`)
      }
      const rows = (
        await ctx.pool.query(
          `SELECT r.id FROM supplier_payment_requests r ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'disputed' THEN 1 ELSE 2 END, r.id DESC LIMIT 500`,
          params
        )
      ).rows
      const out = []
      for (const { id } of rows) out.push(withLabels(await requestRow(ctx.pool, id)))
      return out
    }
  })

  // The notice for administrators: how many requests wait for them.
  app.operation({
    name: 'supplierPayments.pendingCount',
    permission: 'suppliers.payment_approve',
    handler: async (ctx) =>
      (
        await ctx.pool.query(
          `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                  COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)::float8 AS "pendingAmount",
                  COUNT(*) FILTER (WHERE status = 'disputed')::int AS disputed
             FROM supplier_payment_requests`
        )
      ).rows[0]
  })

  const decision = {
    type: 'object',
    required: ['requestId'],
    properties: { requestId: { type: 'integer' }, note }
  }

  app.operation({
    name: 'supplierPayments.approve',
    permission: 'suppliers.payment_approve',
    schema: decision,
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const r = await requestRow(db, b.requestId, true)
        if (!r) throw notFound('طلب السداد غير موجود.')
        // Two administrators at once, or a retry: the balance falls once.
        if (r.status === 'approved') return { request: withLabels(r), duplicate: true }
        if (r.status !== 'pending')
          throw conflict(`طلب السداد #${r.id} ${STATUS_LABELS[r.status]}: لا يمكن اعتماده.`)
        await payBalance(db, r, `سداد معتمد – طلب #${r.id} من درج الوردية #${r.shift_id}`)
        await db.query(
          `UPDATE supplier_payment_requests SET status = 'approved', decided_by = $2, decided_at = LOCALTIMESTAMP(0), decision_note = $3 WHERE id = $1`,
          [r.id, ctx.user.id, (b.note || '').trim() || null]
        )
        await ctx.audit(
          db,
          'supplier_payment_approve',
          `اعتماد طلب السداد #${r.id}: خُصم ${r.amount.toFixed(2)} ج.م من مستحق المورد "${r.supplier_name}" (المبلغ خرج من الدرج عند الطلب)`,
          { requestId: r.id, supplierId: r.supplier_id, amount: r.amount }
        )
        return { request: withLabels(await requestRow(db, r.id)) }
      })
  })

  app.operation({
    name: 'supplierPayments.reject',
    permission: 'suppliers.payment_approve',
    schema: {
      ...decision,
      required: ['requestId', 'note'],
      properties: { ...decision.properties, note: { type: 'string', minLength: 3, maxLength: 300 } }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const r = await requestRow(db, b.requestId, true)
        if (!r) throw notFound('طلب السداد غير موجود.')
        if (r.status === 'disputed') return { request: withLabels(r), duplicate: true }
        if (r.status !== 'pending')
          throw conflict(`طلب السداد #${r.id} ${STATUS_LABELS[r.status]}: لا يمكن رفضه.`)
        const reason = b.note.trim()
        if (reason.length < 3) throw badRequest('اكتب سبب الرفض.')
        // The cash was handed over: nothing goes back into the drawer by itself (D-090).
        await db.query(
          `UPDATE supplier_payment_requests SET status = 'disputed', decided_by = $2, decided_at = LOCALTIMESTAMP(0), decision_note = $3 WHERE id = $1`,
          [r.id, ctx.user.id, reason]
        )
        await ctx.audit(
          db,
          'supplier_payment_reject',
          `رفض طلب السداد #${r.id} (${r.amount.toFixed(2)} ج.م للمورد "${r.supplier_name}"): ${reason}. المبلغ خرج من الدرج وينتظر التسوية.`,
          { requestId: r.id, amount: r.amount }
        )
        return { request: withLabels(await requestRow(db, r.id)) }
      })
  })

  app.operation({
    name: 'supplierPayments.settle',
    permission: 'suppliers.payment_approve',
    schema: {
      type: 'object',
      required: ['requestId', 'outcome', 'note'],
      properties: {
        requestId: { type: 'integer' },
        outcome: { type: 'string', enum: Object.keys(SETTLEMENT_LABELS) },
        note: { type: 'string', minLength: 3, maxLength: 300 },
        // returned: how and where the money came back.
        method: { type: 'string', enum: METHODS },
        destination: { type: 'string', enum: ['shift', 'treasury'] },
        currentShiftId: { type: ['integer', 'null'] }
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const r = await requestRow(db, b.requestId, true)
        if (!r) throw notFound('طلب السداد غير موجود.')
        if (r.status === 'settled') {
          if (r.settlement === b.outcome) return { request: withLabels(r), duplicate: true }
          throw conflict(`طلب السداد #${r.id} سُوّي من قبل (${SETTLEMENT_LABELS[r.settlement]}).`)
        }
        if (r.status !== 'disputed')
          throw conflict(
            `طلب السداد #${r.id} ${STATUS_LABELS[r.status]}: التسوية للطلب المرفوض بعد الدفع فقط.`
          )
        const text = b.note.trim()
        let ledgerId = null
        let treasuryId = null
        if (b.outcome === 'returned') {
          // Real money back, recorded where it arrives now (the original cash stays in its shift).
          const method = b.method || 'cash'
          const dest = await treasury.resolveDestination(db, ctx, b)
          const description = `مبلغ أعاده المورد ${r.supplier_name} – طلب سداد مرفوض #${r.id}`
          if (dest.destination === 'shift') {
            ledgerId = (
              await addMovement(db, {
                shiftId: dest.shift.id,
                type: 'inflow',
                amount: r.amount,
                description,
                method,
                kind: 'supplier_refund',
                refType: 'supplier_payment_request',
                refId: r.id,
                party: r.supplier_name,
                userId: ctx.user.id
              })
            ).id
          } else {
            treasuryId = (
              await treasury.post(db, ctx, {
                kind: 'supplier_refund',
                method,
                amount: r.amount,
                refType: 'supplier_payment_request',
                refId: r.id,
                description,
                idemKey: `spr-settle:${r.id}`
              })
            ).id
          }
        } else if (b.outcome === 'applied') {
          await payBalance(db, r, `سداد طلب #${r.id} (احتُسب بعد الرفض): ${text}`.slice(0, 300))
        }
        await db.query(
          `UPDATE supplier_payment_requests SET status = 'settled', settlement = $2, settled_by = $3, settled_at = LOCALTIMESTAMP(0),
                  settlement_note = $4, settlement_ledger_id = $5, settlement_treasury_id = $6 WHERE id = $1`,
          [r.id, b.outcome, ctx.user.id, text, ledgerId, treasuryId]
        )
        await ctx.audit(
          db,
          'supplier_payment_settle',
          `تسوية طلب السداد #${r.id} (${r.amount.toFixed(2)} ج.م للمورد "${r.supplier_name}"): ${SETTLEMENT_LABELS[b.outcome]}. ${text}`,
          { requestId: r.id, outcome: b.outcome, amount: r.amount, ledgerId, treasuryId }
        )
        return { request: withLabels(await requestRow(db, r.id)) }
      })
  })
}

module.exports.helpers = { STATUS_LABELS, SETTLEMENT_LABELS }
