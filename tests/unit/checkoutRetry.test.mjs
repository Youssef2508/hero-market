import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkoutFingerprint,
  outcomeUnknown,
  planCheckout
} from '../../src/renderer/src/lib/checkoutRetry.js'

test('outcome unknown only when the request may have reached the service', () => {
  // Lost reply: dropped link, timeout, proxy error, unexpected failure
  assert.ok(outcomeUnknown({ status: 503, code: 'server_unreachable' }))
  assert.ok(outcomeUnknown({ status: 503, code: 'error' }))
  assert.ok(outcomeUnknown({ status: 502 }))
  assert.ok(outcomeUnknown(new Error('boom')))
  // Definite answers or never sent
  assert.ok(!outcomeUnknown({ status: 409, code: 'conflict' }))
  assert.ok(!outcomeUnknown({ status: 400, code: 'bad_request' }))
  assert.ok(!outcomeUnknown({ status: 503, code: 'backend_unavailable' }))
  assert.ok(!outcomeUnknown({ status: 503, code: 'server_certificate' }))
  assert.ok(!outcomeUnknown({ status: 0, code: 'no_bridge' }))
})

test('the same cart is retried under the same reference; a changed cart is checked first', () => {
  const cart = { shiftId: 7, items: [{ barcode: 'A1', qty: 2, unitPrice: 10.5 }], discount: 0 }
  const fp = checkoutFingerprint(cart)
  assert.deepEqual(planCheckout(null, fp), { clientRef: null, checkFirst: null })
  const unresolved = { clientRef: 'ref-1234-abcd', fingerprint: fp }
  assert.deepEqual(planCheckout(unresolved, checkoutFingerprint({ ...cart })), {
    clientRef: 'ref-1234-abcd',
    checkFirst: null
  })
  const changed = checkoutFingerprint({
    ...cart,
    items: [{ barcode: 'A1', qty: 3, unitPrice: 10.5 }]
  })
  assert.deepEqual(planCheckout(unresolved, changed), {
    clientRef: null,
    checkFirst: 'ref-1234-abcd'
  })
})
