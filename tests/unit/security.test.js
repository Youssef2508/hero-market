'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { PERMISSIONS, KEYS, ALL, SYSTEM_ROLES } = require('../../src/server/auth/permissions')
const {
  pinLookup,
  hashPin,
  verifyPin,
  legacyCandidates,
  isValidPin
} = require('../../src/server/auth/pin')
const { normaliseDecimal, canonicalSource } = require('../../src/server/db/legacy-import')

const role = (key) => SYSTEM_ROLES.find((r) => r.key === key)

test('permission catalogue: unique keys, every built-in role uses known keys', () => {
  assert.equal(KEYS.size, PERMISSIONS.length)
  for (const r of SYSTEM_ROLES)
    for (const p of r.permissions) assert.ok(KEYS.has(p), `${r.key}: ${p}`)
  assert.deepEqual([...role('super_admin').permissions].sort(), [...ALL].sort())
})

test('built-in roles reproduce the original access rules', () => {
  assert.ok(!KEYS.has('pos.discount'), 'the manual discount permission no longer exists')
  assert.ok(role('store_admin').permissions.includes('discounts.manage'))
  // Cashier: sell (cash, wallets, credit), own shift, tills – nothing in management. No discount
  // authority at all (owner, 2026-10-15): discounts come only from the administrator's rules.
  // Returns only on request, completed by a supervisor (owner, 2026-10-14; phase 3).
  // Preliminary supplier invoices at the till (owner, 2026-10-21, D-064): total and payment only;
  // completing them (stock, cost) stays with suppliers.manage.
  assert.deepEqual(role('cashier').permissions.sort(), [
    'pos.credit',
    'pos.sell',
    'sales.return_request',
    'shifts.operate',
    'suppliers.pending',
    'tills.operate'
  ])
  assert.ok(!role('cashier').permissions.includes('suppliers.manage'), 'cannot complete them')
  assert.ok(!role('cashier').permissions.includes('sales.return'), 'no direct returns')
  assert.ok(!role('cashier').permissions.includes('pos.approve'), 'cannot approve')
  // Original manager: every management screen except users; no multi-till close, till deletion or reset.
  for (const p of [
    'users.manage',
    'roles.manage',
    'system.reset',
    'shifts.multi_till',
    'tills.manage',
    'discounts.manage'
  ]) {
    assert.ok(!role('manager').permissions.includes(p), `manager must not have ${p}`)
  }
  for (const p of [
    'reports.view',
    'products.manage',
    'sales.return',
    'customers.manage',
    'backup.manage',
    'logs.view'
  ]) {
    assert.ok(role('manager').permissions.includes(p), `manager keeps ${p}`)
  }
  assert.ok(
    role('auditor').permissions.every((p) => /\.view(_all|_cost)?$/.test(p)),
    'auditor is read-only'
  )
})

test('PIN storage: keyed lookup is deterministic per secret, scrypt verifies, wrong PIN fails', () => {
  const a = pinLookup('secret-one'.padEnd(32, 'x'), '4821')
  assert.equal(a, pinLookup('secret-one'.padEnd(32, 'x'), '4821'))
  assert.notEqual(a, pinLookup('secret-two'.padEnd(32, 'x'), '4821'))
  const h = hashPin('4821')
  assert.match(h, /^scrypt\$16384\$8\$1\$/)
  assert.notEqual(h, hashPin('4821'), 'salted')
  assert.ok(verifyPin('4821', h))
  assert.ok(!verifyPin('4822', h))
  assert.ok(!verifyPin('4821', 'plain-text'))
  assert.deepEqual(legacyCandidates(' 1234 '), [
    crypto.createHash('sha256').update('1234').digest('hex'),
    '1234'
  ])
  assert.ok(isValidPin('1234') && !isValidPin('12a4') && !isValidPin('123'))
})

test('legacy import keeps numbers and local times exactly', () => {
  assert.equal(normaliseDecimal('119.0'), '119')
  assert.equal(normaliseDecimal('24.150'), '24.15')
  assert.equal(normaliseDecimal('-0'), '0')
  assert.equal(
    canonicalSource(0.1 + 0.2, 'numeric'),
    '0.30000000000000004',
    'binary value preserved, not rounded'
  )
  assert.equal(canonicalSource(112.7, 'numeric'), '112.7')
  assert.equal(
    canonicalSource('2026-10-12 17:21:18', 'timestamp without time zone'),
    '2026-10-12 17:21:18'
  )
  assert.equal(canonicalSource('2026-10-12', 'timestamp without time zone'), '2026-10-12 00:00:00')
  assert.equal(canonicalSource(null, 'numeric'), null)
  assert.throws(() => canonicalSource('abc', 'numeric'), /non-numeric/)
  assert.throws(() => canonicalSource('12/10/2026', 'timestamp without time zone'), /unrecognised/)
})
