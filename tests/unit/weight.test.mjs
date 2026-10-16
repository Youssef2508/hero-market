import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWeight, receiptQty } from '../../src/renderer/src/lib/weight.js'
import { buildReceiptLines, defaultTemplate } from '../../src/shared/receipt.mjs'

test('manual weight entry: grams and kilograms', () => {
  assert.deepEqual(parseWeight('100'), { kg: 0.1, error: '' })
  assert.deepEqual(parseWeight('250'), { kg: 0.25, error: '' })
  assert.deepEqual(parseWeight('300', 'g'), { kg: 0.3, error: '' })
  assert.deepEqual(parseWeight('1000'), { kg: 1, error: '' })
  assert.deepEqual(parseWeight('1', 'kg'), { kg: 1, error: '' })
  assert.deepEqual(parseWeight('0.25', 'kg'), { kg: 0.25, error: '' })
  assert.deepEqual(parseWeight('1,25', 'kg'), { kg: 1.25, error: '' })
  assert.deepEqual(parseWeight('٢٥٠'), { kg: 0.25, error: '' }) // Arabic-Indic digits
  assert.deepEqual(parseWeight(''), { kg: 0, error: '' })
})

test('invalid weights are explained, never rounded silently', () => {
  for (const [text, unit] of [
    ['0', 'g'],
    ['-250', 'g'],
    ['abc', 'g'],
    ['250.5', 'g'],
    ['0.2505', 'kg'],
    ['2000', 'kg']
  ]) {
    const r = parseWeight(text, unit)
    assert.equal(r.kg, 0, `${text} ${unit}`)
    assert.ok(r.error.length > 0, `${text} ${unit} has a message`)
  }
})

test('receipt quantity: weighed lines print kilograms with three decimals', () => {
  assert.equal(receiptQty(0.25, { kind: 'weight', unitId: null, unitName: 'كجم' }), '0.250 كجم')
  assert.equal(receiptQty(1, { kind: 'weight', unitId: null }), '1.000 كجم')
  assert.equal(receiptQty(3, { kind: 'count', unitId: null }), 3)
  assert.equal(receiptQty(1, { kind: 'count', unitId: 7, unitName: 'كرتونة' }), 1)
})

test('a printed receipt shows 0.250 كجم of bramili cheese at 240 = 60.00', () => {
  const lines = buildReceiptLines(defaultTemplate('80mm'), {
    saleId: 1,
    date: '15/10/2026',
    time: '03:45 PM',
    cashier: 'cashier',
    items: [{ name: 'جبنة برميلي', barcode: 'BRAM', qty: '0.250 كجم', price: 240, total: 60 }],
    subTotal: 60,
    discount: 0,
    total: 60,
    paid: 60,
    change: 0
  })
  const row = lines.find((l) => l.includes('جبنة برميلي'))
  assert.ok(row, lines.join('\n'))
  assert.match(row, /0\.250 كجم/)
  assert.match(row, /60\.00/)
})

test('receipt quantity for kinds the owner adds: their decimals and unit (migration 0014)', () => {
  assert.equal(
    receiptQty(1.5, {
      kind: 'custom_1',
      unitId: null,
      unitName: 'متر',
      decimals: 2,
      kindUnit: 'متر'
    }),
    '1.50 متر'
  )
  assert.equal(
    receiptQty(2, { kind: 'custom_1', unitId: null, decimals: 1, kindUnit: 'م' }),
    '2.0 م'
  )
  // Whole-number kinds and packaging lines print the plain quantity, as before.
  assert.equal(receiptQty(3, { kind: 'custom_2', unitId: null, decimals: 0, kindUnit: 'دستة' }), 3)
  assert.equal(receiptQty(2, { kind: 'custom_1', unitId: 7, decimals: 2, kindUnit: 'متر' }), 2)
})
