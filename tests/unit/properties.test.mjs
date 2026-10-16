// Property-based tests (1.4.0 audit): invariants checked on thousands of generated inputs instead
// of a few examples. Expected values are independent invariants, not a copy of the formulas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fc from 'fast-check'
import { normalizePhone, normalizePhones } from '../../src/shared/phone.mjs'
import { normalizeAddresses, MAX_ADDRESSES } from '../../src/shared/address.mjs'
import { parseWeight } from '../../src/renderer/src/lib/weight.js'

const require = createRequire(import.meta.url)
const { priceCart } = require('../../src/server/pricing/discounts.js')
const { toBaseQty } = require('../../src/server/inventory/units.js')

const RUNS = { numRuns: 3000, seed: 20261015 }
const piastres = (n) => Math.round(n * 100)

const lineArb = fc.record({
  barcode: fc.constantFrom('A', 'B', 'C', 'D'),
  grossCents: fc.integer({ min: 1, max: 5_000_000 }), // up to EGP 50,000 per line
  baseQty: fc.integer({ min: 1, max: 300 })
})
const ruleArb = fc.record({
  id: fc.integer({ min: 1, max: 1000 }),
  scope: fc.constantFrom('product', 'cart'),
  product_barcode: fc.constantFrom('A', 'B', 'C', 'D'),
  value_type: fc.constantFrom('percent', 'amount'),
  value: fc.oneof(fc.integer({ min: 0, max: 100 }), fc.double({ min: 0, max: 100, noNaN: true })),
  min_total: fc.integer({ min: 0, max: 200_000 })
})

test('discounts: shares are whole piastres, add up exactly, never exceed a line, never negative', () => {
  fc.assert(
    fc.property(
      fc.array(lineArb, { minLength: 1, maxLength: 25 }),
      fc.array(ruleArb, { maxLength: 8 }),
      (raw, rules) => {
        const seenBarcodes = new Set()
        const lines = raw
          .filter((l) => !seenBarcodes.has(l.barcode) && seenBarcodes.add(l.barcode))
          .map((l, i) => ({
            key: i,
            barcode: l.barcode,
            gross: l.grossCents / 100,
            baseQty: l.baseQty
          }))
        const uniqueRules = rules.map((r, i) => ({ ...r, id: i + 1 }))
        const r = priceCart(lines, uniqueRules)
        const subC = lines.reduce((a, l) => a + piastres(l.gross), 0)
        assert.equal(piastres(r.subTotal), subC)
        let lineSum = 0
        let cartSum = 0
        for (const [i, pl] of r.lines.entries()) {
          for (const v of [pl.lineDiscount, pl.cartDiscount, pl.net])
            assert.ok(Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'whole piastres')
          assert.ok(pl.lineDiscount >= 0 && pl.cartDiscount >= 0)
          assert.ok(pl.net >= 0, 'a line never goes below zero')
          assert.equal(
            piastres(pl.lineDiscount) + piastres(pl.cartDiscount) + piastres(pl.net),
            piastres(lines[i].gross)
          )
          lineSum += piastres(pl.lineDiscount)
          cartSum += piastres(pl.cartDiscount)
        }
        assert.equal(lineSum + cartSum, piastres(r.discount), 'discount = sum of the shares')
        assert.equal(piastres(r.afterDiscount), subC - piastres(r.discount))
        assert.ok(r.discount <= r.subTotal + 1e-9)
        // At most one cart rule applies (tiers do not stack).
        assert.ok(r.applied.filter((a) => a.scope === 'cart').length <= 1)
      }
    ),
    RUNS
  )
})

test('discounts: the result does not depend on the order of the cart lines', () => {
  fc.assert(
    fc.property(
      fc.array(lineArb, { minLength: 2, maxLength: 6 }),
      fc.array(ruleArb, { maxLength: 5 }),
      (raw, rules) => {
        const seen = new Set()
        const lines = raw
          .filter((l) => !seen.has(l.barcode) && seen.add(l.barcode))
          .map((l, i) => ({
            key: i,
            barcode: l.barcode,
            gross: l.grossCents / 100,
            baseQty: l.baseQty
          }))
        const rr = rules.map((r, i) => ({ ...r, id: i + 1 }))
        const a = priceCart(lines, rr)
        const b = priceCart([...lines].reverse(), rr)
        assert.equal(a.discount, b.discount)
        assert.equal(a.afterDiscount, b.afterDiscount)
      }
    ),
    RUNS
  )
})

const arabic = (s) => s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d])

test('phones: cleaning is idempotent, Arabic digits equal Latin ones, separators never matter', () => {
  fc.assert(
    fc.property(
      fc.stringMatching(/^01[0125][0-9]{8}$/),
      fc.array(fc.constantFrom(' ', '-', '.', '(', ')'), { maxLength: 4 }),
      (num, seps) => {
        const r = normalizePhone(num)
        assert.equal(r.error, '')
        assert.equal(normalizePhone(r.value).value, r.value, 'idempotent')
        assert.equal(normalizePhone(arabic(num)).value, r.value)
        const spaced = num.slice(0, 3) + seps.join('') + num.slice(3)
        assert.equal(normalizePhone(spaced).value, r.value)
      }
    ),
    RUNS
  )
  fc.assert(
    fc.property(fc.string({ maxLength: 30 }), (s) => {
      const r = normalizePhone(s)
      // Whatever is accepted is 7–15 digits, optionally with a leading +.
      if (!r.error && r.value) assert.match(r.value, /^\+?\d{7,15}$/)
      const many = normalizePhones([s, s, s])
      if (!many.error) assert.ok(many.phones.length <= 2)
    }),
    RUNS
  )
})

test('addresses: never more than three, exactly one default when any, blanks dropped', () => {
  const entry = fc.record({
    address: fc.oneof(
      fc.constant(''),
      fc.constant('   '),
      fc.string({ minLength: 2, maxLength: 40 })
    ),
    label: fc.constantFrom('home', 'work', 'other', 'villa', undefined),
    isDefault: fc.boolean()
  })
  fc.assert(
    fc.property(fc.array(entry, { maxLength: 6 }), (list) => {
      const r = normalizeAddresses(list)
      if (r.error) return
      assert.ok(r.addresses.length <= MAX_ADDRESSES)
      if (r.addresses.length) assert.equal(r.addresses.filter((a) => a.isDefault).length, 1)
      for (const a of r.addresses) {
        assert.ok(a.address.length >= 2 && a.address === a.address.trim())
        assert.ok(['home', 'work', 'other'].includes(a.label))
      }
    }),
    RUNS
  )
})

test('weights: grams typed at the till become kilograms with at most three decimals', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 1_000_000 }), (grams) => {
      const r = parseWeight(String(grams), 'g')
      if (grams > 1_000_000) return
      assert.equal(r.error, '')
      assert.equal(Math.round(r.kg * 1000), grams)
      assert.equal(parseWeight(arabic(String(grams)), 'g').kg, r.kg, 'Arabic digits')
    }),
    RUNS
  )
})

test('units: base quantities are exact multiples; count products accept only whole pieces', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 500 }),
      fc.integer({ min: 1, max: 48 }),
      (qty, factor) => {
        const { baseQty } = toBaseQty('count', qty, factor, 'x')
        assert.equal(baseQty, qty * factor)
      }
    ),
    RUNS
  )
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 99 }), (n) => {
      assert.throws(() => toBaseQty('count', n + 0.5, 1, 'x'))
      const w = toBaseQty('weight', n / 1000, 1, 'x')
      assert.equal(Math.round(w.baseQty * 1000), n)
    }),
    RUNS
  )
})
