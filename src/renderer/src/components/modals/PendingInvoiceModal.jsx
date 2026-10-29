import { useEffect, useMemo, useState } from 'react'
import { ReceiptText } from 'lucide-react'
import { api, newClientRef } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import PaymentMethodSelect from '../admin/PaymentMethodSelect'
import PaymentDestination from '../admin/PaymentDestination'
import { fixedDestination } from '../../lib/destination'
import { NumberField } from '../ui'

const MODES = [
  ['cash', 'نقدي (مدفوعة بالكامل)'],
  ['credit', 'آجل (لم يُدفع شيء)'],
  ['partial', 'دفع جزئي']
]

/**
 * Preliminary supplier invoice (owner, 2026-10-21, D-064): the supplier, the invoice total and
 * what is paid now – fast, at the till. The payment is recorded once in the current shift; the
 * rest becomes the supplier's payable. Products are entered later by an administrator ("إكمال").
 */
export default function PendingInvoiceModal({
  currentUser,
  currentShift,
  onClose,
  onSaved,
  triggerCustomAlert
}) {
  const [suppliers, setSuppliers] = useState([])
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({
    supplierId: '',
    total: '',
    mode: 'cash',
    paid: '',
    method: 'cash',
    invoiceRef: '',
    destination: ''
  })
  const [clientRef] = useState(newClientRef)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('supplierInvoices.suppliers')
      .then(setSuppliers)
      .catch((err) => triggerCustomAlert?.('تعذّر تحميل الموردين: ' + err.message))
  }, [triggerCustomAlert])

  const shown = useMemo(() => {
    const t = search.trim()
    return t ? suppliers.filter((s) => s.name.includes(t)) : suppliers
  }, [suppliers, search])
  const total = Number(form.total) || 0
  const paid = form.mode === 'cash' ? total : form.mode === 'credit' ? 0 : Number(form.paid) || 0
  const remaining = Math.max(0, Math.round((total - paid) * 100) / 100)
  const error =
    form.mode === 'partial' && total > 0 && !(paid > 0 && paid < total)
      ? 'في الدفع الجزئي يكون المدفوع أكبر من صفر وأقل من الإجمالي.'
      : ''
  const fixed = fixedDestination(currentUser, currentShift)

  const save = async (e) => {
    e.preventDefault()
    if (!form.supplierId || !(total > 0) || error) return
    setBusy(true)
    try {
      const destination = paid > 0 ? fixed || form.destination : undefined
      await api('supplierInvoices.createPending', {
        supplierId: Number(form.supplierId),
        total,
        paymentMode: form.mode,
        paid: form.mode === 'partial' ? paid : null,
        method: form.method,
        destination,
        currentShiftId: destination === 'shift' && currentShift ? currentShift.id : null,
        invoiceRef: form.invoiceRef || null,
        clientRef
      })
      onSaved?.()
      onClose()
    } catch (err) {
      triggerCustomAlert?.('تعذّر تسجيل الفاتورة: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <form
        data-enter-step
        className="modal-content modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-invoice-title"
        onSubmit={save}
        style={{ width: 520 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <ReceiptText size={22} />
          </span>
          <h2 id="pending-invoice-title">فاتورة مورد مبدئية</h2>
          <p>الإجمالي والمدفوع فقط؛ الأصناف تُضاف لاحقاً من الإدارة ولا يتغير المخزون الآن.</p>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">المورد *</span>
            <input
              className="input"
              placeholder="ابحث باسم المورد"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="بحث المورد"
            />
            <select
              className="input"
              required
              value={form.supplierId}
              onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            >
              <option value="">اختر المورد</option>
              {shown.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">إجمالي الفاتورة (ج.م) *</span>
            <NumberField
              min="0.01"
              step="0.01"
              required
              className="input input-lg input-money"
              value={form.total}
              onChange={(e) => setForm({ ...form, total: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">طريقة السداد *</span>
            <select
              className="input"
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value })}
            >
              {MODES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {form.mode === 'partial' && (
            <label className="field">
              <span className="field-label">المدفوع الآن (ج.م) *</span>
              <NumberField
                min="0.01"
                step="0.01"
                required
                className="input input-money"
                value={form.paid}
                onChange={(e) => setForm({ ...form, paid: e.target.value })}
              />
            </label>
          )}
          {paid > 0 && (
            <>
              <PaymentMethodSelect
                value={form.method}
                onChange={(v) => setForm({ ...form, method: v })}
                label="دُفع من"
              />
              <PaymentDestination
                currentUser={currentUser}
                currentShift={currentShift}
                value={form.destination}
                onChange={(v) => setForm({ ...form, destination: v })}
                name="pending-invoice-destination"
              />
            </>
          )}
          <label className="field">
            <span className="field-label">رقم فاتورة المورد (اختياري)</span>
            <input
              className="input"
              maxLength={80}
              value={form.invoiceRef}
              onChange={(e) => setForm({ ...form, invoiceRef: e.target.value })}
            />
          </label>
          <dl className="kv">
            <dt>المدفوع الآن</dt>
            <dd>{formatMoney(paid)} ج.م</dd>
            <dt className="fw-bold">المتبقي على المتجر للمورد</dt>
            <dd className="fw-bold">{formatMoney(remaining)} ج.م</dd>
          </dl>
          {error && (
            <p className="text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={busy || !form.supplierId || !(total > 0) || !!error}
          >
            تسجيل الفاتورة المبدئية
          </button>
        </div>
      </form>
    </div>
  )
}
