import { useState } from 'react'
import { Scale, Ruler } from 'lucide-react'
import { formatMoney } from '../../lib/utils'
import { parseWeight } from '../../lib/weight'
import { kindInfo } from '../../lib/measureKinds'

const PRESETS = [100, 250, 500, 1000]

// Weight entry for products sold by the kilogram. The cashier weighs on an ordinary scale and types
// the weight in grams (default) or kilograms; the line keeps kilograms with three decimals. Also
// used to correct a line's weight before payment (no approval needed). Products measured in
// another kind with decimals (litres, or a kind the owner added such as metres) get a plain
// quantity entry in their own unit instead (1.4.0).
export default function WeightEntryModal({ pending, onDone }) {
  const kind = pending.product.unit_kind || 'count'
  return kind === 'weight' ? (
    <WeightEntry pending={pending} onDone={onDone} />
  ) : (
    <QuantityEntry pending={pending} onDone={onDone} kind={kindInfo(kind)} />
  )
}

const PLACES = { 1: 'خانة عشرية واحدة', 2: 'خانتين عشريتين', 3: 'ثلاث خانات عشرية' }

/** Quantity in the product's own unit, with at most the kind's decimals. */
function QuantityEntry({ pending, onDone, kind }) {
  const editing = Boolean(pending.editKey)
  const [value, setValue] = useState(editing ? String(pending.initialKg) : '')
  const unitName = pending.unit.name || kind.unit
  const q = Number(String(value).replace(',', '.'))
  const tooPrecise =
    value !== '' && Math.abs(q - Math.round(q * 10 ** kind.decimals) / 10 ** kind.decimals) > 1e-9
  const error =
    value === ''
      ? ''
      : !(q > 0)
        ? 'اكتب كمية أكبر من صفر.'
        : tooPrecise
          ? `الكمية تقبل ${PLACES[kind.decimals]} على الأكثر.`
          : ''
  const price = Number(pending.unit.price) || 0
  const total = q > 0 && !error ? Math.round(q * price * 100) / 100 : 0
  const submit = (e) => {
    e.preventDefault()
    if (!error && q > 0) onDone(q)
  }
  return (
    <div className="modal-overlay" style={{ zIndex: 99998 }}>
      <form
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qty-entry-title"
        style={{ width: 400 }}
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone(null)
        }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Ruler size={22} />
          </span>
          <h2 id="qty-entry-title">{editing ? 'تعديل الكمية' : 'إدخال الكمية'}</h2>
          <p>
            {pending.product.name} — {formatMoney(price)} ج.م / {unitName}
          </p>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">الكمية ({unitName})</span>
            <input
              type="number"
              inputMode="decimal"
              step={10 ** -kind.decimals}
              min="0"
              className="input input-lg input-money"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind.decimals ? (1.5).toFixed(kind.decimals) : '1'}
              aria-invalid={Boolean(error)}
              aria-describedby="qty-entry-error"
              autoFocus
              onFocus={(e) => e.target.select()}
            />
          </label>
          <p id="qty-entry-error" className="text-danger" role="alert">
            {error}
          </p>
          <dl className="kv">
            <dt>السعر</dt>
            <dd className="num">{formatMoney(total)} ج.م</dd>
          </dl>
        </div>
        <div className="modal-footer">
          <button
            data-modal-close
            type="button"
            className="btn btn-secondary"
            onClick={() => onDone(null)}
          >
            إلغاء
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={Boolean(error) || !(q > 0)}
          >
            {editing ? 'حفظ الكمية' : 'إضافة للسلة'}
          </button>
        </div>
      </form>
    </div>
  )
}

function WeightEntry({ pending, onDone }) {
  const editing = Boolean(pending.editKey)
  const [value, setValue] = useState(
    editing ? String(Math.round(Number(pending.initialKg) * 1000)) : ''
  )
  const [inGrams, setInGrams] = useState(true)
  const { kg, error } = parseWeight(value, inGrams ? 'g' : 'kg')
  const price = Number(pending.unit.price) || 0
  const total = Math.round(kg * price * 100) / 100

  const submit = (e) => {
    e.preventDefault()
    if (!error && kg > 0) onDone(kg)
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 99998 }}>
      <form
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weight-entry-title"
        style={{ width: 420 }}
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone(null)
        }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Scale size={22} />
          </span>
          <h2 id="weight-entry-title">{editing ? 'تعديل الوزن' : 'إدخال الوزن'}</h2>
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
              aria-invalid={Boolean(error)}
              aria-describedby="weight-entry-error"
              autoFocus
              onFocus={(e) => e.target.select()}
            />
            <div className="segmented" role="group" aria-label="وحدة الوزن">
              <button
                type="button"
                aria-pressed={inGrams}
                onClick={() => {
                  if (!inGrams && kg > 0) setValue(String(Math.round(kg * 1000)))
                  setInGrams(true)
                }}
              >
                جم
              </button>
              <button
                type="button"
                aria-pressed={!inGrams}
                onClick={() => {
                  if (inGrams && kg > 0) setValue(String(kg))
                  setInGrams(false)
                }}
              >
                كجم
              </button>
            </div>
          </div>
          <div className="row row-wrap" role="group" aria-label="أوزان سريعة">
            {PRESETS.map((g) => (
              <button
                key={g}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setInGrams(true)
                  setValue(String(g))
                }}
              >
                {g >= 1000 ? `${g / 1000} كجم` : `${g} جم`}
              </button>
            ))}
          </div>
          <p id="weight-entry-error" className="text-danger" role="alert">
            {error}
          </p>
          <dl className="kv">
            <dt>الوزن</dt>
            <dd className="num">{kg.toFixed(3)} كجم</dd>
            <dt>السعر</dt>
            <dd className="num">{formatMoney(total)} ج.م</dd>
          </dl>
        </div>
        <div className="modal-footer">
          <button
            data-modal-close
            type="button"
            className="btn btn-secondary"
            onClick={() => onDone(null)}
          >
            إلغاء
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={Boolean(error) || !(kg > 0)}
          >
            {editing ? 'حفظ الوزن' : 'إضافة للسلة'}
          </button>
        </div>
      </form>
    </div>
  )
}
