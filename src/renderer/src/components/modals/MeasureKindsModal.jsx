import { useEffect, useState } from 'react'
import { Ruler, Plus, Pencil, Trash2, Power } from 'lucide-react'
import { api } from '../../lib/api'
import { loadMeasureKinds, setMeasureKinds, useMeasureKinds } from '../../lib/measureKinds'

const PLACES = ['أعداد صحيحة فقط', 'خانة عشرية واحدة', 'خانتان عشريتان', '3 خانات عشرية']
const empty = { key: null, name: '', unit: '', decimals: 0 }

// Measurement kinds (1.4.0, migration 0014). The owner adds his own (e.g. "بالمتر": unit "متر",
// 2 decimals); the three built-in kinds cannot be changed. A kind in use is stopped, not deleted.
// `onCreated(key)` lets the product form select a kind just added.
export default function MeasureKindsModal({ onClose, onCreated }) {
  const kinds = useMeasureKinds()
  useEffect(() => {
    loadMeasureKinds() // fresh product counts
  }, [])
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editing = form.key !== null

  const run = async (op, body, after) => {
    setBusy(true)
    setError('')
    try {
      const r = await api(op, body)
      setMeasureKinds(r.kinds)
      if (after) after(r)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const save = (e) => {
    e.preventDefault()
    const body = { name: form.name, unit: form.unit, decimals: Number(form.decimals) }
    if (editing) body.key = form.key
    run('measureKinds.save', body, (r) => {
      setForm(empty)
      if (!editing && onCreated) onCreated(r.key)
    })
  }

  const remove = (k) => {
    if (!window.confirm(`حذف طريقة القياس "${k.name}"؟`)) return
    run('measureKinds.delete', { key: k.key })
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 100000 }}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="measure-kinds-title"
        style={{ width: 620 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Ruler size={22} />
          </span>
          <h2 id="measure-kinds-title">طرق القياس</h2>
          <p>
            كيف تُقاس الوحدة الأساسية للصنف. أضف طريقة جديدة باسمها والوحدة التي تظهر في الفاتورة
            وعدد الخانات العشرية المسموح بها.
          </p>
        </div>

        <table className="data-table measure-kinds-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الوحدة</th>
              <th>الكسور</th>
              <th>الأصناف</th>
              <th aria-label="إجراءات" />
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => (
              <tr key={k.key} className={k.isActive === false ? 'is-muted' : ''}>
                <td>
                  {k.name}
                  {k.isSystem && <span className="cell-muted"> (أساسية)</span>}
                  {k.isActive === false && <span className="badge badge-warning">موقوفة</span>}
                </td>
                <td>{k.unit}</td>
                <td>{PLACES[k.decimals]}</td>
                <td className="num">{k.products ?? '—'}</td>
                <td className="row-actions">
                  {!k.isSystem && (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setForm({ key: k.key, name: k.name, unit: k.unit, decimals: k.decimals })
                        }
                        aria-label={`تعديل ${k.name}`}
                        title="تعديل"
                        disabled={busy}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          run('measureKinds.setActive', {
                            key: k.key,
                            isActive: k.isActive === false
                          })
                        }
                        aria-label={k.isActive === false ? `تفعيل ${k.name}` : `إيقاف ${k.name}`}
                        title={k.isActive === false ? 'تفعيل' : 'إيقاف'}
                        disabled={busy}
                      >
                        <Power size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => remove(k)}
                        aria-label={`حذف ${k.name}`}
                        title={k.products ? 'مستخدمة في أصناف: أوقفها بدلاً من حذفها' : 'حذف'}
                        disabled={busy || k.products > 0}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form className="till-section" onSubmit={save}>
          <h3 className="till-section-title">
            {editing ? (
              <>
                <Pencil size={16} aria-hidden="true" /> تعديل «{form.name}»
              </>
            ) : (
              <>
                <Plus size={16} aria-hidden="true" /> إضافة طريقة قياس
              </>
            )}
          </h3>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">الاسم *</span>
              <input
                className="input"
                value={form.name}
                maxLength={40}
                required
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="مثال: بالمتر"
              />
            </label>
            <label className="field">
              <span className="field-label">الوحدة في الفاتورة *</span>
              <input
                className="input"
                value={form.unit}
                maxLength={20}
                required
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder="مثال: متر"
              />
            </label>
            <label className="field span-2">
              <span className="field-label">الكسور المسموح بها في الكمية</span>
              <select
                className="input"
                value={form.decimals}
                onChange={(e) => setForm({ ...form, decimals: Number(e.target.value) })}
              >
                {PLACES.map((p, i) => (
                  <option key={i} value={i}>
                    {p}
                    {i === 1
                      ? ' (مثلاً 1.5)'
                      : i === 2
                        ? ' (مثلاً 1.25)'
                        : i === 3
                          ? ' (مثلاً 0.250)'
                          : ''}
                  </option>
                ))}
              </select>
              {editing && (
                <span className="field-hint">
                  يمكن زيادة الكسور دائماً؛ تقليلها ممكن فقط إذا لم يستخدمها أي صنف.
                </span>
              )}
            </label>
          </div>
          {error && (
            <p className="text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {editing ? 'حفظ التعديل' : 'إضافة'}
            </button>
            {editing && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setForm(empty)}
                disabled={busy}
              >
                إلغاء التعديل
              </button>
            )}
          </div>
        </form>

        <div className="modal-footer">
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}
