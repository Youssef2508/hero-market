import { useEffect, useRef, useState } from 'react'
import {
  Pencil,
  Plus,
  Search,
  Trash2,
  PackageSearch,
  History,
  AlertTriangle,
  Boxes
} from 'lucide-react'
import { EmptyState, Pagination, SortableTh } from '../ui'
import { formatMoney } from '../../lib/utils'
import { api } from '../../lib/api'
import StockHistoryModal from '../modals/StockHistoryModal'
import ProductUnitsModal from '../modals/ProductUnitsModal'

/**
 * Products & stock screen. Data and mutations come from useProductsManager
 * (via useAdminController); this component is presentation only.
 */
export default function InventoryTab({
  adminSearch,
  adminSearchInputRef,
  adminProducts,
  adminTotalCount,
  adminPage,
  itemsPerPage,
  fetchInventoryPage,
  setAdminSearch,
  setShowAddModal,
  setEditProduct,
  setShowEditModal,
  handleDeleteProduct,
  productsSortField,
  productsSortAsc
}) {
  const debounceRef = useRef(null)
  const [historyFor, setHistoryFor] = useState(null)
  const [unitsFor, setUnitsFor] = useState(null)
  const [negative, setNegative] = useState([])

  // Negative stock is allowed (sold before the receipt was entered); list it so it gets fixed.
  const loadNegative = () =>
    api('inventory.negative')
      .then((r) => setNegative(r || []))
      .catch(() => setNegative([]))
  useEffect(() => {
    loadNegative()
  }, [adminProducts])

  const handleSearchChange = (e) => {
    const val = e.target.value
    setAdminSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchInventoryPage(1, val)
    }, 150)
  }

  const handleSortClick = (field) => {
    const isAsc = productsSortField === field ? !productsSortAsc : true
    fetchInventoryPage(adminPage, adminSearch, field, isAsc)
  }

  const sortProps = {
    sortField: productsSortField,
    sortAsc: productsSortAsc,
    onSort: handleSortClick
  }

  return (
    <section className="card">
      {negative.length > 0 && (
        <div className="notice tone-danger" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            <strong>{negative.length} صنف رصيده بالسالب</strong> (بيع قبل تسجيل الاستلام):{' '}
            {negative
              .slice(0, 6)
              .map((n) => `${n.name} (${Number(n.stock)})`)
              .join('، ')}
            {negative.length > 6 ? '…' : ''}. سجّل فاتورة الشراء أو الجرد لتصحيحه.
          </span>
        </div>
      )}
      <form
        className="card-header toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          if (debounceRef.current) clearTimeout(debounceRef.current)
          fetchInventoryPage(1, adminSearch)
        }}
      >
        <div className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            type="text"
            ref={adminSearchInputRef}
            onFocus={(e) => e.target.select()}
            className="input"
            placeholder="ابحث بالاسم أو الباركود (يمكنك استخدام الماسح)"
            value={adminSearch}
            onChange={handleSearchChange}
            aria-label="البحث في الأصناف"
          />
        </div>
        <button type="submit" className="btn btn-secondary">
          بحث
        </button>
        <div className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus size={17} aria-hidden="true" />
          إضافة صنف جديد
        </button>
      </form>

      <div className="card-body stack">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortableTh field="barcode" label="الباركود" {...sortProps} />
                <SortableTh field="name" label="الصنف" {...sortProps} />
                <SortableTh field="cost_price" label="التكلفة" className="num" {...sortProps} />
                <SortableTh field="retail_price" label="سعر البيع" className="num" {...sortProps} />
                <SortableTh
                  field="wholesale_price"
                  label="سعر الجملة"
                  className="num"
                  {...sortProps}
                />
                <SortableTh field="stock_qty" label="المتاح" className="num" {...sortProps} />
                <SortableTh field="reorder_limit" label="حد الطلب" className="num" {...sortProps} />
                <th>
                  <span className="visually-hidden">العمليات</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {adminProducts.length === 0 ? (
                <tr>
                  <td colSpan="8" className="table-empty">
                    <EmptyState
                      icon={PackageSearch}
                      title="لا توجد أصناف"
                      text="لا توجد نتائج مطابقة لبحثك."
                    />
                  </td>
                </tr>
              ) : (
                adminProducts.map((p) => {
                  const low = p.stock_qty <= p.reorder_limit
                  const isNegative = Number(p.stock_qty) < 0
                  return (
                    <tr key={p.barcode}>
                      <td className="mono cell-muted nowrap">{p.barcode}</td>
                      <td className="cell-strong">{p.name}</td>
                      <td className="num cell-muted">{formatMoney(p.cost_price)}</td>
                      <td className="num money-strong text-accent">
                        {formatMoney(p.retail_price)}
                      </td>
                      <td className="num">{formatMoney(p.wholesale_price)}</td>
                      <td className="num">
                        <span className={`badge ${low ? 'badge-danger' : 'badge-success'}`}>
                          {p.stock_qty} {p.unit}
                          {isNegative ? ' · بالسالب' : ''}
                        </span>
                      </td>
                      <td className="num cell-muted">{p.reorder_limit}</td>
                      <td>
                        <div className="cell-actions">
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => {
                              setEditProduct({ ...p, stock_base: p.stock_qty })
                              setShowEditModal(true)
                            }}
                          >
                            <Pencil size={15} aria-hidden="true" />
                            تعديل
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => setUnitsFor(p)}
                            aria-label={`وحدات وعبوات ${p.name}`}
                            title="الوحدات والعبوات والباركودات"
                          >
                            <Boxes size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => setHistoryFor(p)}
                            aria-label={`سجل حركة ${p.name}`}
                            title="سجل الحركة والجرد"
                          >
                            <History size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => handleDeleteProduct(p.barcode)}
                            aria-label={`حذف ${p.name}`}
                            title="حذف الصنف"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={adminPage}
          total={adminTotalCount}
          perPage={itemsPerPage}
          shown={adminProducts.length}
          noun="صنف"
          onPrev={() => fetchInventoryPage(adminPage - 1, adminSearch)}
          onNext={() => fetchInventoryPage(adminPage + 1, adminSearch)}
        />
      </div>
      {unitsFor && (
        <ProductUnitsModal
          product={unitsFor}
          onClose={() => setUnitsFor(null)}
          onSaved={() => fetchInventoryPage(adminPage, adminSearch)}
        />
      )}
      {historyFor && (
        <StockHistoryModal
          product={historyFor}
          onClose={() => setHistoryFor(null)}
          onChanged={() => {
            fetchInventoryPage(adminPage, adminSearch)
            loadNegative()
          }}
        />
      )}
    </section>
  )
}
