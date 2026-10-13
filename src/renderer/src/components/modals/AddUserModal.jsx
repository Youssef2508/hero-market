import { UserPlus } from 'lucide-react'

const AddUserModal = ({
  showAddUserModal,
  setShowAddUserModal,
  newUser,
  setNewUser,
  handleAddUser
}) => {
  if (!showAddUserModal) return null

  return (
    <div className="modal-overlay">
      <div className="modal-content" role="dialog" aria-modal="true" style={{ width: 440 }}>
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <UserPlus size={22} />
          </span>
          <h2>إضافة موظف جديد</h2>
          <p>أدخل بيانات الحساب الجديد لتسجيله بالكاشير</p>
        </div>
        <form
          onSubmit={handleAddUser}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div className="form-group">
            <label>اسم المستخدم (كاشير) *</label>
            <input
              type="text"
              className="form-input"
              value={newUser.username}
              onChange={(e) => setNewUser((prev) => ({ ...prev, username: e.target.value }))}
              required
              placeholder="مثال: أحمد محمد"
            />
          </div>
          <div className="form-group">
            <label>رمز المرور / PIN (4 أرقام) *</label>
            <input
              type="text"
              pattern="\d{4}"
              maxLength="4"
              className="form-input"
              value={newUser.pin}
              onChange={(e) =>
                setNewUser((prev) => ({ ...prev, pin: e.target.value.replace(/\D/g, '') }))
              }
              required
              placeholder="مثال: 1234"
            />
          </div>
          <div className="form-group">
            <label>نوع الصلاحية *</label>
            <select
              className="form-input"
              value={newUser.role}
              onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value }))}
            >
              <option value="cashier">كاشير (صلاحية البيع فقط)</option>
              <option value="admin">مدير (المالك - صلاحيات كاملة)</option>
            </select>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAddUserModal(false)}
            >
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
              إضافة الحساب
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddUserModal
