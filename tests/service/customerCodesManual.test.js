'use strict'
// Customer codes typed by hand (owner, 1.5.2, D-086). Automatic stays the default (C + number).
// With «تحديد كود العميل يدوياً» a code may be typed when adding a customer or changed later; it is
// unique ignoring upper and lower case, in the database; past invoices keep the code they were sold
// with; the automatic code never collides with a typed one.
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

let db, svc, owner, manager, cashier
const ok = (r, what = '') => {
  assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`)
  return r.body
}
const codeOf = async (id) =>
  (await svc.pool.query('SELECT code FROM clients WHERE id = $1', [id])).rows[0].code
const create = (body, token = owner) => svc.call('clients.create', body, token)

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'manager', pin: '9517', roleKey: 'manager' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, retail_price, stock_qty, unit) VALUES ('P', 'صنف', 10, 100, 'قطعة')"
  )
  owner = await login(svc, '8642')
  manager = await login(svc, '9517')
  cashier = await login(svc, '5173')
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('the permission: administrators by default, not supervisors or cashiers', async (t) => {
  if (!requireDb(t)) return
  const holders = (
    await svc.pool.query(
      "SELECT r.key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission = 'customers.code' ORDER BY r.key"
    )
  ).rows.map((r) => r.key)
  assert.deepEqual(holders, ['store_admin', 'super_admin'])
})

test('automatic by default; a typed code with the permission; refused without it', async (t) => {
  if (!requireDb(t)) return
  const auto = ok(await create({ name: 'تلقائي' }))
  assert.match(auto.code, /^C\d{5,}$/)
  const typed = ok(await create({ name: 'يدوي', code: '  VIP-12  ' }))
  assert.equal(typed.code, 'VIP-12', 'trimmed')
  const arabic = ok(await create({ name: 'كود عربي', code: 'عميل-٧' }))
  assert.equal(arabic.code, 'عميل-٧')
  // A supervisor who manages customers but has not got the code permission.
  const refused = await create({ name: 'بلا صلاحية', code: 'X-1' }, manager)
  assert.equal(refused.status, 403)
  // Without a code, the supervisor still adds customers with the automatic code.
  assert.match(ok(await create({ name: 'مشرف تلقائي' }, manager)).code, /^C\d{5,}$/)
})

test('a code already used is refused before and at saving, ignoring letter case', async (t) => {
  if (!requireDb(t)) return
  const check = ok(await svc.call('clients.codeAvailable', { code: 'vip-12' }, owner))
  assert.equal(check.available, false)
  assert.equal(check.owner.name, 'يدوي')
  assert.equal(
    ok(await svc.call('clients.codeAvailable', { code: 'VIP-13' }, owner)).available,
    true
  )
  const dup = await create({ name: 'مكرر', code: 'vip-12' })
  assert.equal(dup.status, 409)
  assert.match(dup.body.error.message, /مستخدم للعميل "يدوي"/)
  // The check itself needs the permission.
  assert.equal((await svc.call('clients.codeAvailable', { code: 'x' }, manager)).status, 403)
})

test('two terminals saving the same code at the same moment: exactly one gets it', async (t) => {
  if (!requireDb(t)) return
  const tries = await Promise.all(
    Array.from({ length: 6 }, (_, i) => create({ name: `متزامن ${i}`, code: 'SAME-1' }))
  )
  assert.equal(tries.filter((r) => r.status === 200).length, 1)
  assert.ok(tries.filter((r) => r.status !== 200).every((r) => r.status === 409))
  const n = (
    await svc.pool.query("SELECT count(*)::int AS n FROM clients WHERE upper(code) = 'SAME-1'")
  ).rows[0].n
  assert.equal(n, 1)
})

test('the automatic code moves past a code typed by hand', async (t) => {
  if (!requireDb(t)) return
  const next =
    Number((await svc.pool.query('SELECT last_value FROM clients_id_seq')).rows[0].last_value) + 1
  const taken = `C${String(next).padStart(5, '0')}`
  // Someone types exactly the code the next customer would get.
  ok(await create({ name: 'سبق الكود', code: taken.toLowerCase() }))
  const auto = ok(await create({ name: 'التالي' }))
  assert.notEqual(auto.code.toUpperCase(), taken)
  assert.match(auto.code, /^C\d{5,}(-\d+)?$/)
})

test('changing a code: with the permission, logged; past sales keep their code', async (t) => {
  if (!requireDb(t)) return
  const c = ok(await create({ name: 'سيتغير كوده' }))
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier))
  const sale = ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: shift.id,
        paymentType: 'آجل',
        client: { id: c.id, name: c.name },
        items: [{ barcode: 'P', qty: 1 }]
      },
      cashier
    )
  )
  // Without the permission: refused, nothing changes.
  const no = await svc.call('clients.update', { id: c.id, name: c.name, code: 'NEW-9' }, manager)
  assert.equal(no.status, 403)
  assert.equal(await codeOf(c.id), c.code)
  // The same code sent back without the permission is not a change.
  ok(await svc.call('clients.update', { id: c.id, name: 'سيتغير كوده', code: c.code }, manager))
  // To a code another customer has: refused.
  const taken = await svc.call('clients.update', { id: c.id, name: c.name, code: 'VIP-12' }, owner)
  assert.equal(taken.status, 409)
  // With the permission: changed and logged; the earlier sale keeps the old code.
  ok(await svc.call('clients.update', { id: c.id, name: c.name, code: 'NEW-9' }, owner))
  assert.equal(await codeOf(c.id), 'NEW-9')
  const saleCode = (
    await svc.pool.query('SELECT client_code FROM sales WHERE id = $1', [sale.saleId])
  ).rows[0].client_code
  assert.equal(saleCode, c.code)
  const log = (
    await svc.pool.query(
      "SELECT description FROM system_logs WHERE action_type = 'customer_code_change' ORDER BY id DESC LIMIT 1"
    )
  ).rows[0]
  assert.match(log.description, new RegExp(`من ${c.code} إلى NEW-9`))
  // The till finds the customer by the new code, in any letter case.
  const found = ok(await svc.call('pos.searchClients', { term: 'new-9' }, cashier))
  assert.equal(found[0].id, c.id)
})

test('an import adds customers with automatic codes, next to typed ones', async (t) => {
  if (!requireDb(t)) return
  const r = ok(
    await svc.call(
      'storeImport.apply',
      {
        products: [],
        customers: [
          { row: 2, name: 'مستورد أول', phone: '01055550001', balance: 0 },
          { row: 3, name: 'مستورد ثان', balance: 15 }
        ],
        suppliers: []
      },
      owner
    )
  )
  assert.ok(r.written, JSON.stringify(r))
  const codes = (
    await svc.pool.query("SELECT code FROM clients WHERE name LIKE 'مستورد%' ORDER BY id")
  ).rows.map((x) => x.code)
  assert.equal(codes.length, 2)
  for (const c of codes) assert.match(c, /^C\d{5,}(-\d+)?$/)
})

test("0025 keeps every existing code and every sale's code", async (t) => {
  if (!requireDb(t)) return
  const fresh = await freshDatabase()
  const pool = createPool(fresh.url, { max: 2 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig25-'))
  try {
    for (const m of listMigrations().filter((x) => Number(x.version) <= 24))
      fs.copyFileSync(
        path.join(__dirname, '../../src/server/db/migrations', `${m.name}.sql`),
        path.join(tmp, `${m.name}.sql`)
      )
    await migrate(pool, { dir: tmp, logger: { info() {} } })
    await pool.query(
      "INSERT INTO clients (name, debt_balance, points) VALUES ('أ', 0, 0), ('ب', 0, 0), ('ج', 0, 0)"
    )
    const before = (await pool.query('SELECT id, code FROM clients ORDER BY id')).rows
    await migrate(pool, { logger: { info() {} } })
    assert.deepEqual((await pool.query('SELECT id, code FROM clients ORDER BY id')).rows, before)
    // After it, new customers still get the automatic code.
    const next = (
      await pool.query(
        "INSERT INTO clients (name, debt_balance, points) VALUES ('د', 0, 0) RETURNING code"
      )
    ).rows[0].code
    assert.match(next, /^C\d{5,}$/)
  } finally {
    await pool.end()
    await fresh.dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
