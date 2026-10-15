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
  HandCoins
} from 'lucide-react'
import { EmptyState, SortableTh } from '../ui'
import { formatMoney } from '../../lib/utils'

/**
 * Suppliers & purchases. Data and mutations come from useSuppliersManager.
 */
export default function SuppliersTab({
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
                      onClick={() => fetchSupplierProfile(row)}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && fetchSupplierProfile(row)}
                    >
                      <td className="cell-strong">{row.name}</td>
                      <td className="num cell-muted nowrap">{row.phone || '—'}</td>
                      <td
                        className={`num money-strong ${row.debt_balance > 0 ? 'text-danger' : 'text-success'}`}
                      >
                        {formatMoney(row.debt_balance)}
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
                <span>إجمالي المديونية للمورد</span>
                <strong className="money">{formatMoney(s.debt_balance)} ج.م</strong>
              </div>
              <form className="repay-form" onSubmit={handleSupplierRepay}>
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">سداد دفعة للمورد (ج.م)</span>
                  <input
                    type="number"
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
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>التاريخ</th>
                        <th>رقم الفاتورة</th>
                        <th className="num">الإجمالي</th>
                        <th className="num">المدفوع</th>
                        <th className="num">المتبقي</th>
                        <th>نوع الدفع</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierPurchases.map((p) => (
                        <tr key={p.id}>
                          <td className="num nowrap cell-muted">{p.timestamp}</td>
                          <td>{p.invoice_ref || '—'}</td>
                          <td className="num">{formatMoney(p.total_amount)}</td>
                          <td className="num">{formatMoney(p.paid_amount)}</td>
                          <td
                            className={`num money-strong ${(p.remaining || 0) > 0 ? 'text-danger' : 'text-success'}`}
                          >
                            {formatMoney(p.remaining)}
                          </td>
                          <td>
                            <span className="badge">{p.payment_type}</span>
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
                          <td className="num nowrap cell-muted">{l.timestamp}</td>
                          <td>
                            <span
                              className={`badge ${l.type === 'payment' ? 'badge-success' : 'badge-danger'}`}
                            >
                              {l.type === 'payment' ? 'سداد' : 'شراء'}
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
  )
}
