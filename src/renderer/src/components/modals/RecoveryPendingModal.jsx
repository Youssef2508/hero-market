import { useState } from 'react'
import { History, Loader2, CircleAlert } from 'lucide-react'
import { api, can } from '../../lib/api'

/**
 * Shown when the service refuses work because a restored backup waits for recovery from the cloud
 * (stage 4 phase 4). Administrators recover here or decide on the sync screen; other staff are told
 * to call one.
 */
export default function RecoveryPendingModal({ open, currentUser, onClose, onOpenSync, onLock }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!open) return null
  const admin = can(currentUser, 'sync.manage')

  const recover = async () => {
    setBusy(true)
    setError('')
    try {
      await api('sync.recover')
      onClose(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 100002 }}>
      <div
        className="modal-content tone-warning"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
        style={{ width: 480 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <History size={24} />
          </span>
          <h2 id="recovery-title">العمل متوقف مؤقتاً</h2>
          <p>
            تمت استعادة نسخة احتياطية. قبل متابعة البيع يجب استرجاع ما تم بعد تاريخ النسخة من
            السحابة، حتى لا تتكرر أرقام الفواتير أو تضيع مبيعات.
          </p>
        </div>
        {error && (
          <div className="notice notice-danger" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {!admin && (
          <div className="modal-body">
            <p>اطلب من مدير النظام فتح شاشة «المزامنة السحابية» واسترجاع البيانات.</p>
          </div>
        )}
        <div className="modal-footer">
          {admin ? (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onOpenSync}
                disabled={busy}
              >
                شاشة المزامنة
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={recover}
                disabled={busy}
              >
                {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
                استرجاع من السحابة الآن
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1 }}
              onClick={onLock}
            >
              تسجيل الخروج
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
