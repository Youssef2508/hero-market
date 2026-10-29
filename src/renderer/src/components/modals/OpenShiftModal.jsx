import { PlayCircle, Store } from 'lucide-react'
import { NumberField } from '../ui'

// Why the window is open (1.4.0). 'required' (or true): the user's role must open a shift before
// working, so it cannot be closed. Otherwise the user may close it and work without a shift.
const REASONS = {
  sale: 'لإتمام البيع افتح وردية أولاً؛ يكتمل البيع تلقائياً بعد فتحها.',
  cash: 'هذه العملية تحرك نقدية الدرج وتحتاج وردية مفتوحة. افتح وردية ثم أعد المحاولة.'
}

const OpenShiftModal = ({
  openShiftModal,
  setOpenShiftModal,
  onSignOut,
  currentUser,
  startingCash,
  setStartingCash,
  handleStartShift
}) => {
  if (!openShiftModal) return null
  const required = openShiftModal === true || openShiftModal === 'required'
  const reason = REASONS[openShiftModal]

  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <form
        className="modal-content modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-shift-title"
        style={{ width: 500 }}
        onSubmit={(e) => {
          e.preventDefault()
          handleStartShift()
        }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <PlayCircle size={24} />
          </span>
          <h2 id="open-shift-title">فتح وردية مبيعات جديدة</h2>
          <p>
            الكاشير الحالي: <strong>{currentUser?.username}</strong>
          </p>
        </div>
        {reason && (
          <p className="field-hint is-warning" role="status">
            {reason}
          </p>
        )}

        <div className="modal-body">
          <section className="till-section">
            <h3 className="till-section-title">
              <Store size={16} aria-hidden="true" />
              درج السوبر ماركت — العهدة الافتتاحية *
            </h3>
            <NumberField
              className="input input-lg input-money"
              value={startingCash}
              onChange={(e) => setStartingCash(e.target.value)}
              placeholder="200"
              aria-label="العهدة الافتتاحية لدرج السوبر ماركت"
              autoFocus
            />
            <span className="field-hint">
              الفكة أو العهدة النقدية التي تبدأ بها ورديتك في الدرج الأساسي. تُخصم من الخزنة عند فتح
              الوردية، وتعود إليها مع نقدية الإغلاق.
            </span>
          </section>
        </div>

        <div className="modal-footer">
          {!required && (
            <button
              data-modal-close
              type="button"
              className="btn btn-secondary btn-lg"
              onClick={() => setOpenShiftModal(false)}
            >
              لاحقاً
            </button>
          )}
          {required && onSignOut && (
            // A required shift cannot be skipped, but the user can always sign out (POS-01).
            <button
              type="button"
              className="btn btn-secondary btn-lg"
              onClick={() => {
                setOpenShiftModal(false)
                onSignOut()
              }}
            >
              تسجيل الخروج
            </button>
          )}
          <button type="submit" className="btn btn-primary btn-lg btn-block">
            تأكيد فتح الوردية وبدء العمل
          </button>
        </div>
      </form>
    </div>
  )
}

export default OpenShiftModal
