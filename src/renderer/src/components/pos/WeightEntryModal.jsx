import { useState } from 'react'
import { Scale } from 'lucide-react'
import { formatMoney } from '../../lib/utils'

// Weight entry for products sold by the kilogram when no scale label was scanned. The cashier types
// grams (default) or kilograms; the line keeps kilograms with three decimals.
export default function WeightEntryModal({ pending, onDone }) {
  const [value, setValue] = useState('')
  const [inGrams, setInGrams] = useState(true)
  const raw = parseFloat(String(value).replace(',', '.'))
  const kg =
    Number.isFinite(raw) && raw > 0 ? Math.round((inGrams ? raw / 1000 : raw) * 1000) / 1000 : 0
  const price = Number(pending.unit.price) || 0
  const total = Math.round(kg * price * 100) / 100

  const submit = (e) => {
    e.preventDefault()
    if (kg > 0) onDone(kg)
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 99998 }}>
      <form
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weight-entry-title"
        style={{ width: 400 }}
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone(null)
        }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Scale size={22} />
          </span>
          <h2 id="weight-entry-title">إدخال الوزن</h2>
          <p>
            {pending.product.name} — {formatMoney(price)} ج.م / {pending.unit.name || 'كجم'}
          </p>
        </div>
        <div className="modal-body">
          <div className="row">
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              className="input input-lg input-money"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={inGrams ? 'مثلاً 250' : 'مثلاً 0.250'}
              aria-label={inGrams ? 'الوزن بالجرام' : 'الوزن بالكيلوجرام'}
              autoFocus
            />
            <div className="segmented" role="group" aria-label="وحدة الوزن">
              <button type="button" aria-pressed={inGrams} onClick={() => setInGrams(true)}>
                جم
              </button>
              <button type="button" aria-pressed={!inGrams} onClick={() => setInGrams(false)}>
                كجم
              </button>
            </div>
          </div>
          <dl className="kv">
            <dt>الوزن</dt>
            <dd className="num">{kg.toFixed(3)} كجم</dd>
            <dt>السعر</dt>
            <dd className="num">{formatMoney(total)} ج.م</dd>
          </dl>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={() => onDone(null)}>
            إلغاء
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={!(kg > 0)}
          >
            إضافة للسلة
          </button>
        </div>
      </form>
    </div>
  )
}
