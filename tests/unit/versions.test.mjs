import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newerVersion } from '../../src/main/versions.js'

test('version order used to tell "data from a newer version" from "setup not finished"', () => {
  assert.equal(newerVersion('1.4.1', '1.4.0'), true)
  assert.equal(newerVersion('1.4.0', '1.4.1'), false)
  assert.equal(newerVersion('1.4.0', '1.4.0'), false)
  assert.equal(newerVersion('1.10.0', '1.9.9'), true, 'numeric, not text, order')
  assert.equal(newerVersion('1.4.1-test.1', '1.4.0'), true)
  assert.equal(
    newerVersion('1.4.0', '1.4.0-rc.2'),
    true,
    'a release is newer than its pre-releases'
  )
  assert.equal(newerVersion('1.4.0-rc.10', '1.4.0-rc.2'), true)
  assert.equal(newerVersion('0', '1.4.0'), false, 'unknown text is never newer')
  assert.equal(newerVersion(undefined, '1.4.0'), false)
})
