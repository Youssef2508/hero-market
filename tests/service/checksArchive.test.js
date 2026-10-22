'use strict'
// Cheques (owner, 2026-10-21, D-060, NAV-02): processing is removed, the old records are kept, and
// only administrators may read them. Nothing may create, settle or delete a cheque.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

let db, svc, owner, storeAdmin, manager, cashier
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'storeadmin', pin: '7531', roleKey: 'store_admin' })
  await createUser(svc, { username: 'manager', pin: '9517', roleKey: 'manager' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  storeAdmin = await login(svc, '7531')
  manager = await login(svc, '9517')
  cashier = await login(svc, '5173')
  // Records kept from before cheques were removed (written as the old screen did).
  await svc.pool.query(
    `INSERT INTO checks_register (check_type, check_number, bank_name, party_name, issue_date, due_date, amount, status, notes, created_at)
     VALUES ('مورد', '1001', 'بنك', 'مورد قديم', '2026-09-01', '2026-10-01', 1000, 'غير مسدد', '', LOCALTIMESTAMP(0)),
            ('عميل', '1002', 'بنك', 'عميل قديم', '2026-09-02', '2026-10-02', 250.5, 'مسدد', 'ملاحظة', LOCALTIMESTAMP(0))`
  )
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('administrators read the old cheques, unchanged and complete', async (t) => {
  if (!requireDb(t)) return
  for (const token of [owner, storeAdmin]) {
    const r = await svc.call('checks.archive', {}, token)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.rows.length, 2)
    assert.deepEqual(r.body.rows.map((c) => c.party_name).sort(), ['عميل قديم', 'مورد قديم'])
    assert.equal(Number(r.body.rows.find((c) => c.check_number === '1002').amount), 250.5)
  }
})

test('managers and cashiers cannot see the archive', async (t) => {
  if (!requireDb(t)) return
  for (const token of [manager, cashier]) {
    assert.equal((await svc.call('checks.archive', {}, token)).status, 403)
  }
  // Holding the old key (stored roles keep it) grants nothing any more.
  const perms = await q(
    "SELECT r.key FROM roles r JOIN role_permissions rp ON rp.role_id = r.id WHERE rp.permission = 'checks.archive' ORDER BY 1"
  )
  assert.deepEqual(
    perms.map((p) => p.key),
    ['store_admin', 'super_admin']
  )
})

test('no operation records, settles or deletes a cheque any more; the records stay', async (t) => {
  if (!requireDb(t)) return
  const before = await q('SELECT * FROM checks_register ORDER BY id')
  const [first] = before
  const attempts = [
    [
      'checks.create',
      { check_type: 'مورد', party_name: 'جديد', due_date: '2026-11-01', amount: 5 }
    ],
    ['checks.markPaid', { checkId: first.id }],
    ['checks.delete', { checkId: first.id }],
    ['checks.list', {}]
  ]
  for (const [name, body] of attempts) {
    const r = await svc.call(name, body, owner)
    assert.notEqual(r.status, 200, `${name} must not exist`)
    assert.equal(r.status, 404, `${name}: ${r.status}`)
  }
  assert.deepEqual(await q('SELECT * FROM checks_register ORDER BY id'), before)
})
