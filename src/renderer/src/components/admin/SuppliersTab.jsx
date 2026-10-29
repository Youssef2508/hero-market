import { useMemo, useState } from 'react'
import {
  Truck,
  Plus,
  Search,
  Trash2,
  ReceiptText,
  BookOpenText,
  Phone,
  MapPin,
  UserRound,
  HandCoins,
  Pencil,
  Printer,
  PackageMinus,
  Eye
} from 'lucide-react'
import { EmptyState, SortableTh, Timestamp, NumberField } from '../ui'
import { formatMoney } from '../../lib/utils'
import PaymentDestination from './PaymentDestination'
import PaymentMethodSelect from './PaymentMethodSelect'
import { fixedDestination } from '../../lib/destination'
import { api, can } from '../../lib/api'
import { rowKeys } from '../../lib/keyboard'
import PendingInvoiceModal from '../modals/PendingInvoiceModal'
import CancelPendingModal from '../modals/CancelPendingModal'
import PurchaseReturnModal from '../modals/PurchaseReturnModal'
import PurchaseDetailModal from '../modals/PurchaseDetailModal'
import EditSupplierModal from '../modals/EditSupplierModal'
import { BalanceText } from './SupplierBalance'
import { balanceLabel } from '../../lib/supplierBalance'

const MODE_LABELS = { cash: 'نقدي', credit: 'آجل', partial: 'دفع جزئي' }

/**
 * Preliminary supplier invoices waiting for their lines (D-064): total and payment recorded, no
 * stock yet. An administrator completes each one ("إكمال") in the purchase window.
 */
function PendingInvoices({ rows, canConvert, onConvert, onCancel }) {
  if (!rows || rows.length === 0) return null
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">
          <ReceiptText size={18} aria-hidden="true" />
          فواتير مبدئية بانتظار الأصناف ({rows.length})
        </h2>
      </div>
      <div className="card-body">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>المورد</th>
                <th>التاريخ</th>
                <th className="num">الإجمالي</th>
                <th className="num">المدفوع</th>
                <th>السداد</th>
                <th>سجّلها</th>
                <th>الحالة</th>
                <th>
                  <span className="visually-hidden">إجراءات</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="ltr-id">{p.id}</span>
                  </td>
                  <td className="cell-strong">{p.supplier_name}</td>
                  <td className="nowrap cell-muted">
                    <Timestamp value={p.created_at} />
                  </td>
                  <td className="num">{formatMoney(p.total)}</td>
                  <td className="num">{formatMoney(p.paid)}</td>
                  <td>{MODE_LABELS[p.payment_mode]}</td>
                  <td className="cell-muted">{p.created_by_name || '—'}</td>
                  <td>
                    <span className="badge badge-warning">بدون أصناف</span>
                  </td>
                  <td>
                    <div className="cell-actions">
                      {canConvert && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => onConvert(p)}
                        >
                          إكمال
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => onCancel(p)}
                      >
                        إلغاء
                      </button>
                    </div>
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

// Supplier ledger row types: label and badge.
const LEDGER_TYPES = {
  payment: ['سداد', 'badge-success'],
  opening: ['رصيد افتتاحي', 'badge-info'],
  adjustment: ['تسوية', 'badge-info'],
  return: ['مرتجع مشتريات', 'badge-info'],
  refund: ['مبلغ أعاده المورد', 'badge-success'],
  purchase: ['شراء', 'badge-danger']
}

/**
 * Suppliers & purchases. Data and mutations come from useSuppliersManager.
 */
export default function SuppliersTab({
  currentUser,
  currentShift,
  pendingInvoices,
  startConvertPending,
  fetchPendingInvoices,
  triggerCustomAlert,
  setNewSupplierForm,
  setShowAddSupplierModal,
  suppliersSearch,
  setSuppliersSearch,
  fetchSuppliersList,
  suppliersList,
  fetchSupplierProfile,
  selectedSupplier,
  setNewPurchaseForm,
  setShowAddPurchaseModal,
  handleDeleteSupplier,
  handleSupplierRepay,
  supplierRepayAmount,
  setSupplierRepayAmount,
  supplierPurchases,
  supplierLedger
}) {
  const [pendingOpen, setPendingOpen] = useState(false)
  const [cancelling, setCancelling] = useState(null)
  const [returning, setReturning] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [editing, setEditing] = useState(false)
  // A recorded supplier invoice printed again from what was saved (POS-02, D-077); nothing is
  // recorded by printing.
  const printPurchase = async (p) => {
    if (!window.api?.printer?.printReport) return
    try {
      const detail = await api('suppliers.purchaseDetail', { purchaseId: p.id })
      await window.api.printer.printReport('purchase', detail)
    } catch (err) {
      triggerCustomAlert?.('تعذّرت الطباعة: ' + err.message)
    }
  }
  const canManage = can(currentUser, 'suppliers.manage')
  const [repayTo, setRepayTo] = useState('')
  const [repayMethod, setRepayMethod] = useState('cash')
  const [sortField, setSortField] = useState('name')
  const [sortAsc, setSortAsc] = useState(true)

  const onSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(true)
    }
  }

  const sortedSuppliersList = useMemo(() => {
    return [...suppliersList].sort((a, b) => {
      let valA = a[sortField]
      let valB = b[sortField]
      if (typeof valA === 'string') {
        return sortAsc ? valA.localeCompare(valB, 'ar') : valB.localeCompare(valA, 'ar')
      }
      valA = valA || 0
      valB = valB || 0
      return sortAsc ? valA - valB : valB - valA
    })
  }, [suppliersList, sortField, sortAsc])

  const sortProps = { sortField, sortAsc, onSort }
  const s = selectedSupplier

  return (
    <>
      <PendingInvoices
        rows={pendingInvoices}
        canConvert={can(currentUser, 'suppliers.manage')}
        onConvert={startConvertPending}
        onCancel={setCancelling}
      />
      {editing && selectedSupplier && (
        <EditSupplierModal
          supplier={selectedSupplier}
          currentUser={currentUser}
          onClose={() => setEditing(false)}
          onDone={async (updated) => {
            await fetchSupplierProfile(updated || selectedSupplier)
            await fetchSuppliersList?.()
          }}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}
      {viewing && (
        <PurchaseDetailModal
          purchase={viewing}
          canManage={canManage}
          onClose={() => setViewing(null)}
          onSaved={() => fetchSupplierProfile(selectedSupplier)}
          onPrint={window.api?.printer?.printReport ? printPurchase : null}
          onReturn={(p) => {
            setViewing(null)
            setReturning(p)
          }}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}
      {returning && (
        <PurchaseReturnModal
          purchase={returning}
          currentUser={currentUser}
          currentShift={currentShift}
          onClose={() => setReturning(null)}
          onDone={(supplier) => fetchSupplierProfile(supplier || selectedSupplier)}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}
      {cancelling && (
        <CancelPendingModal
          invoice={cancelling}
          currentUser={currentUser}
          currentShift={currentShift}
          onClose={() => setCancelling(null)}
          onDone={() => fetchPendingInvoices?.()}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}
      {pendingOpen && (
        <PendingInvoiceModal
          currentUser={currentUser}
          currentShift={currentShift}
          onClose={() => setPendingOpen(false)}
          onSaved={() => fetchPendingInvoices?.()}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}
      <div className="split split-narrow-list">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">
              <Truck size={18} aria-hidden="true" />
              الموردون
            </h2>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setNewSupplierForm({ name: '', phone: '', address: '', contact_person: '' })
                setShowAddSupplierModal(true)
              }}
            >
              <Plus size={16} aria-hidden="true" />
              مورد جديد
            </button>
            {can(currentUser, 'suppliers.pending') && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPendingOpen(true)}
              >
                <ReceiptText size={16} aria-hidden="true" />
                فاتورة مبدئية
              </button>
            )}
          </div>
          <div className="card-body stack">
            <div className="search-field">
              <Search size={17} aria-hidden="true" />
              <input
                type="text"
                className="input"
                placeholder="بحث باسم المورد أو الهاتف"
                value={suppliersSearch}
                onChange={(e) => {
                  setSuppliersSearch(e.target.value)
                  fetchSuppliersList(e.target.value)
                }}
                aria-label="البحث في الموردين"
              />
            </div>
            <div className="table-wrap" style={{ maxHeight: 520 }}>
              <table className="table table-clickable">
                <thead>
                  <tr>
                    <SortableTh field="name" label="المورد" {...sortProps} />
                    <SortableTh field="phone" label="الهاتف" {...sortProps} />
                    <SortableTh
                      field="debt_balance"
                      label="المديونية"
                      className="num"
                      {...sortProps}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedSuppliersList.length === 0 ? (
                    <tr>
                      <td colSpan="3" className="table-empty">
                        لا يوجد موردون مسجلون
                      </td>
                    </tr>
                  ) : (
                    sortedSuppliersList.map((row) => (
                      <tr
                        key={row.id}
                        className={s?.id === row.id ? 'is-selected' : ''}
                        {...rowKeys(() => fetchSupplierProfile(row))}
                      >
                        <td className="cell-strong">{row.name}</td>
                        <td className="num cell-muted nowrap">{row.phone || '—'}</td>
                        <td
                          className={`num money-strong ${row.debt_balance > 0 ? 'text-danger' : 'text-success'}`}
                          title={balanceLabel(row.debt_balance)}
                        >
                          {formatMoney(Math.abs(Number(row.debt_balance) || 0))}
                          {Number(row.debt_balance) < 0 && <span className="cell-muted"> لنا</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {s ? (
          <div className="stack-lg">
            <section className="card">
              <div className="card-header">
                <div className="profile-head">
                  <span className="avatar avatar-lg" aria-hidden="true">
                    <Truck size={20} />
                  </span>
                  <div>
                    <h2 className="card-title">{s.name}</h2>
                    <div className="contact-row" style={{ fontSize: 'var(--fs-sm)' }}>
                      {s.phone && (
                        <span>
                          <Phone size={14} aria-hidden="true" />
                          <span className="num">{s.phone}</span>
                        </span>
                      )}
                      {s.contact_person && (
                        <span>
                          <UserRound size={14} aria-hidden="true" />
                          {s.contact_person}
                        </span>
                      )}
                      {s.address && (
                        <span>
                          <MapPin size={14} aria-hidden="true" />
                          {s.address}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setNewPurchaseForm({
                        invoice_ref: '',
                        total_amount: '',
                        paid_amount: '',
                        payment_type: 'آجل',
                        notes: ''
                      })
                      setShowAddPurchaseModal(true)
                    }}
                  >
                    <ReceiptText size={16} aria-hidden="true" />
                    فاتورة شراء
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil size={15} aria-hidden="true" />
                    تعديل
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => handleDeleteSupplier(s.id)}
                    aria-label={`حذف المورد ${s.name}`}
                    title="حذف المورد"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="card-body stack">
                <div
                  className={`balance-banner ${(s.debt_balance || 0) > 0 ? 'is-owed' : 'is-clear'}`}
                >
                  <span>رصيد المورد</span>
                  <strong>
                    <BalanceText value={s.debt_balance} />
                  </strong>
                </div>
                <form
                  data-enter-step
                  className="repay-form"
                  onSubmit={(e) =>
                    handleSupplierRepay(
                      e,
                      fixedDestination(currentUser, currentShift) || repayTo,
                      repayMethod
                    )
                  }
                >
                  <PaymentDestination
                    currentUser={currentUser}
                    currentShift={currentShift}
                    value={repayTo}
                    onChange={setRepayTo}
                    name="supplier-repay-destination"
                  />
                  <PaymentMethodSelect value={repayMethod} onChange={setRepayMethod} />
                  <label className="field" style={{ flex: 1 }}>
                    <span className="field-label">سداد دفعة للمورد (ج.م)</span>
                    <NumberField
                      className="input num"
                      placeholder="مبلغ السداد"
                      min="0"
                      step="0.01"
                      value={supplierRepayAmount}
                      onChange={(e) => setSupplierRepayAmount(e.target.value)}
                    />
                  </label>
                  <button type="submit" className="btn btn-primary">
                    <HandCoins size={16} aria-hidden="true" />
                    تسجيل السداد
                  </button>
                </form>
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <ReceiptText size={18} aria-hidden="true" />
                  فواتير الشراء
                </h2>
              </div>
              <div className="card-body">
                {supplierPurchases.length === 0 ? (
                  <p className="cell-muted text-center">لا توجد فواتير</p>
                ) : (
                  <div className="table-wrap">
                    {/* Five columns so the table fits the supplier's page without sideways
                        scrolling (owner, 2026-10-22): date and payment type under the invoice,
                        the discount and returns under the net. */}
                    <table className="table table-compact">
                      <thead>
                        <tr>
                          <th>الفاتورة</th>
                          <th className="num">الصافي</th>
                          <th className="num">المدفوع</th>
                          <th className="num">المتبقي</th>
                          <th>
                            <span className="visually-hidden">إجراءات</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierPurchases.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <span className="ltr-id">{p.invoice_ref || `#${p.id}`}</span>
                              <div className="cell-muted">
                                <Timestamp value={p.timestamp} />
                              </div>
                              <span className="badge">{p.payment_type}</span>
                            </td>
                            <td className="num">
                              {formatMoney(p.total_amount)}
                              {Number(p.discount) > 0 && (
                                <div className="cell-muted">خصم {formatMoney(p.discount)}</div>
                              )}
                              {Number(p.returned_value) > 0 && (
                                <div className="cell-muted">
                                  مرتجع {formatMoney(p.returned_value)}
                                </div>
                              )}
                            </td>
                            <td className="num">{formatMoney(p.paid_amount)}</td>
                            <td
                              className={`num money-strong ${(p.remaining || 0) > 0 ? 'text-danger' : 'text-success'}`}
                            >
                              {formatMoney(p.remaining)}
                            </td>
                            <td>
                              <div className="row-actions">
                                <button
                                  type="button"
                                  className="icon-btn"
                                  aria-label={`عرض فاتورة الشراء ${p.invoice_ref || p.id}`}
                                  title="عرض الفاتورة وأصنافها"
                                  onClick={() => setViewing(p)}
                                >
                                  <Eye size={15} aria-hidden="true" />
                                </button>
                                {canManage && (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    aria-label={`طباعة فاتورة الشراء ${p.invoice_ref || p.id}`}
                                    title="طباعة الفاتورة (نسخة)"
                                    onClick={() => printPurchase(p)}
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
                                    onClick={() => setReturning(p)}
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
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <BookOpenText size={18} aria-hidden="true" />
                  دفتر حساب المورد
                </h2>
              </div>
              <div className="card-body">
                {supplierLedger.length === 0 ? (
                  <p className="cell-muted text-center">لا توجد حركات</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table table-compact">
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>النوع</th>
                          <th className="num">المبلغ</th>
                          <th>البيان</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierLedger.map((l) => (
                          <tr key={l.id}>
                            <td className="nowrap cell-muted">
                              <Timestamp value={l.timestamp} />
                            </td>
                            <td>
                              <span
                                className={`badge ${LEDGER_TYPES[l.type]?.[1] || 'badge-danger'}`}
                              >
                                {LEDGER_TYPES[l.type]?.[0] || 'شراء'}
                              </span>
                            </td>
                            <td className="num money-strong">{formatMoney(l.amount)}</td>
                            <td>{l.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          <section className="card">
            <EmptyState
              icon={Truck}
              title="اختر مورداً"
              text="اختر مورداً من القائمة لعرض فواتير الشراء ودفتر الحساب وتسجيل السداد."
            />
          </section>
        )}
      </div>
    </>
  )
}
