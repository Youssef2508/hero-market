import { useCallback, useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { api, can } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { Timestamp } from '../ui'
import PaymentMethodSelect from './PaymentMethodSelect'
import PaymentDestination from './PaymentDestination'
import { fixedDestination } from '../../lib/destination'

const FILTERS = [
  ['open', 'بانتظار قرار'],
  ['approved', 'معتمدة'],
  ['settled', 'تمت تسويتها'],
  ['all', 'الكل']
]
const OUTCOMES = [
  ['returned', 'أعاد المورد المبلغ', 'يُسجَّل المبلغ داخلاً إلى ورديتك أو الخزنة الآن.'],
  ['applied', 'احتُسب سداداً للمورد', 'يُخصم من مستحق المورد كأنه اعتُمد.'],
  ['loss', 'خسارة (لم يُسترد)', 'لا يتحرك أي مبلغ ولا يتغير حساب المورد؛ يبقى مسجلاً كخسارة.']
]
const TONE = { pending: 'badge-warning', approved: 'badge-success', disputed: 'badge-danger' }

/**
 * Supplier debt-payment requests for the administrator (owner, 1.5.2, D-090): approve (the
 * supplier's balance falls once; the cash already left the drawer), reject with a reason (the
 * request becomes disputed: the cash was handed), and settle a disputed one by what happened.
 */
export default function SupplierPaymentRequests({
  currentUser,
  currentShift,
  triggerCustomAlert,
  onChanged
}) {
  const canDecide = can(currentUser, 'suppliers.payment_approve')
  const [filter, setFilter] = useState('open')
  const [rows, setRows] = useState([])
  const [acting, setActing] = useState(null) // { request, action: 'reject' | 'settle' }
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!canDecide) return
    api('supplierPayments.list', { status: filter })
      .then(setRows)
      .catch(() => setRows([]))
  }, [canDecide, filter])
  useEffect(() => {
    load()
    // Reservations change on other PCs (D-099): look again every 30 seconds.
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])
  if (!canDecide) return null

  // D-099: a request is reserved (5 minutes) before deciding, so two administrators never decide
  // on it together; another's reservation is shown and refused by the service.
  const reserve = async (r) => {
    try {
      return await api('supplierPayments.reserve', { requestId: r.id })
    } catch (err) {
      triggerCustomAlert?.(err.message)
      load()
      return null
    }
  }
  const open = async (r, action) => {
    const res = await reserve(r)
    if (res) setActing({ request: r, action, token: res.token })
  }

  const approve = async (r) => {
    setBusy(true)
    try {
      const res = await reserve(r)
      if (!res) return
      await api('supplierPayments.approve', { requestId: r.id, reservationToken: res.token })
      triggerCustomAlert?.(
        `تم اعتماد طلب السداد #${r.id}: خُصم ${formatMoney(r.amount)} ج.م من مستحق "${r.supplier_name}".`
      )
      load()
      onChanged?.()
    } catch (err) {
      triggerCustomAlert?.('تعذّر الاعتماد: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" aria-labelledby="spr-title">
      <div className="card-header">
        <h2 className="card-title" id="spr-title">
          <BellRing size={18} aria-hidden="true" />
          طلبات سداد الموردين من الأدراج
        </h2>
        <div className="segmented" role="radiogroup" aria-label="عرض الطلبات">
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
          المبلغ خرج من درج الوردية عند تسجيل الطلب. الاعتماد يخصمه من مستحق المورد مرة واحدة ولا
          يُخرج نقوداً أخرى. الرفض بعد الدفع لا يعيد المال للدرج تلقائياً: سوِّ الطلب بما حدث فعلاً.
        </p>
        {!rows.length ? (
          <p className="cell-muted text-center">لا توجد طلبات.</p>
        ) : (
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>المورد</th>
                  <th className="num">المبلغ</th>
                  <th>الحالة</th>
                  <th>
                    <span className="visually-hidden">إجراءات</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  // D-099: another administrator is deciding on it now (5 minutes at most).
                  const held = r.reserved_active && !r.reserved_mine
                  const why = held
                    ? `«${r.reserved_by_name}» بيعدل طلب السداد حاليًا. يتاح عند انتهائه أو انتهاء الحجز (${String(r.reserved_until_text || '').slice(11, 16)}).`
                    : undefined
                  return (
                    <tr key={r.id} className={held ? 'row-reserved' : undefined}>
                      <td>
                        <span className="ltr-id">#{r.id}</span>
                        <div className="cell-muted">
                          <Timestamp value={r.created_at} /> · {r.created_by_name} · وردية #
                          {r.shift_id}
                        </div>
                        {r.note && <div className="cell-muted">{r.note}</div>}
                      </td>
                      <td>
                        {r.supplier_name}
                        <div className="cell-muted">
                          المستحق الآن {formatMoney(r.supplier_debt)} ج.م
                        </div>
                      </td>
                      <td className="num money-strong">{formatMoney(r.amount)}</td>
                      <td>
                        <span className={`badge ${TONE[r.status] || ''}`}>{r.status_label}</span>
                        {held && (
                          <div className="badge badge-info" role="status">
                            «{r.reserved_by_name}» بيعدل طلب السداد حاليًا
                          </div>
                        )}
                        {r.decided_by_name && (
                          <div className="cell-muted">
                            {r.decided_by_name}
                            {r.decision_note ? ` – ${r.decision_note}` : ''}
                          </div>
                        )}
                        {r.settlement_label && (
                          <div className="cell-muted">
                            {r.settlement_label}
                            {r.settlement_note ? ` – ${r.settlement_note}` : ''}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          {r.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                disabled={busy || held}
                                title={why}
                                onClick={() => approve(r)}
                              >
                                اعتماد
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                disabled={busy || held}
                                title={why}
                                onClick={() => open(r, 'reject')}
                              >
                                رفض
                              </button>
                            </>
                          )}
                          {r.status === 'disputed' && (
                            <button
                              type="button"
                              className="btn btn-sm btn-warning-soft"
                              disabled={held}
                              title={why}
                              onClick={() => open(r, 'settle')}
                            >
                              تسوية
                            </button>
                          )}
                        </div>
                        {held && <div className="cell-muted reserved-why">{why}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {acting && (
        <DecisionModal
          {...acting}
          currentUser={currentUser}
          currentShift={currentShift}
          onClose={() => {
            // Left without deciding: give the reservation back.
            api('supplierPayments.release', {
              requestId: acting.request.id,
              token: acting.token
            }).catch(() => {})
            setActing(null)
            load()
          }}
          onDone={() => {
            setActing(null)
            load()
            onChanged?.()
          }}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}
    </section>
  )
}

function DecisionModal({
  request: r,
  action,
  token,
  currentUser,
  currentShift,
  onClose,
  onDone,
  triggerCustomAlert
}) {
  const [note, setNote] = useState('')
  const [outcome, setOutcome] = useState('')
  const [method, setMethod] = useState('cash')
  const [destination, setDestination] = useState('')
  const [busy, setBusy] = useState(false)
  const fixed = fixedDestination(currentUser, currentShift)
  const reject = action === 'reject'

  const save = async (e) => {
    e.preventDefault()
    if (note.trim().length < 3 || (!reject && !outcome)) return
    setBusy(true)
    try {
      if (reject) {
        await api('supplierPayments.reject', {
          requestId: r.id,
          note: note.trim(),
          reservationToken: token
        })
        triggerCustomAlert?.(`رُفض الطلب #${r.id} وينتظر التسوية.`)
      } else {
        const dest = outcome === 'returned' ? fixed || destination : undefined
        await api('supplierPayments.settle', {
          reservationToken: token,
          requestId: r.id,
          outcome,
          note: note.trim(),
          ...(outcome === 'returned'
            ? {
                method,
                destination: dest,
                currentShiftId: dest === 'shift' && currentShift ? currentShift.id : null
              }
            : {})
        })
        triggerCustomAlert?.(`تمت تسوية الطلب #${r.id}.`)
      }
      onDone()
    } catch (err) {
      triggerCustomAlert?.('تعذّر الحفظ: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <form
        data-enter-step
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spr-decision-title"
        onSubmit={save}
        style={{ width: 520 }}
      >
        <div className="modal-header">
          <h2 id="spr-decision-title">
            {reject ? 'رفض' : 'تسوية'} طلب السداد #{r.id}
          </h2>
          <p>
            {r.supplier_name} · {formatMoney(r.amount)} ج.م · من درج الوردية #{r.shift_id}
          </p>
        </div>
        <div className="modal-body">
          {reject ? (
            <p className="field-hint">
              المبلغ سُلِّم للمورد وخرج من الدرج. بعد الرفض يبقى الطلب «مرفوضاً بعد الدفع» حتى
              تسويته بما حدث فعلاً، ولا يعود أي مبلغ للدرج تلقائياً.
            </p>
          ) : (
            <fieldset className="field">
              <legend className="field-label">ماذا حدث فعلاً؟ *</legend>
              {OUTCOMES.map(([k, l, hint]) => (
                <label className="check-row" key={k}>
                  <input
                    type="radio"
                    name="spr-outcome"
                    required
                    checked={outcome === k}
                    onChange={() => setOutcome(k)}
                  />
                  <span>
                    {l}
                    <span className="field-hint"> – {hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {!reject && outcome === 'returned' && (
            <>
              <PaymentMethodSelect value={method} onChange={setMethod} label="استُلم بـ" />
              <PaymentDestination
                currentUser={currentUser}
                currentShift={currentShift}
                value={destination}
                onChange={setDestination}
                name="spr-destination"
              />
            </>
          )}
          <label className="field">
            <span className="field-label">{reject ? 'سبب الرفض *' : 'ما حدث (يُسجَّل) *'}</span>
            <input
              className="input"
              required
              minLength={3}
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
        <div className="modal-footer">
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            رجوع
          </button>
          <button
            type="submit"
            className={`btn ${reject ? 'btn-danger' : 'btn-primary'}`}
            style={{ flex: 1 }}
            disabled={busy || note.trim().length < 3 || (!reject && !outcome)}
          >
            {reject ? 'رفض الطلب' : 'حفظ التسوية'}
          </button>
        </div>
      </form>
    </div>
  )
}
