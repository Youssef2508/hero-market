import { useState, useCallback } from 'react'
import {
  addMobileMoneyTransaction,
  getMobileMoneyByShift,
  getMobileMoneyShiftSummary,
  deleteMobileMoneyTransaction
} from '../lib/dao/mobile_money.dao'
import { getFriendlyErrorMessage } from '../lib/utils'

export function useMobileMoneyTill({ currentShift, triggerCustomAlert, triggerCustomConfirm }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [platformFilter, setPlatformFilter] = useState('all') // 'all', 'vodafone_cash', 'instapay', 'bank_transfer'
  const [summary, setSummary] = useState({
    startBalance: 0,
    expectedVfcashDigitalBalance: 0,
    expectedInstapayDigitalBalance: 0,
    expectedBankDigitalBalance: 0,
    totalDigitalImpact: 0,
    totalCashImpact: 0,
    totalCommission: 0
  })

  const fetchMobileMoneyData = useCallback(async () => {
    if (!currentShift) return
    setLoading(true)
    try {
      const list = await getMobileMoneyByShift(currentShift.id)
      const sumInfo = await getMobileMoneyShiftSummary(currentShift.id)
      setTransactions(list || [])
      setSummary(sumInfo)
    } catch (err) {
      console.error('fetchMobileMoneyData error:', err)
      triggerCustomAlert('حدث خطأ أثناء تحميل بيانات المحافظ والتحويلات: ' + (err.message || err))
    } finally {
      setLoading(false)
    }
  }, [currentShift, triggerCustomAlert])

  const handleAddTransaction = async ({
    platform,
    operationType,
    digitalImpact,
    cashImpact,
    commission,
    recipientName,
    phoneOrAccount,
    notes
  }) => {
    if (!currentShift) {
      triggerCustomAlert('الرجاء التأكد من وجود وردية مفتوحة أولاً!')
      return false
    }

    try {
      await addMobileMoneyTransaction({
        shiftId: currentShift.id,
        platform,
        operationType,
        digitalImpact,
        cashImpact,
        commission,
        recipientName,
        phoneOrAccount,
        notes
      })
      setModalOpen(false)
      await fetchMobileMoneyData()
      triggerCustomAlert('تم تسجيل الحركة بنجاح!')
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
          await deleteMobileMoneyTransaction(id)
          await fetchMobileMoneyData()
          triggerCustomAlert('تم حذف العملية بنجاح!')
        } catch (err) {
          triggerCustomAlert('فشل حذف العملية: ' + getFriendlyErrorMessage(err))
        }
      }
    )
  }

  const filteredTransactions =
    platformFilter === 'all'
      ? transactions
      : transactions.filter((t) => t.platform === platformFilter)

  return {
    transactions: filteredTransactions,
    rawTransactions: transactions,
    loading,
    modalOpen,
    setModalOpen,
    platformFilter,
    setPlatformFilter,
    summary,
    fetchMobileMoneyData,
    handleAddTransaction,
    handleDeleteTransaction
  }
}
