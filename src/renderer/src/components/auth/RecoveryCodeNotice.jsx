import { useState } from 'react'
import { KeyRound } from 'lucide-react'

/**
 * Shows a super administrator's one-time recovery code. It is displayed only here, once; the user
 * must confirm they have written it down before continuing.
 */
export default function RecoveryCodeNotice({ code, onDone }) {
  const [saved, setSaved] = useState(false)
  return (
    <div className="setup-form recovery-notice">
      <header className="lock-head">
        <h1>
          <KeyRound size={22} aria-hidden="true" /> رمز الاسترداد
        </h1>
        <p>
          إذا نسيت كلمة مرور مدير النظام يمكنك تعيين كلمة جديدة بهذا الرمز. يُستخدم مرة واحدة ثم
          يصدر رمز جديد.
        </p>
      </header>
      <output className="recovery-code" dir="ltr" aria-label="رمز الاسترداد">
        {code}
      </output>
      <ul className="recovery-tips">
        <li>اكتبه على ورقة واحفظها في مكان آمن بعيداً عن جهاز الكاشير.</li>
        <li>لن يظهر هذا الرمز مرة أخرى.</li>
        <li>لا تعطه لأي موظف.</li>
      </ul>
      <label className="check-row">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>كتبت الرمز وحفظته في مكان آمن</span>
      </label>
      <button
        type="button"
        className="btn btn-primary btn-lg btn-block"
        disabled={!saved}
        onClick={onDone}
      >
        متابعة
      </button>
    </div>
  )
}
