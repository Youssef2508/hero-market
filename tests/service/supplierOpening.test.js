'use strict'
// SUP-03 (owner, 2026-10-22, D-070): a supplier's opening balance and editable contact details.
// The owner's example: a supplier is owed EGP 2,000 at setup. The opening balance is its own
// ledger line (never a purchase, payment or stock receipt); later payments reduce it and reach the
// treasury exactly once; a correction adds the difference and keeps the earlier line. Editing the
// contact changes no invoice, payment or balance. The opening balance needs its own permission.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

let db, svc, owner, storekeeper, supplier
const ref = () => crypto.randomUUID()
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const debt = async (id = supplier.id) =>
  Number((await q('SELECT debt_balance FROM suppliers WHERE id = $1', [id]))[0].debt_balance)

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'store', pin: '5173', roleKey: 'inventory' })
  owner = await login(svc, '8642')
  storekeeper = await login(svc, '5173')
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a supplier owed 2,000 at setup: one opening line, no purchase, stock or money', async (t) => {
  if (!requireDb(t)) return
  supplier = ok(
    await svc.call(
      'suppliers.create',
      {
        name: 'مورد الافتتاح',
        phone: '0223456789',
        contact_person: 'أ. سامي',
        openingBalance: 2000
      },
      owner
    )
  )
  assert.equal(await debt(), 2000)
  assert.deepEqual(
    await q(
      'SELECT type, amount::float8 a, description FROM supplier_ledger WHERE supplier_id = $1',
      [supplier.id]
    ),
    [{ type: 'opening', a: 2000, description: 'رصيد افتتاحي' }]
  )
  for (const table of ['supplier_purchases', 'stock_movements', 'safe_ledger', 'treasury_ledger'])
    assert.equal((await q(`SELECT COUNT(*)::int n FROM ${table}`))[0].n, 0, table)
  const profile = ok(await svc.call('suppliers.profile', { supplierId: supplier.id }, owner))
  assert.equal(profile.supplier.opening_balance, 2000)
})

test('a later payment reduces it and leaves the treasury once', async (t) => {
  if (!requireDb(t)) return
  ok(await svc.call('treasury.record', { kind: 'deposit', amount: 1000, clientRef: ref() }, owner))
  const clientRef = ref()
  const pay = () =>
    svc.call(
      'suppliers.repay',
      { supplierId: supplier.id, amount: 500, destination: 'treasury', method: 'cash', clientRef },
      owner
    )
  ok(await pay())
  ok(await pay())
  assert.equal(await debt(), 1500)
  const out = await q(
    "SELECT COUNT(*)::int n, SUM(amount)::float8 s FROM treasury_ledger WHERE kind = 'supplier_payment'"
  )
  assert.deepEqual(out, [{ n: 1, s: -500 }])
})

test('correcting the opening balance adds the difference; the same value again changes nothing', async (t) => {
  if (!requireDb(t)) return
  ok(await svc.call('suppliers.setOpening', { supplierId: supplier.id, amount: 1800 }, owner))
  assert.equal(await debt(), 1300, '1500 − 200')
  ok(await svc.call('suppliers.setOpening', { supplierId: supplier.id, amount: 1800 }, owner))
  assert.equal(await debt(), 1300)
  const lines = await q(
    "SELECT amount::float8 a, description FROM supplier_ledger WHERE supplier_id = $1 AND type = 'opening' ORDER BY id",
    [supplier.id]
  )
  assert.deepEqual(lines, [
    { a: 2000, description: 'رصيد افتتاحي' },
    { a: -200, description: 'تعديل الرصيد الافتتاحي: من 2000.00 إلى 1800.00' }
  ])
  // A supplier that owed the store at setup: a negative opening balance.
  const other = ok(
    await svc.call('suppliers.create', { name: 'مورد مدين لنا', openingBalance: -350 }, owner)
  )
  assert.equal(await debt(other.id), -350)
  const log = await q(
    "SELECT description FROM system_logs WHERE action_type = 'supplier_opening' ORDER BY id"
  )
  assert.equal(log.length, 3)
  assert.match(log[2].description, /350\.00 ج\.م مستحقة على المورد/)
})

test('the opening balance needs its own permission; contact editing does not', async (t) => {
  if (!requireDb(t)) return
  assert.equal(
    (await svc.call('suppliers.create', { name: 'س', openingBalance: 10 }, storekeeper)).status,
    403
  )
  assert.equal(
    (await svc.call('suppliers.setOpening', { supplierId: supplier.id, amount: 0 }, storekeeper))
      .status,
    403
  )
  ok(await svc.call('suppliers.create', { name: 'مورد بدون رصيد' }, storekeeper))
  ok(
    await svc.call(
      'suppliers.update',
      {
        supplierId: supplier.id,
        name: 'مورد الافتتاح',
        phone: '01001234567',
        contact_person: 'أ. سامي'
      },
      storekeeper
    )
  )
  assert.equal(await debt(), 1300)
})

test('editing the contact keeps invoices, payments and balances; bad input is refused', async (t) => {
  if (!requireDb(t)) return
  const ledgerBefore = await q('SELECT * FROM supplier_ledger WHERE supplier_id = $1 ORDER BY id', [
    supplier.id
  ])
  const r = ok(
    await svc.call(
      'suppliers.update',
      {
        supplierId: supplier.id,
        name: 'شركة الافتتاح للتوريدات',
        phone: '0233334444',
        address: 'المنطقة الصناعية',
        contact_person: 'أ. محمود'
      },
      owner
    )
  )
  assert.deepEqual(
    [r.name, r.phone, r.address, r.contact_person],
    ['شركة الافتتاح للتوريدات', '0233334444', 'المنطقة الصناعية', 'أ. محمود']
  )
  assert.deepEqual(
    await q('SELECT * FROM supplier_ledger WHERE supplier_id = $1 ORDER BY id', [supplier.id]),
    ledgerBefore
  )
  assert.equal(await debt(), 1300)
  const log = (
    await q(
      "SELECT details FROM system_logs WHERE action_type = 'supplier_update' ORDER BY id DESC LIMIT 1"
    )
  )[0]
  assert.match(log.details, /أ\. محمود/)
  assert.equal(
    (await svc.call('suppliers.update', { supplierId: supplier.id, name: '  ' }, owner)).status,
    400
  )
  assert.equal(
    (
      await svc.call(
        'suppliers.update',
        { supplierId: supplier.id, name: 'س', phone: 'abc' },
        owner
      )
    ).status,
    400
  )
})
