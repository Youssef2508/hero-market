import { useCallback, useEffect, useState } from 'react'
import { Boxes, Tags, Truck, Users, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { StatCard } from '../ui'

/**
 * The owner's four figures now (DASH-01, D-071): stock at cost and at selling price, owed to
 * suppliers, owed by customers. Computed by the service on every load (nothing cached); each card
 * opens its detailed screen. Shown only with the reports.valuation permission.
 */
export default function Snapshots({ go }) {
  const [s, setS] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    api('dashboard.snapshots')
      .then((r) => {
        setS(r)
        setError('')
      })
      .catch((e) => setError(e.message))
  }, [])
  useEffect(() => {
    load()
  }, [load])
  const m = (n) => `${formatMoney(n)} ج.م`
  return (
    <section aria-labelledby="snap-title">
      <div className="page-head">
        <h2 id="snap-title" className="overview-section-title">
          <Boxes size={16} aria-hidden="true" />
          الوضع الآن
        </h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
          <RefreshCw size={14} aria-hidden="true" />
          تحديث
        </button>
      </div>
      {error && <p className="text-danger">{error}</p>}
      {s && (
        <div className="stat-grid">
          <StatCard
            icon={Boxes}
            tone="info"
            label="قيمة المخزون بسعر الشراء"
            value={m(s.stockCost)}
            meta={[
              s.negative ? `${s.negative} صنف بالسالب لا يُحسب` : '',
              s.noCost ? `${s.noCost} صنف بدون تكلفة` : ''
            ]
              .filter(Boolean)
              .join(' · ')}
            onClick={() => go('stockvalue')}
          />
          <StatCard
            icon={Tags}
            tone="accent"
            label="قيمة المخزون بسعر البيع"
            value={m(s.stockRetail)}
            onClick={() => go('stockvalue')}
          />
          <StatCard
            icon={Truck}
            tone="danger"
            label="المستحق للموردين"
            value={m(s.supplierOwed)}
            meta={[
              `${s.suppliers} مورد`,
              s.supplierCredit ? `ولنا على موردين ${m(s.supplierCredit)}` : ''
            ]
              .filter(Boolean)
              .join(' · ')}
            onClick={() => go('suppliers')}
          />
          <StatCard
            icon={Users}
            tone="warning"
            label="المستحق على العملاء"
            value={m(s.customerOwed)}
            meta={[
              `${s.customers} عميل`,
              s.customerCredit ? `ولعملاء رصيد ${m(s.customerCredit)}` : ''
            ]
              .filter(Boolean)
              .join(' · ')}
            onClick={() => go('clients')}
          />
        </div>
      )}
    </section>
  )
}
