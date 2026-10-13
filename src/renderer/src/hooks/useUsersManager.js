import { useState } from 'react'
import { executeQuery } from '../lib/db'
import { escapeSql, getFriendlyErrorMessage, hashPin } from '../lib/utils'
import { logEvent } from '../lib/dao/logs.dao'

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
  const [newUser, setNewUser] = useState({ username: '', pin: '', role: 'cashier' })
  const [editUser, setEditUser] = useState({ id: '', username: '', pin: '', role: 'cashier' })

  const fetchUsersList = async () => {
    try {
      const res = await executeQuery(
        'SELECT id, username, password_hash, role FROM users ORDER BY username ASC;'
      )
      setUsersList(res || [])
    } catch (e) {
      console.error('Failed to fetch users list:', e)
    }
  }

  const handleDeleteUser = async (u) => {
    if (u.id === currentUser?.id) {
      triggerCustomAlert('لا يمكن حذف حساب المدير النشط الذي تستخدمه حالياً!')
      return
    }
    triggerCustomConfirm(`هل أنت متأكد من حذف حساب الكاشير "${u.username}" نهائياً؟`, async () => {
      try {
        await executeQuery(`DELETE FROM users WHERE id = ${u.id};`)
        await logEvent({
          userId: currentUser?.id,
          username: currentUser?.username,
          actionType: 'user_delete',
          description: `حذف المستخدم "${u.username}" (رتبة: ${u.role})`
        })
        triggerCustomAlert('تم حذف الحساب بنجاح!')
        await fetchUsersList()
      } catch (err) {
        if (err.message && err.message.includes('FOREIGN KEY')) {
          triggerCustomAlert(
            'لا يمكن حذف هذا المستخدم لأنه قام بفتح ورديات أو تسجيل حركات سابقة بالنظام.'
          )
        } else {
          triggerCustomAlert('فشل حذف الحساب: ' + getFriendlyErrorMessage(err))
        }
      }
    })
  }

  const handleSystemReset = async () => {
    triggerCustomConfirm(
      'ستُحذف جميع الفواتير والورديات والعملاء والموردين والشيكات.\n\nالمنتجات والمستخدمون يبقون كما هم.\n\nهل أنت متأكد؟',
      () => {
        triggerCustomConfirm('تأكيد أخير: العملية لا يمكن التراجع عنها. متابعة؟', async () => {
          try {
            await executeQuery(`BEGIN TRANSACTION;
DELETE FROM sale_items;
DELETE FROM sales;
DELETE FROM safe_ledger;
DELETE FROM client_ledger;
DELETE FROM clients;
DELETE FROM supplier_ledger;
DELETE FROM supplier_purchases;
DELETE FROM suppliers;
DELETE FROM checks_register;
DELETE FROM expenses;
DELETE FROM damaged_goods;
DELETE FROM shift_audits;
DELETE FROM momkn_transactions;
DELETE FROM mobile_money_transactions;
DELETE FROM shifts;
DELETE FROM sqlite_sequence WHERE name IN ('sale_items','sales','shifts','safe_ledger','client_ledger','clients','supplier_ledger','supplier_purchases','suppliers','checks_register','expenses','damaged_goods','shift_audits','momkn_transactions','mobile_money_transactions');
UPDATE products SET stock_qty = 0 WHERE stock_qty < 0;
COMMIT;`)
            await logEvent({
              userId: currentUser?.id,
              username: currentUser?.username,
              actionType: 'system_reset',
              description: 'إعادة تهيئة كاملة لبيانات النظام والبدء من الصفر'
            })
            triggerCustomAlert('تم إعادة الضبط بنجاح! النظام جاهز للبدء الفعلي.')
            if (fetchStats) await fetchStats()
            if (fetchAdminData) await fetchAdminData()
          } catch (err) {
            triggerCustomAlert('فشلت عملية إعادة الضبط: ' + getFriendlyErrorMessage(err))
          }
        })
      }
    )
  }

  const handleAddUser = async (e) => {
    if (e) e.preventDefault()
    const { username, pin, role } = newUser
    if (!username || !pin) {
      triggerCustomAlert('يرجى ملء كافة الحقول!')
      return
    }
    if (!/^\d{4}$/.test(pin)) {
      triggerCustomAlert('رمز المرور (PIN) يجب أن يكون مكوناً من 4 أرقام فقط!')
      return
    }
    try {
      const dupName = await executeQuery(
        `SELECT * FROM users WHERE username = '${escapeSql(username)}' LIMIT 1;`
      )
      if (dupName.length > 0) {
        triggerCustomAlert('اسم المستخدم هذا مسجل مسبقاً! يرجى اختيار اسم آخر.')
        return
      }
      const hashedPin = await hashPin(pin)
      const dupPin = await executeQuery(
        `SELECT * FROM users WHERE (password_hash = '${escapeSql(hashedPin)}' OR password_hash = '${escapeSql(pin)}') LIMIT 1;`
      )
      if (dupPin.length > 0) {
        triggerCustomAlert(
          'رمز المرور (PIN) هذا مستخدم مسبقاً من قبل موظف آخر! يرجى اختيار رمز مختلف.'
        )
        return
      }

      await executeQuery(`
        INSERT INTO users (username, password_hash, role)
        VALUES ('${escapeSql(username)}', '${escapeSql(hashedPin)}', '${escapeSql(role)}');
      `)
      await logEvent({
        userId: currentUser?.id,
        username: currentUser?.username,
        actionType: 'user_create',
        description: `إنشاء مستخدم جديد "${username}" برتبة ${role}`
      })
      triggerCustomAlert('تم إضافة حساب الموظف الجديد بنجاح!')
      setShowAddUserModal(false)
      setNewUser({ username: '', pin: '', role: 'cashier' })
      await fetchUsersList()
    } catch (err) {
      triggerCustomAlert('فشل إضافة الحساب: ' + getFriendlyErrorMessage(err))
    }
  }

  const handleEditUser = async (e) => {
    if (e) e.preventDefault()
    const { id, username, pin, role } = editUser
    if (!username) {
      triggerCustomAlert('يرجى ملء كافة الحقول!')
      return
    }
    if (pin && pin !== '••••' && !/^\d{4}$/.test(pin)) {
      triggerCustomAlert('رمز المرور (PIN) يجب أن يكون مكوناً من 4 أرقام فقط!')
      return
    }
    try {
      if (pin && pin !== '••••') {
        const hashedPin = await hashPin(pin)
        const dupPin = await executeQuery(
          `SELECT * FROM users WHERE (password_hash = '${escapeSql(hashedPin)}' OR password_hash = '${escapeSql(pin)}') AND id != ${id} LIMIT 1;`
        )
        if (dupPin.length > 0) {
          triggerCustomAlert(
            'رمز المرور (PIN) هذا مستخدم مسبقاً من قبل موظف آخر! يرجى اختيار رمز مختلف.'
          )
          return
        }
        await executeQuery(`
          UPDATE users 
          SET username = '${escapeSql(username)}', 
              password_hash = '${escapeSql(hashedPin)}', 
              role = '${escapeSql(role)}'
          WHERE id = ${id};
        `)
      } else {
        await executeQuery(`
          UPDATE users 
          SET username = '${escapeSql(username)}', 
              role = '${escapeSql(role)}'
          WHERE id = ${id};
        `)
      }
      await logEvent({
        userId: currentUser?.id,
        username: currentUser?.username,
        actionType: 'user_update',
        description: `تحديث بيانات المستخدم "${username}" (رتبة: ${role})`
      })
      triggerCustomAlert('تم تحديث بيانات الحساب بنجاح!')
      setShowEditUserModal(false)
      await fetchUsersList()
    } catch (err) {
      triggerCustomAlert('فشل تحديث الحساب: ' + getFriendlyErrorMessage(err))
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
    handleDeleteUser,
    handleSystemReset,
    handleAddUser,
    handleEditUser
  }
}
