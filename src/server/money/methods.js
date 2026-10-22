'use strict'
// Payment methods (owner, 2026-10-21, D-061): cash, Visa, wallet, InstaPay. The only mapping between
// a sale's stored payment_type and its method (.docs/FINANCIAL_RECONCILIATION.md §2).

const METHODS = ['cash', 'visa', 'wallet', 'instapay']

const LABELS = { cash: 'نقدي', visa: 'فيزا', wallet: 'محفظة', instapay: 'انستا باي' }

// Stored payment_type values per method. Sales before 1.5.0 wrote فودافون كاش for the wallet.
const TYPES = {
  cash: ['نقدي'],
  visa: ['فيزا'],
  wallet: ['محفظة', 'فودافون كاش'],
  instapay: ['انستا باي']
}

// On account: not a method; the unpaid part goes on the customer's account (the part paid at once
// on دفع جزئي is cash).
const CREDIT_TYPES = ['آجل', 'دفع جزئي']

// What checkout accepts. فودافون كاش is still accepted (a till queued before the update) and is
// stored as محفظة.
const PAYMENT_TYPES = ['نقدي', 'فيزا', 'محفظة', 'انستا باي', 'آجل', 'دفع جزئي', 'فودافون كاش']

/** The stored payment_type for a requested one (legacy wallet name → محفظة). */
const storedType = (t) => (t === 'فودافون كاش' ? 'محفظة' : t)

/** The method of a stored payment_type, or null for on-account types. */
function methodOf(paymentType) {
  for (const m of METHODS) if (TYPES[m].includes(paymentType)) return m
  return null
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** variance = actual − expected; > 0 surplus (زيادة), < 0 shortage (عجز). */
function variance(actual, expected) {
  return round2(Number(actual || 0) - Number(expected || 0))
}

function varianceLabel(v) {
  if (Math.abs(v) < 0.005) return 'مطابق'
  return v < 0 ? `عجز ${Math.abs(v).toFixed(2)}` : `زيادة ${v.toFixed(2)}`
}

module.exports = {
  METHODS,
  LABELS,
  TYPES,
  CREDIT_TYPES,
  PAYMENT_TYPES,
  storedType,
  methodOf,
  variance,
  varianceLabel,
  round2
}
