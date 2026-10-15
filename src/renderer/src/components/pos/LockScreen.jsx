import { useEffect, useRef, useState } from 'react'
import { KeyRound, Loader2, LogIn, ShieldCheck } from 'lucide-react'
import { BrandMark, Wordmark } from '../brand/BrandMark'
import { ThemeToggle } from '../ui'
import { api } from '../../lib/api'
import { passwordHint, passwordReady } from '../../lib/passwordHint'
import PasswordInput from '../auth/PasswordInput'
import RecoveryCodeNotice from '../auth/RecoveryCodeNotice'

const LAST_USER = 'heromarket.lastUsername'
const readLastUser = () => {
  try {
    return localStorage.getItem(LAST_USER) || ''
  } catch {
    return ''
  }
}
const rememberUser = (name) => {
  try {
    localStorage.setItem(LAST_USER, name)
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

/**
 * Sign-in (stage 4 phase 3): username + password.
 *   login   – username and password (or, once, the old PIN);
 *   choose  – first sign-in after the update, or a temporary password: choose a new password;
 *   recover – super administrator with the recovery code;
 *   code    – show a newly issued recovery code before continuing.
 * `onSignedIn(result)` receives the service answer ({ user, openShift }).
 */
export default function LockScreen({ onSignedIn }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState(readLastUser)
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [recoveryInput, setRecoveryInput] = useState('')
  const [firstPassword, setFirstPassword] = useState(false)
  const [pending, setPending] = useState(null) // signed-in result waiting behind the recovery code
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const firstField = useRef(null)

  useEffect(() => {
    firstField.current?.focus()
  }, [mode])

  const go = (next) => {
    setError('')
    setNewPassword('')
    setConfirm('')
    setMode(next)
  }

  const finish = (res) => {
    rememberUser(res.user?.username || username.trim())
    if (res.recoveryCode) {
      setPending(res)
      go('code')
    } else onSignedIn(res)
  }

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const submitLogin = (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    run(async () => {
      const res = await api('auth.login', { username: username.trim(), password })
      if (res.passwordChangeRequired) {
        setUsername(res.username)
        setFirstPassword(!!res.firstPassword)
        go('choose')
      } else {
        setPassword('')
        finish(res)
      }
    })
  }

  const submitChoose = (e) => {
    e.preventDefault()
    if (!passwordReady(newPassword, confirm)) return
    run(async () => {
      const res = await api('auth.setPassword', {
        username: username.trim(),
        currentPassword: password,
        newPassword
      })
      setPassword('')
      finish(res)
    })
  }

  const submitRecover = (e) => {
    e.preventDefault()
    if (!username.trim() || !recoveryInput.trim() || !passwordReady(newPassword, confirm)) return
    run(async () => {
      const res = await api('auth.recover', {
        username: username.trim(),
        recoveryCode: recoveryInput,
        newPassword
      })
      setRecoveryInput('')
      finish(res)
    })
  }

  const hint = passwordHint(newPassword, confirm)
  const errorBox = error && (
    <p className="field-error" role="alert">
      {error}
    </p>
  )
  const newPasswordFields = (
    <>
      <label className="field">
        <span className="field-label">كلمة المرور الجديدة</span>
        <PasswordInput
          className="input input-lg"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          maxLength={128}
          autoFocus={mode === 'choose'}
          aria-describedby="new-password-hint"
          required
        />
      </label>
      <label className="field">
        <span className="field-label">تأكيد كلمة المرور</span>
        <PasswordInput
          className="input input-lg"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          maxLength={128}
          required
        />
      </label>
      <p id="new-password-hint" className={hint ? 'field-error' : 'field-hint'} aria-live="polite">
        {hint || '8 أحرف على الأقل، حروف وأرقام معاً، ولا تحتوي على اسم المستخدم.'}
      </p>
    </>
  )
  const submitButton = (label, Icon, disabled) => (
    <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || disabled}>
      {busy ? (
        <Loader2 size={18} className="spin" aria-hidden="true" />
      ) : (
        <Icon size={18} aria-hidden="true" />
      )}
      {label}
    </button>
  )

  return (
    <div className="lock">
      <ThemeToggle compact className="lock-theme" />

      <div className="lock-card">
        <section className="lock-brand" aria-hidden="true">
          <BrandMark size={72} />
          <Wordmark />
          <p className="lock-tagline">نظام نقاط البيع وإدارة السوبر ماركت</p>
          <div className="lock-brand-foot">
            <ShieldCheck size={16} />
            كل عملية تمر بصلاحيات المستخدم على خادم المتجر
          </div>
        </section>

        <section className="lock-form">
          {mode === 'login' && (
            <form className="setup-form" onSubmit={submitLogin}>
              <header className="lock-head">
                <h1>تسجيل الدخول</h1>
                <p>أدخل اسم المستخدم وكلمة المرور</p>
              </header>
              <label className="field">
                <span className="field-label">اسم المستخدم</span>
                <input
                  autoFocus={!username}
                  className="input input-lg"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  maxLength={40}
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">كلمة المرور</span>
                <PasswordInput
                  className="input input-lg"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  maxLength={128}
                  autoFocus={!!username}
                  required
                />
                <span className="field-hint">
                  أول دخول بعد التحديث: اكتب رمز PIN القديم مكان كلمة المرور.
                </span>
              </label>
              {errorBox}
              {submitButton('دخول', LogIn, !username.trim() || !password)}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('recover')}>
                نسيت كلمة المرور؟
              </button>
            </form>
          )}

          {mode === 'choose' && (
            <form className="setup-form" onSubmit={submitChoose}>
              <header className="lock-head">
                <h1>اختر كلمة مرور</h1>
                <p>
                  {firstPassword
                    ? `مرحباً ${username}. تسجيل الدخول برمز PIN لم يعد متاحاً؛ اختر كلمة مرور لحسابك. بعدها يتوقف رمز PIN نهائياً.`
                    : `كلمة المرور الحالية لحساب ${username} مؤقتة. اختر كلمة مرور خاصة بك.`}
                </p>
              </header>
              {newPasswordFields}
              {errorBox}
              {submitButton('حفظ ومتابعة', KeyRound, !passwordReady(newPassword, confirm))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setPassword('')
                  go('login')
                }}
              >
                رجوع
              </button>
            </form>
          )}

          {mode === 'recover' && (
            <form className="setup-form" onSubmit={submitRecover}>
              <header className="lock-head">
                <h1>استعادة كلمة المرور</h1>
                <p>
                  لمدير النظام: استخدم رمز الاسترداد الذي حفظته عند الإعداد. باقي الموظفين: اطلب من
                  المدير إعادة تعيين كلمة المرور من شاشة المستخدمين.
                </p>
              </header>
              <label className="field">
                <span className="field-label">اسم المستخدم</span>
                <input
                  ref={firstField}
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={40}
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">رمز الاسترداد</span>
                <input
                  className="input recovery-input"
                  dir="ltr"
                  value={recoveryInput}
                  onChange={(e) => setRecoveryInput(e.target.value)}
                  placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={64}
                  required
                />
              </label>
              {newPasswordFields}
              {errorBox}
              {submitButton(
                'تعيين كلمة المرور',
                KeyRound,
                !recoveryInput.trim() || !passwordReady(newPassword, confirm)
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('login')}>
                رجوع
              </button>
            </form>
          )}

          {mode === 'code' && pending && (
            <RecoveryCodeNotice code={pending.recoveryCode} onDone={() => onSignedIn(pending)} />
          )}
        </section>
      </div>
    </div>
  )
}
