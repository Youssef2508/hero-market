import { useEffect, useState } from 'react'
import {
  CalendarRange,
  ReceiptText,
  TrendingUp,
  HandCoins,
  Truck,
  Wallet,
  Banknote
} from 'lucide-react'
import { StatCard } from '../ui'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'

// The dashboard for a chosen period (owner, 2026-10-21, D-065): today, this week, this month,
// this year or a range. Every card and chart comes from one service call (reports.dashboard) for
// that period, by each record's own date. Charts are plain SVG in the app's colours (no library).
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The store's week starts on Saturday (Egypt). */
function rangeOf(period, today = new Date()) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (period === 'today') return [iso(t), iso(t)]
  if (period === 'week') {
    const back = (t.getDay() + 1) % 7 // Saturday → 0
    const s = new Date(t)
    s.setDate(t.getDate() - back)
    return [iso(s), iso(t)]
  }
  if (period === 'month') return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)]
  return [iso(new Date(t.getFullYear(), 0, 1)), iso(t)]
}

const PERIODS = [
  ['today', 'اليوم'],
  ['week', 'هذا الأسبوع'],
  ['month', 'هذا الشهر'],
  ['year', 'هذه السنة'],
  ['custom', 'فترة مخصصة']
]
const METHOD_LABELS = {
  cash: 'نقدي',
  visa: 'فيزا',
  wallet: 'محفظة',
  instapay: 'انستا باي',
  credit: 'آجل',
  partial: 'دفع جزئي',
  other: 'أخرى'
}
const m = (n) => `${formatMoney(n)} ج.م`

/** Vertical bars over time: one or more series side by side. */
function BarsChart({ series, keys, labels, colors, unit }) {
  const max = Math.max(1, ...series.flatMap((s) => keys.map((k) => s[k] || 0)))
  const w = 640
  const h = 180
  const slot = w / Math.max(1, series.length)
  const bw = Math.max(2, (slot * 0.8) / keys.length)
  const label = (k) => (unit === 'day' ? k.slice(8) : k.slice(5))
  return (
    <figure className="dash-chart">
      <svg viewBox={`0 0 ${w} ${h + 22}`} role="img" aria-label={labels.join('، ')}>
        {series.map((s, i) =>
          keys.map((k, j) => {
            const v = s[k] || 0
            const bh = (v / max) * h
            // RTL: the first bucket at the right.
            const x = w - (i + 1) * slot + slot * 0.1 + j * bw
            return (
              <rect
                key={`${s.key}-${k}`}
                x={x}
                y={h - bh}
                width={bw - 1}
                height={bh}
                fill={colors[j]}
                rx="2"
              >
                <title>{`${s.key}: ${labels[j]} ${formatMoney(v)}`}</title>
              </rect>
            )
          })
        )}
        {series.length <= 31 &&
          series.map((s, i) => (
            <text
              key={s.key}
              x={w - (i + 0.5) * slot}
              y={h + 16}
              textAnchor="middle"
              className="dash-axis"
            >
              {label(s.key)}
            </text>
          ))}
      </svg>
      <figcaption className="dash-legend">
        {labels.map((l, j) => (
          <span key={l}>
            <i style={{ background: colors[j] }} aria-hidden="true" /> {l}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

/** Horizontal bars: a share of a total. */
function ShareBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="dash-share">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="dash-share-label">{r.label}</span>
          <span className="dash-share-track">
            <span className="dash-share-bar" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="num">{r.text}</span>
        </li>
      ))}
    </ul>
  )
}

export default function DashboardPeriod() {
  const [period, setPeriod] = useState('today')
  const [custom, setCustom] = useState(() => rangeOf('month'))
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [from, to] = period === 'custom' ? custom : rangeOf(period)

  useEffect(() => {
    let stopped = false
    if (!from || !to) return undefined
    api('reports.dashboard', { from, to })
      .then((d) => {
        if (!stopped) {
          setData(d)
          setError('')
        }
      })
      .catch((e) => !stopped && setError(e.message))
    return () => {
      stopped = true
    }
  }, [from, to])

  const t = data?.totals
  return (
    <section aria-labelledby="dash-period-title" className="stack">
      <div className="page-head">
        <h2 id="dash-period-title" className="overview-section-title">
          <CalendarRange size={16} aria-hidden="true" />
          إحصائيات الفترة
        </h2>
        <div
          className="segmented"
          role="tablist"
          aria-label="الفترة"
          onKeyDown={(e) => {
            // ← and → move between the periods (right to left: ← is the next one).
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            const i = PERIODS.findIndex(([k]) => k === period)
            const step = (e.key === 'ArrowLeft') === (document.dir !== 'ltr') ? 1 : -1
            const [k] = PERIODS[(i + step + PERIODS.length) % PERIODS.length]
            const list = e.currentTarget
            e.preventDefault()
            setPeriod(k)
            requestAnimationFrame(() => list.querySelector('[aria-selected="true"]')?.focus())
          }}
        >
          {PERIODS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={period === k}
              className={period === k ? 'active' : ''}
              onClick={() => setPeriod(k)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {period === 'custom' && (
        <div className="row row-wrap">
          <label className="field">
            <span className="field-label">من</span>
            <input
              type="date"
              className="input"
              value={custom[0]}
              onChange={(e) => setCustom([e.target.value, custom[1]])}
            />
          </label>
          <label className="field">
            <span className="field-label">إلى</span>
            <input
              type="date"
              className="input"
              value={custom[1]}
              onChange={(e) => setCustom([custom[0], e.target.value])}
            />
          </label>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          تعذّر تحميل الإحصائيات: {error}
        </p>
      )}
      {!t ? (
        <div className="loading-state">جاري التحميل...</div>
      ) : (
        <>
          <p className="cell-muted">
            من <span className="ltr-id">{data.from}</span> إلى{' '}
            <span className="ltr-id">{data.to}</span>
          </p>
          <div className="stat-grid">
            <StatCard
              icon={TrendingUp}
              tone="success"
              label="المبيعات"
              value={m(t.sales)}
              meta={`منها آجل ودفع جزئي ${m(t.onAccountSales)}`}
            />
            <StatCard icon={ReceiptText} tone="info" label="عدد الفواتير" value={t.invoices} />
            <StatCard icon={HandCoins} tone="danger" label="المصروفات" value={m(t.expenses)} />
            <StatCard
              icon={Truck}
              tone="neutral"
              label="المشتريات"
              value={m(t.purchases)}
              meta={[
                t.pendingCount
                  ? `+ ${t.pendingCount} فاتورة مبدئية بانتظار الأصناف (${m(t.pendingPurchases)})`
                  : `${t.purchaseCount} فاتورة`,
                t.purchaseReturnCount
                  ? `مرتجع ${m(t.purchaseReturns)} (${t.purchaseReturnCount})`
                  : ''
              ]
                .filter(Boolean)
                .join(' · ')}
            />
            <StatCard
              icon={Wallet}
              tone={t.netProfit < 0 ? 'danger' : 'success'}
              label="صافي الربح"
              value={m(t.netProfit)}
              meta={
                t.purchaseDiscounts
                  ? `بعد المصروفات والتوالف، ويشمل خصم مشتريات ${m(t.purchaseDiscounts)}`
                  : 'بعد خصم المصروفات والتوالف'
              }
            />
            <StatCard
              icon={Banknote}
              tone="warning"
              label="تحصيلات ديون العملاء"
              value={m(t.collections)}
              meta="ليست مبيعات جديدة"
            />
          </div>
          <div className="two-col">
            <section className="card">
              <div className="card-body stack">
                <h3 className="card-title">المبيعات خلال الفترة</h3>
                <BarsChart
                  series={data.series}
                  keys={['sales']}
                  labels={['المبيعات']}
                  colors={['var(--chart-1)']}
                  unit={data.unit}
                />
              </div>
            </section>
            <section className="card">
              <div className="card-body stack">
                <h3 className="card-title">المصروفات والمشتريات</h3>
                <BarsChart
                  series={data.series}
                  keys={['expenses', 'purchases']}
                  labels={['المصروفات', 'المشتريات']}
                  colors={['var(--chart-5)', 'var(--chart-2)']}
                  unit={data.unit}
                />
              </div>
            </section>
            <section className="card">
              <div className="card-body stack">
                <h3 className="card-title">المبيعات حسب طريقة الدفع</h3>
                {Object.keys(data.salesByMethod).length === 0 ? (
                  <p className="cell-muted">لا توجد مبيعات في هذه الفترة.</p>
                ) : (
                  <ShareBars
                    rows={Object.entries(data.salesByMethod).map(([k, v]) => ({
                      label: METHOD_LABELS[k] || k,
                      value: v.total,
                      text: `${m(v.total)} (${v.count})`
                    }))}
                  />
                )}
              </div>
            </section>
            <section className="card">
              <div className="card-body stack">
                <h3 className="card-title">الأكثر مبيعاً</h3>
                {data.topProducts.length === 0 ? (
                  <p className="cell-muted">لا توجد مبيعات في هذه الفترة.</p>
                ) : (
                  <ShareBars
                    rows={data.topProducts.map((p) => ({
                      label: p.name,
                      value: p.revenue,
                      text: m(p.revenue)
                    }))}
                  />
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </section>
  )
}
