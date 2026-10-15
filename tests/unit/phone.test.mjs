import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhone, normalizePhones, MAX_PHONES } from '../../src/shared/phone.mjs'

test('phone numbers are cleaned to digits (and +)', () => {
  assert.deepEqual(normalizePhone('0100 123-4567'), { value: '01001234567', error: '' })
  assert.deepEqual(normalizePhone('٠١٠٠١٢٣٤٥٦٧'), { value: '01001234567', error: '' })
  assert.deepEqual(normalizePhone('(02) 2345.6789'), { value: '0223456789', error: '' })
  assert.deepEqual(normalizePhone('+20 100 123 4567'), { value: '+201001234567', error: '' })
  assert.deepEqual(normalizePhone('00201001234567'), { value: '+201001234567', error: '' })
  assert.deepEqual(normalizePhone(''), { value: '', error: '' })
})

test('invalid numbers get a message', () => {
  for (const bad of [
    '123',
    '0101234567',
    '010123456789',
    'abc12345',
    '12a4567',
    '+1234567890123456'
  ])
    assert.ok(normalizePhone(bad).error, bad)
})

test('at most two numbers; the second differs from the first; blanks are ignored', () => {
  assert.equal(MAX_PHONES, 2)
  assert.deepEqual(normalizePhones(['01011112222']), { phones: ['01011112222'], error: '' })
  assert.deepEqual(normalizePhones(['01011112222', '']), { phones: ['01011112222'], error: '' })
  assert.deepEqual(normalizePhones(['', '01011112222']), { phones: ['01011112222'], error: '' })
  assert.deepEqual(normalizePhones(['01011112222', '0101 111 2223']), {
    phones: ['01011112222', '01011112223'],
    error: ''
  })
  assert.match(normalizePhones(['01011112222', '010 1111 2222']).error, /مطابق/)
  assert.match(normalizePhones(['01011110001', '01011110002', '01011110003']).error, /رقمين/)
  assert.match(normalizePhones(['01011112222', '12']).error, /الرقم الثاني/)
})
