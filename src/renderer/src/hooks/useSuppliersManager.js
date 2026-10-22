import { useState } from 'react'
import { api, newClientRef } from '../lib/api'

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
    notes: '',
    discount: '',
    items: []
  })
  const [supplierRepayAmount, setSupplierRepayAmount] = useState('')
  // Preliminary supplier invoices (D-064): those waiting for their lines, and the one being
  // completed in the purchase window (with its request id, so a retry converts once).
  const [pendingInvoices, setPendingInvoices] = useState([])
  const [convertingPending, setConvertingPending] = useState(null)

  const fetchPendingInvoices = async () => {
    try {
      setPendingInvoices((await api('supplierInvoices.list', { status: 'pending' })) || [])
    } catch (err) {
      console.error('fetchPendingInvoices error:', err)
    }
  }

  const fetchSuppliersList = async (search = '') => {
    try {
      setSuppliersList((await api('suppliers.list', { search: search || '' })) || [])
    } catch (err) {
      console.error('fetchSuppliersList error:', err)
    }
    fetchPendingInvoices()
  }

  /** Open the purchase window to enter the lines of a preliminary invoice. */
  const startConvertPending = async (inv) => {
    await fetchSupplierProfile({ id: inv.supplier_id, name: inv.supplier_name })
    setNewPurchaseForm({
      invoice_ref: inv.invoice_ref || '',
      total_amount: '',
      paid_amount: '',
      payment_type: 'آجل',
      notes: '',
      discount: '',
      items: []
    })
    setConvertingPending({ ...inv, clientRef: newClientRef() })
    setShowAddPurchaseModal(true)
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
    if (convertingPending) return handleConvertPending()
    // With item lines the total is their sum (the service checks it again).
    const items = (newPurchaseForm.items || []).map((l) => ({
      barcode: l.barcode,
      unitId: l.unitId ?? null,
      qty: parseFloat(l.qty) || 0,
      unitCost: parseFloat(l.unitCost) || 0,
      // D-068: empty = keep the product's current selling price.
      newRetailPrice:
        l.newRetailPrice === '' || l.newRetailPrice === undefined
          ? null
          : parseFloat(l.newRetailPrice),
      newWholesalePrice:
        l.newWholesalePrice === '' || l.newWholesalePrice === undefined
          ? null
          : parseFloat(l.newWholesalePrice)
    }))
    if (items.some((l) => l.qty <= 0)) {
      triggerCustomAlert('أدخل كمية صحيحة لكل صنف مستلم.')
      return
    }
    const gross = items.length
      ? Math.round(
          items.reduce((a, l) => a + Math.round(l.qty * l.unitCost * 100) / 100, 0) * 100
        ) / 100
      : parseFloat(newPurchaseForm.total_amount) || 0
    // Optional invoice-level discount (D-066): the supplier is owed the net.
    const discount = Math.round((parseFloat(newPurchaseForm.discount) || 0) * 100) / 100
    const total = Math.round((gross - discount) * 100) / 100
    const paid = parseFloat(newPurchaseForm.paid_amount) || 0
    if (gross <= 0) {
      triggerCustomAlert('يرجى إدخال مبلغ الفاتورة!')
      return
    }
    if (discount < 0 || total <= 0) {
      triggerCustomAlert('الخصم يجب أن يكون أقل من إجمالي الفاتورة.')
      return
    }
    try {
      const updated = await api('suppliers.addPurchase', {
        supplierId: selectedSupplier.id,
        invoice_ref: newPurchaseForm.invoice_ref || '',
        total_amount: total,
        discount,
        paid_amount: paid,
        payment_type: newPurchaseForm.payment_type,
        notes: newPurchaseForm.notes || '',
        currentShiftId: currentShift ? currentShift.id : null,
        ...(items.length ? { items } : {})
      })
      setShowAddPurchaseModal(false)
      setNewPurchaseForm({
        invoice_ref: '',
        total_amount: '',
        paid_amount: '',
        payment_type: 'آجل',
        notes: '',
        discount: '',
        items: []
      })
      if (updated) await fetchSupplierProfile(updated)
    } catch (err) {
      triggerCustomAlert('فشل تسجيل الفاتورة: ' + err.message)
    }
  }

  // Stage B (D-064): the lines of a preliminary invoice – stock and cost, never a second payment.
  const handleConvertPending = async () => {
    const items = (newPurchaseForm.items || []).map((l) => ({
      barcode: l.barcode,
      unitId: l.unitId ?? null,
      qty: parseFloat(l.qty) || 0,
      unitCost: parseFloat(l.unitCost) || 0,
      // D-068: empty = keep the product's current selling price.
      newRetailPrice:
        l.newRetailPrice === '' || l.newRetailPrice === undefined
          ? null
          : parseFloat(l.newRetailPrice),
      newWholesalePrice:
        l.newWholesalePrice === '' || l.newWholesalePrice === undefined
          ? null
          : parseFloat(l.newWholesalePrice)
    }))
    if (!items.length || items.some((l) => l.qty <= 0)) {
      triggerCustomAlert('أضف أصناف الفاتورة بكمية صحيحة لكل صنف.')
      return
    }
    try {
      const res = await api('supplierInvoices.convert', {
        invoiceId: convertingPending.id,
        invoiceRef: newPurchaseForm.invoice_ref || null,
        notes: newPurchaseForm.notes || null,
        discount: Math.round((parseFloat(newPurchaseForm.discount) || 0) * 100) / 100,
        items,
        clientRef: convertingPending.clientRef
      })
      setShowAddPurchaseModal(false)
      setConvertingPending(null)
      await fetchSupplierProfile(selectedSupplier)
      await fetchPendingInvoices()
      triggerCustomAlert(
        res.difference
          ? `تم إكمال الفاتورة واستلام الأصناف. الفرق عن الفاتورة المبدئية ${res.difference.toFixed(2)} ج.م سُجّل على حساب المورد.`
          : 'تم إكمال الفاتورة واستلام الأصناف.'
      )
    } catch (err) {
      triggerCustomAlert('فشل إكمال الفاتورة: ' + err.message)
    }
  }

  // destination: 'shift' or 'treasury' (owner feedback CUST-02), chosen on the form.
  const handleSupplierRepay = async (e, destination, method = 'cash') => {
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
        destination,
        method,
        currentShiftId: destination === 'shift' && currentShift ? currentShift.id : null,
        clientRef: newClientRef()
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
    handleDeleteSupplier,
    pendingInvoices,
    fetchPendingInvoices,
    convertingPending,
    setConvertingPending,
    startConvertPending
  }
}
