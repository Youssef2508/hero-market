import { useCallback, useEffect, useState } from 'react'
import { ReceiptText, HandCoins } from 'lucide-react'
import { Timestamp } from '../ui'
import { api, can } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import PendingInvoiceModal from '../modals/PendingInvoiceModal'
import CancelPendingModal from '../modals/CancelPendingModal'
import SupplierPaymentRequestModal from '../modals/SupplierPaymentRequestModal'
import SupplierPaymentRequests from './SupplierPaymentRequests'

// The two supplier operations of the till, each a screen of its own with its own permission
// (owner, 1.5.2, D-097). They used to sit on «الأدراج والتحويلات», which was removed: neither
// needs the drawers' permission.

/** The supplier debt-payment requests this user made (D-090), with their status. */
function MyPaymentRequests({ refreshKey, showEmpty }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    api('supplierPayments.list', { status: 'all' })
      .then((r) => setRows(r.slice(0, 20)))
      .catch(() => setRows([]))
  }, [refreshKey])
  if (!rows.length)
    return showEmpty ? <p className="cell-muted text-center">لم تسجل طلبات سداد بعد.</p> : null
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">
          <HandCoins size={18} aria-hidden="true" />
          طلبات سداد الموردين التي سجلتها
        </h2>
      </div>
      <div className="card-body">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>المورد</th>
                <th className="num">المبلغ</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="ltr-id">{r.id}</span>
                    <div className="cell-muted">
                      <Timestamp value={r.created_at} />
                    </div>
                  </td>
                  <td>{r.supplier_name}</td>
                  <td className="num">{formatMoney(r.amount)}</td>
                  <td>
                    {r.status_label}
                    {r.settlement_label && <div className="cell-muted">{r.settlement_label}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

/** The preliminary invoices this user recorded and that wait for their lines: cancel a mistake. */
function MyPendingInvoices({
  currentUser,
  currentShift,
  refreshKey,
  triggerCustomAlert,
  showEmpty
}) {
  const [rows, setRows] = useState([])
  const [cancelling, setCancelling] = useState(null)
  const load = useCallback(() => {
    api('supplierInvoices.list', { status: 'pending' })
      .then(setRows)
      .catch(() => setRows([]))
  }, [])
  useEffect(() => {
    load()
  }, [load, refreshKey])
  if (!rows.length)
    return showEmpty ? (
      <p className="cell-muted text-center">لا توجد فواتير مبدئية بانتظار الأصناف.</p>
    ) : null
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">
          <ReceiptText size={18} aria-hidden="true" />
          فواتير مبدئية بانتظار الأصناف
        </h2>
      </div>
      <div className="card-body">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>المورد</th>
                <th className="num">الإجمالي</th>
                <th className="num">المدفوع</th>
                <th>
                  <span className="visually-hidden">إجراءات</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.reserved_active ? 'row-reserved' : undefined}>
                  <td>
                    <span className="ltr-id">{p.id}</span>
                  </td>
                  <td>{p.supplier_name}</td>
                  <td className="num">{formatMoney(p.total)}</td>
                  <td className="num">{formatMoney(p.paid)}</td>
                  <td>
                    {/* D-099: the administrator completing it holds it for up to 30 minutes. */}
                    {p.reserved_active && !p.reserved_mine ? (
                      <span className="badge badge-info" role="status">
                        «{p.reserved_by_name}» بيعدل الفاتورة حاليًا
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => setCancelling(p)}
                      >
                        إلغاء
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {cancelling && (
        <CancelPendingModal
          invoice={cancelling}
          currentUser={currentUser}
          currentShift={currentShift}
          onClose={() => setCancelling(null)}
          onDone={load}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}
    </section>
  )
}

/** «فواتير الموردين المبدئية» (permission «فاتورة مورد مبدئية», D-064). */
export function SupplierPendingTab({ currentUser, currentShift, triggerCustomAlert }) {
  const [open, setOpen] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  return (
    <>
      <div className="page-head">
        <p className="cell-muted">
          الإجمالي والمدفوع الآن بدون أصناف؛ تُكمل الأصناف لاحقاً من «الموردون والمشتريات». المدفوع
          يخرج من درج ورديتك (أو الخزنة للمدير).
        </p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
          <ReceiptText size={15} aria-hidden="true" />
          فاتورة مورد مبدئية
        </button>
      </div>
      <MyPendingInvoices
        currentUser={currentUser}
        currentShift={currentShift}
        refreshKey={savedAt}
        triggerCustomAlert={triggerCustomAlert}
        showEmpty
      />
      {open && (
        <PendingInvoiceModal
          currentUser={currentUser}
          currentShift={currentShift}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setSavedAt(Date.now())
            triggerCustomAlert?.('تم تسجيل الفاتورة المبدئية. تُكمل الأصناف من شاشة الموردين.')
          }}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}
    </>
  )
}

/**
 * «سداد ديون الموردين» (D-090): a cashier with «طلب سداد دين مورد من الدرج» records a payment
 * handed from the drawer; an administrator with «اعتماد طلبات سداد الموردين» approves here too.
 */
export function SupplierPaymentsTab({ currentUser, currentShift, triggerCustomAlert }) {
  const [open, setOpen] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const canPay = can(currentUser, 'suppliers.payment_request')
  return (
    <>
      {canPay && (
        <div className="page-head">
          <p className="cell-muted">
            المبلغ يخرج من درج ورديتك الآن، ولا يُخصم من حساب المورد إلا بعد اعتماد المدير.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setOpen(true)}
            disabled={!currentShift}
            title={currentShift ? undefined : 'افتح وردية أولاً: المبلغ يخرج من الدرج'}
          >
            <HandCoins size={15} aria-hidden="true" />
            سداد دين مورد
          </button>
        </div>
      )}
      <SupplierPaymentRequests
        key={`a${savedAt}`}
        currentUser={currentUser}
        currentShift={currentShift}
        triggerCustomAlert={triggerCustomAlert}
      />
      {canPay && <MyPaymentRequests refreshKey={savedAt} showEmpty />}
      {open && (
        <SupplierPaymentRequestModal
          currentShift={currentShift}
          onClose={() => setOpen(false)}
          onSaved={(r) => {
            setSavedAt(Date.now())
            triggerCustomAlert?.(
              `تم تسجيل طلب السداد #${r.id} (${formatMoney(r.amount)} ج.م). خرج المبلغ من الدرج وينتظر اعتماد المدير.`
            )
          }}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}
    </>
  )
}
