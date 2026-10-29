import { useCallback, useEffect, useState } from 'react'
import { Boxes, TriangleAlert } from 'lucide-react'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { StatCard, EmptyState } from '../ui'
import { packagesText } from '../../../../shared/packages.mjs'

const STATUS = [
  ['all', 'كل الأصناف'],
  ['instock', 'بها رصيد'],
  ['zero', 'رصيدها صفر'],
  ['negative', 'بالسالب'],
  ['nocost', 'بدون تكلفة']
]
const qty = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })

/**
 * Stock value at cost and at selling price (PROD-02, D-071). The service applies the filter to
 * the rows and to the totals alike; the rules are written under the totals.
 */
export default function StockValueTab({ triggerCustomAlert }) {
  const [f, setF] = useState({ search: '', categoryId: null, kind: null, status: 'all' })
  const [includeInactive, setIncludeInactive] = useState(false)
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [cats, setCats] = useState([])
  const [kinds, setKinds] = useState([])

  useEffect(() => {
    api('categories.list')
      .then((r) => setCats(r.categories || r || []))
      .catch(() => setCats([]))
    api('measureKinds.list')
      .then((r) => setKinds(r.kinds || r || []))
      .catch(() => setKinds([]))
  }, [])
  const load = useCallback(
    (p = 1) => {
      api('inventory.valuation', { ...f, includeInactive, page: p })
        .then((r) => {
          setData(r)
          setPage(p)
        })
        .catch((e) => triggerCustomAlert?.('تعذّر تحميل قيمة المخزون: ' + e.message))
    },
    [f, includeInactive, triggerCustomAlert]
  )
  useEffect(() => {
    load(1)
  }, [load])

  const t = data?.totals
  const pages = data ? Math.max(1, Math.ceil(t.products / data.perPage)) : 1
  const m = (n) => `${formatMoney(n)} ج.م`
  return (
    <div className="stack">
      <section className="card">
        <div className="card-body row row-wrap">
          <input
            className="input"
            type="search"
            placeholder="بحث بالاسم أو الباركود"
            aria-label="بحث بالاسم أو الباركود"
            value={f.search}
            onChange={(e) => setF((x) => ({ ...x, search: e.target.value }))}
            style={{ flex: '1 1 220px' }}
          />
          <select
            className="input"
            aria-label="التصنيف"
            value={f.categoryId ?? ''}
            onChange={(e) =>
              setF((x) => ({ ...x, categoryId: e.target.value ? Number(e.target.value) : null }))
            }
          >
            <option value="">كل التصنيفات</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            aria-label="طريقة القياس"
            value={f.kind ?? ''}
            onChange={(e) => setF((x) => ({ ...x, kind: e.target.value || null }))}
          >
            <option value="">كل طرق القياس</option>
            {kinds.map((k) => (
              <option key={k.key} value={k.key}>
                {k.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            aria-label="الحالة"
            value={f.status}
            onChange={(e) => setF((x) => ({ ...x, status: e.target.value }))}
          >
            {STATUS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <label className="check-row">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            مع الأصناف الموقوفة
          </label>
        </div>
      </section>

      {t && (
        <>
          <div className="stat-grid">
            <StatCard icon={Boxes} tone="info" label="القيمة بسعر الشراء" value={m(t.cost)} />
            <StatCard icon={Boxes} tone="accent" label="القيمة بسعر البيع" value={m(t.retail)} />
            <StatCard
              icon={TriangleAlert}
              tone={t.negative ? 'danger' : 'success'}
              label="أصناف بالسالب"
              value={t.negative}
            />
            <StatCard
              icon={TriangleAlert}
              tone={t.noCost ? 'warning' : 'success'}
              label="أصناف بها رصيد بدون تكلفة"
              value={t.noCost}
            />
          </div>
          <p className="field-hint">
            {t.products} صنف في هذا البحث. الكميات بالوحدة الأساسية لكل صنف (العبوات محسوبة ضمنها
            ولا تُعد مرتين، والأصناف بالوزن بالكيلو). القيمة بسعر الشراء = الكمية × سعر آخر شراء
            (تقدير: لا تُتابع تكلفة كل دفعة على حدة)؛ بسعر البيع = الكمية × سعر البيع الحالي. الرصيد بالسالب يُحسب صفراً في الإجمالي.
            الصنف بدون تكلفة يضيف صفراً بسعر الشراء.{' '}
            {data.inactive > 0 &&
              !includeInactive &&
              `${data.inactive} صنف موقوف غير محسوب (اختر «مع الأصناف الموقوفة»).`}
          </p>
          {data.mismatches > 0 && (
            <p className="text-danger" role="alert">
              {data.mismatches} صنف رصيده لا يطابق سجل حركاته: راجع «حركات المخزون».
            </p>
          )}
        </>
      )}

      <section className="card">
        <div className="card-body">
          {!data ? (
            <div className="loading-state">جاري التحميل...</div>
          ) : data.rows.length === 0 ? (
            <EmptyState icon={Boxes} title="لا توجد أصناف بهذا البحث" />
          ) : (
            <div className="table-wrap">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>الباركود</th>
                    <th>الصنف</th>
                    <th>التصنيف</th>
                    <th className="num">الكمية</th>
                    <th className="num">سعر آخر شراء</th>
                    <th className="num">القيمة بسعر الشراء</th>
                    <th className="num">سعر البيع</th>
                    <th className="num">القيمة بسعر البيع</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.barcode}>
                      <td>
                        <span className="ltr-id">{r.barcode}</span>
                      </td>
                      <td>
                        {r.name}
                        {!r.is_active && <span className="badge"> موقوف</span>}
                      </td>
                      <td className="cell-muted">{r.category || '—'}</td>
                      <td className={`num ${r.stock < 0 ? 'text-danger' : ''}`}>
                        {qty(r.stock)} {r.unit}
                        {r.pack_factor > 1 && r.stock > 0 && (
                          <div className="cell-muted">
                            = {packagesText(r.stock, r.pack_factor, r.pack_name, r.unit)}
                          </div>
                        )}
                      </td>
                      <td className={`num ${!r.cost ? 'text-warning' : ''}`}>
                        {r.cost ? formatMoney(r.cost) : 'بدون تكلفة'}
                      </td>
                      <td className="num money-strong">{formatMoney(r.value_cost)}</td>
                      <td className="num">{formatMoney(r.retail)}</td>
                      <td className="num money-strong">{formatMoney(r.value_retail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && pages > 1 && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => load(page - 1)}
              >
                السابق
              </button>
              <span className="num">
                {page} / {pages}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page >= pages}
                onClick={() => load(page + 1)}
              >
                التالي
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
