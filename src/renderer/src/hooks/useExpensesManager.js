import { useState } from 'react'
import { api } from '../lib/api'

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
      const res = await api('expenses.list')
      setExpensesList(res || [])
    } catch (err) {
      console.error('fetchExpensesList error:', err)
    }
  }

  const handleAddExpense = async (e) => {
    if (e) e.preventDefault()
    // The note is optional (owner feedback EXP-02).
    if (!newExpenseForm.amount) {
      triggerCustomAlert('يرجى إدخال مبلغ المصروف!')
      return
    }
    const amountVal = parseFloat(newExpenseForm.amount) || 0
    if (amountVal <= 0) {
      triggerCustomAlert('الرجاء إدخال مبلغ صحيح أكبر من الصفر!')
      return
    }

    try {
      // Expense + drawer outflow in one service transaction (requires an open shift, as before).
      await api('expenses.create', {
        amount: amountVal,
        category: newExpenseForm.category,
        description: newExpenseForm.description,
        currentShiftId: currentShift ? currentShift.id : null
      })
      setShowAddExpenseModal(false)
      setNewExpenseForm({ amount: '', category: 'عام', description: '' })
      await fetchExpensesList()
      if (fetchAdminData) await fetchAdminData()
      triggerCustomAlert('تم تسجيل المصروف بنجاح وخصمه من الخزنة!')
    } catch (err) {
      triggerCustomAlert('فشل إضافة المصروف: ' + err.message)
    }
  }

  const handleDeleteExpense = async (expense) => {
    const { id } = expense
    triggerCustomConfirm(
      'هل أنت متأكد من حذف هذا المصروف؟ سيتم حذف المصروف وعكس الحركة في الخزنة تلقائياً.',
      async () => {
        try {
          await api('expenses.delete', { expenseId: id })
          await fetchExpensesList()
          if (fetchAdminData) await fetchAdminData()
        } catch (err) {
          if (err.message && err.message.includes('FOREIGN KEY')) {
            triggerCustomAlert('لا يمكن حذف هذا المصروف لأنه مرتبط بمعاملات أخرى بالنظام.')
          } else {
            triggerCustomAlert('فشل حذف المصروف: ' + err.message)
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
