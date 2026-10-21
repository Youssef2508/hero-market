'use strict'
// Shift money movements (safe_ledger): the one way they are written (owner, 2026-10-21, D-064).
// Each has its payment method and kind (a customer collection is never a sale, a supplier
// settlement is not an invoice payment), and the request id that wrote it, so a retried payment
// is recorded once. The drawer formula (shifts.drawerFigures) reads these rows.
const { round2 } = require('./methods')

const KINDS = [
  'sale_upfront',
  'kept_change',
  'customer_payment',
  'supplier_payment',
  'supplier_settlement',
  'expense',
  'refund',
  'other'
]

/** The movement a request already wrote (a retry), or null. */
async function recorded(db, clientRef) {
  if (!clientRef) return null
  return (
    (await db.query('SELECT * FROM safe_ledger WHERE client_ref = $1', [clientRef])).rows[0] || null
  )
}

/** Write one movement in the caller's transaction; returns its row. */
async function addMovement(db, m) {
  if (!KINDS.includes(m.kind)) throw new Error(`unknown movement kind ${m.kind}`)
  const { rows } = await db.query(
    `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp, method, kind, client_ref)
     VALUES ($1, $2, $3, $4, LOCALTIMESTAMP(0), $5, $6, $7) RETURNING *`,
    [
      m.shiftId,
      m.type,
      round2(m.amount),
      m.description,
      m.method || 'cash',
      m.kind,
      m.clientRef || null
    ]
  )
  return rows[0]
}

module.exports = { KINDS, recorded, addMovement }
