import { useState, useEffect } from 'react'
import { LogOut, Calculator } from 'lucide-react'
import { api, can } from '../../lib/api'
import { formatMoney } from '../../lib/utils'

const m = (n) => formatMoney(n)

// Both dialogs show the service's drawer figure (shifts.liveSummary → drawer), the same value that
// shifts.close saves and prints (K-24 option 1). They never compute their own formula.
// Users without shifts.view_expected get the blind dialog (owner feedback PAY-01): only the counted
// amounts, nothing that reveals or lets them derive the expected ones; the service refuses those.

const CASHLESS = [
  { key: 'visa', label: 'فيزا (إجمالي ماكينة الفيزا)' },
  { key: 'wallet', label: 'المحفظة' },
  { key: 'instapay', label: 'انستا باي' }
]

/** Counted Visa, wallet and InstaPay amounts (every close sends them). */
function CashlessCount({ values, onChange }) {
  return (
    <div className="two-col">
      {CASHLESS.map((c) => (
        <label className="field" key={c.key}>
          <span className="field-label">{c.label} (ج.م)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input input-money"
            value={values[c.key]}
            placeholder="0.00"
            onChange={(e) => onChange({ ...values, [c.key]: e.target.value })}
          />
        </label>
      ))}
    </div>
  )
}

const emptyCount = { visa: '', wallet: '', instapay: '' }
const countedOf = (v) => ({
  visa: Number(v.visa) || 0,
  wallet: Number(v.wallet) || 0,
  instapay: Number(v.instapay) || 0
})

// Blind close: what the cashier counted, then confirm. The figures come after the close is saved.
const BlindCloseShiftModal = ({
  closeShiftModal,
  currentShift,
  actualEndCash,
  setActualEndCash,
  setCloseShiftModal,
  handleConfirmCloseShift
}) => {
  const [count, setCount] = useState(emptyCount)
  const [busy, setBusy] = useState(false)
  if (!closeShiftModal) return null
  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <form
        className="modal-content tone-warning"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-shift-blind-title"
        style={{ width: 520 }}
        onSubmit={async (e) => {
          e.preventDefault()
          if (busy) return
          setBusy(true)
          try {
            await handleConfirmCloseShift({ actual: countedOf(count) })
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <LogOut size={24} />
          </span>
          <h2 id="close-shift-blind-title">تسوية وإنهاء الوردية</h2>
          <p>
            الوردية <span className="num">#{currentShift?.id}</span>
          </p>
        </div>
        <div className="modal-body">
          <div className="notice">
            <Calculator size={16} aria-hidden="true" />
            <span>
              عُدّ النقدية الموجودة في الدرج كلها، واكتب إجمالي كل طريقة دفع كما هو في الماكينة أو
              التطبيق. تظهر المقارنة والتقرير بعد تأكيد الإغلاق.
            </span>
          </div>
          <label className="field">
            <span className="field-label">النقدية الموجودة في الدرج (ج.م) *</span>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input input-lg input-money"
              value={actualEndCash}
              placeholder="0.00"
              required
              onChange={(e) => setActualEndCash(e.target.value)}
              autoFocus
            />
          </label>
          <CashlessCount values={count} onChange={setCount} />
        </div>
        <div className="modal-footer">
          <button
            data-modal-close
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setCount(emptyCount)
              setCloseShiftModal(false)
            }}
          >
            إلغاء
          </button>
          <button type="submit" className="btn btn-danger" style={{ flex: 1 }} disabled={busy}>
            {busy ? 'جاري الإغلاق…' : 'تأكيد المبالغ وإنهاء الوردية'}
          </button>
        </div>
      </form>
    </div>
  )
}

// Owner close (shifts.view_expected): the expected amount of each payment method, from the service
// (shifts.liveSummary → methods, the formula shifts.close saves), next to the counted amounts.
const METHOD_ROWS = [
  ['cash', 'نقدي (الدرج)'],
  ['visa', 'فيزا'],
  ['wallet', 'محفظة'],
  ['instapay', 'انستا باي']
]

const OwnerCloseShiftModal = ({
  closeShiftModal,
  currentShift,
  actualEndCash,
  setActualEndCash,
  setCloseShiftModal,
  handleConfirmCloseShift
}) => {
  const [methods, setMethods] = useState(null)
  const [count, setCount] = useState(emptyCount)

  useEffect(() => {
    if (!closeShiftModal || !currentShift) return undefined
    const load = () =>
      api('shifts.liveSummary', { shiftId: currentShift.id })
        .then((r) => setMethods(r.methods))
        .catch(() => setMethods(null))
    load()
    const interval = setInterval(load, 3000)
    return () => clearInterval(interval)
  }, [closeShiftModal, currentShift])

  if (!closeShiftModal) return null
  const fill = () => {
    if (!methods) return
    setActualEndCash(methods.cash.expected.toFixed(2))
    setCount({
      visa: methods.visa.expected.toFixed(2),
      wallet: methods.wallet.expected.toFixed(2),
      instapay: methods.instapay.expected.toFixed(2)
    })
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <form
        className="modal-content modal-scroll tone-warning"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-shift-title"
        style={{ width: 560 }}
        onSubmit={(e) => {
          e.preventDefault()
          handleConfirmCloseShift({ actual: countedOf(count) })
        }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <LogOut size={24} />
          </span>
          <h2 id="close-shift-title">تسوية وإنهاء الوردية</h2>
          <p>
            الوردية <span className="num">#{currentShift?.id}</span>
          </p>
        </div>

        <div className="modal-body">
          <section className="till-section tone-success">
            <h3 className="till-section-title">
              <Calculator size={16} aria-hidden="true" />
              المتوقع حسب طريقة الدفع
            </h3>
            {methods ? (
              <>
                <dl className="kv">
                  {METHOD_ROWS.map(([k, label]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt>{label}</dt>
                      <dd>{m(methods[k].expected)} ج.م</dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  className="btn btn-accent-soft btn-sm btn-block"
                  onClick={fill}
                >
                  تعبئة المبالغ المتوقعة
                </button>
              </>
            ) : (
              <div className="loading-state">جاري الحساب...</div>
            )}
          </section>

          <label className="field">
            <span className="field-label">النقدية الموجودة في الدرج (ج.م) *</span>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input input-lg input-money"
              value={actualEndCash}
              placeholder="0.00"
              required
              onChange={(e) => setActualEndCash(e.target.value)}
              autoFocus
            />
          </label>
          <CashlessCount values={count} onChange={setCount} />
        </div>

        <div className="modal-footer">
          <button
            data-modal-close
            type="button"
            className="btn btn-secondary"
            onClick={() => setCloseShiftModal(false)}
          >
            إلغاء
          </button>
          <button type="submit" className="btn btn-danger" style={{ flex: 1 }}>
            تأكيد وإنهاء الوردية
          </button>
        </div>
      </form>
    </div>
  )
}

export default function CloseShiftModal(props) {
  const { currentUser } = props
  // Expected amounts are the owner's until the close is confirmed (PAY-01).
  if (!can(currentUser, 'shifts.view_expected')) return <BlindCloseShiftModal {...props} />
  return <OwnerCloseShiftModal {...props} />
}
