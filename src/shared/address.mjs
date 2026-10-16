// Customer delivery addresses (1.4.0): at most three per customer, optional. Shared by the service
// (validation before saving) and the screens (messages while typing), like phone.mjs.

export const MAX_ADDRESSES = 3
export const ADDRESS_LABELS = { home: 'المنزل', work: 'العمل', other: 'أخرى' }

const clean = (s) =>
  String(s ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

/**
 * Validate a customer's addresses. Entries with an empty address are dropped. Returns
 * { addresses: [{ id?, label, address, details, isDefault }], error } with exactly one default
 * when there is any address (the first one if none was chosen).
 */
export function normalizeAddresses(list) {
  const raw = (Array.isArray(list) ? list : [])
    .map((a) => ({
      id: Number.isInteger(a?.id) ? a.id : undefined,
      label: Object.hasOwn(ADDRESS_LABELS, a?.label) ? a.label : 'other',
      address: clean(a?.address),
      details: clean(a?.details) || null,
      isDefault: !!a?.isDefault
    }))
    .filter((a) => a.address)
  if (raw.length > MAX_ADDRESSES)
    return { addresses: [], error: 'يمكن تسجيل ثلاثة عناوين على الأكثر لكل عميل.' }
  for (const [i, a] of raw.entries()) {
    if (a.address.length < 2 || a.address.length > 300)
      return { addresses: [], error: `العنوان رقم ${i + 1} يجب أن يكون بين 2 و300 حرف.` }
    if (a.details && a.details.length > 200)
      return { addresses: [], error: `تفاصيل العنوان رقم ${i + 1} يجب ألا تزيد عن 200 حرف.` }
  }
  const seen = new Set(raw.map((a) => a.address.toLowerCase()))
  if (seen.size !== raw.length) return { addresses: [], error: 'العنوان مكرر لنفس العميل.' }
  const defaults = raw.filter((a) => a.isDefault).length
  if (defaults > 1) return { addresses: [], error: 'يمكن اختيار عنوان افتراضي واحد فقط.' }
  if (raw.length && defaults === 0) raw[0].isDefault = true
  return { addresses: raw, error: '' }
}
