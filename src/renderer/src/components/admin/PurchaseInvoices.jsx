import { useEffect, useState } from 'react'
import { Eye, Filter, PackageMinus, Printer, ReceiptText, X } from 'lucide-react'
import { Pagination, Timestamp } from '../ui'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { useLiveTick } from '../../lib/live'

const PAYMENT = { paid: 'مدفوعة', partial: 'دفع جزئي', credit: 'آجل' }
const PAYMENT_TONE = { paid: 'badge-success', partial: 'badge-warning', credit: 'badge-danger' }
const PAID_FROM = {
  shift: 'درج الوردية',
  treasury: 'الخزنة',
  outside: 'خارج المتجر',
  none: 'بدون دفع'
}

/** The filters as the screen holds them ('' = no filter), and as the service takes them. */
const EMPTY = {
  from: undefined,
  to: undefined,
  supplierId: '',
  search: '',
  payment: '',
  paidFrom: '',
  revised: ''
}
const toRequest = (f, page) => ({
  // undefined: today (the service's day, in the store's time zone); '' : no limit on that side.
  ...(f.from === undefined ? {} : { from: f.from || null }),
  ...(f.to === undefined ? {} : { to: f.to || null }),
  supplierId: f.supplierId ? Number(f.supplierId) : null,
  search: f.search.trim() || null,
  payment: f.payment || null,
  paidFrom: f.paidFrom || null,
  revised: f.revised === '' ? null : f.revised === 'yes',
  page
})

/**
 * Every supplier's purchase invoices (owner, 1.8.0, D-112), apart from the selected supplier: today's
 * by default, newest first, filtered by days (both included, in the store's own time), supplier,
 * number, payment and where it was paid from, and corrected or not; a page of 50 at a time from the
 * service. `focus` ({ supplierId, seq }) shows one supplier's whole history when asked.
 */
export default function PurchaseInvoices({
  suppliers,
  canManage,
  focus,
  refreshKey,
  onView,
  onPrint,
  onReturn
}) {
  const [filters, setFilters] = useState(EMPTY)
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const live = useLiveTick()

  // "All of this supplier's invoices": that supplier, the whole history; the other filters stay.
  useEffect(() => {
    if (!focus?.supplierId) return
    setFilters((f) => ({ ...f, supplierId: String(focus.supplierId), from: '', to: '' }))
    setPage(1)
  }, [focus?.supplierId, focus?.seq])

  useEffect(() => {
    let stop = false
    api('suppliers.purchasesPage', toRequest(filters, page))
      .then((r) => {
        if (stop) return
        setData(r)
        setError('')
        // The first answer says which day "today" is in the store: shown in the date fields.
        if (filters.from === undefined || filters.to === undefined)
          setFilters((f) => ({
            ...f,
            from: f.from === undefined ? r.today : f.from,
            to: f.to === undefined ? r.today : f.to
          }))
      })
      .catch((err) => !stop && setError(err.message))
    return () => {
      stop = true
    }
  }, [filters, page, refreshKey, live])

  const set = (patch) => {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(1)
  }
  const isToday = data && filters.from === data.today && filters.to === data.today

  return (
    <section className="card" aria-labelledby="purchase-invoices-title">
      <div className="card-header">
        <h2 className="card-title" id="purchase-invoices-title">
          <ReceiptText size={18} aria-hidden="true" />
          فواتير الشراء
        </h2>
        {data && (
          <span className="cell-muted">
            {data.count} فاتورة · الصافي {formatMoney(data.total)} ج.م · المدفوع{' '}
            {formatMoney(data.paid)} ج.م
          </span>
        )}
      </div>
      <div className="card-body stack">
        <div
          className="toolbar filter-bar purchase-filters"
          role="group"
          aria-label="تصفية فواتير الشراء"
        >
          <Filter size={16} aria-hidden="true" className="cell-muted" />
          <label className="field">
            <span className="field-label">من يوم</span>
            <input
              type="date"
              className="input"
              value={filters.from ?? ''}
              max={filters.to || undefined}
              onChange={(e) => set({ from: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">إلى يوم</span>
            <input
              type="date"
              className="input"
              value={filters.to ?? ''}
              min={filters.from || undefined}
              onChange={(e) => set({ to: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">المورد</span>
            <select
              className="input"
              value={filters.supplierId}
              onChange={(e) => set({ supplierId: e.target.value })}
            >
              <option value="">كل الموردين</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">رقم الفاتورة</span>
            <input
              className="input"
              maxLength={80}
              placeholder="رقم المورد أو #رقم النظام"
              value={filters.search}
              onChange={(e) => set({ search: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">الدفع</span>
            <select
              className="input"
              value={filters.payment}
              onChange={(e) => set({ payment: e.target.value })}
            >
              <option value="">الكل</option>
              {Object.entries(PAYMENT).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">دُفع من</span>
            <select
              className="input"
              value={filters.paidFrom}
              onChange={(e) => set({ paidFrom: e.target.value })}
            >
              <option value="">الكل</option>
              {Object.entries(PAID_FROM).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">التصحيح</span>
            <select
              className="input"
              value={filters.revised}
              onChange={(e) => set({ revised: e.target.value })}
            >
              <option value="">الكل</option>
              <option value="yes">صُحّحت</option>
              <option value="no">لم تُصحَّح</option>
            </select>
          </label>
          <div className="row">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!!isToday && !filters.supplierId && !filters.search}
              onClick={() => set({ ...EMPTY, from: data?.today, to: data?.today })}
            >
              اليوم
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => set({ ...EMPTY, from: '', to: '' })}
            >
              <X size={14} aria-hidden="true" />
              كل السجل
            </button>
          </div>
        </div>
        {error && <p className="field-error">{error}</p>}
        {!data ? (
          <div className="loading-state">جاري التحميل...</div>
        ) : !data.rows.length ? (
          <p className="cell-muted text-center">لا توجد فواتير شراء بهذه التصفية.</p>
        ) : (
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>الفاتورة</th>
                  <th>المورد</th>
                  <th className="num">الصافي</th>
                  <th className="num">المدفوع</th>
                  <th className="num">المتبقي</th>
                  <th>
                    <span className="visually-hidden">إجراءات</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="ltr-id">{p.invoice_ref || `#${p.id}`}</span>
                      <div className="cell-muted">
                        <Timestamp value={p.timestamp} />
                      </div>
                      <span className={`badge ${PAYMENT_TONE[p.payment_state]}`}>
                        {PAYMENT[p.payment_state]}
                      </span>
                      {p.revision > 0 && (
                        <span className="badge" title="صُحّحت بعد تسجيلها">
                          مراجعة {p.revision}
                        </span>
                      )}
                    </td>
                    <td>{p.supplier_name}</td>
                    <td className="num">
                      {formatMoney(p.total_amount)}
                      {p.discount > 0 && (
                        <div className="cell-muted">خصم {formatMoney(p.discount)}</div>
                      )}
                      {p.returned_value > 0 && (
                        <div className="cell-muted">مرتجع {formatMoney(p.returned_value)}</div>
                      )}
                    </td>
                    <td className="num">
                      {formatMoney(p.paid_amount)}
                      {p.paid_from && <div className="cell-muted">{PAID_FROM[p.paid_from]}</div>}
                    </td>
                    <td
                      className={`num money-strong ${p.outstanding > 0 ? 'text-danger' : 'text-success'}`}
                      title={
                        p.outstanding < 0 ? 'دُفع أكثر من الصافي: المورد مدين للمتجر' : undefined
                      }
                    >
                      {formatMoney(Math.abs(p.outstanding))}
                      {p.outstanding < 0 && <span className="cell-muted"> لنا</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`عرض فاتورة الشراء ${p.invoice_ref || p.id}`}
                          title="عرض الفاتورة وأصنافها"
                          onClick={() => onView(p)}
                        >
                          <Eye size={15} aria-hidden="true" />
                        </button>
                        {canManage && onPrint && (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`طباعة فاتورة الشراء ${p.invoice_ref || p.id}`}
                            title="طباعة الفاتورة (نسخة)"
                            onClick={() => onPrint(p)}
                          >
                            <Printer size={15} aria-hidden="true" />
                          </button>
                        )}
                        {canManage && p.item_count > 0 && (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`مرتجع من فاتورة الشراء ${p.invoice_ref || p.id}`}
                            title="مرتجع مشتريات"
                            onClick={() => onReturn(p)}
                          >
                            <PackageMinus size={15} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.count > data.perPage && (
          <Pagination
            page={page}
            total={data.count}
            perPage={data.perPage}
            shown={data.rows.length}
            noun="فاتورة"
            onPrev={() => setPage(page - 1)}
            onNext={() => setPage(page + 1)}
          />
        )}
      </div>
    </section>
  )
}
