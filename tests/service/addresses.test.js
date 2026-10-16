'use strict'
// Customer delivery addresses (1.4.0, migration 0012): up to three per customer, optional, one
// default; invoices keep a snapshot of the delivery address.
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
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const create = (body) => svc.call('clients.create', body, admin)
const update = (body) => svc.call('clients.update', body, admin)
const addrs = (c) => c.addresses.map((a) => [a.label, a.address, a.isDefault])

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

test('zero to three addresses; the first becomes the default when none is chosen', async (t) => {
  if (!requireDb(t)) return
  const none = ok(await create({ name: 'بدون عنوان', phones: [] }))
  assert.deepEqual(none.addresses, [])
  assert.equal(none.address, '')
  const one = ok(
    await create({ name: 'عنوان واحد', addresses: [{ address: 'الدقي، شارع التحرير' }] })
  )
  assert.deepEqual(addrs(one), [['other', 'الدقي، شارع التحرير', true]])
  assert.equal(one.address, 'الدقي، شارع التحرير', 'clients.address mirrors the default')
  const three = ok(
    await create({
      name: 'ثلاثة عناوين',
      addresses: [
        { label: 'home', address: 'مدينة نصر', details: 'الدور 3 شقة 12' },
        { label: 'work', address: 'المعادي', isDefault: true },
        { label: 'other', address: 'الهرم' }
      ]
    })
  )
  assert.deepEqual(
    addrs(three).sort(),
    [
      ['home', 'مدينة نصر', false],
      ['other', 'الهرم', false],
      ['work', 'المعادي', true]
    ].sort()
  )
  assert.equal(three.address, 'المعادي')
  assert.equal(three.addresses.find((a) => a.label === 'home').details, 'الدور 3 شقة 12')
})

test('a fourth address is refused by the API and by the database; nothing is saved', async (t) => {
  if (!requireDb(t)) return
  const before = (await q('SELECT count(*)::int AS n FROM client_addresses'))[0].n
  const four = await create({
    name: 'أربعة',
    addresses: ['أ', 'ب', 'ج', 'د'].map((x) => ({ address: `عنوان ${x}` }))
  })
  assert.equal(four.status, 400)
  assert.equal((await q("SELECT count(*)::int AS n FROM clients WHERE name = 'أربعة'"))[0].n, 0)
  assert.equal((await q('SELECT count(*)::int AS n FROM client_addresses'))[0].n, before)
  const c = (await q("SELECT id FROM clients WHERE name = 'ثلاثة عناوين'"))[0]
  await assert.rejects(
    q("INSERT INTO client_addresses (client_id, address) VALUES ($1, 'رابع')", [c.id]),
    /ثلاثة عناوين على الأكثر/
  )
  // Two defaults at once are impossible in the database too.
  await assert.rejects(
    q('UPDATE client_addresses SET is_default = true WHERE client_id = $1', [c.id])
  )
})

test('invalid addresses are refused: duplicates, two defaults, empty text, too long, unknown label', async (t) => {
  if (!requireDb(t)) return
  for (const addresses of [
    [{ address: 'شبرا' }, { address: ' شبرا ' }],
    [
      { address: 'أ1', isDefault: true },
      { address: 'ب2', isDefault: true }
    ],
    [{ address: 'x'.repeat(301) }],
    [{ address: 'حلوان', details: 'y'.repeat(201) }]
  ]) {
    const r = await create({ name: 'خطأ', addresses })
    assert.equal(r.status, 400, JSON.stringify(addresses).slice(0, 80))
  }
  assert.equal(
    (await create({ name: 'خطأ', addresses: [{ address: 'x', label: 'villa' }] })).status,
    400
  )
  // Blank entries are simply ignored.
  const blank = ok(await create({ name: 'فراغ', addresses: [{ address: '   ' }] }))
  assert.deepEqual(blank.addresses, [])
})

test('edit: change, remove, add back, move the default; another customer cannot be touched', async (t) => {
  if (!requireDb(t)) return
  const c = ok(
    await create({
      name: 'تعديل',
      addresses: [
        { label: 'home', address: 'العباسية' },
        { label: 'work', address: 'رمسيس' }
      ]
    })
  )
  const home = c.addresses.find((a) => a.label === 'home')
  const work = c.addresses.find((a) => a.label === 'work')
  // Move the default to work, rename home, add a third.
  const e1 = ok(
    await update({
      id: c.id,
      name: 'تعديل',
      addresses: [
        { id: home.id, label: 'home', address: 'العباسية – شارع الجيش' },
        { id: work.id, label: 'work', address: 'رمسيس', isDefault: true },
        { label: 'other', address: 'التجمع' }
      ]
    })
  )
  assert.equal(e1.address, 'رمسيس')
  assert.equal(e1.addresses.find((a) => a.id === home.id).address, 'العباسية – شارع الجيش')
  assert.equal(e1.addresses.length, 3)
  // Remove two: only work remains, still default.
  const e2 = ok(
    await update({
      id: c.id,
      name: 'تعديل',
      addresses: [{ id: work.id, address: 'رمسيس', label: 'work' }]
    })
  )
  assert.deepEqual(addrs(e2), [['work', 'رمسيس', true]])
  // Remove all.
  const e3 = ok(await update({ id: c.id, name: 'تعديل', addresses: [] }))
  assert.deepEqual(e3.addresses, [])
  assert.equal(e3.address, '')
  // An address id of another customer is refused.
  const other = ok(await create({ name: 'آخر', addresses: [{ address: 'السيدة زينب' }] }))
  const r = await update({
    id: c.id,
    name: 'تعديل',
    addresses: [{ id: other.addresses[0].id, address: 'سرقة' }]
  })
  assert.equal(r.status, 400)
  assert.equal(
    (await q('SELECT address FROM client_addresses WHERE id = $1', [other.addresses[0].id]))[0]
      .address,
    'السيدة زينب'
  )
  // Editing without sending addresses keeps them (older screens).
  ok(await update({ id: other.id, name: 'آخر معدل', phones: [] }))
  assert.equal(
    (await q('SELECT count(*)::int AS n FROM client_addresses WHERE client_id = $1', [other.id]))[0]
      .n,
    1
  )
})

test('older clients sending one "address" replace only the default and keep the others', async (t) => {
  if (!requireDb(t)) return
  const c = ok(
    await create({
      name: 'قديم',
      addresses: [
        { address: 'الزمالك', isDefault: true },
        { label: 'work', address: 'وسط البلد' }
      ]
    })
  )
  const r = ok(await update({ id: c.id, name: 'قديم', address: 'جاردن سيتي' }))
  assert.deepEqual(
    addrs(r).sort(),
    [
      ['other', 'جاردن سيتي', true],
      ['work', 'وسط البلد', false]
    ].sort()
  )
  const legacyCreate = ok(await create({ name: 'قديم 2', address: 'المهندسين' }))
  assert.deepEqual(addrs(legacyCreate), [['other', 'المهندسين', true]])
})

test('delivery at the till: a saved address, the default, or a typed one; kept on the invoice', async (t) => {
  if (!requireDb(t)) return
  const c = ok(
    await create({
      name: 'زبون توصيل',
      phones: ['01090000001'],
      addresses: [
        { label: 'home', address: 'فيصل', details: 'برج النور', isDefault: true },
        { label: 'work', address: 'الدقي' }
      ]
    })
  )
  const work = c.addresses.find((a) => a.label === 'work')
  const sell = (client, isDelivery = true) =>
    svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'W', qty: 1 }],
        isDelivery,
        client
      },
      cashier
    )
  const saleOf = async (r) =>
    (await q('SELECT is_delivery, delivery_address FROM sales WHERE id = $1', [r.saleId]))[0]
  const chosen = ok(await sell({ id: c.id, name: c.name, addressId: work.id }))
  assert.deepEqual(await saleOf(chosen), { is_delivery: true, delivery_address: 'الدقي' })
  const byDefault = ok(await sell({ id: c.id, name: c.name }))
  assert.equal((await saleOf(byDefault)).delivery_address, 'فيصل – برج النور')
  const typed = ok(await sell({ id: c.id, name: c.name, address: 'مكان مؤقت' }))
  assert.equal((await saleOf(typed)).delivery_address, 'مكان مؤقت')
  // History does not change when the customer's addresses change.
  ok(await update({ id: c.id, name: c.name, phones: ['01090000001'], addresses: [] }))
  assert.equal((await saleOf(chosen)).delivery_address, 'الدقي')
  // Another customer's address id is refused; a delivery needs an address.
  const other = ok(await create({ name: 'جار', addresses: [{ address: 'إمبابة' }] }))
  assert.equal(
    (await sell({ id: c.id, name: c.name, addressId: other.addresses[0].id })).status,
    400
  )
  assert.equal((await sell({ id: c.id, name: c.name })).status, 400, 'no address left')
  // Not a delivery: nothing recorded.
  const pickup = ok(await sell({ id: c.id, name: c.name }, false))
  assert.deepEqual(await saleOf(pickup), { is_delivery: false, delivery_address: null })
  // A new customer typed at the till: the address becomes their default address.
  const fresh = ok(
    await sell({ id: null, name: 'عميل جديد بالتوصيل', phone: '01090000002', address: 'شبرا مصر' })
  )
  const saved = await q('SELECT address, is_default FROM client_addresses WHERE client_id = $1', [
    fresh.clientId
  ])
  assert.deepEqual(saved, [{ address: 'شبرا مصر', is_default: true }])
  // The till's customer search returns the saved addresses.
  const found = ok(await svc.call('pos.searchClients', { term: 'زبون توصيل' }, cashier))
  assert.ok(Array.isArray(found[0].addresses))
})

test('migration 0012 turns each existing address into the default address; nothing else changes', async (t) => {
  if (!requireDb(t)) return
  const fresh = await freshDatabase()
  const pool = createPool(fresh.url, { max: 2 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig12-'))
  try {
    for (const m of listMigrations().filter((x) => Number(x.version) < 12))
      fs.copyFileSync(
        path.join(__dirname, '../../src/server/db/migrations', `${m.name}.sql`),
        path.join(tmp, `${m.name}.sql`)
      )
    const quiet = { info() {} }
    await migrate(pool, { dir: tmp, logger: quiet })
    await pool.query(`INSERT INTO clients (name, phone, address, debt_balance) VALUES
      ('ع1', '01011111111', 'المطرية', 5), ('ع2', NULL, '', 0), ('ع3', NULL, NULL, 0), ('ع4', '01022222222', '  حدائق القبة  ', -3)`)
    const beforeRows = (
      await pool.query(
        'SELECT id, name, phone, address, debt_balance::text FROM clients ORDER BY id'
      )
    ).rows
    await migrate(pool, { logger: quiet })
    const afterRows = (
      await pool.query(
        'SELECT id, name, phone, address, debt_balance::text FROM clients ORDER BY id'
      )
    ).rows
    assert.deepEqual(afterRows, beforeRows, 'customers unchanged')
    const a = (
      await pool.query(
        'SELECT client_id, label, address, is_default FROM client_addresses ORDER BY client_id'
      )
    ).rows
    assert.deepEqual(
      a.map((x) => [x.client_id, x.label, x.address, x.is_default]),
      [
        [beforeRows[0].id, 'other', 'المطرية', true],
        [beforeRows[3].id, 'other', 'حدائق القبة', true]
      ]
    )
  } finally {
    await pool.end()
    await fresh.dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('returning customers: a new address or number typed at the till is kept for the next order', async (t) => {
  if (!requireDb(t)) return
  const c = ok(
    await create({
      name: 'زبون دائم',
      phones: ['01095550001'],
      addresses: [{ address: 'العجوزة', isDefault: true }]
    })
  )
  const sell = (client) =>
    svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'W', qty: 1 }],
        isDelivery: true,
        client: { id: c.id, name: c.name, ...client }
      },
      cashier
    )
  const r1 = ok(await sell({ phone: '0109 555 0002', address: 'الكيت كات' }))
  assert.equal(r1.savedAddress, 'الكيت كات')
  assert.equal(r1.savedPhone, '01095550002')
  assert.deepEqual(r1.notSaved, { phone: null, address: null })
  const found = ok(await svc.call('pos.searchClients', { term: 'زبون دائم' }, cashier))[0]
  assert.deepEqual([found.phone, found.phone2], ['01095550001', '01095550002'])
  assert.deepEqual(found.addresses.map((a) => a.address).sort(), ['الكيت كات', 'العجوزة'].sort())
  // Next order: pick the saved address by id – nothing typed.
  const kit = found.addresses.find((a) => a.address === 'الكيت كات')
  const r2 = ok(await sell({ phone: '01095550002', addressId: kit.id }))
  assert.equal(r2.deliveryAddress, 'الكيت كات')
  assert.equal(r2.savedAddress, null)
  // The same address typed again is not saved twice; a third is saved; a fourth is only used.
  ok(await sell({ address: 'الكيت كات' }))
  ok(await sell({ address: 'إمبابة' }))
  const r4 = ok(await sell({ address: 'الوراق' }))
  assert.equal(r4.savedAddress, null)
  assert.equal(r4.deliveryAddress, 'الوراق')
  assert.equal(r4.notSaved.address, 'limit', 'the cashier is told the fourth address was not kept')
  assert.equal(
    (await q('SELECT delivery_address FROM sales WHERE id = $1', [r4.saleId]))[0].delivery_address,
    'الوراق',
    'the invoice still carries the fourth address'
  )
  assert.equal(
    (await q('SELECT count(*)::int AS n FROM client_addresses WHERE client_id = $1', [c.id]))[0].n,
    3
  )
  // Both phone slots full: a third number is used for the order only.
  const r5 = ok(await sell({ phone: '01095550003', addressId: kit.id }))
  assert.equal(r5.savedPhone, null)
  assert.equal(r5.notSaved.phone, 'no_free_slot')
  assert.match(
    (await q('SELECT client_name FROM sales WHERE id = $1', [r5.saleId]))[0].client_name,
    /01095550003/,
    'the order uses the typed number'
  )
  // A number of another customer is never attached to this one.
  const other = ok(await create({ name: 'شخص آخر', phones: ['01095550009'] }))
  const c2 = ok(
    await create({ name: 'برقم واحد', phones: ['01095550010'], addresses: [{ address: 'بولاق' }] })
  )
  const r6 = ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId: shift.id,
        paymentType: 'نقدي',
        items: [{ barcode: 'W', qty: 1 }],
        client: { id: c2.id, name: c2.name, phone: other.phone }
      },
      cashier
    )
  )
  assert.equal(r6.savedPhone, null)
  assert.equal(r6.notSaved.phone, 'other_customer')
  assert.equal((await q('SELECT phone2 FROM clients WHERE id = $1', [c2.id]))[0].phone2, null)
  assert.match(
    (await q('SELECT client_name FROM sales WHERE id = $1', [r6.saleId]))[0].client_name,
    /01095550009/,
    'the order still uses the number'
  )
  assert.equal(
    (await q('SELECT client_id FROM sales WHERE id = $1', [r6.saleId]))[0].client_id,
    c2.id,
    'the sale stays on the selected customer, not the owner of the number'
  )
})

test('before payment the till learns whether a typed number will be kept (owner rule)', async (t) => {
  if (!requireDb(t)) return
  const a = ok(await create({ name: 'صاحب الرقم', phones: ['01097770001'] }))
  const b = ok(await create({ name: 'برقم حر', phones: ['01097770002'] }))
  const full = ok(await create({ name: 'برقمين', phones: ['01097770003', '01097770004'] }))
  const check = (phone, clientId) => svc.call('pos.phoneOwner', { phone, clientId }, cashier)
  const r1 = ok(await check('٠١٠٩ ٧٧٧ ٠٠٠١', b.id))
  assert.deepEqual(
    [r1.valid, r1.value, r1.otherCustomer, r1.savedHere],
    [true, '01097770001', true, false],
    'Arabic digits and spaces: recognised as the other customer’s number'
  )
  assert.equal(r1.name, undefined, 'the other customer is not named')
  const r2 = ok(await check('01097770009', b.id))
  assert.deepEqual([r2.otherCustomer, r2.freeSlot, r2.savedHere], [false, true, false])
  const r3 = ok(await check('01097770009', full.id))
  assert.deepEqual([r3.otherCustomer, r3.freeSlot], [false, false])
  const r4 = ok(await check('01097770002', b.id))
  assert.equal(r4.savedHere, true)
  const r5 = ok(await check('12', b.id))
  assert.equal(r5.valid, false)
  // Without a signed-in user the question is refused.
  assert.equal(
    (await svc.call('pos.phoneOwner', { phone: '01097770001', clientId: a.id })).status,
    401
  )
})
