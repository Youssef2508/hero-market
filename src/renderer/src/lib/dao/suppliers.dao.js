import { executeQuery } from '../db'
import { escapeSql, getNowStr } from '../utils'

/**
 * Get suppliers list, optionally filtered by name/phone.
 *
 * @param {string} search
 * @returns {Promise<object[]>}
 */
export async function getSuppliers(search = '') {
  const cleanSearch = escapeSql(search.trim())
  const where = cleanSearch
    ? `WHERE name LIKE '%${cleanSearch}%' OR phone LIKE '%${cleanSearch}%'`
    : ''
  return await executeQuery(`SELECT * FROM suppliers ${where} ORDER BY name ASC;`)
}

/**
 * Get supplier ledger and purchases records.
 *
 * @param {number} supplierId
 * @returns {Promise<object>}
 */
export async function getSupplierProfile(supplierId) {
  const [ledger, purchases] = await Promise.all([
    executeQuery(
      `SELECT * FROM supplier_ledger WHERE supplier_id = ${supplierId} ORDER BY id DESC LIMIT 50;`
    ),
    executeQuery(
      `SELECT * FROM supplier_purchases WHERE supplier_id = ${supplierId} ORDER BY id DESC;`
    )
  ])
  return {
    ledger: ledger || [],
    purchases: purchases || []
  }
}

/**
 * Add a new supplier.
 *
 * @param {object} supplier
 * @returns {Promise<void>}
 */
export async function addSupplier({ name, phone, address, contact_person }) {
  const nowStr = getNowStr()
  await executeQuery(`
    INSERT INTO suppliers (name, phone, address, contact_person, debt_balance, created_at)
    VALUES ('${escapeSql(name)}', '${escapeSql(phone)}', '${escapeSql(address)}', '${escapeSql(contact_person)}', 0.0, '${nowStr}');
  `)
}

/**
 * Record a purchase invoice from a supplier in a single database transaction.
 *
 * @param {object} purchase
 * @returns {Promise<void>}
 */
export async function addSupplierPurchase({
  supplierId,
  supplierName,
  invoice_ref,
  total,
  paid,
  payment_type,
  notes,
  shiftId
}) {
  const nowStr = getNowStr()
  const remaining = total - paid
  const cleanShiftId = shiftId && shiftId !== 'NULL' ? shiftId : 'NULL'

  let sql = 'BEGIN TRANSACTION;\n'
  sql += `INSERT INTO supplier_purchases (supplier_id, invoice_ref, total_amount, paid_amount, remaining, payment_type, timestamp, notes)
          VALUES (${supplierId}, '${escapeSql(invoice_ref)}', ${total}, ${paid}, ${remaining}, '${escapeSql(payment_type)}', '${nowStr}', '${escapeSql(notes)}');\n`

  if (remaining > 0) {
    sql += `UPDATE suppliers SET debt_balance = debt_balance + ${remaining} WHERE id = ${supplierId};\n`
    sql += `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES (${supplierId}, 'purchase', ${remaining}, 'فاتورة شراء #${escapeSql(invoice_ref)} - متبقي آجل', '${nowStr}');\n`
  }

  if (paid > 0 && cleanShiftId !== 'NULL') {
    sql += `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (${cleanShiftId}, 'outflow', ${paid}, 'دفعة لمورد: ${escapeSql(supplierName)} - فاتورة #${escapeSql(invoice_ref)}', '${nowStr}');\n`
  }

  sql += 'COMMIT;\n'
  await executeQuery(sql)
}

/**
 * Record a payment repayment to a supplier.
 *
 * @param {object} repay
 * @returns {Promise<void>}
 */
export async function recordSupplierRepay({ supplierId, supplierName, amount, shiftId }) {
  const nowStr = getNowStr()
  const cleanShiftId = shiftId && shiftId !== 'NULL' ? shiftId : 'NULL'

  let sql = 'BEGIN TRANSACTION;\n'
  sql += `UPDATE suppliers SET debt_balance = debt_balance - ${amount} WHERE id = ${supplierId};\n`
  sql += `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES (${supplierId}, 'payment', ${amount}, 'دفعة سداد للمورد', '${nowStr}');\n`

  if (cleanShiftId !== 'NULL') {
    sql += `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (${cleanShiftId}, 'outflow', ${amount}, 'سداد دين مورد: ${escapeSql(supplierName)}', '${nowStr}');\n`
  }

  sql += 'COMMIT;\n'
  await executeQuery(sql)
}

/**
 * Delete a supplier and their associated records.
 *
 * @param {number} supplierId
 * @returns {Promise<void>}
 */
export async function deleteSupplier(supplierId) {
  await executeQuery(`DELETE FROM supplier_ledger WHERE supplier_id = ${supplierId};`)
  await executeQuery(`DELETE FROM supplier_purchases WHERE supplier_id = ${supplierId};`)
  await executeQuery(`DELETE FROM suppliers WHERE id = ${supplierId};`)
}

/**
 * Get supplier by ID.
 *
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getSupplierById(id) {
  const res = await executeQuery(`SELECT * FROM suppliers WHERE id = ${id} LIMIT 1;`)
  return res && res.length > 0 ? res[0] : null
}
