import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { movingAverage, roundQty } = createRequire(import.meta.url)(
  '../../src/server/inventory/stock.js'
)

test('moving average with stock on hand weights old and new cost', () => {
  assert.equal(movingAverage(10, 5, 10, 7), 6)
  assert.equal(movingAverage(15, 8, 5, 10), 8.5)
  // Fractional kilograms: 1.25 kg at 180 + 0.75 kg at 200 → 187.5
  assert.equal(movingAverage(1.25, 180, 0.75, 200), 187.5)
  // Rounded to 4 decimals: (3·1 + 1·2) / 4 = 1.25; (1·1 + 2·1) / 3 exact
  assert.equal(movingAverage(1, 1, 2, 1.0001), 1.0001)
  assert.equal(movingAverage(3, 1, 3, 0), 0.5)
})

test('no stock or negative stock: the receipt cost becomes the average', () => {
  assert.equal(movingAverage(0, 5, 10, 7), 7)
  assert.equal(movingAverage(-5, 6, 20, 8), 8) // receipt covers the negative and more
  assert.equal(movingAverage(-30, 6, 20, 8), 8) // still negative after the receipt
  assert.equal(movingAverage(null, null, 1, 3), 3)
})

test('invalid receipts are refused', () => {
  assert.throws(() => movingAverage(1, 1, 0, 1))
  assert.throws(() => movingAverage(1, 1, -2, 1))
  assert.throws(() => movingAverage(1, 1, 1, -1))
})

test('quantities round to three decimals (kilograms)', () => {
  assert.equal(roundQty(0.1 + 0.2), 0.3)
  assert.equal(roundQty(1.2345), 1.235)
  assert.equal(roundQty(-0.0004), -0)
})
