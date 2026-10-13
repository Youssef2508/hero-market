import { executeQuery } from '../db'
import { escapeSql, getNowStr, hashPin } from '../utils'

/**
 * Find active open shift if exists.
 *
 * @returns {Promise<object|null>}
 */
export async function getActiveShift() {
  const activeShifts = await executeQuery(`
    SELECT s.*, u.username, u.role
    FROM shifts s
    JOIN users u ON s.user_id = u.id
    WHERE s.status = 'open'
    LIMIT 1;
  `)
  return activeShifts && activeShifts.length > 0 ? activeShifts[0] : null
}

/**
 * Get all closed shifts history with cashier info.
 *
 * @returns {Promise<object[]>}
 */
export async function getClosedShiftsHistory() {
  return await executeQuery(`
    SELECT s.*, u.username 
    FROM shifts s
    JOIN users u ON s.user_id = u.id
    WHERE s.status = 'closed'
    ORDER BY s.id DESC;
  `)
}

/**
 * Open a new shift.
 *
 * @param {object} params
 * @returns {Promise<object|null>}
 */
export async function openShift({
  userId,
  startingCash,
  momknStartBalance = 0,
  vfcashStartBalance = 0
}) {
  const nowStr = getNowStr()
  await executeQuery(`
    INSERT INTO shifts (user_id, start_time, initial_cash, expected_end_cash, actual_end_cash, status, momkn_start_balance, vfcash_start_balance)
    VALUES (${userId}, '${nowStr}', ${startingCash}, ${startingCash}, 0, 'open', ${momknStartBalance}, ${vfcashStartBalance});
  `)

  const latestShift = await executeQuery(`
    SELECT * FROM shifts WHERE user_id = ${userId} AND status = 'open' ORDER BY id DESC LIMIT 1;
  `)
  return latestShift && latestShift.length > 0 ? latestShift[0] : null
}

/**
 * Calculate expected cash drawer balance for a shift.
 * Formula: Initial + Cash Sales + Inflows (e.g. client repayments) - Outflows (e.g. supplier repayments)
 *
 * @param {number} shiftId
 * @param {number} initialCash
 * @returns {Promise<number>}
 */
export async function calculateExpectedShiftCash(shiftId, initialCash) {
  const salesRes = await executeQuery(`
    SELECT IFNULL(SUM(COALESCE(NULLIF(original_amount, 0) - discount, total_amount)), 0) as total 
    FROM sales 
    WHERE shift_id = ${shiftId} AND payment_type = 'نقدي';
  `)
  const repayRes = await executeQuery(`
    SELECT IFNULL(SUM(amount), 0) as total
    FROM safe_ledger
    WHERE shift_id = ${shiftId} AND type = 'inflow';
  `)
  const refundRes = await executeQuery(`
    SELECT IFNULL(SUM(amount), 0) as total
    FROM safe_ledger
    WHERE shift_id = ${shiftId} AND type = 'outflow';
  `)

  const salesTotal = parseFloat(salesRes[0]?.total) || 0
  const repayTotal = parseFloat(repayRes[0]?.total) || 0
  const refundTotal = parseFloat(refundRes[0]?.total) || 0

  return initialCash + salesTotal + repayTotal - refundTotal
}

/**
 * Close an active shift.
 *
 * @param {object} params
 * @returns {Promise<void>}
 */
export async function closeShift({ shiftId, expectedCash, actualCash, difference }) {
  const nowStr = getNowStr()
  await executeQuery(`
    UPDATE shifts 
    SET end_time = '${nowStr}', expected_end_cash = ${expectedCash}, actual_end_cash = ${actualCash}, difference = ${difference}, status = 'closed'
    WHERE id = ${shiftId};
  `)
}

/**
 * Authenticate user by PIN code.
 *
 * @param {string} pin
 * @returns {Promise<object|null>}
 */
export async function authenticateUser(pin) {
  const cleanPin = escapeSql(pin.trim())
  const hashedPin = await hashPin(pin.trim())
  const users = await executeQuery(
    `SELECT * FROM users WHERE (password_hash = '${escapeSql(hashedPin)}' OR password_hash = '${cleanPin}') LIMIT 1;`
  )
  return users && users.length > 0 ? users[0] : null
}

/**
 * Get users list.
 *
 * @returns {Promise<object[]>}
 */
export async function getUsersList() {
  return await executeQuery(
    'SELECT id, username, password_hash, role FROM users ORDER BY username ASC;'
  )
}

/**
 * Add a new user account.
 *
 * @param {object} user
 * @returns {Promise<void>}
 */
export async function addUser({ username, pin, role }) {
  await executeQuery(`
    INSERT INTO users (username, password_hash, role)
    VALUES ('${escapeSql(username)}', '${escapeSql(pin)}', '${escapeSql(role)}');
  `)
}

/**
 * Update an existing user.
 *
 * @param {object} user
 * @returns {Promise<void>}
 */
export async function updateUser({ id, username, pin, role }) {
  let query = `UPDATE users SET username = '${escapeSql(username)}', role = '${escapeSql(role)}'`
  if (pin && pin !== '••••') {
    query += `, password_hash = '${escapeSql(pin)}'`
  }
  query += ` WHERE id = ${id};`
  await executeQuery(query)
}

/**
 * Delete a user account.
 *
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteUser(id) {
  await executeQuery(`DELETE FROM users WHERE id = ${id};`)
}

/**
 * Check if a username is already taken.
 *
 * @param {string} username
 * @param {number|null} excludeId
 * @returns {Promise<boolean>}
 */
export async function checkDuplicateUser(username, excludeId = null) {
  const cleanUsername = escapeSql(username.trim())
  const query = excludeId
    ? `SELECT id FROM users WHERE username = '${cleanUsername}' AND id != ${excludeId} LIMIT 1;`
    : `SELECT id FROM users WHERE username = '${cleanUsername}' LIMIT 1;`
  const res = await executeQuery(query)
  return res && res.length > 0
}

/**
 * Check if a PIN is already taken.
 *
 * @param {string} pin
 * @param {number|null} excludeId
 * @returns {Promise<boolean>}
 */
export async function checkDuplicatePin(pin, excludeId = null) {
  const cleanPin = escapeSql(pin.trim())
  const excludeClause = excludeId ? ` AND id != ${excludeId}` : ''
  const query = `SELECT id FROM users WHERE password_hash = '${cleanPin}'${excludeClause} LIMIT 1;`
  const res = await executeQuery(query)
  return res && res.length > 0
}
