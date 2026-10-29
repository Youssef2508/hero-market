'use strict'
// Preliminary supplier invoices (owner, 2026-10-21, D-064). Stage A, at the till: the supplier, the
// invoice total, how much was paid now and how; the payment is recorded once in the current shift
// (or the treasury) and the rest becomes the supplier's payable – nothing reaches stock or cost.
// Stage B, by an administrator: the actual lines are entered and the invoice becomes a purchase
// (stock and the latest purchase price), linked to the preliminary one, without paying again; a
// different final total adjusts the payable by an explicit ledger row.
const { badRequest, conflict, notFound } = require('../errors')
const treasury = require('../money/treasury')
const { addMovement } = require('../money/shiftLedger')
const { METHODS, LABELS, round2 } = require('../money/methods')
const { recordPurchase, fillEmptyCosts } = require('./finance').helpers

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
            kind: 'supplier_payment',
            refType: 'supplier_pending_invoice',
            refId: inv.id,
            party: s.name,
            userId: ctx.user?.id
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
    // A cashier (suppliers.pending only) sees the invoices they recorded, to cancel a mistake.
    anyPermission: ['suppliers.view', 'suppliers.manage', 'suppliers.pending'],
    schema: {
      type: 'object',
      properties: {
        status: { type: ['string', 'null'], enum: [null, 'pending', 'converted', 'cancelled'] },
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
              AND ($3::int IS NULL OR p.created_by = $3)
            ORDER BY p.id DESC LIMIT 500`,
          [
            status || null,
            supplierId || null,
            ctx.can('suppliers.view') || ctx.can('suppliers.manage') ? null : ctx.user.id
          ]
        )
      ).rows
  })

  // Cancel a preliminary invoice entered by mistake (owner, 2026-10-21, D-065). It is kept, marked
  // "cancelled"; what it did is reversed by new records: the payable it created goes, and money it
  // paid either came back (a real movement, in the current shift or the treasury, by its method)
  // or did not (then the supplier owes it to the store – nothing is added to cash or electronic
  // balances). A converted invoice already moved stock and cost: it needs a purchase return.
  app.operation({
    name: 'supplierInvoices.cancel',
    anyPermission: ['suppliers.pending', 'suppliers.manage'],
    schema: {
      type: 'object',
      required: ['invoiceId', 'refund', 'clientRef'],
      properties: {
        invoiceId: { type: 'integer' },
        // Did the supplier give back what was paid? 'none' for an invoice that paid nothing.
        refund: { type: 'string', enum: ['none', 'returned'] },
        method: { type: 'string', enum: METHODS },
        destination: { type: 'string', enum: ['shift', 'treasury'] },
        currentShiftId: { type: ['integer', 'null'] },
        reason: { type: ['string', 'null'], maxLength: 300 },
        clientRef: ref
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const inv = await pendingRow(db, b.invoiceId, true)
        if (!inv) throw notFound('الفاتورة المبدئية غير موجودة.')
        // A cashier cancels the invoices they recorded; an administrator any.
        if (!ctx.can('suppliers.manage') && inv.created_by !== ctx.user.id) throw notFound()
        if (inv.status === 'cancelled') {
          if (inv.cancel_ref === b.clientRef) return { invoice: inv, duplicate: true }
          throw conflict(`الفاتورة المبدئية #${inv.id} ملغاة بالفعل.`)
        }
        if (inv.status === 'converted')
          throw conflict(
            `الفاتورة المبدئية #${inv.id} أُكملت بفاتورة الشراء #${inv.purchase_id} وأثّرت في المخزون والتكلفة؛ لا تُلغى من هنا. يلزم مرتجع مشتريات (غير متاح بعد): راجع الإدارة.`
          )
        const total = Number(inv.total)
        const paid = Number(inv.paid)
        const refund = paid > 0 ? b.refund : 'none'
        const method = b.method || inv.method || 'cash'
        const label = `الفاتورة المبدئية #${inv.id}`
        const ledger = (type, amount, text) =>
          db.query(
            `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, $2, $3, $4, LOCALTIMESTAMP(0))`,
            [inv.supplier_id, type, amount, text]
          )
        // 1. The payable the invoice created.
        const unpaid = round2(total - paid)
        if (unpaid > 0) {
          await db.query('UPDATE suppliers SET debt_balance = debt_balance - $1 WHERE id = $2', [
            unpaid,
            inv.supplier_id
          ])
          await ledger('adjustment', -unpaid, `إلغاء ${label}: المتبقي غير مستحق`)
        }
        // 2. What it paid.
        if (paid > 0 && refund === 'returned') {
          // Real money back, recorded where it arrives now (the original payment stays in its shift).
          const dest = await treasury.resolveDestination(db, ctx, b)
          if (dest.destination === 'shift') {
            await addMovement(db, {
              shiftId: dest.shift.id,
              type: 'inflow',
              amount: paid,
              description: `مبلغ أعاده المورد ${inv.supplier_name} – إلغاء ${label}`,
              method,
              kind: 'supplier_refund',
              clientRef: `cancel-pending:${b.clientRef}`,
              refType: 'supplier_pending_invoice',
              refId: inv.id,
              party: inv.supplier_name,
              userId: ctx.user?.id
            })
          } else {
            await treasury.post(db, ctx, {
              kind: 'supplier_refund',
              method,
              amount: paid,
              refType: 'supplier',
              refId: inv.supplier_id,
              description: `مبلغ أعاده المورد ${inv.supplier_name} – إلغاء ${label}`,
              idemKey: `cancel-pending:${b.clientRef}`
            })
          }
          await ledger('refund', paid, `المورد أعاد ${paid.toFixed(2)} ج.م (إلغاء ${label})`)
        } else if (paid > 0) {
          // Not returned: the supplier owes it to the store (a credit on the supplier's account).
          await db.query('UPDATE suppliers SET debt_balance = debt_balance - $1 WHERE id = $2', [
            paid,
            inv.supplier_id
          ])
          await ledger(
            'adjustment',
            -paid,
            `إلغاء ${label}: المدفوع ${paid.toFixed(2)} مستحق من المورد`
          )
        }
        await db.query(
          `UPDATE supplier_pending_invoices SET status = 'cancelled', cancelled_by = $2, cancelled_at = LOCALTIMESTAMP(0),
                  cancel_ref = $3, cancel_refund = $4, cancel_method = $5, cancel_reason = $6
            WHERE id = $1`,
          [
            inv.id,
            ctx.user.id,
            b.clientRef,
            refund,
            refund === 'returned' ? method : null,
            (b.reason || '').trim() || null
          ]
        )
        await ctx.audit(
          db,
          'supplier_pending_cancel',
          `إلغاء ${label} للمورد "${inv.supplier_name}" (${total.toFixed(2)} ج.م، مدفوع ${paid.toFixed(2)}${paid > 0 ? (refund === 'returned' ? '، أُعيد' : '، لم يُعد: مستحق من المورد') : ''})`,
          { invoiceId: inv.id, total, paid, refund, method: refund === 'returned' ? method : null }
        )
        return { invoice: await pendingRow(db, inv.id) }
      })
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
        discount: { type: 'number', minimum: 0 },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 500,
          items: {
            type: 'object',
            required: ['barcode', 'qty'],
            properties: {
              barcode: { type: 'string', minLength: 1, maxLength: 64 },
              unitId: { type: ['integer', 'null'] },
              qty: { type: 'number', exclusiveMinimum: 0 },
              // Omitted or null = keep the product's purchase price (D-087).
              unitCost: { type: ['number', 'null'], minimum: 0 },
              // A new selling price for the product's base unit (D-068); omitted or null = unchanged.
              newRetailPrice: { type: ['number', 'null'], minimum: 0 },
              newWholesalePrice: { type: ['number', 'null'], minimum: 0 }
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
        if (inv.status === 'cancelled')
          throw conflict(`الفاتورة المبدئية #${inv.id} ملغاة ولا يمكن إكمالها.`)
        if (inv.status === 'converted') {
          if (inv.convert_ref === b.clientRef) return { invoice: inv, duplicate: true }
          throw conflict(
            `الفاتورة المبدئية #${inv.id} أُكملت من قبل (فاتورة الشراء #${inv.purchase_id}).`
          )
        }
        // The detailed invoice: its lines, less an optional invoice-level discount (D-066). A line
        // with an empty purchase price counts at the product's current price (D-087).
        const lines = await fillEmptyCosts(db, b.items)
        const gross = round2(
          lines.reduce((a, i) => a + round2(Number(i.qty) * Number(i.unitCost)), 0)
        )
        const discount = round2(b.discount || 0)
        if (discount > gross) throw badRequest('الخصم أكبر من إجمالي الأصناف.')
        const final = round2(gross - discount)
        if (!(final > 0)) throw badRequest('صافي الفاتورة يجب أن يكون أكبر من صفر.')
        const paid = Number(inv.paid)
        const invoiceRef = (b.invoiceRef || inv.invoice_ref || '').trim() || `P${inv.id}`
        // Stock and cost only: the payment and the payable were recorded at stage A.
        const purchase = await recordPurchase(
          db,
          ctx,
          {
            supplierId: inv.supplier_id,
            total_amount: final,
            discount,
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
