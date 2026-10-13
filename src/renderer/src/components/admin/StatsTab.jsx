import { useEffect } from 'react'
import { Banknote, CircleCheck, Package, TrendingDown, Clock, Activity, Info } from 'lucide-react'
import { StatCard } from '../ui'
import { formatMoney } from '../../lib/utils'

const PERIODS = [
  { id: 'daily', label: 'اليوم' },
  { id: 'weekly', label: 'آخر 7 أيام' },
  { id: 'monthly', label: 'آخر 30 يوماً' },
  { id: 'all', label: 'كل الأوقات' }
]

/**
 * Performance & profit summary. Figures come from useAdminController#fetchAnalytics.
 */
export default function StatsTab({
  dbStats,
  statsPeriod,
  setStatsPeriod,
  periodicAnalytics,
  fetchAnalytics
}) {
  useEffect(() => {
    fetchAnalytics(statsPeriod)
  }, [statsPeriod])

  const pa = periodicAnalytics || {}
  const profitMargin = pa.totalSales > 0 ? ((pa.netProfit / pa.totalSales) * 100).toFixed(0) : 0

  return (
    <>
      <div className="toolbar">
        <span className="field-label">الفترة</span>
        <div className="segmented segmented-lg" role="group" aria-label="فترة الملخص المالي">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={statsPeriod === p.id ? 'active' : ''}
              aria-pressed={statsPeriod === p.id}
              onClick={() => setStatsPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stat-grid stat-grid-3">
        <StatCard
          icon={Banknote}
          tone="accent"
          label="إجمالي المبيعات"
          value={`${formatMoney(pa.totalSales)} ج.م`}
          meta={`عدد العمليات: ${pa.invoiceCount || 0} فاتورة`}
        />
        <StatCard
          icon={CircleCheck}
          tone={pa.netProfit < 0 ? 'danger' : 'success'}
          label="صافي الأرباح"
          value={`${formatMoney(pa.netProfit)} ج.م`}
          meta={`هامش ربح المبيعات: ${profitMargin}%`}
        />
        <StatCard
          icon={TrendingDown}
          tone="danger"
          label="إجمالي المصروفات"
          value={`${formatMoney(pa.totalExpenses)} ج.م`}
          meta="مصاريف تشغيلية مدفوعة"
        />
        <StatCard
          icon={Activity}
          tone={pa.netCashFlow >= 0 ? 'success' : 'danger'}
          label="السيولة النقدية (الخزينة)"
          value={`${formatMoney(pa.netCashFlow)} ج.م`}
          meta="الكاش الداخل مطروحاً منه المصروفات"
        />
        <StatCard
          icon={Clock}
          tone="warning"
          label="مستحقات العملاء (الآجل)"
          value={`${formatMoney(pa.outstandingDebt)} ج.م`}
          meta="إجمالي ديون العملاء الحالية"
        />
        <StatCard
          icon={Package}
          tone={dbStats?.lowStock > 0 ? 'danger' : 'neutral'}
          label="المخزن وحد الطلب"
          value={`${dbStats?.totalItems || 0} صنف`}
          meta={
            dbStats?.lowStock > 0 ? `${dbStats.lowStock} صنف تحت حد الطلب` : 'جميع الأصناف متوفرة'
          }
        />
      </div>

      <div className="notice notice-info">
        <Info size={18} aria-hidden="true" />
        <p>
          يحسب الملخص الإيرادات والأرباح والمصروفات والسيولة بناءً على العمليات المسجلة في الورديات
          التي بدأت خلال الفترة المحددة. تُحتسب مبيعات الآجل ضمن مستحقات العملاء، وتُحسب السيولة من
          النقد المحصل فعلياً بعد خصم المصروفات.
        </p>
      </div>
    </>
  )
}
