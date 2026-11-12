import { useEffect, useRef, useState } from 'react'
import { CloudOff, RefreshCw, Wifi } from 'lucide-react'
import { api } from '../../lib/api'

const when = (iso) =>
  new Date(iso).toLocaleString('ar-EG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  })

/**
 * The internet way in only (Phase 2, D-101): whether what is on the screen is the shop as it is
 * right now. Figures are never presented as current when they are not:
 *   live        – the shop is reachable and has nothing left to send;
 *   delayed     – reachable, with changes still on their way;
 *   unavailable – the shop cannot be reached; what is shown is the shop as of the last
 *                 synchronisation plus what was done here since (it reaches the shop later, D-103).
 * One request stays open to the cloud and returns when something changes, so nobody refreshes:
 * each change is announced to the screens as the window event `heromarket:data-changed`.
 */
export default function LinkStatus() {
  const web = !!window.api?.isWeb
  const [state, setState] = useState(null)
  const seq = useRef(null)

  useEffect(() => {
    if (!web) return undefined
    let stop = false
    const loop = async () => {
      while (!stop) {
        try {
          const s =
            seq.current === null
              ? await api('link.state')
              : await api('link.watch', { after: seq.current, timeoutMs: 25000 })
          if (stop) return
          if (seq.current !== null && s.seq !== seq.current)
            window.dispatchEvent(new CustomEvent('heromarket:data-changed', { detail: s }))
          seq.current = s.seq
          setState(s)
        } catch (e) {
          if (stop || e.status === 401) return
          // The cloud itself did not answer: say so, and try again shortly.
          setState((prev) => ({ ...(prev || {}), reachable: false, freshness: 'offline' }))
          await new Promise((r) => setTimeout(r, 5000))
        }
      }
    }
    loop()
    return () => {
      stop = true
    }
  }, [web])

  if (!web || !state) return null
  const kind = state.freshness
  const waiting = state.waitingOperations > 0 && (
    <WaitingOperations count={state.waitingOperations} seq={state.seq} />
  )
  if (kind === 'live')
    return (
      <div className="link-status is-live" role="status">
        <Wifi size={15} aria-hidden="true" />
        <span>متصل بالمتجر – البيانات محدّثة</span>
        {waiting}
      </div>
    )
  if (kind === 'delayed')
    return (
      <div className="link-status is-delayed" role="status">
        <RefreshCw size={15} aria-hidden="true" />
        <span>متصل بالمتجر – جارٍ استلام {state.pendingChanges} تغييراً</span>
      </div>
    )
  return (
    <div className="link-status is-off" role="alert">
      <CloudOff size={15} aria-hidden="true" />
      <span>
        {kind === 'offline'
          ? 'تعذر الاتصال بالخادم. تحقق من الإنترنت.'
          : 'المتجر غير متصل الآن. البيانات المعروضة حتى'}
      </span>
      {kind !== 'offline' && state.lastSyncedAt && <strong>{when(state.lastSyncedAt)}</strong>}
      {kind !== 'offline' && <span>العمليات تُسجَّل هنا وتصل إلى المتجر عند عودة الاتصال.</span>}
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
function WaitingOperations({ count, seq }) {
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
                        {r.username} · {when(r.created_at)}
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
