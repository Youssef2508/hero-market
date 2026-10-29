'use strict'
// The two supplier screens have their own permissions (owner, 1.5.2, D-097): «فواتير الموردين
// المبدئية» (suppliers.pending) and «سداد ديون الموردين» (suppliers.payment_request); each works
// alone, without the old drawers permission (tills.operate) or any other; approval stays separate.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

let db, svc, owner, pendingOnly, payOnly, supplierId
const ref = () => crypto.randomUUID()
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const role = async (name, perms) => {
  const id = (
    await svc.pool.query('INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id', [
      name,
      'اختبار'
    ])
  ).rows[0].id
  for (const p of perms)
    await svc.pool.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [
      id,
      p
    ])
  return id
}

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'p1', pin: '3141', roleKey: 'cashier' })
  await createUser(svc, { username: 'p2', pin: '2718', roleKey: 'cashier' })
  // Only the shift and one supplier feature each: no tills.operate, nothing else.
  const r1 = await role('فواتير مبدئية فقط', ['shifts.operate', 'suppliers.pending'])
  const r2 = await role('سداد موردين فقط', ['shifts.operate', 'suppliers.payment_request'])
  await svc.pool.query("UPDATE users SET role_id = $1 WHERE username = 'p1'", [r1])
  await svc.pool.query("UPDATE users SET role_id = $1 WHERE username = 'p2'", [r2])
  owner = await login(svc, '8642')
  pendingOnly = await login(svc, '3141')
  payOnly = await login(svc, '2718')
  supplierId = ok(await svc.call('suppliers.create', { name: 'مورد الشاشات' }, owner)).id
  ok(
    await svc.call(
      'suppliers.addPurchase',
      { supplierId, total_amount: 500, paid_amount: 0, payment_type: 'آجل' },
      owner
    )
  )
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('preliminary invoices with their permission alone; not the payment requests', async (t) => {
  if (!requireDb(t)) return
  const shift = ok(await svc.call('shifts.open', { startingCash: 300 }, pendingOnly))
  assert.ok(ok(await svc.call('supplierInvoices.suppliers', {}, pendingOnly)).length >= 1)
  const inv = ok(
    await svc.call(
      'supplierInvoices.createPending',
      {
        supplierId,
        total: 120,
        paymentMode: 'partial',
        paid: 20,
        currentShiftId: shift.id,
        clientRef: ref()
      },
      pendingOnly
    )
  ).invoice
  assert.equal(Number(inv.paid), 20)
  assert.equal(
    ok(await svc.call('supplierInvoices.list', { status: 'pending' }, pendingOnly)).length,
    1
  )
  for (const op of ['supplierPayments.suppliers', 'supplierPayments.list'])
    assert.equal((await svc.call(op, {}, pendingOnly)).status, 403, op)
  assert.equal(
    (
      await svc.call(
        'supplierPayments.create',
        { supplierId, amount: 10, currentShiftId: shift.id, clientRef: ref() },
        pendingOnly
      )
    ).status,
    403
  )
})

test('payment requests with their permission alone; not preliminary invoices, not approval', async (t) => {
  if (!requireDb(t)) return
  const shift = ok(await svc.call('shifts.open', { startingCash: 300 }, payOnly))
  assert.ok(ok(await svc.call('supplierPayments.suppliers', {}, payOnly)).length >= 1)
  const r = ok(
    await svc.call(
      'supplierPayments.create',
      { supplierId, amount: 50, currentShiftId: shift.id, clientRef: ref() },
      payOnly
    )
  ).request
  assert.equal(r.status, 'pending')
  assert.equal(ok(await svc.call('supplierPayments.list', {}, payOnly)).length, 1)
  assert.equal(
    (
      await svc.call(
        'supplierInvoices.createPending',
        {
          supplierId,
          total: 10,
          paymentMode: 'credit',
          currentShiftId: shift.id,
          clientRef: ref()
        },
        payOnly
      )
    ).status,
    403
  )
  for (const op of ['supplierPayments.approve', 'supplierPayments.reject'])
    assert.equal((await svc.call(op, { requestId: r.id, note: 'لا' }, payOnly)).status, 403, op)
  assert.equal((await svc.call('supplierPayments.pendingCount', {}, payOnly)).status, 403)
})

test('the old drawers permission is hidden from the roles screen; the supplier ones are explained', async (t) => {
  if (!requireDb(t)) return
  const catalog = ok(await svc.call('roles.catalog', {}, owner))
  const keys = catalog.map((p) => p.key)
  assert.ok(!keys.includes('tills.operate'))
  for (const k of ['suppliers.pending', 'suppliers.payment_request', 'suppliers.payment_approve'])
    assert.ok(keys.includes(k), k)
  const entry = (k) => catalog.find((p) => p.key === k)
  assert.equal(entry('suppliers.pending').label, 'فواتير الموردين المبدئية')
  assert.match(entry('suppliers.pending').description, /لا تحتاج صلاحية أخرى/)
  assert.match(entry('suppliers.payment_request').description, /لا تحتاج صلاحية أخرى/)
})
