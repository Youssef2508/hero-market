'use strict'
// Customers with up to two phone numbers (owner, 2026-10-15).
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts
} = require('./helpers')
const { createPool } = require('../../src/server/db/pool')
const { migrate, listMigrations } = require('../../src/server/db/migrate')

let db, svc, admin, cashier, shift
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const create = (body) => svc.call('clients.create', body, admin)
const update = (body) => svc.call('clients.update', body, admin)
const count = async () => (await one('SELECT count(*)::int AS n FROM clients')).n

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, retail_price, stock_qty, unit) VALUES ('W', 'مياه', 6, 50, 'زجاجة')"
  )
  admin = await login(svc, '8642')
  cashier = await login(svc, '5173')
  shift = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier))
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('one number: saved in a single clean form; the second stays empty', async (t) => {
  if (!requireDb(t)) return
  const c = ok(await create({ name: 'أحمد', phones: ['0100 123-4567'] }))
  assert.deepEqual([c.phone, c.phone2], ['01001234567', null])
  // Old clients sending only "phone" still work.
  const legacy = ok(await create({ name: 'قديم', phone: '٠١٢٢٢٣٣٣٤٤٤' }))
  assert.deepEqual([legacy.phone, legacy.phone2], ['01222333444', null])
  // No number at all is allowed.
  const none = ok(await create({ name: 'بدون هاتف', phones: [] }))
  assert.deepEqual([none.phone, none.phone2], [null, null])
})

test('two numbers: created, shown, searchable by either; second removed on edit', async (t) => {
  if (!requireDb(t)) return
  const c = ok(
    await create({ name: 'منى', phones: ['01011112222', '+20 2 2345 6789'], address: 'الدقي' })
  )
  assert.deepEqual([c.phone, c.phone2], ['01011112222', '+20223456789'])
  const profile = ok(await svc.call('clients.profile', { clientId: c.id }, admin))
  assert.deepEqual([profile.client.phone, profile.client.phone2], ['01011112222', '+20223456789'])
  const byList = ok(await svc.call('clients.list', { search: '2345' }, admin))
  assert.ok(
    byList.some((x) => x.id === c.id),
    'customers screen finds the second number'
  )
  const byPos = ok(await svc.call('pos.searchClients', { term: '223456' }, cashier))
  assert.ok(
    byPos.some((x) => x.id === c.id),
    'till finds the second number'
  )
  // Edit: keep only the primary → second removed.
  const edited = ok(await update({ id: c.id, name: 'منى', phones: ['01011112222'] }))
  assert.equal(edited.phone2, null)
  // Edit: add a second number again.
  const again = ok(await update({ id: c.id, name: 'منى', phones: ['01011112222', '01533334444'] }))
  assert.equal(again.phone2, '01533334444')
  // Only the second filled in: it becomes the primary.
  const only2 = ok(await create({ name: 'رقم واحد', phones: ['', '01099998888'] }))
  assert.deepEqual([only2.phone, only2.phone2], ['01099998888', null])
})

test('invalid numbers are refused and nothing is saved', async (t) => {
  if (!requireDb(t)) return
  const before = await count()
  for (const phones of [
    ['123'],
    ['0101234567'], // Egyptian mobile with 10 digits
    ['abc12345'],
    ['01011112223', 'xyz'],
    ['01011112223', '01011112223'], // same number twice
    ['1234567890123456'] // 16 digits
  ]) {
    const r = await create({ name: 'خطأ', phones })
    assert.equal(r.status, 400, JSON.stringify(phones))
  }
  assert.equal(await count(), before)
})

test('a third number is refused by the API and by the database design', async (t) => {
  if (!requireDb(t)) return
  const before = await count()
  const r = await create({ name: 'ثلاثة', phones: ['01011110001', '01011110002', '01011110003'] })
  assert.equal(r.status, 400)
  assert.equal(await count(), before)
  const cols = (
    await q(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'clients' AND column_name LIKE 'phone%' ORDER BY 1"
    )
  ).map((x) => x.column_name)
  assert.deepEqual(cols, ['phone', 'phone2'], 'the schema holds at most two numbers')
  // A second number without a primary is impossible in the database itself.
  await assert.rejects(q("INSERT INTO clients (name, phone2) VALUES ('خطأ', '01011110004')"))
})

test('a number belongs to one customer, in either slot (service and database)', async (t) => {
  if (!requireDb(t)) return
  const a = ok(await create({ name: 'أ', phones: ['01200000001', '01200000002'] }))
  for (const phones of [['01200000002'], ['01200000009', '01200000001'], ['0120 0000 002']]) {
    const r = await create({ name: 'ب', phones })
    assert.equal(r.status, 409, JSON.stringify(phones))
  }
  // Editing a customer may keep its own numbers.
  ok(await update({ id: a.id, name: 'أ', phones: ['01200000002', '01200000001'] }))
  // Direct database writes cannot bypass it either.
  await assert.rejects(
    q("INSERT INTO clients (name, phone) VALUES ('مباشر', '01200000001')"),
    /مسجل لعميل آخر/
  )
})

test('checkout: a typed number matches a customer by either number; invalid numbers are refused', async (t) => {
  if (!requireDb(t)) return
  const c = ok(await create({ name: 'زبون آجل', phones: ['01300000001', '01300000002'] }))
  const before = await count()
  const sale = ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: shift.id,
        paymentType: 'آجل',
        items: [{ barcode: 'W', qty: 1, unitPrice: 6 }],
        client: { id: null, name: 'اسم مختلف', phone: '0130 000 0002', address: '' }
      },
      cashier
    )
  )
  assert.equal(sale.clientId, c.id, 'matched by the second number')
  assert.equal(await count(), before, 'no duplicate customer created')
  const bad = await svc.call(
    'pos.checkout',
    {
      clientRef: crypto.randomUUID(),
      shiftId: shift.id,
      paymentType: 'آجل',
      items: [{ barcode: 'W', qty: 1, unitPrice: 6 }],
      client: { id: null, name: 'جديد', phone: '0130', address: '' }
    },
    cashier
  )
  assert.equal(bad.status, 400)
})

test('migration 0007 keeps every existing customer and number unchanged', async (t) => {
  if (!requireDb(t)) return
  const fresh = await freshDatabase()
  const pool = createPool(fresh.url, { max: 2 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig7-'))
  try {
    for (const m of listMigrations().filter((x) => Number(x.version) < 7))
      fs.copyFileSync(
        path.join(__dirname, '../../src/server/db/migrations', `${m.name}.sql`),
        path.join(tmp, `${m.name}.sql`)
      )
    const quiet = { info() {} }
    await migrate(pool, { dir: tmp, logger: quiet })
    await pool.query(`INSERT INTO clients (name, phone, debt_balance) VALUES
      ('قديم 1', '0100 111 2222', 50), ('قديم 2', NULL, 0), ('قديم 3', '+201001112223', -10)`)
    const before = (
      await pool.query('SELECT id, name, phone, debt_balance::text FROM clients ORDER BY id')
    ).rows
    await migrate(pool, { logger: quiet })
    const after = (
      await pool.query(
        'SELECT id, name, phone, debt_balance::text, phone2 FROM clients ORDER BY id'
      )
    ).rows
    assert.deepEqual(
      after.map(({ phone2, ...r }) => r),
      before
    )
    assert.ok(after.every((r) => r.phone2 === null))
  } finally {
    await pool.end()
    await fresh.dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
