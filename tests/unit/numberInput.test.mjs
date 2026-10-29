// Amount and quantity fields (D-085): Arabic-Indic digits and the Arabic decimal sign are taken as
// typed; nothing is silently read as another number (the browser's number field read 12٫5 as 125).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toLatinNumber } from '../../src/renderer/src/lib/numberInput.js'

test('Arabic-Indic and Persian digits become 0–9', () => {
  assert.equal(toLatinNumber('١٥٠'), '150')
  assert.equal(toLatinNumber('۱۲۳'), '123')
  assert.equal(toLatinNumber('150'), '150')
  assert.equal(toLatinNumber('٠'), '0')
})

test('the Arabic decimal sign and a comma are the decimal point; the thousands sign is dropped', () => {
  assert.equal(toLatinNumber('12٫5'), '12.5')
  assert.equal(toLatinNumber('١٢٫٥'), '12.5')
  assert.equal(toLatinNumber('12,5'), '12.5')
  assert.equal(toLatinNumber('١٬٢٠٠'), '1200')
  assert.equal(toLatinNumber(' 1 200 '), '1200')
})

test('only one point and a leading minus remain; other characters are dropped', () => {
  assert.equal(toLatinNumber('1.2.3'), '1.23')
  assert.equal(toLatinNumber('-5'), '-5')
  assert.equal(toLatinNumber('5-'), '5')
  assert.equal(toLatinNumber('12ج.م'), '12.')
  assert.equal(toLatinNumber('abc'), '')
  assert.equal(toLatinNumber(''), '')
  assert.equal(toLatinNumber(null), '')
  // Typing in progress keeps its shape: "12." stays so the next digit can follow.
  assert.equal(toLatinNumber('12.'), '12.')
  assert.equal(toLatinNumber('.5'), '.5')
})
