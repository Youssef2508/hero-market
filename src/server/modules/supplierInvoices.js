'use strict'
// Preliminary supplier invoices (owner, 2026-10-21, D-064). Stage A, at the till: the supplier, the
// invoice total, how much was paid now and how; the payment is recorded once in the current shift
// (or the treasury) and the rest becomes the supplier's payable – nothing reaches stock or cost.
// Stage B, by an administrator: the actual lines are entered and the invoice becomes a purchase
// (stock and moving-average cost), linked to the preliminary one, without paying again; a
// different final total adjusts the payable by an explicit ledger row.
const { badRequest, conflict, notFound } = require('../errors')
const treasury = require('../money/treasury')
const { addMovement } = require('../money/shiftLedger')
const { METHODS, LABELS, round2 } = require('../money/methods')
const { recordPurchase } = require('./finance').helpers

const ref = { type: 'string', minLength: 8, maxLength: 120 }
const MODES = { cash: 'نقدي', credit: 'آجل', partial: 'دفع جزئي' }

async function pendingRow(db, id, lock = false) {
  return (
    await db.query(
      `SELECT p.*, s.name AS supplier_name, u.username AS created_by_name
         FROM supplier_pending_invoices p JOIN suppliers s ON s.id = p.supplier_id
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.id = $1${lock ? ' FOR UPDATE OF p' : ''}`,
      [id]
    )
  ).rows[0]
}

module.exports = function supplierInvoicesModule(app) {
  // Suppliers to choose from at the till (names only).
  app.operation({
    name: 'supplierInvoices.suppliers',
    anyPermission: ['suppliers.pending', 'suppliers.view', 'suppliers.manage'],
    handler: async (ctx) =>
      (await ctx.pool.query('SELECT id, name FROM suppliers ORDER BY name')).rows
  })

  app.operation({
    name: 'supplierInvoices.createPending',
    permission: 'suppliers.pending',
    schema: {
      type: 'object',
      required: ['supplierId', 'total', 'paymentMode', 'clientRef'],
      properties: {
        supplierId: { type: 'integer' },
        total: { type: 'number', exclusiveMinimum: 0 },
        paymentMode: { type: 'string', enum: Object.keys(MODES) },
        // The amount paid now (partial only; cash pays the total, credit pays nothing).
        paid: { type: ['number', 'null'], minimum: 0 },
        method: { type: 'string', enum: METHODS },
        destination: { type: 'string', enum: ['shift', 'treasury'] },
        currentShiftId: { type: ['integer', 'null'] },
        invoiceRef: { type: ['string', 'null'], maxLength: 80 },
        notes: { type: ['string', 'null'], maxLength: 500 },
        clientRef: ref
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        // The same request again (a retry, a double click): the invoice it already recorded.
        const done = (
          await db.query('SELECT id FROM supplier_pending_invoices WHERE client_ref = $1', [
            b.clientRef
          ])
        ).rows[0]
        if (done) return { invoice: await pendingRow(db, done.id), duplicate: true }
        const s = (
          await db.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [b.supplierId])
        ).rows[0]
        if (!s) throw notFound('المورد غير موجود.')
        const total = round2(b.total)
        const paid =
          b.paymentMode === 'cash' ? total : b.paymentMode === 'credit' ? 0 : round2(b.paid || 0)
        if (b.paymentMode === 'partial' && !(paid > 0 && paid < total))
          throw badRequest('في الدفع الجزئي يكون المدفوع أكبر من صفر وأقل من إجمالي الفاتورة.')
        const method = b.method || 'cash'
        // Where the money left from: the cashier's shift drawer, or (treasury managers) the treasury.
        const dest = paid > 0 ? await treasury.resolveDestination(db, ctx, b) : null
        const inv = (
          await db.query(
            `INSERT INTO supplier_pending_invoices (supplier_id, invoice_ref, total, paid, payment_mode, method, destination, shift_id, notes, created_by, client_ref)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [
              s.id,
              (b.invoiceRef || '').trim() || null,
              total,
              paid,
              b.paymentMode,
              paid > 0 ? method : null,
              dest ? dest.destination : null,
              dest && dest.shift ? dest.shift.id : null,
              (b.notes || '').trim() || null,
              ctx.user.id,
              b.clientRef
            ]
          )
        ).rows[0]
        const label = `فاتورة مبدئية #${inv.id}${b.invoiceRef ? ` (${b.invoiceRef.trim()})` : ''}`
        if (paid > 0 && dest.destination === 'shift') {
          const m = await addMovement(db, {
            shiftId: dest.shift.id,
            type: 'outflow',
            amount: paid,
            description: `دفعة لمورد: ${s.name} - ${label}`,
            method,
            kind: 'supplier_payment'
          })
          await db.query('UPDATE supplier_pending_invoices SET ledger_id = $1 WHERE id = $2', [
            m.id,
            inv.id
          ])
        } else if (paid > 0) {
          const e = await treasury.post(db, ctx, {
            kind: 'supplier_payment',
            method,
            amount: -paid,
            refType: 'supplier',
            refId: s.id,
            description: `دفعة لمورد: ${s.name} - ${label}`,
            idemKey: `pending-invoice:${inv.id}`
          })
          await db.query(
            'UPDATE supplier_pending_invoices SET treasury_entry_id = $1 WHERE id = $2',
            [e.id, inv.id]
          )
        }
        // The payable: what was not paid. The ledger shows the invoice and the payment with it.
        await db.query('UPDATE suppliers SET debt_balance = debt_balance + $1 WHERE id = $2', [
          round2(total - paid),
          s.id
        ])
        const ledger = (type, amount, text) =>
          db.query(
            `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, $2, $3, $4, LOCALTIMESTAMP(0))`,
            [s.id, type, amount, text]
          )
        await ledger('purchase', total, `${label} – بدون أصناف بعد`)
        if (paid > 0) await ledger('payment', paid, `دفعة مع ${label} (${LABELS[method]})`)
        await ctx.audit(
          db,
          'supplier_pending_invoice',
          `${label} للمورد "${s.name}" بقيمة ${total.toFixed(2)} ج.م، مدفوع ${paid.toFixed(2)} (${MODES[b.paymentMode]})`,
          { invoiceId: inv.id, total, paid, method: paid > 0 ? method : null }
        )
        return { invoice: await pendingRow(db, inv.id) }
      })
  })

  app.operation({
    name: 'supplierInvoices.list',
    anyPermission: ['suppliers.view', 'suppliers.manage'],
    schema: {
      type: 'object',
      properties: {
        status: { type: ['string', 'null'], enum: [null, 'pending', 'converted'] },
        supplierId: { type: ['integer', 'null'] }
      }
    },
    handler: async (ctx, { status, supplierId }) =>
      (
        await ctx.pool.query(
          `SELECT p.*, p.total::float8 AS total, p.paid::float8 AS paid, s.name AS supplier_name,
                  u.username AS created_by_name
             FROM supplier_pending_invoices p JOIN suppliers s ON s.id = p.supplier_id
             LEFT JOIN users u ON u.id = p.created_by
            WHERE ($1::text IS NULL OR p.status = $1) AND ($2::int IS NULL OR p.supplier_id = $2)
            ORDER BY p.id DESC LIMIT 500`,
          [status || null, supplierId || null]
        )
      ).rows
  })

  // Stage B: the lines of a preliminary invoice. Exactly once: a second conversion is refused, the
  // same request again returns the first result.
  app.operation({
    name: 'supplierInvoices.convert',
    permission: 'suppliers.manage',
    schema: {
      type: 'object',
      required: ['invoiceId', 'items', 'clientRef'],
      properties: {
        invoiceId: { type: 'integer' },
        invoiceRef: { type: ['string', 'null'], maxLength: 80 },
        notes: { type: ['string', 'null'], maxLength: 500 },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 500,
          items: {
            type: 'object',
            required: ['barcode', 'qty', 'unitCost'],
            properties: {
              barcode: { type: 'string', minLength: 1, maxLength: 64 },
              unitId: { type: ['integer', 'null'] },
              qty: { type: 'number', exclusiveMinimum: 0 },
              unitCost: { type: 'number', minimum: 0 }
            }
          }
        },
        clientRef: ref
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const inv = await pendingRow(db, b.invoiceId, true)
        if (!inv) throw notFound('الفاتورة المبدئية غير موجودة.')
        if (inv.status === 'converted') {
          if (inv.convert_ref === b.clientRef) return { invoice: inv, duplicate: true }
          throw conflict(
            `الفاتورة المبدئية #${inv.id} أُكملت من قبل (فاتورة الشراء #${inv.purchase_id}).`
          )
        }
        const final = round2(
          b.items.reduce((a, i) => a + round2(Number(i.qty) * Number(i.unitCost)), 0)
        )
        const paid = Number(inv.paid)
        const invoiceRef = (b.invoiceRef || inv.invoice_ref || '').trim() || `P${inv.id}`
        // Stock and cost only: the payment and the payable were recorded at stage A.
        const purchase = await recordPurchase(
          db,
          ctx,
          {
            supplierId: inv.supplier_id,
            total_amount: final,
            paid_amount: paid,
            invoice_ref: invoiceRef,
            payment_type: MODES[inv.payment_mode],
            notes: [`من الفاتورة المبدئية #${inv.id}`, (b.notes || '').trim()]
              .filter(Boolean)
              .join(' – '),
            items: b.items
          },
          { drawer: false, payable: false }
        )
        const difference = round2(final - Number(inv.total))
        if (difference !== 0) {
          // The detailed invoice is the true debt (D-064): the payable follows it, explicitly.
          await db.query('UPDATE suppliers SET debt_balance = debt_balance + $1 WHERE id = $2', [
            difference,
            inv.supplier_id
          ])
          await db.query(
            `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, 'adjustment', $2, $3, LOCALTIMESTAMP(0))`,
            [
              inv.supplier_id,
              difference,
              `تسوية فاتورة مبدئية #${inv.id}: الفعلية ${final.toFixed(2)} بدل ${Number(inv.total).toFixed(2)}`
            ]
          )
        }
        await db.query(
          `UPDATE supplier_pending_invoices SET status = 'converted', purchase_id = $2, final_total = $3,
                  difference = $4, converted_by = $5, converted_at = LOCALTIMESTAMP(0), convert_ref = $6
            WHERE id = $1`,
          [inv.id, purchase.purchaseId, final, difference, ctx.user.id, b.clientRef]
        )
        await ctx.audit(
          db,
          'supplier_pending_convert',
          `إكمال الفاتورة المبدئية #${inv.id} للمورد "${inv.supplier_name}" بفاتورة الشراء #${purchase.purchaseId} (${final.toFixed(2)} ج.م${difference ? `، فرق ${difference.toFixed(2)}` : ''})`,
          {
            invoiceId: inv.id,
            purchaseId: purchase.purchaseId,
            preliminary: Number(inv.total),
            final,
            difference
          }
        )
        return {
          invoice: await pendingRow(db, inv.id),
          purchaseId: purchase.purchaseId,
          difference
        }
      })
  })
}
