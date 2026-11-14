// A reloaded or reopened browser page continues its session (owner, 1.6.3).
//
// The browser's session is an HTTP-only cookie the page cannot read, so the page asks the service
// whether it still has one (auth.session). The answer decides what the start-up shows:
//   - the session is valid: the screens continue as after signing in (no new session is made);
//   - no session, or it expired, was revoked or the account lost access (401/403): the sign-in
//     screen, without the "session expired" alert – nothing was interrupted;
//   - the service could not be asked (503 and other failures): the start-up's own retry, never the
//     sign-in screen, since the session may well be valid.
// The desktop program is not concerned: the till always starts locked (G-16).

export class SessionCheckFailed extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

/**
 * @param {(op: string, body?: object) => Promise<{status: number, data?: any, error?: any}>} call
 *   the bridge's raw call (window.api.call): its 401 does not announce an expired session.
 * @returns {Promise<object|null>} the sign-in answer ({ user, openShift, shiftRequired }) or null
 */
export async function resumeWebSession(call) {
  const res = await call('auth.session', {})
  if (res && !res.error && res.data?.user) return res.data
  const status = res?.status ?? 0
  if (status === 401 || status === 403) return null
  throw new SessionCheckFailed(res?.error?.message || 'تعذر التحقق من الجلسة.', 503)
}
