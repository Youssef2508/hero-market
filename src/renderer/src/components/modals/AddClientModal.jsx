import { UserPlus } from 'lucide-react'

const AddClientModal = ({
  showAddClientModal,
  setShowAddClientModal,
  newClientForm,
  setNewClientForm,
  handleAddClient
}) => {
  if (!showAddClientModal) return null

  return (
    <div className="modal-overlay">
      <div className="modal-content" role="dialog" aria-modal="true" style={{ width: 440 }}>
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <UserPlus size={22} />
          </span>
          <h2>إضافة عميل جديد</h2>
          <p>تسجيل عميل جديد وحساب مديونية ونقاط في النظام</p>
        </div>
        <form
          onSubmit={handleAddClient}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div className="form-group">
            <label>اسم العميل *</label>
            <input
              type="text"
              className="form-input"
              value={newClientForm.name}
              onChange={(e) => setNewClientForm((prev) => ({ ...prev, name: e.target.value }))}
              required
              placeholder="مثال: محمد أحمد علي"
            />
          </div>
          <div className="form-group">
            <label>رقم الهاتف</label>
            <input
              type="text"
              className="form-input"
              value={newClientForm.phone}
              onChange={(e) =>
                setNewClientForm((prev) => ({ ...prev, phone: e.target.value.replace(/\D/g, '') }))
              }
              placeholder="مثال: 01012345678"
            />
          </div>
          <div className="form-group">
            <label>عنوان التوصيل</label>
            <input
              type="text"
              className="form-input"
              value={newClientForm.address}
              onChange={(e) => setNewClientForm((prev) => ({ ...prev, address: e.target.value }))}
              placeholder="مثال: مدينة نصر، شارع عباس العقاد"
            />
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAddClientModal(false)}
            >
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
              إضافة العميل
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddClientModal
