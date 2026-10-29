import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { latestPurchaseCost, roundQty } = createRequire(import.meta.url)(
  '../../src/server/inventory/stock.js'
)

// 1.5.2 (D-087): the latest purchase price replaces the moving average.
test('a receipt sets the purchase price to its own cost, whatever was paid before', () => {
  assert.equal(latestPurchaseCost(10, 220), 220)
  assert.equal(latestPurchaseCost(0.75, 200), 200) // fractional kilograms
  assert.equal(latestPurchaseCost(1, 180), 180) // a cheaper purchase lowers it the same way
  assert.equal(latestPurchaseCost(3, 0), 0)
  // Rounded to 4 decimals (per base unit: 100 for a box of 12 → 8.3333).
  assert.equal(latestPurchaseCost(12, 100 / 12), 8.3333)
})

test('invalid receipts are refused', () => {
  assert.throws(() => latestPurchaseCost(0, 1))
  assert.throws(() => latestPurchaseCost(-2, 1))
  assert.throws(() => latestPurchaseCost(1, -1))
})

test('quantities round to three decimals (kilograms)', () => {
  assert.equal(roundQty(0.1 + 0.2), 0.3)
  assert.equal(roundQty(1.2345), 1.235)
  assert.equal(roundQty(-0.0004), -0)
})
