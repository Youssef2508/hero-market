import { useState } from 'react'
import { KeyRound, CircleCheck, CircleAlert } from 'lucide-react'
import { api } from '../../lib/api'
import { playSound } from '../../lib/utils'

const ROLE_LABELS = { admin: 'مدير النظام', manager: 'مشرف', cashier: 'كاشير' }

// Hooks live in the inner component so the open/closed early return in the wrapper
// does not change hook order (rules-of-hooks; see .docs/DECISIONS.md D-008).
const ChangePinModal = (props) => {
  if (!props.showChangePinModal || !props.currentUser) return null
  return <ChangePinDialog {...props} />
}

function PinInput({ label, value, onChange, autoFocus }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="password"
        pattern="\d{4}"
        maxLength="4"
        inputMode="numeric"
        className="input input-lg pin-field"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        required
        placeholder="••••"
        autoFocus={autoFocus}
      />
    </label>
  )
}

function ChangePinDialog({ setShowChangePinModal, currentUser }) {
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    // Basic Validations
    if (!/^\d{4}$/.test(newPin)) {
      setErrorMsg('يجب أن يتكون رمز المرور الجديد من 4 أرقام فقط!')
      playSound('error')
      return
    }

    if (newPin === currentPin) {
      setErrorMsg('رمز المرور الجديد لا يجب أن يكون متطابقاً مع القديم!')
      playSound('error')
      return
    }

    if (newPin !== confirmPin) {
      setErrorMsg('تأكيد رمز المرور الجديد غير متطابق!')
      playSound('error')
      return
    }

    try {
      await api('auth.changePin', { currentPin, newPin })

      playSound('success')
      setSuccessMsg('تم تغيير رمز المرور بنجاح!')
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')

      // Close modal after 1.5 seconds
      setTimeout(() => {
        setShowChangePinModal(false)
        setSuccessMsg('')
      }, 1500)
    } catch (err) {
      setErrorMsg(
        err.status === 400 || err.status === 409
          ? err.message
          : 'فشل تحديث رمز المرور: ' + err.message
      )
      playSound('error')
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 100000 }}>
      <form
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-title"
        style={{ width: 400 }}
        onSubmit={handleSubmit}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <KeyRound size={24} />
          </span>
          <h2 id="pin-title">تغيير رمز المرور</h2>
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

        <div className="modal-body">
          <PinInput
            label="رمز المرور الحالي *"
            value={currentPin}
            onChange={setCurrentPin}
            autoFocus
          />
          <PinInput label="رمز المرور الجديد (4 أرقام) *" value={newPin} onChange={setNewPin} />
          <PinInput label="تأكيد رمز المرور الجديد *" value={confirmPin} onChange={setConfirmPin} />
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowChangePinModal(false)}
          >
            إلغاء
          </button>
          <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
            تحديث الرمز
          </button>
        </div>
      </form>
    </div>
  )
}

export default ChangePinModal
