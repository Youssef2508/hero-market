import { useState } from 'react'
import { Search, Printer, Undo2, ReceiptText, X } from 'lucide-react'
import { EmptyState, Pagination, SortableTh, Timestamp } from '../ui'
import { formatMoney } from '../../lib/utils'
import { splitStamp } from '../../lib/time'
import { can } from '../../lib/api'
import { rowKeys } from '../../lib/keyboard'
import ChangePaymentModal from './ChangePaymentModal'

const displayNo = (id) => ((id - 1) % 10000) + 1

// "YYYY-MM-DD HH:MM:SS" → date on the first line, time underneath (keeps the column narrow).
function Stamp({ value }) {
  const { date, time } = splitStamp(value)
  return (
    <>
      <span className="nowrap">{date}</span>
      {time && (
        <span className="cell-sub">
          <bdi dir="ltr">{time}</bdi>
        </span>
      )}
    </>
  )
}

/**
 * Invoices & returns. Data and mutations come from useSalesManager.
 */
// The four payment methods (D-061); on-account invoices keep their type.
const METHOD_TYPES = ['نقدي', 'فيزا', 'محفظة', 'فودافون كاش', 'انستا باي']

export default function SalesTab({
  currentUser,
  triggerCustomAlert,
  salesSearch,
  setSalesSearch,
  salesHistory,
  selectedSale,
  selectSaleForDetail,
  selectedSaleItems,
  handleReturnEntireSale,
  handleReturnItem,
  fetchSalesHistory,
  salesSortField,
  salesSortAsc,
  salesPage,
  salesTotalCount,
  itemsPerPage,
  handleReprintSale
}) {
  const [changingPayment, setChangingPayment] = useState(false)
  // PAY-02: holders of sales.change_payment, also after the shift closed (D-065: a reclassification,
  // no money moves); the service also refuses an invoice with a return.
  const canChangePayment =
    selectedSale &&
    can(currentUser, 'sales.change_payment') &&
    METHOD_TYPES.includes(selectedSale.payment_type)
  const [activeReturnItem, setActiveReturnItem] = useState(null)
  const [returnQty, setReturnQty] = useState('')
  const [returnErrorMsg, setReturnErrorMsg] = useState('')

  const afterPaymentChange = async () => {
    setChangingPayment(false)
    await fetchSalesHistory(salesSearch, salesSortField, salesSortAsc, salesPage)
    await selectSaleForDetail({ ...selectedSale })
  }

  const handleSortClick = (field) => {
    const isAsc = salesSortField === field ? !salesSortAsc : true
    fetchSalesHistory(salesSearch, field, isAsc, 1)
  }
  const sortProps = { sortField: salesSortField, sortAsc: salesSortAsc, onSort: handleSortClick }

  const closeReturn = () => {
    setActiveReturnItem(null)
    setReturnErrorMsg('')
  }

  const fullyReturned = selectedSale && selectedSale.total_amount === 0

  return (
    <div className="split split-wide">
      {/* Invoice list */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            <ReceiptText size={18} aria-hidden="true" />
            سجل الفواتير
          </h2>
        </div>
        <div className="card-body stack">
          <div className="toolbar">
            <div className="search-field">
              <Search size={17} aria-hidden="true" />
              <input
                type="text"
                className="input"
                placeholder="رقم الفاتورة أو اسم العميل أو التاريخ"
                value={salesSearch}
                onChange={(e) => {
                  setSalesSearch(e.target.value)
                  fetchSalesHistory(e.target.value, salesSortField, salesSortAsc, 1)
                }}
                aria-label="البحث في الفواتير"
              />
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setSalesSearch('')
                fetchSalesHistory('', salesSortField, salesSortAsc, 1)
              }}
            >
              <X size={16} aria-hidden="true" />
              تفريغ
            </button>
          </div>

          <div className="table-wrap" style={{ maxHeight: 520 }}>
            <table className="table table-compact table-clickable">
              <thead>
                <tr>
                  <SortableTh field="invoice_number" label="الفاتورة" {...sortProps} />
                  <SortableTh field="timestamp" label="التاريخ" {...sortProps} />
                  <th>الكاشير</th>
                  <SortableTh field="client_name" label="العميل" {...sortProps} />
                  <SortableTh field="items_count" label="الأصناف" className="num" {...sortProps} />
                  <SortableTh
                    field="total_amount"
                    label="الإجمالي"
                    className="num"
                    {...sortProps}
                  />
                </tr>
              </thead>
              <tbody>
                {salesHistory.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="table-empty">
                      {salesSearch ? 'لا توجد فواتير مطابقة للبحث.' : 'لا توجد فواتير مسجلة بعد.'}
                    </td>
                  </tr>
                ) : (
                  salesHistory.map((s) => (
                    <tr
                      key={s.id}
                      className={selectedSale?.id === s.id ? 'is-selected' : ''}
                      {...rowKeys(() => selectSaleForDetail(s))}
                    >
                      <td className="cell-strong">
                        <span className="ltr-id">#{displayNo(s.id)}</span>
                      </td>
                      <td className="num cell-muted">
                        <Stamp value={s.timestamp} />
                      </td>
                      <td>{s.username}</td>
                      <td>{s.client_name || 'عميل نقدي'}</td>
                      <td className="num">{s.items_count}</td>
                      <td
                        className={`num money-strong ${s.total_amount === 0 ? 'text-danger' : ''}`}
                      >
                        {formatMoney(s.total_amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={salesPage}
            total={salesTotalCount}
            perPage={itemsPerPage}
            shown={salesHistory.length}
            noun="فاتورة"
            onPrev={() =>
              fetchSalesHistory(salesSearch, salesSortField, salesSortAsc, salesPage - 1)
            }
            onNext={() =>
              fetchSalesHistory(salesSearch, salesSortField, salesSortAsc, salesPage + 1)
            }
          />
        </div>
      </section>

      {/* Invoice detail */}
      <section className="card sticky-panel">
        {selectedSale ? (
          <>
            <div className="card-header">
              <h2 className="card-title">
                فاتورة <span className="num">#{displayNo(selectedSale.id)}</span>
                {fullyReturned && <span className="badge badge-danger">مرتجعة بالكامل</span>}
              </h2>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleReprintSale(selectedSale.id)}
                >
                  <Printer size={15} aria-hidden="true" />
                  طباعة
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger-soft"
                  onClick={() =>
                    selectedSale.total_amount > 0 && handleReturnEntireSale(selectedSale.id)
                  }
                  disabled={fullyReturned}
                >
                  <Undo2 size={15} aria-hidden="true" />
                  {fullyReturned ? 'تم إرجاع الفاتورة' : 'مرتجع كامل'}
                </button>
              </div>
            </div>
            <div className="card-body stack">
              <dl className="detail-grid">
                <div>
                  <dt>التاريخ</dt>
                  <dd>
                    <Timestamp value={selectedSale.timestamp} />
                  </dd>
                </div>
                <div>
                  <dt>الكاشير</dt>
                  <dd>{selectedSale.username}</dd>
                </div>
                <div>
                  <dt>العميل</dt>
                  <dd>{selectedSale.client_name || 'عميل نقدي'}</dd>
                </div>
                <div>
                  <dt>طريقة الدفع</dt>
                  <dd>
                    <span className="badge">{selectedSale.payment_type}</span>
                    {canChangePayment && (
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => setChangingPayment(true)}
                      >
                        تغيير
                      </button>
                    )}
                    {(selectedSale.corrections || []).map((c, i) => (
                      <div key={i} className="cell-muted">
                        غُيّرت من {c.from_type} إلى {c.to_type} بواسطة {c.username}
                        {c.reason ? `: ${c.reason}` : ''}
                      </div>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>الخصم</dt>
                  <dd className="num">{formatMoney(selectedSale.discount)} ج.م</dd>
                </div>
                {(selectedSale.discounts || [])
                  .filter((d) => d.scope === 'manual')
                  .map((d, i) => (
                    <div key={`m${i}`} className="span-2">
                      <dt>خصم يدوي</dt>
                      <dd>
                        <span className="num">{formatMoney(d.amount)} ج.م</span>
                        {d.reason ? ` — ${d.reason}` : ''}
                        {d.username ? ` (${d.username})` : ''}
                      </dd>
                    </div>
                  ))}
                <div>
                  <dt>الإجمالي الصافي</dt>
                  <dd className={`money-strong ${fullyReturned ? 'text-danger' : 'text-accent'}`}>
                    {formatMoney(selectedSale.total_amount)} ج.م
                    {(selectedSale.original_amount || 0) > 0 && fullyReturned && (
                      <span className="cell-sub" style={{ textDecoration: 'line-through' }}>
                        الأصلي {formatMoney(selectedSale.original_amount)}
                      </span>
                    )}
                  </dd>
                </div>
              </dl>

              <h3 className="subsection-title">أصناف الفاتورة</h3>
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>الصنف</th>
                      <th className="num">الكمية</th>
                      <th className="num">السعر</th>
                      <th className="num">الإجمالي</th>
                      <th>
                        <span className="visually-hidden">مرتجع</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSaleItems.map((item) => {
                      const isFullyReturned = (item.returned_qty || 0) >= item.quantity
                      const isPartiallyReturned = (item.returned_qty || 0) > 0 && !isFullyReturned
                      const remainingQty = item.quantity - (item.returned_qty || 0)
                      return (
                        <tr key={item.id} className={isFullyReturned ? 'is-muted-row' : ''}>
                          <td>
                            <span className={`cell-strong ${isFullyReturned ? 'strike' : ''}`}>
                              {item.name || `باركود ${item.product_barcode}`}
                            </span>
                            {isFullyReturned && (
                              <span className="badge badge-danger ms-2">مرتجع كامل</span>
                            )}
                            {isPartiallyReturned && (
                              <span className="badge badge-warning ms-2">
                                مرتجع جزئي: <span className="num">{item.returned_qty}</span>
                              </span>
                            )}
                          </td>
                          <td className="num">
                            {isPartiallyReturned ? (
                              <>
                                {remainingQty} <span className="cell-muted">/ {item.quantity}</span>
                              </>
                            ) : (
                              <span className={isFullyReturned ? 'strike cell-muted' : ''}>
                                {item.quantity}
                              </span>
                            )}
                            {item.unit_name && (
                              <span className="cell-muted">
                                {' '}
                                {item.unit_name}
                                {Number(item.unit_factor) !== 1
                                  ? ` (× ${Number(item.unit_factor)})`
                                  : ''}
                              </span>
                            )}
                          </td>
                          <td className="num">{formatMoney(item.unit_price)}</td>
                          <td
                            className={`num money-strong ${isFullyReturned ? 'strike cell-muted' : ''}`}
                          >
                            {formatMoney(item.total_price)}
                          </td>
                          <td>
                            <div className="cell-actions">
                              <button
                                type="button"
                                className="btn btn-sm btn-warning-soft"
                                disabled={isFullyReturned}
                                onClick={() => {
                                  setActiveReturnItem(item)
                                  setReturnQty(remainingQty.toString())
                                  setReturnErrorMsg('')
                                }}
                              >
                                <Undo2 size={14} aria-hidden="true" />
                                {isFullyReturned ? 'تم الإرجاع' : 'إرجاع'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            icon={Search}
            title="اختر فاتورة"
            text="اختر فاتورة من القائمة لعرض تفاصيلها وإعادة طباعتها أو إجراء مرتجع."
          />
        )}
      </section>

      {activeReturnItem && (
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <form
            data-enter-step
            className="modal-content tone-warning"
            role="dialog"
            aria-modal="true"
            aria-labelledby="return-title"
            style={{ width: 420 }}
            onSubmit={(e) => {
              e.preventDefault()
              const qtyVal = parseFloat(returnQty)
              const maxVal = activeReturnItem.quantity - (activeReturnItem.returned_qty || 0)
              if (isNaN(qtyVal) || qtyVal <= 0 || qtyVal > maxVal) {
                setReturnErrorMsg(`الرجاء إدخال كمية صحيحة أكبر من 0 ولا تزيد عن ${maxVal}`)
                return
              }
              handleReturnItem(activeReturnItem, qtyVal)
              closeReturn()
            }}
          >
            <div className="modal-header">
              <span className="modal-icon" aria-hidden="true">
                <Undo2 size={22} />
              </span>
              <h2 id="return-title">إرجاع كمية من الصنف</h2>
              <p>{activeReturnItem.name || activeReturnItem.product_barcode}</p>
            </div>
            <label className="field">
              <span className="field-label">
                الكمية المراد إرجاعها (الحد الأقصى:{' '}
                <span className="num">
                  {activeReturnItem.quantity - (activeReturnItem.returned_qty || 0)}
                </span>
                )
              </span>
              <input
                type="number"
                step="any"
                min="0.001"
                max={activeReturnItem.quantity - (activeReturnItem.returned_qty || 0)}
                className={`input input-lg input-money ${returnErrorMsg ? 'input-invalid' : ''}`}
                value={returnQty}
                onChange={(e) => {
                  setReturnQty(e.target.value)
                  setReturnErrorMsg('')
                }}
                autoFocus
              />
              {returnErrorMsg && <span className="field-error">{returnErrorMsg}</span>}
            </label>
            <div className="modal-footer">
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                تأكيد المرتجع
              </button>
              <button
                data-modal-close
                type="button"
                className="btn btn-secondary"
                onClick={closeReturn}
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
      {changingPayment && selectedSale && (
        <ChangePaymentModal
          sale={selectedSale}
          onDone={afterPaymentChange}
          onClose={() => setChangingPayment(false)}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}
    </div>
  )
}
