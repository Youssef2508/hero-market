'use strict'
// Supplier debt-payment requests (owner, 1.5.2, D-090). A cashier with «طلب سداد دين مورد من الدرج»
// hands cash from the drawer to a supplier for an older debt: the cash leaves the drawer at once
// (a supplier_payment_request movement of the shift), and the supplier's balance does not change.
// An administrator with «اعتماد طلبات سداد الموردين» then:
//   approves  → the balance falls by the amount, once; no cash moves again (and never by the
//               cashier who recorded it, unless that is an administrator);
//   rejects   → the whole transaction is reversed (D-100).
// The cashier who recorded a pending request may also cancel it: reversed the same way.
// A reversal puts the same cash back into the request's own shift drawer while that shift is open,
// otherwise into the treasury against that shift and request. The supplier's balance never moved,
// so it is not touched; nothing is an expense or a loss; the request and both movements stay.
const { badRequest, conflict, forbidden, notFound, shiftRequired } = require('../errors')
const treasury = require('../money/treasury')
const { addMovement } = require('../money/shiftLedger')
const { round2 } = require('../money/methods')
const { ADMINS } = require('../auth/shiftRule')
const { drawerFigures } = require('./shifts').helpers
const reservations = require('../money/reservations')

const ref = { type: 'string', minLength: 8, maxLength: 120 }
const note = { type: ['string', 'null'], maxLength: 300 }
const STATUS_LABELS = {
  pending: 'بانتظار الاعتماد',
  approved: 'معتمد',
  rejected: 'مرفوض – أُعيد المبلغ',
  cancelled: 'ألغاه الكاشير – أُعيد المبلغ',
  // Former states (D-090), kept only for records that already have them.
  disputed: 'مرفوض (قديم)',
  settled: 'تمت التسوية (قديم)'
}
const SETTLEMENT_LABELS = {
  returned: 'استُرد المبلغ من المورد',
  applied: 'احتُسب سداداً للمورد',
  loss: 'سُجّل خسارة'
}
const RESTORED_LABELS = {
  shift: 'أُعيد إلى درج الوردية',
  treasury: 'أُعيد إلى الخزنة (الوردية مغلقة)'
}

/** A request with its supplier, shift and people. */
async function requestRow(db, id, lock = false) {
  const row = (
    await db.query(
      `SELECT r.*, r.amount::float8 AS amount, s.name AS supplier_name, s.debt_balance::float8 AS supplier_debt,
              cu.username AS created_by_name, du.username AS decided_by_name, su.username AS settled_by_name,
              vu.username AS reversed_by_name,
              sh.status AS shift_status, ru.username AS reserved_by_name,
              to_char(r.reserved_until, 'YYYY-MM-DD HH24:MI:SS') AS reserved_until_text,
              COALESCE(r.reserved_until > LOCALTIMESTAMP(0) + make_interval(secs => $2::double precision), false) AS reserved_active
         FROM supplier_payment_requests r
         JOIN suppliers s ON s.id = r.supplier_id
         JOIN shifts sh ON sh.id = r.shift_id
         LEFT JOIN users cu ON cu.id = r.created_by
         LEFT JOIN users du ON du.id = r.decided_by
         LEFT JOIN users su ON su.id = r.settled_by
         LEFT JOIN users vu ON vu.id = r.reversed_by
         LEFT JOIN users ru ON ru.id = r.reserved_by
        WHERE r.id = $1${lock ? ' FOR UPDATE OF r' : ''}`,
      [id, reservations.offset()]
    )
  ).rows[0]
  // The reservation's token is given only to its holder, by supplierPayments.reserve (D-099).
  if (row) delete row.reserve_token
  return row
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

/** The supplier's balance falls by the request, once, on approval. */
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
  settlement_label: r.settlement ? SETTLEMENT_LABELS[r.settlement] : null,
  restored_label: r.reversed_to ? RESTORED_LABELS[r.reversed_to] : null
})

/**
 * Reverse a pending request in full (D-100), in the caller's transaction, the request row locked:
 * the cash back where it came from (its shift's drawer if open, else the treasury against that
 * shift), the request marked rejected or cancelled with who, when, why and where. Once only: the
 * state is checked under the lock, and a reversal movement is unique per request.
 */
async function reverse(db, ctx, r, { status, reason }) {
  const open = (
    await db.query("SELECT status = 'open' AS open FROM shifts WHERE id = $1 FOR SHARE", [
      r.shift_id
    ])
  ).rows[0]?.open
  const what = status === 'rejected' ? 'رفض' : 'إلغاء'
  const description = `${what} طلب سداد مورد #${r.id}: ${r.supplier_name} – عودة المبلغ`
  let ledgerId = null
  let treasuryId = null
  if (open) {
    ledgerId = (
      await addMovement(db, {
        shiftId: r.shift_id,
        type: 'inflow',
        amount: r.amount,
        description,
        method: 'cash',
        kind: 'supplier_payment_reversal',
        refType: 'supplier_payment_request',
        refId: r.id,
        party: r.supplier_name,
        userId: ctx.user.id
      })
    ).id
  } else {
    const entry = await treasury.post(db, ctx, {
      kind: 'supplier_payment_reversal',
      method: 'cash',
      amount: r.amount,
      shiftId: r.shift_id,
      refType: 'supplier_payment_request',
      refId: r.id,
      description: `${description} (الوردية #${r.shift_id} مغلقة)`,
      reason,
      idemKey: `spr-reverse:${r.id}`
    })
    treasuryId = entry.id
  }
  await db.query(
    `UPDATE supplier_payment_requests
        SET status = $2, reversed_by = $3, reversed_at = LOCALTIMESTAMP(0), reversal_reason = $4,
            reversed_to = $5, reversal_ledger_id = $6, reversal_treasury_id = $7,
            decided_by = CASE WHEN $2 = 'rejected' THEN $3 ELSE decided_by END,
            decided_at = CASE WHEN $2 = 'rejected' THEN LOCALTIMESTAMP(0) ELSE decided_at END,
            decision_note = CASE WHEN $2 = 'rejected' THEN $4 ELSE decision_note END,
            ${reservations.CLEAR}
      WHERE id = $1 AND status = 'pending'`,
    [r.id, status, ctx.user.id, reason, open ? 'shift' : 'treasury', ledgerId, treasuryId]
  )
  await ctx.audit(
    db,
    status === 'rejected' ? 'supplier_payment_reject' : 'supplier_payment_cancel',
    `${what} طلب السداد #${r.id} (${r.amount.toFixed(2)} ج.م للمورد "${r.supplier_name}"): ${reason}. ${RESTORED_LABELS[open ? 'shift' : 'treasury']} #${open ? r.shift_id : treasuryId}؛ حساب المورد لم يتغير.`,
    {
      requestId: r.id,
      amount: r.amount,
      shiftId: r.shift_id,
      restoredTo: open ? 'shift' : 'treasury',
      ledgerId,
      treasuryId
    }
  )
}

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
      if (status === 'open') where.push("r.status = 'pending'")
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
            ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.id DESC LIMIT 500`,
          params
        )
      ).rows
      const out = []
      for (const { id } of rows) {
        const r = withLabels(await requestRow(ctx.pool, id))
        out.push({ ...r, reserved_mine: r.reserved_active && r.reserved_by === ctx.user.id })
      }
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
                  0 AS disputed
             FROM supplier_payment_requests`
        )
      ).rows[0]
  })

  const decision = {
    type: 'object',
    required: ['requestId'],
    properties: {
      requestId: { type: 'integer' },
      note,
      // The reservation taken when the request was opened (supplierPayments.reserve, D-099).
      reservationToken: { type: ['string', 'null'], maxLength: 64 }
    }
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
        // The cashier who recorded it never approves it (D-100); an administrator may.
        if (r.created_by === ctx.user.id && !ADMINS.includes(ctx.user.roleKey))
          throw forbidden('لا يعتمد طلب السداد من سجّله؛ يعتمده المدير.')
        await reservations.check(db, ctx, 'request', r.id, b.reservationToken || null)
        await payBalance(db, r, `سداد معتمد – طلب #${r.id} من درج الوردية #${r.shift_id}`)
        await db.query(
          `UPDATE supplier_payment_requests SET status = 'approved', decided_by = $2, decided_at = LOCALTIMESTAMP(0), decision_note = $3, ${reservations.CLEAR} WHERE id = $1`,
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
        // A retry, a double click or two administrators at once: reversed once.
        if (r.status === 'rejected') return { request: withLabels(r), duplicate: true }
        if (r.status !== 'pending')
          throw conflict(`طلب السداد #${r.id} ${STATUS_LABELS[r.status]}: لا يمكن رفضه.`)
        await reservations.check(db, ctx, 'request', r.id, b.reservationToken || null)
        const reason = b.note.trim()
        if (reason.length < 3) throw badRequest('اكتب سبب الرفض.')
        await reverse(db, ctx, r, { status: 'rejected', reason })
        return { request: withLabels(await requestRow(db, r.id)) }
      })
  })

  // The cashier who recorded a pending request cancels it (D-100): reversed in full, as a rejection.
  app.operation({
    name: 'supplierPayments.cancel',
    permission: 'suppliers.payment_request',
    schema: {
      type: 'object',
      required: ['requestId', 'note'],
      properties: {
        requestId: { type: 'integer' },
        note: { type: 'string', minLength: 3, maxLength: 300 }
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const r = await requestRow(db, b.requestId, true)
        // Only one's own request (an administrator rejects others').
        if (!r || r.created_by !== ctx.user.id) throw notFound('طلب السداد غير موجود.')
        if (r.status === 'cancelled') return { request: withLabels(r), duplicate: true }
        if (r.status !== 'pending')
          throw conflict(`طلب السداد #${r.id} ${STATUS_LABELS[r.status]}: لا يمكن إلغاؤه.`)
        // Not while an administrator is deciding on it.
        await reservations.check(db, ctx, 'request', r.id, null)
        const reason = b.note.trim()
        if (reason.length < 3) throw badRequest('اكتب سبب الإلغاء.')
        await reverse(db, ctx, r, { status: 'cancelled', reason })
        return { request: withLabels(await requestRow(db, r.id)) }
      })
  })

  // Open a request to decide on it: reserve it for 5 minutes (D-099), or renew the user's own
  // reservation. Refused, naming the holder, while another user's is valid. A reservation never
  // approves anything nor changes a balance.
  app.operation({
    name: 'supplierPayments.reserve',
    permission: 'suppliers.payment_approve',
    schema: {
      type: 'object',
      required: ['requestId'],
      properties: { requestId: { type: 'integer' } }
    },
    handler: async (ctx, { requestId }) =>
      ctx.tx(async (db) => {
        const r = await reservations.acquire(db, ctx, 'request', requestId)
        return { ...r, request: withLabels(await requestRow(db, requestId)) }
      })
  })

  app.operation({
    name: 'supplierPayments.release',
    permission: 'suppliers.payment_approve',
    schema: {
      type: 'object',
      required: ['requestId', 'token'],
      properties: { requestId: { type: 'integer' }, token: { type: 'string', maxLength: 64 } }
    },
    handler: async (ctx, { requestId, token }) =>
      ctx.tx((db) => reservations.release(db, ctx, 'request', requestId, token))
  })
}

module.exports.helpers = { STATUS_LABELS, SETTLEMENT_LABELS, RESTORED_LABELS }
