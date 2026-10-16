import { useState } from 'react'
import { ShieldCheck, CircleAlert, Loader2 } from 'lucide-react'
import PasswordInput from '../auth/PasswordInput'

/**
 * A supervisor approves (or refuses) an action on this till with their own username and password.
 * The service checks them together with the action itself, so nothing is decided here.
 *
 * request: {
 *   title, summary,                  – what is being approved
 *   noteLabel, noteRequired,         – reason / explanation field
 *   onSubmit(approver, note)         – performs the action; throws the service error on refusal
 * }
 */
const SupervisorApprovalModal = ({ request, onCancel }) => {
  if (!request) return null
  return <ApprovalDialog request={request} onCancel={onCancel} />
}

function ApprovalDialog({ request, onCancel }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [note, setNote] = useState(request.note || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = username.trim() && password && (!request.noteRequired || note.trim().length >= 3)

  const send = async (decision) => {
    if (!ready) return
    setBusy(true)
    setError('')
    try {
      await request.onSubmit({ username: username.trim(), password, decision }, note.trim())
    } catch (err) {
      setError(err.message)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 100001 }}>
      <form
        className="modal-content tone-warning"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        style={{ width: 460 }}
        onSubmit={(e) => {
          e.preventDefault()
          send('approve')
        }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <ShieldCheck size={24} />
          </span>
          <h2 id="approval-title">{request.title}</h2>
          <p>{request.summary}</p>
        </div>
        {error && (
          <div className="notice notice-danger" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <div className="modal-body">
          {request.noteLabel && (
            <label className="field">
              <span className="field-label">
                {request.noteLabel}
                {request.noteRequired ? ' *' : ''}
              </span>
              <textarea
                className="input"
                rows={2}
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <p className="field-hint">يكتب المشرف اسم المستخدم وكلمة المرور الخاصة به:</p>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">اسم المشرف</span>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                maxLength={40}
                autoFocus
              />
            </label>
            <label className="field">
              <span className="field-label">كلمة مرور المشرف</span>
              <PasswordInput
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={128}
              />
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button
            data-modal-close
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            إلغاء
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => send('refuse')}
            disabled={busy || !ready}
            title="يرفض المشرف العملية (يُسجَّل الرفض)"
          >
            رفض
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={busy || !ready}
          >
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
            اعتماد
          </button>
        </div>
      </form>
    </div>
  )
}

export default SupervisorApprovalModal
