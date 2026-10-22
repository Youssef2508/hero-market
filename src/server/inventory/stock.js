'use strict'
// Stock movements (stage 4, phase 1). The only way stock changes: insert a movement; the
// apply_stock_movement trigger updates products.stock_qty and records the balance after it.
//
// Costing: moving average, kept in products.cost_price (owner decision 2026-10-14).
//   * Receipt of q units at cost c with stock s and average a:
//       s > 0           → a' = (s·a + q·c) / (s + q)
//       s ≤ 0 (none or negative) → a' = c
//     Units sold while stock was zero or negative were costed at the average of that moment and are
//     not revalued afterwards; the receipt that covers them sets the average to its own cost.
//   * A purchase return (D-066) sends q units back at the cost they were bought at, c:
//       s − q > 0 → a' = (s·a − q·c) / (s − q)   (the stock's value falls by exactly q·c)
//       otherwise, or if that would be negative, the average is kept.
//   * Sales leave at the current average (recorded on the sale line); returns, damaged goods,
//     counts and adjustments move at the current average and do not change it.

const { notFound } = require('../errors')

const COST_DECIMALS = 4

function roundCost(n) {
  const f = 10 ** COST_DECIMALS
  return Math.round((Number(n) + Number.EPSILON) * f) / f
}

/** New moving-average cost after receiving `qty` at `cost` (see the rule above). */
function movingAverage(stockBefore, avgBefore, qty, cost) {
  const s = Number(stockBefore) || 0
  const a = Number(avgBefore) || 0
  const q = Number(qty)
  const c = Number(cost)
  if (!(q > 0)) throw new Error('receipt quantity must be positive')
  if (!(c >= 0)) throw new Error('receipt cost must not be negative')
  if (s <= 0) return roundCost(c)
  return roundCost((s * a + q * c) / (s + q))
}

/** Moving-average cost after sending `qty` back to the supplier at `cost` (see the rule above). */
function averageAfterReturn(stockBefore, avgBefore, qty, cost) {
  const s = Number(stockBefore) || 0
  const a = Number(avgBefore) || 0
  const left = s - Number(qty)
  if (!(left > 0)) return roundCost(a)
  const v = (s * a - Number(qty) * Number(cost)) / left
  return v >= 0 ? roundCost(v) : roundCost(a)
}

/**
 * Record one movement. `qty` is signed. `unitCost` defaults to the product's current average.
 * Returns { id, balanceAfter, unitCost }.
 */
async function postMovement(db, ctx, m) {
  const { rows } = await db.query(
    `INSERT INTO stock_movements (product_barcode, qty, kind, unit_cost, balance_after, ref_type, ref_id, reason, user_id)
     VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8) RETURNING id, balance_after, unit_cost`,
    [
      m.barcode,
      m.qty,
      m.kind,
      m.unitCost ?? null,
      m.refType || null,
      m.refId ?? null,
      m.reason || null,
      ctx?.user?.id ?? null
    ]
  )
  return {
    id: Number(rows[0].id),
    balanceAfter: Number(rows[0].balance_after),
    unitCost: Number(rows[0].unit_cost)
  }
}

/** Receive stock at a cost: updates the moving average, then posts a 'purchase' movement. */
async function receiveStock(db, ctx, { barcode, qty, unitCost, refType, refId, reason }) {
  const p = (
    await db.query('SELECT stock_qty, cost_price FROM products WHERE barcode = $1 FOR UPDATE', [
      barcode
    ])
  ).rows[0]
  if (!p) throw notFound(`الصنف (${barcode}) غير مسجل.`)
  const avg = movingAverage(p.stock_qty, p.cost_price, qty, unitCost)
  await db.query('UPDATE products SET cost_price = $2 WHERE barcode = $1', [barcode, avg])
  const mv = await postMovement(db, ctx, {
    barcode,
    qty,
    kind: 'purchase',
    unitCost,
    refType,
    refId,
    reason
  })
  return { ...mv, averageCost: avg }
}

/** Send stock back to its supplier at the cost it was bought at (purchase return, D-066). */
async function returnToSupplier(db, ctx, { barcode, qty, unitCost, refId, reason }) {
  const p = (
    await db.query('SELECT stock_qty, cost_price FROM products WHERE barcode = $1 FOR UPDATE', [
      barcode
    ])
  ).rows[0]
  if (!p) throw notFound(`الصنف (${barcode}) غير مسجل.`)
  const avg = averageAfterReturn(p.stock_qty, p.cost_price, qty, unitCost)
  await db.query('UPDATE products SET cost_price = $2 WHERE barcode = $1', [barcode, avg])
  const mv = await postMovement(db, ctx, {
    barcode,
    qty: -qty,
    kind: 'purchase_return',
    unitCost,
    refType: 'purchase_return',
    refId,
    reason
  })
  return { ...mv, averageCost: avg }
}

/**
 * Bring stock to `target` as a count or manual adjustment. `base` is the stock the user saw when
 * they started (form opened, count started): the movement is target − base, so sales recorded in
 * between are kept (K-37). Without a base the current stock is used. Returns null if no change.
 */
async function adjustTo(db, ctx, { barcode, target, base, kind = 'adjustment', reason, refType }) {
  const p = (
    await db.query('SELECT stock_qty FROM products WHERE barcode = $1 FOR UPDATE', [barcode])
  ).rows[0]
  if (!p) throw notFound(`الصنف (${barcode}) غير مسجل.`)
  const from = base === undefined || base === null ? Number(p.stock_qty) || 0 : Number(base)
  const delta = roundQty(Number(target) - from)
  if (delta === 0) return null
  return postMovement(db, ctx, {
    barcode,
    qty: delta,
    kind,
    refType: refType || 'product',
    reason
  })
}

function roundQty(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000
}

/** Products whose cached stock differs from the sum of their movements (must be empty). */
async function verifyLedger(db) {
  const { rows } = await db.query(
    `SELECT p.barcode, COALESCE(p.stock_qty, 0)::float8 AS stock, COALESCE(m.s, 0)::float8 AS movements
       FROM products p
       LEFT JOIN (SELECT product_barcode, SUM(qty) AS s FROM stock_movements GROUP BY product_barcode) m
         ON m.product_barcode = p.barcode
      WHERE COALESCE(p.stock_qty, 0) <> COALESCE(m.s, 0)
      ORDER BY p.barcode`
  )
  return rows
}

module.exports = {
  movingAverage,
  averageAfterReturn,
  postMovement,
  receiveStock,
  returnToSupplier,
  adjustTo,
  verifyLedger,
  roundCost,
  roundQty,
  COST_DECIMALS
}
