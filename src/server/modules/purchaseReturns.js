'use strict'
// Purchase returns (owner, 2026-10-22, D-066): goods of a recorded purchase sent back to the
// supplier, in parts, never more than was bought. Separate from cancelling a preliminary invoice.
//
//   * Stock leaves at the cost the line was bought at (the product's purchase price is
//     not changed: it stays the latest purchase price, D-087).
//   * The supplier is credited the returned lines' value × net ÷ gross of the purchase, so an
//     invoice discount is never credited twice; the payable falls by that amount (below zero, the
//     supplier owes the store).
//   * Money the supplier gives back is recorded only when received, by its method, in the current
//     shift or the treasury; what is not given back stays owed by the supplier.
//   * One transaction; a request id (client_ref) makes a retry return the first result.
const { badRequest, conflict, notFound } = require('../errors')
const treasury = require('../money/treasury')
const { addMovement } = require('../money/shiftLedger')
const { METHODS, round2 } = require('../money/methods')
const { returnToSupplier, roundQty } = require('../inventory/stock')

const ref = { type: 'string', minLength: 8, maxLength: 120 }

/** The purchase's lines with what was already returned (in the line's unit). */
async function purchaseLines(db, purchaseId) {
  return (
    await db.query(
      `SELECT i.id, i.product_barcode AS barcode, COALESCE(p.name, i.product_barcode) AS name, p.unit AS base_unit, i.qty::float8 AS qty,
              i.unit_cost::float8 AS unit_cost, i.line_total::float8 AS line_total,
              i.unit_name, COALESCE(i.unit_factor, 1)::float8 AS unit_factor,
              COALESCE((SELECT SUM(r.qty) FROM supplier_purchase_return_items r WHERE r.purchase_item_id = i.id), 0)::float8 AS returned
         FROM supplier_purchase_items i LEFT JOIN products p ON p.barcode = i.product_barcode
        WHERE i.purchase_id = $1 ORDER BY i.id`,
      [purchaseId]
    )
  ).rows
}

async function returnsOf(db, purchaseId) {
  return (
    await db.query(
      `SELECT r.id, r.gross_value::float8 AS gross_value, r.credit_value::float8 AS credit_value,
              r.refund_amount::float8 AS refund_amount, r.refund_method, r.destination, r.reason,
              r.created_at, u.username AS created_by_name
         FROM supplier_purchase_returns r LEFT JOIN users u ON u.id = r.created_by
        WHERE r.purchase_id = $1 ORDER BY r.id`,
      [purchaseId]
    )
  ).rows
}

module.exports = function purchaseReturnsModule(app) {
  // A purchase with its lines, what is left to return, and its earlier returns.
  app.operation({
    name: 'suppliers.purchaseDetail',
    anyPermission: ['suppliers.view', 'suppliers.manage'],
    schema: {
      type: 'object',
      required: ['purchaseId'],
      properties: { purchaseId: { type: 'integer' } }
    },
    handler: async (ctx, { purchaseId }) => {
      const purchase = (
        await ctx.pool.query(
          `SELECT sp.*, sp.total_amount::float8 AS total_amount, COALESCE(sp.gross_amount, sp.total_amount)::float8 AS gross,
                  sp.discount::float8 AS discount, s.name AS supplier_name
             FROM supplier_purchases sp JOIN suppliers s ON s.id = sp.supplier_id WHERE sp.id = $1`,
          [purchaseId]
        )
      ).rows[0]
      if (!purchase) throw notFound('فاتورة الشراء غير موجودة.')
      return {
        purchase,
        items: await purchaseLines(ctx.pool, purchaseId),
        returns: await returnsOf(ctx.pool, purchaseId)
      }
    }
  })

  // Correct a recorded purchase's reference number and notes (owner, 1.5.2, D-088). They move no
  // stock, cost or money; quantities and prices are corrected by a purchase return and a new
  // invoice, never edited in place. Logged with what changed.
  app.operation({
    name: 'suppliers.updatePurchase',
    permission: 'suppliers.manage',
    schema: {
      type: 'object',
      required: ['purchaseId'],
      // Only these fields (others are dropped): amounts, lines and payments are never edited.
      additionalProperties: false,
      properties: {
        purchaseId: { type: 'integer' },
        invoiceRef: { type: ['string', 'null'], maxLength: 80 },
        notes: { type: ['string', 'null'], maxLength: 1000 }
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const old = (
          await db.query(
            `SELECT sp.*, s.name AS supplier_name FROM supplier_purchases sp JOIN suppliers s ON s.id = sp.supplier_id
              WHERE sp.id = $1 FOR UPDATE OF sp`,
            [b.purchaseId]
          )
        ).rows[0]
        if (!old) throw notFound('فاتورة الشراء غير موجودة.')
        const next = {
          invoice_ref:
            b.invoiceRef === undefined ? old.invoice_ref || '' : (b.invoiceRef || '').trim(),
          notes: b.notes === undefined ? old.notes || '' : (b.notes || '').trim()
        }
        const changes = ['invoice_ref', 'notes'].filter((k) => next[k] !== (old[k] || ''))
        if (changes.length) {
          await db.query(
            'UPDATE supplier_purchases SET invoice_ref = $2, notes = $3 WHERE id = $1',
            [old.id, next.invoice_ref, next.notes]
          )
          const label = { invoice_ref: 'رقم الفاتورة', notes: 'الملاحظات' }
          await ctx.audit(
            db,
            'supplier_purchase_edit',
            `تعديل فاتورة الشراء #${old.id} من "${old.supplier_name}": ${changes
              .map((k) => `${label[k]} «${old[k] || ''}» ← «${next[k]}»`)
              .join('، ')}`,
            {
              purchaseId: old.id,
              changes: Object.fromEntries(
                changes.map((k) => [k, { from: old[k] || '', to: next[k] }])
              )
            }
          )
        }
        return {
          purchase: { id: old.id, ...next },
          changed: changes.length > 0
        }
      })
  })

  app.operation({
    name: 'suppliers.returnPurchase',
    permission: 'suppliers.manage',
    schema: {
      type: 'object',
      required: ['purchaseId', 'items', 'clientRef'],
      properties: {
        purchaseId: { type: 'integer' },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 500,
          items: {
            type: 'object',
            required: ['purchaseItemId', 'qty'],
            properties: {
              purchaseItemId: { type: 'integer' },
              // In the line's own unit (boxes when it was bought in boxes).
              qty: { type: 'number', exclusiveMinimum: 0 }
            }
          }
        },
        // Money the supplier gives back now (0 or omitted: the supplier owes it).
        refundAmount: { type: 'number', minimum: 0 },
        method: { type: 'string', enum: METHODS },
        destination: { type: 'string', enum: ['shift', 'treasury'] },
        currentShiftId: { type: ['integer', 'null'] },
        reason: { type: ['string', 'null'], maxLength: 300 },
        clientRef: ref
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const purchase = (
          await db.query(
            `SELECT sp.*, s.name AS supplier_name FROM supplier_purchases sp JOIN suppliers s ON s.id = sp.supplier_id
              WHERE sp.id = $1 FOR UPDATE OF sp`,
            [b.purchaseId]
          )
        ).rows[0]
        if (!purchase) throw notFound('فاتورة الشراء غير موجودة.')
        const done = (
          await db.query('SELECT * FROM supplier_purchase_returns WHERE client_ref = $1', [
            b.clientRef
          ])
        ).rows[0]
        if (done) {
          if (done.purchase_id !== purchase.id) throw conflict('رقم الطلب مستخدم لمرتجع آخر.')
          return { returnId: done.id, duplicate: true }
        }
        await db.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [purchase.supplier_id])

        const lines = new Map((await purchaseLines(db, purchase.id)).map((l) => [l.id, l]))
        if (new Set(b.items.map((i) => i.purchaseItemId)).size !== b.items.length)
          throw badRequest('الصنف مكرر في المرتجع.')
        const picked = b.items.map((i) => {
          const l = lines.get(i.purchaseItemId)
          if (!l) throw badRequest('صنف ليس من فاتورة الشراء هذه.')
          const qty = roundQty(i.qty)
          const left = roundQty(l.qty - l.returned)
          if (qty > left + 0.0005)
            throw conflict(
              `لا يمكن إرجاع ${qty} من "${l.name}": المتبقي من الفاتورة ${left} ${l.unit_name || ''}`.trim() +
                '.'
            )
          return {
            ...l,
            returnQty: qty,
            baseQty: roundQty(qty * l.unit_factor),
            value: round2(qty * l.unit_cost)
          }
        })

        // What the supplier is credited: the lines' value at the purchase's net ÷ gross.
        const net = Number(purchase.total_amount)
        const gross = Number(purchase.gross_amount ?? purchase.total_amount)
        const grossValue = round2(picked.reduce((a, l) => a + l.value, 0))
        if (!(grossValue > 0)) throw badRequest('قيمة المرتجع صفر.')
        const credited = Number(
          (
            await db.query(
              'SELECT COALESCE(SUM(credit_value), 0) AS c FROM supplier_purchase_returns WHERE purchase_id = $1',
              [purchase.id]
            )
          ).rows[0].c
        )
        // Rounding never lets the returns credit more than the purchase's net.
        const credit = Math.min(
          round2(gross > 0 ? (grossValue * net) / gross : grossValue),
          round2(net - credited)
        )
        const refund = round2(b.refundAmount || 0)
        if (refund > credit + 0.005)
          throw badRequest(
            `المبلغ المسترد (${refund.toFixed(2)}) أكبر من قيمة المرتجع (${credit.toFixed(2)}).`
          )
        const method = b.method || 'cash'
        const dest = refund > 0 ? await treasury.resolveDestination(db, ctx, b) : null

        const returnId = (
          await db.query(
            `INSERT INTO supplier_purchase_returns (purchase_id, supplier_id, gross_value, credit_value, refund_amount,
                    refund_method, destination, shift_id, reason, client_ref, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [
              purchase.id,
              purchase.supplier_id,
              grossValue,
              credit,
              refund,
              refund > 0 ? method : null,
              dest?.destination ?? null,
              dest?.shift?.id ?? null,
              (b.reason || '').trim() || null,
              b.clientRef,
              ctx.user.id
            ]
          )
        ).rows[0].id
        const label = `مرتجع مشتريات #${returnId} (فاتورة #${purchase.invoice_ref || purchase.id})`

        // Stock leaves at the line's cost, products locked in a stable order.
        for (const l of [...picked].sort((a, c) => (a.barcode < c.barcode ? -1 : 1))) {
          const p = (
            await db.query('SELECT stock_qty FROM products WHERE barcode = $1 FOR UPDATE', [
              l.barcode
            ])
          ).rows[0]
          if (Number(p.stock_qty) + 0.0005 < l.baseQty)
            throw conflict(
              `المخزون الحالي من "${l.name}" (${Number(p.stock_qty)}) أقل من الكمية المرتجعة (${l.baseQty}).`
            )
          await db.query(
            `INSERT INTO supplier_purchase_return_items (return_id, purchase_item_id, product_barcode, qty, base_qty, unit_cost, line_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [returnId, l.id, l.barcode, l.returnQty, l.baseQty, l.unit_cost, l.value]
          )
          await returnToSupplier(db, ctx, {
            barcode: l.barcode,
            qty: l.baseQty,
            unitCost: Math.round((l.unit_cost / l.unit_factor) * 10000) / 10000,
            refId: returnId,
            reason: `${label} إلى ${purchase.supplier_name}`
          })
        }

        const ledger = (type, amount, text) =>
          db.query(
            `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, $2, $3, $4, LOCALTIMESTAMP(0))`,
            [purchase.supplier_id, type, amount, text]
          )
        // The payable falls by the credit (below zero: the supplier owes the store).
        if (credit > 0) {
          await db.query('UPDATE suppliers SET debt_balance = debt_balance - $1 WHERE id = $2', [
            credit,
            purchase.supplier_id
          ])
          await ledger('return', -credit, `${label}: ${credit.toFixed(2)} ج.م`)
        }
        // Money actually received now, where it arrives.
        if (refund > 0) {
          const text = `مبلغ أعاده المورد ${purchase.supplier_name} – ${label}`
          if (dest.destination === 'shift')
            await addMovement(db, {
              shiftId: dest.shift.id,
              type: 'inflow',
              amount: refund,
              description: text,
              method,
              kind: 'supplier_refund',
              clientRef: `purchase-return:${b.clientRef}`
            })
          else
            await treasury.post(db, ctx, {
              kind: 'supplier_refund',
              method,
              amount: refund,
              refType: 'supplier',
              refId: purchase.supplier_id,
              description: text,
              idemKey: `purchase-return:${b.clientRef}`
            })
          await db.query('UPDATE suppliers SET debt_balance = debt_balance + $1 WHERE id = $2', [
            refund,
            purchase.supplier_id
          ])
          await ledger('refund', refund, `المورد أعاد ${refund.toFixed(2)} ج.م (${label})`)
        }
        await ctx.audit(
          db,
          'supplier_purchase_return',
          `${label} للمورد "${purchase.supplier_name}": ${picked.length} صنف بقيمة ${grossValue.toFixed(2)}، يُخصم من المستحق ${credit.toFixed(2)} ج.م${refund > 0 ? `، استُرد ${refund.toFixed(2)}` : ''}`,
          {
            returnId,
            purchaseId: purchase.id,
            grossValue,
            credit,
            refund,
            method: refund > 0 ? method : null,
            items: picked.map((l) => ({ itemId: l.id, qty: l.returnQty, baseQty: l.baseQty }))
          }
        )
        const supplier = (
          await db.query('SELECT * FROM suppliers WHERE id = $1', [purchase.supplier_id])
        ).rows[0]
        return { returnId, grossValue, credit, refund, supplier }
      })
  })
}
