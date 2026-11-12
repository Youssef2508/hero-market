// A phone page left open across a cloud update (architecture §14.1): it reloads once, at the next
// change of screen, and only when the cloud's version differs from its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  setOwnVersion,
  noteServerVersion,
  reloadIfUpdated
} from '../../src/renderer/src/lib/appUpdate.js'

test('the same version, or no version named: nothing happens', () => {
  let reloads = 0
  setOwnVersion('1.6.0')
  noteServerVersion('1.6.0')
  noteServerVersion(null)
  assert.equal(
    reloadIfUpdated(() => reloads++),
    false
  )
  assert.equal(reloads, 0)
})

test('a newer cloud: one reload at the next screen change', () => {
  let reloads = 0
  setOwnVersion('1.6.0')
  noteServerVersion('1.6.1')
  noteServerVersion('1.6.1')
  assert.equal(
    reloadIfUpdated(() => reloads++),
    true
  )
  assert.equal(
    reloadIfUpdated(() => reloads++),
    false
  )
  assert.equal(reloads, 1)
})

test('the desktop program (no version set) never reloads', () => {
  let reloads = 0
  setOwnVersion(null)
  noteServerVersion('9.9.9')
  assert.equal(
    reloadIfUpdated(() => reloads++),
    false
  )
  assert.equal(reloads, 0)
})
