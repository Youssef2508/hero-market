import { useState } from 'react'
import { executeQuery } from '../lib/db'
import { escapeSql, getNowStr, getFriendlyErrorMessage, round2 } from '../lib/utils'

export function useSalesManager({
  currentShift,
  fetchAdminData,
  triggerCustomAlert,
  triggerCustomConfirm
}) {
  const [salesHistory, setSalesHistory] = useState([])
  const [salesSearch, setSalesSearch] = useState('')
  const [selectedSale, setSelectedSale] = useState(null)
  const [selectedSaleItems, setSelectedSaleItems] = useState([])
  const [salesSortField, setSalesSortField] = useState('id')
  const [salesSortAsc, setSalesSortAsc] = useState(false)
  const [salesPage, setSalesPage] = useState(1)
  const [salesTotalCount, setSalesTotalCount] = useState(0)
  const itemsPerPage = 12

  const fetchSalesHistory = async (search = '', sortField = null, sortAsc = null, page = 1) => {
    try {
      const activeSortField = sortField !== null ? sortField : salesSortField
      const activeSortAsc = sortAsc !== null ? sortAsc : salesSortAsc
      if (sortField !== null) setSalesSortField(sortField)
      if (sortAsc !== null) setSalesSortAsc(sortAsc)

      const offset = (page - 1) * itemsPerPage
      const escaped = escapeSql(search)
      let baseWhere = ''
      if (escaped) {
        const cleanEsc = escaped.replace('#', '').trim()
        const isNumeric = /^\d+$/.test(cleanEsc)
        if (isNumeric) {
          baseWhere = ` WHERE s.id = ${cleanEsc} OR ((s.id - 1) % 10000 + 1) = ${cleanEsc} OR s.client_name LIKE '%${escaped}%' OR s.timestamp LIKE '%${escaped}%'`
        } else {
          baseWhere = ` WHERE s.client_name LIKE '%${escaped}%' OR s.timestamp LIKE '%${escaped}%'`
        }
      }

      const countRes = await executeQuery(`
        SELECT COUNT(*) as count 
        FROM sales s
        JOIN shifts sh ON s.shift_id = sh.id
        JOIN users u ON sh.user_id = u.id
        ${baseWhere};
      `)
      const total = countRes?.[0]?.count || 0
      setSalesTotalCount(total)

      let query = `
        SELECT s.*, u.username, 
               (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) as items_count 
        FROM sales s
        JOIN shifts sh ON s.shift_id = sh.id
        JOIN users u ON sh.user_id = u.id
        ${baseWhere}
      `

      let orderField = 's.id'
      if (activeSortField === 'invoice_number') orderField = 's.id'
      else if (activeSortField === 'timestamp') orderField = 's.timestamp'
      else if (activeSortField === 'client_name') orderField = 's.client_name'
      else if (activeSortField === 'total_amount') orderField = 's.total_amount'
      else if (activeSortField === 'items_count') orderField = 'items_count'
      else if (activeSortField === 'payment_type') orderField = 's.payment_type'

      query += ` ORDER BY ${orderField} ${activeSortAsc ? 'ASC' : 'DESC'} LIMIT ${itemsPerPage} OFFSET ${offset};`
      const res = await executeQuery(query)
      setSalesHistory(res || [])
      setSalesPage(page)
    } catch (e) {
      console.error('Failed to fetch sales history:', e)
    }
  }

  const selectSaleForDetail = async (sale) => {
    try {
      const items = await executeQuery(`
        SELECT si.*, p.name 
        FROM sale_items si
        LEFT JOIN products p ON si.product_barcode = p.barcode
        WHERE si.sale_id = ${sale.id};
      `)
      setSelectedSale(sale)
      setSelectedSaleItems(items || [])
    } catch (e) {
      console.error('Failed to load sale details:', e)
    }
  }

  const handleReturnItem = async (saleItem, returnQty) => {
    const qtyToReturn = parseFloat(returnQty) || 0
    const alreadyReturned = saleItem.returned_qty || 0
    const maxReturnable = saleItem.quantity - alreadyReturned

    if (qtyToReturn <= 0 || qtyToReturn > maxReturnable) {
      triggerCustomAlert(
        `الرجاء إدخال كمية مرتجع صحيحة (أكبر من 0 ولا تزيد عن المتبقي: ${maxReturnable}).`
      )
      return
    }

    triggerCustomConfirm(
      `هل أنت متأكد من رغبتك في إرجاع كمية ${qtyToReturn} من الصنف "${saleItem.name || saleItem.product_barcode}"؟`,
      async () => {
        try {
          const freshSales = await executeQuery(
            `SELECT original_amount, total_amount, discount, payment_type, client_id, id, shift_id FROM sales WHERE id = ${saleItem.sale_id} LIMIT 1;`
          )
          const saleData = freshSales?.[0]
          if (!saleData) {
            triggerCustomAlert('لم يتم العثور على الفاتورة!')
            return
          }

          const originalAmt =
            parseFloat(saleData.original_amount) ||
            parseFloat(saleData.total_amount) + parseFloat(saleData.discount) ||
            1
          const currentDiscount = parseFloat(saleData.discount) || 0
          const discountRatio =
            currentDiscount > 0 && originalAmt > 0 ? currentDiscount / originalAmt : 0
          const grossRefund = qtyToReturn * saleItem.unit_price
          const discountShare = round2(grossRefund * discountRatio)
          const netRefund = round2(grossRefund - discountShare)

          let sql = 'BEGIN TRANSACTION;\n'
          sql += `UPDATE products SET stock_qty = stock_qty + ${qtyToReturn} WHERE barcode = '${escapeSql(saleItem.product_barcode)}';\n`

          // Update returned quantity and recalculate total_price for this item
          const newReturnedQty = alreadyReturned + qtyToReturn
          const newTotalPrice = (saleItem.quantity - newReturnedQty) * saleItem.unit_price
          sql += `UPDATE sale_items SET returned_qty = ${newReturnedQty}, total_price = ${newTotalPrice} WHERE id = ${saleItem.id};\n`

          // Update sales discount and total_amount
          sql += `UPDATE sales SET discount = MAX(0, discount - ${discountShare}), total_amount = MAX(0, (SELECT IFNULL(SUM(total_price), 0) FROM sale_items WHERE sale_id = ${saleItem.sale_id}) - MAX(0, discount - ${discountShare})) WHERE id = ${saleItem.sale_id};\n`

          const shiftId =
            currentShift && currentShift.id ? currentShift.id : saleData.shift_id || 'NULL'
          const nowStr = getNowStr()

          if (saleData.payment_type === 'آجل' && saleData.client_id) {
            sql += `UPDATE clients SET debt_balance = debt_balance - ${netRefund} WHERE id = ${saleData.client_id};\n`
            sql += `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES (${saleData.client_id}, 'payment', ${netRefund}, 'إرجاع صنف من فاتورة آجل #${saleData.id}', '${nowStr}');\n`
          } else {
            sql += `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (${shiftId}, 'outflow', ${netRefund}, 'مرتجع صنف ${escapeSql(saleItem.name || saleItem.product_barcode)} (${qtyToReturn}) للفاتورة #${saleItem.sale_id}', '${nowStr}');\n`
          }

          sql += 'COMMIT;\n'

          await executeQuery(sql)
          triggerCustomAlert('تم إرجاع الصنف وتحديث المخزن بنجاح!')

          if (fetchAdminData) await fetchAdminData()

          // Reload details to show updated item returned status
          const details = await executeQuery(`
          SELECT s.*, u.username 
          FROM sales s
          JOIN shifts sh ON s.shift_id = sh.id
          JOIN users u ON sh.user_id = u.id
          WHERE s.id = ${saleItem.sale_id} LIMIT 1;
        `)
          if (details.length > 0) {
            await selectSaleForDetail(details[0])
          }
        } catch (e) {
          triggerCustomAlert('فشلت عملية الإرجاع: ' + getFriendlyErrorMessage(e))
        }
      }
    )
  }

  const handleReturnEntireSale = async (saleId) => {
    triggerCustomConfirm(
      'هل أنت متأكد من رغبتك في إلغاء وإرجاع الفاتورة بالكامل؟ سيتم إعادة جميع الكميات إلى المخزن وتصفير قيمتها المتبقية.',
      async () => {
        try {
          const items = await executeQuery(`SELECT * FROM sale_items WHERE sale_id = ${saleId};`)
          const freshSale = await executeQuery(
            `SELECT total_amount, payment_type, client_id, shift_id FROM sales WHERE id = ${saleId} LIMIT 1;`
          )
          const saleData = freshSale?.[0]
          if (!saleData) {
            triggerCustomAlert('لم يتم العثور على الفاتورة!')
            return
          }

          let sql = 'BEGIN TRANSACTION;\n'
          items.forEach((item) => {
            const remainingQty = item.quantity - (item.returned_qty || 0)
            if (remainingQty > 0) {
              sql += `UPDATE products SET stock_qty = stock_qty + ${remainingQty} WHERE barcode = '${escapeSql(item.product_barcode)}';\n`
            }
          })

          sql += `UPDATE sale_items SET returned_qty = quantity, total_price = 0 WHERE sale_id = ${saleId};\n`
          sql += `UPDATE sales SET total_amount = 0, discount = 0 WHERE id = ${saleId};\n`

          const shiftId =
            currentShift && currentShift.id ? currentShift.id : saleData.shift_id || 'NULL'
          const refundAmount = saleData.total_amount || 0
          const nowStr = getNowStr()

          if (saleData.payment_type === 'آجل' && saleData.client_id) {
            sql += `UPDATE clients SET debt_balance = debt_balance - ${refundAmount} WHERE id = ${saleData.client_id};\n`
            sql += `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES (${saleData.client_id}, 'payment', ${refundAmount}, 'إرجاع كامل فاتورة آجل #${saleId}', '${nowStr}');\n`
          } else {
            sql += `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (${shiftId}, 'outflow', ${refundAmount}, 'مرتجع كامل الفاتورة #${saleId}', '${nowStr}');\n`
          }

          sql += 'COMMIT;\n'

          await executeQuery(sql)
          triggerCustomAlert('تم إلغاء الفاتورة بالكامل وإرجاع كافة الأصناف للمخزن!')

          if (fetchAdminData) await fetchAdminData()

          const details = await executeQuery(`
          SELECT s.*, u.username
          FROM sales s
          JOIN shifts sh ON s.shift_id = sh.id
          JOIN users u ON sh.user_id = u.id
          WHERE s.id = ${saleId} LIMIT 1;
        `)
          if (details.length > 0) {
            await selectSaleForDetail(details[0])
          }
        } catch (e) {
          triggerCustomAlert('فشل إرجاع الفاتورة بالكامل: ' + getFriendlyErrorMessage(e))
        }
      }
    )
  }

  return {
    salesHistory,
    setSalesHistory,
    salesSearch,
    setSalesSearch,
    selectedSale,
    setSelectedSale,
    selectedSaleItems,
    setSelectedSaleItems,
    salesSortField,
    salesSortAsc,
    fetchSalesHistory,
    selectSaleForDetail,
    handleReturnItem,
    handleReturnEntireSale,
    salesPage,
    salesTotalCount,
    itemsPerPage
  }
}
