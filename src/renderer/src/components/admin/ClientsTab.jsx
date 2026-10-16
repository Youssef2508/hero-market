import { useState, useMemo } from 'react'
import { addressRows } from '../../lib/addressForm'
import { ADDRESS_LABELS } from '../../../../shared/address.mjs'
import {
  Award,
  TrendingUp,
  Users,
  UserPlus,
  Search,
  Pencil,
  Trash2,
  Printer,
  Eye,
  Wallet,
  Star,
  Phone,
  MapPin,
  ReceiptText,
  ShoppingBag,
  X
} from 'lucide-react'
import { api } from '../../lib/api'
import { EmptyState, SortableTh, StatCard, Timestamp } from '../ui'
import { formatMoney } from '../../lib/utils'

const displayNo = (id) => ((id - 1) % 10000) + 1
const PERIODS = [
  { id: 'all', label: 'كل الأوقات' },
  { id: 'daily', label: 'اليوم' },
  { id: 'weekly', label: 'هذا الأسبوع' },
  { id: 'monthly', label: 'هذا الشهر' }
]

/**
 * Customers & accounts. Data and mutations come from useClientsManager.
 */
export default function ClientsTab({
  highestPointsCustomer,
  bestCustomerOfMonth,
  monthlyClientsReport,
  clientTopProducts = [],
  clientStats = null,
  selectedAdminClient,
  repaymentAmount,
  setRepaymentAmount,
  handleRepayment,
  adminClientLedger,
  adminClientPurchases,
  handleReprintSale,
  clientsSearch,
  setClientsSearch,
  fetchClientsList,
  clientsList,
  selectAdminClientForProfile,
  setEditClientForm,
  setShowEditClientModal,
  handleDeleteClient,
  setNewClientForm,
  setShowAddClientModal,
  clientPeriodFilter,
  changeClientPeriodFilter
}) {
  const [activeInvoice, setActiveInvoice] = useState(null)
  const [activeInvoiceItems, setActiveInvoiceItems] = useState([])
  const [clientsSortField, setClientsSortField] = useState('name')
  const [clientsSortAsc, setClientsSortAsc] = useState(true)

  const handleClientsSort = (field) => {
    if (clientsSortField === field) {
      setClientsSortAsc(!clientsSortAsc)
    } else {
      setClientsSortField(field)
      setClientsSortAsc(true)
    }
  }

  const handleOpenInvoiceDetails = async (saleId) => {
    try {
      const { sale, items } = await api('sales.detail', { saleId })
      if (sale) {
        setActiveInvoice(sale)
        setActiveInvoiceItems(items || [])
      }
    } catch (err) {
      console.error('Failed to load invoice details:', err)
    }
  }

  const sortedClientsList = useMemo(() => {
    return [...clientsList].sort((a, b) => {
      let valA = a[clientsSortField]
      let valB = b[clientsSortField]
      if (typeof valA === 'string') {
        return clientsSortAsc ? valA.localeCompare(valB, 'ar') : valB.localeCompare(valA, 'ar')
      }
      valA = valA || 0
      valB = valB || 0
      return clientsSortAsc ? valA - valB : valB - valA
    })
  }, [clientsList, clientsSortField, clientsSortAsc])

  const sortProps = {
    sortField: clientsSortField,
    sortAsc: clientsSortAsc,
    onSort: handleClientsSort
  }
  const c = selectedAdminClient

  return (
    <>
      <div className="stat-grid stat-grid-2">
        <StatCard
          icon={Award}
          tone="warning"
          label="العميل الأعلى نقاطاً"
          textValue
          value={highestPointsCustomer ? highestPointsCustomer.name : 'لا يوجد'}
          meta={highestPointsCustomer ? `${highestPointsCustomer.points} نقطة` : undefined}
        />
        <StatCard
          icon={TrendingUp}
          tone="success"
          label="عميل الشهر الأكثر شراءً"
          textValue
          value={bestCustomerOfMonth ? bestCustomerOfMonth.name : 'لا يوجد'}
          meta={
            bestCustomerOfMonth
              ? `${formatMoney(bestCustomerOfMonth.monthlySpent)} ج.م هذا الشهر`
              : undefined
          }
        />
      </div>

      <div className="split split-narrow-list">
        {/* Directory */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">
              <Users size={18} aria-hidden="true" />
              دليل العملاء
            </h2>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setNewClientForm({
                  name: '',
                  phone: '',
                  phone2: '',
                  hasPhone2: false,
                  addresses: []
                })
                setShowAddClientModal(true)
              }}
            >
              <UserPlus size={16} aria-hidden="true" />
              عميل جديد
            </button>
          </div>
          <div className="card-body stack">
            <div className="search-field">
              <Search size={17} aria-hidden="true" />
              <input
                type="text"
                className="input"
                placeholder="ابحث بالاسم أو رقم الهاتف"
                value={clientsSearch}
                onChange={(e) => {
                  setClientsSearch(e.target.value)
                  fetchClientsList(e.target.value)
                }}
                aria-label="البحث في العملاء"
              />
            </div>
            <div className="table-wrap" style={{ maxHeight: 560 }}>
              <table className="table table-clickable">
                <thead>
                  <tr>
                    <SortableTh field="name" label="العميل" {...sortProps} />
                    <SortableTh field="phone" label="الهاتف" {...sortProps} />
                    <SortableTh
                      field="debt_balance"
                      label="الرصيد"
                      className="num"
                      {...sortProps}
                    />
                    <SortableTh field="points" label="النقاط" className="num" {...sortProps} />
                  </tr>
                </thead>
                <tbody>
                  {sortedClientsList.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="table-empty">
                        لا يوجد عملاء مطابقين للبحث.
                      </td>
                    </tr>
                  ) : (
                    sortedClientsList.map((cl) => (
                      <tr
                        key={cl.id}
                        className={c && c.id === cl.id ? 'is-selected' : ''}
                        onClick={() => selectAdminClientForProfile(cl)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && selectAdminClientForProfile(cl)}
                      >
                        <td className="cell-strong">{cl.name}</td>
                        <td className="num cell-muted nowrap">
                          {cl.phone || '—'}
                          {cl.phone2 && <span className="cell-sub">{cl.phone2}</span>}
                        </td>
                        <td
                          className={`num money-strong ${cl.debt_balance > 0 ? 'text-danger' : cl.debt_balance < 0 ? 'text-accent' : 'cell-muted'}`}
                        >
                          {formatMoney(cl.debt_balance)}
                        </td>
                        <td className="num">
                          <span className="points">
                            <Star size={13} aria-hidden="true" />
                            {cl.points}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Profile or monthly report */}
        {c ? (
          <section className="card">
            <div className="card-header">
              <div className="profile-head">
                <span className="avatar avatar-lg" aria-hidden="true">
                  {String(c.name || '?')
                    .trim()
                    .charAt(0)}
                </span>
                <div>
                  <h2 className="card-title">{c.name}</h2>
                  <div className="card-subtitle">
                    عضو منذ <span className="ltr">{c.created_at || 'غير محدد'}</span>
                  </div>
                </div>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => {
                    setEditClientForm({
                      id: c.id,
                      name: c.name,
                      phone: c.phone || '',
                      phone2: c.phone2 || '',
                      hasPhone2: Boolean(c.phone2),
                      addresses: addressRows(c)
                    })
                    setShowEditClientModal(true)
                  }}
                >
                  <Pencil size={15} aria-hidden="true" />
                  تعديل
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label={`حذف ${c.name}`}
                  title="حذف العميل"
                  onClick={() => handleDeleteClient(c)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <div className="card-toolbar">
              <span className="field-label">فترة كشف الحساب</span>
              <div className="segmented" role="group" aria-label="فترة كشف الحساب">
                {PERIODS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={clientPeriodFilter === p.id ? 'active' : ''}
                    aria-pressed={clientPeriodFilter === p.id}
                    onClick={() => changeClientPeriodFilter(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card-body stack">
              <div className="contact-row">
                <span>
                  <Phone size={15} aria-hidden="true" />
                  <bdi dir="ltr" className="num">
                    {[c.phone, c.phone2].filter(Boolean).join(' / ') || 'لا يوجد هاتف'}
                  </bdi>
                </span>
              </div>
              <ul className="address-list" aria-label="عناوين التوصيل">
                {addressRows(c).length === 0 ? (
                  <li className="cell-muted">
                    <MapPin size={15} aria-hidden="true" /> لا يوجد عنوان
                  </li>
                ) : (
                  addressRows(c).map((a) => (
                    <li key={a.key}>
                      <MapPin size={15} aria-hidden="true" />
                      <span className="badge">{ADDRESS_LABELS[a.label] || a.label}</span>
                      <span>
                        {a.address}
                        {a.details ? ` – ${a.details}` : ''}
                      </span>
                      {a.isDefault && <span className="badge badge-success">افتراضي</span>}
                    </li>
                  ))
                )}
              </ul>

              <div className="stat-grid stat-grid-2">
                <StatCard
                  icon={Wallet}
                  tone={c.debt_balance > 0 ? 'danger' : 'accent'}
                  label={c.debt_balance < 0 ? 'رصيد دائن للعميل' : 'المديونية الحالية'}
                  value={`${formatMoney(Math.abs(c.debt_balance || 0))} ج.م`}
                />
                <StatCard icon={Star} tone="warning" label="نقاط الولاء" value={c.points || 0} />
              </div>

              {c.debt_balance > 0 && (
                <form
                  className="repay-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleRepayment()
                  }}
                >
                  <label className="field" style={{ flex: 1 }}>
                    <span className="field-label">سداد مديونية (ج.م)</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="أدخل المبلغ المسدد"
                      className="input num"
                      value={repaymentAmount}
                      onChange={(e) => setRepaymentAmount(e.target.value)}
                    />
                  </label>
                  <button type="submit" className="btn btn-primary">
                    تأكيد السداد
                  </button>
                </form>
              )}

              <div className="two-col">
                <div className="inset">
                  <h3 className="subsection-title">إحصائيات المشتريات</h3>
                  <dl className="kv">
                    <dt>عدد الطلبات</dt>
                    <dd>{clientStats?.total_orders || 0}</dd>
                    <dt>إجمالي الإنفاق</dt>
                    <dd className="text-accent">{formatMoney(clientStats?.total_spent)} ج.م</dd>
                    <dt>متوسط قيمة الطلب</dt>
                    <dd>{formatMoney(clientStats?.avg_spent)} ج.م</dd>
                    <dt>آخر زيارة</dt>
                    <dd>
                      <span className="ltr">{clientStats?.last_purchase || 'لا يوجد'}</span>
                    </dd>
                  </dl>
                </div>
                <div className="inset">
                  <h3 className="subsection-title">المنتجات الأكثر طلباً</h3>
                  {clientTopProducts.length === 0 ? (
                    <p className="cell-muted" style={{ fontSize: 'var(--fs-sm)' }}>
                      لا توجد منتجات مسجلة.
                    </p>
                  ) : (
                    <ol className="rank-list">
                      {clientTopProducts.map((p, idx) => (
                        <li key={idx}>
                          <span className="text-ellipsis" title={p.name}>
                            {p.name}
                          </span>
                          <span className="num fw-bold">
                            {p.total_qty} {p.total_qty % 1 === 0 ? 'وحدة' : 'كجم'}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>

              <h3 className="subsection-title">سجل العمليات والمبيعات</h3>
              <div className="table-wrap" style={{ maxHeight: 320 }}>
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>العملية</th>
                      <th className="num">المبلغ</th>
                      <th>الوصف</th>
                      <th>التاريخ</th>
                      <th>
                        <span className="visually-hidden">التحكم</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminClientLedger.length === 0 && adminClientPurchases.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="table-empty">
                          لا توجد عمليات مسجلة لهذا العميل.
                        </td>
                      </tr>
                    ) : (
                      <>
                        {adminClientLedger.map((l) => {
                          const match = l.description?.match(/#(\d+)/)
                          const saleId = match ? parseInt(match[1], 10) : null
                          return (
                            <tr key={`led-${l.id}`}>
                              <td>
                                <span
                                  className={`badge ${l.type === 'payment' ? 'badge-success' : 'badge-danger'}`}
                                >
                                  {l.type === 'payment' ? 'سداد / رصيد' : 'مشتريات آجل'}
                                </span>
                              </td>
                              <td className="num money-strong">{formatMoney(l.amount)}</td>
                              <td>{l.description}</td>
                              <td className="nowrap cell-muted">
                                <Timestamp value={l.timestamp} />
                              </td>
                              <td>
                                {saleId && (
                                  <div className="cell-actions">
                                    <button
                                      type="button"
                                      className="icon-btn"
                                      aria-label="عرض الفاتورة"
                                      title="عرض الفاتورة"
                                      onClick={() => handleOpenInvoiceDetails(saleId)}
                                    >
                                      <Eye size={15} />
                                    </button>
                                    <button
                                      type="button"
                                      className="icon-btn"
                                      aria-label="طباعة الفاتورة"
                                      title="طباعة"
                                      onClick={() => handleReprintSale(saleId)}
                                    >
                                      <Printer size={15} />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                        {adminClientPurchases.map((p) => (
                          <tr key={`pur-${p.id}`}>
                            <td>
                              <span className="badge badge-info">
                                فاتورة <span className="num">#{displayNo(p.id)}</span>
                              </span>
                            </td>
                            <td className="num money-strong">{formatMoney(p.total_amount)}</td>
                            <td>
                              شراء ({p.payment_type}) – {p.items_count} أصناف
                            </td>
                            <td className="nowrap cell-muted">
                              <Timestamp value={p.timestamp} />
                            </td>
                            <td>
                              <div className="cell-actions">
                                <button
                                  type="button"
                                  className="icon-btn"
                                  aria-label="عرض الفاتورة"
                                  title="عرض الفاتورة"
                                  onClick={() => handleOpenInvoiceDetails(p.id)}
                                >
                                  <Eye size={15} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  aria-label="طباعة الفاتورة"
                                  title="طباعة"
                                  onClick={() => handleReprintSale(p.id)}
                                >
                                  <Printer size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : (
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">
                  <Award size={18} aria-hidden="true" />
                  أفضل عملاء الشهر
                </h2>
                <div className="card-subtitle">ترتيب تلقائي حسب مشتريات الشهر الحالي</div>
              </div>
            </div>
            <div className="card-body stack">
              {monthlyClientsReport && monthlyClientsReport.length > 0 ? (
                <div className="table-wrap">
                  <table className="table table-clickable">
                    <thead>
                      <tr>
                        <th style={{ width: 64 }}>الترتيب</th>
                        <th>العميل</th>
                        <th>الهاتف</th>
                        <th className="num">إجمالي المشتريات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyClientsReport.slice(0, 5).map((client, idx) => (
                        <tr key={client.id} onClick={() => selectAdminClientForProfile(client)}>
                          <td>
                            <span className={`rank rank-${idx + 1}`}>{idx + 1}</span>
                          </td>
                          <td className="cell-strong">{client.name}</td>
                          <td className="num">
                            {client.phone || '—'}
                            {client.phone2 && <span className="cell-sub">{client.phone2}</span>}
                          </td>
                          <td className="num money-strong text-accent">
                            {formatMoney(client.totalSpent)} ج.م
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={Users}
                  title="لا توجد مشتريات لعملاء هذا الشهر بعد"
                  text="اختر عميلاً من الدليل لعرض كشف الحساب والديون والمشتريات ونقاط الولاء."
                />
              )}
              {monthlyClientsReport && monthlyClientsReport.length > 0 && (
                <p className="field-hint">
                  اختر عميلاً من الدليل أو من الترتيب لعرض كشف الحساب والديون والمشتريات ونقاط
                  الولاء.
                </p>
              )}
            </div>
          </section>
        )}
      </div>

      {activeInvoice && (
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <div
            className="modal-content modal-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inv-title"
          >
            <div className="modal-header">
              <span className="modal-icon" aria-hidden="true">
                <ReceiptText size={22} />
              </span>
              <h2 id="inv-title">
                تفاصيل الفاتورة <span className="num">#{displayNo(activeInvoice.id)}</span>
              </h2>
            </div>
            <button
              data-modal-close
              type="button"
              className="icon-btn modal-close"
              aria-label="إغلاق"
              onClick={() => setActiveInvoice(null)}
            >
              <X size={18} />
            </button>
            <dl className="detail-grid">
              <div>
                <dt>رقم الفاتورة</dt>
                <dd className="num">#{activeInvoice.id}</dd>
              </div>
              <div>
                <dt>التاريخ والوقت</dt>
                <dd>
                  <Timestamp value={activeInvoice.timestamp} />
                </dd>
              </div>
              <div>
                <dt>طريقة الدفع</dt>
                <dd>{activeInvoice.payment_type}</dd>
              </div>
              <div>
                <dt>العميل</dt>
                <dd>{activeInvoice.client_name || 'عميل نقدي'}</dd>
              </div>
            </dl>
            <h3 className="subsection-title">
              <ShoppingBag size={15} aria-hidden="true" /> الأصناف المباعة
            </h3>
            <div className="table-wrap" style={{ maxHeight: 240 }}>
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>الصنف</th>
                    <th className="num">الكمية</th>
                    <th className="num">السعر</th>
                    <th className="num">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {activeInvoiceItems.map((item, idx) => (
                    <tr key={idx}>
                      <td className="cell-strong">
                        {item.name || `باركود ${item.product_barcode}`}
                      </td>
                      <td className="num">{item.quantity}</td>
                      <td className="num">{formatMoney(item.unit_price)}</td>
                      <td className="num money-strong">{formatMoney(item.total_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="kv totals">
              <dt>الخصم</dt>
              <dd>{formatMoney(activeInvoice.discount)} ج.م</dd>
              <dt className="fw-bold">الإجمالي الصافي</dt>
              <dd className="text-accent" style={{ fontSize: 'var(--fs-xl)' }}>
                {formatMoney(activeInvoice.total_amount)} ج.م
              </dd>
            </dl>
            <div className="modal-footer">
              <button
                data-modal-close
                type="button"
                className="btn btn-secondary"
                onClick={() => setActiveInvoice(null)}
              >
                إغلاق
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleReprintSale(activeInvoice.id)}
              >
                <Printer size={16} aria-hidden="true" />
                طباعة الفاتورة
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
