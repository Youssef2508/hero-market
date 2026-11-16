'use strict'
// One-time repairs of records written by an earlier version, run at every start of the shop's
// service (never on the cloud: the shop's rows reach the cloud through synchronisation, so a repair
// made on both sides would be counted twice). Each one finds only what it has not repaired yet.

/**
 * QA-03 (1.8.0): a preliminary invoice cancelled with its payment given back by the supplier
 * entered the refund but not the cancellation of that payment, so the supplier's account, read as
 * a statement, showed the store owing what had come back. The balance itself was right and is not
 * touched: the missing row is added, dated today, saying what it corrects.
 */
async function cancelledRefunds(db) {
  const r = await db.query(
    `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp)
     SELECT p.supplier_id, 'adjustment', -p.paid,
            'إلغاء الفاتورة المبدئية #' || p.id || ': المدفوع ' || to_char(p.paid, 'FM999999999990.00') ||
            ' أعاده المورد (تصحيح سجل الحساب، 1.8.0)',
            LOCALTIMESTAMP(0)
       FROM supplier_pending_invoices p
      WHERE p.status = 'cancelled' AND p.cancel_refund = 'returned' AND p.paid > 0
        AND NOT EXISTS (
          SELECT 1 FROM supplier_ledger l
           WHERE l.supplier_id = p.supplier_id AND l.type = 'adjustment'
             AND l.description LIKE 'إلغاء الفاتورة المبدئية #' || p.id || ': المدفوع % أعاده المورد%')
     RETURNING supplier_id`
  )
  return r.rowCount
}

/** Every repair, in the caller's transaction. Returns what each one added. */
async function runRepairs(db) {
  return { cancelledRefunds: await cancelledRefunds(db) }
}

module.exports = { runRepairs }
