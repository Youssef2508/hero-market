// ─────────────────────────────────────────────────────────────
// Admin screen: shift history and periodic drawer audits.
// Read-only tables with client-side pagination (25 rows per page).
// ─────────────────────────────────────────────────────────────
import { Fragment, useState } from 'react'
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Archive,
  ClipboardCheck,
  PackageOpen
} from 'lucide-react'
import { formatMoney } from '../../lib/utils'
import { Timestamp } from '../ui'

const PAGE_SIZE = 25

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

const signed = (v) => (v > 0 ? `+${formatMoney(v)}` : formatMoney(v || 0))

function ClosedShiftsTable({ shiftsHistory }) {
  const [page, setPage] = useState(1)
  const data = shiftsHistory || []
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE))
  const pageData = data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">
          <Archive size={18} aria-hidden="true" />
          الورديات المغلقة وجرد الخزينة
        </h2>
        <span className="badge num">{data.length} وردية</span>
      </div>
      <div className="card-body stack">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الوردية</th>
                <th>الكاشير</th>
                <th>البدء</th>
                <th>الإغلاق</th>
                <th className="num">الافتتاحي</th>
                <th className="num">المتوقع بالدرج</th>
                <th className="num">الفعلي المسلَّم</th>
                <th className="num">الفرق</th>
              </tr>
            </thead>
            <tbody>
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan="8" className="table-empty">
                    لا توجد ورديات مغلقة مسجلة بعد.
                  </td>
                </tr>
              ) : (
                pageData.map((s, idx) => {
                  // Marker where the store switched to the envelope hand-over system (store history).
                  const prevShift = pageData[idx - 1]
                  const showSeparator = prevShift && prevShift.id > 28 && s.id <= 28
                  return (
                    <Fragment key={s.id}>
                      {showSeparator && (
                        <tr>
                          <td colSpan="8" className="table-separator">
                            <PackageOpen size={16} aria-hidden="true" />
                            <strong>بداية نظام التوريد الجديد — عهدة 200 ج.م</strong>
                            <span>
                              من الوردية #{prevShift.id} وما بعدها: يسلّم الكاشير المبلغ في ظرف
                              ويبقى 200 ج.م فكة بالدرج.
                            </span>
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td className="cell-strong num">#{s.id}</td>
                        <td className="cell-strong">{s.username}</td>
                        <td className="nowrap cell-muted">
                          <Timestamp value={s.start_time} />
                        </td>
                        <td className="nowrap cell-muted">
                          <Timestamp value={s.end_time} />
                        </td>
                        <td className="num">{formatMoney(s.initial_cash)}</td>
                        <td className="num">{formatMoney(s.expected_end_cash)}</td>
                        <td className="num money-strong">{formatMoney(s.actual_end_cash)}</td>
                        <td
                          className={`num money-strong ${s.difference < 0 ? 'text-danger' : s.difference > 0 ? 'text-success' : ''}`}
                        >
                          {signed(s.difference)}
                        </td>
                      </tr>
                    </Fragment>
                  )
                })
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
  )
}

function AuditsTable({ shiftAudits }) {
  const [page, setPage] = useState(1)
  const data = shiftAudits || []
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE))
  const pageData = data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">
          <ClipboardCheck size={18} aria-hidden="true" />
          الجرد الدوري للدرج خلال الورديات
        </h2>
        <span className="badge num">{data.length} جرد</span>
      </div>
      <div className="card-body stack">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>تاريخ الجرد</th>
                <th>الوردية</th>
                <th>الكاشير</th>
                <th className="num">المتوقع بالدرج</th>
                <th className="num">الفعلي</th>
                <th className="num">الفرق</th>
                <th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan="7" className="table-empty">
                    لا توجد حركات جرد دوري مسجلة بعد.
                  </td>
                </tr>
              ) : (
                pageData.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap cell-muted">
                      <Timestamp value={a.timestamp} />
                    </td>
                    <td className="cell-strong num">#{a.shift_id}</td>
                    <td className="cell-strong">{a.username}</td>
                    <td className="num">{formatMoney(a.expected_cash)}</td>
                    <td className="num money-strong">{formatMoney(a.actual_cash)}</td>
                    <td
                      className={`num money-strong ${a.difference < 0 ? 'text-danger' : a.difference > 0 ? 'text-warning' : 'text-success'}`}
                    >
                      {signed(a.difference)}
                    </td>
                    <td className="cell-muted">{a.notes || '—'}</td>
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
  )
}

export default function ShiftsTab({ shiftsHistory, shiftAudits }) {
  const [activeSubTab, setActiveSubTab] = useState('closed')

  return (
    <>
      <div className="segmented segmented-lg" role="tablist" aria-label="سجلات الورديات">
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'closed'}
          className={activeSubTab === 'closed' ? 'active' : ''}
          onClick={() => setActiveSubTab('closed')}
        >
          <Archive size={16} aria-hidden="true" />
          الورديات المغلقة
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'audits'}
          className={activeSubTab === 'audits' ? 'active' : ''}
          onClick={() => setActiveSubTab('audits')}
        >
          <ClipboardCheck size={16} aria-hidden="true" />
          الجرد الدوري
        </button>
      </div>

      {activeSubTab === 'closed' ? (
        <ClosedShiftsTable shiftsHistory={shiftsHistory} />
      ) : (
        <AuditsTable shiftAudits={shiftAudits} />
      )}
    </>
  )
}
