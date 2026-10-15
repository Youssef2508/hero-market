'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  passwordProblem,
  hashPassword,
  verifyPassword,
  newRecoveryCode,
  newTemporaryPassword,
  hashRecoveryCode,
  verifyRecoveryCode
} = require('../../src/server/auth/password')

test('password rules: length, letters and digits, not common, not the username', () => {
  for (const good of ['Store-2026', 'كلمة سر 77', 'abc12345', 'Ahmed-till-1'])
    assert.equal(passwordProblem(good, 'cashier'), '', good)
  const bad = [
    ['short1', /8 أحرف/],
    ['onlyletters', /حروف وأرقام/],
    ['1234567890', /حروف وأرقام/],
    ['password1', /شائعة/],
    ['Admin123', /شائعة/],
    [' Store-2026', /مسافة/],
    ['x'.repeat(129), /128/]
  ]
  for (const [p, re] of bad) assert.match(passwordProblem(p, 'cashier'), re, p)
  assert.match(passwordProblem('Mona-2026', 'mona'), /اسم المستخدم/)
  assert.equal(passwordProblem('Mo-2026xx', 'mo'), '', 'very short usernames are not matched')
})

test('passwords and recovery codes are stored as salted scrypt hashes', () => {
  const h1 = hashPassword('Store-2026')
  const h2 = hashPassword('Store-2026')
  assert.ok(h1.startsWith('scrypt$') && h1 !== h2, 'random salt')
  assert.ok(verifyPassword('Store-2026', h1))
  assert.ok(!verifyPassword('store-2026', h1), 'case matters')
  assert.ok(!verifyPassword('Store-2026 ', h1), 'no trimming')
  const code = newRecoveryCode()
  assert.match(code, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/, 'no 0/O/1/I/L/U')
  const stored = hashRecoveryCode(code)
  assert.ok(verifyRecoveryCode(code.toLowerCase().replace(/-/g, ' '), stored))
  assert.ok(!verifyRecoveryCode(newRecoveryCode(), stored))
  const temp = newTemporaryPassword()
  assert.equal(passwordProblem(temp), '', 'temporary passwords satisfy the rules')
})
