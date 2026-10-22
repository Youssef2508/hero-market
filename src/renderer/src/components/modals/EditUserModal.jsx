import { useState } from 'react'
import { UserCog, KeyRound } from 'lucide-react'

const EditUserModal = ({
  showEditUserModal,
  setShowEditUserModal,
  editUser,
  setEditUser,
  handleEditUser,
  handleResetPassword,
  rolesList = []
}) => {
  // USER-02 (D-076): a reset needs the administrator's own password, typed here.
  const [resetOpen, setResetOpen] = useState(false)
  const [actorPassword, setActorPassword] = useState('')
  if (!showEditUserModal) return null

  return (
    <div className="modal-overlay">
      <div className="modal-content" role="dialog" aria-modal="true" style={{ width: 440 }}>
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <UserCog size={22} />
          </span>
          <h2>تعديل بيانات الحساب</h2>
          <p>تعديل بيانات الموظف رقم #{editUser.id}</p>
        </div>
        <form
          onSubmit={handleEditUser}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div className="form-group">
            <label>اسم المستخدم *</label>
            <input
              type="text"
              className="form-input"
              value={editUser.username}
              onChange={(e) => setEditUser((prev) => ({ ...prev, username: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label>كلمة المرور</label>
            {!resetOpen ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setResetOpen(true)}
              >
                <KeyRound size={15} aria-hidden="true" />
                إعادة تعيين كلمة المرور (كلمة مؤقتة)
              </button>
            ) : (
              <div className="stack">
                <p className="field-hint">
                  ستتوقف كلمة المرور الحالية لـ «{editUser.username}» ويُسجَّل خروجه من كل الأجهزة.
                  الكلمة المؤقتة صالحة 72 ساعة. للتأكيد اكتب كلمة مرورك أنت.
                </p>
                <input
                  type="password"
                  className="form-input"
                  autoComplete="current-password"
                  aria-label="كلمة مرورك للتأكيد"
                  placeholder="كلمة مرورك للتأكيد"
                  value={actorPassword}
                  onChange={(e) => setActorPassword(e.target.value)}
                />
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={!actorPassword}
                    onClick={async () => {
                      await handleResetPassword(editUser, actorPassword)
                      setActorPassword('')
                    }}
                  >
                    تأكيد إعادة التعيين
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setResetOpen(false)
                      setActorPassword('')
                    }}
                  >
                    تراجع
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="form-group">
            <label>الدور *</label>
            <select
              className="form-input"
              value={editUser.roleId}
              onChange={(e) => setEditUser((prev) => ({ ...prev, roleId: e.target.value }))}
              required
            >
              {rolesList.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={editUser.isActive !== false}
              onChange={(e) => setEditUser((prev) => ({ ...prev, isActive: e.target.checked }))}
            />
            <span>الحساب نشط (إلغاء التحديد يمنع تسجيل الدخول ويُنهي جلساته)</span>
          </label>
          <div className="modal-footer">
            <button
              data-modal-close
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowEditUserModal(false)}
            >
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
              تحديث الحساب
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default EditUserModal
