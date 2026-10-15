'use strict'
// Attempt limits for sign-in, recovery and supervisor approval (unchanged rules, shared here).
// Two layers: 5 failures in 5 min lock one terminal for 60 s (the original till behaviour), and
// 20 failures in 15 min lock the whole source address for 15 min. The terminal name is chosen by the
// client, so only the per-address limit stops a network client from rotating names to guess.
const { tooMany } = require('../errors')

const LIMITS = {
  terminal: { max: 5, windowMs: 5 * 60 * 1000, lockMs: 60 * 1000 },
  address: { max: 20, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 }
}

function guardKeys(ctx, prefix = '') {
  return [
    [`${prefix}t|${ctx.terminal || 'unknown'}|${ctx.ip}`, LIMITS.terminal],
    [`${prefix}a|${ctx.ip}`, LIMITS.address]
  ]
}

function checkGuard(guard, keys) {
  const now = Date.now()
  for (const [key] of keys) {
    const g = guard.get(key)
    if (g && g.lockedUntil > now) {
      const secs = Math.ceil((g.lockedUntil - now) / 1000)
      throw tooMany(`محاولات دخول خاطئة كثيرة. حاول مرة أخرى بعد ${secs} ثانية.`)
    }
  }
}

function recordFailure(guard, keys) {
  const now = Date.now()
  if (guard.size > 5000) {
    for (const [k, g] of guard)
      if (g.lockedUntil < now && now - g.first > LIMITS.address.windowMs) guard.delete(k)
  }
  for (const [key, limit] of keys) {
    let g = guard.get(key)
    if (!g || now - g.first > limit.windowMs) g = { failures: 0, first: now, lockedUntil: 0 }
    g.failures += 1
    if (g.failures >= limit.max) {
      g.lockedUntil = now + limit.lockMs
      g.failures = 0
      g.first = now
    }
    guard.set(key, g)
  }
}

/** A success clears the terminal counter only; address-level failures still count. */
function clearTerminal(guard, keys) {
  guard.delete(keys[0][0])
}

module.exports = { LIMITS, guardKeys, checkGuard, recordFailure, clearTerminal }
