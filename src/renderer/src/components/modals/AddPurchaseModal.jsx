import { ReceiptText } from 'lucide-react'

const AddPurchaseModal = ({
  showAddPurchaseModal,
  setShowAddPurchaseModal,
  selectedSupplier,
  newPurchaseForm,
  setNewPurchaseForm,
  handleAddPurchase
}) => {
  if (!showAddPurchaseModal || !selectedSupplier) return null

  return (
    <div className="modal-overlay">
      <div className="modal-content" role="dialog" aria-modal="true" style={{ width: 440 }}>
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <ReceiptText size={22} />
          </span>
          <h2>فاتورة شراء جديدة</h2>
          <p>المورد: {selectedSupplier.name}</p>
        </div>
        <form
          onSubmit={handleAddPurchase}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div className="form-group">
            <label>رقم الفاتورة (مرجع)</label>
            <input
              className="form-input"
              value={newPurchaseForm.invoice_ref}
              onChange={(e) => setNewPurchaseForm((p) => ({ ...p, invoice_ref: e.target.value }))}
              placeholder="رقم الفاتورة اختياري"
            />
          </div>
          <div className="form-group">
            <label>إجمالي قيمة الفاتورة (ج.م) *</label>
            <input
              type="number"
              className="form-input"
              required
              min="0.01"
              step="0.01"
              value={newPurchaseForm.total_amount}
              onChange={(e) => setNewPurchaseForm((p) => ({ ...p, total_amount: e.target.value }))}
              placeholder="0.00"
            />
          </div>
          <div className="form-group">
            <label>المبلغ المدفوع نقداً الآن (ج.م)</label>
            <input
              type="number"
              className="form-input"
              min="0"
              step="0.01"
              value={newPurchaseForm.paid_amount}
              onChange={(e) => setNewPurchaseForm((p) => ({ ...p, paid_amount: e.target.value }))}
              placeholder="0.00"
            />
          </div>
          <div className="form-group">
            <label>نوع الدفع</label>
            <select
              className="form-input"
              value={newPurchaseForm.payment_type}
              onChange={(e) => setNewPurchaseForm((p) => ({ ...p, payment_type: e.target.value }))}
            >
              <option value="آجل">آجل</option>
              <option value="نقدي">نقدي كامل</option>
              <option value="شيك">شيك</option>
            </select>
          </div>
          <div className="form-group">
            <label>ملاحظات</label>
            <input
              className="form-input"
              value={newPurchaseForm.notes}
              onChange={(e) => setNewPurchaseForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="ملاحظات اختيارية"
            />
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAddPurchaseModal(false)}
            >
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
              تسجيل الفاتورة
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddPurchaseModal
