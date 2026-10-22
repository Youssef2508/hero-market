import { useState } from 'react'
import { KeyRound, CircleCheck, CircleAlert } from 'lucide-react'
import { api } from '../../lib/api'
import { playSound } from '../../lib/utils'
import { passwordHint, passwordReady } from '../../lib/passwordHint'
import PasswordInput from '../auth/PasswordInput'

const ROLE_LABELS = { admin: 'مدير النظام', manager: 'مشرف', cashier: 'كاشير' }

// Hooks live in the inner component so the open/closed early return in the wrapper
// does not change hook order (rules-of-hooks; see .docs/DECISIONS.md D-008).
const ChangePasswordModal = (props) => {
  if (!props.open || !props.currentUser) return null
  return <ChangePasswordDialog {...props} />
}

function ChangePasswordDialog({ onClose, currentUser }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [busy, setBusy] = useState(false)
  const isSuperAdmin = currentUser.roleKey === 'super_admin'
  const hint = passwordHint(next, confirm)

  const fail = (err) => {
    setErrorMsg(err.message)
    playSound('error')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')
    if (!passwordReady(next, confirm)) return
    setBusy(true)
    try {
      await api('auth.changePassword', { currentPassword: current, newPassword: next })
      playSound('success')
      setSuccessMsg('تم تغيير كلمة المرور. تم تسجيل خروج حسابك من الأجهزة الأخرى.')
      setCurrent('')
      setNext('')
      setConfirm('')
      setTimeout(onClose, 1800)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const issueRecoveryCode = async () => {
    setErrorMsg('')
    setSuccessMsg('')
    if (!current) {
      setErrorMsg('اكتب كلمة المرور الحالية أولاً.')
      return
    }
    setBusy(true)
    try {
      const r = await api('auth.newRecoveryCode', { currentPassword: current })
      setRecoveryCode(r.recoveryCode)
      setCurrent('')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 100000 }}>
      <form
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-title"
        style={{ width: 440 }}
        onSubmit={handleSubmit}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <KeyRound size={24} />
          </span>
          <h2 id="password-title">تغيير كلمة المرور</h2>
          <p>
            المستخدم: <strong>{currentUser.username}</strong> (
            {currentUser.roleName || ROLE_LABELS[currentUser.role] || currentUser.role})
          </p>
        </div>

        {errorMsg && (
          <div className="notice notice-danger" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="notice notice-success" role="status">
            <CircleCheck size={16} aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}

        {recoveryCode ? (
          <div className="modal-body">
            <p>رمز الاسترداد الجديد (الرمز القديم توقف عن العمل). اكتبه الآن، فلن يظهر مرة أخرى:</p>
            <output className="recovery-code" dir="ltr">
              {recoveryCode}
            </output>
          </div>
        ) : (
          <div className="modal-body">
            <label className="field">
              <span className="field-label">كلمة المرور الحالية *</span>
              <PasswordInput
                className="input input-lg"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                maxLength={128}
                autoFocus
                required
              />
            </label>
            <label className="field">
              <span className="field-label">كلمة المرور الجديدة *</span>
              <PasswordInput
                className="input input-lg"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                maxLength={128}
              />
            </label>
            <label className="field">
              <span className="field-label">تأكيد كلمة المرور الجديدة *</span>
              <PasswordInput
                className="input input-lg"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                maxLength={128}
              />
            </label>
            <p className={hint ? 'field-error' : 'field-hint'} aria-live="polite">
              {hint || '8 رموز على الأقل (حروف أو أرقام أو علامات)، ولا تحتوي على اسم المستخدم.'}
            </p>
            {isSuperAdmin && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={issueRecoveryCode}
                disabled={busy}
              >
                فقدت رمز الاسترداد؟ إصدار رمز جديد (بكلمة المرور الحالية)
              </button>
            )}
          </div>
        )}

        <div className="modal-footer">
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            {recoveryCode ? 'تم' : 'إلغاء'}
          </button>
          {!recoveryCode && (
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={busy || !current || !passwordReady(next, confirm)}
            >
              تغيير كلمة المرور
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

export default ChangePasswordModal
