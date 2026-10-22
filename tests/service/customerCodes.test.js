'use strict'
// CUST-01 (D-072): every customer has a stable unique code (C + its number), never recycled and
// never changed; sales keep their customer's code; the till and the customers screen find a
// customer by code. Migration 0022 backfills existing customers and sales and changes nothing else.
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

let db, svc, owner, cashier
const ref = () => crypto.randomUUID()
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const quiet = { info() {} }

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES ('P', 'صنف', 5, 10, 9, 100, 'قطعة')`
  )
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('0022 gives existing customers C + their number and their sales the code; nothing else changes', async (t) => {
  if (!requireDb(t)) return
  const fresh = await freshDatabase()
  const pool = createPool(fresh.url, { max: 2 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig22-'))
  try {
    for (const m of listMigrations().filter((x) => Number(x.version) < 22))
      fs.copyFileSync(
        path.join(__dirname, '../../src/server/db/migrations', `${m.name}.sql`),
        path.join(tmp, `${m.name}.sql`)
      )
    await migrate(pool, { dir: tmp, logger: quiet })
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SELECT set_config('hm.bulk_load', 'on', true)")
      await c.query(`INSERT INTO users (id, username, role) VALUES (1, 'a', 'cashier')`)
      await c.query(
        `INSERT INTO clients (id, name, debt_balance) VALUES (1, 'أ', 0), (2, 'ب', 30), (7, 'ج', 0)`
      )
      await c.query(`INSERT INTO shifts (id, user_id, start_time, end_time, initial_cash, status)
        VALUES (1, 1, '2026-10-01 08:00', '2026-10-01 20:00', 0, 'closed')`)
      await c.query(`INSERT INTO sales (id, shift_id, user_id, timestamp, total_amount, original_amount, discount, payment_type, client_name, client_id)
        VALUES (1, 1, 1, '2026-10-01 09:00', 30, 30, 0, 'آجل', 'ب', 2), (2, 1, 1, '2026-10-01 10:00', 12, 12, 0, 'نقدي', NULL, NULL)`)
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    const before = (
      await pool.query(
        'SELECT s.id, s.total_amount::text, c.debt_balance FROM sales s LEFT JOIN clients c ON c.id = s.client_id ORDER BY s.id'
      )
    ).rows
    await migrate(pool, { logger: quiet })
    assert.deepEqual((await pool.query('SELECT id, code FROM clients ORDER BY id')).rows, [
      { id: 1, code: 'C00001' },
      { id: 2, code: 'C00002' },
      { id: 7, code: 'C00007' }
    ])
    assert.deepEqual((await pool.query('SELECT id, client_code FROM sales ORDER BY id')).rows, [
      { id: 1, client_code: 'C00002' },
      { id: 2, client_code: null }
    ])
    assert.deepEqual(
      (
        await pool.query(
          'SELECT s.id, s.total_amount::text, c.debt_balance FROM sales s LEFT JOIN clients c ON c.id = s.client_id ORDER BY s.id'
        )
      ).rows,
      before
    )
  } finally {
    await pool.end()
    await fresh.dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('new customers get unique codes, also when created at the same moment', async (t) => {
  if (!requireDb(t)) return
  const made = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      svc.call(
        'clients.create',
        { name: `عميل ${i}`, phone: `0100000${String(i).padStart(4, '0')}` },
        owner
      )
    )
  )
  const codes = made.map((r) => ok(r).code || ok(r).client?.code)
  assert.equal(codes.filter(Boolean).length, 12, JSON.stringify(made[0].body))
  assert.equal(new Set(codes).size, 12)
  for (const c of codes) assert.match(c, /^C\d{5,}$/)
})

test('a deleted customer’s code is never given again, and a code cannot be changed', async (t) => {
  if (!requireDb(t)) return
  const a = ok(await svc.call('clients.create', { name: 'سيحذف', phone: '01099990001' }, owner))
  const id = a.id ?? a.client?.id
  const code = (await svc.pool.query('SELECT code FROM clients WHERE id = $1', [id])).rows[0].code
  ok(await svc.call('clients.delete', { clientId: id }, owner))
  const b = ok(await svc.call('clients.create', { name: 'جديد', phone: '01099990002' }, owner))
  const next = (
    await svc.pool.query('SELECT code FROM clients WHERE id = $1', [b.id ?? b.client?.id])
  ).rows[0].code
  assert.notEqual(next, code)
  assert.ok(Number(next.slice(1)) > Number(code.slice(1)))
  await assert.rejects(
    svc.pool.query("UPDATE clients SET code = 'C99999' WHERE id = $1", [b.id ?? b.client?.id]),
    /كود العميل لا يتغير/
  )
})

test('the till and the customers screen find a customer by code, the exact code first', async (t) => {
  if (!requireDb(t)) return
  const target = (await svc.pool.query("SELECT id, code FROM clients WHERE name = 'عميل 3'"))
    .rows[0]
  const found = ok(
    await svc.call('pos.searchClients', { term: target.code.toLowerCase() }, cashier)
  )
  assert.equal(found[0].id, target.id)
  const list = ok(await svc.call('clients.list', { search: target.code }, owner))
  assert.equal(list[0].id, target.id)
})

test('a sale keeps its customer’s code', async (t) => {
  if (!requireDb(t)) return
  const target = (await svc.pool.query("SELECT id, name, code FROM clients WHERE name = 'عميل 5'"))
    .rows[0]
  const shift = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier))
  const sale = ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: ref(),
        shiftId: shift.id,
        paymentType: 'آجل',
        client: { id: target.id, name: target.name },
        items: [{ barcode: 'P', qty: 1 }]
      },
      cashier
    )
  )
  const detail = ok(await svc.call('sales.detail', { saleId: sale.saleId }, owner))
  assert.equal((detail.sale || detail).client_code, target.code)
})
