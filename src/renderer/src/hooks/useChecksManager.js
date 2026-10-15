import { useState } from 'react'
import { executeQuery } from '../lib/db'
import { escapeSql, getNowStr, getFriendlyErrorMessage } from '../lib/utils'

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
      const res = await executeQuery(`SELECT * FROM checks_register ORDER BY due_date ASC;`)
      setChecksList(res || [])
    } catch (err) {
      console.error('fetchChecksList error:', err)
    }
  }

  const fetchChecksDueToday = async () => {
    try {
      const todayISO = new Date().toISOString().split('T')[0]
      const res = await executeQuery(`
        SELECT * FROM checks_register
        WHERE status = 'غير مسدد'
          AND due_date = '${todayISO}'
        ORDER BY due_date ASC;
      `)
      setChecksDueToday(res || [])
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
      const nowStr = getNowStr()
      await executeQuery(`
        INSERT INTO checks_register (check_type, check_number, bank_name, party_name, issue_date, due_date, amount, status, notes, created_at)
        VALUES ('${escapeSql(newCheckForm.check_type)}', '${escapeSql(newCheckForm.check_number)}',
                '${escapeSql(newCheckForm.bank_name)}', '${escapeSql(newCheckForm.party_name)}',
                '${escapeSql(newCheckForm.issue_date)}', '${escapeSql(newCheckForm.due_date)}',
                ${parseFloat(newCheckForm.amount) || 0}, 'غير مسدد', '${escapeSql(newCheckForm.notes)}', '${nowStr}');
      `)
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
      triggerCustomAlert('فشل إضافة الشيك: ' + getFriendlyErrorMessage(err))
    }
  }

  const handleMarkCheckPaid = async (checkId) => {
    triggerCustomConfirm('هل تريد تأكيد سداد هذا الشيك وتغيير حالته؟', async () => {
      try {
        await executeQuery(`UPDATE checks_register SET status = 'مسدد' WHERE id = ${checkId};`)
        await fetchChecksList()
        await fetchChecksDueToday()
      } catch (err) {
        triggerCustomAlert('فشل تحديث الشيك: ' + getFriendlyErrorMessage(err))
      }
    })
  }

  const handleDeleteCheck = async (checkId) => {
    triggerCustomConfirm('هل أنت متأكد من حذف هذا الشيك نهائياً؟', async () => {
      try {
        await executeQuery(`DELETE FROM checks_register WHERE id = ${checkId};`)
        await fetchChecksList()
        await fetchChecksDueToday()
      } catch (err) {
        if (err.message && err.message.includes('FOREIGN KEY')) {
          triggerCustomAlert('لا يمكن حذف هذا الشيك لأنه مرتبط بمعاملات أخرى بالنظام.')
        } else {
          triggerCustomAlert('فشل حذف الشيك: ' + getFriendlyErrorMessage(err))
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
