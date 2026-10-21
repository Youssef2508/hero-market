import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { api, newClientRef } from '../../lib/api'
import { formatMoney } from '../../lib/utils'

const METHODS = [
  ['cash', 'نقدي'],
  ['visa', 'فيزا'],
  ['wallet', 'محفظة'],
  ['instapay', 'انستا باي']
]

/**
 * Change an invoice's payment method (owner feedback PAY-02): only while its shift is open; no
 * reason is asked (owner, D-063). The total, stock and customer balance stay; the shift's figures per method move.
 */
export default function ChangePaymentModal({ sale, onDone, onClose, triggerCustomAlert }) {
  const [method, setMethod] = useState('')
  const [busy, setBusy] = useState(false)
  const [clientRef] = useState(newClientRef)
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('sales.changePaymentMethod', { saleId: sale.id, method, clientRef })
      await onDone()
    } catch (err) {
      triggerCustomAlert('تعذّر تغيير طريقة الدفع: ' + err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <form
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-pay-title"
        onSubmit={save}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <ArrowLeftRight size={22} />
          </span>
          <h2 id="change-pay-title">تغيير طريقة دفع الفاتورة #{sale.id}</h2>
          <p>
            الحالية: {sale.payment_type} · {formatMoney(sale.total_amount)} ج.م. الإجمالي والمخزون
            لا يتغيران.
          </p>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">طريقة الدفع الصحيحة *</span>
            <select
              className="input"
              required
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="">اختر</option>
              {METHODS.filter(([, l]) => l !== sale.payment_type).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-footer">
          <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>
            حفظ التغيير
          </button>
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </form>
    </div>
  )
}
