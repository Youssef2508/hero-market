// Stock as complete packages and loose units (owner, 2026-10-21, D-065): floor, never ceiling.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { packagesOf, packagesText } from '../../src/shared/packages.mjs'

test('complete packages use floor; the rest are loose units', () => {
  assert.deepEqual(packagesOf(100, 10), { packages: 10, loose: 0 })
  assert.deepEqual(packagesOf(95, 10), { packages: 9, loose: 5 })
  assert.deepEqual(packagesOf(80, 10), { packages: 8, loose: 0 })
  assert.deepEqual(packagesOf(9, 10), { packages: 0, loose: 9 })
  assert.equal(packagesText(95, 10, 'علبة', 'قطعة'), '9 علبة + 5 قطعة')
  assert.equal(packagesText(100, 10, 'علبة', 'قطعة'), '10 علبة')
  // No package, no stock or negative stock: nothing to show.
  assert.equal(packagesOf(95, 1), null)
  assert.equal(packagesOf(0, 10), null)
  assert.equal(packagesOf(-5, 10), null)
  // A changed package size changes only how the same stock is shown.
  assert.deepEqual(packagesOf(95, 12), { packages: 7, loose: 11 })
})
