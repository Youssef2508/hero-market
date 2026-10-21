import { useState } from 'react'
import { BadgePercent } from 'lucide-react'
import { formatMoney } from '../../lib/utils'
import { qtyFromText } from '../../lib/qtyText'

// Manual fixed invoice discount (owner decision 2026-10-21, D-057): a fixed EGP amount off the
// current invoice for users holding "خصم يدوي على الفاتورة", without a reason (owner, D-063). It
// applies after the automatic discounts; the service checks the permission and the amount again.
export default function ManualDiscountModal({ current, maxAmount, onApply, onClose }) {
  const [amount, setAmount] = useState(current ? String(current.amount) : '')
  const parsed = qtyFromText(amount)
  const value = parsed.value === null ? 0 : Number(parsed.value)
  const piastres = Math.abs(value * 100 - Math.round(value * 100)) < 1e-9
  const error =
    amount === ''
      ? ''
      : !(value > 0)
        ? 'اكتب مبلغاً أكبر من صفر.'
        : !piastres
          ? 'المبلغ برقمين بعد العلامة على الأكثر.'
          : value > maxAmount + 1e-9
            ? `الخصم أكبر من إجمالي الفاتورة (${formatMoney(maxAmount)} ج.م).`
            : ''
  const ready = value > 0 && !error

  return (
    <div className="modal-overlay" style={{ zIndex: 99998 }}>
      <form
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-discount-title"
        style={{ width: 420 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onApply({ amount: Math.round(value * 100) / 100 })
        }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <BadgePercent size={22} />
          </span>
          <h2 id="manual-discount-title">خصم يدوي على الفاتورة</h2>
          <p>
            مبلغ ثابت يُخصم من إجمالي الفاتورة الحالية بعد الخصومات التلقائية. لا يغيّر سعر الصنف
            ولا المخزون.
          </p>
        </div>
        <label className="field">
          <span className="field-label">المبلغ (ج.م) *</span>
          <input
            className="input input-lg input-money"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="2.00"
            aria-invalid={Boolean(error)}
            aria-describedby="manual-discount-error"
            autoFocus
          />
          <span className="field-hint">الحد الأقصى: {formatMoney(maxAmount)} ج.م</span>
        </label>
        <p id="manual-discount-error" className="text-danger" role="alert">
          {error}
        </p>
        <div className="modal-footer">
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={!ready}>
            تطبيق الخصم
          </button>
        </div>
      </form>
    </div>
  )
}
