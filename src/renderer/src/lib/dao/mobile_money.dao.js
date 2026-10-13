import { executeQuery } from '../db'
import { escapeSql, getNowStr } from '../utils'

const safeInt = (val, defaultVal = 0) => {
  const parsed = parseInt(val, 10)
  return isNaN(parsed) ? defaultVal : parsed
}

/**
 * Add a new Mobile Money / Wallet transaction.
 */
export async function addMobileMoneyTransaction({
  shiftId,
  platform,
  operationType,
  digitalImpact,
  cashImpact,
  commission = 0,
  recipientName = '',
  phoneOrAccount = '',
  notes = ''
}) {
  const cleanShiftId = safeInt(shiftId, 0)
  if (cleanShiftId <= 0) {
    throw new Error('رقم الوردية غير صالح')
  }

  const nowStr = getNowStr()
  await executeQuery(`
    INSERT INTO mobile_money_transactions (
      shift_id, timestamp, platform, operation_type,
      digital_impact, cash_impact, commission,
      recipient_name, phone_or_account, notes
    ) VALUES (
      ${cleanShiftId},
      '${nowStr}',
      '${escapeSql(platform)}',
      '${escapeSql(operationType)}',
      ${parseFloat(digitalImpact) || 0.0},
      ${parseFloat(cashImpact) || 0.0},
      ${parseFloat(commission) || 0.0},
      '${escapeSql(recipientName)}',
      '${escapeSql(phoneOrAccount)}',
      '${escapeSql(notes)}'
    );
  `)
}

/**
 * Get all Mobile Money transactions for a specific shift.
 */
export async function getMobileMoneyByShift(shiftId) {
  const cleanShiftId = safeInt(shiftId, 0)
  if (cleanShiftId <= 0) return []

  return await executeQuery(`
    SELECT * FROM mobile_money_transactions 
    WHERE shift_id = ${cleanShiftId} 
    ORDER BY id DESC;
  `)
}

/**
 * Get summary details for Mobile Money transactions in a shift.
 */
export async function getMobileMoneyShiftSummary(shiftId) {
  const cleanShiftId = safeInt(shiftId, 0)
  if (cleanShiftId <= 0) {
    return {
      startBalance: 0,
      expectedVfcashDigitalBalance: 0,
      expectedInstapayDigitalBalance: 0,
      expectedBankDigitalBalance: 0,
      totalDigitalImpact: 0,
      totalCashImpact: 0,
      totalCommission: 0
    }
  }

  const shiftRes = await executeQuery(`
    SELECT vfcash_start_balance, vfcash_start_cash FROM shifts 
    WHERE id = ${cleanShiftId} 
    LIMIT 1;
  `)
  const startBalance =
    shiftRes && shiftRes.length > 0 ? parseFloat(shiftRes[0].vfcash_start_balance) || 0.0 : 0.0
  const startCash =
    shiftRes && shiftRes.length > 0 ? parseFloat(shiftRes[0].vfcash_start_cash) || 0.0 : 0.0

  const totalsRes = await executeQuery(`
    SELECT 
      SUM(CASE WHEN platform = 'vodafone_cash' THEN digital_impact ELSE 0 END) as vfcash_digital_sum,
      SUM(CASE WHEN platform = 'instapay' THEN digital_impact ELSE 0 END) as instapay_digital_sum,
      SUM(CASE WHEN platform = 'bank_transfer' THEN digital_impact ELSE 0 END) as bank_digital_sum,
      SUM(digital_impact) as total_digital,
      SUM(cash_impact) as total_cash,
      SUM(commission) as total_commission
    FROM mobile_money_transactions
    WHERE shift_id = ${cleanShiftId};
  `)

  const vfcashDigitalSum =
    totalsRes && totalsRes.length > 0 ? parseFloat(totalsRes[0].vfcash_digital_sum) || 0.0 : 0.0
  const instapayDigitalSum =
    totalsRes && totalsRes.length > 0 ? parseFloat(totalsRes[0].instapay_digital_sum) || 0.0 : 0.0
  const bankDigitalSum =
    totalsRes && totalsRes.length > 0 ? parseFloat(totalsRes[0].bank_digital_sum) || 0.0 : 0.0

  const totalDigitalImpact =
    totalsRes && totalsRes.length > 0 ? parseFloat(totalsRes[0].total_digital) || 0.0 : 0.0
  const totalCashImpact =
    totalsRes && totalsRes.length > 0 ? parseFloat(totalsRes[0].total_cash) || 0.0 : 0.0
  const totalCommission =
    totalsRes && totalsRes.length > 0 ? parseFloat(totalsRes[0].total_commission) || 0.0 : 0.0

  return {
    startBalance, // Specifically Vodafone Cash starting balance
    startCash,
    expectedVfcashDigitalBalance: startBalance + vfcashDigitalSum,
    expectedInstapayDigitalBalance: instapayDigitalSum,
    expectedBankDigitalBalance: bankDigitalSum,
    totalDigitalImpact,
    totalCashImpact,
    totalCommission,
    expectedCash: startCash + totalCashImpact
  }
}

/**
 * Delete a Mobile Money transaction (Admin only).
 */
export async function deleteMobileMoneyTransaction(id) {
  const cleanId = safeInt(id, 0)
  if (cleanId <= 0) {
    throw new Error('رقم العملية غير صالح للحذف')
  }
  await executeQuery(`DELETE FROM mobile_money_transactions WHERE id = ${cleanId};`)
}
