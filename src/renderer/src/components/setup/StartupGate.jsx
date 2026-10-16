import { useEffect, useState } from 'react'
import {
  Database,
  Server,
  ShieldCheck,
  Loader2,
  UserPlus,
  Monitor,
  HardDrive,
  TriangleAlert,
  RotateCcw
} from 'lucide-react'
import { BrandMark, Wordmark } from '../brand/BrandMark'
import { ThemeToggle } from '../ui'
import { api } from '../../lib/api'
import PasswordInput from '../auth/PasswordInput'
import RecoveryCodeNotice from '../auth/RecoveryCodeNotice'
import { passwordHint, passwordReady } from '../../lib/passwordHint'

/**
 * Shown before the lock screen:
 *   connect – this till has no working connection (standalone database or central server);
 *   setup   – the database has no users yet: create the first administrator (no default password).
 */
function ConnectForm({ backendInfo, onRetry }) {
  const [mode, setMode] = useState(
    ['client', 'standalone'].includes(backendInfo?.mode) ? backendInfo.mode : 'local'
  )
  const [databaseUrl, setDatabaseUrl] = useState('')
  const [serverUrl, setServerUrl] = useState('')
  const [serverCa, setServerCa] = useState(null) // { pem, subject, fingerprint }
  const [terminalName, setTerminalName] = useState(backendInfo?.terminalName || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(
    backendInfo && backendInfo.error && backendInfo.error !== 'not_configured'
      ? backendInfo.error
      : ''
  )

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const st = await window.api.backend.configure({
        mode,
        databaseUrl,
        serverUrl,
        serverCaPem: serverCa?.pem,
        terminalName
      })
      if (st.ready) onRetry()
      else setError(st.error || 'تعذر الاتصال. راجع البيانات وحاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="setup-form" onSubmit={submit}>
      <header className="lock-head">
        <h1>الاتصال بقاعدة البيانات</h1>
        <p>اختر دور هذا الجهاز في المتجر.</p>
      </header>
      <div className="setup-modes" role="radiogroup" aria-label="دور الجهاز">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'local'}
          className={`setup-mode ${mode === 'local' ? 'is-active' : ''}`}
          onClick={() => setMode('local')}
        >
          <HardDrive size={20} aria-hidden="true" />
          <strong>هذا الجهاز فقط</strong>
          <span>قاعدة بيانات مدمجة على هذا الجهاز (متجر بكاشير واحد). الخيار الموصى به.</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'standalone'}
          className={`setup-mode ${mode === 'standalone' ? 'is-active' : ''}`}
          onClick={() => setMode('standalone')}
        >
          <Database size={20} aria-hidden="true" />
          <strong>خادم قاعدة بيانات</strong>
          <span>يتصل بخادم PostgreSQL يديره المتجر (جهاز الخادم).</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'client'}
          className={`setup-mode ${mode === 'client' ? 'is-active' : ''}`}
          onClick={() => setMode('client')}
        >
          <Server size={20} aria-hidden="true" />
          <strong>جهاز كاشير</strong>
          <span>يتصل بخادم HeroMarket على شبكة المتجر.</span>
        </button>
      </div>
      {mode === 'local' ? null : mode === 'standalone' ? (
        <label className="field">
          <span className="field-label">عنوان قاعدة البيانات</span>
          <input
            className="input ltr"
            dir="ltr"
            value={databaseUrl}
            onChange={(e) => setDatabaseUrl(e.target.value)}
            placeholder="postgres://heromarket:password@127.0.0.1:5432/heromarket"
            required
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      ) : (
        <>
          <label className="field">
            <span className="field-label">عنوان خادم HeroMarket</span>
            <input
              className="input ltr"
              dir="ltr"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://192.168.1.10:8443"
              required
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="field">
            <span className="field-label">شهادة خادم المتجر (لاتصال https)</span>
            <div className="row">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  const picked = await window.api.backend.pickServerCa()
                  if (!picked) return
                  if (picked.error) setError(picked.error)
                  else setServerCa(picked)
                }}
              >
                <ShieldCheck size={15} aria-hidden="true" />
                اختيار الشهادة…
              </button>
              {serverCa && (
                <span className="field-hint ltr" dir="ltr" title={serverCa.subject}>
                  SHA-256 {serverCa.fingerprint.slice(0, 23)}…
                </span>
              )}
            </div>
            <span className="field-hint">
              ملف root.crt من جهاز الخادم. قارن البصمة بالمعروضة على الخادم قبل الحفظ.
            </span>
          </div>
        </>
      )}
      <label className="field">
        <span className="field-label">اسم هذا الجهاز</span>
        <input
          className="input"
          value={terminalName}
          onChange={(e) => setTerminalName(e.target.value)}
          placeholder="كاشير 1"
          maxLength={40}
        />
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
        {busy ? (
          <Loader2 size={18} className="spin" aria-hidden="true" />
        ) : (
          <Monitor size={18} aria-hidden="true" />
        )}
        حفظ والاتصال
      </button>
    </form>
  )
}

function SetupForm({ onSetupDone }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [codeRequired, setCodeRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null) // { user, recoveryCode } until the code is noted

  useEffect(() => {
    api('auth.status')
      .then((s) => setCodeRequired(!!s.setupCodeRequired))
      .catch(() => {})
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!passwordReady(password, confirm))
      return setError(passwordHint(password, confirm) || 'تأكيد كلمة المرور غير مطابق.')
    setBusy(true)
    try {
      const res = await api('auth.setup', {
        username: username.trim(),
        password,
        ...(codeRequired ? { setupCode: setupCode.trim() } : {})
      })
      setPassword('')
      setConfirm('')
      if (res.recoveryCode) setCreated(res)
      else onSetupDone(res.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (created)
    return (
      <RecoveryCodeNotice code={created.recoveryCode} onDone={() => onSetupDone(created.user)} />
    )

  const hint = passwordHint(password, confirm)
  return (
    <form className="setup-form" onSubmit={submit}>
      <header className="lock-head">
        <h1>إعداد المتجر لأول مرة</h1>
        <p>أنشئ حساب مدير النظام. لا يوجد حساب أو كلمة مرور افتراضية.</p>
      </header>
      {codeRequired && (
        <label className="field">
          <span className="field-label">رمز الإعداد من الخادم</span>
          <input
            className="input"
            inputMode="numeric"
            value={setupCode}
            onChange={(e) => setSetupCode(e.target.value)}
            required
            maxLength={64}
            aria-describedby="setup-code-hint"
          />
          <span id="setup-code-hint" className="field-hint">
            يظهر في سجل تشغيل خادم HeroMarket عند أول تشغيل.
          </span>
        </label>
      )}
      <label className="field">
        <span className="field-label">اسم المستخدم</span>
        <input
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          minLength={2}
          maxLength={40}
          autoFocus
        />
      </label>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">كلمة المرور</span>
          <PasswordInput
            className="input input-lg"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            maxLength={128}
            aria-describedby="setup-password-hint"
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
      </div>
      <p
        id="setup-password-hint"
        className={hint ? 'field-error' : 'field-hint'}
        aria-live="polite"
      >
        {hint || '8 أحرف على الأقل، حروف وأرقام معاً، ولا تحتوي على اسم المستخدم.'}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
        {busy ? (
          <Loader2 size={18} className="spin" aria-hidden="true" />
        ) : (
          <UserPlus size={18} aria-hidden="true" />
        )}
        إنشاء مدير النظام
      </button>
    </form>
  )
}

// What to do for each reason an installed shop's database cannot open (backend.js errorCode).
const STORE_ADVICE = {
  store_not_prepared: [
    'شغّل برنامج تثبيت HeroMarket مرة أخرى، ووافق على طلب صلاحيات المسؤول.',
    'لا يتم حذف أو تغيير أي بيانات أثناء ذلك.'
  ],
  setup_incomplete: [
    'شغّل برنامج تثبيت هذه النسخة مرة أخرى، ووافق على طلب صلاحيات المسؤول.',
    'لم يتم تحديث بياناتك؛ ستُحدَّث بعد اكتمال التثبيت.'
  ],
  service_not_running: [
    'أعد تشغيل الجهاز ثم افتح البرنامج.',
    'إذا تكرر ذلك، شغّل برنامج تثبيت HeroMarket مرة أخرى (يصلح الخدمة ويحتفظ بالبيانات).'
  ]
}

/**
 * The shop's own database cannot open on an installed PC (1.4.0 release checks): say why and what
 * to do, and offer to try again. Connection modes are not offered: another mode would not repair it.
 */
function StoreProblem({ backendInfo, onRetry }) {
  const [busy, setBusy] = useState(false)
  const advice = STORE_ADVICE[backendInfo?.errorCode] || [
    'أعد تشغيل الجهاز ثم افتح البرنامج.',
    'إذا تكرر ذلك، شغّل برنامج تثبيت HeroMarket مرة أخرى، ولا تحذف أي مجلد.'
  ]
  const retry = async () => {
    setBusy(true)
    try {
      if (window.api?.backend?.retry) await window.api.backend.retry()
    } finally {
      setBusy(false)
      onRetry()
    }
  }
  return (
    <div className="store-problem" role="alert">
      <h2 className="lock-title">
        <TriangleAlert size={22} aria-hidden="true" /> قاعدة بيانات المتجر غير جاهزة
      </h2>
      {backendInfo?.error && <p className="field-error">{backendInfo.error}</p>}
      <ol className="store-problem-steps">
        {advice.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ol>
      <p className="field-hint">للدعم الفني، ملفات السجل:</p>
      <p className="field-hint store-problem-path" dir="ltr">
        {'C:\\ProgramData\\HeroMarket\\logs\\setup.log'}
        <br />
        {'C:\\ProgramData\\HeroMarket\\logs\\app.log'}
      </p>
      <button
        type="button"
        className="btn btn-primary btn-lg btn-block"
        onClick={retry}
        disabled={busy}
      >
        {busy ? (
          <Loader2 size={18} className="spin" aria-hidden="true" />
        ) : (
          <RotateCcw size={18} aria-hidden="true" />
        )}
        إعادة المحاولة
      </button>
    </div>
  )
}

export default function StartupGate({ phase, backendInfo, onRetry, onSetupDone }) {
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
          {phase === 'checking' && (
            <div className="setup-checking" role="status">
              <Loader2 size={28} className="spin" aria-hidden="true" />
              <p>جاري تجهيز قاعدة البيانات…</p>
              <p className="setup-checking-hint">
                قد يستغرق أول تشغيل بعد التحديث دقيقة لنقل بيانات النسخة السابقة. لا تغلق البرنامج.
              </p>
            </div>
          )}
          {phase === 'connect' && <ConnectForm backendInfo={backendInfo} onRetry={onRetry} />}
          {phase === 'store_problem' && (
            <StoreProblem backendInfo={backendInfo} onRetry={onRetry} />
          )}
          {phase === 'setup' && <SetupForm onSetupDone={onSetupDone} />}
        </section>
      </div>
    </div>
  )
}
