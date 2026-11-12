// Invoice numbers as people see them (Phase 2, D-103/D-105). The shop numbers its invoices from 1
// and the cloud – while the shop is unreachable – from 1,000,000,001, so the two can never collide.
// People see the cloud's as "W-1", "W-2", … (W for web); the shop's are shown as before.
// Shared by the screens and the receipts, so a number reads the same everywhere and can be typed
// back to find its invoice.

export const CLOUD_FIRST = 1000000001

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const digits = (s) =>
  String(s ?? '')
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))

/** True for an invoice made by the cloud. */
export const isCloudSale = (id) => Number(id) >= CLOUD_FIRST

/** The invoice's full reference: "1234" in the shop, "W-17" from the cloud. */
export function saleRef(id) {
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) return '—'
  return n >= CLOUD_FIRST ? `W-${n - CLOUD_FIRST + 1}` : String(n)
}

/**
 * The short number of the invoice lists and the till's reprint, which counts 1–10000 and starts
 * again (the till's rule since 1.0); the cloud's keep their "W-".
 */
export function saleNo(id) {
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) return '?'
  return n >= CLOUD_FIRST ? `W-${((n - CLOUD_FIRST) % 10000) + 1}` : String(((n - 1) % 10000) + 1)
}

/**
 * What a person typed back to the invoice id: "W-17", "w17", "W ١٧" → the cloud's 17th; "1234",
 * "#1234" → the shop's 1234. Null when it is not a number.
 */
export function parseSaleRef(text) {
  const t = digits(text).trim().replace(/^#/, '')
  const web = /^[wW]\s*-?\s*(\d{1,9})$/.exec(t)
  if (web) return Number(web[1]) > 0 ? CLOUD_FIRST + Number(web[1]) - 1 : null
  const plain = t.replace(/[\s-]/g, '')
  return /^\d{1,12}$/.test(plain) && Number(plain) > 0 ? Number(plain) : null
}
