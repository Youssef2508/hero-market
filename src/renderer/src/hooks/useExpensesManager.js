import { useState } from 'react'
import { api, newClientRef } from '../lib/api'

// 1.5.0 (owner feedback EXP-01/02/03): categories come from the service, each user sees only the
// expenses they created (the service decides), and an expense is paid from the open shift's drawer
// or, for treasury managers, from the treasury. When both are possible the user chooses.
const emptyForm = () => ({
  amount: '',
  categoryId: '',
  description: '',
  destination: '',
  method: 'cash',
  clientRef: newClientRef()
})

export function useExpensesManager({
  currentShift,
  fetchAdminData,
  triggerCustomAlert,
  triggerCustomConfirm
}) {
  const [expensesList, setExpensesList] = useState([])
  const [expenseCategories, setExpenseCategories] = useState([])
  const [showAddExpenseModal, setShowAddExpenseModalState] = useState(false)
  const [newExpenseForm, setNewExpenseForm] = useState(emptyForm)

  const fetchExpenseCategories = async () => {
    try {
      setExpenseCategories((await api('expenseCategories.list')) || [])
    } catch (err) {
      console.error('fetchExpenseCategories error:', err)
    }
  }

  const fetchExpensesList = async () => {
    try {
      const res = await api('expenses.list')
      setExpensesList(res || [])
    } catch (err) {
      console.error('fetchExpensesList error:', err)
    }
    fetchExpenseCategories()
  }

  // A new form (and request id) each time the window opens; a retry of one save reuses its id.
  const setShowAddExpenseModal = (open) => {
    if (open) {
      setNewExpenseForm(emptyForm())
      fetchExpenseCategories()
    }
    setShowAddExpenseModalState(open)
  }

  const handleAddExpense = async (e, { destination } = {}) => {
    if (e) e.preventDefault()
    // The note is optional (owner feedback EXP-02).
    const amountVal = parseFloat(newExpenseForm.amount) || 0
    if (amountVal <= 0) {
      triggerCustomAlert('الرجاء إدخال مبلغ صحيح أكبر من الصفر!')
      return
    }
    const dest = destination || newExpenseForm.destination
    if (!dest) {
      triggerCustomAlert('اختر من أين يُدفع المصروف: درج الوردية الحالية أو الخزنة.')
      return
    }
    try {
      const saved = await api('expenses.create', {
        amount: amountVal,
        categoryId: newExpenseForm.categoryId ? Number(newExpenseForm.categoryId) : null,
        description: newExpenseForm.description,
        destination: dest,
        method: newExpenseForm.method || 'cash',
        currentShiftId: dest === 'shift' && currentShift ? currentShift.id : null,
        clientRef: newExpenseForm.clientRef
      })
      setShowAddExpenseModalState(false)
      setNewExpenseForm(emptyForm())
      await fetchExpensesList()
      if (fetchAdminData) await fetchAdminData()
      triggerCustomAlert(
        saved.destination === 'treasury'
          ? 'تم تسجيل المصروف وخصمه من الخزنة.'
          : 'تم تسجيل المصروف وخصمه من درج الوردية.'
      )
    } catch (err) {
      triggerCustomAlert('فشل إضافة المصروف: ' + err.message)
    }
  }

  const handleDeleteExpense = async (expense) => {
    const { id } = expense
    const treasury = expense.destination === 'treasury'
    triggerCustomConfirm(
      treasury
        ? 'هل أنت متأكد من إلغاء هذا المصروف؟ تُسجَّل حركة عكسية في الخزنة بنفس المبلغ.'
        : 'هل أنت متأكد من حذف هذا المصروف؟ تُحذف حركته من درج الوردية.',
      async () => {
        try {
          await api('expenses.delete', { expenseId: id })
          await fetchExpensesList()
          if (fetchAdminData) await fetchAdminData()
        } catch (err) {
          triggerCustomAlert('فشل حذف المصروف: ' + err.message)
        }
      }
    )
  }

  const saveExpenseCategory = async (category) => {
    try {
      await api('expenseCategories.save', category)
      await fetchExpenseCategories()
      return true
    } catch (err) {
      triggerCustomAlert('تعذّر حفظ التصنيف: ' + err.message)
      return false
    }
  }

  return {
    expensesList,
    setExpensesList,
    expenseCategories,
    fetchExpenseCategories,
    saveExpenseCategory,
    showAddExpenseModal,
    setShowAddExpenseModal,
    newExpenseForm,
    setNewExpenseForm,
    fetchExpensesList,
    handleAddExpense,
    handleDeleteExpense
  }
}
