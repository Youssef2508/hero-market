import { useRef, useEffect } from 'react'
import { Delete, LogIn, ShieldCheck } from 'lucide-react'
import { BrandMark, Wordmark } from '../brand/BrandMark'
import { ThemeToggle } from '../ui'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export default function LockScreen({ pin, setPin, handlePinSubmit }) {
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // After a dialog (e.g. "wrong PIN") closes, focus is left on <body>. Reclaim it on the
  // next keystroke so typing a PIN always lands in the field (focus moves before the
  // character is inserted, so no keystroke is lost).
  useEffect(() => {
    const onKeyDown = (e) => {
      if (document.querySelector('.modal-overlay')) return
      const el = inputRef.current
      if (el && document.activeElement !== el && /^[0-9٠-٩۰-۹]$/.test(e.key)) el.focus()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Keep keyboard focus on the PIN field wherever the user clicks.
  const refocus = () => inputRef.current?.focus()

  const pinLength = pin.length
  const press = (d) => {
    setPin((prev) => (prev.length < 4 ? prev + d : prev))
    refocus()
  }

  return (
    <div className="lock" onClick={refocus}>
      <ThemeToggle compact className="lock-theme" />

      <div className="lock-card" onClick={(e) => e.stopPropagation()}>
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
          <header className="lock-head">
            <h1>تسجيل الدخول</h1>
            <p>أدخل رمز المرور المكوّن من 4 أرقام لبدء العمل</p>
          </header>

          <form onSubmit={handlePinSubmit} className="lock-pin-form" onClick={refocus}>
            <input
              ref={inputRef}
              className="lock-pin-input"
              type="password"
              pattern="[0-9]*"
              inputMode="numeric"
              autoComplete="off"
              aria-label="رمز المرور"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').substring(0, 4))}
              autoFocus
            />

            <div className="pin-dots" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`pin-dot ${i < pinLength ? 'is-filled' : ''}`} />
              ))}
            </div>
            <div className="visually-hidden" aria-live="polite">
              {pinLength} من 4 أرقام
            </div>

            <div className="keypad">
              {KEYS.map((num) => (
                <button key={num} type="button" className="key num" onClick={() => press(num)}>
                  {num}
                </button>
              ))}
              <button
                type="button"
                className="key key-muted"
                onClick={() => {
                  setPin((prev) => prev.slice(0, -1))
                  refocus()
                }}
                aria-label="حذف رقم"
                title="حذف"
              >
                <Delete size={22} />
              </button>
              <button type="button" className="key num" onClick={() => press('0')}>
                0
              </button>
              <button type="submit" className="key key-submit" aria-label="دخول">
                <LogIn size={22} />
              </button>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg btn-block lock-submit"
              disabled={pinLength === 0}
            >
              دخول
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
