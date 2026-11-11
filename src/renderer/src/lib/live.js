import { useEffect, useState } from 'react'

/**
 * From the internet, the cloud announces every change that arrives from the shop (the window event
 * `heromarket:data-changed`, raised by components/shell/LinkStatus.jsx). A screen that includes the
 * returned number in the dependencies of its loading effect shows the change by itself: nobody
 * refreshes (Phase 2, D-101). While a dialog is open nothing reloads under the person typing in it;
 * the screen catches up when the dialog closes and the next change arrives.
 * On the desktop the number never changes.
 */
export function useLiveTick() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const onChange = () => {
      if (document.querySelector('.modal-overlay')) return
      setTick((n) => n + 1)
    }
    window.addEventListener('heromarket:data-changed', onChange)
    return () => window.removeEventListener('heromarket:data-changed', onChange)
  }, [])
  return tick
}
