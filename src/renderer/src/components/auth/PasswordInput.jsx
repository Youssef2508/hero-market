import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/** Password field with a show/hide button. Extra props go to the <input>. */
export default function PasswordInput({ className = 'input', ...props }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="password-input">
      <input
        {...props}
        className={className}
        type={visible ? 'text' : 'password'}
        dir="ltr"
        autoComplete={props.autoComplete || 'off'}
        spellCheck={false}
      />
      <button
        type="button"
        className="icon-btn password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
        aria-pressed={visible}
        title={visible ? 'إخفاء' : 'إظهار'}
        tabIndex={-1}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}
