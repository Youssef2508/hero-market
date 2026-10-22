'use strict'
// Which invoices a user may see and act on (owner, 1.5.1, D-081). The permission of each action
// (view, reprint, return, return request, payment change) still applies; this decides on WHICH
// invoices:
//  - with sales.view_all (administrators by default): every invoice, of any cashier and shift,
//    open or closed;
//  - anyone else, whatever invoice permissions they hold: only the invoices of their own open
//    shift. Once that shift is closed, its invoices are out of their reach.
// Checked by the service for every invoice operation, so asking for another cashier's invoice by
// its number is refused (403, logged), whatever the screen shows.
const { forbidden } = require('../errors')

const ALL_INVOICES = 'sales.view_all'

/** null = every invoice; otherwise the id of the user's open shift (0 when none: no invoice). */
async function invoiceShift(db, ctx) {
  if (ctx.can(ALL_INVOICES)) return null
  const r = await db.query(
    "SELECT id FROM shifts WHERE user_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1",
    [ctx.user.id]
  )
  return r.rows[0]?.id || 0
}

/**
 * Refuses an invoice outside the user's scope. sale: its row (id, shift_id). The refusal is logged
 * outside the caller's transaction, so it stays even though the request is rolled back.
 */
async function assertInvoiceInScope(db, ctx, sale) {
  const shift = await invoiceShift(db, ctx)
  if (shift === null || (shift && Number(sale.shift_id) === shift)) return
  await ctx.audit(
    ctx.pool,
    'invoice_access_refused',
    `رفض الوصول إلى الفاتورة #${sale.id}: ليست من الوردية المفتوحة للمستخدم`,
    { saleId: sale.id }
  )
  throw forbidden(
    'هذه الفاتورة ليست من ورديتك المفتوحة. يمكنك فتح فواتير ورديتك الحالية فقط؛ باقي الفواتير لدى مدير النظام.'
  )
}

module.exports = { ALL_INVOICES, invoiceShift, assertInvoiceInScope }
