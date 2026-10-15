import { executeQuery } from '../db'
import { escapeSql, getNowStr } from '../utils'

/**
 * Log a system event.
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.username
 * @param {string} params.actionType - e.g. 'user_create', 'price_change', 'safe_inflow'
 * @param {string} params.description - Human-readable description
 * @param {object} [params.details] - Extra JSON details (optional)
 */
export async function logEvent({ userId, username, actionType, description, details = null }) {
  try {
    const nowStr = getNowStr()
    const cleanUserId = userId ? parseInt(userId) : 'NULL'
    const cleanUsername = username ? `'${escapeSql(username)}'` : 'NULL'
    const cleanAction = `'${escapeSql(actionType)}'`
    const cleanDesc = description ? `'${escapeSql(description)}'` : 'NULL'
    const cleanDetails = details ? `'${escapeSql(JSON.stringify(details))}'` : 'NULL'

    await executeQuery(`
      INSERT INTO system_logs (timestamp, user_id, username, action_type, description, details)
      VALUES ('${nowStr}', ${cleanUserId}, ${cleanUsername}, ${cleanAction}, ${cleanDesc}, ${cleanDetails});
    `)
  } catch (e) {
    console.error('Failed to write system log:', e)
  }
}

/**
 * Retrieve system logs.
 *
 * @param {object} params
 * @param {number} params.limit
 * @param {number} params.offset
 * @returns {Promise<object[]>}
 */
export async function getSystemLogs(limit = 100, offset = 0) {
  return await executeQuery(`
    SELECT * FROM system_logs 
    ORDER BY id DESC 
    LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)};
  `)
}
