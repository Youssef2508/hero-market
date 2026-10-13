import { executeQuery } from '../db'
import { escapeSql, getNowStr } from '../utils'

const safeInt = (val, defaultVal = 0) => {
  const parsed = parseInt(val, 10)
  return isNaN(parsed) ? defaultVal : parsed
}

/**
 * Add a new Momkn transaction to the database.
 */
export async function addMomknTransaction({
  shiftId,
  operationType,
  description = '',
  digitalImpact,
  cashImpact,
  commission = 0,
  notes = ''
}) {
  const cleanShiftId = safeInt(shiftId, 0)
  if (cleanShiftId <= 0) {
    throw new Error('رقم الوردية غير صالح')
  }

  const nowStr = getNowStr()
  await executeQuery(`
    INSERT INTO momkn_transactions (
      shift_id, timestamp, operation_type, description, 
      digital_impact, cash_impact, commission, notes
    ) VALUES (
      ${cleanShiftId},
      '${nowStr}',
      '${escapeSql(operationType)}',
      '${escapeSql(description)}',
      ${parseFloat(digitalImpact) || 0.0},
      ${parseFloat(cashImpact) || 0.0},
      ${parseFloat(commission) || 0.0},
      '${escapeSql(notes)}'
    );
  `)
}

/**
 * Get all Momkn transactions for a specific shift.
 */
export async function getMomknTransactionsByShift(shiftId) {
  const cleanShiftId = safeInt(shiftId, 0)
  if (cleanShiftId <= 0) return []

  return await executeQuery(`
    SELECT * FROM momkn_transactions 
    WHERE shift_id = ${cleanShiftId} 
    ORDER BY id DESC;
  `)
}

/**
 * Get the summary of Momkn transactions for a shift, including initial balance.
 */
export async function getMomknShiftSummary(shiftId) {
  const cleanShiftId = safeInt(shiftId, 0)
  if (cleanShiftId <= 0) {
    return {
      startBalance: 0,
      expectedDigitalBalance: 0,
      totalCashImpact: 0,
      totalCommission: 0
    }
  }

  const shiftRes = await executeQuery(`
    SELECT momkn_start_balance, momkn_start_cash FROM shifts 
    WHERE id = ${cleanShiftId} 
    LIMIT 1;
  `)
  const startBalance =
    shiftRes && shiftRes.length > 0 ? parseFloat(shiftRes[0].momkn_start_balance) || 0.0 : 0.0
  const startCash =
    shiftRes && shiftRes.length > 0 ? parseFloat(shiftRes[0].momkn_start_cash) || 0.0 : 0.0

  const totalsRes = await executeQuery(`
    SELECT 
      SUM(digital_impact) as total_digital,
      SUM(cash_impact) as total_cash,
      SUM(commission) as total_commission
    FROM momkn_transactions
    WHERE shift_id = ${cleanShiftId};
  `)

  const totalDigitalImpact =
    totalsRes && totalsRes.length > 0 ? parseFloat(totalsRes[0].total_digital) || 0.0 : 0.0
  const totalCashImpact =
    totalsRes && totalsRes.length > 0 ? parseFloat(totalsRes[0].total_cash) || 0.0 : 0.0
  const totalCommission =
    totalsRes && totalsRes.length > 0 ? parseFloat(totalsRes[0].total_commission) || 0.0 : 0.0

  return {
    startBalance,
    startCash,
    expectedDigitalBalance: startBalance + totalDigitalImpact,
    totalCashImpact,
    expectedCash: startCash + totalCashImpact,
    totalCommission
  }
}

/**
 * Delete a Momkn transaction (Admin only).
 */
export async function deleteMomknTransaction(id) {
  const cleanId = safeInt(id, 0)
  if (cleanId <= 0) {
    throw new Error('رقم العملية غير صالح للحذف')
  }
  await executeQuery(`DELETE FROM momkn_transactions WHERE id = ${cleanId};`)
}
