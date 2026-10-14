// Mobile-money till operations through the HeroMarket service (src/server/modules/tills.js).
import { api } from '../api'

const safeInt = (val, defaultVal = 0) => {
  const parsed = parseInt(val, 10)
  return isNaN(parsed) ? defaultVal : parsed
}

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
  if (cleanShiftId <= 0) throw new Error('رقم الوردية غير صالح')
  await api('mobileMoney.add', {
    shiftId: cleanShiftId,
    platform,
    operationType,
    digitalImpact: parseFloat(digitalImpact) || 0,
    cashImpact: parseFloat(cashImpact) || 0,
    commission: parseFloat(commission) || 0,
    recipientName: recipientName || '',
    phoneOrAccount: phoneOrAccount || '',
    notes: notes || ''
  })
}

export async function getMobileMoneyByShift(shiftId) {
  const cleanShiftId = safeInt(shiftId, 0)
  if (cleanShiftId <= 0) return []
  return (await api('mobileMoney.list', { shiftId: cleanShiftId })).rows
}

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
  return (await api('mobileMoney.list', { shiftId: cleanShiftId })).summary
}

export async function deleteMobileMoneyTransaction(id) {
  const cleanId = safeInt(id, 0)
  if (cleanId <= 0) throw new Error('رقم العملية غير صالح للحذف')
  await api('mobileMoney.delete', { id: cleanId })
}
