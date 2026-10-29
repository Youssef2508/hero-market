// The sidebar layout (1.5.2, D-095): every screen placed exactly once, nothing removed, the daily
// selling screens first, and the groups as reorganized.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const nav = await import('../../src/renderer/src/components/shell/navigation.js')

test('every defined screen is in the sidebar exactly once', () => {
  assert.deepEqual(nav.LAYOUT_PROBLEMS, [])
  assert.equal(nav.ALL_NAV_ITEMS.length, 32)
  assert.equal(new Set(nav.ALL_NAV_ITEMS.map((i) => i.id)).size, 32)
})

test('the groups, with the day’s selling first', () => {
  assert.deepEqual(
    nav.NAV_GROUPS.map((g) => [g.label, g.items.map((i) => i.id)]),
    [
      ['البيع اليومي', ['pos', 'returns', 'reprint', 'payment-change']],
      [
        'الحسابات',
        [
          'sales',
          'clients',
          'suppliers',
          'supplier-pending',
          'supplier-payments',
          'expenses',
          'treasury'
        ]
      ],
      ['المخزون', ['inventory', 'movements', 'categories', 'reordering', 'damaged']],
      ['التقارير', ['menu', 'advanced-stats', 'cashier-performance', 'bestsellers', 'stockvalue']],
      ['الإدارة', ['shifts', 'users', 'roles', 'discounts']],
      ['النظام', ['settings', 'receipts', 'backup', 'import', 'sync', 'logs', 'checks']]
    ]
  )
})

test('permissions still decide what each user sees', () => {
  // The built-in cashier (D-097): the till, returns and preliminary supplier invoices; the old
  // drawers permission opens nothing.
  const cashier = {
    permissions: ['pos.sell', 'tills.operate', 'sales.return_request', 'suppliers.pending']
  }
  assert.deepEqual(
    nav.visibleGroups(cashier).map((g) => [g.id, g.items.map((i) => i.id)]),
    [
      ['sell', ['pos', 'returns']],
      ['accounts', ['supplier-pending']]
    ]
  )
  // Each supplier screen with its own permission alone.
  const payer = { permissions: ['suppliers.payment_request'] }
  assert.deepEqual(
    nav.visibleGroups(payer).flatMap((g) => g.items.map((i) => i.id)),
    ['supplier-payments']
  )
  assert.equal(nav.canOpenTab(payer, 'supplier-payments'), true)
  assert.equal(nav.canOpenTab(payer, 'supplier-pending'), false)
  assert.equal(
    nav.canOpenTab({ permissions: ['suppliers.payment_approve'] }, 'supplier-payments'),
    true
  )
  assert.equal(
    nav.ALL_NAV_ITEMS.some((i) => i.id === 'tills'),
    false
  )
  assert.equal(nav.canOpenTab(cashier, 'users'), false)
  assert.equal(nav.canOpenTab({ permissions: ['users.manage'] }, 'users'), true)
  // The page found for a state carries its new group (the top bar shows it).
  assert.equal(nav.activeItem('admin', 'treasury').group.label, 'الحسابات')
})
