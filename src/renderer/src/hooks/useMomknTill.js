import { useState, useCallback } from 'react'
import {
  addMomknTransaction,
  getMomknTransactionsByShift,
  getMomknShiftSummary,
  deleteMomknTransaction
} from '../lib/dao/momkn.dao'
import { getFriendlyErrorMessage } from '../lib/utils'

export function useMomknTill({ currentShift, triggerCustomAlert, triggerCustomConfirm }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [summary, setSummary] = useState({
    startBalance: 0,
    expectedDigitalBalance: 0,
    totalCashImpact: 0,
    totalCommission: 0
  })

  const fetchMomknData = useCallback(async () => {
    if (!currentShift) return
    setLoading(true)
    try {
      const list = await getMomknTransactionsByShift(currentShift.id)
      const sumInfo = await getMomknShiftSummary(currentShift.id)
      setTransactions(list || [])
      setSummary(sumInfo)
    } catch (err) {
      console.error('fetchMomknData error:', err)
      triggerCustomAlert('حدث خطأ أثناء تحميل بيانات درج ممكن: ' + (err.message || err))
    } finally {
      setLoading(false)
    }
  }, [currentShift, triggerCustomAlert])

  const handleAddTransaction = async ({
    operationType,
    description,
    digitalImpact,
    cashImpact,
    commission,
    notes
  }) => {
    if (!currentShift) {
      triggerCustomAlert('الرجاء التأكد من وجود وردية مفتوحة أولاً!')
      return false
    }

    try {
      await addMomknTransaction({
        shiftId: currentShift.id,
        operationType,
        description,
        digitalImpact,
        cashImpact,
        commission,
        notes
      })
      setModalOpen(false)
      await fetchMomknData()
      triggerCustomAlert('تم تسجيل حركة مكنة ممكن بنجاح!')
      return true
    } catch (err) {
      triggerCustomAlert('فشل إضافة المعاملة: ' + getFriendlyErrorMessage(err))
      return false
    }
  }

  const handleDeleteTransaction = async (id) => {
    triggerCustomConfirm(
      'هل أنت متأكد من حذف هذه العملية؟ سيتم إزالتها نهائياً من السجلات.',
      async () => {
        try {
          await deleteMomknTransaction(id)
          await fetchMomknData()
          triggerCustomAlert('تم حذف العملية بنجاح!')
        } catch (err) {
          triggerCustomAlert('فشل حذف العملية: ' + getFriendlyErrorMessage(err))
        }
      }
    )
  }

  return {
    transactions,
    loading,
    modalOpen,
    setModalOpen,
    summary,
    fetchMomknData,
    handleAddTransaction,
    handleDeleteTransaction
  }
}
