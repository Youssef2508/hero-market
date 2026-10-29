import { useEffect, useState } from 'react'
import { BadgePercent, Plus, Pencil, Power } from 'lucide-react'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { Timestamp, EmptyState, NumberField } from '../ui'

const EMPTY = {
  id: null,
  version: null,
  name: '',
  scope: 'cart',
  productBarcode: '',
  valueType: 'percent',
  value: '',
  minTotal: '',
  startsAt: '',
  endsAt: '',
  isActive: true
}

const toInput = (ts) => (ts ? String(ts).replace(' ', 'T').slice(0, 16) : '')
const describe = (r) => {
  const v = r.value_type === 'percent' ? `${Number(r.value)}%` : `${formatMoney(r.value)} ج.م`
  if (r.scope === 'product')
    return `${v} ${r.value_type === 'amount' ? `لكل ${r.product_unit || 'وحدة'} ` : ''}على ${r.product_name || r.product_barcode}`
  return `${v} على الفاتورة عند ${formatMoney(r.min_total)} ج.م أو أكثر`
}

// Discount rules – the administrator's alone (permission discounts.manage). Checkout applies active
// rules automatically: the cashier never chooses, enters or removes a discount.
export default function DiscountsTab({ triggerCustomAlert }) {
  const [rules, setRules] = useState(null)
  const [form, setForm] = useState(null)
  const [productName, setProductName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () =>
    api('discounts.list')
      .then(setRules)
      .catch((e) => triggerCustomAlert(e.message))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const edit = (r) => {
    setProductName(r ? r.product_name || '' : '')
    setForm(
      r
        ? {
            id: r.id,
            version: r.version,
            name: r.name,
            scope: r.scope,
            productBarcode: r.product_barcode || '',
            valueType: r.value_type,
            value: String(Number(r.value)),
            minTotal: r.scope === 'cart' ? String(Number(r.min_total)) : '',
            startsAt: toInput(r.starts_at),
            endsAt: toInput(r.ends_at),
            isActive: r.is_active
          }
        : { ...EMPTY }
    )
  }
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const findProduct = async () => {
    setProductName('')
    if (!form.productBarcode.trim()) return
    try {
      const p = await api('products.get', { barcode: form.productBarcode.trim() })
      setProductName(
        p ? `${p.name} (${formatMoney(p.retail_price)} ج.م / ${p.unit || 'وحدة'})` : 'غير موجود'
      )
    } catch (e) {
      setProductName(e.message)
    }
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('discounts.save', {
        id: form.id,
        version: form.version,
        name: form.name.trim(),
        scope: form.scope,
        productBarcode: form.scope === 'product' ? form.productBarcode.trim() : null,
        valueType: form.valueType,
        value: parseFloat(form.value),
        minTotal: form.scope === 'cart' ? parseFloat(form.minTotal) || 0 : 0,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
        isActive: form.isActive
      })
      setForm(null)
      await load()
    } catch (err) {
      triggerCustomAlert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (r) => {
    try {
      await api('discounts.setActive', { id: r.id, isActive: !r.is_active })
      await load()
    } catch (err) {
      triggerCustomAlert(err.message)
    }
  }

  return (
    <section className="card">
      <div className="card-header toolbar">
        <p className="text-muted">
          تُطبَّق الخصومات تلقائياً عند البيع لكل من يستخدم شاشة الكاشير. لا يستطيع الكاشير إدخال
          خصم أو إلغاؤه. خصم الصنف يُحسب أولاً، ثم يُقارن إجمالي الفاتورة بعده بحد خصم الفاتورة،
          ويُطبَّق أفضل خصم واحد من كل نوع.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => edit(null)}>
          <Plus size={16} aria-hidden="true" />
          خصم جديد
        </button>
      </div>

      {rules === null ? (
        <div className="loading-state" role="status">
          <span className="spinner" />
          جاري التحميل...
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={BadgePercent}
          title="لا توجد خصومات"
          text="أضف خصماً على صنف أو على إجمالي الفاتورة."
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الخصم</th>
              <th>الفترة</th>
              <th>الحالة</th>
              <th>آخر تعديل</th>
              <th aria-label="إجراءات" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className={r.is_active ? '' : 'is-muted-row'}>
                <td className="cell-strong">{r.name}</td>
                <td>{describe(r)}</td>
                <td className="cell-muted">
                  {r.starts_at ? <Timestamp value={r.starts_at} /> : 'من الآن'} ←{' '}
                  {r.ends_at ? <Timestamp value={r.ends_at} /> : 'بدون نهاية'}
                </td>
                <td>
                  <span
                    className={`badge ${r.in_force ? 'badge-success' : r.is_active ? 'badge-warning' : 'badge-danger'}`}
                  >
                    {r.in_force ? 'ساري' : r.is_active ? 'مجدول / منتهٍ' : 'متوقف'}
                  </span>
                </td>
                <td className="cell-muted">
                  {r.updated_by_name || r.created_by_name || '—'}{' '}
                  <Timestamp value={r.updated_at || r.created_at} />
                </td>
                <td>
                  <div className="cell-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => edit(r)}
                    >
                      <Pencil size={15} aria-hidden="true" />
                      تعديل
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => toggle(r)}
                      aria-label={`${r.is_active ? 'إيقاف' : 'تفعيل'} ${r.name}`}
                    >
                      <Power size={15} aria-hidden="true" />
                      {r.is_active ? 'إيقاف' : 'تفعيل'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form && (
        <div className="modal-overlay">
          <form
            className="modal-content modal-scroll"
            role="dialog"
            aria-modal="true"
            aria-labelledby="discount-form-title"
            style={{ width: 520 }}
            onSubmit={save}
          >
            <div className="modal-header">
              <span className="modal-icon" aria-hidden="true">
                <BadgePercent size={22} />
              </span>
              <h2 id="discount-form-title">{form.id ? 'تعديل خصم' : 'خصم جديد'}</h2>
            </div>
            <div className="modal-body form-grid">
              <label className="field">
                <span className="field-label">اسم الخصم (يظهر في الفاتورة)</span>
                <input
                  className="input"
                  required
                  maxLength={80}
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">على</span>
                <select
                  className="input"
                  value={form.scope}
                  onChange={(e) => set({ scope: e.target.value })}
                >
                  <option value="cart">إجمالي الفاتورة (عند حد معيّن)</option>
                  <option value="product">صنف محدد</option>
                </select>
              </label>
              {form.scope === 'product' ? (
                <label className="field">
                  <span className="field-label">باركود الصنف</span>
                  <input
                    className="input ltr"
                    dir="ltr"
                    required
                    value={form.productBarcode}
                    onChange={(e) => set({ productBarcode: e.target.value })}
                    onBlur={findProduct}
                  />
                  {productName && <span className="field-hint">{productName}</span>}
                </label>
              ) : (
                <label className="field">
                  <span className="field-label">
                    يُطبَّق عندما يصل الإجمالي (بعد خصومات الأصناف) إلى (ج.م)
                  </span>
                  <NumberField
                    className="input num"
                    min="0"
                    step="0.01"
                    required
                    value={form.minTotal}
                    onChange={(e) => set({ minTotal: e.target.value })}
                  />
                </label>
              )}
              <label className="field">
                <span className="field-label">نوع الخصم</span>
                <select
                  className="input"
                  value={form.valueType}
                  onChange={(e) => set({ valueType: e.target.value })}
                >
                  <option value="percent">نسبة مئوية %</option>
                  <option value="amount">
                    {form.scope === 'product' ? 'مبلغ لكل وحدة أساسية (قطعة / كجم)' : 'مبلغ ثابت'}
                  </option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">
                  {form.valueType === 'percent' ? 'النسبة %' : 'المبلغ (ج.م)'}
                </span>
                <NumberField
                  className="input num"
                  min="0.01"
                  max={form.valueType === 'percent' ? 100 : undefined}
                  step="0.01"
                  required
                  value={form.value}
                  onChange={(e) => set({ value: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">يبدأ في (اختياري)</span>
                <input
                  className="input"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) => set({ startsAt: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">ينتهي في (اختياري)</span>
                <input
                  className="input"
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => set({ endsAt: e.target.value })}
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => set({ isActive: e.target.checked })}
                />
                <span>مفعّل</span>
              </label>
            </div>
            <div className="modal-footer">
              <button
                data-modal-close
                type="button"
                className="btn btn-secondary"
                onClick={() => setForm(null)}
              >
                إلغاء
              </button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>
                حفظ الخصم
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
