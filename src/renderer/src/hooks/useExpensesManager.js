import { useState } from 'react'
import { executeQuery } from '../lib/db'
import { escapeSql, getNowStr, getFriendlyErrorMessage } from '../lib/utils'

export function useExpensesManager({
  currentShift,
  fetchAdminData,
  triggerCustomAlert,
  triggerCustomConfirm
}) {
  const [expensesList, setExpensesList] = useState([])
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false)
  const [newExpenseForm, setNewExpenseForm] = useState({
    amount: '',
    category: 'عام',
    description: ''
  })

  const fetchExpensesList = async () => {
    try {
      const res = await executeQuery(`SELECT * FROM expenses ORDER BY id DESC;`)
      setExpensesList(res || [])
    } catch (err) {
      console.error('fetchExpensesList error:', err)
    }
  }

  const handleAddExpense = async (e) => {
    if (e) e.preventDefault()
    if (!newExpenseForm.amount || !newExpenseForm.description) {
      triggerCustomAlert('يرجى ملء مبلغ المصروف والوصف!')
      return
    }
    const amountVal = parseFloat(newExpenseForm.amount) || 0
    if (amountVal <= 0) {
      triggerCustomAlert('الرجاء إدخال مبلغ صحيح أكبر من الصفر!')
      return
    }

    try {
      const shiftId = currentShift ? currentShift.id : 'NULL'
      const nowStr = getNowStr()

      // We will perform both operations inside a transaction
      let sql = 'BEGIN TRANSACTION;\n'

      // 1. Insert into expenses
      sql += `INSERT INTO expenses (shift_id, amount, category, description, timestamp) 
              VALUES (${shiftId}, ${amountVal}, '${escapeSql(newExpenseForm.category)}', '${escapeSql(newExpenseForm.description)}', '${nowStr}');\n`

      // 2. Insert into safe_ledger as an outflow (treasury expense)
      const ledgerDesc = `مصروفات - تصنيف: ${escapeSql(newExpenseForm.category)} - ${escapeSql(newExpenseForm.description)}`
      sql += `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) 
              VALUES (${shiftId}, 'outflow', ${amountVal}, '${ledgerDesc}', '${nowStr}');\n`

      sql += 'COMMIT;\n'

      await executeQuery(sql)
      setShowAddExpenseModal(false)
      setNewExpenseForm({ amount: '', category: 'عام', description: '' })
      await fetchExpensesList()
      if (fetchAdminData) await fetchAdminData()
      triggerCustomAlert('تم تسجيل المصروف بنجاح وخصمه من الخزنة!')
    } catch (err) {
      triggerCustomAlert('فشل إضافة المصروف: ' + getFriendlyErrorMessage(err))
    }
  }

  const handleDeleteExpense = async (expense) => {
    const { id, amount, description, category, shift_id } = expense
    triggerCustomConfirm(
      'هل أنت متأكد من حذف هذا المصروف؟ سيتم حذف المصروف وعكس الحركة في الخزنة تلقائياً.',
      async () => {
        try {
          let sql = 'BEGIN TRANSACTION;\n'
          sql += `DELETE FROM expenses WHERE id = ${id};\n`
          const ledgerDesc = `مصروفات - تصنيف: ${category} - ${description}`
          sql += `DELETE FROM safe_ledger WHERE shift_id = ${shift_id || 'NULL'} AND type = 'outflow' AND amount = ${amount} AND description = '${escapeSql(ledgerDesc)}';\n`
          sql += 'COMMIT;\n'
          await executeQuery(sql)
          await fetchExpensesList()
          if (fetchAdminData) await fetchAdminData()
        } catch (err) {
          if (err.message && err.message.includes('FOREIGN KEY')) {
            triggerCustomAlert('لا يمكن حذف هذا المصروف لأنه مرتبط بمعاملات أخرى بالنظام.')
          } else {
            triggerCustomAlert('فشل حذف المصروف: ' + getFriendlyErrorMessage(err))
          }
        }
      }
    )
  }

  return {
    expensesList,
    setExpensesList,
    showAddExpenseModal,
    setShowAddExpenseModal,
    newExpenseForm,
    setNewExpenseForm,
    fetchExpensesList,
    handleAddExpense,
    handleDeleteExpense
  }
}
