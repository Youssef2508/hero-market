import { PlayCircle, Store, Smartphone, Wallet } from 'lucide-react'

const OpenShiftModal = ({
  openShiftModal,
  currentUser,
  startingCash,
  setStartingCash,
  momknStartBalance,
  setMomknStartBalance,
  momknStartCash,
  setMomknStartCash,
  vfcashStartBalance,
  setVfcashStartBalance,
  vfcashStartCash,
  setVfcashStartCash,
  handleStartShift
}) => {
  if (!openShiftModal) return null
  const isAdmin = currentUser?.role === 'admin'

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

        <div className="modal-body">
          <section className="till-section">
            <h3 className="till-section-title">
              <Store size={16} aria-hidden="true" />
              درج السوبر ماركت — العهدة الافتتاحية *
            </h3>
            <input
              type="number"
              className="input input-lg input-money"
              value={startingCash}
              onChange={(e) => setStartingCash(e.target.value)}
              placeholder="200"
              aria-label="العهدة الافتتاحية لدرج السوبر ماركت"
              autoFocus
            />
            <span className="field-hint">
              الفكة أو العهدة النقدية التي تبدأ بها ورديتك في الدرج الأساسي.
            </span>
          </section>

          {isAdmin && (
            <>
              <section className="till-section tone-info">
                <h3 className="till-section-title">
                  <Smartphone size={16} aria-hidden="true" />
                  درج ماكينة ممكن *
                </h3>
                <div className="form-grid">
                  <label className="field">
                    <span className="field-label">رصيد الماكينة (رقمي)</span>
                    <input
                      type="number"
                      className="input input-money"
                      value={momknStartBalance}
                      onChange={(e) => setMomknStartBalance(e.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">كاش الدرج (ورقي)</span>
                    <input
                      type="number"
                      className="input input-money"
                      value={momknStartCash}
                      onChange={(e) => setMomknStartCash(e.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                </div>
              </section>

              <section className="till-section tone-success">
                <h3 className="till-section-title">
                  <Wallet size={16} aria-hidden="true" />
                  درج المحافظ والتحويلات *
                </h3>
                <div className="form-grid">
                  <label className="field">
                    <span className="field-label">رصيد فودافون (رقمي)</span>
                    <input
                      type="number"
                      className="input input-money"
                      value={vfcashStartBalance}
                      onChange={(e) => setVfcashStartBalance(e.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">كاش الدرج (ورقي)</span>
                    <input
                      type="number"
                      className="input input-money"
                      value={vfcashStartCash}
                      onChange={(e) => setVfcashStartCash(e.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="submit" className="btn btn-primary btn-lg btn-block">
            تأكيد فتح الوردية وبدء العمل
          </button>
        </div>
      </form>
    </div>
  )
}

export default OpenShiftModal
