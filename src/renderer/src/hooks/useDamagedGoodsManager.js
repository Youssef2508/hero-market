import { useState } from 'react'
import { executeQuery } from '../lib/db'
import { escapeSql, getNowStr, getFriendlyErrorMessage } from '../lib/utils'

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
      const res = await executeQuery(`
        SELECT dg.*, p.name as product_name, p.unit 
        FROM damaged_goods dg 
        JOIN products p ON dg.product_barcode = p.barcode 
        ORDER BY dg.id DESC;
      `)
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
      // 1. Verify product exists and check stock
      const prodRes = await executeQuery(`
        SELECT name, stock_qty, cost_price FROM products WHERE barcode = '${escapeSql(trimmedBarcode)}';
      `)
      if (!prodRes || prodRes.length === 0) {
        triggerCustomAlert('لم يتم العثور على هذا المنتج في المخزن!')
        return
      }

      const product = prodRes[0]
      if (product.stock_qty < qtyVal) {
        triggerCustomAlert(
          `الكمية التالفة المدخلة (${qtyVal}) أكبر من المخزون المتوفر حالياً (${product.stock_qty})!`
        )
        return
      }

      const shiftId = currentShift ? currentShift.id : 'NULL'
      const nowStr = getNowStr()
      const costVal = product.cost_price || 0

      // We will perform updates inside a transaction
      let sql = 'BEGIN TRANSACTION;\n'

      // Deduct from products table
      sql += `UPDATE products SET stock_qty = stock_qty - ${qtyVal} WHERE barcode = '${escapeSql(trimmedBarcode)}';\n`

      // Insert into damaged_goods table
      sql += `INSERT INTO damaged_goods (shift_id, product_barcode, quantity, reason, cost_price, timestamp) 
              VALUES (${shiftId}, '${escapeSql(trimmedBarcode)}', ${qtyVal}, '${escapeSql(newDamagedForm.reason)}', ${costVal}, '${nowStr}');\n`

      sql += 'COMMIT;\n'

      await executeQuery(sql)
      setShowAddDamagedModal(false)
      setNewDamagedForm({ barcode: '', quantity: '', reason: 'انتهاء صلاحية' })

      await fetchDamagedGoods()
      if (fetchAdminData) await fetchAdminData()
      triggerCustomAlert('تم تسجيل الهالك بنجاح وخصم الكمية من المخزن وتأثيرها المالي من الأرباح!')
    } catch (err) {
      triggerCustomAlert('فشل تسجيل التالف: ' + getFriendlyErrorMessage(err))
    }
  }

  const handleDeleteDamaged = async (item) => {
    triggerCustomConfirm(
      'هل أنت متأكد من حذف هذا السجل وإعادة الكمية التالفة إلى المخزن؟',
      async () => {
        try {
          let sql = 'BEGIN TRANSACTION;\n'

          // Return quantity to product stock
          sql += `UPDATE products SET stock_qty = stock_qty + ${item.quantity} WHERE barcode = '${escapeSql(item.product_barcode)}';\n`

          // Delete record from damaged_goods
          sql += `DELETE FROM damaged_goods WHERE id = ${item.id};\n`

          sql += 'COMMIT;\n'

          await executeQuery(sql)
          await fetchDamagedGoods()
          if (fetchAdminData) await fetchAdminData()
          triggerCustomAlert('تم إلغاء سجل الهالك وإرجاع الكمية إلى المخزن بنجاح!')
        } catch (err) {
          triggerCustomAlert('فشل حذف سجل الهالك: ' + getFriendlyErrorMessage(err))
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
