// ─────────────────────────────────────────────────────────────
// الورديات (owner, 2026-10-21, D-063; SHIFT-01): every shift, open and closed, with filters, and a
// full details page per shift – opening float, expected cash, counted cash, difference, sales by
// payment method (click to filter), the invoices, expenses and returns. Figures come from the
// service (shifts.list / shifts.details), the same records the close saves and prints.
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Plus,
  Printer,
  ChartColumn,
  Clock
} from 'lucide-react'
import { formatMoney } from '../../lib/utils'
import { api, can } from '../../lib/api'
import { EmptyState } from '../ui'
import { MethodReconciliation, MoneyCategories } from './ShiftMoney'

const PAGE_SIZE = 25
// Live details of an open shift refresh every 5 seconds while shown: each refresh reads the saved
// records again, so the figures are right after a reconnect too.
const LIVE_REFRESH_MS = 5000

const METHODS = [
  { key: 'cash', label: 'نقدي', tone: 'cash' },
  { key: 'visa', label: 'فيزا', tone: 'visa' },
  { key: 'instapay', label: 'انستاباي', tone: 'instapay' },
  { key: 'wallet', label: 'محفظة', tone: 'wallet' }
]
const TYPE_METHOD = {
  نقدي: 'cash',
  فيزا: 'visa',
  محفظة: 'wallet',
  'فودافون كاش': 'wallet',
  'انستا باي': 'instapay'
}
const METHOD_LABEL = { cash: 'نقدي', visa: 'فيزا', wallet: 'محفظة', instapay: 'انستاباي' }
const invoiceNo = (id) => `INV-${id}`
const money = (n) => formatMoney(n || 0)
const signed = (v) => (v > 0 ? `+${money(v)}` : money(v))

/** "21/10 07:40 AM" (list) or "21/10/2026 07:40 AM" (details). */
function stamp(value, withYear = false) {
  if (!value) return '—'
  const d = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return String(value)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const h = d.getHours()
  const time = `${String(h % 12 || 12).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  return `${dd}/${mm}${withYear ? `/${d.getFullYear()}` : ''} ${time}`
}

function duration(start, end) {
  if (!start || !end) return null
  const ms = new Date(String(end).replace(' ', 'T')) - new Date(String(start).replace(' ', 'T'))
  if (!(ms > 0)) return null
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  return h ? `${h} ساعة${m ? ` و${m} دقيقة` : ''}` : `${m} دقيقة`
}

function PaginationBar({ page, totalPages, setPage, total }) {
  return (
    <div className="pagination-controls">
      <div className="pagination-info">
        صفحة <span className="num">{page}</span> من <span className="num">{totalPages}</span> ·{' '}
        <span className="num">{total}</span> إجمالي
      </div>
      <div className="pagination-buttons">
        <button
          type="button"
          className="btn btn-sm btn-secondary btn-icon"
          onClick={() => setPage(1)}
          disabled={page === 1}
          aria-label="الصفحة الأولى"
        >
          <ChevronsRight size={16} />
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          <ChevronRight size={16} aria-hidden="true" />
          السابق
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
        >
          التالي
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary btn-icon"
          onClick={() => setPage(totalPages)}
          disabled={page === totalPages}
          aria-label="الصفحة الأخيرة"
        >
          <ChevronsLeft size={16} />
        </button>
      </div>
    </div>
  )
}

function StatusPill({ status }) {
  return status === 'open' ? (
    <span className="shift-pill is-open">مفتوحة</span>
  ) : (
    <span className="shift-pill is-closed">مغلقة</span>
  )
}

/** The list of shifts with the branch and day filters. */
function ShiftsList({ onDetails, onOpenShift, canOpen, triggerCustomAlert }) {
  const [rows, setRows] = useState(null)
  const [branch, setBranch] = useState('')
  const [branchName, setBranchName] = useState('')
  const [date, setDate] = useState('')
  const [applied, setApplied] = useState({ date: '' })
  const [page, setPage] = useState(1)

  useEffect(() => {
    let stopped = false
    api('shifts.list', { date: applied.date || null })
      .then((r) => {
        if (stopped) return
        setRows(r.rows)
        setBranchName(r.branch)
        setPage(1)
      })
      .catch((err) => triggerCustomAlert?.('تعذّر تحميل الورديات: ' + err.message))
    return () => {
      stopped = true
    }
  }, [applied, triggerCustomAlert])

  const data = rows || []
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE))
  const pageData = data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">الورديات</h1>
          <p className="page-subtitle">إدارة ومتابعة ورديات العمل</p>
        </div>
        {canOpen && (
          <button type="button" className="btn btn-primary" onClick={onOpenShift}>
            <Plus size={16} aria-hidden="true" />
            فتح وردية جديدة
          </button>
        )}
      </div>

      <section className="card">
        <form
          className="card-body shift-filters"
          onSubmit={(e) => {
            e.preventDefault()
            setApplied({ date })
          }}
        >
          <label className="field">
            <span className="field-label">الفرع</span>
            <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">كل الفروع</option>
              {branchName && <option value={branchName}>{branchName}</option>}
            </select>
          </label>
          <label className="field">
            <span className="field-label">التاريخ</span>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-sm">
            تصفية
          </button>
        </form>
      </section>

      <section className="card">
        <div className="card-body stack">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الكاشير</th>
                  <th>الفرع</th>
                  <th>الفتح</th>
                  <th>الإغلاق</th>
                  <th className="num">افتتاح</th>
                  <th className="num">المتوقع</th>
                  <th className="num">الفعلي</th>
                  <th className="num">الفرق</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows === null ? (
                  <tr>
                    <td colSpan="11" className="table-empty">
                      جاري التحميل...
                    </td>
                  </tr>
                ) : pageData.length === 0 ? (
                  <tr>
                    <td colSpan="11" className="table-empty">
                      لا توجد ورديات بهذه الشروط.
                    </td>
                  </tr>
                ) : (
                  pageData.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-strong">
                        <span className="ltr-id">{s.id}</span>
                      </td>
                      <td>{s.username}</td>
                      <td>{branchName}</td>
                      <td className="nowrap num">{stamp(s.start_time)}</td>
                      <td className="nowrap num">{s.end_time ? stamp(s.end_time) : '—'}</td>
                      <td className="num">{money(s.initial_cash)}</td>
                      <td className="num">{s.expected === null ? '—' : money(s.expected)}</td>
                      <td className={`num ${s.status === 'open' ? 'cell-muted' : ''}`}>
                        {money(s.actual)}
                      </td>
                      <td
                        className={`num money-strong ${s.difference < 0 ? 'text-danger' : s.difference > 0 ? 'text-success' : ''}`}
                      >
                        {signed(s.difference)}
                      </td>
                      <td>
                        <StatusPill status={s.status} />
                      </td>
                      <td>
                        <button type="button" className="link-btn" onClick={() => onDetails(s.id)}>
                          تفاصيل
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <PaginationBar
              page={page}
              totalPages={totalPages}
              setPage={setPage}
              total={data.length}
            />
          )}
        </div>
      </section>
    </>
  )
}

/** The full page of one shift. */
function ShiftDetailsPage({ shiftId, onBack, onOpenInvoice, triggerCustomAlert }) {
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    try {
      const d = await api('shifts.details', { shiftId })
      setData(d)
      return d
    } catch (err) {
      triggerCustomAlert?.('تعذّر عرض تفاصيل الوردية: ' + err.message)
      onBack()
      return null
    }
  }, [shiftId, onBack, triggerCustomAlert])

  useEffect(() => {
    let timer = null
    let stopped = false
    const tick = async () => {
      const d = await load()
      if (!stopped && d && d.shift.status === 'open') timer = setTimeout(tick, LIVE_REFRESH_MS)
    }
    tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [load])

  const byMethod = useMemo(() => {
    const out = {}
    for (const s of data?.sales || []) {
      const m = TYPE_METHOD[s.payment_type] || 'account'
      out[m] = out[m] || { count: 0, total: 0 }
      out[m].count += 1
      out[m].total += s.total
    }
    return out
  }, [data])

  if (!data) return <div className="loading-state">جاري التحميل...</div>

  const { shift, report: r, sales } = data
  const open = shift.status === 'open'
  // A close saved since 1.5.0 has its counted amounts; older closes have the drawer figures only.
  const expectedCash = open
    ? r.expected.cash
    : r.actual
      ? r.expected.cash
      : Number(shift.expected_end_cash)
  const actualCash = open ? 0 : r.actual ? r.actual.cash : Number(shift.actual_end_cash)
  const difference = open ? 0 : r.actual ? r.variance.cash : Number(shift.difference || 0)
  const shown =
    filter === 'all'
      ? sales
      : sales.filter((s) => (TYPE_METHOD[s.payment_type] || 'account') === filter)
  const allTotal = sales.reduce((a, s) => a + s.total, 0)
  const typeOf = (s) =>
    s.is_delivery ? 'توصيل' : ['آجل', 'دفع جزئي'].includes(s.payment_type) ? 'آجل' : 'نقدي'

  const print = async () => {
    if (!window.api?.printer?.printReport) return
    try {
      // A closed shift printed from its details is a copy of the saved close (POS-02, D-077).
      if (r.actual || open)
        await window.api.printer.printReport('close', { report: r, copy: !open })
      else
        await window.api.printer.printReport('shift', {
          shift: { ...shift, username: data.cashier },
          cashSales: r.cash?.sales,
          inflow: r.cash?.inflow,
          outflow: (r.cash?.expenses || 0) + (r.cash?.refunds || 0) + (r.cash?.supplier || 0),
          expected: expectedCash,
          actual: actualCash,
          difference,
          manualDiscounts: r.manualDiscounts
        })
    } catch (err) {
      triggerCustomAlert?.('تعذّرت الطباعة: ' + err.message)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">تفاصيل الوردية #{shift.id}</h1>
          <p className="page-subtitle">
            {data.cashier} — {stamp(shift.start_time, true).split(' ')[0]}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={print}>
            <Printer size={15} aria-hidden="true" />
            طباعة الوردية
          </button>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            رجوع
          </button>
        </div>
      </div>

      <div className="shift-kpis">
        <div className="card shift-kpi">
          <span>الافتتاح</span>
          <strong>{money(r.openingFloat)}</strong>
        </div>
        <div className="card shift-kpi tone-blue">
          <span>المتوقع نقدي</span>
          <strong>{money(expectedCash)}</strong>
        </div>
        <div className="card shift-kpi tone-green">
          <span>الفعلي (كاش)</span>
          <strong>{money(actualCash)}</strong>
        </div>
        <div className={`card shift-kpi ${difference < 0 ? 'tone-red' : 'tone-green'}`}>
          <span>الفرق</span>
          <strong>{signed(difference)}</strong>
        </div>
      </div>

      {/* D-064: expected, counted and the difference per payment method, with the totals – the
          same figures as the closing report. */}
      <section className="card">
        <div className="card-body stack">
          <h2 className="card-title">التسوية حسب طريقة الدفع</h2>
          <MethodReconciliation
            report={r}
            legacyActualCash={!open && !r.actual ? actualCash : null}
          />
          <MoneyCategories report={r} />
          {data.corrections?.length > 0 && (
            <>
              <h3 className="till-section-title">تصحيحات طريقة الدفع لفواتير هذه الوردية</h3>
              <ul className="stack">
                {data.corrections.map((c, i) => (
                  <li key={i} className="cell-muted">
                    <span className="ltr-id">{invoiceNo(c.saleId)}</span>: من {c.from_type} إلى{' '}
                    {c.to_type} ({money(c.amount)} ج.م) – {c.username}
                    {c.after_close ? ' – بعد إغلاق الوردية (لا تتحرك أي مبالغ)' : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-body stack">
          <h2 className="card-title">
            <ChartColumn size={18} aria-hidden="true" />
            تفصيلة المبيعات حسب طريقة الدفع — اضغط لفلترة
          </h2>
          <div className="row row-wrap">
            <button
              type="button"
              className={`method-chip is-all ${filter === 'all' ? 'is-active' : ''}`}
              onClick={() => setFilter('all')}
            >
              الكل <strong>{money(allTotal)} ج.م</strong>{' '}
              <span className="cell-muted">({sales.length} فاتورة)</span>
            </button>
            {[...METHODS, { key: 'account', label: 'آجل', tone: 'account' }]
              .filter((m) => byMethod[m.key])
              .map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`method-chip tone-${m.tone} ${filter === m.key ? 'is-active' : ''}`}
                  onClick={() => setFilter(m.key)}
                >
                  {m.label} <strong>{money(byMethod[m.key].total)} ج.م</strong>{' '}
                  <span className="cell-muted">({byMethod[m.key].count})</span>
                </button>
              ))}
          </div>
          <div className="method-tiles">
            {METHODS.map((m) => (
              <div key={m.key} className={`method-tile tone-${m.tone}`}>
                <span>{m.label}</span>
                <strong>{money(r.salesByMethod?.[m.key])}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-body shift-info">
          <div>
            <span>الكاشير:</span> <strong>{data.cashier}</strong>
          </div>
          <div>
            <span>الفرع:</span> <strong>{data.branch}</strong>
          </div>
          <div>
            <span>المخزن:</span> <strong>المخزن الرئيسي</strong>
          </div>
          <div>
            <span>وقت الفتح:</span> <strong className="num">{stamp(shift.start_time, true)}</strong>
          </div>
          <div>
            <span>وقت الغلق:</span>{' '}
            <strong className="num">{open ? 'لم تُغلق' : stamp(shift.end_time, true)}</strong>
          </div>
          {!open && duration(shift.start_time, shift.end_time) && (
            <div>
              <span>مدة الوردية:</span>{' '}
              <strong>{duration(shift.start_time, shift.end_time)}</strong>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            المبيعات ({shown.length} فاتورة)
            {open && (
              <span className="cell-muted">
                {' '}
                <Clock size={13} aria-hidden="true" /> تتحدث تلقائياً
              </span>
            )}
          </h2>
          <strong className="money text-info">
            {money(shown.reduce((a, s) => a + s.total, 0))} ج.م
          </strong>
        </div>
        <div className="card-body">
          {shown.length === 0 ? (
            <EmptyState title="لا توجد فواتير" text="لم تُسجَّل فواتير في هذه الوردية." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>رقم</th>
                    <th>العميل</th>
                    <th>نوع</th>
                    <th>طريقة الدفع</th>
                    <th className="num">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {/* Opens the invoice's details (owner, 2026-10-21, D-065); Enter works too. */}
                        <button
                          type="button"
                          className="link-btn ltr-id"
                          onClick={() => onOpenInvoice?.(s.id)}
                          aria-label={`فتح الفاتورة ${invoiceNo(s.id)}`}
                        >
                          {invoiceNo(s.id)}
                        </button>
                      </td>
                      <td>{s.client_name || 'عميل نقدي'}</td>
                      <td>{typeOf(s)}</td>
                      <td>
                        <span
                          className={`shift-pill tone-${TYPE_METHOD[s.payment_type] || 'account'}`}
                        >
                          {s.payment_type === 'فودافون كاش' ? 'محفظة' : s.payment_type}
                        </span>
                      </td>
                      <td className="num money-strong">{money(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {r.expenses?.count > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">المصروفات ({r.expenses.count})</h2>
            <strong className="money text-danger">{money(r.expenses.total)} ج.م</strong>
          </div>
          <div className="card-body">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>التصنيف</th>
                    <th>الملاحظة</th>
                    <th className="num">المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {r.expenses.lines.map((e) => (
                    <tr key={e.id}>
                      <td>{e.category}</td>
                      <td>{e.description || '—'}</td>
                      <td className="num money-strong">{money(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {r.returns?.count > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title text-danger">المرتجعات ({r.returns.count})</h2>
            <div className="text-end">
              <div className="cell-muted">مسترد</div>
              <strong className="money text-danger">
                − {money(r.returns.lines.reduce((a, x) => a + (x.paidBack ?? x.refund), 0))} ج.م
              </strong>
            </div>
          </div>
          <div className="card-body">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>رقم المرتجع</th>
                    <th>فاتورة أصلية</th>
                    <th className="num">قيمة المرتجع</th>
                    <th className="num">مسترد</th>
                  </tr>
                </thead>
                <tbody>
                  {r.returns.lines.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <span className="ltr-id">RET-{x.id}</span>
                      </td>
                      <td>
                        <span className="ltr-id text-info">{invoiceNo(x.saleId)}</span>
                      </td>
                      <td className="num">{money(x.refund)} ج.م</td>
                      <td className="num text-danger">
                        − {money(x.paidBack ?? x.refund)} ج.م
                        {x.method && x.method !== 'cash' ? ` (${METHOD_LABEL[x.method]})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  )
}

export default function ShiftsTab({
  currentUser,
  currentShift,
  onOpenShift,
  onOpenInvoice,
  triggerCustomAlert
}) {
  const [detailsOf, setDetailsOf] = useState(null)
  const back = useCallback(() => setDetailsOf(null), [])
  const canOpen =
    !!onOpenShift &&
    can(currentUser, 'shifts.operate') &&
    !(currentShift && currentShift.status === 'open')
  if (detailsOf)
    return (
      <ShiftDetailsPage
        shiftId={detailsOf}
        onBack={back}
        onOpenInvoice={onOpenInvoice}
        triggerCustomAlert={triggerCustomAlert}
      />
    )
  return (
    <ShiftsList
      onDetails={setDetailsOf}
      onOpenShift={onOpenShift}
      canOpen={canOpen}
      triggerCustomAlert={triggerCustomAlert}
    />
  )
}
