import { useEffect, useRef, useState } from 'react'
import { CloudOff, HelpCircle, RefreshCw, Wifi } from 'lucide-react'
import { api } from '../../lib/api'
import { connectivityNow, connectivityText } from '../../lib/connectivity'

// In the store's time zone, like the last contact beside it (QA-04: it was the page's own).
const when = (iso, timeZone) =>
  new Date(iso).toLocaleString('ar-EG', {
    timeZone: timeZone || undefined,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  })

const LOOK = {
  connected: ['is-live', Wifi, 'status'],
  delayed: ['is-delayed', RefreshCw, 'status'],
  offline: ['is-off', CloudOff, 'alert'],
  unknown: ['is-delayed', HelpCircle, 'status'],
  unpaired: ['is-delayed', HelpCircle, 'status']
}

/**
 * The internet way in only (Phase 2, D-101; D-114): the shop's connection and its last successful
 * contact, as the cloud observed it.
 *   connected – a recent contact; delayed – none for a while, still routed to the shop; offline –
 *   the cloud works on its copy (the shop as of the last synchronisation plus what was done here,
 *   which reaches the shop later, D-103); unknown – the shop has never been in contact.
 * One request stays open to the cloud and returns when something changes – the copy, the link, or
 * a newer contact – so nobody refreshes: each change of the copy is announced to the screens as
 * the window event `heromarket:data-changed`. Between answers the age counts on by itself, on the
 * cloud's clock, so "connected" never outlives the contact it stands for.
 */
export default function LinkStatus() {
  const web = !!window.api?.isWeb
  // The cloud's last answer, and when it arrived (this page's clock, only to count from).
  const [answer, setAnswer] = useState(null)
  const [now, setNow] = useState(0)
  const [serverDown, setServerDown] = useState(false)
  const seq = useRef(null)
  const known = useRef(null)

  useEffect(() => {
    if (!web) return undefined
    let stop = false
    const loop = async () => {
      while (!stop) {
        try {
          const s =
            seq.current === null
              ? await api('link.state')
              : await api('link.watch', {
                  after: seq.current,
                  timeoutMs: 25000,
                  seenAt: known.current
                })
          if (stop) return
          if (seq.current !== null && s.seq !== seq.current)
            window.dispatchEvent(new CustomEvent('heromarket:data-changed', { detail: s }))
          seq.current = s.seq
          known.current = s.lastContactAt ? Date.parse(s.lastContactAt) : null
          const at = Date.now()
          setServerDown(false)
          setAnswer({ s, at })
          setNow(at)
        } catch (e) {
          if (stop || e.status === 401) return
          // The cloud itself did not answer: say so, and try again shortly.
          setServerDown(true)
          await new Promise((r) => setTimeout(r, 5000))
        }
      }
    }
    loop()
    // The age of the last contact counts on every second, with no request.
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [web])

  const state = answer?.s
  if (!web || !state) return null
  const waiting = (
    <>
      {state.waitingOperations > 0 && (
        <WaitingOperations
          count={state.waitingOperations}
          seq={state.seq}
          timeZone={state.timeZone}
        />
      )}
      <DeferredOperations
        count={state.deferredOperations || 0}
        seq={state.seq}
        timeZone={state.timeZone}
      />
    </>
  )
  if (serverDown)
    return (
      <div className="link-status is-off" role="alert">
        <CloudOff size={15} aria-hidden="true" />
        <span>تعذر الاتصال بالخادم. تحقق من الإنترنت.</span>
        {waiting}
      </div>
    )
  const conn = connectivityNow(state, answer.at, Math.max(now, answer.at))
  const [tone, Icon, role] = LOOK[conn.state]
  return (
    <div className={`link-status ${tone}`} role={role} data-connectivity={conn.state}>
      <Icon size={15} aria-hidden="true" />
      <span>{connectivityText(conn, state)}</span>
      {conn.state === 'connected' && state.pendingChanges > 0 && (
        <span>– جارٍ استلام {state.pendingChanges} تغييراً</span>
      )}
      {conn.state === 'offline' && state.lastSyncedAt && (
        <span>
          البيانات المعروضة حتى <strong>{when(state.lastSyncedAt, state.timeZone)}</strong>،
          والعمليات تُسجَّل هنا وتصل إلى المحل عند عودة الاتصال.
        </span>
      )}
      {waiting}
    </div>
  )
}

const OPERATION_STATUS = {
  queued: 'لم تُرسل بعد',
  sent: 'أُرسلت – بانتظار تأكيد المتجر',
  not_executed: 'لم تُنفَّذ – لم يتغير شيء'
}

/**
 * Operations handed to the shop whose outcome is not known yet (the answer was lost on the way).
 * They are never carried out twice and never carried out by the cloud instead (D-101): each one
 * becomes "applied" or "not executed" when the shop next reports. Until then, do not repeat it.
 */
function WaitingOperations({ count, seq, timeZone }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  useEffect(() => {
    if (!open) return
    api('link.operations')
      .then(setRows)
      .catch(() => setRows([]))
  }, [open, seq])
  return (
    <>
      <button type="button" className="link-status-waiting" onClick={() => setOpen(true)}>
        {count} عملية بانتظار تأكيد المتجر
      </button>
      {open && (
        <div className="modal-overlay" role="presentation">
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="waiting-ops-title"
          >
            <div className="modal-header">
              <h2 id="waiting-ops-title">عمليات بانتظار تأكيد المتجر</h2>
              <p>
                أُرسلت هذه العمليات إلى المتجر ولم يصل تأكيد تنفيذها بعد. لن تُنفَّذ مرتين؛ ستظهر
                نتيجتها هنا عند اتصال المتجر. لا تكررها.
              </p>
            </div>
            <div className="modal-body">
              {!rows.length ? (
                <p className="cell-muted">لا توجد عمليات معلقة الآن.</p>
              ) : (
                <ul className="waiting-ops">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <strong>{r.operation}</strong>
                      <span>{OPERATION_STATUS[r.status] || r.status}</span>
                      <span className="cell-muted">
                        {r.username} · {when(r.created_at, timeZone)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="modal-footer">
              <button
                data-modal-close
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpen(false)}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const DEFERRED_STATUS = {
  queued: 'بانتظار اتصال المتجر',
  sent: 'وصلت إلى المتجر – جارٍ التنفيذ',
  applied: 'نُفذت في المتجر',
  refused: 'رفضها المتجر – لم يتغير شيء',
  not_executed: 'لم تُنفَّذ – لم يتغير شيء',
  withdrawn: 'سحبتها – لم تُرسل'
}
const DEFERRED_NAMES = {
  'products.changeBarcode': 'تغيير باركود صنف',
  'products.delete': 'حذف صنف',
  'suppliers.delete': 'حذف مورد',
  'users.delete': 'حذف مستخدم',
  'roles.delete': 'حذف دور',
  'suppliers.revisePurchase': 'تصحيح فاتورة شراء',
  'supplierInvoices.updatePending': 'تعديل فاتورة مبدئية'
}
/** What a deferred operation is about, from its own data. */
function deferredSubject(r) {
  const b = r.body || {}
  if (r.operation === 'products.changeBarcode') return `${b.barcode} ← ${b.newBarcode}`
  if (b.barcode) return b.barcode
  if (b.purchaseId) return `فاتورة #${b.purchaseId}`
  if (b.invoiceId) return `فاتورة مبدئية #${b.invoiceId}`
  return ''
}

/**
 * Changes that only the shop can carry out, made here while it could not be reached (D-111): each
 * is kept, reaches the shop on its return and is carried out there once, after the shop has
 * checked it against its own data. Until it is handed over, the person who made it may withdraw it.
 */
function DeferredOperations({ count, seq, timeZone }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const load = () =>
    api('cloud.operations')
      .then(setRows)
      .catch(() => setRows([]))
  useEffect(() => {
    if (open) load()
  }, [open, seq])
  const withdraw = async (id) => {
    setError('')
    try {
      await api('cloud.withdrawOperation', { id })
    } catch (e) {
      setError(e.message)
    }
    load()
  }
  if (!count && !open) return null
  return (
    <>
      <button type="button" className="link-status-waiting" onClick={() => setOpen(true)}>
        {count} عملية بانتظار المتجر
      </button>
      {open && (
        <div className="modal-overlay" role="presentation">
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deferred-ops-title"
          >
            <div className="modal-header">
              <h2 id="deferred-ops-title">عمليات بانتظار المتجر</h2>
              <p>
                عمليات تحتاج المتجر نفسه، حُفظت هنا أثناء انقطاعه. تُنفَّذ في المتجر مرة واحدة عند
                عودة الاتصال بعد التحقق منها هناك، وتظهر نتيجتها هنا. يمكنك سحب ما لم يُرسل بعد.
              </p>
            </div>
            <div className="modal-body">
              {error && <p className="field-error">{error}</p>}
              {!rows.length ? (
                <p className="cell-muted">لا توجد عمليات.</p>
              ) : (
                <ul className="waiting-ops">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <strong>{DEFERRED_NAMES[r.operation] || r.operation}</strong>
                      <span className="ltr-id">{deferredSubject(r)}</span>
                      <span>{DEFERRED_STATUS[r.status] || r.status}</span>
                      {r.error?.message && <span className="field-error">{r.error.message}</span>}
                      <span className="cell-muted">{when(r.createdAt, timeZone)}</span>
                      {r.status === 'queued' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => withdraw(r.id)}
                        >
                          سحب
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="modal-footer">
              <button
                data-modal-close
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpen(false)}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
