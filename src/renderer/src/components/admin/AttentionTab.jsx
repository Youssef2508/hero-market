import { useCallback, useEffect, useState } from 'react'
import { BellRing, CircleCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { useLiveTick } from '../../lib/live'
import { formatStamp } from '../../lib/time'

const FILTERS = [
  ['open', 'بانتظار المعالجة'],
  ['resolved', 'تمت معالجتها'],
  ['all', 'الكل']
]

const show = (v) => (v === null || v === undefined || v === '' ? '—' : String(v))

/** The facts behind one item, in plain words. */
function Detail({ item }) {
  const d = item.detail || {}
  if (item.kind === 'conflict')
    return (
      <ul className="attention-cols">
        {(d.columns || []).map((c) => (
          <li key={c.column}>
            <strong>{c.column}</strong>: كان {show(c.base)} – المتجر {show(c.shop)} (بقيت) – السحابة{' '}
            {show(c.cloud)}
          </li>
        ))}
      </ul>
    )
  if (item.kind === 'stock_negative')
    return (
      <p>
        {d.name} ({item.row_key}): الرصيد الآن {show(d.stock)}. اجرد الصنف وسجّل الجرد.
      </p>
    )
  if (item.kind === 'overpaid')
    return (
      <p>
        {d.who} «{d.name}»: الرصيد الآن {show(d.balance)} (له رصيد دائن).
      </p>
    )
  if (item.kind === 'returned_twice')
    return (
      <p>
        الفاتورة #{d.sale}، الصنف {d.barcode}: بيع {show(d.sold)} وأُرجع {show(d.returned)}. راجع
        المرتجعين؛ إن صُرف المبلغ مرتين فسجّل التصحيح بالعمليات المعتادة.
      </p>
    )
  if (item.kind === 'two_open_shifts')
    return (
      <p>الورديات المفتوحة: {(d.shifts || []).map((s) => `#${s}`).join('، ')}. أغلق إحداهما.</p>
    )
  if (item.kind === 'after_close')
    return <p>الوردية #{d.shift}: راجع تقرير إغلاقها؛ مبيعات السحابة لم تدخل في عدّها.</p>
  return <p className="cell-muted">{d.reason || ''}</p>
}

/**
 * «تحتاج انتباهك» (Phase 2 milestone 3, D-103): what came up when the shop and the cloud came
 * together after working apart. Nothing here changes money or stock: the person fixes the cause
 * with the ordinary operations, then records how it was settled.
 */
export default function AttentionTab({ triggerCustomAlert }) {
  const [filter, setFilter] = useState('open')
  const [rows, setRows] = useState(null)
  const [settling, setSettling] = useState(null)
  const [note, setNote] = useState('')
  const live = useLiveTick()

  const load = useCallback(() => {
    api('attention.list', { status: filter })
      .then(setRows)
      .catch((e) => triggerCustomAlert?.(e.message))
  }, [filter, triggerCustomAlert])
  useEffect(() => {
    load()
  }, [load, live])

  const save = async (e) => {
    e.preventDefault()
    try {
      await api('attention.resolve', { id: settling.id, note: note.trim() })
      setSettling(null)
      setNote('')
      load()
    } catch (err) {
      triggerCustomAlert?.(err.message)
    }
  }

  return (
    <section className="card">
      <div className="card-header toolbar">
        <h2 className="card-title">
          <BellRing size={18} aria-hidden="true" />
          تحتاج انتباهك
        </h2>
        <div className="segmented" role="radiogroup" aria-label="عرض العناصر">
          {FILTERS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={filter === k}
              className={filter === k ? 'active' : ''}
              onClick={() => setFilter(k)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="card-body">
        <p className="field-hint">
          تظهر هنا الحالات التي احتاجت قرار شخص بعد أن عمل المتجر والسحابة منفصلين ثم اتصلا. لم
          يُحذف أي سجل ولم تُسجَّل أي حركة تلقائياً: صحّح السبب بالعمليات المعتادة ثم سجّل كيف
          عولجت.
        </p>
        {!rows ? (
          <p className="cell-muted">جاري التحميل…</p>
        ) : !rows.length ? (
          <p className="cell-muted text-center">
            <CircleCheck size={18} aria-hidden="true" /> لا توجد عناصر.
          </p>
        ) : (
          <ul className="attention-list">
            {rows.map((r) => (
              <li key={r.id} className={`attention-item ${r.status}`}>
                <div className="attention-head">
                  <strong>{r.label}</strong>
                  <span className="cell-muted">
                    #{r.id} · {formatStamp(String(r.created_at).replace('T', ' ').slice(0, 19))}
                  </span>
                </div>
                <Detail item={r} />
                {r.status === 'resolved' ? (
                  <p className="cell-muted">
                    عولجت بواسطة {r.resolved_by_name || '—'}: {r.note}
                  </p>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => {
                      setNote('')
                      setSettling(r)
                    }}
                  >
                    تسجيل المعالجة
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {settling && (
        <div className="modal-overlay" role="presentation">
          <form
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attention-title"
            onSubmit={save}
            style={{ width: 520 }}
          >
            <div className="modal-header">
              <h2 id="attention-title">معالجة: {settling.label}</h2>
            </div>
            <div className="modal-body">
              <label className="field">
                <span className="field-label">كيف عولجت؟ *</span>
                <input
                  className="input"
                  required
                  minLength={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                data-modal-close
                type="button"
                className="btn btn-secondary"
                onClick={() => setSettling(null)}
              >
                رجوع
              </button>
              <button type="submit" className="btn btn-primary" disabled={note.trim().length < 3}>
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
