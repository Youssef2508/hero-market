// Invoice numbers as people see and type them (src/shared/saleNumber.mjs): the shop's as before,
// the cloud's as W-…, and every shown number finds its invoice again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLOUD_FIRST,
  saleRef,
  saleNo,
  parseSaleRef,
  isCloudSale
} from '../../src/shared/saleNumber.mjs'

test("the shop's numbers are unchanged", () => {
  assert.equal(saleRef(1), '1')
  assert.equal(saleRef(12345), '12345')
  assert.equal(saleNo(1), '1')
  assert.equal(saleNo(10000), '10000')
  assert.equal(saleNo(10001), '1', 'the till counts 1–10000 and starts again, as before')
  assert.equal(isCloudSale(999999999), false)
})

test("the cloud's invoices read W-1, W-2, … and never look like the shop's", () => {
  assert.equal(saleRef(CLOUD_FIRST), 'W-1')
  assert.equal(saleRef(CLOUD_FIRST + 16), 'W-17')
  assert.equal(saleNo(CLOUD_FIRST), 'W-1')
  assert.equal(saleNo(CLOUD_FIRST + 10000), 'W-1')
  assert.equal(isCloudSale(CLOUD_FIRST), true)
  assert.equal(saleRef(0), '—')
  assert.equal(saleNo(null), '?')
})

test('a typed number finds its invoice', () => {
  for (const id of [1, 77, 12345, CLOUD_FIRST, CLOUD_FIRST + 16])
    assert.equal(parseSaleRef(saleRef(id)), id)
  assert.equal(parseSaleRef('w17'), CLOUD_FIRST + 16)
  assert.equal(parseSaleRef('W - ١٧'), CLOUD_FIRST + 16)
  assert.equal(parseSaleRef('#١٢٣'), 123)
  assert.equal(parseSaleRef('W-0'), null)
  assert.equal(parseSaleRef('abc'), null)
  assert.equal(parseSaleRef(''), null)
})
