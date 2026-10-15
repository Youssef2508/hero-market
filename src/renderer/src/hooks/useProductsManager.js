import { useState } from 'react'
import { api } from '../lib/api'

export function useProductsManager({
  fetchAdminData,
  setToastMessage,
  triggerCustomAlert,
  triggerCustomConfirm
}) {
  const [adminProducts, setAdminProducts] = useState([])
  const [adminTotalCount, setAdminTotalCount] = useState(0)
  const [adminPage, setAdminPage] = useState(1)
  const [adminSearch, setAdminSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [newProduct, setNewProduct] = useState({
    barcode: '',
    name: '',
    cost_price: '',
    retail_price: '',
    wholesale_price: '',
    stock_qty: '',
    reorder_limit: '',
    unit: ''
  })
  const [editProduct, setEditProduct] = useState({
    barcode: '',
    name: '',
    cost_price: '',
    retail_price: '',
    wholesale_price: '',
    stock_qty: '',
    reorder_limit: '',
    unit: ''
  })
  const [productsSortField, setProductsSortField] = useState('name')
  const [productsSortAsc, setProductsSortAsc] = useState(true)
  const itemsPerPage = 12

  const fetchInventoryPage = async (page = 1, search = '', sortField = null, sortAsc = null) => {
    try {
      const activeSortFieldRaw = sortField !== null ? sortField : productsSortField
      const activeSortAsc = sortAsc !== null ? sortAsc : productsSortAsc

      const allowedFields = [
        'name',
        'barcode',
        'stock_qty',
        'retail_price',
        'cost_price',
        'reorder_limit'
      ]
      // The service applies the same sortable-field whitelist (falls back to name).
      const res = await api('products.page', {
        page,
        search: search || '',
        sortField: allowedFields.includes(activeSortFieldRaw) ? activeSortFieldRaw : 'name',
        sortAsc: activeSortAsc
      })
      if (sortField !== null) setProductsSortField(res.field)
      if (sortAsc !== null) setProductsSortAsc(activeSortAsc)
      setAdminTotalCount(res.total || 0)
      setAdminProducts(res.rows || [])
      setAdminPage(page)
    } catch (err) {
      console.error('fetchInventoryPage error:', err)
    }
  }

  const handleAddProduct = async (e) => {
    if (e) e.preventDefault()
    const {
      barcode,
      name,
      cost_price,
      retail_price,
      wholesale_price,
      stock_qty,
      reorder_limit,
      unit
    } = newProduct
    if (!barcode || !name) {
      triggerCustomAlert('يرجى ملء الباركود والاسم!')
      return
    }
    const cost = parseFloat(cost_price) || 0
    const retail = parseFloat(retail_price) || 0

    const saveProduct = async () => {
      try {
        await api('products.create', {
          barcode: String(barcode).trim(),
          name,
          cost_price: cost,
          retail_price: retail,
          wholesale_price: parseFloat(wholesale_price) || 0,
          stock_qty: parseFloat(stock_qty) || 0,
          reorder_limit: parseFloat(reorder_limit) || 0,
          unit: unit || ''
        })
        triggerCustomAlert('تمت إضافة المنتج بنجاح!')
        setShowAddModal(false)
        setNewProduct({
          barcode: '',
          name: '',
          cost_price: '',
          retail_price: '',
          wholesale_price: '',
          stock_qty: '',
          reorder_limit: '',
          unit: ''
        })
        if (fetchAdminData) await fetchAdminData()
      } catch (err) {
        triggerCustomAlert('فشل إضافة المنتج. ربما الباركود مكرر: ' + err.message)
      }
    }

    if (retail < cost) {
      triggerCustomConfirm(
        `⚠️ تحذير: سعر البيع (${retail?.toFixed(2)} ج.م) أقل من سعر التكلفة (${cost?.toFixed(2)} ج.م)، مما يعني حدوث خسارة في هذا المنتج!\n\nهل أنت متأكد من رغبتك في الحفظ مع ذلك؟`,
        saveProduct
      )
    } else {
      await saveProduct()
    }
  }

  const handleEditProduct = async (e) => {
    if (e) e.preventDefault()
    const {
      barcode,
      name,
      cost_price,
      retail_price,
      wholesale_price,
      stock_qty,
      stock_base,
      reorder_limit,
      unit
    } = editProduct
    if (!name) {
      triggerCustomAlert('يرجى ملء الاسم!')
      return
    }
    const cost = parseFloat(cost_price) || 0
    const retail = parseFloat(retail_price) || 0

    const saveProduct = async () => {
      try {
        await api('products.update', {
          barcode,
          name,
          cost_price: cost,
          retail_price: retail,
          wholesale_price: parseFloat(wholesale_price) || 0,
          stock_qty: parseFloat(stock_qty) || 0,
          // The stock shown when the form opened: the service applies only the difference, so
          // sales made meanwhile are kept (K-37).
          stock_base: stock_base === undefined || stock_base === null ? null : Number(stock_base),
          reorder_limit: parseFloat(reorder_limit) || 0,
          unit: unit || ''
        })
        if (setToastMessage) {
          setToastMessage('تم تحديث بيانات المنتج بنجاح!')
          setTimeout(() => setToastMessage(null), 2500)
        }
        setShowEditModal(false)
        if (fetchAdminData) await fetchAdminData()
      } catch (err) {
        triggerCustomAlert('فشل التحديث: ' + err.message)
      }
    }

    if (retail < cost) {
      triggerCustomConfirm(
        `⚠️ تحذير: سعر البيع (${retail?.toFixed(2)} ج.م) أقل من سعر التكلفة (${cost?.toFixed(2)} ج.م)، مما يعني حدوث خسارة في هذا المنتج!\n\nهل أنت متأكد من رغبتك في الحفظ مع ذلك؟`,
        saveProduct
      )
    } else {
      await saveProduct()
    }
  }

  const handleDeleteProduct = async (barcode) => {
    triggerCustomConfirm(
      'هل أنت متأكد من رغبتك في حذف هذا المنتج نهائياً من قاعدة البيانات؟',
      async () => {
        try {
          await api('products.delete', { barcode })
          triggerCustomAlert('تم حذف المنتج بنجاح!')
          if (fetchAdminData) await fetchAdminData()
        } catch (err) {
          // The service explains when the product is linked to past sales.
          triggerCustomAlert(err.status === 409 ? err.message : 'فشل الحذف: ' + err.message)
        }
      }
    )
  }

  return {
    adminProducts,
    setAdminProducts,
    adminTotalCount,
    setAdminTotalCount,
    adminPage,
    setAdminPage,
    adminSearch,
    setAdminSearch,
    showAddModal,
    setShowAddModal,
    showEditModal,
    setShowEditModal,
    newProduct,
    setNewProduct,
    editProduct,
    setEditProduct,
    productsSortField,
    productsSortAsc,
    itemsPerPage,
    fetchInventoryPage,
    handleAddProduct,
    handleEditProduct,
    handleDeleteProduct
  }
}
