import { useEffect, useState } from 'react'
import { Banknote, CreditCard, Smartphone, ArrowLeftRight, Wallet, Clock } from 'lucide-react'
import { EmptyState, StatCard } from '../ui'
import { api, can } from '../../lib/api'
import { formatMoney } from '../../lib/utils'

// الأدراج والتحويلات (owner, 2026-10-21, D-063): the shift's money by payment method – cash, Visa,
// wallet, InstaPay – and nothing else. The Momkn machine and the wallet-service tills of earlier
// versions are not used by the store; their old records stay in the database, unshown.
// Figures come from the service's own formula (shifts.liveSummary → methods, the one shifts.close
// saves). They are the owner's until the close is confirmed (blind close, PAY-01).
const METHODS = [
  { key: 'cash', label: 'نقدي (الدرج)', icon: Banknote, tone: 'success' },
  { key: 'visa', label: 'فيزا', icon: CreditCard, tone: 'info' },
  { key: 'wallet', label: 'محفظة', icon: Smartphone, tone: 'warning' },
  { key: 'instapay', label: 'انستا باي', icon: ArrowLeftRight, tone: 'accent' }
]
const REFRESH_MS = 5000
const money = (n) => `${formatMoney(n)} ج.م`

export default function TillsManagerTab({ currentUser, currentShift }) {
  const [live, setLive] = useState(null)
  const canSee = can(currentUser, 'shifts.view_expected')
  const shiftId = currentShift?.status === 'open' ? currentShift.id : null

  useEffect(() => {
    if (!shiftId || !canSee) return undefined
    let stopped = false
    const load = () =>
      api('shifts.liveSummary', { shiftId })
        .then((r) => !stopped && setLive(r))
        .catch(() => {})
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [shiftId, canSee])

  if (!shiftId)
    return (
      <EmptyState
        icon={Clock}
        title="لا توجد وردية مفتوحة"
        text="افتح وردية لتظهر حركة الدرج وطرق الدفع."
      />
    )
  if (!canSee)
    return (
      <div className="notice">
        <Wallet size={16} aria-hidden="true" />
        <span>
          مبالغ الدرج وطرق الدفع تظهر في تقرير إغلاق الوردية بعد تأكيده. عند الإغلاق تكتب النقدية
          الموجودة في الدرج وإجمالي الفيزا والمحفظة وانستا باي.
        </span>
      </div>
    )
  if (!live) return <div className="loading-state">جاري حساب أرصدة الدرج...</div>

  const d = live.drawer
  return (
    <>
      <div className="stat-grid">
        {METHODS.map((m) => (
          <StatCard
            key={m.key}
            icon={m.icon}
            tone={m.tone}
            label={`${m.label} – المتوقع`}
            value={money(live.methods[m.key].expected)}
          />
        ))}
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Banknote size={18} aria-hidden="true" />
            درج النقدية – الوردية #{shiftId}
          </h2>
        </div>
        <div className="card-body">
          <dl className="kv">
            <dt>العهدة الافتتاحية</dt>
            <dd>{money(d.initialCash)}</dd>
            <dt>مبيعات نقدية</dt>
            <dd className="text-success">+ {money(d.cashSales)}</dd>
            <dt>تحصيلات نقدية (ديون عملاء ومقدمات)</dt>
            <dd className="text-success">+ {money(d.inflow)}</dd>
            <dt>مرتجعات نقدية</dt>
            <dd className="text-danger">− {money(d.returns)}</dd>
            <dt>مصروفات نقدية</dt>
            <dd className="text-danger">− {money(d.expenses)}</dd>
            <dt>مدفوعات موردين من الدرج</dt>
            <dd className="text-danger">− {money(d.supplier)}</dd>
            <dt className="fw-bold">المتوقع في الدرج</dt>
            <dd className="fw-bold">{money(d.expected)}</dd>
          </dl>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Wallet size={18} aria-hidden="true" />
            طرق الدفع الأخرى (لا تدخل الدرج)
          </h2>
        </div>
        <div className="card-body">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>طريقة الدفع</th>
                  <th className="num">المبيعات</th>
                  <th className="num">تحصيلات</th>
                  <th className="num">مرتجعات</th>
                  <th className="num">المتوقع</th>
                </tr>
              </thead>
              <tbody>
                {METHODS.filter((m) => m.key !== 'cash').map((m) => {
                  const r = live.methods[m.key]
                  return (
                    <tr key={m.key}>
                      <td className="cell-strong">{m.label}</td>
                      <td className="num">{money(r.sales)}</td>
                      <td className="num">{money(r.inflow)}</td>
                      <td className="num">{money(r.outflow)}</td>
                      <td className="num money-strong">{money(r.expected)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  )
}
