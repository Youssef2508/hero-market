import { useState } from 'react'
import { ClipboardCheck, Printer } from 'lucide-react'
import { formatMoney } from '../../lib/utils'

const METHODS = [
  ['cash', 'نقدي'],
  ['visa', 'فيزا'],
  ['wallet', 'محفظة'],
  ['instapay', 'انستا باي']
]
const m = (n) => `${formatMoney(n)} ج.م`
const tone = (v) => (Math.abs(v) < 0.005 ? '' : v < 0 ? 'text-danger' : 'text-success')

/**
 * The saved close of a shift (owner feedback SHIFT-02): expected, counted and the difference per
 * payment method, shown after the close is confirmed and saved. Everything comes from the saved
 * snapshot (shifts.close / shifts.closeReport), so a reprint matches what was confirmed.
 */
export default function CloseReportModal({ data, onDone, title, doneLabel = 'تم' }) {
  const [printing, setPrinting] = useState(false)
  if (!data) return null
  const r = data.report
  // An open shift (owner's live details) has expected figures only; a close adds counted ones.
  const closed = !!r.actual
  const reprint = async () => {
    if (!window.api?.printer?.printReport) return
    setPrinting(true)
    try {
      await window.api.printer.printReport('close', { report: r })
    } finally {
      setPrinting(false)
    }
  }
  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <div
        className="modal-content modal-wide modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-report-title"
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <ClipboardCheck size={24} />
          </span>
          <h2 id="close-report-title">{title || `تقرير إغلاق الوردية #${r.shiftId}`}</h2>
          <p>
            {r.cashier} · من {String(r.openedAt || '').slice(0, 16)}
            {r.closedAt ? ` إلى ${String(r.closedAt).slice(0, 16)}` : ' (مفتوحة)'}
          </p>
        </div>
        <div className="modal-body">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>طريقة الدفع</th>
                  <th className="num">المبيعات</th>
                  <th className="num">المتوقع</th>
                  {closed && <th className="num">الفعلي</th>}
                  {closed && <th>الفرق</th>}
                </tr>
              </thead>
              <tbody>
                {METHODS.map(([k, label]) => (
                  <tr key={k}>
                    <td className="cell-strong">{label}</td>
                    <td className="num">{m(r.salesByMethod?.[k])}</td>
                    <td className="num">{m(r.expected?.[k])}</td>
                    {closed && <td className="num">{m(r.actual?.[k])}</td>}
                    {closed && (
                      <td className={tone(r.variance?.[k] || 0)}>{r.varianceLabels?.[k]}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="kv">
            <dt>العهدة الافتتاحية</dt>
            <dd>{m(r.openingFloat)}</dd>
            <dt>إجمالي المبيعات ({r.invoiceCount} فاتورة)</dt>
            <dd>{m(r.totalSales)}</dd>
            <dt>المصروفات النقدية ({r.expenses?.count || 0})</dt>
            <dd>{m(r.cash?.expenses)}</dd>
            <dt>المرتجعات ({r.returns?.count || 0})</dt>
            <dd>{m(r.returns?.total)}</dd>
            {r.manualDiscounts?.count > 0 && (
              <>
                <dt>الخصومات اليدوية ({r.manualDiscounts.count})</dt>
                <dd>{m(r.manualDiscounts.total)}</dd>
              </>
            )}
            {closed && (
              <>
                <dt className="fw-bold">صافي الوردية (الفعلي)</dt>
                <dd className="fw-bold">{m(r.netTotal)}</dd>
              </>
            )}
            {r.acknowledgedBy && (
              <>
                <dt>اعتمد الفرق</dt>
                <dd>{r.acknowledgedBy}</dd>
              </>
            )}
          </dl>
        </div>
        <div className="modal-footer">
          {closed && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={reprint}
              disabled={printing}
            >
              <Printer size={16} aria-hidden="true" />
              {printing ? 'جاري الطباعة…' : 'طباعة التقرير'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={onDone}
            autoFocus
          >
            {doneLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
