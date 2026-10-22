'use strict'
// Staff passwords (stage 4 phase 3): username + password replaces PIN-only login.
// Hashes use the same scrypt format as PINs (scrypt$N$r$p$salt$hash).
const crypto = require('crypto')
const { hashPin: hashSecret, verifyPin: verifySecret } = require('./pin')

const MIN_LENGTH = 8
const MAX_LENGTH = 128
const COMMON = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  'password',
  'password1',
  'qwerty123',
  'heromarket',
  '11111111',
  '00000000',
  'abcd1234',
  'admin123'
])

/** True for a plain run of consecutive characters: abcdefgh, 12345678, 87654321, zyxwvuts. */
function isRun(p) {
  const c = [...p.toLowerCase()].map((ch) => ch.codePointAt(0))
  const step = c[1] - c[0]
  return (step === 1 || step === -1) && c.every((x, i) => i === 0 || x - c[i - 1] === step)
}

/** Arabic message describing what is wrong with a new password, or '' when it is acceptable. */
function passwordProblem(password, username = '') {
  const p = String(password ?? '')
  if (p.length < MIN_LENGTH) return `كلمة المرور يجب أن تكون ${MIN_LENGTH} أحرف على الأقل.`
  if (p.length > MAX_LENGTH) return `كلمة المرور يجب ألا تزيد عن ${MAX_LENGTH} حرفاً.`
  if (p.trim() !== p) return 'كلمة المرور لا يجب أن تبدأ أو تنتهي بمسافة.'
  // Any characters are allowed – letters, digits, symbols, spaces inside (owner feedback
  // USER-01, D-058; NIST SP 800-63B: no composition rules). Instead of "letters and digits",
  // trivially guessable passwords are refused.
  if (new Set([...p]).size < 4) return 'كلمة المرور يجب أن تحتوي على 4 رموز مختلفة على الأقل.'
  if (isRun(p)) return 'كلمة المرور سهلة التخمين (حروف أو أرقام متتالية)، اختر غيرها.'
  if (/^(.)\1+$/u.test(p)) return 'كلمة المرور ضعيفة جداً.'
  const lower = p.toLowerCase()
  if (COMMON.has(lower)) return 'كلمة المرور هذه شائعة جداً، اختر غيرها.'
  const name = String(username || '')
    .trim()
    .toLowerCase()
  if (name.length >= 3 && lower.includes(name))
    return 'كلمة المرور لا يجب أن تحتوي على اسم المستخدم.'
  return ''
}

// Crockford base32 without look-alike characters: easy to read aloud and to type.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
function randomGroups(groups, size) {
  const out = []
  for (let g = 0; g < groups; g++) {
    let s = ''
    for (let i = 0; i < size; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)]
    out.push(s)
  }
  return out.join('-')
}

/** One-time recovery code for a super administrator, e.g. "K7MQ2-XR9TB-4HPWD-N3ZVA". */
const newRecoveryCode = () => randomGroups(4, 5)
/** Temporary password after an administrator reset; must be changed at the next sign-in. */
const newTemporaryPassword = () => `${randomGroups(2, 4)}-${crypto.randomInt(10, 100)}`
/** Recovery codes are compared without dashes, spaces or case. */
const normalizeRecoveryCode = (code) =>
  String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')

const hashPassword = (password) => hashSecret(password)
const verifyPassword = (password, stored) => verifySecret(String(password ?? ''), stored)
const hashRecoveryCode = (code) => hashSecret(normalizeRecoveryCode(code))
const verifyRecoveryCode = (code, stored) => verifySecret(normalizeRecoveryCode(code), stored)

// Verifying against this when the username is unknown keeps response times alike.
const DUMMY_HASH = hashSecret(crypto.randomBytes(16).toString('hex'))
const burnTime = (password) => verifySecret(String(password ?? ''), DUMMY_HASH)

module.exports = {
  MIN_LENGTH,
  passwordProblem,
  hashPassword,
  verifyPassword,
  newRecoveryCode,
  newTemporaryPassword,
  hashRecoveryCode,
  verifyRecoveryCode,
  normalizeRecoveryCode,
  burnTime
}
