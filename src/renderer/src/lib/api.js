// Client for the HeroMarket service. Every data access in the renderer goes through `api(op, body)`.
// Errors are thrown as Error objects whose message is already a user-facing Arabic sentence.

export class ApiError extends Error {
  constructor(message, { code, status, details } = {}) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

// Sign-in operations answer 401 for a wrong password; that is not an expired session.
const SIGN_IN = new Set(['auth.login', 'auth.setup', 'auth.setPassword', 'auth.recover'])

export async function api(op, body = {}) {
  if (!window.api || !window.api.call)
    throw new ApiError('واجهة البيانات غير متاحة.', { code: 'no_bridge', status: 0 })
  const res = await window.api.call(op, body)
  if (res && res.error) {
    if (res.status === 401 && !SIGN_IN.has(op)) {
      // Session expired, revoked (user disabled) or cleared by a restore: back to the lock screen.
      window.dispatchEvent(new CustomEvent('heromarket:session-expired'))
    }
    if (res.error.code === 'shift_required') {
      // Drawer cash needs an open shift; a user allowed to work without one is offered to open it.
      window.dispatchEvent(new CustomEvent('heromarket:shift-required'))
    }
    if (res.status === 423 && res.error.code === 'recovery_pending') {
      // A restored backup waits for recovery from the cloud: the app shows what to do.
      window.dispatchEvent(new CustomEvent('heromarket:recovery-pending'))
    }
    throw new ApiError(res.error.message || 'حدث خطأ غير متوقع.', {
      code: res.error.code,
      status: res.status,
      details: res.error.details
    })
  }
  return res ? res.data : null
}

/** Permission check for UI decisions only; the service enforces the real rule. */
export function can(user, permission) {
  return !!user && Array.isArray(user.permissions) && user.permissions.includes(permission)
}

/** Client-generated idempotency key for one checkout attempt. */
export function newClientRef() {
  return (
    (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}
