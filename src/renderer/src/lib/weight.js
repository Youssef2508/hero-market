// Manual weight entry (owner, 2026-10-15): the cashier weighs on an ordinary scale and types the
// weight. Kilograms with three decimals are kept, i.e. whole grams. The service checks the same rule.

const MAX_KG = 1000

/**
 * Parse a typed weight. `unit` is 'g' or 'kg'. Arabic-Indic digits and a comma decimal separator
 * are accepted. Returns { kg, error } – kg is 0 when the text is empty or invalid.
 */
export function parseWeight(text, unit = 'g') {
  const normalised = String(text ?? '')
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٫,]/g, '.')
  if (normalised === '') return { kg: 0, error: '' }
  const n = Number(normalised)
  if (!Number.isFinite(n)) return { kg: 0, error: 'أدخل رقماً صحيحاً.' }
  if (n <= 0) return { kg: 0, error: 'الوزن يجب أن يكون أكبر من صفر.' }
  const grams = unit === 'g' ? n : n * 1000
  if (Math.abs(grams - Math.round(grams)) > 1e-6)
    return { kg: 0, error: 'الوزن بالجرام الكامل فقط (ثلاث خانات عشرية بالكيلو).' }
  const kg = Math.round(grams) / 1000
  if (kg > MAX_KG) return { kg: 0, error: `الوزن أكبر من ${MAX_KG} كجم؛ تحقق من الرقم.` }
  return { kg, error: '' }
}

/**
 * Quantity text for receipts: weighed base-unit lines print as "0.250 كجم". A kind the owner added
 * with decimals (`decimals`, `kindUnit`; migration 0014) prints the same way, e.g. "1.50 متر".
 */
export function receiptQty(qty, { kind, unitId, unitName, decimals, kindUnit } = {}) {
  const q = Number(qty)
  if (kind === 'weight' && !unitId) return `${q.toFixed(3)} ${unitName || 'كجم'}`
  if (kind === 'volume' && !unitId) return `${q.toFixed(3)} ${unitName || 'لتر'}`
  if (!unitId && kind && kind !== 'count' && decimals > 0)
    return `${q.toFixed(decimals)} ${unitName || kindUnit || ''}`.trim()
  return q
}
