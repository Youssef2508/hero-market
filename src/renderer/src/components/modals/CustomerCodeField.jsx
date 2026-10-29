import { useEffect, useState } from 'react'
import { api, can } from '../../lib/api'

// The customer code on the add and edit forms (owner, 1.5.2, D-086). Without the permission
// «تحديد كود العميل يدوياً» the customer gets the automatic code (C + number) and the field only
// shows it. With it, the code may be typed: the form warns at once if another customer has it, and
// the service checks again when saving (unique ignoring upper and lower case).
export default function CustomerCodeField({
  form,
  setForm,
  currentUser,
  clientId = null,
  idPrefix
}) {
  const allowed = can(currentUser, 'customers.code')
  const editing = clientId !== null
  const manual = editing || form.codeMode === 'manual'
  const code = String(form.code ?? '')
  const [check, setCheck] = useState(null) // null | { available, owner }

  useEffect(() => {
    const typed = code.trim()
    if (!allowed || !manual || !typed || (editing && typed === form.originalCode)) {
      setCheck(null)
      return undefined
    }
    let stop = false
    const t = setTimeout(() => {
      api('clients.codeAvailable', { code: typed, clientId })
        .then((r) => !stop && setCheck(r))
        .catch(() => !stop && setCheck(null))
    }, 300)
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [allowed, manual, editing, code, clientId, form.originalCode])

  if (!allowed) {
    return (
      <div className="form-group">
        <label>كود العميل</label>
        <p className="field-hint">
          {editing && form.originalCode ? (
            <>
              <span className="ltr-id">{form.originalCode}</span> (يتغير بصلاحية «تحديد كود العميل
              يدوياً»)
            </>
          ) : (
            'يأخذ العميل كوداً تلقائياً (C ورقمه) عند الحفظ.'
          )}
        </p>
      </div>
    )
  }
  return (
    <div className="form-group">
      <label htmlFor={`${idPrefix}-code`}>كود العميل</label>
      {!editing && (
        <div className="segmented" role="radiogroup" aria-label="طريقة كود العميل">
          {[
            ['auto', 'كود تلقائي'],
            ['manual', 'أكتب الكود']
          ].map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={(form.codeMode || 'auto') === k}
              className={(form.codeMode || 'auto') === k ? 'active' : ''}
              onClick={() => setForm((prev) => ({ ...prev, codeMode: k }))}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      {manual ? (
        <>
          <input
            id={`${idPrefix}-code`}
            type="text"
            className="form-input ltr-id"
            dir="auto"
            maxLength={30}
            value={code}
            onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
            placeholder="مثال: VIP-12"
            aria-describedby={`${idPrefix}-code-hint`}
          />
          <p
            id={`${idPrefix}-code-hint`}
            className={check && !check.available ? 'field-error' : 'field-hint'}
            role={check && !check.available ? 'alert' : undefined}
          >
            {check && !check.available
              ? `هذا الكود مستخدم للعميل «${check.owner.name}» (${check.owner.code}). اكتب كوداً مختلفاً.`
              : editing
                ? 'تغيير الكود لا يغيّر الفواتير السابقة: تبقى بالكود الذي بيعت به.'
                : 'حتى 30 حرفاً أو رقماً. لا يتكرر لعميلين (لا فرق بين الحروف الكبيرة والصغيرة).'}
          </p>
        </>
      ) : (
        <p className="field-hint">يأخذ العميل كوداً تلقائياً (C ورقمه) عند الحفظ.</p>
      )}
    </div>
  )
}
