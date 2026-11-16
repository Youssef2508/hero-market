import { useState } from 'react'
import { AlertTriangle, PencilLine, Replace, Trash2 } from 'lucide-react'
import { api, isDeferred, newClientRef } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import ProductPicker from './ProductPicker'
import { NumberField } from '../ui'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const KEPT = {
  later_purchase: 'يبقى: للصنف فاتورة شراء أحدث',
  changed_since: 'يبقى: عُدّل سعر الشراء بعد هذه الفاتورة'
}

/** The product's purchasable units (base first), for a line's unit choice. */
async function unitsOf(product) {
  const extra = await api('productUnits.get', { barcode: product.barcode })
    .then((r) => r.units.filter((u) => u.purchasable))
    .catch(() => [])
  return [
    { id: null, name: product.unit || 'الوحدة الأساسية', factor: 1 },
    ...extra.map((u) => ({ id: u.id, name: u.name, factor: Number(u.factor) }))
  ]
}

/**
 * Correcting a recorded purchase invoice to what was actually delivered (owner, 1.8.0, D-112):
 * add, remove or replace a product, correct quantities, units, prices and the discount. Nothing is
 * saved before the preview, which shows the corrected total, the supplier's balance before and
 * after, every product's stock change (below zero is said), its purchase price and what was sold
 * since. The service computes the preview with the same work as saving, so they never differ.
 */
export default function PurchaseRevisionModal({ detail, onClose, onSaved, triggerCustomAlert }) {
  const p = detail.purchase
  const [lines, setLines] = useState(() =>
    detail.items.map((l) => ({
      key: `i${l.id}`,
      itemId: l.id,
      barcode: l.barcode,
      name: l.name,
      unitId: l.unit_id ?? null,
      units: [{ id: l.unit_id ?? null, name: l.unit_name || 'الوحدة', factor: l.unit_factor }],
      qty: String(l.qty),
      unitCost: String(l.unit_cost),
      returned: Number(l.returned) || 0
    }))
  )
  const [discount, setDiscount] = useState(String(p.discount || 0))
  const [total, setTotal] = useState(String(p.total_amount))
  const [invoiceRef, setInvoiceRef] = useState(p.invoice_ref || '')
  const [notes, setNotes] = useState(p.notes || '')
  const [reason, setReason] = useState('')
  const [replacing, setReplacing] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [clientRef] = useState(newClientRef)
  const totalOnly = !detail.items.length

  const changed = () => setPreview(null)
  const setLine = (key, patch) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    changed()
  }
  const gross = round2(
    lines.reduce((a, l) => a + round2((parseFloat(l.qty) || 0) * (parseFloat(l.unitCost) || 0)), 0)
  )
  const net = totalOnly
    ? round2(parseFloat(total) || 0)
    : round2(gross - (parseFloat(discount) || 0))

  // A product chosen in the picker: a new line, or the replacement of the line being replaced.
  const pick = async (barcode, row) => {
    setError('')
    const product = row || (await api('products.get', { barcode }).catch(() => null))
    if (!product) {
      setError(`الصنف (${barcode}) غير مسجل.`)
      return false
    }
    const units = await unitsOf(product)
    const base = {
      barcode: product.barcode,
      name: product.name,
      unitId: null,
      units,
      unitCost: product.cost_price !== undefined ? String(Number(product.cost_price) || 0) : ''
    }
    if (replacing) {
      setLine(replacing, base)
      setReplacing(null)
    } else {
      setLines((ls) => [
        ...ls,
        { key: `n${Date.now()}`, itemId: null, qty: '1', returned: 0, ...base }
      ])
      changed()
    }
    return true
  }

  const body = () => ({
    purchaseId: p.id,
    expectedRevision: Number(p.revision) || 0,
    items: lines.map((l) => ({
      itemId: l.itemId,
      barcode: l.barcode,
      unitId: l.unitId,
      qty: parseFloat(l.qty) || 0,
      unitCost: parseFloat(l.unitCost) || 0
    })),
    discount: totalOnly ? null : round2(parseFloat(discount) || 0),
    total: totalOnly ? round2(parseFloat(total) || 0) : null,
    invoiceRef: invoiceRef.trim(),
    notes: notes.trim(),
    reason: reason.trim() || null
  })
  const valid =
    (totalOnly || (lines.length > 0 && lines.every((l) => parseFloat(l.qty) > 0))) && net > 0

  const runPreview = async () => {
    setError('')
    setBusy(true)
    try {
      setPreview(await api('suppliers.previewRevision', body()))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await api('suppliers.revisePurchase', { ...body(), clientRef })
      triggerCustomAlert?.(
        isDeferred(res)
          ? `تصحيح الفاتورة: ${res.message}`
          : `تم تصحيح الفاتورة (المراجعة ${res.revision}). الصافي ${formatMoney(res.newTotal)} ج.م بدل ${formatMoney(res.oldTotal)}.`
      )
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message)
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 100000 }}>
      <div
        className="modal-content modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-revision-title"
        style={{ width: 'min(980px, calc(100vw - 32px))' }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <PencilLine size={22} />
          </span>
          <h2 id="purchase-revision-title">
            تصحيح فاتورة الشراء <span className="ltr-id">{p.invoice_ref || `#${p.id}`}</span>
          </h2>
          <p>
            {p.supplier_name} · الصافي الحالي {formatMoney(p.total_amount)} ج.م · مدفوع{' '}
            {formatMoney(p.paid_amount)} ج.م
            {Number(p.revision) > 0 && ` · المراجعة ${p.revision}`}
          </p>
        </div>
        <div className="modal-body stack">
          <p className="field-hint">
            صحّح الفاتورة بما استُلم فعلاً. يتغير المخزون بحركة تصحيح لكل صنف، ويتغير حساب المورد
            بفرق الصافي، ولا تتغير المدفوعات ولا المبيعات السابقة. اعرض المعاينة قبل الحفظ.
          </p>
          {totalOnly ? (
            <label className="field">
              <span className="field-label">صافي الفاتورة (سُجّلت بالمبلغ فقط)</span>
              <NumberField
                className="input num"
                min="0"
                step="0.01"
                value={total}
                onChange={(e) => {
                  setTotal(e.target.value)
                  changed()
                }}
              />
            </label>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table table-compact">
                  <caption className="visually-hidden">أصناف الفاتورة بعد التصحيح</caption>
                  <thead>
                    <tr>
                      <th>الصنف</th>
                      <th>الوحدة</th>
                      <th className="num">الكمية</th>
                      <th className="num">سعر الوحدة</th>
                      <th className="num">الإجمالي</th>
                      <th>
                        <span className="visually-hidden">إجراءات</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const locked = l.returned > 0
                      return (
                        <tr key={l.key} className={replacing === l.key ? 'is-selected' : undefined}>
                          <td>
                            {l.name}
                            <div className="cell-muted">
                              <span className="ltr-id">{l.barcode}</span>
                              {locked && ` · أُرجع ${l.returned}`}
                              {!l.itemId && ' · جديد'}
                            </div>
                          </td>
                          <td>
                            <select
                              className="input"
                              value={l.unitId ?? ''}
                              disabled={locked || l.units.length < 2}
                              aria-label={`وحدة ${l.name}`}
                              onChange={(e) =>
                                setLine(l.key, {
                                  unitId: e.target.value === '' ? null : Number(e.target.value)
                                })
                              }
                            >
                              {l.units.map((u) => (
                                <option key={u.id ?? 'base'} value={u.id ?? ''}>
                                  {u.name}
                                  {u.factor > 1 ? ` (${u.factor})` : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="num">
                            <NumberField
                              className="input num"
                              min={locked ? l.returned : 0}
                              step="any"
                              value={l.qty}
                              aria-label={`كمية ${l.name}`}
                              onChange={(e) => setLine(l.key, { qty: e.target.value })}
                            />
                          </td>
                          <td className="num">
                            <NumberField
                              className="input num"
                              min="0"
                              step="0.01"
                              value={l.unitCost}
                              aria-label={`سعر ${l.name}`}
                              onChange={(e) => setLine(l.key, { unitCost: e.target.value })}
                            />
                          </td>
                          <td className="num">
                            {formatMoney((parseFloat(l.qty) || 0) * (parseFloat(l.unitCost) || 0))}
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="icon-btn"
                                disabled={locked}
                                title={locked ? 'أُرجع من هذا الصنف: يبقى كما هو' : 'استبدال الصنف'}
                                aria-label={`استبدال ${l.name}`}
                                onClick={() => setReplacing(replacing === l.key ? null : l.key)}
                              >
                                <Replace size={15} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="icon-btn danger"
                                disabled={locked}
                                title={locked ? 'أُرجع من هذا الصنف: لا يُحذف' : 'حذف السطر'}
                                aria-label={`حذف ${l.name}`}
                                onClick={() => {
                                  setLines((ls) => ls.filter((x) => x.key !== l.key))
                                  changed()
                                }}
                              >
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <ProductPicker
                added={replacing ? [] : lines.map((l) => l.barcode)}
                onPick={pick}
                label={replacing ? 'اختر الصنف الذي استُلم بدلاً منه' : 'إضافة صنف استُلم'}
              />
              <div className="row">
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">خصم الفاتورة (ج.م)</span>
                  <NumberField
                    className="input num"
                    min="0"
                    step="0.01"
                    value={discount}
                    onChange={(e) => {
                      setDiscount(e.target.value)
                      changed()
                    }}
                  />
                </label>
                <dl className="kv" style={{ flex: 2 }}>
                  <dt>إجمالي الأصناف</dt>
                  <dd className="num">{formatMoney(gross)} ج.م</dd>
                  <dt>الصافي بعد التصحيح</dt>
                  <dd className="num money-strong">{formatMoney(net)} ج.م</dd>
                </dl>
              </div>
            </>
          )}
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span className="field-label">رقم الفاتورة (مرجع)</span>
              <input
                className="input"
                maxLength={80}
                value={invoiceRef}
                onChange={(e) => {
                  setInvoiceRef(e.target.value)
                  changed()
                }}
              />
            </label>
            <label className="field" style={{ flex: 2 }}>
              <span className="field-label">سبب التصحيح (اختياري)</span>
              <input
                className="input"
                maxLength={300}
                value={reason}
                placeholder="مثال: استُلم سكر بدلاً من الأرز"
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">ملاحظات</span>
            <textarea
              className="input"
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                changed()
              }}
            />
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {preview && <RevisionPreview preview={preview} />}
        </div>
        <div className="modal-footer">
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || !valid}
            onClick={runPreview}
          >
            معاينة التأثير
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={busy || !preview}
            title={preview ? undefined : 'اعرض المعاينة أولاً'}
            onClick={save}
          >
            حفظ التصحيح
          </button>
        </div>
      </div>
    </div>
  )
}

/** What the correction does, as the service computed it. */
export function RevisionPreview({ preview: r }) {
  const negative = r.stockChanges.filter((s) => s.after < 0)
  return (
    <section className="card" aria-label="تأثير التصحيح">
      <div className="card-body stack">
        <dl className="kv">
          <dt>الصافي</dt>
          <dd className="num">
            {formatMoney(r.oldTotal)} ← <strong>{formatMoney(r.newTotal)}</strong> ج.م
          </dd>
          <dt>الفرق على حساب المورد</dt>
          <dd className={`num money-strong ${r.delta > 0 ? 'text-danger' : 'text-success'}`}>
            {r.delta > 0 ? '+' : ''}
            {formatMoney(r.delta)} ج.م
          </dd>
          <dt>رصيد المورد</dt>
          <dd className="num">
            {formatMoney(r.supplierBalanceBefore)} ← {formatMoney(r.supplierBalanceAfter)} ج.م
            {r.supplierBalanceAfter < 0 && ' (المورد مدين للمتجر)'}
          </dd>
          <dt>المتبقي لهذه الفاتورة</dt>
          <dd className="num">
            {r.outstanding < 0
              ? `${formatMoney(-r.outstanding)} ج.م للمتجر عند المورد (دُفع أكثر من الصافي)`
              : `${formatMoney(r.outstanding)} ج.م`}
          </dd>
        </dl>
        {r.stockChanges.length > 0 && (
          <div className="table-wrap">
            <table className="table table-compact">
              <caption>المخزون (بالوحدة الأساسية)</caption>
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th className="num">قبل</th>
                  <th className="num">التغيير</th>
                  <th className="num">بعد</th>
                </tr>
              </thead>
              <tbody>
                {r.stockChanges.map((s) => (
                  <tr key={s.barcode}>
                    <td>
                      {s.name} <span className="ltr-id cell-muted">{s.barcode}</span>
                    </td>
                    <td className="num">{s.before}</td>
                    <td className="num">
                      {s.change > 0 ? '+' : ''}
                      {s.change}
                    </td>
                    <td className={`num ${s.after < 0 ? 'text-danger' : ''}`}>{s.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {negative.length > 0 && (
          <p className="field-error">
            <AlertTriangle size={15} aria-hidden="true" /> سيصبح مخزون{' '}
            {negative.map((s) => `«${s.name}»`).join('، ')} أقل من صفر: بِيع منه أكثر مما استُلم
            فعلاً. راجع الجرد بعد التصحيح.
          </p>
        )}
        {r.costChanges.length > 0 && (
          <ul className="bullet-list">
            {r.costChanges.map((c) => (
              <li key={c.barcode}>
                سعر شراء «{c.name}»:{' '}
                {c.kept ? KEPT[c.kept] : `${formatMoney(c.from)} ← ${formatMoney(c.to)} ج.م`}
              </li>
            ))}
          </ul>
        )}
        {r.soldSince.length > 0 && (
          <p className="field-hint">
            بِيع منذ هذه الفاتورة: {r.soldSince.map((s) => `«${s.name}» ${s.qty}`).join('، ')}. تبقى
            تكلفة تلك المبيعات وربحها كما سُجّلت وقت البيع.
          </p>
        )}
      </div>
    </section>
  )
}
