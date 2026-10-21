import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { PackageX, Trash2, Plus, Layers, Banknote, X } from 'lucide-react'
import { EmptyState, StatCard, Timestamp } from '../ui'
import { formatMoney } from '../../lib/utils'

// Reason values are stored in damaged_goods.reason – keep them unchanged.
const REASONS = ['انتهاء صلاحية', 'تلف / كسر', 'عيب مصنعي', 'سرقة / فقدان', 'أخرى']

/**
 * Damaged goods / write-offs. Data and mutations come from useDamagedGoodsManager.
 */
export default function DamagedGoodsTab({
  damagedGoodsList,
  showAddDamagedModal,
  setShowAddDamagedModal,
  newDamagedForm,
  setNewDamagedForm,
  handleAddDamaged,
  handleDeleteDamaged
}) {
  const [resolvedProductName, setResolvedProductName] = useState('')
  const [resolvedProductStock, setResolvedProductStock] = useState(null)
  const [productMissing, setProductMissing] = useState(false)

  // Resolve product info as the barcode is typed/scanned (unchanged lookup).
  useEffect(() => {
    let active = true
    const resolveProduct = async () => {
      const cleanBarcode = newDamagedForm.barcode ? newDamagedForm.barcode.trim() : ''
      if (!cleanBarcode) {
        if (active) {
          setResolvedProductName('')
          setResolvedProductStock(null)
          setProductMissing(false)
        }
        return
      }
      try {
        const product = await api('products.get', { barcode: cleanBarcode })
        const res = product ? [product] : []
        if (active) {
          if (res && res.length > 0) {
            setResolvedProductName(res[0].name)
            setResolvedProductStock(res[0].stock_qty)
            setProductMissing(false)
          } else {
            setResolvedProductName('الصنف غير موجود')
            setResolvedProductStock(null)
            setProductMissing(true)
          }
        }
      } catch (e) {
        if (active) console.error(e)
      }
    }
    resolveProduct()
    return () => {
      active = false
    }
  }, [newDamagedForm.barcode])

  const totalItems = damagedGoodsList.reduce((sum, item) => sum + item.quantity, 0)
  const totalLoss = damagedGoodsList.reduce((sum, item) => sum + item.quantity * item.cost_price, 0)

  const closeModal = () => {
    setShowAddDamagedModal(false)
    setNewDamagedForm({ barcode: '', quantity: '', reason: 'انتهاء صلاحية' })
  }

  return (
    <>
      <div className="page-intro">
        <p>
          سجّل السلع التالفة أو منتهية الصلاحية؛ تُخصم الكمية من المخزون وتُحتسب قيمتها كخسارة من
          صافي الربح.
        </p>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => setShowAddDamagedModal(true)}
        >
          <Plus size={17} aria-hidden="true" />
          تسجيل هالك جديد
        </button>
      </div>

      <div className="stat-grid stat-grid-2">
        <StatCard
          icon={Layers}
          tone="warning"
          label="إجمالي كمية الهوالك"
          value={`${Number((totalItems || 0).toFixed(3))} وحدة`}
          meta="مخصومة من رصيد المخزون الفعلي"
        />
        <StatCard
          icon={Banknote}
          tone="danger"
          label="قيمة خسائر الهوالك"
          value={`${formatMoney(totalLoss)} ج.م`}
          meta="مخصومة من صافي الأرباح"
        />
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            <PackageX size={18} aria-hidden="true" />
            سجل الهوالك
          </h2>
        </div>
        <div className="card-body">
          {damagedGoodsList.length === 0 ? (
            <EmptyState
              icon={PackageX}
              title="لا يوجد هوالك مسجلة"
              text="لم يتم تسجيل أي بضاعة تالفة حتى الآن."
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>الصنف</th>
                    <th className="num">الكمية</th>
                    <th>السبب</th>
                    <th className="num">تكلفة الوحدة</th>
                    <th className="num">إجمالي الخسارة</th>
                    <th>تاريخ التسجيل</th>
                    <th>
                      <span className="visually-hidden">إجراءات</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {damagedGoodsList.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span className="cell-strong">{item.product_name}</span>
                        <span className="cell-sub mono">{item.product_barcode}</span>
                      </td>
                      <td className="num money-strong text-danger">
                        {item.quantity} {item.unit}
                      </td>
                      <td>
                        <span
                          className={`badge ${item.reason === 'انتهاء صلاحية' ? 'badge-warning' : 'badge-danger'}`}
                        >
                          {item.reason}
                        </span>
                      </td>
                      <td className="num">{formatMoney(item.cost_price)}</td>
                      <td className="num money-strong">
                        {formatMoney(item.quantity * item.cost_price)}
                      </td>
                      <td className="nowrap cell-muted">
                        <Timestamp value={item.timestamp} />
                      </td>
                      <td>
                        <div className="cell-actions">
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => handleDeleteDamaged(item)}
                            aria-label="حذف وإلغاء تسجيل الهالك"
                            title="حذف وإرجاع الكمية للمخزون"
                          >
                            <Trash2 size={15} />
                          </button>
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

      {showAddDamagedModal && (
        <div className="modal-overlay">
          <form
            data-enter-step
            className="modal-content tone-danger"
            role="dialog"
            aria-modal="true"
            aria-labelledby="damaged-title"
            onSubmit={handleAddDamaged}
          >
            <div className="modal-header">
              <span className="modal-icon" aria-hidden="true">
                <PackageX size={22} />
              </span>
              <h2 id="damaged-title">تسجيل بضاعة تالفة / هالك</h2>
              <p>تُخصم الكمية فوراً من المخزون.</p>
            </div>
            <button
              data-modal-close
              type="button"
              className="icon-btn modal-close"
              aria-label="إغلاق"
              onClick={closeModal}
            >
              <X size={18} />
            </button>
            <div className="modal-body">
              <label className="field">
                <span className="field-label">باركود الصنف</span>
                <input
                  type="text"
                  required
                  className="input mono-input"
                  value={newDamagedForm.barcode}
                  onChange={(e) =>
                    setNewDamagedForm({ ...newDamagedForm, barcode: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      document.getElementById('damaged-quantity-input')?.focus()
                    }
                  }}
                  placeholder="امسح الباركود أو اكتبه هنا"
                  autoFocus
                />
                {newDamagedForm.barcode && (
                  <span className={`field-resolve ${productMissing ? 'is-missing' : ''}`}>
                    <span>{resolvedProductName}</span>
                    {resolvedProductStock !== null && (
                      <span className="cell-muted">
                        المخزون الحالي: <span className="num">{resolvedProductStock}</span>
                      </span>
                    )}
                  </span>
                )}
              </label>
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">الكمية التالفة</span>
                  <input
                    id="damaged-quantity-input"
                    type="number"
                    step="any"
                    required
                    className="input num"
                    value={newDamagedForm.quantity}
                    onChange={(e) =>
                      setNewDamagedForm({ ...newDamagedForm, quantity: e.target.value })
                    }
                    placeholder="عدد الوحدات أو الوزن"
                  />
                </label>
                <label className="field">
                  <span className="field-label">سبب التلف</span>
                  <select
                    className="input"
                    value={newDamagedForm.reason}
                    onChange={(e) =>
                      setNewDamagedForm({ ...newDamagedForm, reason: e.target.value })
                    }
                  >
                    {REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button type="submit" className="btn btn-danger" style={{ flex: 1 }}>
                تأكيد وتسجيل الهالك
              </button>
              <button
                data-modal-close
                type="button"
                className="btn btn-secondary"
                onClick={closeModal}
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
