import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import { api, newClientRef } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import PaymentMethodSelect from '../admin/PaymentMethodSelect'
import PaymentDestination from '../admin/PaymentDestination'
import { fixedDestination } from '../../lib/destination'

/**
 * Cancel a preliminary supplier invoice entered by mistake (owner, 2026-10-21, D-065). Nothing is
 * deleted: the payable is reversed and, when money was paid, the user says whether the supplier
 * gave it back (a real money movement now) or not (the supplier then owes it to the store).
 */
export default function CancelPendingModal({
  invoice,
  currentUser,
  currentShift,
  onClose,
  onDone,
  triggerCustomAlert
}) {
  const paid = Number(invoice.paid) || 0
  const [refund, setRefund] = useState(paid > 0 ? '' : 'none')
  const [method, setMethod] = useState(invoice.method || 'cash')
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [clientRef] = useState(newClientRef)
  const [busy, setBusy] = useState(false)
  const fixed = fixedDestination(currentUser, currentShift)

  const save = async (e) => {
    e.preventDefault()
    if (!refund) return
    setBusy(true)
    try {
      const dest = refund === 'returned' ? fixed || destination : undefined
      await api('supplierInvoices.cancel', {
        invoiceId: invoice.id,
        refund,
        method,
        destination: dest,
        currentShiftId: dest === 'shift' && currentShift ? currentShift.id : null,
        reason: reason || null,
        clientRef
      })
      onDone?.()
      onClose()
    } catch (err) {
      triggerCustomAlert?.('تعذّر إلغاء الفاتورة: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <form
        data-enter-step
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-pending-title"
        onSubmit={save}
        style={{ width: 520 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Undo2 size={22} />
          </span>
          <h2 id="cancel-pending-title">إلغاء الفاتورة المبدئية #{invoice.id}</h2>
          <p>
            {invoice.supplier_name} · الإجمالي {formatMoney(invoice.total)} ج.م · المدفوع{' '}
            {formatMoney(paid)} ج.م. تبقى الفاتورة في السجل بحالة «ملغاة».
          </p>
        </div>
        <div className="modal-body">
          {paid > 0 && (
            <fieldset className="field">
              <legend className="field-label">
                هل أعاد المورد المبلغ المدفوع ({formatMoney(paid)} ج.م)؟ *
              </legend>
              <label className="check-row">
                <input
                  type="radio"
                  name="cancel-refund"
                  required
                  checked={refund === 'returned'}
                  onChange={() => setRefund('returned')}
                />
                نعم، استلمنا المبلغ الآن
              </label>
              <label className="check-row">
                <input
                  type="radio"
                  name="cancel-refund"
                  required
                  checked={refund === 'none'}
                  onChange={() => setRefund('none')}
                />
                لا، يبقى المبلغ مستحقاً على المورد
              </label>
            </fieldset>
          )}
          {refund === 'returned' && (
            <>
              <PaymentMethodSelect value={method} onChange={setMethod} label="استُلم بـ" />
              <PaymentDestination
                currentUser={currentUser}
                currentShift={currentShift}
                value={destination}
                onChange={setDestination}
                name="cancel-destination"
              />
            </>
          )}
          <label className="field">
            <span className="field-label">ملاحظة (اختياري)</span>
            <input
              className="input"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
        <div className="modal-footer">
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            رجوع
          </button>
          <button
            type="submit"
            className="btn btn-danger"
            style={{ flex: 1 }}
            disabled={busy || !refund}
          >
            تأكيد الإلغاء
          </button>
        </div>
      </form>
    </div>
  )
}
