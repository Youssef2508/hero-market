import { executeQuery } from '../db'
import { escapeSql, getNowStr } from '../utils'

/**
 * Get all checks ordered by due date.
 *
 * @returns {Promise<object[]>}
 */
export async function getChecks() {
  return await executeQuery(`SELECT * FROM checks_register ORDER BY due_date ASC;`)
}

/**
 * Get all unpaid checks due today.
 *
 * @returns {Promise<object[]>}
 */
export async function getChecksDueToday() {
  const todayISO = new Date().toISOString().split('T')[0]
  const todayDay = new Date().getDate()
  return await executeQuery(`
    SELECT * FROM checks_register
    WHERE status = 'غير مسدد'
      AND (due_date = '${todayISO}' OR due_date LIKE '%${todayDay}%')
    ORDER BY due_date ASC;
  `)
}

/**
 * Add a new check to the registry.
 *
 * @param {object} check
 * @returns {Promise<void>}
 */
export async function addCheck({
  check_type,
  check_number,
  bank_name,
  party_name,
  issue_date,
  due_date,
  amount,
  notes
}) {
  const nowStr = getNowStr()
  await executeQuery(`
    INSERT INTO checks_register (check_type, check_number, bank_name, party_name, issue_date, due_date, amount, status, notes, created_at)
    VALUES (
      '${escapeSql(check_type)}', 
      '${escapeSql(check_number)}',
      '${escapeSql(bank_name)}', 
      '${escapeSql(party_name)}',
      '${escapeSql(issue_date)}', 
      '${escapeSql(due_date)}',
      ${parseFloat(amount) || 0}, 
      'غير مسدد', 
      '${escapeSql(notes)}', 
      '${nowStr}'
    );
  `)
}

/**
 * Mark a check as paid.
 *
 * @param {number} checkId
 * @returns {Promise<void>}
 */
export async function markCheckPaid(checkId) {
  await executeQuery(`UPDATE checks_register SET status = 'مسدد' WHERE id = ${checkId};`)
}

/**
 * Delete a check from registry.
 *
 * @param {number} checkId
 * @returns {Promise<void>}
 */
export async function deleteCheck(checkId) {
  await executeQuery(`DELETE FROM checks_register WHERE id = ${checkId};`)
}
