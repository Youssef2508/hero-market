import { UserPlus } from 'lucide-react'

const AddUserModal = ({
  showAddUserModal,
  setShowAddUserModal,
  newUser,
  setNewUser,
  handleAddUser,
  rolesList = []
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
            <label>اسم المستخدم *</label>
            <input
              type="text"
              className="form-input"
              value={newUser.username}
              onChange={(e) => setNewUser((prev) => ({ ...prev, username: e.target.value }))}
              required
              placeholder="مثال: أحمد محمد"
            />
          </div>
          <p className="field-hint">
            ستظهر كلمة مرور مؤقتة بعد الإضافة. يختار الموظف كلمة مرور خاصة به عند أول تسجيل دخول.
          </p>
          <div className="form-group">
            <label>الدور *</label>
            <select
              className="form-input"
              value={newUser.roleId}
              onChange={(e) => setNewUser((prev) => ({ ...prev, roleId: e.target.value }))}
              required
            >
              <option value="">اختر الدور…</option>
              {rolesList.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
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
