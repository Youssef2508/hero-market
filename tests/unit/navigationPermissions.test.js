'use strict'
// ROLE-02 (D-075): every permission the menu uses is a real one from the catalogue, so a typo can
// never hide or show a screen by accident. The service checks the same keys on every request.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { KEYS } = require('../../src/server/auth/permissions')

test('menu permissions all exist in the permission catalogue', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../src/renderer/src/components/shell/navigation.js'),
    'utf8'
  )
  const used = new Set()
  for (const m of src.matchAll(/permission:\s*\[([^\]]*)\]/g))
    for (const k of m[1].matchAll(/'([^']+)'/g)) used.add(k[1])
  assert.ok(used.size > 20, `found ${used.size} menu permissions`)
  const unknown = [...used].filter((k) => !KEYS.has(k))
  assert.deepEqual(unknown, [])
})
