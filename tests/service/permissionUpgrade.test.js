'use strict'
// Permissions on an existing installation (owner, 1.5.2, D-094). New keys are granted once to the
// built-in roles that include them by default; a key with a prerequisite only where that
// prerequisite is held now; nothing an owner assigned or took away is undone; custom roles get
// nothing new. Allowed and denied cases of the purchase correction permission.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

let db, svc
const q = async (s, sql, p) => (await s.pool.query(sql, p)).rows
const holders = async (s, key) =>
  (
    await q(
      s,
      'SELECT COALESCE(r.key, r.name) k FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission = $1 ORDER BY 1',
      [key]
    )
  ).map((x) => x.k)

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a fresh install: the purchase correction goes to the roles that manage purchases', async (t) => {
  if (!requireDb(t)) return
  assert.deepEqual(await holders(svc, 'suppliers.purchase_edit'), [
    'inventory',
    'manager',
    'store_admin',
    'super_admin'
  ])
})

test('an upgrade grants new keys once, respects prerequisites and the owner’s changes', async (t) => {
  if (!requireDb(t)) return
  // As a 1.5.1 store left it: the 1.5.2 keys unknown; the owner took purchases away from the
  // supervisor, gave a custom role purchases, and removed «التقارير» from the cashier… (a key
  // the cashier never had: nothing to undo) and «المرتجعات» from the store administrator.
  const keys = [
    'suppliers.purchase_edit',
    'suppliers.payment_request',
    'suppliers.payment_approve',
    'customers.code'
  ]
  await svc.pool.query('DELETE FROM role_permissions WHERE permission = ANY($1)', [keys])
  await svc.pool.query('DELETE FROM permission_catalog WHERE key = ANY($1)', [keys])
  await svc.pool.query(
    "DELETE FROM role_permissions rp USING roles r WHERE r.id = rp.role_id AND r.key = 'manager' AND rp.permission = 'suppliers.manage'"
  )
  await svc.pool.query(
    "DELETE FROM role_permissions rp USING roles r WHERE r.id = rp.role_id AND r.key = 'store_admin' AND rp.permission = 'sales.return'"
  )
  const custom = (
    await svc.pool.query(
      "INSERT INTO roles (name, description) VALUES ('مشتريات فقط', 'دور خاص') RETURNING id"
    )
  ).rows[0].id
  await svc.pool.query(
    "INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'suppliers.manage'), ($1, 'suppliers.view')",
    [custom]
  )
  const before = await q(
    svc,
    'SELECT role_id, permission FROM role_permissions WHERE NOT (permission = ANY($1)) ORDER BY 1, 2',
    [keys]
  )
  // The new version starts on that database.
  await svc.close()
  svc = await startService(db.url)
  // Prerequisite held: inventory, store and super administrators; not the supervisor (purchases
  // taken away) and not the custom role (custom roles get nothing new).
  assert.deepEqual(await holders(svc, 'suppliers.purchase_edit'), [
    'inventory',
    'store_admin',
    'super_admin'
  ])
  assert.deepEqual(await holders(svc, 'suppliers.payment_request'), ['store_admin', 'super_admin'])
  assert.deepEqual(await holders(svc, 'suppliers.payment_approve'), ['store_admin', 'super_admin'])
  assert.deepEqual(await holders(svc, 'customers.code'), ['store_admin', 'super_admin'])
  // Nothing else changed: the owner's removals stay removed, the custom role keeps its grants.
  const afterRows = await q(
    svc,
    'SELECT role_id, permission FROM role_permissions WHERE NOT (permission = ANY($1)) ORDER BY 1, 2',
    [keys]
  )
  assert.deepEqual(afterRows, before)
  // A second start grants nothing again (each key once): the owner may now take it away.
  await svc.pool.query(
    "DELETE FROM role_permissions rp USING roles r WHERE r.id = rp.role_id AND r.key = 'inventory' AND rp.permission = 'suppliers.purchase_edit'"
  )
  await svc.close()
  svc = await startService(db.url)
  assert.deepEqual(await holders(svc, 'suppliers.purchase_edit'), ['store_admin', 'super_admin'])
})

test('the purchase correction: allowed with its permission, refused without it', async (t) => {
  if (!requireDb(t)) return
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'buyer', pin: '3816', roleKey: 'manager' })
  const owner = await login(svc, '8642')
  const buyer = await login(svc, '3816')
  const s = await svc.call('suppliers.create', { name: 'مورد الصلاحيات' }, owner)
  const p = await svc.call(
    'suppliers.addPurchase',
    {
      supplierId: s.body.id,
      total_amount: 10,
      paid_amount: 0,
      payment_type: 'آجل',
      clientRef: crypto.randomUUID()
    },
    owner
  )
  assert.equal(p.status, 200)
  // The supervisor lost purchases and the correction above: refused.
  const refused = await svc.call(
    'suppliers.updatePurchase',
    { purchaseId: p.body.purchaseId, notes: 'x' },
    buyer
  )
  assert.equal(refused.status, 403)
  // Granted the correction alone (by the owner): allowed, even without managing suppliers.
  await svc.pool.query(
    "INSERT INTO role_permissions (role_id, permission) SELECT id, 'suppliers.purchase_edit' FROM roles WHERE key = 'manager'"
  )
  const buyer2 = await login(svc, '3816')
  const allowed = await svc.call(
    'suppliers.updatePurchase',
    { purchaseId: p.body.purchaseId, notes: 'تصحيح' },
    buyer2
  )
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body))
  // But not a new purchase, which needs «إدارة الموردين والمشتريات».
  const buy = await svc.call(
    'suppliers.addPurchase',
    { supplierId: s.body.id, total_amount: 5, paid_amount: 0, payment_type: 'آجل' },
    buyer2
  )
  assert.equal(buy.status, 403)
})
