import { useEffect } from 'react'
import { useAdvancedAnalytics } from '../../hooks/useAdvancedAnalytics'
import {
  ChartColumn,
  CalendarRange,
  TrendingUp,
  TrendingDown,
  Banknote,
  ShoppingCart,
  Clock,
  Activity,
  Sparkles,
  Award,
  RefreshCw,
  Package,
  CreditCard,
  TriangleAlert,
  Zap,
  SearchX,
  Star
} from 'lucide-react'
import { EmptyState, StatCard } from '../ui'
import { VBarChart } from '../ui/charts'
import { CHART_COLORS } from '../ui/chartColors'
import { formatMoney } from '../../lib/utils'

const fmt = (n) => formatMoney(n)
const fmtInt = (n) => Math.round(n || 0).toLocaleString('en-US')

const QUICK_BTNS = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: '3days', label: '3 أيام' },
  { key: 'week', label: 'أسبوع' },
  { key: 'month', label: 'شهر' },
  { key: 'all', label: 'الكل' }
]

function Stars({ count }) {
  return (
    <span className="stars" aria-label={`${count} من 3`}>
      {[0, 1, 2].map((i) => (
        <Star key={i} size={13} fill={i < count ? 'currentColor' : 'none'} aria-hidden="true" />
      ))}
    </span>
  )
}

function Panel({ icon: Icon, title, children, aside }) {
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">
          {Icon && <Icon size={18} aria-hidden="true" />}
          {title}
        </h2>
        {aside}
      </div>
      <div className="card-body">{children}</div>
    </section>
  )
}

export default function AdvancedStatsTab() {
  const {
    loading,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    setQuickFilter,
    runAnalysis,
    summary,
    shiftRows,
    peakHours,
    dailyTrend,
    topProducts,
    paymentBreakdown
  } = useAdvancedAnalytics()

  useEffect(() => {
    runAnalysis()
  }, [])

  const peakHour =
    peakHours.length > 0
      ? peakHours.reduce((a, b) => (b.total_sales > a.total_sales ? b : a))
      : null
  const bestDay =
    dailyTrend.length > 0
      ? dailyTrend.reduce((a, b) => (b.total_sales > a.total_sales ? b : a))
      : null

  const smartSummary = (() => {
    if (!summary || summary.totalSales === 0)
      return 'لا توجد بيانات كافية لإنشاء الملخص الذكي للفترة المحددة.'
    const parts = []
    parts.push(
      `خلال الفترة المحددة حقق المتجر مبيعات بقيمة ${fmt(summary.totalSales)} ج.م من خلال ${fmtInt(summary.invoiceCount)} فاتورة.`
    )
    parts.push(`صافي الربح ${fmt(summary.netProfit)} ج.م بهامش ربح ${fmt(summary.profitMargin)}%.`)
    if (bestDay)
      parts.push(`أفضل يوم مبيعاً: ${bestDay.day} بإجمالي ${fmt(bestDay.total_sales)} ج.م.`)
    if (peakHour)
      parts.push(`أعلى ساعة مبيعاً: الساعة ${peakHour.hour}:00 (${fmt(peakHour.total_sales)} ج.م).`)
    if (topProducts.length > 0)
      parts.push(
        `الصنف الأكثر مبيعاً: ${topProducts[0].product_name} (${fmtInt(topProducts[0].qty_sold)} وحدة).`
      )
    if (summary.totalExpenses > 0)
      parts.push(`إجمالي المصروفات: ${fmt(summary.totalExpenses)} ج.م.`)
    return parts.join(' ')
  })()

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
              <span className="field-label">من تاريخ وساعة</span>
              <input
                type="datetime-local"
                className="input num"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">حتى تاريخ وساعة</span>
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
              {loading ? 'جاري التحليل...' : 'تشغيل التحليل'}
            </button>
          </div>
        </div>
      </section>

      {!loading && summary && summary.totalSales === 0 && (
        <section className="card">
          <EmptyState
            icon={SearchX}
            title="لا توجد ورديات أو مبيعات في الفترة المحددة"
            text='جرّب تحديد فترة زمنية مختلفة أو اضغط على "الكل".'
          />
        </section>
      )}

      {summary && summary.totalSales > 0 && (
        <>
          <div className="stat-grid">
            <StatCard
              icon={Banknote}
              tone="accent"
              label="إجمالي المبيعات"
              value={`${fmt(summary.totalSales)} ج.م`}
              meta={`${fmtInt(summary.invoiceCount)} فاتورة`}
            />
            <StatCard
              icon={TrendingUp}
              tone="success"
              label="صافي الربح"
              value={`${fmt(summary.netProfit)} ج.م`}
              meta={`هامش الربح ${fmt(summary.profitMargin)}%`}
            />
            <StatCard
              icon={TrendingDown}
              tone="danger"
              label="إجمالي المصروفات"
              value={`${fmt(summary.totalExpenses)} ج.م`}
              meta="مصاريف تشغيلية"
            />
            <StatCard
              icon={Activity}
              tone={summary.netCashFlow >= 0 ? 'success' : 'danger'}
              label="السيولة النقدية"
              value={`${fmt(summary.netCashFlow)} ج.م`}
              meta="نقد داخل − مصروفات"
            />
            <StatCard
              icon={ShoppingCart}
              tone="purple"
              label="متوسط الفاتورة"
              value={`${fmt(summary.avgInvoice)} ج.م`}
              meta="متوسط قيمة عملية الشراء"
            />
            <StatCard
              icon={Award}
              tone="warning"
              label="أعلى فاتورة"
              value={`${fmt(summary.maxInvoice)} ج.م`}
              meta="أعلى قيمة فاتورة واحدة"
            />
            <StatCard
              icon={CreditCard}
              tone="warning"
              label="مبيعات آجل"
              value={`${fmt(summary.debtSales)} ج.م`}
              meta="مبيعات على حساب عملاء"
            />
            <StatCard
              icon={RefreshCw}
              tone="info"
              label="إجمالي المرتجعات"
              value={`${fmt(summary.totalReturns)} ج.م`}
              meta={`${fmtInt(summary.returnCount)} عملية مرتجع`}
            />
            {summary.damagedCost > 0 && (
              <StatCard
                icon={TriangleAlert}
                tone="danger"
                label="تكلفة التوالف"
                value={`${fmt(summary.damagedCost)} ج.م`}
                meta="مخصومة من الربح"
              />
            )}
          </div>

          {dailyTrend.length > 1 && (
            <Panel
              icon={ChartColumn}
              title="المبيعات اليومية في الفترة"
              aside={
                bestDay && (
                  <span className="card-subtitle">
                    أفضل يوم: <strong className="num">{bestDay.day}</strong> —{' '}
                    {fmt(bestDay.total_sales)} ج.م ({fmtInt(bestDay.invoice_count)} فاتورة)
                  </span>
                )
              }
            >
              <VBarChart
                data={dailyTrend}
                valueKey="total_sales"
                labelKey="day"
                colors={['var(--chart-1)']}
                formatValue={fmt}
              />
            </Panel>
          )}

          {peakHours.length > 0 && (
            <Panel icon={Zap} title="ساعات الذروة وتوزيع المبيعات">
              {peakHour && (
                <div className="notice notice-warning" style={{ marginBottom: 'var(--sp-4)' }}>
                  <Zap size={16} aria-hidden="true" />
                  <span>
                    أعلى ساعة مبيعاً: الساعة <strong className="num">{peakHour.hour}:00</strong> —{' '}
                    {fmt(peakHour.total_sales)} ج.م ({fmtInt(peakHour.invoice_count)} فاتورة، متوسط{' '}
                    {fmt(peakHour.avg_sale)} ج.م)
                  </span>
                </div>
              )}
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>الساعة</th>
                      <th className="num">الفواتير</th>
                      <th className="num">المبيعات</th>
                      <th className="num">متوسط الفاتورة</th>
                      <th style={{ width: '30%' }}>النشاط</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peakHours.map((h, i) => {
                      const maxSales = Math.max(...peakHours.map((x) => x.total_sales || 0))
                      const pct = maxSales > 0 ? (h.total_sales / maxSales) * 100 : 0
                      const isPeak = h.total_sales === maxSales
                      return (
                        <tr key={i}>
                          <td className="num fw-bold">
                            {isPeak && <Zap size={13} className="text-warning" aria-label="ذروة" />}{' '}
                            {h.hour}:00
                          </td>
                          <td className="num">{fmtInt(h.invoice_count)}</td>
                          <td className={`num money-strong ${isPeak ? 'text-warning' : ''}`}>
                            {fmt(h.total_sales)}
                          </td>
                          <td className="num">{fmt(h.avg_sale)}</td>
                          <td>
                            <span className="bar bar-lg" aria-hidden="true">
                              <span
                                style={{
                                  width: `${pct}%`,
                                  background: isPeak ? 'var(--chart-3)' : 'var(--chart-1)'
                                }}
                              />
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {shiftRows.length > 0 && (
            <Panel icon={Clock} title="تفاصيل كل وردية في الفترة">
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>الكاشير</th>
                      <th>البداية</th>
                      <th>النهاية</th>
                      <th className="num">المدة</th>
                      <th className="num">فواتير</th>
                      <th className="num">مبيعات</th>
                      <th className="num">ربح</th>
                      <th className="num">مصروفات</th>
                      <th className="num">آجل</th>
                      <th className="num">الفرق</th>
                      <th>تقييم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftRows.map((sh) => {
                      const diff = sh.difference
                      return (
                        <tr key={sh.id}>
                          <td className="num cell-muted">#{sh.id}</td>
                          <td className="cell-strong">{sh.username}</td>
                          <td className="num nowrap cell-muted">
                            {sh.start_time?.slice(0, 16) || '—'}
                          </td>
                          <td className="num nowrap cell-muted">
                            {sh.end_time?.slice(0, 16) || (
                              <span className="badge badge-success">مفتوحة</span>
                            )}
                          </td>
                          <td className="num">{sh.durationHrs ? `${sh.durationHrs}س` : '—'}</td>
                          <td className="num">{fmtInt(sh.invoices)}</td>
                          <td className="num money-strong">{fmt(sh.sales)}</td>
                          <td className={`num ${sh.profit > 0 ? 'text-success' : 'text-danger'}`}>
                            {fmt(sh.profit)}
                          </td>
                          <td className="num text-danger">{fmt(sh.expenses)}</td>
                          <td className="num text-warning">{fmt(sh.debt)}</td>
                          <td
                            className={`num money-strong ${diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : 'cell-muted'}`}
                          >
                            {diff === null ? '—' : `${diff > 0 ? '+' : ''}${fmt(diff)}`}
                          </td>
                          <td>
                            <Stars count={sh.stars} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <div className="two-col two-col-top">
            {topProducts.length > 0 && (
              <Panel icon={Package} title="أعلى 10 منتجات مبيعاً">
                <ul className="hbar-list">
                  {topProducts.map((p, i) => {
                    const maxQty = topProducts[0].qty_sold || 1
                    const pct = (p.qty_sold / maxQty) * 100
                    return (
                      <li key={i}>
                        <div className="hbar-head">
                          <span className="text-ellipsis">
                            <span className="cell-muted num">{i + 1}.</span> {p.product_name}
                          </span>
                          <span className="cell-muted num nowrap">
                            {fmtInt(p.qty_sold)} وحدة · {fmt(p.revenue)} ج.م
                          </span>
                        </div>
                        <span className="bar" aria-hidden="true">
                          <span
                            style={{
                              width: `${pct}%`,
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

            {paymentBreakdown.length > 0 && (
              <Panel icon={CreditCard} title="توزيع طرق الدفع">
                <ul className="hbar-list">
                  {paymentBreakdown.map((p, i) => {
                    const totalAll = paymentBreakdown.reduce((s, x) => s + (x.total || 0), 0)
                    const pct = totalAll > 0 ? ((p.total / totalAll) * 100).toFixed(1) : 0
                    return (
                      <li key={i}>
                        <div className="hbar-head">
                          <span className="fw-bold">{p.payment_type}</span>
                          <span className="cell-muted num nowrap">
                            {fmt(p.total)} ج.م ({pct}%) · {fmtInt(p.count)} فاتورة
                          </span>
                        </div>
                        <span className="bar bar-lg" aria-hidden="true">
                          <span
                            style={{
                              width: `${pct}%`,
                              background: CHART_COLORS[i % CHART_COLORS.length]
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

          <Panel icon={Sparkles} title="الملخص الذكي للفترة">
            <p className="summary-text">{smartSummary}</p>
          </Panel>
        </>
      )}
    </>
  )
}
