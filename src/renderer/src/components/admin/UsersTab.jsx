import { UserCog, UserPlus, Pencil, Trash2, Wrench, RotateCcw } from 'lucide-react'

const ROLE_BADGE = {
  super_admin: { label: 'مدير النظام', className: 'badge-info' },
  manager: { label: 'مشرف', className: 'badge-purple' },
  cashier: { label: 'كاشير', className: 'badge-accent' }
}

// How the user signs in (users.list login_state).
const LOGIN_STATE = {
  pin: {
    label: 'لم يختر كلمة مرور',
    className: 'badge-warning',
    title: 'يدخل مرة واحدة باسم المستخدم ورمز PIN القديم ثم يختار كلمة مرور'
  },
  temporary: {
    label: 'كلمة مرور مؤقتة',
    className: 'badge-warning',
    title: 'يختار كلمة مرور خاصة عند أول تسجيل دخول'
  }
}

/**
 * Users management (admin only). Data and mutations come from useUsersManager.
 */
export default function UsersTab({
  setNewUser,
  setShowAddUserModal,
  usersList,
  setEditUser,
  setShowEditUserModal,
  currentUser,
  handleDeleteUser,
  handleSystemReset
}) {
  return (
    <>
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            <UserCog size={18} aria-hidden="true" />
            حسابات المستخدمين
          </h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setNewUser({ username: '', roleId: '' })
              setShowAddUserModal(true)
            }}
          >
            <UserPlus size={16} aria-hidden="true" />
            إضافة حساب
          </button>
        </div>
        <div className="card-body">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 80 }}>المعرّف</th>
                  <th>اسم المستخدم</th>
                  <th>الحالة</th>
                  <th>الصلاحية</th>
                  <th>
                    <span className="visually-hidden">الإجراءات</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {usersList.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="table-empty">
                      لا توجد حسابات مسجلة.
                    </td>
                  </tr>
                ) : (
                  usersList.map((u) => {
                    const badge = ROLE_BADGE[u.role_key] || {
                      label: u.role_name || u.role,
                      className: 'badge-info'
                    }
                    const isMe = currentUser?.id === u.id
                    return (
                      <tr key={u.id}>
                        <td className="num cell-muted">#{u.id}</td>
                        <td>
                          <span className="cell-strong">{u.username}</span>
                          {isMe && <span className="badge ms-2">أنت</span>}
                        </td>
                        <td>
                          {u.is_active ? (
                            <span className="badge badge-success">نشط</span>
                          ) : (
                            <span className="badge badge-danger">معطل</span>
                          )}
                          {LOGIN_STATE[u.login_state] && (
                            <span
                              className={`badge ms-2 ${LOGIN_STATE[u.login_state].className}`}
                              title={LOGIN_STATE[u.login_state].title}
                            >
                              {LOGIN_STATE[u.login_state].label}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${badge.className}`}>
                            {u.role_name || badge.label}
                          </span>
                        </td>
                        <td>
                          <div className="cell-actions">
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => {
                                setEditUser({
                                  id: u.id,
                                  username: u.username,
                                  roleId: u.role_id,
                                  isActive: u.is_active
                                })
                                setShowEditUserModal(true)
                              }}
                            >
                              <Pencil size={15} aria-hidden="true" />
                              تعديل
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => handleDeleteUser(u)}
                              aria-label={`حذف ${u.username}`}
                              title="حذف الحساب"
                            >
                              <Trash2 size={15} />
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
        </div>
      </section>

      <section className="card danger-zone">
        <div className="card-header">
          <h2 className="card-title">
            <Wrench size={18} aria-hidden="true" />
            صيانة النظام وإعادة الضبط
          </h2>
        </div>
        <div className="card-body stack">
          <p className="text-2">
            تُستخدم قبل البدء الفعلي لحذف بيانات الاختبار.{' '}
            <strong className="text-danger">لا يمكن التراجع:</strong> ستُحذف الفواتير والورديات
            والعملاء والموردون والشيكات والمصروفات — ويبقى المخزون والمستخدمون.
          </p>
          <div>
            <button
              id="btn-system-reset"
              type="button"
              className="btn btn-danger-soft"
              onClick={handleSystemReset}
            >
              <RotateCcw size={16} aria-hidden="true" />
              إعادة ضبط بيانات التشغيل
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
