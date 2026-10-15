import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { priceCart } = createRequire(import.meta.url)('../../src/server/pricing/discounts.js')

const line = (key, barcode, gross, baseQty = 1) => ({ key, barcode, gross, baseQty })
const P = (id, barcode, valueType, value) => ({
  id,
  name: `p${id}`,
  scope: 'product',
  product_barcode: barcode,
  value_type: valueType,
  value,
  min_total: 0
})
const C = (id, minTotal, valueType, value) => ({
  id,
  name: `c${id}`,
  scope: 'cart',
  product_barcode: null,
  value_type: valueType,
  value,
  min_total: minTotal
})

test('no rules: normal price', () => {
  const r = priceCart([line(0, 'A', 99.99)], [])
  assert.deepEqual([r.subTotal, r.discount, r.afterDiscount, r.applied], [99.99, 0, 99.99, []])
})

test('thresholds are inclusive and evaluated after product discounts', () => {
  const tiers = [C(1, 500, 'percent', 5), C(2, 1000, 'percent', 10)]
  assert.equal(priceCart([line(0, 'A', 499.99)], tiers).discount, 0)
  assert.equal(priceCart([line(0, 'A', 500)], tiers).discount, 25)
  assert.equal(priceCart([line(0, 'A', 999.99)], tiers).discount, 50)
  assert.equal(priceCart([line(0, 'A', 1000)], tiers).discount, 100)
  // 520 gross, 30 product discount → 490 eligible: no tier.
  const r = priceCart([line(0, 'A', 520)], [...tiers, P(3, 'A', 'amount', 30)])
  assert.deepEqual([r.productDiscount, r.cartDiscount], [30, 0])
})

test('best rule wins, ties go to the older rule; amounts are capped at the line', () => {
  const r = priceCart([line(0, 'A', 100, 2)], [P(1, 'A', 'percent', 10), P(2, 'A', 'amount', 5)])
  assert.equal(r.lines[0].productRule.id, 1) // 10 vs 10: older rule
  const capped = priceCart([line(0, 'A', 10, 1)], [P(3, 'A', 'amount', 25)])
  assert.equal(capped.lines[0].lineDiscount, 10)
  const fixed = priceCart([line(0, 'A', 30)], [C(4, 0, 'amount', 50)])
  assert.deepEqual([fixed.cartDiscount, fixed.afterDiscount], [30, 0])
})

test('cart discount shares add up exactly and never exceed a line (generated cases)', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let n = 0; n < 500; n++) {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, i) =>
      line(
        i,
        `X${Math.floor(rnd() * 3)}${i}`,
        Math.round(rnd() * 50000) / 100,
        1 + Math.floor(rnd() * 5)
      )
    )
    const rules = [
      C(
        1,
        Math.round(rnd() * 600),
        rnd() < 0.5 ? 'percent' : 'amount',
        Math.round(rnd() * 3000) / 100 + 0.01
      ),
      P(2, lines[0].barcode, 'percent', Math.round(rnd() * 5000) / 100 + 0.01)
    ]
    const r = priceCart(lines, rules)
    const sum = (xs) => xs.reduce((s, x) => s + Math.round(x * 100), 0)
    assert.equal(sum(r.lines.map((l) => l.cartDiscount)), Math.round(r.cartDiscount * 100))
    assert.equal(sum(r.lines.map((l) => l.lineDiscount)), Math.round(r.productDiscount * 100))
    for (const l of r.lines) {
      assert.ok(l.net >= 0, JSON.stringify(l))
      assert.equal(
        Math.round(l.net * 100),
        Math.round(l.gross * 100) -
          Math.round(l.lineDiscount * 100) -
          Math.round(l.cartDiscount * 100)
      )
    }
    assert.equal(Math.round(r.afterDiscount * 100), sum(r.lines.map((l) => l.net)))
    assert.ok(r.discount <= r.subTotal + 1e-9)
  }
})
