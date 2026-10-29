'use strict'
// Stock movements (stage 4, phase 1). The only way stock changes: insert a movement; the
// apply_stock_movement trigger updates products.stock_qty and records the balance after it.
//
// Costing: the latest purchase price, kept in products.cost_price per base unit (owner, 1.5.2,
// D-087; it replaces the moving average of 2026-10-14).
//   * A confirmed purchase line sets the product's purchase price to that line's price (per base
//     unit), whatever was paid before: never an average of older purchases or of the stock.
//   * A purchase return (D-066) sends the units back at the cost they were bought at; the product's
//     purchase price does not change.
//   * Sales leave at the current purchase price, recorded on the sale line (a snapshot that later
//     prices never change). A customer's return comes back at the cost of the sale line it reverses.
//     Damaged goods, counts and adjustments move at the current purchase price and do not change it.
//   * No stock batches are kept: a sale's cost is the latest purchase price, not the cost of the
//     particular units sold.

const { notFound } = require('../errors')

const COST_DECIMALS = 4

function roundCost(n) {
  const f = 10 ** COST_DECIMALS
  return Math.round((Number(n) + Number.EPSILON) * f) / f
}

/** The product's purchase price after receiving `qty` at `cost`: that cost (see the rule above). */
function latestPurchaseCost(qty, cost) {
  const q = Number(qty)
  const c = Number(cost)
  if (!(q > 0)) throw new Error('receipt quantity must be positive')
  if (!(c >= 0)) throw new Error('receipt cost must not be negative')
  return roundCost(c)
}

/**
 * Record one movement. `qty` is signed. `unitCost` defaults to the product's current purchase price.
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

/**
 * Receive stock at a cost: the product's purchase price becomes that cost (the latest purchase
 * price, D-087), then a 'purchase' movement is posted. `keepCost`: the line had no price of its own
 * (the purchase price was left empty), so the product's price is kept.
 */
async function receiveStock(db, ctx, { barcode, qty, unitCost, refType, refId, reason, keepCost }) {
  const p = (
    await db.query('SELECT stock_qty, cost_price FROM products WHERE barcode = $1 FOR UPDATE', [
      barcode
    ])
  ).rows[0]
  if (!p) throw notFound(`الصنف (${barcode}) غير مسجل.`)
  const cost = keepCost ? roundCost(Number(p.cost_price) || 0) : latestPurchaseCost(qty, unitCost)
  if (!keepCost)
    await db.query('UPDATE products SET cost_price = $2 WHERE barcode = $1', [barcode, cost])
  const mv = await postMovement(db, ctx, {
    barcode,
    qty,
    kind: 'purchase',
    unitCost,
    refType,
    refId,
    reason
  })
  return { ...mv, purchaseCost: cost, previousCost: Number(p.cost_price) || 0 }
}

/**
 * Send stock back to its supplier at the cost it was bought at (purchase return, D-066). The
 * product's purchase price is not changed (D-087).
 */
async function returnToSupplier(db, ctx, { barcode, qty, unitCost, refId, reason }) {
  const p = (
    await db.query('SELECT stock_qty, cost_price FROM products WHERE barcode = $1 FOR UPDATE', [
      barcode
    ])
  ).rows[0]
  if (!p) throw notFound(`الصنف (${barcode}) غير مسجل.`)
  const mv = await postMovement(db, ctx, {
    barcode,
    qty: -qty,
    kind: 'purchase_return',
    unitCost,
    refType: 'purchase_return',
    refId,
    reason
  })
  return { ...mv, purchaseCost: Number(p.cost_price) || 0 }
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
  latestPurchaseCost,
  postMovement,
  receiveStock,
  returnToSupplier,
  adjustTo,
  verifyLedger,
  roundCost,
  roundQty,
  COST_DECIMALS
}
