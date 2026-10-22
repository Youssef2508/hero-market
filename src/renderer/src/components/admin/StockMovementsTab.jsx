import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { EmptyState, Timestamp } from '../ui'

// Same labels as each product's history (StockHistoryModal).
const KINDS = [
  ['purchase', 'استلام شراء'],
  ['sale', 'بيع'],
  ['return', 'مرتجع بيع'],
  ['purchase_return', 'مرتجع مشتريات'],
  ['count', 'جرد'],
  ['adjustment', 'تسوية يدوية'],
  ['damaged', 'هالك'],
  ['damaged_reversal', 'إلغاء هالك'],
  ['opening', 'رصيد افتتاحي']
]
const KIND = Object.fromEntries(KINDS)
const REF = {
  sale: 'فاتورة بيع',
  sale_item: 'فاتورة بيع',
  purchase: 'فاتورة شراء',
  purchase_return: 'مرتجع مشتريات',
  damaged: 'سجل هالك',
  product: 'شاشة الصنف',
  import: 'ملف الاستيراد'
}
const qty = (n) => {
  const v = Number(n)
  return `${v > 0 ? '+' : ''}${v.toLocaleString('en-US', { maximumFractionDigits: 3 })}`
}

/**
 * Every stock movement of the store (STOCK-01, D-071): the same rows as each product's own
 * history, newest first, filtered by product, type and dates. A sale opens its invoice.
 */
export default function StockMovementsTab({ onOpenInvoice, triggerCustomAlert }) {
  const [f, setF] = useState({ search: '', kind: '', from: '', to: '' })
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)

  const load = useCallback(
    (p = 1) => {
      api('inventory.allMovements', {
        search: f.search || undefined,
        kinds: f.kind ? [f.kind] : undefined,
        from: f.from || null,
        to: f.to || null,
        page: p
      })
        .then((r) => {
          setData(r)
          setPage(p)
        })
        .catch((e) => triggerCustomAlert?.('تعذّر تحميل الحركات: ' + e.message))
    },
    [f, triggerCustomAlert]
  )
  useEffect(() => {
    load(1)
  }, [load])

  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1
  const source = (m) => {
    const label = REF[m.ref_type] || m.ref_type || '—'
    if (!m.ref_id) return label
    if (m.ref_type === 'sale' && onOpenInvoice)
      return (
        <button type="button" className="link-btn" onClick={() => onOpenInvoice(m.ref_id)}>
          {label} <span className="ltr-id">#{m.ref_id}</span>
        </button>
      )
    return (
      <>
        {label} <span className="ltr-id">#{m.ref_id}</span>
      </>
    )
  }
  return (
    <div className="stack">
      <section className="card">
        <div className="card-body row row-wrap">
          <input
            className="input"
            type="search"
            placeholder="الصنف: الاسم أو الباركود"
            aria-label="الصنف: الاسم أو الباركود"
            value={f.search}
            onChange={(e) => setF((x) => ({ ...x, search: e.target.value }))}
            style={{ flex: '1 1 220px' }}
          />
          <select
            className="input"
            aria-label="نوع الحركة"
            value={f.kind}
            onChange={(e) => setF((x) => ({ ...x, kind: e.target.value }))}
          >
            <option value="">كل الأنواع</option>
            {KINDS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <label className="field">
            <span className="field-label">من</span>
            <input
              className="input"
              type="date"
              value={f.from}
              onChange={(e) => setF((x) => ({ ...x, from: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="field-label">إلى</span>
            <input
              className="input"
              type="date"
              value={f.to}
              onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))}
            />
          </label>
        </div>
      </section>
      <section className="card">
        <div className="card-body">
          {!data ? (
            <div className="loading-state">جاري التحميل...</div>
          ) : data.rows.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} title="لا توجد حركات بهذا البحث" />
          ) : (
            <>
              <p className="cell-muted">{data.total} حركة</p>
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>الصنف</th>
                      <th>النوع</th>
                      <th className="num">الكمية</th>
                      <th className="num">الرصيد بعدها</th>
                      {'cost' in data.rows[0] && <th className="num">التكلفة</th>}
                      <th>المصدر</th>
                      <th>المستخدم</th>
                      <th>السبب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((m) => (
                      <tr key={m.id}>
                        <td className="nowrap cell-muted">
                          <Timestamp value={m.created_at} />
                        </td>
                        <td>
                          {m.name}
                          <div className="cell-muted">
                            <span className="ltr-id">{m.barcode}</span>
                          </div>
                        </td>
                        <td>
                          <span className="badge">{KIND[m.kind] || m.kind}</span>
                        </td>
                        <td
                          className={`num money-strong ${m.qty < 0 ? 'text-danger' : 'text-success'}`}
                        >
                          {qty(m.qty)} {m.unit}
                        </td>
                        <td className="num">{qty(m.balance_after).replace('+', '')}</td>
                        {'cost' in m && (
                          <td className="num">{m.cost === null ? '—' : formatMoney(m.cost)}</td>
                        )}
                        <td>{source(m)}</td>
                        <td>{m.username || '—'}</td>
                        <td className="cell-muted">{m.reason || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
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
