import { Phone, Plus, X } from 'lucide-react'
import { normalizePhone } from '../../../../shared/phone.mjs'

/**
 * A customer's phone numbers: the primary number and an optional second one (at most two).
 * `form` holds phone, phone2 and hasPhone2; `setForm` updates it. Messages use the same rule the
 * service applies when saving (src/shared/phone.mjs).
 */
export default function PhoneFields({ form, setForm, idPrefix }) {
  const first = normalizePhone(form.phone)
  const second = normalizePhone(form.phone2)
  const same = form.hasPhone2 && first.value && second.value && first.value === second.value
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }))

  return (
    <fieldset className="phone-fields">
      <legend>أرقام الهاتف (رقمان على الأكثر)</legend>
      <label className="form-group" htmlFor={`${idPrefix}-phone`}>
        <span>الرقم الأساسي</span>
        <div className="phone-row">
          <Phone size={15} aria-hidden="true" />
          <input
            id={`${idPrefix}-phone`}
            type="tel"
            inputMode="tel"
            dir="ltr"
            className="form-input num"
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
            placeholder="01012345678"
            aria-invalid={Boolean(first.error)}
            aria-describedby={`${idPrefix}-phone-error`}
          />
        </div>
        <span id={`${idPrefix}-phone-error`} className="field-error" role="alert">
          {first.error}
        </span>
      </label>

      {form.hasPhone2 ? (
        <label className="form-group" htmlFor={`${idPrefix}-phone2`}>
          <span>الرقم الثاني (اختياري)</span>
          <div className="phone-row">
            <Phone size={15} aria-hidden="true" />
            <input
              id={`${idPrefix}-phone2`}
              type="tel"
              inputMode="tel"
              dir="ltr"
              className="form-input num"
              value={form.phone2}
              onChange={(e) => set({ phone2: e.target.value })}
              placeholder="01112345678"
              aria-invalid={Boolean(second.error || same)}
              aria-describedby={`${idPrefix}-phone2-error`}
              autoFocus
            />
            <button
              type="button"
              className="icon-btn danger"
              onClick={() => set({ hasPhone2: false, phone2: '' })}
              aria-label="حذف الرقم الثاني"
              title="حذف الرقم الثاني"
            >
              <X size={16} />
            </button>
          </div>
          <span id={`${idPrefix}-phone2-error`} className="field-error" role="alert">
            {second.error || (same ? 'الرقم الثاني مطابق للرقم الأول.' : '')}
          </span>
        </label>
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-sm phone-add"
          onClick={() => set({ hasPhone2: true, phone2: '' })}
          disabled={!form.phone || Boolean(first.error)}
          title={!form.phone ? 'أدخل الرقم الأساسي أولاً' : undefined}
        >
          <Plus size={15} aria-hidden="true" />
          إضافة رقم آخر
        </button>
      )}
    </fieldset>
  )
}
