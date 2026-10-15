import { useEffect } from 'react'
import { useCashierPerformance } from '../../hooks/useCashierPerformance'
import {
  CalendarRange,
  RefreshCw,
  ArrowRight,
  TrendingUp,
  TriangleAlert,
  Award,
  Clock,
  CreditCard,
  Package,
  ChartColumn,
  Users,
  Zap,
  CircleAlert,
  CircleCheck,
  UsersRound
} from 'lucide-react'
import { EmptyState } from '../ui'
import { VBarChart } from '../ui/charts'
import { CHART_COLORS } from '../ui/chartColors'
import { formatMoney } from '../../lib/utils'
import { formatHour } from '../../lib/time'

const fmt = (n) => formatMoney(n)
const fmtI = (n) => Math.round(n || 0).toLocaleString('en-US')

const QUICK_BTNS = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: '3days', label: '3 أيام' },
  { key: 'week', label: 'أسبوع' },
  { key: 'month', label: 'شهر' },
  { key: 'all', label: 'الكل' }
]

const COMPARE_OPTS = [
  { key: 'totalSales', label: 'المبيعات' },
  { key: 'totalInvoices', label: 'الفواتير' },
  { key: 'profitMargin', label: 'هامش الربح %' },
  { key: 'score', label: 'درجة الأداء' }
]

// Grade labels come from useCashierPerformance#gradeFromScore; map them to semantic tones.
const GRADE_TONE = { ممتاز: 'success', 'جيد جداً': 'info', جيد: 'warning', 'يحتاج تحسين': 'danger' }
const toneOf = (grade) => GRADE_TONE[grade?.label] || 'neutral'

function Panel({ icon: Icon, title, aside, children }) {
  return (
    <section className="card">
      {title && (
        <div className="card-header">
          <h2 className="card-title">
            {Icon && <Icon size={18} aria-hidden="true" />}
            {title}
          </h2>
          {aside}
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  )
}

function GradeBadge({ grade }) {
  const tone = toneOf(grade)
  return <span className={`badge badge-${tone === 'neutral' ? '' : tone}`}>{grade?.label}</span>
}

function ScoreBar({ score, grade }) {
  return (
    <span className={`bar bar-lg tone-${toneOf(grade)}`} aria-hidden="true">
      <span style={{ width: `${score}%`, background: 'var(--tone-fg)' }} />
    </span>
  )
}

function AlertBanner({ alerts }) {
  if (!alerts || alerts.length === 0) return null
  const ICON = { danger: CircleAlert, warning: TriangleAlert, success: CircleCheck }
  return (
    <Panel icon={TriangleAlert} title="التنبيهات الذكية">
      <div className="stack">
        {alerts.map((a, i) => {
          const Icon = ICON[a.type] || TriangleAlert
          return (
            <div
              key={i}
              className={`notice notice-${a.type === 'success' ? 'success' : a.type === 'danger' ? 'danger' : 'warning'}`}
            >
              <Icon size={16} aria-hidden="true" />
              <span style={{ fontWeight: 'var(--fw-semibold)' }}>{a.msg}</span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function CashierCard({ c, rank, onSelect }) {
  return (
    <button
      type="button"
      className={`cashier-card tone-${toneOf(c.grade)}`}
      onClick={() => onSelect(c)}
    >
      <span className={`rank rank-${rank + 1} cashier-rank`}>{rank + 1}</span>
      <span className="cashier-avatar" aria-hidden="true">
        {c.username.charAt(0).toUpperCase()}
      </span>
      <span className="cashier-name">{c.username}</span>
      <GradeBadge grade={c.grade} />
      <span className="cashier-score">
        <strong className="num">{c.score}</strong>
        <span className="cell-muted">/100</span>
      </span>
      <ScoreBar score={c.score} grade={c.grade} />
      <span className="cashier-kpis">
        {[
          { label: 'المبيعات', val: `${fmt(c.totalSales)}` },
          { label: 'الفواتير', val: fmtI(c.totalInvoices) },
          { label: 'هامش الربح', val: `${fmt(c.profitMargin)}%` },
          { label: 'الورديات', val: c.shiftCount },
          { label: 'متوسط فاتورة', val: fmt(c.avgInvoice) },
          { label: 'المرتجعات', val: fmtI(c.totalReturnCount) }
        ].map((item) => (
          <span key={item.label} className="cashier-kpi">
            <span>{item.label}</span>
            <strong className="num">{item.val}</strong>
          </span>
        ))}
      </span>
      <span className="cashier-more">عرض الملف التفصيلي ←</span>
    </button>
  )
}

function DrilldownView({ cashier, drilldown, loading, onBack }) {
  if (loading || !drilldown) {
    return (
      <section className="card">
        <div className="loading-state" style={{ flexDirection: 'column', minHeight: 300 }}>
          <span className="spinner" aria-hidden="true" />
          جاري تحميل تفاصيل {cashier?.username}...
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            العودة
          </button>
        </div>
      </section>
    )
  }

  const peakHour =
    drilldown.peakHours.length > 0
      ? drilldown.peakHours.reduce((a, b) => (b.sales > a.sales ? b : a))
      : null

  return (
    <>
      <div className="page-intro">
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            <ArrowRight size={16} aria-hidden="true" />
            عودة للمقارنة
          </button>
          <h2 className="card-title">
            ملف {cashier.username} التفصيلي
            <GradeBadge grade={cashier.grade} />
          </h2>
        </div>
        <span className="score-pill">
          درجة الأداء <strong className="num">{cashier.score}/100</strong>
        </span>
      </div>

      <Panel icon={ChartColumn} title="ملخص الأداء الكامل">
        <div className="kpi-tiles">
          {[
            { label: 'إجمالي المبيعات', val: `${fmt(cashier.totalSales)} ج.م`, cls: 'text-info' },
            { label: 'صافي الربح', val: `${fmt(cashier.totalProfit)} ج.م`, cls: 'text-success' },
            { label: 'هامش الربح', val: `${fmt(cashier.profitMargin)}%`, cls: 'text-success' },
            { label: 'عدد الفواتير', val: fmtI(cashier.totalInvoices) },
            { label: 'متوسط الفاتورة', val: `${fmt(cashier.avgInvoice)} ج.م` },
            { label: 'أعلى فاتورة', val: `${fmt(cashier.maxInvoice)} ج.م`, cls: 'text-warning' },
            { label: 'عدد الورديات', val: cashier.shiftCount },
            { label: 'متوسط مبيعات الوردية', val: `${fmt(cashier.avgSalesPerShift)} ج.م` },
            { label: 'إجمالي المرتجعات', val: `${fmtI(cashier.totalReturnCount)} عملية` },
            {
              label: 'معدل المرتجعات',
              val: `${fmt(cashier.returnRate)}%`,
              cls: cashier.returnRate > 10 ? 'text-danger' : ''
            },
            { label: 'مبيعات آجل', val: `${fmt(cashier.debtPct)}%`, cls: 'text-warning' },
            {
              label: 'فارق الخزينة الكلي',
              val: `${cashier.totalCashDiff >= 0 ? '+' : ''}${fmt(cashier.totalCashDiff)} ج.م`,
              cls: cashier.totalCashDiff >= 0 ? 'text-success' : 'text-danger'
            }
          ].map((item) => (
            <div key={item.label} className="kpi-tile">
              <span>{item.label}</span>
              <strong className={`num ${item.cls || ''}`}>{item.val}</strong>
            </div>
          ))}
        </div>
      </Panel>

      {drilldown.daily.length > 0 && (
        <Panel icon={TrendingUp} title="المبيعات اليومية">
          <VBarChart
            data={drilldown.daily}
            valueKey="sales"
            labelKey="day"
            colors={['var(--chart-1)']}
          />
        </Panel>
      )}

      {drilldown.shifts.length > 0 && (
        <Panel icon={Clock} title="تفاصيل كل وردية">
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>البداية</th>
                  <th>النهاية</th>
                  <th className="num">المدة</th>
                  <th className="num">فواتير</th>
                  <th className="num">مبيعات</th>
                  <th className="num">ربح</th>
                  <th className="num">فارق الخزينة</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {drilldown.shifts.map((sh) => (
                  <tr key={sh.shift_id}>
                    <td className="num cell-muted">#{sh.shift_id}</td>
                    <td className="num nowrap cell-muted">{sh.start_time?.slice(0, 16) || '—'}</td>
                    <td className="num nowrap cell-muted">{sh.end_time?.slice(0, 16) || '—'}</td>
                    <td className="num">{sh.duration ? `${sh.duration}س` : '—'}</td>
                    <td className="num">{fmtI(sh.invoices)}</td>
                    <td className="num money-strong">{fmt(sh.sales)}</td>
                    <td className={`num ${sh.profit > 0 ? 'text-success' : 'text-danger'}`}>
                      {fmt(sh.profit)}
                    </td>
                    <td
                      className={`num money-strong ${sh.difference === null ? 'cell-muted' : sh.difference >= 0 ? 'text-success' : 'text-danger'}`}
                    >
                      {sh.difference === null
                        ? '—'
                        : `${sh.difference >= 0 ? '+' : ''}${fmt(sh.difference)}`}
                    </td>
                    <td>
                      <span className={`badge ${sh.status === 'open' ? 'badge-success' : ''}`}>
                        {sh.status === 'open' ? 'مفتوحة' : 'مغلقة'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="two-col two-col-top">
        {drilldown.peakHours.length > 0 && (
          <Panel
            icon={Zap}
            title="توزيع الساعات"
            aside={
              peakHour && (
                <span className="card-subtitle">
                  الذروة: <span className="num">{formatHour(peakHour.hour)}</span> (
                  {fmt(peakHour.sales)} ج.م)
                </span>
              )
            }
          >
            <VBarChart
              data={drilldown.peakHours.map((h) => ({ ...h, hourLabel: formatHour(h.hour) }))}
              valueKey="sales"
              labelKey="hourLabel"
              colors={['var(--chart-3)']}
            />
          </Panel>
        )}
        {drilldown.topProducts.length > 0 && (
          <Panel icon={Package} title="أعلى 5 منتجات باعها">
            <ul className="hbar-list">
              {drilldown.topProducts.map((p, i) => {
                const maxQ = drilldown.topProducts[0].qty || 1
                return (
                  <li key={i}>
                    <div className="hbar-head">
                      <span className="text-ellipsis">
                        <span className="cell-muted num">{i + 1}.</span> {p.product_name}
                      </span>
                      <span className="cell-muted num nowrap">{fmtI(p.qty)} وحدة</span>
                    </div>
                    <span className="bar" aria-hidden="true">
                      <span
                        style={{
                          width: `${(p.qty / maxQ) * 100}%`,
                          background: i === 0 ? 'var(--chart-3)' : 'var(--chart-1)'
                        }}
                      />
                    </span>
                  </li>
                )
              })}
            </ul>
          </Panel>
        )}
      </div>

      {drilldown.payment && drilldown.payment.length > 0 && (
        <Panel icon={CreditCard} title="توزيع طرق الدفع">
          <div className="kpi-tiles">
            {drilldown.payment.map((p, i) => {
              const totalAll = drilldown.payment.reduce((s, x) => s + (x.total || 0), 0)
              const pct = totalAll > 0 ? ((p.total / totalAll) * 100).toFixed(1) : 0
              return (
                <div key={i} className="kpi-tile">
                  <span>{p.payment_type}</span>
                  <strong className="num">{pct}%</strong>
                  <span className="cell-muted num">
                    {fmt(p.total)} ج.م · {fmtI(p.count)} فاتورة
                  </span>
                  <span className="bar" aria-hidden="true">
                    <span
                      style={{
                        width: `${pct}%`,
                        background: CHART_COLORS[i % CHART_COLORS.length]
                      }}
                    />
                  </span>
                </div>
              )
            })}
          </div>
        </Panel>
      )}
    </>
  )
}

export default function CashierPerformanceTab() {
  const {
    loading,
    error,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    setQuickFilter,
    runAnalysis,
    cashiers,
    alerts,
    comparisonKey,
    setComparisonKey,
    selectedCashier,
    setSelectedCashier,
    drilldown,
    loadDrilldown
  } = useCashierPerformance()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    runAnalysis()
  }, [])

  const handleSelectCashier = (c) => {
    setSelectedCashier(c)
    loadDrilldown(c)
  }

  if (selectedCashier) {
    return (
      <DrilldownView
        cashier={selectedCashier}
        drilldown={drilldown}
        loading={loading}
        onBack={() => setSelectedCashier(null)}
      />
    )
  }

  if (loading && cashiers.length === 0) {
    return (
      <section className="card">
        <div className="loading-state" style={{ minHeight: 300 }}>
          <span className="spinner" aria-hidden="true" />
          جاري تحليل بيانات الكاشيرات...
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            <CalendarRange size={18} aria-hidden="true" />
            الفترة الزمنية
          </h2>
          <div className="segmented" role="group" aria-label="فترات سريعة">
            {QUICK_BTNS.map((b) => (
              <button key={b.key} type="button" onClick={() => setQuickFilter(b.key)}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body">
          <div className="range-row">
            <label className="field">
              <span className="field-label">من</span>
              <input
                type="datetime-local"
                className="input num"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">إلى</span>
              <input
                type="datetime-local"
                className="input num"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              onClick={runAnalysis}
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} aria-hidden="true" />
              {loading ? 'جاري...' : 'تحديث التقييمات'}
            </button>
          </div>
        </div>
      </section>

      <AlertBanner alerts={alerts} />

      {error && (
        <section className="card">
          <EmptyState icon={CircleAlert} title="تعذّر تحميل التقييمات" text={error}>
            <button type="button" className="btn btn-primary" onClick={runAnalysis}>
              إعادة المحاولة
            </button>
          </EmptyState>
        </section>
      )}

      {!loading && !error && cashiers.length === 0 && (
        <section className="card">
          <EmptyState
            icon={UsersRound}
            title="لا توجد ورديات في الفترة المحددة"
            text='جرّب تحديد فترة أوسع أو اضغط "الكل".'
          />
        </section>
      )}

      {cashiers.length > 0 && (
        <>
          <Panel icon={Award} title="لوحة الترتيب">
            <div className="cashier-grid">
              {cashiers.map((c, i) => (
                <CashierCard key={c.user_id} c={c} rank={i} onSelect={handleSelectCashier} />
              ))}
            </div>
          </Panel>

          <Panel
            icon={ChartColumn}
            title="مقارنة بصرية"
            aside={
              <div className="segmented" role="group" aria-label="معيار المقارنة">
                {COMPARE_OPTS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    className={comparisonKey === o.key ? 'active' : ''}
                    aria-pressed={comparisonKey === o.key}
                    onClick={() => setComparisonKey(o.key)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            }
          >
            <VBarChart
              data={cashiers}
              valueKey={comparisonKey}
              labelKey="username"
              colors={CHART_COLORS}
              wide
            />
          </Panel>

          <Panel icon={Users} title="جدول المقارنة التفصيلية">
            <div className="table-wrap">
              <table className="table table-compact table-clickable">
                <thead>
                  <tr>
                    <th>الترتيب</th>
                    <th>الكاشير</th>
                    <th className="num">الدرجة</th>
                    <th>التقدير</th>
                    <th className="num">المبيعات</th>
                    <th className="num">الفواتير</th>
                    <th className="num">متوسط فاتورة</th>
                    <th className="num">هامش الربح</th>
                    <th className="num">الورديات</th>
                    <th className="num">المرتجعات</th>
                    <th className="num">فارق الخزينة</th>
                    <th className="num">آجل</th>
                  </tr>
                </thead>
                <tbody>
                  {cashiers.map((c, i) => (
                    <tr key={c.user_id} onClick={() => handleSelectCashier(c)}>
                      <td>
                        <span className={`rank rank-${i + 1}`}>{i + 1}</span>
                      </td>
                      <td className="cell-strong">{c.username}</td>
                      <td
                        className={`num money-strong text-${toneOf(c.grade) === 'neutral' ? '2' : toneOf(c.grade)}`}
                      >
                        {c.score}
                      </td>
                      <td>
                        <GradeBadge grade={c.grade} />
                      </td>
                      <td className="num money-strong">{fmt(c.totalSales)}</td>
                      <td className="num">{fmtI(c.totalInvoices)}</td>
                      <td className="num">{fmt(c.avgInvoice)}</td>
                      <td
                        className={`num fw-bold ${c.profitMargin >= 15 ? 'text-success' : c.profitMargin >= 8 ? 'text-warning' : 'text-danger'}`}
                      >
                        {fmt(c.profitMargin)}%
                      </td>
                      <td className="num">{c.shiftCount}</td>
                      <td className={`num ${c.returnRate > 10 ? 'text-danger fw-bold' : ''}`}>
                        {fmt(c.returnRate)}%
                      </td>
                      <td
                        className={`num money-strong ${c.totalCashDiff >= 0 ? 'text-success' : 'text-danger'}`}
                      >
                        {c.totalCashDiff >= 0 ? '+' : ''}
                        {fmt(c.totalCashDiff)}
                      </td>
                      <td className={`num ${c.debtPct > 30 ? 'text-warning' : ''}`}>
                        {fmt(c.debtPct)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  )
}
