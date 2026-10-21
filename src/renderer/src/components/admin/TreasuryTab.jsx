import { useCallback, useEffect, useState } from 'react'
import { Landmark, Plus, Minus, Scale, Undo2, RefreshCw } from 'lucide-react'
import { EmptyState, Timestamp } from '../ui'
import { formatMoney } from '../../lib/utils'
import { api, can, newClientRef } from '../../lib/api'

const signed = (n) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${formatMoney(Math.abs(n))} ج.م`

/**
 * الخزنة (owner feedback TREAS-01, .docs/FINANCIAL_RECONCILIATION.md §4): the store's cash outside
 * the drawers. The balance may be negative (shown in red, D-059). Rows are never edited or deleted:
 * a mistake is undone by a reversal with its reason.
 */
export default function TreasuryTab({ currentUser, triggerCustomAlert, triggerCustomConfirm }) {
  const [summary, setSummary] = useState(null)
  const [rows, setRows] = useState([])
  const [labels, setLabels] = useState({})
  const [filters, setFilters] = useState({ from: '', to: '', kind: '' })
  const [form, setForm] = useState(null) // { kind, amount, reason, clientRef }
  const [busy, setBusy] = useState(false)
  const canManage = can(currentUser, 'treasury.manage')

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        api('treasury.summary'),
        api('treasury.entries', {
          from: filters.from || null,
          to: filters.to || null,
          kind: filters.kind || null
        })
      ])
      setSummary(s)
      setRows(e.rows)
      setLabels(e.labels)
    } catch (err) {
      triggerCustomAlert('تعذّر تحميل الخزنة: ' + err.message)
    }
  }, [filters, triggerCustomAlert])

  useEffect(() => {
    load()
  }, [load])

  const openForm = (kind) => setForm({ kind, amount: '', reason: '', clientRef: newClientRef() })

  const save = async (e) => {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!amount || (form.kind !== 'adjustment' && amount <= 0)) {
      triggerCustomAlert('اكتب مبلغاً صحيحاً.')
      return
    }
    setBusy(true)
    try {
      await api('treasury.record', {
        kind: form.kind,
        amount,
        reason: form.reason,
        clientRef: form.clientRef
      })
      setForm(null)
      await load()
    } catch (err) {
      triggerCustomAlert('تعذّر التسجيل: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const [reversing, setReversing] = useState(null) // { row, reason }
  const reverse = (row) => setReversing({ row, reason: '' })
  const confirmReverse = (e) => {
    e.preventDefault()
    const { row, reason } = reversing
    triggerCustomConfirm(
      `عكس الحركة #${row.id} (${signed(row.amount)})؟ تُسجَّل حركة جديدة بالمبلغ المعاكس.`,
      async () => {
        try {
          await api('treasury.reverse', { entryId: row.id, reason })
          setReversing(null)
          await load()
        } catch (err) {
          triggerCustomAlert('تعذّر العكس: ' + err.message)
        }
      }
    )
  }

  const balance = summary?.balance ?? 0
  const FORM_TITLES = {
    deposit: 'إيداع في الخزنة',
    withdrawal: 'سحب من الخزنة',
    adjustment: 'تسوية'
  }

  return (
    <>
      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">
              <Landmark size={18} aria-hidden="true" />
              الخزنة
            </h2>
            <div className="card-subtitle">
              نقدية المتجر خارج الأدراج. الفيزا والمحافظ وانستا باي لا تدخل الخزنة.
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
            <RefreshCw size={15} aria-hidden="true" />
            تحديث
          </button>
        </div>
        <div className="card-body">
          <div className="audit-expected">
            <span>رصيد الخزنة الحالي</span>
            <strong className={`money ${balance < 0 ? 'text-danger' : 'text-success'}`}>
              {signed(balance)}
            </strong>
          </div>
          {balance < 0 && (
            <p className="field-error" role="alert">
              الرصيد بالسالب: خرج من الخزنة أكثر مما دخلها.
            </p>
          )}
          {canManage && (
            <div className="row row-wrap">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => openForm('deposit')}
              >
                <Plus size={15} aria-hidden="true" />
                إيداع
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => openForm('withdrawal')}
              >
                <Minus size={15} aria-hidden="true" />
                سحب
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => openForm('adjustment')}
              >
                <Scale size={15} aria-hidden="true" />
                تسوية
              </button>
            </div>
          )}
          {summary?.byKind?.length > 0 && (
            <dl className="kv">
              {summary.byKind.map((k) => (
                <div key={k.kind} style={{ display: 'contents' }}>
                  <dt>
                    {summary.labels[k.kind] || k.kind} ({k.count})
                  </dt>
                  <dd className={k.total < 0 ? 'text-danger' : ''}>{signed(k.total)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">حركات الخزنة</h2>
          <div className="row row-wrap">
            <label className="field">
              <span className="field-label">من</span>
              <input
                type="date"
                className="input"
                value={filters.from}
                onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">إلى</span>
              <input
                type="date"
                className="input"
                value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">النوع</span>
              <select
                className="input"
                value={filters.kind}
                onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
              >
                <option value="">الكل</option>
                {Object.entries(labels).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="card-body">
          {rows.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="لا توجد حركات"
              text="لم تُسجَّل حركات بهذه الشروط."
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>الوقت</th>
                    <th>النوع</th>
                    <th>البيان</th>
                    <th className="num">المبلغ</th>
                    <th>بواسطة</th>
                    <th>
                      <span className="visually-hidden">إجراءات</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="num cell-muted">{r.id}</td>
                      <td className="nowrap cell-muted">
                        <Timestamp value={r.created_at} />
                      </td>
                      <td>{labels[r.kind] || r.kind}</td>
                      <td>
                        {r.description}
                        {r.reason && r.kind === 'reversal' ? ` – ${r.reason}` : ''}
                        {r.reversed_by ? (
                          <span className="badge badge-warning">
                            عُكست بالحركة #{r.reversed_by}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className={`num money-strong ${r.amount < 0 ? 'text-danger' : 'text-success'}`}
                      >
                        {signed(r.amount)}
                      </td>
                      <td className="cell-muted">{r.username || '—'}</td>
                      <td>
                        {canManage &&
                          ['deposit', 'withdrawal', 'adjustment'].includes(r.kind) &&
                          !r.reversed_by && (
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`عكس الحركة ${r.id}`}
                              title="عكس الحركة"
                              onClick={() => reverse(r)}
                            >
                              <Undo2 size={15} />
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {reversing && (
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <form
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="treasury-reverse-title"
            onSubmit={confirmReverse}
          >
            <div className="modal-header">
              <span className="modal-icon" aria-hidden="true">
                <Undo2 size={22} />
              </span>
              <h2 id="treasury-reverse-title">عكس الحركة #{reversing.row.id}</h2>
              <p>{reversing.row.description}</p>
            </div>
            <div className="modal-body">
              <label className="field">
                <span className="field-label">سبب العكس *</span>
                <input
                  className="input"
                  required
                  minLength={3}
                  maxLength={300}
                  value={reversing.reason}
                  onChange={(e) => setReversing({ ...reversing, reason: e.target.value })}
                  autoFocus
                />
              </label>
            </div>
            <div className="modal-footer">
              <button type="submit" className="btn btn-danger" style={{ flex: 1 }}>
                عكس الحركة
              </button>
              <button
                data-modal-close
                type="button"
                className="btn btn-secondary"
                onClick={() => setReversing(null)}
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {form && (
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <form
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="treasury-form-title"
            onSubmit={save}
          >
            <div className="modal-header">
              <span className="modal-icon" aria-hidden="true">
                <Landmark size={22} />
              </span>
              <h2 id="treasury-form-title">{FORM_TITLES[form.kind]}</h2>
              {form.kind === 'adjustment' && (
                <p>المبلغ بالموجب يزيد الخزنة وبالسالب ينقصها. السبب مطلوب.</p>
              )}
            </div>
            <div className="modal-body">
              <label className="field">
                <span className="field-label">المبلغ (ج.م) *</span>
                <input
                  type="number"
                  step="0.01"
                  min={form.kind === 'adjustment' ? undefined : '0.01'}
                  required
                  className="input input-lg input-money"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  autoFocus
                />
              </label>
              <label className="field">
                <span className="field-label">
                  السبب {form.kind === 'adjustment' ? '*' : '(اختياري)'}
                </span>
                <input
                  className="input"
                  maxLength={300}
                  required={form.kind === 'adjustment'}
                  minLength={form.kind === 'adjustment' ? 3 : undefined}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </label>
            </div>
            <div className="modal-footer">
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>
                حفظ
              </button>
              <button
                data-modal-close
                type="button"
                className="btn btn-secondary"
                onClick={() => setForm(null)}
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
