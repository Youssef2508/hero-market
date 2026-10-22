'use strict'
// UX-01 (D-078): every screen in the menu is described in .docs/UI_INVENTORY.md (by its id), so a
// new screen cannot be added without its purpose, permission, actions and tests being written down.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

test('every menu screen is in the UI inventory', (t) => {
  const doc = path.join(__dirname, '../../.docs/UI_INVENTORY.md')
  if (!fs.existsSync(doc)) return t.skip('no .docs folder in this checkout')
  const nav = fs.readFileSync(
    path.join(__dirname, '../../src/renderer/src/components/shell/navigation.js'),
    'utf8'
  )
  // Screen entries carry a view; groups carry items.
  const ids = [...nav.matchAll(/id: '([^']+)',[^{}]*?view: '/g)].map((m) => m[1])
  assert.ok(ids.length > 25, `found ${ids.length} screens`)
  const text = fs.readFileSync(doc, 'utf8')
  const missing = ids.filter((id) => !text.includes(`(\`${id}\`)`))
  assert.deepEqual(missing, [], 'add these screens to .docs/UI_INVENTORY.md')
})
