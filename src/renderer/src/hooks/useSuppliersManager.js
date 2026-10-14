import { useState } from 'react'
import { api } from '../lib/api'

export function useSuppliersManager({ currentShift, triggerCustomAlert, triggerCustomConfirm }) {
  const [suppliersList, setSuppliersList] = useState([])
  const [suppliersSearch, setSuppliersSearch] = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [supplierLedger, setSupplierLedger] = useState([])
  const [supplierPurchases, setSupplierPurchases] = useState([])
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false)
  const [showAddPurchaseModal, setShowAddPurchaseModal] = useState(false)
  const [newSupplierForm, setNewSupplierForm] = useState({
    name: '',
    phone: '',
    address: '',
    contact_person: ''
  })
  const [newPurchaseForm, setNewPurchaseForm] = useState({
    invoice_ref: '',
    total_amount: '',
    paid_amount: '',
    payment_type: 'آجل',
    notes: ''
  })
  const [supplierRepayAmount, setSupplierRepayAmount] = useState('')

  const fetchSuppliersList = async (search = '') => {
    try {
      setSuppliersList((await api('suppliers.list', { search: search || '' })) || [])
    } catch (err) {
      console.error('fetchSuppliersList error:', err)
    }
  }

  const fetchSupplierProfile = async (supplier) => {
    setSelectedSupplier(supplier)
    try {
      const res = await api('suppliers.profile', { supplierId: supplier.id })
      if (res.supplier) setSelectedSupplier(res.supplier)
      setSupplierLedger(res.ledger || [])
      setSupplierPurchases(res.purchases || [])
    } catch (err) {
      console.error('fetchSupplierProfile error:', err)
    }
  }

  const handleAddSupplier = async (e) => {
    if (e) e.preventDefault()
    if (!newSupplierForm.name) {
      triggerCustomAlert('يرجى إدخال اسم المورد!')
      return
    }
    try {
      await api('suppliers.create', {
        name: newSupplierForm.name,
        phone: newSupplierForm.phone || '',
        address: newSupplierForm.address || '',
        contact_person: newSupplierForm.contact_person || ''
      })
      setShowAddSupplierModal(false)
      setNewSupplierForm({ name: '', phone: '', address: '', contact_person: '' })
      await fetchSuppliersList()
    } catch (err) {
      triggerCustomAlert('فشل إضافة المورد: ' + err.message)
    }
  }

  const handleAddPurchase = async (e) => {
    if (e) e.preventDefault()
    if (!selectedSupplier) return
    const total = parseFloat(newPurchaseForm.total_amount) || 0
    const paid = parseFloat(newPurchaseForm.paid_amount) || 0
    if (total <= 0) {
      triggerCustomAlert('يرجى إدخال مبلغ الفاتورة!')
      return
    }
    try {
      const updated = await api('suppliers.addPurchase', {
        supplierId: selectedSupplier.id,
        invoice_ref: newPurchaseForm.invoice_ref || '',
        total_amount: total,
        paid_amount: paid,
        payment_type: newPurchaseForm.payment_type,
        notes: newPurchaseForm.notes || '',
        currentShiftId: currentShift ? currentShift.id : null
      })
      setShowAddPurchaseModal(false)
      setNewPurchaseForm({
        invoice_ref: '',
        total_amount: '',
        paid_amount: '',
        payment_type: 'آجل',
        notes: ''
      })
      if (updated) await fetchSupplierProfile(updated)
    } catch (err) {
      triggerCustomAlert('فشل تسجيل الفاتورة: ' + err.message)
    }
  }

  const handleSupplierRepay = async (e) => {
    if (e) e.preventDefault()
    const amount = parseFloat(supplierRepayAmount) || 0
    if (amount <= 0) {
      triggerCustomAlert('يرجى إدخال مبلغ صحيح!')
      return
    }
    try {
      const updated = await api('suppliers.repay', {
        supplierId: selectedSupplier.id,
        amount,
        currentShiftId: currentShift ? currentShift.id : null
      })
      setSupplierRepayAmount('')
      if (updated) await fetchSupplierProfile(updated)
    } catch (err) {
      triggerCustomAlert('فشل تسجيل السداد: ' + err.message)
    }
  }

  const handleDeleteSupplier = async (supplierId) => {
    triggerCustomConfirm('هل أنت متأكد من حذف هذا المورد وكافة سجلاته؟', async () => {
      try {
        await api('suppliers.delete', { supplierId })
        setSelectedSupplier(null)
        setSupplierLedger([])
        setSupplierPurchases([])
        await fetchSuppliersList()
      } catch (err) {
        triggerCustomAlert(err.status === 409 ? err.message : 'فشل حذف المورد: ' + err.message)
      }
    })
  }

  return {
    suppliersList,
    setSuppliersList,
    suppliersSearch,
    setSuppliersSearch,
    selectedSupplier,
    setSelectedSupplier,
    supplierLedger,
    supplierPurchases,
    showAddSupplierModal,
    setShowAddSupplierModal,
    showAddPurchaseModal,
    setShowAddPurchaseModal,
    newSupplierForm,
    setNewSupplierForm,
    newPurchaseForm,
    setNewPurchaseForm,
    supplierRepayAmount,
    setSupplierRepayAmount,
    fetchSuppliersList,
    fetchSupplierProfile,
    handleAddSupplier,
    handleAddPurchase,
    handleSupplierRepay,
    handleDeleteSupplier
  }
}
