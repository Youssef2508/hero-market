import { useState } from 'react'
import { api } from '../lib/api'

export function useUsersManager({
  currentUser,
  fetchStats,
  fetchAdminData,
  triggerCustomAlert,
  triggerCustomConfirm
}) {
  const [usersList, setUsersList] = useState([])
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [showEditUserModal, setShowEditUserModal] = useState(false)
  // roleId refers to roles.id; the legacy role text is kept by the service for labels.
  // New accounts and password resets get a temporary password from the service, shown once.
  const [newUser, setNewUser] = useState({ username: '', roleId: '' })
  const [editUser, setEditUser] = useState({
    id: '',
    username: '',
    roleId: '',
    isActive: true
  })
  const [rolesList, setRolesList] = useState([])

  const fetchUsersList = async () => {
    try {
      const [users, roles] = await Promise.all([api('users.list'), api('roles.list')])
      setUsersList(users || [])
      setRolesList(roles || [])
    } catch (e) {
      console.error('Failed to fetch users list:', e)
    }
  }

  const handleDeleteUser = async (u) => {
    if (u.id === currentUser?.id) {
      triggerCustomAlert('لا يمكن حذف حساب المدير النشط الذي تستخدمه حالياً!')
      return
    }
    triggerCustomConfirm(`هل أنت متأكد من حذف حساب "${u.username}" نهائياً؟`, async () => {
      try {
        await api('users.delete', { id: u.id })
        triggerCustomAlert('تم حذف الحساب بنجاح!')
        await fetchUsersList()
      } catch (err) {
        triggerCustomAlert(
          err.status === 409 || err.status === 403 ? err.message : 'فشل حذف الحساب: ' + err.message
        )
      }
    })
  }

  const handleSystemReset = async () => {
    triggerCustomConfirm(
      'ستُحذف جميع الفواتير والورديات والعملاء والموردين والشيكات.\n\nالمنتجات والمستخدمون يبقون كما هم.\n\nهل أنت متأكد؟',
      () => {
        triggerCustomConfirm('تأكيد أخير: العملية لا يمكن التراجع عنها. متابعة؟', async () => {
          try {
            await api('system.reset', { confirm: 'RESET' })
            triggerCustomAlert('تم إعادة الضبط بنجاح! النظام جاهز للبدء الفعلي.')
            if (fetchStats) await fetchStats()
            if (fetchAdminData) await fetchAdminData()
          } catch (err) {
            triggerCustomAlert('فشلت عملية إعادة الضبط: ' + err.message)
          }
        })
      }
    )
  }

  const handleAddUser = async (e) => {
    if (e) e.preventDefault()
    const { username, roleId } = newUser
    if (!username || !roleId) {
      triggerCustomAlert('يرجى ملء كافة الحقول!')
      return
    }
    try {
      const r = await api('users.create', { username, roleId: Number(roleId) })
      triggerCustomAlert(
        `كلمة المرور المؤقتة للمستخدم "${username.trim()}":\n\n${r.temporaryPassword}\n\nأعطها للموظف. سيختار كلمة مرور خاصة به عند أول تسجيل دخول، ولن تظهر هذه الكلمة مرة أخرى.`,
        'تم إنشاء الحساب'
      )
      setShowAddUserModal(false)
      setNewUser({ username: '', roleId: '' })
      await fetchUsersList()
    } catch (err) {
      triggerCustomAlert(
        err.status === 409 || err.status === 403 ? err.message : 'فشل إضافة الحساب: ' + err.message
      )
    }
  }

  const handleEditUser = async (e) => {
    if (e) e.preventDefault()
    const { id, username, roleId, isActive } = editUser
    if (!username || !roleId) {
      triggerCustomAlert('يرجى ملء كافة الحقول!')
      return
    }
    try {
      await api('users.update', {
        id,
        username,
        roleId: Number(roleId),
        isActive: isActive !== false
      })
      triggerCustomAlert('تم تحديث بيانات الحساب بنجاح!')
      setShowEditUserModal(false)
      await fetchUsersList()
    } catch (err) {
      triggerCustomAlert(
        err.status === 409 || err.status === 403 ? err.message : 'فشل تحديث الحساب: ' + err.message
      )
    }
  }

  // Forgotten password: a temporary one replaces it; the user's sessions end.
  const handleResetPassword = (u) => {
    triggerCustomConfirm(
      `إعادة تعيين كلمة مرور "${u.username}"؟ ستتوقف كلمة المرور الحالية ويتم تسجيل خروجه من كل الأجهزة.`,
      async () => {
        try {
          const r = await api('users.update', {
            id: u.id,
            username: u.username,
            roleId: Number(u.roleId),
            resetPassword: true
          })
          setShowEditUserModal(false)
          triggerCustomAlert(
            `كلمة المرور المؤقتة للمستخدم "${u.username}":\n\n${r.temporaryPassword}\n\nأعطها للموظف. سيختار كلمة مرور خاصة به عند أول تسجيل دخول، ولن تظهر هذه الكلمة مرة أخرى.`,
            'كلمة مرور مؤقتة'
          )
          await fetchUsersList()
        } catch (err) {
          triggerCustomAlert('فشلت إعادة التعيين: ' + err.message)
        }
      }
    )
  }

  return {
    handleResetPassword,
    usersList,
    setUsersList,
    showAddUserModal,
    setShowAddUserModal,
    showEditUserModal,
    setShowEditUserModal,
    newUser,
    setNewUser,
    editUser,
    setEditUser,
    fetchUsersList,
    rolesList,
    handleDeleteUser,
    handleSystemReset,
    handleAddUser,
    handleEditUser
  }
}
