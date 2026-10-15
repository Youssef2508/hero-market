'use strict'
// PIN storage. Login is PIN-only (the existing workflow), so a deterministic lookup key is needed:
//   pin_lookup = HMAC-SHA256(server secret, PIN)  – unique per user, useless without the secret
//   pin_hash   = scrypt(PIN, random salt)         – verified after the lookup
// Legacy rows (SHA-256 hex or plain text in users.password_hash) are upgraded on their first login.
const crypto = require('crypto')

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }
const PIN_RE = /^\d{4,8}$/

function pinLookup(secret, pin) {
  return crypto.createHmac('sha256', secret).update(`pin:${pin}`).digest('hex')
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(pin), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p
  })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

function verifyPin(pin, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false
  const [, N, r, p, saltB64, hashB64] = stored.split('$')
  const expected = Buffer.from(hashB64, 'base64')
  const actual = crypto.scryptSync(String(pin), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p)
  })
  return crypto.timingSafeEqual(actual, expected)
}

/** The legacy renderer stored SHA-256(pin.trim()) in hex, or the PIN itself. */
function legacyCandidates(pin) {
  const p = String(pin).trim()
  return [crypto.createHash('sha256').update(p).digest('hex'), p]
}

function isValidPin(pin) {
  return typeof pin === 'string' && PIN_RE.test(pin)
}

module.exports = { pinLookup, hashPin, verifyPin, legacyCandidates, isValidPin }
