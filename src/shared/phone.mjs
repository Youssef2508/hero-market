// Customer phone numbers (owner, 2026-10-15): at most two per customer – a primary number and an
// optional second one. Shared by the service (validation before saving) and the screens (messages
// while typing), so both apply exactly the same rule.

export const MAX_PHONES = 2

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

/**
 * Normalise one phone number. Accepts Arabic-Indic digits, spaces, dashes, dots and brackets, and
 * an international prefix written as "+" or "00".
 * Returns { value, error }: value is '' for an empty input; error is an Arabic message or ''.
 * Rules: 7–15 digits (international numbering limit); an Egyptian mobile written locally (01…) must
 * have exactly 11 digits.
 */
export function normalizePhone(raw) {
  let s = String(raw ?? '').trim()
  if (!s) return { value: '', error: '' }
  s = s
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[\s\-.()]/g, '')
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  const plus = s.startsWith('+')
  const digits = plus ? s.slice(1) : s
  if (!/^\d+$/.test(digits)) return { value: '', error: 'رقم الهاتف يقبل الأرقام فقط.' }
  if (digits.length < 7 || digits.length > 15)
    return { value: '', error: 'رقم الهاتف يجب أن يكون بين 7 و 15 رقماً.' }
  if (!plus && digits.startsWith('01') && digits.length !== 11)
    return { value: '', error: 'رقم الموبايل المصري يجب أن يكون 11 رقماً (مثل 01012345678).' }
  return { value: plus ? `+${digits}` : digits, error: '' }
}

/**
 * Validate a customer's numbers (primary first). Empty entries are dropped. Returns
 * { phones: [primary?, second?], error }.
 */
export function normalizePhones(list) {
  const raw = (Array.isArray(list) ? list : []).map((p) => String(p ?? '').trim()).filter(Boolean)
  if (raw.length > MAX_PHONES) return { phones: [], error: `يمكن تسجيل رقمين على الأكثر لكل عميل.` }
  const phones = []
  for (const [i, p] of raw.entries()) {
    const r = normalizePhone(p)
    if (r.error) return { phones: [], error: i === 0 ? r.error : `الرقم الثاني: ${r.error}` }
    phones.push(r.value)
  }
  if (phones.length === 2 && phones[0] === phones[1])
    return { phones: [], error: 'الرقم الثاني مطابق للرقم الأول.' }
  return { phones, error: '' }
}
