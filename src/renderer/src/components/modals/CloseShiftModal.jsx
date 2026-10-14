import { useState, useEffect } from 'react'
import { LogOut, Calculator, Package, Smartphone, Wallet } from 'lucide-react'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'

const FLOAT_AMOUNT = 200 // عهدة الفكة الثابتة

const m = (n) => formatMoney(n)

function Row({ label, value, tone, sign = '' }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={tone ? `text-${tone}` : ''}>
        {sign}
        {sign ? ' ' : ''}
        {value} ج.م
      </dd>
    </>
  )
}

// Simple close dialog (cashier / manager). The drawer figure is display-only;
// handleConfirmCloseShift recomputes the expected cash itself.
const SimpleCloseShiftModal = ({
  closeShiftModal,
  currentShift,
  actualEndCash,
  setActualEndCash,
  setCloseShiftModal,
  handleConfirmCloseShift
}) => {
  const [expected, setExpected] = useState(null)
  const [withFloat, setWithFloat] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!closeShiftModal || !currentShift) {
      setExpected(null)
      return
    }
    const fetchSimple = () => {
      api('shifts.liveSummary', { shiftId: currentShift.id })
        .then((r) => [r])
        .then((rows) => {
          if (rows && rows[0]) {
            const r = rows[0]
            const exp =
              Number(r.initial_cash) + Number(r.cash_sales) + Number(r.inflow) - Number(r.outflow)
            setExpected(exp)
          }
          setLoading(false)
        })
        .catch(() => setLoading(false))
    }
    fetchSimple()
    const interval = setInterval(fetchSimple, 1000)
    return () => clearInterval(interval)
  }, [closeShiftModal, currentShift])

  if (!closeShiftModal) return null

  const handover =
    expected !== null ? Math.max(0, withFloat ? expected - FLOAT_AMOUNT : expected) : null

  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <form
        className="modal-content tone-warning"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-shift-title"
        style={{ width: 480 }}
        onSubmit={(e) => {
          e.preventDefault()
          handleConfirmCloseShift(null)
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
              حساب الدرج التلقائي
            </h3>
            {loading && expected === null ? (
              <div className="loading-state">جاري الحساب...</div>
            ) : expected !== null ? (
              <>
                <dl className="kv">
                  <dt>المتوقع في الدرج</dt>
                  <dd>{m(expected)} ج.م</dd>
                  <dt>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={withFloat}
                        onChange={(e) => setWithFloat(e.target.checked)}
                      />
                      عهدة الفكة (تبقى {FLOAT_AMOUNT} ج.م)
                    </label>
                  </dt>
                  <dd className={withFloat ? 'text-warning' : 'cell-muted strike'}>
                    − {m(FLOAT_AMOUNT)} ج.م
                  </dd>
                  <dt className="fw-bold">مبلغ التوريد للمالك</dt>
                  <dd className="text-success" style={{ fontSize: 'var(--fs-xl)' }}>
                    {handover !== null ? m(handover) : '—'} ج.م
                  </dd>
                </dl>
                <button
                  type="button"
                  className="btn btn-accent-soft btn-sm btn-block"
                  onClick={() => setActualEndCash(expected.toFixed(2))}
                >
                  تعبئة المبلغ المتوقع ({m(expected)} ج.م)
                </button>
              </>
            ) : (
              <div className="cell-muted">تعذّر حساب المتوقع</div>
            )}
          </section>

          <div className="notice">
            <Package size={16} aria-hidden="true" />
            <span>
              <strong>نظام التوريد:</strong> ضع مبلغ التوريد في ظرف وسلّمه للمالك. تبقى{' '}
              <strong>{FLOAT_AMOUNT} ج.م</strong> فكة في الدرج للوردية التالية.
            </span>
          </div>

          <label className="field">
            <span className="field-label">المبلغ الفعلي الموجود بالدرج حالياً (ج.م)</span>
            <input
              type="number"
              className="input input-lg input-money"
              value={actualEndCash}
              placeholder="0.00"
              onChange={(e) => setActualEndCash(e.target.value)}
              autoFocus
            />
          </label>
        </div>

        <div className="modal-footer">
          <button
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

// Advanced multi-till close dialog (admin), matched to the tills screen.
const AdvancedCloseShiftModal = ({
  closeShiftModal,
  currentShift,
  actualEndCash,
  setActualEndCash,
  setCloseShiftModal,
  handleConfirmCloseShift
}) => {
  const [data, setData] = useState({
    initialCash: 0,
    allSales: 0,
    debtSales: 0,
    digitalSales: 0,
    cashSales: 0,
    inflow: 0,
    returnsOutflow: 0,
    supplierOutflow: 0,
    generalOutflow: 0,
    momknDigitalImpact: 0,
    momknCashImpact: 0,
    momknCommission: 0,
    mmDigitalImpact: 0,
    mmCashImpact: 0,
    mmCommission: 0,
    vfcashDigitalImpact: 0,
    instapayDigitalImpact: 0,
    bankDigitalImpact: 0
  })
  const [withFloat, setWithFloat] = useState(false)
  const [floatAmount, setFloatAmount] = useState('200')

  useEffect(() => {
    if (!closeShiftModal || !currentShift) {
      return
    }
    const fetchLiveDetails = () => {
      api('shifts.liveSummary', { shiftId: currentShift.id })
        .then((r) => [r])
        .then((rows) => {
          if (rows && rows[0]) {
            const r = rows[0]
            setData({
              initialCash: Number(r.initial_cash) || 0,
              allSales: Number(r.all_sales) || 0,
              debtSales: Number(r.debt_sales) || 0,
              digitalSales: Number(r.digital_sales) || 0,
              cashSales: Number(r.cash_sales) || 0,
              inflow: Number(r.inflow) || 0,
              returnsOutflow: Number(r.returns_outflow) || 0,
              supplierOutflow: Number(r.supplier_outflow) || 0,
              generalOutflow: Number(r.general_outflow) || 0,
              momknDigitalImpact: Number(r.momkn_digital_impact) || 0,
              momknCashImpact: Number(r.momkn_cash_impact) || 0,
              momknCommission: Number(r.momkn_commission) || 0,
              mmDigitalImpact: Number(r.mm_digital_impact) || 0,
              mmCashImpact: Number(r.mm_cash_impact) || 0,
              mmCommission: Number(r.mm_commission) || 0,
              vfcashDigitalImpact: Number(r.vfcash_digital_impact) || 0,
              instapayDigitalImpact: Number(r.instapay_digital_impact) || 0,
              bankDigitalImpact: Number(r.bank_digital_impact) || 0
            })
          }
        })
        .catch(() => {})
    }
    fetchLiveDetails()
    const interval = setInterval(fetchLiveDetails, 1000)
    return () => clearInterval(interval)
  }, [closeShiftModal, currentShift])

  if (!closeShiftModal) return null

  const momknStartBalance = Number(currentShift?.momkn_start_balance) || 0
  const momknStartCash = Number(currentShift?.momkn_start_cash) || 0
  const vfcashStartBalance = Number(currentShift?.vfcash_start_balance) || 0
  const vfcashStartCash = Number(currentShift?.vfcash_start_cash) || 0

  const netOperationsCashImpact =
    data.cashSales + data.inflow - (data.supplierOutflow + data.generalOutflow)
  const supermarketExpectedDrawer = data.initialCash + netOperationsCashImpact

  const momknExpectedDigital = momknStartBalance + data.momknDigitalImpact
  const momknExpectedDrawer = momknStartCash + data.momknCashImpact

  const vfcashExpectedDigital = vfcashStartBalance + data.vfcashDigitalImpact
  const vfcashExpectedDrawer = vfcashStartCash + data.mmCashImpact

  const grandTotalCash = supermarketExpectedDrawer + momknExpectedDrawer + vfcashExpectedDrawer

  const parsedFloat = withFloat ? parseFloat(floatAmount) || 0 : 0
  const handoverAmount = Math.max(0, supermarketExpectedDrawer - parsedFloat)

  const handleConfirm = () => {
    handleConfirmCloseShift({
      supermarketExpected: supermarketExpectedDrawer,
      momknExpected: momknExpectedDrawer,
      vfcashExpected: vfcashExpectedDrawer,
      grandTotalExpected: grandTotalCash,
      handoverAmount: handoverAmount,
      withFloat: withFloat,
      floatAmount: parsedFloat
    })
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <form
        className="modal-content modal-wide modal-scroll tone-warning"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-shift-adv-title"
        onSubmit={(e) => {
          e.preventDefault()
          handleConfirm()
        }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <LogOut size={24} />
          </span>
          <h2 id="close-shift-adv-title">تسوية وتقفيل الوردية — الخزائن الثلاث</h2>
          <p>
            الوردية رقم <strong className="num">#{currentShift?.id}</strong>
          </p>
        </div>

        <div className="modal-body">
          <section className="till-section tone-info">
            <h3 className="till-section-title">
              <Calculator size={16} aria-hidden="true" />
              1. درج السوبر ماركت الرئيسي (نقدي)
            </h3>
            <dl className="kv">
              <Row label="كاش الفكة الافتتاحي" value={m(data.initialCash)} />
              <Row
                label="إجمالي مبيعات الفواتير"
                value={m(data.allSales)}
                sign="+"
                tone="success"
              />
              {(data.debtSales > 0 || data.digitalSales > 0) && (
                <Row
                  label="آجل وتحويلات (لم تدخل الدرج)"
                  value={m(data.debtSales + data.digitalSales)}
                  sign="−"
                  tone="warning"
                />
              )}
              <Row label="تحصيل ديون عملاء (داخل)" value={m(data.inflow)} sign="+" tone="success" />
              <Row
                label="مدفوعات وصرف لموردين"
                value={m(data.supplierOutflow)}
                sign="−"
                tone="danger"
              />
              <Row
                label="مصاريف ونثريات وإيجار"
                value={m(data.generalOutflow)}
                sign="−"
                tone="danger"
              />
            </dl>
            <div className="audit-expected">
              <span>صافي الكاش المتوقع بالدرج</span>
              <strong className="money">{m(supermarketExpectedDrawer)} ج.م</strong>
            </div>
          </section>

          <section className="till-section">
            <h3 className="till-section-title">
              <Package size={16} aria-hidden="true" />
              حاسبة التوريد وترك الفكة للوردية القادمة
            </h3>
            <div className="row row-wrap">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={withFloat}
                  onChange={(e) => setWithFloat(e.target.checked)}
                />
                خصم عهدة فكة
              </label>
              <input
                type="number"
                className="input num"
                style={{ width: 110, minHeight: 34 }}
                value={floatAmount}
                onChange={(e) => setFloatAmount(e.target.value)}
                disabled={!withFloat}
                aria-label="مبلغ عهدة الفكة"
              />
              <span className="cell-muted">ج.م</span>
              <span className="spacer" />
              <strong className="text-success">صافي التوريد للمالك: {m(handoverAmount)} ج.م</strong>
            </div>
          </section>

          <div className="two-col">
            <section className="till-section tone-info">
              <h3 className="till-section-title">
                <Smartphone size={16} aria-hidden="true" />
                2. ماكينة ممكن
              </h3>
              <dl className="kv">
                <Row label="الرصيد الرقمي المتوقع" value={m(momknExpectedDigital)} />
                <Row label="كاش الدرج (التأثير)" value={m(data.momknCashImpact)} sign="+" />
                <Row label="إجمالي كاش الدرج" value={m(momknExpectedDrawer)} />
                <Row label="العمولات" value={m(data.momknCommission)} />
              </dl>
            </section>
            <section className="till-section tone-success">
              <h3 className="till-section-title">
                <Wallet size={16} aria-hidden="true" />
                3. المحافظ والتحويلات
              </h3>
              <dl className="kv">
                <Row label="محفظة فودافون المتوقعة" value={m(vfcashExpectedDigital)} />
                <Row label="انستا باي" value={m(data.instapayDigitalImpact)} />
                <Row label="تحويل بنكي" value={m(data.bankDigitalImpact)} />
                <Row label="كاش المحافظ (التأثير)" value={m(data.mmCashImpact)} sign="+" />
                <Row label="إجمالي كاش الدرج" value={m(vfcashExpectedDrawer)} />
                <Row label="العمولات" value={m(data.mmCommission)} />
              </dl>
            </section>
          </div>

          <section className="grand-total">
            <div>
              <span>إجمالي الكاش الورقي المتوقع (شامل الماكينات والخدمات)</span>
              <strong className="money">{m(grandTotalCash)} ج.م</strong>
            </div>
            <div className="row">
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setActualEndCash(supermarketExpectedDrawer.toFixed(2))}
              >
                تطبيق السوبر ماركت فقط ({m(supermarketExpectedDrawer)})
              </button>
              <button
                type="button"
                className="btn btn-sm btn-accent-soft"
                onClick={() => setActualEndCash(grandTotalCash.toFixed(2))}
              >
                تطبيق الكاش الإجمالي ({m(grandTotalCash)})
              </button>
            </div>
          </section>

          <label className="field">
            <span className="field-label">
              المبلغ الفعلي المسلَّم من الكاشير بالدرج حالياً (ج.م) *
            </span>
            <input
              type="number"
              className="input input-lg input-money"
              value={actualEndCash}
              onChange={(e) => setActualEndCash(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </label>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setCloseShiftModal(false)}
          >
            إلغاء
          </button>
          <button type="submit" className="btn btn-danger" style={{ flex: 1 }}>
            تأكيد وتقفيل الوردية
          </button>
        </div>
      </form>
    </div>
  )
}

export default function CloseShiftModal(props) {
  const { currentUser } = props
  if (currentUser?.role === 'admin') {
    return <AdvancedCloseShiftModal {...props} />
  }
  return <SimpleCloseShiftModal {...props} />
}
