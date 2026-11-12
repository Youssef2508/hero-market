// A realistic store made by an OLD released version's own code (D-106, the existing-installation
// upgrade test, tests/service/existingInstall.test.js):
//   git worktree add --detach ../hm-v152 v1.5.2   (and junction its node_modules to this repo's)
//   node scripts/make-old-store-fixture.js ../hm-v152 heromarket_old152 tests/fixtures/old-stores/store-1.5.2.json.gz
// A month of business through that version's operations: products, suppliers, purchases (paid,
// partial, on credit), shifts opened and closed every day, cash / card / credit sales with
// discounts, returns, customer repayments, supplier repayments, expenses, price changes. Then every
// table – the change queue the old version kept, never sent, included – is written to <out.json>
// with the sequences' positions. Made-up data only; a disposable database on the dev cluster.
const path = require('path')
const crypto = require('crypto')
const fs = require('fs')
const [wt, dbName, out] = process.argv.slice(2)
const zlib = require('zlib')
const repo = path.join(__dirname, '..')
const { Client } = require(path.join(repo, 'node_modules/pg'))
const pgDev = require(path.join(repo, 'scripts/pg-dev'))
const { createService } = require(path.join(wt, 'src/server/app'))
const version = require(path.join(wt, 'package.json')).version

const ok = (r, what) => {
  if (r.statusCode >= 300) throw new Error(`${what}: ${r.statusCode} ${r.body}`)
  return r.body ? JSON.parse(r.body) : null
}

;(async () => {
  const admin = new Client({ connectionString: pgDev.url('postgres') })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
  await admin.query(
    `CREATE DATABASE ${dbName} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`
  )
  await admin.end()
  const svc = await createService({
    databaseUrl: pgDev.url(dbName),
    secret: 'old-store-fixture-secret-'.padEnd(40, 'x'),
    timeZone: 'Africa/Cairo',
    logger: false
  })
  await svc.prepare()
  await svc.app.ready()
  const call = async (op, body, token) =>
    ok(
      await svc.app.inject({
        method: 'POST',
        url: `/api/${op}`,
        payload: body || {},
        headers: token ? { authorization: `Bearer ${token}` } : {}
      }),
      op
    )
  const ref = () => crypto.randomUUID()
  const v15 = !version.startsWith('1.4')
  try {
    const owner = (await call('auth.setup', { username: 'owner', password: 'Old-Store-2026' }))
      .token
    await call('settings.update', { store_name: 'هيرو ماركت (نسخة تجربة)' }, owner).catch(() => {})
    const products = [
      ['200001', 'أرز تجربة', 18, 24],
      ['200002', 'سكر تجربة', 21, 25],
      ['200003', 'زيت تجربة', 55, 65],
      ['200004', 'شاي تجربة', 30, 38],
      ['200005', 'مكرونة تجربة', 9, 12],
      ['200006', 'جبنة تجربة', 140, 170],
      ['200007', 'عصير تجربة', 5, 7],
      ['200008', 'صابون تجربة', 11, 15]
    ]
    for (const [barcode, name, cost, price] of products)
      await call(
        'products.create',
        {
          barcode,
          name,
          cost_price: cost,
          retail_price: price,
          stock_qty: 0,
          reorder_limit: 5,
          unit: 'قطعة'
        },
        owner
      )
    const sup1 = (
      await call('suppliers.create', { name: 'مورد البقالة تجربة', phone: '01100000001' }, owner)
    ).id
    const sup2 = (
      await call('suppliers.create', { name: 'مورد الألبان تجربة', phone: '01100000002' }, owner)
    ).id
    const purchase = (supplierId, items, paid, shiftId) => {
      const total = items.reduce((a, i) => a + i.qty * i.unitCost, 0)
      return call(
        'suppliers.addPurchase',
        {
          supplierId,
          total_amount: total,
          paid_amount: paid,
          invoice_ref: `INV-${Math.floor(Math.random() * 1e6)}`,
          currentShiftId: shiftId ?? null,
          items,
          ...(v15 ? { clientRef: ref() } : {})
        },
        owner
      )
    }
    await purchase(
      sup1,
      products.slice(0, 5).map(([b, , c]) => ({ barcode: b, qty: 80, unitCost: c })),
      0
    )
    await purchase(
      sup2,
      products.slice(5).map(([b, , c]) => ({ barcode: b, qty: 60, unitCost: c })),
      0
    )

    let clientId = null
    for (let day = 1; day <= 12; day++) {
      const shift = await call('shifts.open', { startingCash: 300 }, owner)
      const shiftId = shift.shiftId ?? shift.id ?? shift.shift?.id
      const sell = (items, paymentType, extra = {}) =>
        call('pos.checkout', { clientRef: ref(), shiftId, paymentType, items, ...extra }, owner)
      const a = await sell(
        [
          { barcode: '200001', qty: 2 },
          { barcode: '200005', qty: 3 }
        ],
        'نقدي'
      )
      await sell(
        [
          { barcode: '200003', qty: 1 },
          { barcode: '200007', qty: 4 }
        ],
        v15 ? 'فيزا' : 'فودافون كاش'
      )
      await sell([{ barcode: '200002', qty: 1 }], 'نقدي')
      const credit = await sell(
        [
          { barcode: '200006', qty: 1 },
          { barcode: '200004', qty: 1 }
        ],
        'آجل',
        {
          client: {
            id: clientId || null,
            name: 'عميل آجل تجربة',
            phone: '01200000001',
            address: ''
          }
        }
      )
      clientId =
        clientId ||
        credit.clientId ||
        (await svc.pool.query("SELECT id FROM clients WHERE phone = '01200000001'")).rows[0]?.id
      if (day % 3 === 0) {
        const it = await svc.pool.query(
          'SELECT id FROM sale_items WHERE sale_id = $1 ORDER BY id LIMIT 1',
          [a.saleId]
        )
        await call('sales.returnItem', { saleItemId: it.rows[0].id, quantity: 1 }, owner)
      }
      if (day % 2 === 0)
        await call(
          'clients.repay',
          { clientId, amount: 50, currentShiftId: shiftId, ...(v15 ? { clientRef: ref() } : {}) },
          owner
        )
      if (day % 4 === 0)
        await call(
          'suppliers.repay',
          {
            supplierId: day % 8 ? sup1 : sup2,
            amount: 300,
            currentShiftId: shiftId,
            ...(v15 ? { clientRef: ref() } : {})
          },
          owner
        )
      await call(
        'expenses.create',
        v15
          ? { amount: 25, currentShiftId: shiftId, destination: 'shift', clientRef: ref() }
          : { amount: 25, description: `مصروف يوم ${day} تجربة`, currentShiftId: shiftId },
        owner
      )
      if (day === 6)
        await purchase(sup1, [{ barcode: '200001', qty: 40, unitCost: 19 }], 200, shiftId)
      if (day === 8) {
        const p = (await svc.pool.query("SELECT * FROM products WHERE barcode = '200008'")).rows[0]
        await call(
          'products.update',
          {
            barcode: '200008',
            name: p.name,
            cost_price: Number(p.cost_price),
            retail_price: 16,
            unit: p.unit
          },
          owner
        ).catch((e) => console.log('price change skipped:', e.message.slice(0, 120)))
      }
      const cur = await svc.pool.query('SELECT expected_end_cash FROM shifts WHERE id = $1', [
        shiftId
      ])
      const expected = Number(cur.rows[0]?.expected_end_cash) || 300
      await call(
        'shifts.close',
        {
          shiftId,
          actualCash: day === 5 ? expected - 10 : expected,
          ...(v15 ? { clientRef: ref() } : {})
        },
        owner
      )
    }

    // Every table as it is, sequences included.
    const tables = (
      await svc.pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"
      )
    ).rows.map((r) => r.table_name)
    const dump = {
      version,
      schema: (await svc.pool.query('SELECT max(version) AS v FROM schema_migrations')).rows[0].v,
      tables: {},
      sequences: {}
    }
    for (const t of tables) {
      if (t === 'schema_migrations') continue
      // PostgreSQL's own JSON of each row: every value exactly as stored (no time-zone shift).
      const rows = (await svc.pool.query(`SELECT to_jsonb(x) AS r FROM "${t}" x`)).rows.map(
        (x) => x.r
      )
      if (rows.length) dump.tables[t] = rows
    }
    for (const s of (
      await svc.pool.query(
        "SELECT sequencename AS s, last_value AS v FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL"
      )
    ).rows)
      dump.sequences[s.s] = String(s.v)
    fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(dump)))
    const count = (t) => (dump.tables[t] || []).length
    console.log(
      `${version} (schema ${dump.schema}): sales ${count('sales')}, items ${count('sale_items')}, returns ${count('sale_returns')}, shifts ${count('shifts')}, clients ${count('clients')}, suppliers ${count('suppliers')}, purchases ${count('supplier_purchases')}, expenses ${count('expenses')}, outbox ${count('sync_outbox')}, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`
    )
  } finally {
    await svc.app.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
