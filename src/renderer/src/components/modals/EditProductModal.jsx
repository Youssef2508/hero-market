import { PackageOpen } from 'lucide-react'

const EditProductModal = ({
  showEditModal,
  setShowEditModal,
  editProduct,
  setEditProduct,
  handleEditProduct
}) => {
  if (!showEditModal) return null

  return (
    <div className="modal-overlay">
      <div className="modal-content" role="dialog" aria-modal="true" style={{ width: 500 }}>
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <PackageOpen size={22} />
          </span>
          <h2>تعديل بيانات الصنف</h2>
          <p>
            تعديل بيانات المنتج ذو الباركود المرجعي: <strong>{editProduct.barcode}</strong>
          </p>
        </div>
        <form
          onSubmit={handleEditProduct}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div className="form-group">
            <label>اسم الصنف *</label>
            <input
              type="text"
              className="form-input"
              value={editProduct.name}
              onChange={(e) => setEditProduct((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="form-group">
              <label>
                سعر الشراء / التكلفة{' '}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  (شراء من المورد)
                </span>
              </label>
              <input
                type="number"
                step="any"
                className="form-input"
                value={editProduct.cost_price}
                onChange={(e) =>
                  setEditProduct((prev) => ({ ...prev, cost_price: e.target.value }))
                }
              />
            </div>
            <div className="form-group">
              <label>
                سعر البيع قطاعي *{' '}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  (للجمهور بالقطعة)
                </span>
              </label>
              <input
                type="number"
                step="any"
                className="form-input"
                value={editProduct.retail_price}
                onChange={(e) =>
                  setEditProduct((prev) => ({ ...prev, retail_price: e.target.value }))
                }
                required
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="form-group">
              <label>
                سعر الجملة{' '}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  (للتجار والكميات)
                </span>
              </label>
              <input
                type="number"
                step="any"
                className="form-input"
                value={editProduct.wholesale_price}
                onChange={(e) =>
                  setEditProduct((prev) => ({ ...prev, wholesale_price: e.target.value }))
                }
              />
            </div>
            <div className="form-group">
              <label>الكمية المتاحة بالمخزن</label>
              <input
                type="number"
                step="any"
                className="form-input"
                value={editProduct.stock_qty}
                onChange={(e) => setEditProduct((prev) => ({ ...prev, stock_qty: e.target.value }))}
              />
              <span className="field-hint">
                يُسجَّل الفرق كحركة تسوية في سجل المخزون، ولا تضيع المبيعات التي تمت أثناء فتح هذه
                الشاشة. للاستلام من مورد استخدم فاتورة الشراء.
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="form-group">
              <label>حد الطلب (إنذار النقص)</label>
              <input
                type="number"
                step="any"
                className="form-input"
                value={editProduct.reorder_limit}
                onChange={(e) =>
                  setEditProduct((prev) => ({ ...prev, reorder_limit: e.target.value }))
                }
              />
            </div>
            <div className="form-group">
              <label>الوحدة (كيلو/علبة/قطعة)</label>
              <input
                type="text"
                className="form-input"
                value={editProduct.unit}
                onChange={(e) => setEditProduct((prev) => ({ ...prev, unit: e.target.value }))}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowEditModal(false)}
            >
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
              تحديث البيانات
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default EditProductModal
