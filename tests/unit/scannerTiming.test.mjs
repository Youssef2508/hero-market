import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createScannerState,
  endScan,
  recordScannerKey
} from '../../src/renderer/src/hooks/scannerTiming.js'

// Mirrors useBarcode with the scan field focused: a key either appends, or (first scanner-speed
// pair of a scan that began after Enter or a pause) replaces the field with prevChar + key.
// Enter submits and ends the scan.
function typeIntoFocusedField(state, start, keys) {
  let value = start
  for (const [key, at] of keys) {
    if (key === 'Enter') {
      endScan(state)
      continue
    }
    const { replacesField, prevChar } = recordScannerKey(state, key, at)
    value = replacesField ? prevChar + key : value + key
  }
  return value
}

const scan = (code, t0, gap = 4, stallBefore = -1, stallMs = 0) =>
  [...code].map((ch, i) => [
    ch,
    t0 + i * gap + (stallBefore >= 0 && i >= stallBefore ? stallMs : 0)
  ])

test('K-19: a renderer stall in the middle of a scan does not cut the barcode', () => {
  const state = createScannerState()
  // Reproduced on 2026-10-14: a >100 ms stall before the 9th digit left "76366" in the field.
  const value = typeIntoFocusedField(state, '', [
    ...scan('6223001876366', 10_000, 4, 8, 150),
    ['Enter', 10_300]
  ])
  assert.equal(value, '6223001876366')
})

test('K-19: digits delivered late by a busy renderer are kept when the scan speeds up', () => {
  const state = createScannerState()
  // Reproduced after a reload: the first nine digits were handled 50-170 ms apart, then the
  // backlog cleared and the field was replaced by "63".
  const gaps = [0, 176, 148, 69, 63, 52, 61, 65, 173, 64, 19, 21, 18]
  let t = 50_000
  const keys = [...'6223001876366'].map((ch, i) => [ch, (t += gaps[i])])
  assert.equal(typeIntoFocusedField(state, '', keys), '6223001876366')
})

test('consecutive scans each replace the field, also after leftover manual text', () => {
  const state = createScannerState()
  let value = typeIntoFocusedField(state, '', [...scan('00515', 10_000), ['Enter', 10_030]])
  assert.equal(value, '00515')
  // The field was cleared by the checkout; the next scan follows 400 ms later.
  value = typeIntoFocusedField(state, '', [...scan('6223001876366', 10_430)])
  assert.equal(value, '6223001876366')
  endScan(state)
  // Manual text typed slowly, then a pause and a scan: the scan replaces it.
  value = typeIntoFocusedField(state, '', [
    ['1', 20_000],
    ['2', 20_300]
  ])
  assert.equal(value, '12')
  value = typeIntoFocusedField(state, value, scan('00516', 21_500))
  assert.equal(value, '00516')
})

test('manual typing is never treated as a scan', () => {
  const state = createScannerState()
  const keys = [...'00515'].map((ch, i) => [ch, 5_000 + i * 120])
  for (const [key, at] of keys) assert.equal(recordScannerKey(state, key, at).isScanner, false)
})
