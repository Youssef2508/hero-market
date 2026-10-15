// Customer form helpers for the two phone numbers (same rule as the service: src/shared/phone.mjs).
import { normalizePhone } from '../../../shared/phone.mjs'

/** The numbers to send, primary first; the service validates them again. */
export function formPhones(form) {
  return [form.phone, form.hasPhone2 ? form.phone2 : ''].map((p) => String(p || '').trim())
}

/** Any message to show before saving (same rule as the service), or ''. */
export function phoneFormError(form) {
  const a = normalizePhone(form.phone)
  if (a.error) return a.error
  if (!form.hasPhone2 || !String(form.phone2 || '').trim()) return ''
  if (!a.value) return 'أدخل الرقم الأساسي أولاً.'
  const b = normalizePhone(form.phone2)
  if (b.error) return `الرقم الثاني: ${b.error}`
  if (a.value === b.value) return 'الرقم الثاني مطابق للرقم الأول.'
  return ''
}
