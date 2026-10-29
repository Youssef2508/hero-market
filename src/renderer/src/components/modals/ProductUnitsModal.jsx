import { useEffect, useState } from 'react'
import { Boxes, Plus, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { kindInfo } from '../../lib/measureKinds'
import { NumberField } from '../ui'

const splitCodes = (text) =>
  String(text || '')
    .split(/[\s,،]+/)
    .map((c) => c.trim())
    .filter(Boolean)

const KIND_HINT = {
  count: 'المعامل عدد صحيح من الوحدة الأساسية (مثلاً الكرتونة = 24 قطعة).',
  weight: 'المعامل بالكيلوجرام (مثلاً نصف كيلو = 0.5).',
  volume: 'المعامل باللتر (مثلاً زجاجة 1.5 لتر = 1.5).'
}

// Units and packaging of one product: extra barcodes of the base unit, and units such as box or
// carton with a conversion factor, their own barcodes and an optional own price. Saved as a whole
// (productUnits.save); units removed here stay in history but can no longer be sold or bought.
export default function ProductUnitsModal({ product, onClose, onSaved }) {
  const [baseCodes, setBaseCodes] = useState('')
  const [units, setUnits] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const kind = product?.unit_kind || 'count'
  const decimals = kindInfo(kind).decimals

  useEffect(() => {
    if (!product) return
    api('productUnits.get', { barcode: product.barcode })
      .then((r) => {
        setBaseCodes(r.baseBarcodes.join(' '))
        setUnits(
          r.units.map((u) => ({
            id: u.id,
            name: u.name,
            factor: String(Number(u.factor)),
            retail_auto: u.retail_auto !== false,
            retail_price: u.retail_price === null ? '' : String(Number(u.retail_price)),
            purchase_cost: u.purchase_cost === null ? '' : String(Number(u.purchase_cost)),
            sellable: u.sellable,
            purchasable: u.purchasable,
            codes: u.barcodes.join(' ')
          }))
        )
      })
      .catch((e) => setError(e.message))
  }, [product])

  if (!product) return null

  const update = (i, patch) =>
    setUnits((list) => list.map((u, j) => (j === i ? { ...u, ...patch } : u)))
  const basePrice = Number(product.retail_price) || 0

  const save = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('productUnits.save', {
        barcode: product.barcode,
        baseBarcodes: splitCodes(baseCodes),
        units: units.map((u) => ({
          id: u.id ?? null,
          name: u.name.trim(),
          factor: parseFloat(u.factor),
          // D-096: automatic follows the piece price × the factor; otherwise the typed price.
          retail_auto: u.retail_auto,
          retail_price: u.retail_auto || u.retail_price === '' ? null : parseFloat(u.retail_price),
          purchase_cost: u.purchase_cost === '' ? null : parseFloat(u.purchase_cost),
          sellable: u.sellable,
          purchasable: u.purchasable,
          barcodes: splitCodes(u.codes)
        }))
      })
      if (onSaved) onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay">
      <form
        className="modal-content modal-xl modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-units-title"
        onSubmit={save}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Boxes size={22} />
          </span>
          <h2 id="product-units-title">الوحدات والعبوات</h2>
          <p>
            {product.name} — الوحدة الأساسية: <strong>{product.unit || 'بدون اسم'}</strong> (
            {formatMoney(basePrice)} ج.م)
          </p>
        </div>

        <div className="modal-body">
          <label className="field">
            <span className="field-label">باركودات إضافية للوحدة الأساسية</span>
            <input
              className="input ltr"
              dir="ltr"
              value={baseCodes}
              onChange={(e) => setBaseCodes(e.target.value)}
              placeholder="مفصولة بمسافة أو فاصلة"
            />
          </label>

          <p className="cell-muted">
            {KIND_HINT[kind] ||
              `المعامل بال${kindInfo(kind).unit || 'وحدة الأساسية'} (${decimals === 0 ? 'عدد صحيح' : `حتى ${decimals} خانات عشرية`}).`}{' '}
            سعر بيع العبوة «تلقائي» = سعر بيع الوحدة × المعامل، ويتغير معه دائماً؛ ألغِ «تلقائي»
            لتكتب سعراً خاصاً يبقى كما كتبته، وعلّمه مرة أخرى لاستعادة السعر التلقائي. سعر شراء
            العبوة يتحدّث مع كل فاتورة شراء (بالقطعة أو بالعبوة). المخزون كمية واحدة بالوحدة
            الأساسية: بيع عبوة يخصم المعامل منها.
          </p>

          {units === null ? (
            <div className="loading-state" role="status">
              <span className="spinner" />
              جاري التحميل...
            </div>
          ) : (
            <table className="data-table fit-table">
              <colgroup>
                <col style={{ width: '17%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '8%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>اسم الوحدة</th>
                  <th>المعامل</th>
                  <th>سعر بيع العبوة</th>
                  <th>سعر شراء العبوة</th>
                  <th>الباركودات</th>
                  <th>بيع</th>
                  <th>شراء</th>
                  <th aria-label="حذف" />
                </tr>
              </thead>
              <tbody>
                {units.map((u, i) => {
                  const f = parseFloat(u.factor)
                  const derived = Number.isFinite(f) ? Math.round(basePrice * f * 100) / 100 : null
                  return (
                    <tr key={u.id ?? `new-${i}`}>
                      <td>
                        <input
                          className="input"
                          required
                          value={u.name}
                          onChange={(e) => update(i, { name: e.target.value })}
                          aria-label="اسم الوحدة"
                        />
                      </td>
                      <td>
                        <NumberField
                          className="input num"
                          required
                          min={decimals === 0 ? 2 : 10 ** -decimals}
                          step={decimals === 0 ? 1 : 10 ** -decimals}
                          value={u.factor}
                          onChange={(e) => update(i, { factor: e.target.value })}
                          aria-label={`معامل ${u.name}`}
                        />
                      </td>
                      <td>
                        <label className="check-row unit-auto">
                          <input
                            type="checkbox"
                            checked={u.retail_auto}
                            onChange={(e) =>
                              update(i, {
                                retail_auto: e.target.checked,
                                // Typing starts from the automatic price.
                                retail_price:
                                  !e.target.checked && u.retail_price === '' && derived !== null
                                    ? String(derived)
                                    : u.retail_price
                              })
                            }
                            aria-label={`سعر بيع ${u.name} تلقائي`}
                          />
                          تلقائي
                        </label>
                        {u.retail_auto ? (
                          <output className="num cell-muted" aria-label={`سعر بيع ${u.name}`}>
                            {derived !== null ? formatMoney(derived) : '—'}
                          </output>
                        ) : (
                          <NumberField
                            className="input num"
                            min="0"
                            step="0.01"
                            required
                            value={u.retail_price}
                            onChange={(e) => update(i, { retail_price: e.target.value })}
                            title={
                              derived !== null
                                ? `السعر التلقائي: سعر القطعة × المعامل = ${formatMoney(derived)}`
                                : undefined
                            }
                            aria-label={`سعر بيع ${u.name}`}
                          />
                        )}
                      </td>
                      <td>
                        <NumberField
                          className="input num"
                          min="0"
                          step="0.01"
                          value={u.purchase_cost}
                          onChange={(e) => update(i, { purchase_cost: e.target.value })}
                          aria-label={`سعر شراء ${u.name}`}
                        />
                      </td>
                      <td>
                        <input
                          className="input ltr"
                          dir="ltr"
                          value={u.codes}
                          onChange={(e) => update(i, { codes: e.target.value })}
                          aria-label={`باركودات ${u.name}`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={u.sellable}
                          onChange={(e) => update(i, { sellable: e.target.checked })}
                          aria-label={`${u.name} للبيع`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={u.purchasable}
                          onChange={(e) => update(i, { purchasable: e.target.checked })}
                          aria-label={`${u.name} للشراء`}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => setUnits((list) => list.filter((_, j) => j !== i))}
                          aria-label={`حذف ${u.name}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() =>
              setUnits((list) => [
                ...(list || []),
                {
                  id: null,
                  name: '',
                  factor: '',
                  retail_auto: true,
                  retail_price: '',
                  purchase_cost: '',
                  sellable: true,
                  purchasable: true,
                  codes: ''
                }
              ])
            }
          >
            <Plus size={15} aria-hidden="true" />
            إضافة وحدة
          </button>

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
            disabled={busy || units === null}
          >
            حفظ الوحدات
          </button>
        </div>
      </form>
    </div>
  )
}
