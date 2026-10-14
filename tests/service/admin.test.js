'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

let db, svc, owner, manager, cashier
const q = async (sql, params) => (await svc.pool.query(sql, params)).rows
const roleId = async (key) => (await q('SELECT id FROM roles WHERE key = $1', [key]))[0].id

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  owner = (await svc.call('auth.setup', { username: 'owner', pin: '9090' })).body.token
  await createUser(svc, { username: 'mgr', pin: '3030', roleKey: 'manager' })
  await createUser(svc, { username: 'cash', pin: '4040', roleKey: 'cashier' })
  manager = await login(svc, '3030')
  cashier = await login(svc, '4040')
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('server-side authorization: direct calls without the permission are refused', async (t) => {
  if (!requireDb(t)) return
  for (const op of [
    'users.list',
    'roles.list',
    'settings.get',
    'backup.export',
    'system.reset',
    'logs.list'
  ]) {
    assert.equal(
      (await svc.call(op, { confirm: 'RESET' }, cashier)).status,
      403,
      `${op} refused for cashier`
    )
  }
  assert.equal(
    (await svc.call('users.list', {}, manager)).status,
    403,
    'manager cannot manage users (legacy rule)'
  )
  assert.equal((await svc.call('products.page', {}, manager)).status, 200)
  const list = await svc.call('users.list', {}, owner)
  assert.equal(list.status, 200)
  assert.ok(
    list.body.every((u) => !('password_hash' in u) && !('pin_hash' in u)),
    'no PIN material leaves the server'
  )
})

test('custom role: create, assign, permissions take effect immediately, revoke', async (t) => {
  if (!requireDb(t)) return
  const created = await svc.call(
    'roles.create',
    { name: 'مراجع مخزن', description: 'عرض فقط', permissions: ['products.view'] },
    owner
  )
  assert.equal(created.status, 200)
  const u = await svc.call(
    'users.create',
    { username: 'viewer', pin: '5151', roleId: created.body.id },
    owner
  )
  assert.equal(u.status, 200)
  const viewer = await login(svc, '5151')
  assert.equal((await svc.call('products.page', {}, viewer)).status, 200)
  assert.equal((await svc.call('sales.page', {}, viewer)).status, 403)
  const upd = await svc.call(
    'roles.update',
    { id: created.body.id, name: 'مراجع مخزن', permissions: ['products.view', 'sales.view'] },
    owner
  )
  assert.deepEqual(upd.body.added, ['sales.view'])
  assert.equal(
    (await svc.call('sales.page', {}, viewer)).status,
    200,
    'new permission applies to the existing session'
  )
  await svc.call(
    'roles.update',
    { id: created.body.id, name: 'مراجع مخزن', permissions: [] },
    owner
  )
  assert.equal(
    (await svc.call('products.page', {}, viewer)).status,
    403,
    'revocation applies immediately'
  )
  assert.equal(
    (await svc.call('roles.delete', { id: created.body.id }, owner)).status,
    409,
    'role in use cannot be deleted'
  )
  const logs = await q("SELECT action_type FROM system_logs WHERE action_type LIKE 'role_%'")
  assert.ok(logs.length >= 3, 'role changes are audited')
})

test('no escalation: cannot grant or assign beyond your own permissions', async (t) => {
  if (!requireDb(t)) return
  // A delegated administrator with roles.manage + users.manage but without system.reset.
  const delegated = (
    await svc.call(
      'roles.create',
      { name: 'مدير مستخدمين', permissions: ['users.manage', 'roles.manage', 'products.view'] },
      owner
    )
  ).body.id
  await svc.call('users.create', { username: 'deleg', pin: '6161', roleId: delegated }, owner)
  const d = await login(svc, '6161')
  assert.equal(
    (await svc.call('roles.create', { name: 'تصعيد', permissions: ['system.reset'] }, d)).status,
    403
  )
  assert.equal(
    (
      await svc.call(
        'users.create',
        { username: 'x1', pin: '7171', roleId: await roleId('super_admin') },
        d
      )
    ).status,
    403
  )
  assert.equal(
    (
      await svc.call(
        'users.create',
        { username: 'x2', pin: '7272', roleId: await roleId('store_admin') },
        d
      )
    ).status,
    403
  )
  assert.equal(
    (
      await svc.call(
        'roles.update',
        { id: await roleId('super_admin'), name: 'مدير النظام', permissions: [] },
        owner
      )
    ).status,
    403,
    'protected role is fixed'
  )
  const me = (await svc.call('auth.me', {}, d)).body
  assert.equal(
    (
      await svc.call(
        'users.update',
        { id: me.id, username: 'deleg', roleId: await roleId('cashier') },
        d
      )
    ).status,
    403,
    'no self role change'
  )
})

test('the last active super administrator cannot be removed, demoted or disabled', async (t) => {
  if (!requireDb(t)) return
  const ownerId = (await svc.call('auth.me', {}, owner)).body.id
  assert.equal(
    (
      await svc.call(
        'users.update',
        { id: ownerId, username: 'owner', roleId: await roleId('super_admin'), isActive: false },
        owner
      )
    ).status,
    403
  )
  const second = await svc.call(
    'users.create',
    { username: 'owner2', pin: '8282', roleId: await roleId('super_admin') },
    owner
  )
  assert.equal(second.status, 200)
  const owner2 = await login(svc, '8282')
  // owner2 demotes owner: allowed because another super admin (owner2) remains
  assert.equal(
    (
      await svc.call(
        'users.update',
        { id: ownerId, username: 'owner', roleId: await roleId('store_admin') },
        owner2
      )
    ).status,
    200
  )
  // now owner2 is the last one: owner (store_admin) cannot demote or delete owner2
  assert.equal(
    (await svc.call('users.delete', { id: second.body.id }, owner)).status,
    403,
    'store admin cannot touch a super admin'
  )
  await svc.call(
    'users.update',
    { id: ownerId, username: 'owner', roleId: await roleId('super_admin') },
    owner2
  )
})

test('disabling a user revokes their sessions', async (t) => {
  if (!requireDb(t)) return
  const id = (await svc.call('auth.me', {}, cashier)).body.id
  assert.equal(
    (
      await svc.call(
        'users.update',
        { id, username: 'cash', roleId: await roleId('cashier'), isActive: false },
        owner
      )
    ).status,
    200
  )
  assert.equal((await svc.call('auth.me', {}, cashier)).status, 401)
  assert.equal((await svc.call('auth.login', { pin: '4040' })).status, 401)
  await svc.call(
    'users.update',
    { id, username: 'cash', roleId: await roleId('cashier'), isActive: true },
    owner
  )
  cashier = await login(svc, '4040')
})

test('settings: validated, audited, visible to every terminal', async (t) => {
  if (!requireDb(t)) return
  assert.equal(
    (await svc.call('settings.update', { values: { audit_interval_minutes: '1' } }, owner)).status,
    400
  )
  assert.equal(
    (await svc.call('settings.update', { values: { store_name: 'x|y' } }, owner)).status,
    400
  )
  assert.equal(
    (await svc.call('settings.update', { values: { unknown_key: '1' } }, owner)).status,
    400
  )
  const ok = await svc.call(
    'settings.update',
    { values: { store_name: 'هيرو ماركت – المعادي', default_opening_cash: '300' } },
    owner
  )
  assert.deepEqual(ok.body.changed.sort(), ['default_opening_cash', 'store_name'])
  const pub = (await svc.call('settings.public', {}, cashier)).body
  assert.equal(pub.settings.store_name, 'هيرو ماركت – المعادي')
  assert.equal(
    pub.receiptTemplates['80mm'].id,
    null,
    'built-in default template until one is activated'
  )
})

test('receipt templates: validated, saved, activated per paper size', async (t) => {
  if (!requireDb(t)) return
  const bad = await svc.call(
    'receipts.save',
    { name: 'خطأ', config: { paper: '80mm', style: { fontSize: 30 } } },
    owner
  )
  assert.equal(bad.status, 400)
  const saved = await svc.call(
    'receipts.save',
    {
      name: 'فاتورة مختصرة',
      config: {
        paper: '58mm',
        items: { showUnitPrice: false },
        footer: { lines: ['نسعد بخدمتكم'] }
      }
    },
    owner
  )
  assert.equal(saved.status, 200)
  assert.equal((await svc.call('receipts.activate', { id: saved.body.id }, owner)).status, 200)
  const pub = (await svc.call('settings.public', {}, cashier)).body
  // A template in the version-1 format is stored as a version-2 block layout with the same choices.
  const active = pub.receiptTemplates['58mm'].config
  assert.equal(active.version, 2)
  assert.equal(active.blocks.find((b) => b.type === 'items').showUnitPrice, false)
  assert.equal(
    active.blocks.find((b) => b.type === 'text' && b.zone === 'bottom').text,
    'نسعد بخدمتكم'
  )
  assert.equal(
    (await svc.call('receipts.delete', { id: saved.body.id }, owner)).status,
    409,
    'active template cannot be deleted'
  )
})

test('backup → restore round trip restores every row exactly', async (t) => {
  if (!requireDb(t)) return
  await q(
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty) VALUES ('R1', 'صنف للنسخ', 1.1, 2.2333, 7.125)`
  )
  const snapshot = async () => {
    const out = {}
    for (const tname of [
      'products',
      'users',
      'roles',
      'role_permissions',
      'settings',
      'receipt_templates',
      'system_logs'
    ]) {
      out[tname] = (
        await q(
          `SELECT md5(string_agg(x::text, '|' ORDER BY x::text)) AS h, count(*) AS n FROM ${tname} x`
        )
      )[0]
    }
    return out
  }
  const exported = await svc.call('backup.export', {}, owner)
  assert.equal(exported.status, 200)
  const before = await snapshot()
  await q(`UPDATE products SET retail_price = 99 WHERE barcode = 'R1'`)
  await q(`DELETE FROM settings`)
  const restored = await svc.call(
    'backup.restore',
    { backup: exported.body, confirm: 'RESTORE' },
    owner
  )
  assert.equal(restored.status, 200, JSON.stringify(restored.body))
  const after = await snapshot()
  for (const tname of [
    'products',
    'users',
    'roles',
    'role_permissions',
    'settings',
    'receipt_templates'
  ]) {
    assert.deepEqual(after[tname], before[tname], `${tname} restored exactly`)
  }
  assert.equal(
    (await svc.call('auth.me', {}, owner)).status,
    401,
    'sessions are cleared by a restore'
  )
  owner = await login(svc, '9090')
  const tampered = { ...exported.body, schema: ['0001'] }
  assert.equal(
    (await svc.call('backup.restore', { backup: tampered, confirm: 'RESTORE' }, owner)).status,
    400,
    'other schema versions refused'
  )
  void crypto
})
