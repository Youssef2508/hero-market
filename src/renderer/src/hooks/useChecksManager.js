import { useState } from 'react'
import { api } from '../lib/api'

export function useChecksManager({ triggerCustomAlert, triggerCustomConfirm }) {
  const [checksList, setChecksList] = useState([])
  const [showAddCheckModal, setShowAddCheckModal] = useState(false)
  const [newCheckForm, setNewCheckForm] = useState({
    check_type: 'مورد',
    check_number: '',
    bank_name: '',
    party_name: '',
    issue_date: '',
    due_date: '',
    amount: '',
    notes: ''
  })
  const [checksDueToday, setChecksDueToday] = useState([])

  const fetchChecksList = async () => {
    try {
      const res = await api('checks.list')
      setChecksList(res.all || [])
    } catch (err) {
      console.error('fetchChecksList error:', err)
    }
  }

  const fetchChecksDueToday = async () => {
    try {
      // K-27: "today" is the store's local date, decided by the service.
      const res = await api('checks.list')
      setChecksDueToday(res.dueToday || [])
    } catch (err) {
      console.error('fetchChecksDueToday error:', err)
    }
  }

  const handleAddCheck = async (e) => {
    if (e) e.preventDefault()
    if (!newCheckForm.party_name || !newCheckForm.due_date || !newCheckForm.amount) {
      triggerCustomAlert('يرجى ملء الحقول الأساسية: الجهة، تاريخ الاستحقاق، والمبلغ!')
      return
    }
    try {
      await api('checks.create', {
        check_type: newCheckForm.check_type,
        check_number: newCheckForm.check_number || '',
        bank_name: newCheckForm.bank_name || '',
        party_name: newCheckForm.party_name,
        issue_date: newCheckForm.issue_date || null,
        due_date: newCheckForm.due_date,
        amount: parseFloat(newCheckForm.amount) || 0,
        notes: newCheckForm.notes || ''
      })
      setShowAddCheckModal(false)
      setNewCheckForm({
        check_type: 'مورد',
        check_number: '',
        bank_name: '',
        party_name: '',
        issue_date: '',
        due_date: '',
        amount: '',
        notes: ''
      })
      await fetchChecksList()
    } catch (err) {
      triggerCustomAlert('فشل إضافة الشيك: ' + err.message)
    }
  }

  const handleMarkCheckPaid = async (checkId) => {
    triggerCustomConfirm('هل تريد تأكيد سداد هذا الشيك وتغيير حالته؟', async () => {
      try {
        await api('checks.markPaid', { checkId })
        await fetchChecksList()
        await fetchChecksDueToday()
      } catch (err) {
        triggerCustomAlert('فشل تحديث الشيك: ' + err.message)
      }
    })
  }

  const handleDeleteCheck = async (checkId) => {
    triggerCustomConfirm('هل أنت متأكد من حذف هذا الشيك نهائياً؟', async () => {
      try {
        await api('checks.delete', { checkId })
        await fetchChecksList()
        await fetchChecksDueToday()
      } catch (err) {
        if (err.message && err.message.includes('FOREIGN KEY')) {
          triggerCustomAlert('لا يمكن حذف هذا الشيك لأنه مرتبط بمعاملات أخرى بالنظام.')
        } else {
          triggerCustomAlert('فشل حذف الشيك: ' + err.message)
        }
      }
    })
  }

  return {
    checksList,
    setChecksList,
    showAddCheckModal,
    setShowAddCheckModal,
    newCheckForm,
    setNewCheckForm,
    checksDueToday,
    setChecksDueToday,
    fetchChecksList,
    fetchChecksDueToday,
    handleAddCheck,
    handleMarkCheckPaid,
    handleDeleteCheck
  }
}
