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
  const [newUser, setNewUser] = useState({ username: '', pin: '', roleId: '' })
  const [editUser, setEditUser] = useState({
    id: '',
    username: '',
    pin: '',
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
    const { username, pin, roleId } = newUser
    if (!username || !pin || !roleId) {
      triggerCustomAlert('يرجى ملء كافة الحقول!')
      return
    }
    if (!/^\d{4}$/.test(pin)) {
      triggerCustomAlert('رمز المرور (PIN) يجب أن يكون مكوناً من 4 أرقام فقط!')
      return
    }
    try {
      await api('users.create', { username, pin, roleId: Number(roleId) })
      triggerCustomAlert('تم إضافة حساب الموظف الجديد بنجاح!')
      setShowAddUserModal(false)
      setNewUser({ username: '', pin: '', roleId: '' })
      await fetchUsersList()
    } catch (err) {
      triggerCustomAlert(
        err.status === 409 || err.status === 403 ? err.message : 'فشل إضافة الحساب: ' + err.message
      )
    }
  }

  const handleEditUser = async (e) => {
    if (e) e.preventDefault()
    const { id, username, pin, roleId, isActive } = editUser
    if (!username || !roleId) {
      triggerCustomAlert('يرجى ملء كافة الحقول!')
      return
    }
    const changePin = pin && pin !== '••••'
    if (changePin && !/^\d{4}$/.test(pin)) {
      triggerCustomAlert('رمز المرور (PIN) يجب أن يكون مكوناً من 4 أرقام فقط!')
      return
    }
    try {
      await api('users.update', {
        id,
        username,
        pin: changePin ? pin : null,
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

  return {
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
