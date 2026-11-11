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
 *   unavailable – the shop cannot be reached; what is shown is as of the last synchronisation.
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
  if (kind === 'live')
    return (
      <div className="link-status is-live" role="status">
        <Wifi size={15} aria-hidden="true" />
        <span>متصل بالمتجر – البيانات محدّثة</span>
        {state.waitingOperations > 0 && (
          <strong>{state.waitingOperations} عملية بانتظار تأكيد المتجر</strong>
        )}
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
      {kind !== 'offline' && <span>ولا يمكن تسجيل عمليات حتى يعود الاتصال.</span>}
    </div>
  )
}
