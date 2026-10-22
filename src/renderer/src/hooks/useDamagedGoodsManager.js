import { useState } from 'react'
import { api } from '../lib/api'

export function useDamagedGoodsManager({
  currentShift,
  fetchAdminData,
  triggerCustomAlert,
  triggerCustomConfirm
}) {
  const [damagedGoodsList, setDamagedGoodsList] = useState([])
  const [showAddDamagedModal, setShowAddDamagedModal] = useState(false)
  const [newDamagedForm, setNewDamagedForm] = useState({
    barcode: '',
    quantity: '',
    reason: 'انتهاء صلاحية'
  })

  const fetchDamagedGoods = async () => {
    try {
      const res = await api('damaged.list')
      setDamagedGoodsList(res || [])
    } catch (err) {
      console.error('fetchDamagedGoods error:', err)
    }
  }

  const handleAddDamaged = async (e) => {
    if (e) e.preventDefault()
    if (!newDamagedForm.barcode || !newDamagedForm.quantity) {
      triggerCustomAlert('يرجى إدخال الباركود والكمية التالفة!')
      return
    }

    const trimmedBarcode = newDamagedForm.barcode.trim()
    const qtyVal = parseFloat(newDamagedForm.quantity) || 0
    if (qtyVal <= 0) {
      triggerCustomAlert('الرجاء إدخال كمية صحيحة أكبر من الصفر!')
      return
    }

    try {
      // The service re-checks the product and its stock, deducts it and records the damage atomically.
      await api('damaged.create', {
        barcode: trimmedBarcode,
        quantity: qtyVal,
        unitId: newDamagedForm.unitId ?? null,
        reason: newDamagedForm.reason,
        currentShiftId: currentShift ? currentShift.id : null
      })
      setShowAddDamagedModal(false)
      setNewDamagedForm({ barcode: '', quantity: '', reason: 'انتهاء صلاحية', unitId: null })

      await fetchDamagedGoods()
      if (fetchAdminData) await fetchAdminData()
      triggerCustomAlert('تم تسجيل الهالك بنجاح وخصم الكمية من المخزن وتأثيرها المالي من الأرباح!')
    } catch (err) {
      triggerCustomAlert('فشل تسجيل التالف: ' + err.message)
    }
  }

  const handleDeleteDamaged = async (item) => {
    triggerCustomConfirm(
      'هل أنت متأكد من حذف هذا السجل وإعادة الكمية التالفة إلى المخزن؟',
      async () => {
        try {
          await api('damaged.delete', { damagedId: item.id })
          await fetchDamagedGoods()
          if (fetchAdminData) await fetchAdminData()
          triggerCustomAlert('تم إلغاء سجل الهالك وإرجاع الكمية إلى المخزن بنجاح!')
        } catch (err) {
          triggerCustomAlert('فشل حذف سجل الهالك: ' + err.message)
        }
      }
    )
  }

  return {
    damagedGoodsList,
    showAddDamagedModal,
    setShowAddDamagedModal,
    newDamagedForm,
    setNewDamagedForm,
    fetchDamagedGoods,
    handleAddDamaged,
    handleDeleteDamaged
  }
}
