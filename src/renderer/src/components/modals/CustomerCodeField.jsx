import { useEffect, useState } from 'react'
import { api, can } from '../../lib/api'

// The customer code on the add and edit forms (owner, 1.5.2, D-086; 1.6.1, D-107). A new customer
// is shown the code they will get – the next of the store's series (clients.suggestCode) – before
// saving. With «تحديد كود العميل يدوياً» it may be replaced by a typed code: the form warns at once
// if another customer has it, and the service checks again when saving (unique ignoring upper and
// lower case). Left as suggested, the customer gets the next code of the series when saved.
export default function CustomerCodeField({
  form,
  setForm,
  currentUser,
  clientId = null,
  idPrefix
}) {
  const allowed = can(currentUser, 'customers.code')
  const editing = clientId !== null
  const code = String(form.code ?? '')
  const suggested = form.suggestedCode || ''
  const manual = editing || form.codeMode === 'manual'
  const [check, setCheck] = useState(null) // null | { available, owner }

  // A new customer: the suggestion, filled in once (a code already typed is kept).
  useEffect(() => {
    if (editing) return undefined
    let stop = false
    api('clients.suggestCode')
      .then(
        (r) =>
          !stop &&
          setForm((prev) => ({
            ...prev,
            suggestedCode: r.code,
            code: prev.codeMode === 'manual' ? prev.code : r.code,
            codeMode: prev.codeMode || 'auto'
          }))
      )
      .catch(() => {})
    return () => {
      stop = true
    }
  }, [editing, setForm])

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
          {editing ? (
            <>
              <span className="ltr-id">{form.originalCode || '—'}</span> (يتغير بصلاحية «تحديد كود
              العميل يدوياً»)
            </>
          ) : suggested ? (
            <>
              يأخذ العميل الكود <span className="ltr-id">{suggested}</span>، التالي في تسلسل المتجر.
            </>
          ) : (
            'يأخذ العميل الكود التالي في تسلسل المتجر عند الحفظ.'
          )}
        </p>
      </div>
    )
  }
  const onType = (value) =>
    setForm((prev) => ({
      ...prev,
      code: value,
      // The suggestion itself (or nothing) is the automatic code; anything else is typed by hand.
      codeMode:
        editing || (value.trim() && value.trim().toUpperCase() !== suggested.toUpperCase())
          ? 'manual'
          : 'auto'
    }))
  const taken = check && !check.available
  return (
    <div className="form-group">
      <label htmlFor={`${idPrefix}-code`}>كود العميل</label>
      <div className="row" style={{ gap: 8 }}>
        <input
          id={`${idPrefix}-code`}
          type="text"
          className="form-input ltr-id"
          dir="auto"
          maxLength={30}
          value={code}
          onChange={(e) => onType(e.target.value)}
          placeholder={suggested || 'مثال: VIP-12'}
          aria-describedby={`${idPrefix}-code-hint`}
          aria-invalid={taken || undefined}
          style={{ flex: 1 }}
        />
        {!editing && suggested && manual && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => onType(suggested)}
          >
            المقترح ({suggested})
          </button>
        )}
      </div>
      <p
        id={`${idPrefix}-code-hint`}
        className={taken ? 'field-error' : 'field-hint'}
        role={taken ? 'alert' : undefined}
      >
        {taken
          ? `هذا الكود مستخدم للعميل «${check.owner.name}» (${check.owner.code}). اكتب كوداً مختلفاً.`
          : editing
            ? 'تغيير الكود لا يغيّر الفواتير السابقة: تبقى بالكود الذي بيعت به.'
            : manual
              ? 'كود مكتوب: حتى 30 حرفاً أو رقماً، ولا يتكرر لعميلين (لا فرق بين الحروف الكبيرة والصغيرة).'
              : 'الكود المقترح: التالي في تسلسل المتجر. اكتب كوداً آخر إن أردت.'}
      </p>
    </div>
  )
}
