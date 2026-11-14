'use strict'
// Import jobs (1.6.3, D-108): the Excel file's rows are stored as a job and written in the
// background, all or nothing. Every outcome is checked against the database itself: what the job
// reports written is exactly what is there, and nothing else.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

let db, svc, owner, cashier, manager
const gate = { hold: null, seen: [] }
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const counts = () =>
  one(
    `SELECT (SELECT count(*) FROM products)::int AS products, (SELECT count(*) FROM stock_movements)::int AS movements,
            (SELECT count(*) FROM product_units)::int AS units, (SELECT count(*) FROM clients)::int AS clients,
            (SELECT count(*) FROM categories)::int AS categories, (SELECT count(*) FROM import_job_data)::int AS stored`
  )

function products(n, { prefix = 'J', start = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    row: i + 2,
    barcode: i % 9 === 4 ? '' : `${prefix}${String(start + i).padStart(8, '0')}`,
    name: `صنف ${prefix}${start + i}`,
    retail_price: 10 + (i % 7),
    cost_price: 8,
    stock_qty: i % 3 ? 5 : 0,
    unit: i % 5 === 1 ? 'كيلو' : 'قطعة',
    category: `فئة ${i % 4}`,
    ...(i % 10 === 2
      ? { pack_name: 'كرتونة', pack_factor: 6, pack_barcode: `${prefix}P${start + i}` }
      : {})
  }))
}

const OPTIONS = {
  importPollMs: 200,
  // Tests hold the job at a step to act while it runs (cancel, a conflicting write, a restart).
  importOnStep: async (stage, done) => {
    gate.seen.push(stage)
    if (gate.hold) await gate.hold(stage, done)
  }
}

async function waitFor(id, token, done = (j) => !['queued', 'processing'].includes(j.status)) {
  for (let i = 0; i < 400; i++) {
    const j = ok(await svc.call('imports.get', { id }, token))
    if (done(j)) return j
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`job ${id} did not finish`)
}

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url, OPTIONS)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await createUser(svc, { username: 'manager', pin: '7391', roleKey: 'store_admin' })
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  manager = await login(svc, '7391')
})
after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a job writes every row once, reports exactly what is in the database, and is not repeated', async (t) => {
  if (!requireDb(t)) return
  const rows = products(600)
  const id = crypto.randomUUID()
  const before = await counts()
  const started = ok(
    await svc.call(
      'imports.start',
      { id, filename: 'C:\\fakepath\\الأصناف.xlsx', products: rows },
      owner
    )
  )
  assert.equal(started.id, id)
  assert.equal(started.filename, 'الأصناف.xlsx', 'only the name, never a path')
  assert.ok(['queued', 'processing'].includes(started.status))
  assert.equal(started.totalRows, 600)
  // The same start again (a lost answer, a double click): the same job.
  const again = ok(await svc.call('imports.start', { id, products: rows }, owner))
  assert.equal(again.id, id)

  const done = await waitFor(id, owner)
  assert.equal(done.status, 'completed', JSON.stringify(done))
  assert.deepEqual(
    [done.processedRows, done.successfulRows, done.failedRows, done.skippedRows],
    [600, 600, 0, 0]
  )
  const after = await counts()
  assert.equal(after.products - before.products, 600)
  assert.equal(after.movements - before.movements, rows.filter((r) => r.stock_qty).length)
  assert.equal(after.units - before.units, rows.filter((r) => r.pack_name).length)
  assert.equal(after.stored, 0, 'the stored rows go with the finished job')
  // Products without a barcode got the next internal codes; stock matches the file.
  const internal = await q("SELECT barcode FROM products WHERE barcode ~ '^HM[0-9]{6}$' ORDER BY 1")
  assert.equal(internal.length, rows.filter((r) => !r.barcode).length)
  const stock = await one(
    "SELECT sum(stock_qty)::float8 AS s FROM products WHERE name LIKE 'صنف J%'"
  )
  assert.equal(
    stock.s,
    rows.reduce((a, r) => a + r.stock_qty, 0)
  )
  // One audit line, naming the job.
  const log = await q("SELECT details FROM system_logs WHERE action_type = 'store_import'")
  assert.equal(log.length, 1)
  const details = typeof log[0].details === 'string' ? JSON.parse(log[0].details) : log[0].details
  assert.equal(details.importJob, id)

  // The same file again: noticed. Confirmed anyway: every barcode is already there, nothing written.
  const repeat = await svc.call('imports.start', { id: crypto.randomUUID(), products: rows }, owner)
  assert.equal(repeat.status, 409)
  assert.equal(repeat.body.error.code, 'already_imported')
  const forced = ok(
    await svc.call(
      'imports.start',
      { id: crypto.randomUUID(), products: rows, allowRepeat: true },
      owner
    )
  )
  const refused = await waitFor(forced.id, owner)
  assert.equal(refused.status, 'failed')
  assert.equal(refused.errorCode, 'invalid_rows')
  assert.equal(refused.successfulRows, 0)
  assert.equal((await counts()).products, after.products, 'no duplicate product')
})

test('problems in the file: the job fails with every problem by row and field, nothing written', async (t) => {
  if (!requireDb(t)) return
  const rows = products(300, { prefix: 'BAD', start: 0 })
  rows[10].retail_price = -1
  rows[20].barcode = rows[21].barcode
  rows[30].name = ''
  rows[40].unit_kind = 'بالفرسخ'
  rows[50].stock_qty = 1.5 // a counted product
  const before = await counts()
  const job = ok(
    await svc.call('imports.start', { id: crypto.randomUUID(), products: rows }, owner)
  )
  const done = await waitFor(job.id, owner)
  assert.equal(done.status, 'failed')
  assert.equal(done.errorCode, 'invalid_rows')
  assert.equal(done.successfulRows, 0)
  assert.equal(done.failedRows, 5)
  assert.deepEqual(await counts(), before)
  const full = ok(await svc.call('imports.get', { id: job.id, withErrors: true }, owner))
  const byRow = Object.fromEntries(full.errors.map((e) => [e.row, e.field]))
  assert.deepEqual(byRow, {
    12: 'retail_price',
    23: 'barcode',
    32: 'name',
    42: 'unit_kind',
    52: 'stock_qty'
  })
  assert.equal(full.errorsCount, 5)
})

test('who sees a job: its starter and the administrators; a job id is not a key', async (t) => {
  if (!requireDb(t)) return
  const mine = ok(
    await svc.call(
      'imports.start',
      { id: crypto.randomUUID(), products: products(5, { prefix: 'M' }) },
      owner
    )
  )
  await waitFor(mine.id, owner)
  // A cashier has no data.import: refused before anything.
  assert.equal((await svc.call('imports.get', { id: mine.id }, cashier)).status, 403)
  assert.equal((await svc.call('imports.list', {}, cashier)).status, 403)
  // Another user with the permission but not an administrator: "not found", and not in the list.
  await svc.pool.query(
    "INSERT INTO roles (key, name, description) VALUES (NULL, 'مدخل بيانات', 'استيراد فقط')"
  )
  const role = await one("SELECT id FROM roles WHERE name = 'مدخل بيانات'")
  for (const p of ['data.import'])
    await svc.pool.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [
      role.id,
      p
    ])
  await createUser(svc, { username: 'entry', pin: '2468', roleKey: 'cashier' })
  await svc.pool.query("UPDATE users SET role_id = $1 WHERE username = 'entry'", [role.id])
  const entry = await login(svc, '2468')
  assert.equal((await svc.call('imports.get', { id: mine.id }, entry)).status, 404)
  assert.equal((await svc.call('imports.cancel', { id: mine.id }, entry)).status, 404)
  assert.deepEqual(ok(await svc.call('imports.list', {}, entry)).jobs, [])
  // Unknown id and an id that is not one.
  assert.equal((await svc.call('imports.get', { id: crypto.randomUUID() }, owner)).status, 404)
  assert.equal((await svc.call('imports.get', { id: '../../etc' }, owner)).status, 400)
  // The store administrator sees it.
  assert.equal(ok(await svc.call('imports.get', { id: mine.id }, manager)).id, mine.id)
  assert.ok(ok(await svc.call('imports.list', {}, manager)).jobs.some((j) => j.id === mine.id))
  // Their own job: theirs to see.
  const theirs = ok(
    await svc.call(
      'imports.start',
      { id: crypto.randomUUID(), products: products(3, { prefix: 'E' }) },
      entry
    )
  )
  await waitFor(theirs.id, entry)
  assert.deepEqual(
    ok(await svc.call('imports.list', {}, entry)).jobs.map((j) => j.id),
    [theirs.id]
  )
})

test('one import at a time; cancelling a running job undoes everything it wrote', async (t) => {
  if (!requireDb(t)) return
  const before = await counts()
  let release
  const reached = new Promise((resolve) => {
    gate.hold = async (stage, done) => {
      if (stage === 'products' && done >= 500) {
        resolve()
        await new Promise((r) => (release = r))
      }
    }
  })
  const job = ok(
    await svc.call(
      'imports.start',
      { id: crypto.randomUUID(), products: products(1000, { prefix: 'CX' }) },
      owner
    )
  )
  await reached
  // Written so far, not saved: the job says so, and the database shows none of it outside.
  const running = ok(await svc.call('imports.get', { id: job.id }, owner))
  assert.equal(running.status, 'processing')
  assert.equal(running.successfulRows, 0)
  assert.equal((await counts()).products, before.products)
  // A second import while this one runs: refused, with the reason.
  const second = await svc.call(
    'imports.start',
    { id: crypto.randomUUID(), products: products(2, { prefix: 'Z' }) },
    manager
  )
  assert.equal(second.status, 409)
  assert.equal(second.body.error.code, 'import_running')
  const cancel = ok(await svc.call('imports.cancel', { id: job.id }, owner))
  assert.equal(cancel.cancelRequested, true)
  gate.hold = null
  release()
  const done = await waitFor(job.id, owner)
  assert.equal(done.status, 'cancelled')
  assert.equal(done.successfulRows, 0)
  assert.deepEqual(await counts(), before)
  // Finished jobs cannot be cancelled.
  const late = await svc.call('imports.cancel', { id: job.id }, owner)
  assert.equal(late.status, 409)
  assert.equal(late.body.error.code, 'import_finished')
})

test('while a job runs the tills keep selling; a barcode saved meanwhile fails the job, nothing written', async (t) => {
  if (!requireDb(t)) return
  // Rows without categories: the job takes no catalog lock before its first batch.
  const rows = products(600, { prefix: 'RACE' }).map(({ category: _c, ...r }) => r)
  // A product and an open shift to sell from.
  await svc.pool.query(
    "INSERT INTO products (barcode, name, retail_price, unit_kind) VALUES ('SELL1', 'صنف للبيع', 5, 'count')"
  )
  await svc.pool.query(
    "INSERT INTO stock_movements (product_barcode, qty, kind, reason) VALUES ('SELL1', 10, 'opening', 'test')"
  )
  const shift = ok(await svc.call('shifts.open', { startingCash: 100 }, cashier))
  const before = await counts()
  let sold = null
  gate.hold = async (stage, done) => {
    if (stage === 'products' && done === 0) {
      gate.hold = null
      const t0 = Date.now()
      const sale = await svc.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: shift.id,
          paymentType: 'نقدي',
          paidAmount: 5,
          items: [{ barcode: 'SELL1', qty: 1 }]
        },
        cashier
      )
      sold = { status: sale.status, ms: Date.now() - t0, body: sale.body }
      // Another terminal saves a product with a barcode the file has in a later batch.
      await svc.pool.query(
        "INSERT INTO products (barcode, name, retail_price, unit_kind) VALUES ($1, 'من الكاشير', 5, 'count')",
        [rows[401].barcode]
      )
    }
  }
  const job = ok(
    await svc.call('imports.start', { id: crypto.randomUUID(), products: rows }, owner)
  )
  const done = await waitFor(job.id, owner)
  assert.equal(sold?.status, 200, JSON.stringify(sold))
  assert.ok(sold.ms < 3000, `the sale waited ${sold.ms} ms`)
  assert.equal(done.status, 'failed', JSON.stringify(done))
  assert.equal(done.errorCode, 'conflict')
  assert.match(done.errorMessage, /الباركود/)
  const after = await counts()
  assert.equal(after.products, before.products + 1, 'only the other terminal’s product')
  assert.equal(after.stored, 0)
})

test('the service stops in the middle: nothing is kept, and the next start carries the job out once', async (t) => {
  if (!requireDb(t)) return
  const rows = products(900, { prefix: 'RST' })
  const before = await counts()
  let reached
  const atMiddle = new Promise((r) => (reached = r))
  gate.hold = async (stage, done) => {
    if (stage === 'products' && done >= 500) {
      gate.hold = null
      reached()
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  const job = ok(
    await svc.call('imports.start', { id: crypto.randomUUID(), products: rows }, owner)
  )
  await atMiddle
  await svc.close() // the runner undoes the running job; the job stays open
  svc = await startService(db.url, { importJobs: false })
  const left = await one('SELECT status, stage, successful_rows FROM import_jobs WHERE id = $1', [
    job.id
  ])
  assert.equal(left.status, 'processing')
  assert.equal(left.successful_rows, 0)
  assert.equal((await counts()).products, before.products, 'nothing kept from the stopped attempt')
  await svc.close()
  // The next start of the service finds the open job and carries it out.
  gate.seen = []
  svc = await startService(db.url, OPTIONS)
  owner = await login(svc, '8642')
  const done = await waitFor(job.id, owner)
  assert.equal(done.status, 'completed', JSON.stringify(done))
  assert.equal(done.successfulRows, 900)
  const after = await counts()
  assert.equal(after.products - before.products, 900)
  assert.equal(
    (await one("SELECT count(*)::int AS n FROM products WHERE name LIKE 'صنف RST%'")).n,
    900,
    'every product exactly once'
  )
})

test('a lost database connection in the middle: tried again, completed once', async (t) => {
  if (!requireDb(t)) return
  const rows = products(700, { prefix: 'NET' })
  const before = await counts()
  gate.hold = async (stage, done) => {
    if (stage === 'products' && done === 250) {
      gate.hold = null
      // The connection carrying the import is cut (PostgreSQL restarted, network reset).
      await svc.pool.query(
        `SELECT pg_terminate_backend(l.pid) FROM pg_locks l
          WHERE l.locktype = 'advisory' AND l.objid = $1 AND l.pid <> pg_backend_pid()`,
        [0x484d494d]
      )
    }
  }
  const job = ok(
    await svc.call('imports.start', { id: crypto.randomUUID(), products: rows }, owner)
  )
  const done = await waitFor(job.id, owner)
  assert.equal(done.status, 'completed', JSON.stringify(done))
  assert.equal(done.attempts, 2)
  assert.equal((await counts()).products - before.products, 700)
})
