// Retrying a checkout whose reply was lost must never record the sale twice.
// The service is idempotent per client reference (pos.checkout, client_ref). The till therefore keeps
// the reference of an attempt with an unknown outcome and sends the same cart again under it: the
// service returns the stored sale if the first attempt committed. If the cart changed in the meantime,
// the till first asks the service whether that attempt was recorded (pos.checkoutStatus).

// Errors raised before the request reached the service, or a definite answer from it.
const NOT_SENT = new Set(['backend_unavailable', 'server_certificate', 'no_bridge'])

/** True when the service may have committed the sale although the till got no answer. */
export function outcomeUnknown(err) {
  const status = Number(err?.status) || 0
  if (status >= 400 && status < 500) return false
  return !NOT_SENT.has(err?.code)
}

/** Identity of a checkout request apart from its reference. */
export function checkoutFingerprint(payload) {
  return JSON.stringify(payload)
}

/**
 * Plan the next attempt.
 * @param {{clientRef: string, fingerprint: string} | null} unresolved earlier attempt with an unknown outcome
 * @returns {{ clientRef: string | null, checkFirst: string | null }}
 *   clientRef: reuse this reference (same cart), or null to create a new one;
 *   checkFirst: ask the service about this earlier reference before selling a different cart.
 */
export function planCheckout(unresolved, fingerprint) {
  if (!unresolved) return { clientRef: null, checkFirst: null }
  if (unresolved.fingerprint === fingerprint)
    return { clientRef: unresolved.clientRef, checkFirst: null }
  return { clientRef: null, checkFirst: unresolved.clientRef }
}
