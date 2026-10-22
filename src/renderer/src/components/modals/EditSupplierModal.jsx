import { useState } from 'react'
import { Truck } from 'lucide-react'
import { api, can } from '../../lib/api'
import { OpeningBalanceField, BalanceText } from '../admin/SupplierBalance'

/**
 * Edit a supplier's contact details and, with its own permission, the opening balance (SUP-03,
 * D-070). Each part saves on its own: the contact never touches invoices, payments or balances;
 * the opening balance is corrected by a ledger line for the difference.
 */
export default function EditSupplierModal({
  supplier,
  currentUser,
  onClose,
  onDone,
  triggerCustomAlert
}) {
  const [form, setForm] = useState({
    name: supplier.name || '',
    phone: supplier.phone || '',
    address: supplier.address || '',
    contact_person: supplier.contact_person || ''
  })
  const startOpening = Number(supplier.opening_balance) || 0
  const [opening, setOpening] = useState(startOpening || '')
  const [busy, setBusy] = useState(false)
  const canOpening = can(currentUser, 'suppliers.opening')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const saveContact = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const updated = await api('suppliers.update', { supplierId: supplier.id, ...form })
      onDone?.(updated)
      onClose()
    } catch (err) {
      triggerCustomAlert?.('تعذّر حفظ بيانات المورد: ' + err.message)
    } finally {
      setBusy(false)
    }
  }
  const saveOpening = async () => {
    setBusy(true)
    try {
      const updated = await api('suppliers.setOpening', {
        supplierId: supplier.id,
        amount: opening === '' ? 0 : Number(opening)
      })
      onDone?.(updated)
      onClose()
    } catch (err) {
      triggerCustomAlert?.('تعذّر حفظ الرصيد الافتتاحي: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <div
        className="modal-content modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-supplier-title"
        style={{ width: 480 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Truck size={22} />
          </span>
          <h2 id="edit-supplier-title">تعديل بيانات المورد</h2>
          <p>الفواتير والمدفوعات السابقة لا تتغير.</p>
        </div>
        <form className="stack" onSubmit={saveContact}>
          <label className="field">
            <span className="field-label">اسم المورد *</span>
            <input
              className="input"
              required
              maxLength={120}
              value={form.name}
              onChange={set('name')}
            />
          </label>
          <label className="field">
            <span className="field-label">رقم الهاتف</span>
            <input className="input" maxLength={40} value={form.phone} onChange={set('phone')} />
          </label>
          <label className="field">
            <span className="field-label">العنوان</span>
            <input
              className="input"
              maxLength={300}
              value={form.address}
              onChange={set('address')}
            />
          </label>
          <label className="field">
            <span className="field-label">اسم المندوب</span>
            <input
              className="input"
              maxLength={120}
              value={form.contact_person}
              onChange={set('contact_person')}
            />
          </label>
          <div className="modal-footer">
            <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>
              حفظ البيانات
            </button>
          </div>
        </form>
        {canOpening && (
          <section className="stack">
            <hr />
            <p>
              الرصيد الافتتاحي الحالي: <BalanceText value={startOpening} />
            </p>
            <OpeningBalanceField value={opening} onChange={setOpening} name="edit-opening-dir" />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={saveOpening}
              disabled={busy || Number(opening || 0) === startOpening}
            >
              حفظ الرصيد الافتتاحي
            </button>
          </section>
        )}
      </div>
    </div>
  )
}
