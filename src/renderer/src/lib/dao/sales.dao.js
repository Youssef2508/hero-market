import { executeQuery } from '../db'
import { escapeSql, getNowStr } from '../utils'

/**
 * Get sales history list, filtered optionally by invoice number, client name, or date.
 *
 * @param {string} search
 * @returns {Promise<object[]>}
 */
export async function getSalesHistory(search = '', limit = 100, offset = 0) {
  const escaped = escapeSql(search.trim())
  let query = `
    SELECT s.*, u.username, 
           (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) as items_count 
    FROM sales s
    JOIN shifts sh ON s.shift_id = sh.id
    JOIN users u ON sh.user_id = u.id
  `
  if (escaped) {
    const cleanEsc = escaped.replace('#', '').trim()
    const isNumeric = /^\d+$/.test(cleanEsc)
    if (isNumeric) {
      query += ` WHERE s.id = ${cleanEsc} OR ((s.id - 1) % 10000 + 1) = ${cleanEsc} OR s.client_name LIKE '%${escaped}%' OR s.timestamp LIKE '%${escaped}%'`
    } else {
      query += ` WHERE s.client_name LIKE '%${escaped}%' OR s.timestamp LIKE '%${escaped}%'`
    }
  }
  query += ` ORDER BY s.id DESC LIMIT ${limit} OFFSET ${offset};`
  return await executeQuery(query)
}

/**
 * Get a single sale's details and all its line items.
 *
 * @param {number} saleId
 * @returns {Promise<object|null>}
 */
export async function getSaleWithItems(saleId) {
  const details = await executeQuery(`
    SELECT s.*, u.username 
    FROM sales s
    JOIN shifts sh ON s.shift_id = sh.id
    JOIN users u ON sh.user_id = u.id
    WHERE s.id = ${saleId} LIMIT 1;
  `)
  if (!details || details.length === 0) return null

  const items = await executeQuery(`
    SELECT si.*, p.name 
    FROM sale_items si
    LEFT JOIN products p ON si.product_barcode = p.barcode
    WHERE si.sale_id = ${saleId};
  `)

  return {
    sale: details[0],
    items: items || []
  }
}

/**
 * Return a single quantity from a sale line item.
 * Updates stock levels, reduces sale total amount, and logs a safe refund outflow.
 *
 * @param {object} params
 * @param {object} params.saleItem
 * @param {number} params.qtyToReturn
 * @param {number|string} params.shiftId
 * @returns {Promise<void>}
 */
export async function returnSaleItem({ saleItem, qtyToReturn, shiftId }) {
  const refundAmount = qtyToReturn * saleItem.unit_price
  const nowStr = getNowStr()
  const cleanShiftId = shiftId && shiftId !== 'NULL' ? shiftId : 'NULL'

  // Fetch parent sale info to check if it was a credit sale
  const saleRes = await executeQuery(
    `SELECT payment_type, client_id FROM sales WHERE id = ${saleItem.sale_id};`
  )
  const isCredit = saleRes?.[0]?.payment_type === 'آجل'
  const clientId = saleRes?.[0]?.client_id

  let sql = 'BEGIN TRANSACTION;\n'
  sql += `UPDATE products SET stock_qty = stock_qty + ${qtyToReturn} WHERE barcode = '${escapeSql(saleItem.product_barcode)}';\n`

  if (qtyToReturn === saleItem.quantity) {
    sql += `DELETE FROM sale_items WHERE id = ${saleItem.id};\n`
  } else {
    sql += `UPDATE sale_items SET quantity = quantity - ${qtyToReturn}, total_price = total_price - (${qtyToReturn} * unit_price) WHERE id = ${saleItem.id};\n`
  }

  sql += `UPDATE sales SET total_amount = (SELECT IFNULL(SUM(total_price), 0) FROM sale_items WHERE sale_id = ${saleItem.sale_id}) - discount WHERE id = ${saleItem.sale_id};\n`

  if (isCredit && clientId) {
    sql += `UPDATE clients SET debt_balance = debt_balance - ${refundAmount} WHERE id = ${clientId};\n`
    sql += `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES (${clientId}, 'payment', ${refundAmount}, 'إرجاع صنف من فاتورة آجل #${saleItem.sale_id}', '${nowStr}');\n`
  } else {
    sql += `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (${cleanShiftId}, 'outflow', ${refundAmount}, 'مرتجع صنف ${escapeSql(saleItem.name || saleItem.product_barcode)} (${qtyToReturn}) للفاتورة #${saleItem.sale_id}', '${nowStr}');\n`
  }

  sql += 'COMMIT;\n'

  await executeQuery(sql)
}

/**
 * Return an entire sale (void invoice).
 * Restores all item quantities, sets invoice totals to 0, and logs safe refund outflow.
 *
 * @param {object} params
 * @param {number} params.saleId
 * @param {number} params.refundAmount
 * @param {number|string} params.shiftId
 * @returns {Promise<void>}
 */
export async function returnEntireSale({ saleId, refundAmount, shiftId }) {
  const items = await executeQuery(`SELECT * FROM sale_items WHERE sale_id = ${saleId};`)
  const nowStr = getNowStr()
  const cleanShiftId = shiftId && shiftId !== 'NULL' ? shiftId : 'NULL'

  // Fetch parent sale info to check if it was a credit sale
  const saleRes = await executeQuery(
    `SELECT payment_type, client_id FROM sales WHERE id = ${saleId};`
  )
  const isCredit = saleRes?.[0]?.payment_type === 'آجل'
  const clientId = saleRes?.[0]?.client_id

  let sql = 'BEGIN TRANSACTION;\n'
  items.forEach((item) => {
    const remainingQty = item.quantity - (item.returned_qty || 0)
    if (remainingQty > 0) {
      sql += `UPDATE products SET stock_qty = stock_qty + ${remainingQty} WHERE barcode = '${escapeSql(item.product_barcode)}';\n`
    }
  })
  sql += `UPDATE sale_items SET returned_qty = quantity, total_price = 0 WHERE sale_id = ${saleId};\n`
  sql += `UPDATE sales SET total_amount = 0, discount = 0 WHERE id = ${saleId};\n`

  if (isCredit && clientId) {
    sql += `UPDATE clients SET debt_balance = debt_balance - ${refundAmount} WHERE id = ${clientId};\n`
    sql += `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES (${clientId}, 'payment', ${refundAmount}, 'إرجاع كامل فاتورة آجل #${saleId}', '${nowStr}');\n`
  } else {
    sql += `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (${cleanShiftId}, 'outflow', ${refundAmount}, 'مرتجع كامل الفاتورة #${saleId}', '${nowStr}');\n`
  }

  sql += 'COMMIT;\n'

  await executeQuery(sql)
}

/**
 * Commit a complete new sale invoice to the database.
 * Deducts stock level for all cart items, inserts invoice and line items, logs safe inflow if cash,
 * and updates client points/balance if credit/debt.
 *
 * @param {object} saleParams
 * @returns {Promise<number>} Returns the newly generated invoice ID.
 */
export async function createSaleTransaction({
  shiftId,
  cart,
  cartTotal,
  discount,
  paymentType,
  clientName,
  clientId
}) {
  const nowStr = getNowStr()
  const clientDbValue = clientName || 'عميل نقدي'
  const finalDiscount = parseFloat(discount) || 0

  let sqlQuery = 'BEGIN TRANSACTION;\n'

  // Deduct stock for all items
  cart.forEach((item) => {
    sqlQuery += `UPDATE products SET stock_qty = stock_qty - ${item.qty} WHERE barcode = '${escapeSql(item.barcode)}';\n`
  })

  // Insert sales invoice
  sqlQuery += `INSERT INTO sales (shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id) 
               VALUES (${shiftId}, '${nowStr}', ${cartTotal}, ${finalDiscount}, '${escapeSql(paymentType)}', '${escapeSql(clientDbValue)}', ${clientId || 'NULL'});\n`

  // Insert line items
  cart.forEach((item) => {
    sqlQuery += `INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, cost_price) 
                 VALUES ((SELECT MAX(id) FROM sales LIMIT 1), '${escapeSql(item.barcode)}', ${item.qty}, ${item.price}, ${item.total}, ${item.cost_price || 0.0});\n`
  })

  // If debt/points/payment update for clients
  if (clientId) {
    const pointsEarned = Math.floor(cartTotal / 100)
    sqlQuery += `UPDATE clients SET points = points + ${pointsEarned} WHERE id = ${clientId};\n`
    if (paymentType === 'آجل') {
      sqlQuery += `UPDATE clients SET debt_balance = debt_balance + ${cartTotal} WHERE id = ${clientId};\n`
      sqlQuery += `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) 
                   VALUES (${clientId}, 'sale', ${cartTotal}, 'فاتورة مبيعات آجل #' || (SELECT MAX(id) FROM sales LIMIT 1), '${nowStr}');\n`
    }
  }

  sqlQuery += 'COMMIT;\n'
  await executeQuery(sqlQuery)

  // Fetch and return the newly inserted sale ID
  const saleResult = await executeQuery(`SELECT id FROM sales ORDER BY id DESC LIMIT 1;`)
  return saleResult?.[0]?.id || null
}
