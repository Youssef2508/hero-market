import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { verifyPinnedChain, describeRoot, fingerprint } from '../../src/main/tlsPin.js'

// Public certificates captured from the compose TLS proxy (Caddy local CA): root, then the chain the
// server presented (leaf, intermediate, root). No private keys.
const fx = JSON.parse(
  fs.readFileSync(new URL('./fixtures/tls/caddy-chain.json', import.meta.url), 'utf8')
)
const during = new Date(new Date(fx.leafValidFrom).getTime() + 60 * 60 * 1000)
const after = new Date(new Date(fx.leafValidTo).getTime() + 60 * 1000)

test('pinned store root: the server chain is accepted for its address, within its validity', () => {
  assert.deepEqual(verifyPinnedChain(fx.chain, fx.root, '127.0.0.1', during), { ok: true })
  assert.deepEqual(verifyPinnedChain(fx.chain.slice(0, 2), fx.root, '127.0.0.1', during), {
    ok: true
  })
})

test('refused: other address, expired certificate, foreign root, broken chain', () => {
  assert.equal(verifyPinnedChain(fx.chain, fx.root, '192.168.1.99', during).ok, false)
  assert.equal(verifyPinnedChain(fx.chain, fx.root, 'evil.example', during).ok, false)
  assert.equal(verifyPinnedChain(fx.chain, fx.root, '127.0.0.1', after).ok, false)
  // The intermediate is not the pinned root: pinning it as "root" must not validate the leaf chain
  assert.equal(verifyPinnedChain([fx.chain[0]], fx.chain[0], '127.0.0.1', during).ok, false)
  // Leaf alone (intermediate missing) cannot be linked to the root
  assert.equal(verifyPinnedChain([fx.chain[0]], fx.root, '127.0.0.1', during).ok, false)
  assert.equal(verifyPinnedChain(['not a certificate'], fx.root, '127.0.0.1', during).ok, false)
})

test('only a CA certificate can be pinned; fingerprint is the SHA-256 shown to the owner', () => {
  const root = describeRoot(fx.root)
  assert.match(root.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
  assert.equal(root.fingerprint, fingerprint(fx.root))
  assert.throws(() => describeRoot(fx.chain[0]), /CA/)
})
