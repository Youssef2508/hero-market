import { useEffect, useState } from 'react'
import { Database, Server, ShieldCheck, Loader2, UserPlus, Monitor, HardDrive } from 'lucide-react'
import { BrandMark, Wordmark } from '../brand/BrandMark'
import { ThemeToggle } from '../ui'
import { api } from '../../lib/api'

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
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [codeRequired, setCodeRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api('auth.status')
      .then((s) => setCodeRequired(!!s.setupCodeRequired))
      .catch(() => {})
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!/^\d{4}$/.test(pin)) return setError('رمز المرور يجب أن يكون 4 أرقام.')
    if (pin !== confirmPin) return setError('تأكيد رمز المرور غير متطابق.')
    if (['0000', '1234', '1111'].includes(pin))
      return setError('اختر رمزاً غير متوقع (ليس 0000 أو 1234 أو 1111).')
    setBusy(true)
    try {
      const res = await api('auth.setup', {
        username: username.trim(),
        pin,
        ...(codeRequired ? { setupCode: setupCode.trim() } : {})
      })
      onSetupDone(res.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="setup-form" onSubmit={submit}>
      <header className="lock-head">
        <h1>إعداد المتجر لأول مرة</h1>
        <p>أنشئ حساب مدير النظام. لا يوجد حساب أو رمز افتراضي.</p>
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
          required
          minLength={2}
          maxLength={40}
          autoFocus
        />
      </label>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">رمز المرور (4 أرقام)</span>
          <input
            className="input input-lg pin-field"
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">تأكيد رمز المرور</span>
          <input
            className="input input-lg pin-field"
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
            required
          />
        </label>
      </div>
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
          {phase === 'setup' && <SetupForm onSetupDone={onSetupDone} />}
        </section>
      </div>
    </div>
  )
}
