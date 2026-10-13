import { executeQuery } from '../db'
import { escapeSql, getNowStr } from '../utils'

/**
 * Get clients list, optionally filtered by search input (name or phone).
 *
 * @param {string} search
 * @returns {Promise<object[]>}
 */
export async function getClients(search = '') {
  const cleanSearch = escapeSql(search.trim())
  const query = cleanSearch
    ? `SELECT * FROM clients WHERE name LIKE '%${cleanSearch}%' OR phone LIKE '%${cleanSearch}%' ORDER BY name ASC;`
    : `SELECT * FROM clients ORDER BY name ASC;`
  return await executeQuery(query)
}

/**
 * Get client stats: customer with highest points, and best customer of the current month based on sales.
 *
 * @returns {Promise<object>}
 */
export async function getClientStats() {
  const pointsRes = await executeQuery(
    `SELECT * FROM clients WHERE points > 0 ORDER BY points DESC LIMIT 1;`
  )
  const highestPointsCustomer = pointsRes?.[0] || null

  const sales = await executeQuery(
    `SELECT s.total_amount, s.client_id, s.timestamp FROM sales s WHERE s.client_id IS NOT NULL;`
  )
  let bestCustomerOfMonth = null

  if (sales.length > 0) {
    const clientTotals = {}
    const currentMonth = new Date().getMonth() + 1
    const currentYear = new Date().getFullYear()

    sales.forEach((sale) => {
      const dateStr = sale.timestamp
      if (!dateStr) return
      // Normalize Arabic-Indic digits to English digits
      const cleanDate = dateStr.replace(
        /[\u0660-\u0669]/g,
        (d) => '0123456789'[d.charCodeAt(0) - 1632]
      )
      const matches = cleanDate.match(/(\d+)\/(\d+)\/(\d+)/)
      if (matches) {
        const m = parseInt(matches[2], 10)
        const y = parseInt(matches[3], 10)
        if (m === currentMonth && y === currentYear) {
          const cid = sale.client_id
          clientTotals[cid] = (clientTotals[cid] || 0) + sale.total_amount
        }
      }
    })

    let bestClientId = null
    let maxSpent = 0
    Object.keys(clientTotals).forEach((cid) => {
      if (clientTotals[cid] > maxSpent) {
        maxSpent = clientTotals[cid]
        bestClientId = cid
      }
    })

    if (bestClientId) {
      const clientDetails = await executeQuery(
        `SELECT * FROM clients WHERE id = ${bestClientId} LIMIT 1;`
      )
      if (clientDetails.length > 0) {
        bestCustomerOfMonth = {
          ...clientDetails[0],
          monthlySpent: maxSpent
        }
      }
    }
  }

  return {
    highestPointsCustomer,
    bestCustomerOfMonth
  }
}

/**
 * Get a client's profile details: purchase history and ledger records.
 *
 * @param {number} clientId
 * @returns {Promise<object>}
 */
export async function getClientProfile(clientId) {
  const purchases = await executeQuery(`
    SELECT s.*, u.username, 
           (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) as items_count 
    FROM sales s
    JOIN shifts sh ON s.shift_id = sh.id
    JOIN users u ON sh.user_id = u.id
    WHERE s.client_id = ${clientId}
    ORDER BY s.id DESC;
  `)

  const ledger = await executeQuery(`
    SELECT * FROM client_ledger 
    WHERE client_id = ${clientId} 
    ORDER BY id DESC;
  `)

  return {
    purchases: purchases || [],
    ledger: ledger || []
  }
}

/**
 * Check if a phone number is already registered for another client.
 *
 * @param {string} phone
 * @param {number|null} excludeId
 * @returns {Promise<boolean>}
 */
export async function checkDuplicatePhone(phone, excludeId = null) {
  if (!phone) return false
  const cleanPhone = escapeSql(phone.trim())
  const query = excludeId
    ? `SELECT id FROM clients WHERE phone = '${cleanPhone}' AND id != ${excludeId} LIMIT 1;`
    : `SELECT id FROM clients WHERE phone = '${cleanPhone}' LIMIT 1;`
  const res = await executeQuery(query)
  return res && res.length > 0
}

/**
 * Add a new client.
 *
 * @param {object} client
 * @returns {Promise<void>}
 */
export async function addClient({ name, phone, address }) {
  const nowStr = getNowStr()
  const phoneVal = phone && phone.trim() ? `'${escapeSql(phone.trim())}'` : 'NULL'
  await executeQuery(`
    INSERT INTO clients (name, phone, address, debt_balance, points, created_at)
    VALUES ('${escapeSql(name)}', ${phoneVal}, '${escapeSql(address)}', 0.0, 0, '${nowStr}');
  `)
}

/**
 * Update an existing client's details.
 *
 * @param {object} client
 * @returns {Promise<void>}
 */
export async function updateClient({ id, name, phone, address }) {
  const phoneVal = phone && phone.trim() ? `'${escapeSql(phone.trim())}'` : 'NULL'
  await executeQuery(`
    UPDATE clients 
    SET name = '${escapeSql(name)}', 
        phone = ${phoneVal}, 
        address = '${escapeSql(address)}'
    WHERE id = ${id};
  `)
}

/**
 * Delete a client and their ledger history.
 *
 * @param {number} clientId
 * @returns {Promise<void>}
 */
export async function deleteClient(clientId) {
  await executeQuery(`DELETE FROM client_ledger WHERE client_id = ${clientId};`)
  await executeQuery(`UPDATE sales SET client_id = NULL WHERE client_id = ${clientId};`)
  await executeQuery(`DELETE FROM clients WHERE id = ${clientId};`)
}

/**
 * Record a client repayment in a single database transaction.
 *
 * @param {object} repayment
 * @param {number} repayment.clientId
 * @param {string} repayment.clientName
 * @param {number} repayment.amount
 * @param {number|string} repayment.shiftId
 * @returns {Promise<void>}
 */
export async function recordClientRepayment({ clientId, clientName, amount, shiftId }) {
  const nowStr = getNowStr()
  const cleanShiftId = shiftId && shiftId !== 'NULL' ? shiftId : 'NULL'

  let sql = 'BEGIN TRANSACTION;\n'
  sql += `UPDATE clients SET debt_balance = debt_balance - ${amount} WHERE id = ${clientId};\n`
  sql += `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES (${clientId}, 'payment', ${amount}, 'سداد نقدي من العميل', '${nowStr}');\n`
  sql += `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (${cleanShiftId}, 'inflow', ${amount}, 'سداد دين العميل: ${escapeSql(clientName)}', '${nowStr}');\n`
  sql += 'COMMIT;\n'

  await executeQuery(sql)
}

/**
 * Get client by ID.
 *
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getClientById(id) {
  const res = await executeQuery(`SELECT * FROM clients WHERE id = ${id} LIMIT 1;`)
  return res && res.length > 0 ? res[0] : null
}
