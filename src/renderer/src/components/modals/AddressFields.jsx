import { MapPin, Plus, X, Star } from 'lucide-react'
import { ADDRESS_LABELS, MAX_ADDRESSES } from '../../../../shared/address.mjs'
import { blankAddress } from '../../lib/addressForm'

/**
 * A customer's delivery addresses (1.4.0): optional, at most three, one default. `form.addresses`
 * holds the rows; `setForm` updates the form. The service applies the same rules
 * (src/shared/address.mjs) when saving.
 */
export default function AddressFields({ form, setForm, idPrefix }) {
  const list = form.addresses || []
  const setList = (next) => setForm((prev) => ({ ...prev, addresses: next }))
  const change = (key, patch) => setList(list.map((a) => (a.key === key ? { ...a, ...patch } : a)))
  const makeDefault = (key) => setList(list.map((a) => ({ ...a, isDefault: a.key === key })))
  const remove = (key) => {
    const rest = list.filter((a) => a.key !== key)
    if (rest.length && !rest.some((a) => a.isDefault)) rest[0] = { ...rest[0], isDefault: true }
    setList(rest)
  }

  return (
    <fieldset className="address-fields">
      <legend>عناوين التوصيل (ثلاثة على الأكثر – اختياري)</legend>
      {list.length === 0 && (
        <p className="field-hint">لا توجد عناوين. العميل لا يحتاج عنواناً إلا للتوصيل.</p>
      )}
      {list.map((a, i) => (
        <div key={a.key} className={`address-row ${a.isDefault ? 'is-default' : ''}`}>
          <div className="address-row-head">
            <MapPin size={15} aria-hidden="true" />
            <select
              className="form-input address-label"
              aria-label={`نوع العنوان ${i + 1}`}
              value={a.label}
              onChange={(e) => change(a.key, { label: e.target.value })}
            >
              {Object.entries(ADDRESS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`btn btn-sm ${a.isDefault ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => makeDefault(a.key)}
              aria-pressed={a.isDefault}
              title="العنوان الافتراضي للتوصيل"
            >
              <Star size={14} aria-hidden="true" />
              {a.isDefault ? 'افتراضي' : 'جعله افتراضياً'}
            </button>
            <button
              type="button"
              className="icon-btn danger"
              onClick={() => remove(a.key)}
              aria-label={`حذف العنوان ${i + 1}`}
              title="حذف العنوان"
            >
              <X size={16} />
            </button>
          </div>
          <input
            id={`${idPrefix}-address-${i}`}
            className="form-input"
            value={a.address}
            maxLength={300}
            onChange={(e) => change(a.key, { address: e.target.value })}
            placeholder="مثال: مدينة نصر، شارع عباس العقاد"
            aria-label={`العنوان ${i + 1}`}
          />
          <input
            className="form-input"
            value={a.details || ''}
            maxLength={200}
            onChange={(e) => change(a.key, { details: e.target.value })}
            placeholder="تفاصيل (الدور، الشقة، علامة مميزة) – اختياري"
            aria-label={`تفاصيل العنوان ${i + 1}`}
          />
        </div>
      ))}
      {list.length < MAX_ADDRESSES && (
        <button
          type="button"
          className="btn btn-ghost btn-sm address-add"
          onClick={() => setList([...list, blankAddress(list.length === 0)])}
        >
          <Plus size={15} aria-hidden="true" />
          إضافة عنوان
        </button>
      )}
    </fieldset>
  )
}
