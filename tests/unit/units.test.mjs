import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const {
  toBaseQty,
  validateFactor,
  unitPrice,
  parseScaleLabel,
  normalizeScaleLabels,
  DEFAULT_SCALE
} = createRequire(import.meta.url)('../../src/server/inventory/units.js')

test('count products: whole base units; packaging fractions allowed when they make whole pieces', () => {
  assert.deepEqual(toBaseQty('count', 3, 1), { qty: 3, baseQty: 3 })
  assert.deepEqual(toBaseQty('count', 1, 24), { qty: 1, baseQty: 24 })
  assert.deepEqual(toBaseQty('count', 0.5, 24), { qty: 0.5, baseQty: 12 })
  assert.deepEqual(toBaseQty('count', 0.25, 24), { qty: 0.25, baseQty: 6 })
  assert.throws(() => toBaseQty('count', 1.5, 1), /عدداً صحيحاً/)
  assert.throws(() => toBaseQty('count', 0.3, 24), /عدداً صحيحاً/)
  assert.throws(() => toBaseQty('count', 0, 1))
})

test('weighed products: kilograms with three decimals', () => {
  assert.deepEqual(toBaseQty('weight', 0.2, 1), { qty: 0.2, baseQty: 0.2 })
  assert.deepEqual(toBaseQty('weight', 1.25, 1), { qty: 1.25, baseQty: 1.25 })
  assert.deepEqual(toBaseQty('weight', 3, 0.5), { qty: 3, baseQty: 1.5 })
  assert.throws(() => toBaseQty('weight', 0.2505, 1), /ثلاث خانات/)
  assert.throws(() => toBaseQty('weight', 0.125, 0.125), /ثلاث خانات/) // 0.015625 kg
})

test('factors: whole for count products, three decimals otherwise', () => {
  assert.equal(validateFactor('count', 24), 24)
  assert.throws(() => validateFactor('count', 2.5))
  assert.equal(validateFactor('weight', 0.5), 0.5)
  assert.throws(() => validateFactor('weight', 0.0005))
  assert.throws(() => validateFactor('volume', 0))
})

test('prices: base keeps the exact price; a unit uses its own price or base × factor', () => {
  const p = { retail_price: 15.3333333333333 }
  assert.equal(unitPrice(p, { id: null, factor: 1 }), 15.3333333333333)
  assert.equal(unitPrice({ retail_price: 2.5 }, { id: 7, factor: 24, retail_price: null }), 60)
  assert.equal(unitPrice({ retail_price: 2.5 }, { id: 7, factor: 24, retail_price: 55 }), 55)
})

test('scale labels: default layout, unknown prefixes, invalid settings', () => {
  assert.deepEqual(parseScaleLabel(DEFAULT_SCALE, '2000777002503'), {
    code: '00777',
    kind: 'weight',
    value: 0.25
  })
  assert.deepEqual(parseScaleLabel(DEFAULT_SCALE, '2200777045004'), {
    code: '00777',
    kind: 'price',
    value: 45
  })
  assert.equal(parseScaleLabel(DEFAULT_SCALE, '6223001876366'), null)
  assert.equal(parseScaleLabel(DEFAULT_SCALE, '200077700250'), null) // 12 digits
  assert.equal(parseScaleLabel({ ...DEFAULT_SCALE, enabled: false }, '2000777002503'), null)
  assert.throws(() => normalizeScaleLabels('{bad'))
  assert.throws(() => normalizeScaleLabels(JSON.stringify({ ...DEFAULT_SCALE, codeStart: 12 })))
  assert.throws(() =>
    normalizeScaleLabels(JSON.stringify({ ...DEFAULT_SCALE, prefixes: { 2: 'volume' } }))
  )
  assert.deepEqual(JSON.parse(normalizeScaleLabels(JSON.stringify(DEFAULT_SCALE))), {
    ...DEFAULT_SCALE,
    prefixes: { 20: 'weight', 21: 'weight', 22: 'price', 25: 'weight' }
  })
})
