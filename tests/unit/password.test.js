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
  verifyRecoveryCode,
  needsRehash,
  PARAMS
} = require('../../src/server/auth/password')
const { hashPin } = require('../../src/server/auth/pin')

test('password rules: length, any characters, not guessable, not common, not the username', () => {
  // USER-01 (D-058): letters only, digits only and symbols are allowed, as long as the password
  // is not trivially guessable. ("onlyletters" used to be refused for having no digit.)
  for (const good of [
    'Store-2026',
    'كلمة سر 77',
    'abc12345',
    'Ahmed-till-1',
    'onlyletters',
    'كلمةسريةطويلة',
    '73915482',
    '!@#$%^&*',
    'Mo#$%^&*pass'
  ])
    assert.equal(passwordProblem(good, 'cashier'), '', good)
  const bad = [
    ['short1', /8 أحرف/],
    ['aaaaaaab', /4 رموز مختلفة/],
    ['abababab', /4 رموز مختلفة/],
    ['abcdefgh', /متتالية/],
    ['87654321', /متتالية/],
    ['1234567890', /شائعة/],
    ['password1', /شائعة/],
    ['Admin123', /شائعة/],
    [' Store-2026', /مسافة/],
    ['x'.repeat(129), /128/]
  ]
  for (const [p, re] of bad) assert.match(passwordProblem(p, 'cashier'), re, p)
  assert.match(passwordProblem('Mona-2026', 'mona'), /اسم المستخدم/)
  assert.equal(passwordProblem('Mo-2026xx', 'mo'), '', 'very short usernames are not matched')
})

test('passwords and recovery codes are stored as salted scrypt hashes', async () => {
  const h1 = await hashPassword('Store-2026')
  const h2 = await hashPassword('Store-2026')
  assert.ok(h1.startsWith('scrypt$') && h1 !== h2, 'random salt')
  assert.ok(await verifyPassword('Store-2026', h1))
  assert.ok(!(await verifyPassword('store-2026', h1)), 'case matters')
  assert.ok(!(await verifyPassword('Store-2026 ', h1)), 'no trimming')
  const code = newRecoveryCode()
  assert.match(code, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/, 'no 0/O/1/I/L/U')
  const stored = await hashRecoveryCode(code)
  assert.ok(await verifyRecoveryCode(code.toLowerCase().replace(/-/g, ' '), stored))
  assert.ok(!(await verifyRecoveryCode(newRecoveryCode(), stored)))
  const temp = newTemporaryPassword()
  assert.equal(passwordProblem(temp), '', 'temporary passwords satisfy the rules')
})

test('D-105: OWASP-level scrypt for passwords; older hashes still verify and are marked for renewal', async () => {
  const h = await hashPassword('Store-2026')
  assert.deepEqual(h.split('$').slice(1, 4).map(Number), [PARAMS.N, PARAMS.r, PARAMS.p])
  assert.ok(PARAMS.N * PARAMS.r * PARAMS.p >= 16384 * 8 * 5, 'at least N=2^14, r=8, p=5')
  assert.equal(needsRehash(h), false)
  // A hash from before (N=2^14, r=8, p=1, the PIN format) still signs in, and is renewed.
  const old = hashPin('Store-2026')
  assert.ok(old.startsWith('scrypt$16384$8$1$'))
  assert.ok(await verifyPassword('Store-2026', old))
  assert.ok(!(await verifyPassword('Store-2027', old)))
  assert.equal(needsRehash(old), true)
  assert.equal(await verifyPassword('x', 'scrypt$16384$8$1$broken'), false)
})
