// Customer address form helpers (kept out of AddressFields.jsx for React fast refresh).
import { normalizeAddresses } from '../../../shared/address.mjs'

let seq = 1

/** A new, empty address row for the form. */
export const blankAddress = (isDefault = false) => ({
  key: `n${seq++}`,
  label: 'other',
  address: '',
  details: '',
  isDefault
})
/** Form rows from a customer record (addresses from the service, or the legacy single address). */
export function addressRows(client) {
  const list = Array.isArray(client?.addresses)
    ? client.addresses
    : client?.address
      ? [{ label: 'other', address: client.address, isDefault: true }]
      : []
  return list.map((a) => ({
    key: a.id ? `a${a.id}` : `l${seq++}`,
    id: a.id,
    label: a.label || 'other',
    address: a.address || '',
    details: a.details || '',
    isDefault: !!a.isDefault
  }))
}

/** What the service receives (blank rows dropped by the shared rule). */
export function formAddresses(form) {
  return (form.addresses || []).map((a) => ({
    ...(a.id ? { id: a.id } : {}),
    label: a.label,
    address: a.address,
    details: a.details || null,
    isDefault: !!a.isDefault
  }))
}

/** Arabic message for invalid addresses, or ''. */
export function addressFormError(form) {
  return normalizeAddresses(formAddresses(form)).error
}
