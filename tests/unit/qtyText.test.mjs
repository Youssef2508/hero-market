// Quantity typed in a cart line (owner feedback POS-01): 0.5 can be typed step by step.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { qtyFromText } from '../../src/renderer/src/lib/qtyText.js'

test('typing 0.5 key by key: no step resets the line, the last one sets 0.5', () => {
  // "0" alone is a zero (removes the line only when leaving the box), "0." is incomplete.
  assert.deepEqual(qtyFromText('0'), { value: null, zero: true })
  assert.deepEqual(qtyFromText('0.'), { value: null, zero: false })
  assert.deepEqual(qtyFromText('0.5'), { value: '0.5', zero: false })
  assert.deepEqual(qtyFromText('.5'), { value: '.5', zero: false })
  assert.deepEqual(qtyFromText('0.125'), { value: '0.125', zero: false })
})

test('Arabic digits and decimal separators; invalid text is not a quantity', () => {
  assert.equal(qtyFromText('٠٫٥').value, '0.5')
  assert.equal(qtyFromText('1,25').value, '1.25')
  assert.equal(qtyFromText(' 3 ').value, '3')
  for (const bad of ['', '.', 'abc', '1.2.3', '-1', '1e3', '٢x'])
    assert.equal(qtyFromText(bad).value, null, bad)
  assert.equal(qtyFromText('0.000').zero, true)
})
