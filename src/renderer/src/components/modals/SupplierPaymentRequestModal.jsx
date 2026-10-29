import { useEffect, useMemo, useState } from 'react'
import { HandCoins } from 'lucide-react'
import { api, newClientRef } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { NumberField } from '../ui'

/**
 * Paying a supplier's older debt from the drawer (owner, 1.5.2, D-090). The cash leaves the drawer
 * now; the supplier's balance falls only when an administrator approves the request.
 */
export default function SupplierPaymentRequestModal({
  currentShift,
  onClose,
  onSaved,
  triggerCustomAlert
}) {
  const [suppliers, setSuppliers] = useState([])
  const [search, setSearch] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [clientRef] = useState(newClientRef)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('supplierPayments.suppliers')
      .then(setSuppliers)
      .catch((err) => triggerCustomAlert?.('تعذّر تحميل الموردين: ' + err.message))
  }, [triggerCustomAlert])

  const shown = useMemo(() => {
    const t = search.trim()
    return t ? suppliers.filter((s) => s.name.includes(t)) : suppliers
  }, [suppliers, search])
  const picked = suppliers.find((s) => String(s.id) === String(supplierId))
  const value = Number(amount) || 0
  const error =
    picked && value > picked.open + 0.005
      ? `أكبر من المتاح للسداد (${formatMoney(picked.open)} ج.م بعد الطلبات المعلقة).`
      : ''

  const save = async (e) => {
    e.preventDefault()
    if (!picked || !(value > 0) || error) return
    setBusy(true)
    try {
      const res = await api('supplierPayments.create', {
        supplierId: picked.id,
        amount: value,
        note: note.trim() || null,
        currentShiftId: currentShift?.id ?? null,
        clientRef
      })
      onSaved?.(res.request)
      onClose()
    } catch (err) {
      triggerCustomAlert?.('تعذّر تسجيل الطلب: ' + err.message)
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
        aria-labelledby="spr-create-title"
        onSubmit={save}
        style={{ width: 520 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <HandCoins size={22} />
          </span>
          <h2 id="spr-create-title">سداد دين مورد من الدرج</h2>
          <p>المبلغ يخرج من درج ورديتك الآن، ولا يُخصم من حساب المورد إلا بعد اعتماد المدير.</p>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">بحث عن المورد</span>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="اسم المورد"
            />
          </label>
          <label className="field">
            <span className="field-label">المورد *</span>
            <select
              className="input"
              required
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">— اختر المورد —</option>
              {shown.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} – مستحق {formatMoney(s.open)} ج.م
                </option>
              ))}
            </select>
          </label>
          {picked && picked.pending > 0 && (
            <p className="field-hint">
              على المورد طلبات معلقة بقيمة {formatMoney(picked.pending)} ج.م من أصل مستحق{' '}
              {formatMoney(picked.debt)} ج.م.
            </p>
          )}
          <label className="field">
            <span className="field-label">المبلغ المسلَّم للمورد نقداً (ج.م) *</span>
            <NumberField
              className="input num"
              required
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-describedby="spr-amount-hint"
              aria-invalid={!!error}
            />
          </label>
          <p
            id="spr-amount-hint"
            className={error ? 'field-error' : 'field-hint'}
            role={error ? 'alert' : undefined}
          >
            {error || 'سلِّم المبلغ للمورد ثم سجّله هنا.'}
          </p>
          <label className="field">
            <span className="field-label">ملاحظة (اختياري)</span>
            <input
              className="input"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="رقم الإيصال أو اسم المستلم"
            />
          </label>
        </div>
        <div className="modal-footer">
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            رجوع
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={busy || !picked || !(value > 0) || !!error}
          >
            تسجيل الطلب ({formatMoney(value)} ج.م)
          </button>
        </div>
      </form>
    </div>
  )
}
