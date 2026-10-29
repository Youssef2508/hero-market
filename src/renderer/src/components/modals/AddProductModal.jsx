import { PackagePlus } from 'lucide-react'
import CategorySelect from './CategorySelect'
import KindSelect from './KindSelect'
import { NumberField } from '../ui'

const AddProductModal = ({
  showAddModal,
  setShowAddModal,
  newProduct,
  setNewProduct,
  addProductBarcodeRef,
  handleAddProduct
}) => {
  if (!showAddModal) return null

  return (
    <div className="modal-overlay">
      <div className="modal-content" role="dialog" aria-modal="true" style={{ width: 500 }}>
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <PackagePlus size={22} />
          </span>
          <h2>إضافة صنف جديد للمخزن</h2>
          <p>أدخل تفاصيل السلعة الجديدة بدقة ليتم تسجيلها بقاعدة البيانات</p>
        </div>
        <form
          onSubmit={handleAddProduct}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div className="form-group">
            <label>الباركود (Barcode) *</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                ref={addProductBarcodeRef}
                onFocus={(e) => e.target.select()}
                className="form-input"
                value={newProduct.barcode}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, barcode: e.target.value }))}
                required
                placeholder="مثال: 622300..."
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '0 12px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                onClick={() => {
                  const ts = Date.now().toString().slice(-8)
                  const rand = Math.floor(Math.random() * 100)
                    .toString()
                    .padStart(2, '0')
                  const code = '290' + ts + rand
                  setNewProduct((prev) => ({ ...prev, barcode: code }))
                }}
              >
                توليد تلقائي
              </button>
            </div>
          </div>
          <div className="form-group">
            <label>اسم الصنف *</label>
            <input
              type="text"
              className="form-input"
              value={newProduct.name}
              onChange={(e) => setNewProduct((prev) => ({ ...prev, name: e.target.value }))}
              required
              placeholder="مثال: جبنة رومي قديم"
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
              <NumberField
                step="any"
                className="form-input"
                value={newProduct.cost_price}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, cost_price: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div className="form-group">
              <label>
                سعر البيع قطاعي *{' '}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  (للجمهور بالقطعة)
                </span>
              </label>
              <NumberField
                step="any"
                className="form-input"
                value={newProduct.retail_price}
                onChange={(e) =>
                  setNewProduct((prev) => ({ ...prev, retail_price: e.target.value }))
                }
                required
                placeholder="0.00"
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
              <NumberField
                step="any"
                className="form-input"
                value={newProduct.wholesale_price}
                onChange={(e) =>
                  setNewProduct((prev) => ({ ...prev, wholesale_price: e.target.value }))
                }
                placeholder="0.00"
              />
            </div>
            <div className="form-group">
              <label>الكمية الحالية بالمخزن</label>
              <NumberField
                step="any"
                className="form-input"
                value={newProduct.stock_qty}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, stock_qty: e.target.value }))}
                placeholder="0"
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="form-group">
              <label>حد الطلب (إنذار النقص)</label>
              <NumberField
                step="any"
                className="form-input"
                value={newProduct.reorder_limit}
                onChange={(e) =>
                  setNewProduct((prev) => ({ ...prev, reorder_limit: e.target.value }))
                }
                placeholder="5"
              />
            </div>
            <div className="form-group">
              <label>الوحدة (كيلو/علبة/قطعة)</label>
              <input
                type="text"
                className="form-input"
                value={newProduct.unit}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, unit: e.target.value }))}
                placeholder="مثال: علبة"
              />
            </div>
            <div className="form-group">
              <label>طريقة القياس (الوحدة الأساسية للمخزون)</label>
              <KindSelect
                value={newProduct.unit_kind || 'count'}
                onChange={(kind) => setNewProduct((prev) => ({ ...prev, unit_kind: kind }))}
              />
            </div>
            <div className="form-group">
              <label htmlFor="add-product-category">التصنيف</label>
              <CategorySelect
                id="add-product-category"
                value={newProduct.category_id ?? null}
                onChange={(id) => setNewProduct((prev) => ({ ...prev, category_id: id }))}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              data-modal-close
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAddModal(false)}
            >
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
              حفظ الصنف
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddProductModal
