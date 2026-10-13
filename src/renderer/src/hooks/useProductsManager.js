import { useState } from 'react'
import { executeQuery } from '../lib/db'
import { escapeSql, getFriendlyErrorMessage } from '../lib/utils'

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
      const activeSortField = allowedFields.includes(activeSortFieldRaw)
        ? activeSortFieldRaw
        : 'name'

      if (sortField !== null) setProductsSortField(activeSortField)
      if (sortAsc !== null) setProductsSortAsc(activeSortAsc)

      const offset = (page - 1) * itemsPerPage
      const escapedSearch = escapeSql(search)
      const whereClause = escapedSearch
        ? `WHERE barcode LIKE '%${escapedSearch}%' OR name LIKE '%${escapedSearch}%'`
        : ''

      const countRes = await executeQuery(`SELECT count(*) as count FROM products ${whereClause};`)
      const total = countRes?.[0]?.count || 0
      setAdminTotalCount(total)

      const products = await executeQuery(`
        SELECT * FROM products 
        ${whereClause} 
        ORDER BY ${activeSortField} ${activeSortAsc ? 'ASC' : 'DESC'} 
        LIMIT ${itemsPerPage} OFFSET ${offset};
      `)
      setAdminProducts(products || [])
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
        await executeQuery(`
          INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, reorder_limit, unit)
          VALUES ('${escapeSql(barcode)}', '${escapeSql(name)}', ${cost}, ${retail}, ${parseFloat(wholesale_price) || 0}, ${parseFloat(stock_qty) || 0}, ${parseFloat(reorder_limit) || 0}, '${escapeSql(unit) || ''}');
        `)
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
        triggerCustomAlert('فشل إضافة المنتج. ربما الباركود مكرر: ' + getFriendlyErrorMessage(err))
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
        await executeQuery(`
          UPDATE products 
          SET name = '${escapeSql(name)}', 
              cost_price = ${cost}, 
              retail_price = ${retail}, 
              wholesale_price = ${parseFloat(wholesale_price) || 0}, 
              stock_qty = ${parseFloat(stock_qty) || 0}, 
              reorder_limit = ${parseFloat(reorder_limit) || 0}, 
              unit = '${escapeSql(unit) || ''}'
          WHERE barcode = '${escapeSql(barcode)}';
        `)
        if (setToastMessage) {
          setToastMessage('تم تحديث بيانات المنتج بنجاح!')
          setTimeout(() => setToastMessage(null), 2500)
        }
        setShowEditModal(false)
        if (fetchAdminData) await fetchAdminData()
      } catch (err) {
        triggerCustomAlert('فشل التحديث: ' + getFriendlyErrorMessage(err))
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
          await executeQuery(`DELETE FROM products WHERE barcode = '${escapeSql(barcode)}';`)
          triggerCustomAlert('تم حذف المنتج بنجاح!')
          if (fetchAdminData) await fetchAdminData()
        } catch (err) {
          if (err.message && err.message.includes('FOREIGN KEY')) {
            triggerCustomAlert(
              'لا يمكن حذف هذا المنتج لأنه مرتبط بمبيعات أو فواتير سابقة في الداتا بيس.\nيمكنك بدلاً من حذفه تعديل كميته المتاحة إلى صفر.'
            )
          } else {
            triggerCustomAlert('فشل الحذف: ' + getFriendlyErrorMessage(err))
          }
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
