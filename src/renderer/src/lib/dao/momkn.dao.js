// Momkn till operations through the HeroMarket service (src/server/modules/tills.js).
import { api } from '../api'

const safeInt = (val, defaultVal = 0) => {
  const parsed = parseInt(val, 10)
  return isNaN(parsed) ? defaultVal : parsed
}

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
  if (cleanShiftId <= 0) throw new Error('رقم الوردية غير صالح')
  await api('momkn.add', {
    shiftId: cleanShiftId,
    operationType,
    description: description || '',
    digitalImpact: parseFloat(digitalImpact) || 0,
    cashImpact: parseFloat(cashImpact) || 0,
    commission: parseFloat(commission) || 0,
    notes: notes || ''
  })
}

export async function getMomknTransactionsByShift(shiftId) {
  const cleanShiftId = safeInt(shiftId, 0)
  if (cleanShiftId <= 0) return []
  return (await api('momkn.list', { shiftId: cleanShiftId })).rows
}

export async function getMomknShiftSummary(shiftId) {
  const cleanShiftId = safeInt(shiftId, 0)
  if (cleanShiftId <= 0) {
    return {
      startBalance: 0,
      startCash: 0,
      expectedDigitalBalance: 0,
      totalCashImpact: 0,
      expectedCash: 0,
      totalCommission: 0
    }
  }
  return (await api('momkn.list', { shiftId: cleanShiftId })).summary
}

export async function deleteMomknTransaction(id) {
  const cleanId = safeInt(id, 0)
  if (cleanId <= 0) throw new Error('رقم العملية غير صالح للحذف')
  await api('momkn.delete', { id: cleanId })
}
