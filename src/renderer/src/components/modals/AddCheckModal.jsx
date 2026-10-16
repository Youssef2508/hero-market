import { Landmark } from 'lucide-react'

const AddCheckModal = ({
  showAddCheckModal,
  setShowAddCheckModal,
  newCheckForm,
  setNewCheckForm,
  handleAddCheck
}) => {
  if (!showAddCheckModal) return null

  return (
    <div className="modal-overlay">
      <div className="modal-content" role="dialog" aria-modal="true" style={{ width: 460 }}>
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Landmark size={22} />
          </span>
          <h2>إضافة شيك / ورقة دفع</h2>
        </div>
        <form
          onSubmit={handleAddCheck}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group">
              <label>نوع الشيك *</label>
              <select
                className="form-input"
                value={newCheckForm.check_type}
                onChange={(e) => setNewCheckForm((p) => ({ ...p, check_type: e.target.value }))}
              >
                <option value="مورد">مورد (علينا)</option>
                <option value="عميل">عميل (لنا)</option>
              </select>
            </div>
            <div className="form-group">
              <label>رقم الشيك</label>
              <input
                className="form-input"
                value={newCheckForm.check_number}
                onChange={(e) => setNewCheckForm((p) => ({ ...p, check_number: e.target.value }))}
                placeholder="رقم الشيك"
              />
            </div>
          </div>
          <div className="form-group">
            <label>اسم الجهة *</label>
            <input
              className="form-input"
              required
              value={newCheckForm.party_name}
              onChange={(e) => setNewCheckForm((p) => ({ ...p, party_name: e.target.value }))}
              placeholder="اسم المورد أو العميل"
            />
          </div>
          <div className="form-group">
            <label>البنك</label>
            <input
              className="form-input"
              value={newCheckForm.bank_name}
              onChange={(e) => setNewCheckForm((p) => ({ ...p, bank_name: e.target.value }))}
              placeholder="اسم البنك"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group">
              <label>تاريخ الإصدار</label>
              <input
                type="date"
                className="form-input"
                value={newCheckForm.issue_date}
                onChange={(e) => setNewCheckForm((p) => ({ ...p, issue_date: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>تاريخ الاستحقاق *</label>
              <input
                type="date"
                className="form-input"
                required
                value={newCheckForm.due_date}
                onChange={(e) => setNewCheckForm((p) => ({ ...p, due_date: e.target.value }))}
              />
            </div>
          </div>
          <div className="form-group">
            <label>قيمة الشيك (ج.م) *</label>
            <input
              type="number"
              className="form-input"
              required
              min="0.01"
              step="0.01"
              value={newCheckForm.amount}
              onChange={(e) => setNewCheckForm((p) => ({ ...p, amount: e.target.value }))}
              placeholder="0.00"
            />
          </div>
          <div className="form-group">
            <label>ملاحظات</label>
            <input
              className="form-input"
              value={newCheckForm.notes}
              onChange={(e) => setNewCheckForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="ملاحظات اختيارية"
            />
          </div>
          <div className="modal-footer">
            <button
              data-modal-close
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAddCheckModal(false)}
            >
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
              إضافة الشيك
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddCheckModal
