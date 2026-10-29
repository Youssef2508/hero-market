'use strict'
// What the shift report itemizes beyond its money movements (owner's review, 1.5.2, D-098): each
// credit and partial sale, each return with what was returned, the supplier invoices recorded in
// the shift with their payment status, purchase returns with money back in the shift, and the
// treasury entries of the shift (its opening float and its close). Read-only; every list adds up
// to the figure the report already has for it.
const { round2 } = require('../money/methods')

const SALE_VALUE = 'COALESCE(NULLIF(s.original_amount, 0) - s.discount, s.total_amount)'
const sum = (xs, k) => round2(xs.reduce((a, x) => a + (Number(x[k]) || 0), 0))
// How a supplier invoice was paid, from its own figures: the total is never replaced by 0.
const payStatus = (total, paid) =>
  paid <= 0.005 ? 'آجل (لم يُدفع شيء)' : paid >= total - 0.005 ? 'مدفوعة بالكامل' : 'دفع جزئي'

/** The customer of a sale as the receipt names it; an unnamed one by its invoice. */
const customerOf = (r) =>
  (r.client_name || '').trim()
    ? `${r.client_name.trim()}${r.client_code ? ` (${r.client_code})` : ''}`
    : `عميل بدون اسم – فاتورة #${r.id}`

async function creditSales(db, shiftId) {
  const rows = (
    await db.query(
      `SELECT s.id, s.timestamp AS at, s.payment_type, s.client_name, s.client_code, s.client_id,
              (${SALE_VALUE})::float8 AS total,
              COALESCE((SELECT SUM(l.amount) FROM safe_ledger l WHERE l.shift_id = s.shift_id AND l.kind = 'sale_upfront'
                                                              AND l.ref_type = 'sale' AND l.ref_id = s.id), 0)::float8 AS paid_now,
              u.username
         FROM sales s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.shift_id = $1 AND s.payment_type IN ('آجل', 'دفع جزئي') ORDER BY s.id`,
      [shiftId]
    )
  ).rows
  const line = (r) => ({
    saleId: r.id,
    at: r.at,
    customer: customerOf(r),
    clientId: r.client_id,
    total: round2(r.total),
    paidNow: round2(r.paid_now),
    unpaid: round2(r.total - r.paid_now),
    username: r.username
  })
  const credit = rows.filter((r) => r.payment_type === 'آجل').map(line)
  const partial = rows.filter((r) => r.payment_type === 'دفع جزئي').map(line)
  return { credit, partial }
}

async function returnLines(db, shiftId) {
  const rows = (
    await db.query(
      `SELECT r.id, r.sale_id, r.sale_item_id, r.quantity::float8 AS quantity, r.refund::float8 AS refund,
              COALESCE(r.paid_back, r.refund)::float8 AS paid_back, r.refund_method AS method, r.reason,
              r.username, r.created_at AS at, s.client_name, s.client_code, s.payment_type,
              COALESCE(p.name, si.product_barcode) AS product, si.unit_name
         FROM sale_returns r JOIN sales s ON s.id = r.sale_id
         LEFT JOIN sale_items si ON si.id = r.sale_item_id
         LEFT JOIN products p ON p.barcode = si.product_barcode
        WHERE r.shift_id = $1 ORDER BY r.id`,
      [shiftId]
    )
  ).rows
  const out = []
  for (const r of rows) {
    let items
    if (r.sale_item_id) {
      items = [{ name: r.product, qty: r.quantity, unit: r.unit_name || '' }]
    } else {
      // A whole invoice: every line of it (what was left of each when it was returned).
      items = (
        await db.query(
          `SELECT COALESCE(p.name, si.product_barcode) AS name, si.quantity::float8 AS qty, si.unit_name AS unit
             FROM sale_items si LEFT JOIN products p ON p.barcode = si.product_barcode
            WHERE si.sale_id = $1 ORDER BY si.id`,
          [r.sale_id]
        )
      ).rows.map((x) => ({ name: x.name, qty: x.qty, unit: x.unit || '' }))
    }
    out.push({
      id: r.id,
      saleId: r.sale_id,
      kind: r.sale_item_id ? 'partial' : 'full',
      kindLabel: r.sale_item_id ? 'مرتجع جزئي' : 'مرتجع الفاتورة كاملة',
      customer: customerOf({ ...r, id: r.sale_id }),
      items,
      refund: round2(r.refund),
      paidBack: round2(r.paid_back),
      method: r.method,
      reason: r.reason,
      username: r.username,
      at: r.at
    })
  }
  return out
}

async function supplierInvoices(db, shiftId) {
  const purchases = (
    await db.query(
      `SELECT sp.id, COALESCE(NULLIF(sp.invoice_ref, ''), '#' || sp.id) AS ref, s.name AS supplier,
              sp.total_amount::float8 AS total, sp.paid_amount::float8 AS paid, sp.remaining::float8 AS remaining,
              sp.paid_from, sp.timestamp AS at,
              (SELECT count(*)::int FROM supplier_purchase_items i WHERE i.purchase_id = sp.id) AS lines
         FROM supplier_purchases sp JOIN suppliers s ON s.id = sp.supplier_id
        WHERE sp.shift_id = $1 ORDER BY sp.id`,
      [shiftId]
    )
  ).rows.map((r) => ({
    ...r,
    total: round2(r.total),
    paid: round2(r.paid),
    remaining: round2(r.remaining),
    status: payStatus(r.total, r.paid)
  }))
  const preliminary = (
    await db.query(
      `SELECT p.id, COALESCE(NULLIF(p.invoice_ref, ''), '#' || p.id) AS ref, s.name AS supplier,
              p.total::float8 AS total, p.paid::float8 AS paid, p.method, p.destination, p.status,
              p.created_at AS at, u.username
         FROM supplier_pending_invoices p JOIN suppliers s ON s.id = p.supplier_id
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.shift_id = $1 ORDER BY p.id`,
      [shiftId]
    )
  ).rows.map((r) => ({
    ...r,
    total: round2(r.total),
    paid: round2(r.paid),
    remaining: round2(r.total - r.paid),
    status: payStatus(r.total, r.paid),
    stateLabel: { pending: 'بانتظار الأصناف', converted: 'أُكملت', cancelled: 'ملغاة' }[r.status]
  }))
  const group = (lines) => ({
    count: lines.length,
    total: sum(lines, 'total'),
    paid: sum(lines, 'paid'),
    remaining: sum(lines, 'remaining'),
    lines
  })
  return { purchases: group(purchases), preliminary: group(preliminary) }
}

async function purchaseReturns(db, shiftId) {
  const rows = (
    await db.query(
      `SELECT r.id, r.purchase_id, COALESCE(NULLIF(sp.invoice_ref, ''), '#' || sp.id) AS ref, s.name AS supplier,
              r.gross_value::float8 AS value, r.credit_value::float8 AS credit, r.refund_amount::float8 AS refund,
              r.refund_method AS method, r.created_at AS at, u.username
         FROM supplier_purchase_returns r JOIN suppliers s ON s.id = r.supplier_id
         JOIN supplier_purchases sp ON sp.id = r.purchase_id LEFT JOIN users u ON u.id = r.created_by
        WHERE r.shift_id = $1 ORDER BY r.id`,
      [shiftId]
    )
  ).rows
  for (const r of rows)
    r.items = (
      await db.query(
        `SELECT COALESCE(p.name, i.product_barcode) AS name, i.qty::float8 AS qty, pi.unit_name AS unit
           FROM supplier_purchase_return_items i
           JOIN supplier_purchase_items pi ON pi.id = i.purchase_item_id
           LEFT JOIN products p ON p.barcode = i.product_barcode
          WHERE i.return_id = $1 ORDER BY i.id`,
        [r.id]
      )
    ).rows.map((x) => ({ name: x.name, qty: x.qty, unit: x.unit || '' }))
  return { count: rows.length, refund: sum(rows, 'refund'), lines: rows }
}

const TREASURY_LABELS = {
  opening_float: 'عهدة افتتاحية من الخزنة',
  shift_close: 'توريد الوردية إلى الخزنة عند الإغلاق'
}

async function treasuryEntries(db, shiftId) {
  // Entries of this shift only (its opening float and close); the treasury's own movements outside
  // any shift are not shift events.
  const rows = (
    await db.query(
      `SELECT id, kind, amount::float8 AS amount, method, description, username, created_at AS at
         FROM treasury_ledger WHERE shift_id = $1 ORDER BY id`,
      [shiftId]
    )
  ).rows.map((r) => ({
    ...r,
    label: TREASURY_LABELS[r.kind] || r.description,
    short: { opening_float: 'عهدة من الخزنة', shift_close: 'توريد للخزنة' }[r.kind] || null
  }))
  return { count: rows.length, lines: rows }
}

async function shiftDetails(db, shift) {
  return {
    sales: await creditSales(db, shift.id),
    returns: await returnLines(db, shift.id),
    supplierInvoices: await supplierInvoices(db, shift.id),
    purchaseReturns: await purchaseReturns(db, shift.id),
    treasury: await treasuryEntries(db, shift.id)
  }
}

module.exports = { shiftDetails, payStatus }
