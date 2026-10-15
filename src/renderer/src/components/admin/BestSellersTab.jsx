import { useEffect } from 'react'
import {
  TrendingUp,
  TrendingDown,
  Package,
  ShoppingCart,
  Banknote,
  Award,
  TriangleAlert,
  PackageCheck
} from 'lucide-react'
import { EmptyState, StatCard } from '../ui'
import { formatMoney } from '../../lib/utils'

const PERIODS = [
  { id: 'daily', label: 'آخر 24 ساعة' },
  { id: 'weekly', label: 'آخر 7 أيام' },
  { id: 'monthly', label: 'آخر 30 يوماً' }
]
const label = (p) => PERIODS.find((x) => x.id === p)?.label || ''

/**
 * Product performance: top sellers and slow movers (useBestSellersManager).
 */
export default function BestSellersTab({
  bsPeriod,
  setBsPeriod,
  bsTopSellers,
  bsSlowMovers,
  bsLoading,
  fetchBestSellers
}) {
  useEffect(() => {
    fetchBestSellers(bsPeriod)
  }, [bsPeriod])

  const handlePeriodChange = (p) => {
    setBsPeriod(p)
    fetchBestSellers(p)
  }

  const maxQty = bsTopSellers[0]?.total_qty_sold || 1
  const totalRevenue = bsTopSellers.reduce((s, r) => s + (r.total_revenue || 0), 0)
  const totalCost = bsTopSellers.reduce((s, r) => s + (r.cost || 0) * r.total_qty_sold, 0)
  const totalProfit = totalRevenue - totalCost
  const totalQty = bsTopSellers.reduce((s, r) => s + (r.total_qty_sold || 0), 0)
  const stagnantCapital = bsSlowMovers.reduce((s, r) => s + (r.cost || 0) * (r.stock || 0), 0)
  const bestSeller = bsTopSellers[0]
  const bestSellerProfit = bestSeller
    ? bestSeller.total_revenue - (bestSeller.cost || 0) * bestSeller.total_qty_sold
    : 0

  return (
    <>
      <div className="toolbar">
        <span className="field-label">الفترة</span>
        <div className="segmented segmented-lg" role="group" aria-label="فترة تقرير المنتجات">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={bsPeriod === p.id ? 'active' : ''}
              aria-pressed={bsPeriod === p.id}
              onClick={() => handlePeriodChange(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {bsLoading && (
          <span className="loading-inline">
            <span className="spinner" aria-hidden="true" /> جاري التحميل...
          </span>
        )}
      </div>

      <div className="stat-grid">
        <StatCard
          icon={Award}
          tone="accent"
          label="أكثر منتج مبيعاً"
          textValue
          value={bestSeller?.name || '—'}
          meta={
            bestSeller
              ? `مبيعات ${bestSeller.total_qty_sold?.toFixed(0)} ${bestSeller.unit} · ربح ${formatMoney(bestSellerProfit)} ج.م`
              : 'لا توجد مبيعات'
          }
        />
        <StatCard
          icon={ShoppingCart}
          tone="info"
          label="إجمالي الوحدات المباعة"
          value={totalQty?.toFixed(2)}
          meta={`من ${bsTopSellers.length} صنف نشط بالفترة`}
        />
        <StatCard
          icon={Banknote}
          tone="success"
          label="إيرادات الأصناف"
          value={`${formatMoney(totalRevenue)} ج.م`}
          meta={`صافي أرباح الأصناف ${formatMoney(totalProfit)} ج.م`}
        />
        <StatCard
          icon={Package}
          tone="danger"
          label="منتجات راكدة"
          value={`${bsSlowMovers.length} صنف`}
          meta={`رأس المال الراكد ${formatMoney(stagnantCapital)} ج.م`}
        />
      </div>

      <div className="two-col two-col-top">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">
              <TrendingUp size={18} aria-hidden="true" />
              الأكثر مبيعاً
            </h2>
            <span className="card-subtitle">{label(bsPeriod)}</span>
          </div>
          <div className="card-body">
            {bsTopSellers.length === 0 && !bsLoading ? (
              <EmptyState
                icon={TrendingUp}
                title="لا توجد مبيعات"
                text="لا توجد مبيعات في هذه الفترة."
              />
            ) : (
              <div className="table-wrap" style={{ maxHeight: 620 }}>
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>#</th>
                      <th>الصنف</th>
                      <th className="num">المباع</th>
                      <th className="num">الإيراد / الربح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bsTopSellers.map((row, idx) => {
                      const barWidth = Math.max(4, Math.round((row.total_qty_sold / maxQty) * 100))
                      const itemProfit = row.total_revenue - (row.cost || 0) * row.total_qty_sold
                      const margin =
                        row.total_revenue > 0 ? (itemProfit / row.total_revenue) * 100 : 0
                      const low = row.stock <= row.reorder_limit
                      return (
                        <tr key={row.barcode}>
                          <td>
                            <span className={`rank rank-${idx + 1}`}>{idx + 1}</span>
                          </td>
                          <td>
                            <span className="cell-strong">{row.name}</span>
                            <span className="meta-row">
                              <span className="mono">{row.barcode}</span>
                              <span>طُلب {row.times_ordered} مرة</span>
                              <span className={low ? 'text-danger' : 'text-success'}>
                                المخزون {row.stock} {row.unit}
                              </span>
                            </span>
                            <span className="bar" aria-hidden="true">
                              <span style={{ width: `${barWidth}%` }} />
                            </span>
                          </td>
                          <td className="num money-strong nowrap">
                            {Number(row.total_qty_sold)?.toFixed(2)} {row.unit}
                          </td>
                          <td className="num nowrap">
                            <span className="money-strong">{formatMoney(row.total_revenue)}</span>
                            <span className="cell-sub text-success">
                              ربح {formatMoney(itemProfit)} ({margin?.toFixed(0)}%)
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2 className="card-title">
              <TrendingDown size={18} aria-hidden="true" />
              منتجات راكدة
            </h2>
            <span className="card-subtitle">بدون مبيعات خلال {label(bsPeriod)}</span>
          </div>
          <div className="card-body">
            {bsSlowMovers.length === 0 && !bsLoading ? (
              <EmptyState
                icon={PackageCheck}
                title="ممتاز"
                text="لا توجد منتجات راكدة في هذه الفترة."
              />
            ) : (
              <div className="table-wrap" style={{ maxHeight: 620 }}>
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>الصنف</th>
                      <th className="num">المخزون</th>
                      <th className="num">قيمة راكدة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bsSlowMovers.map((row) => {
                      const isLowStock = row.reorder_limit > 0 && row.stock <= row.reorder_limit
                      return (
                        <tr key={row.barcode} className={isLowStock ? 'is-alert-row' : ''}>
                          <td>
                            <span className="cell-strong">
                              {isLowStock && (
                                <TriangleAlert
                                  size={14}
                                  className="text-danger"
                                  aria-label="تحت حد الطلب"
                                />
                              )}{' '}
                              {row.name}
                            </span>
                            <span className="meta-row">
                              <span className="mono">{row.barcode}</span>
                              <span>بيع {formatMoney(row.price)}</span>
                              <span>تكلفة {formatMoney(row.cost || 0)}</span>
                            </span>
                          </td>
                          <td
                            className={`num money-strong nowrap ${isLowStock ? 'text-danger' : ''}`}
                          >
                            {row.stock} {row.unit}
                          </td>
                          <td className="num nowrap text-danger">
                            {formatMoney((row.cost || 0) * row.stock)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
