#!/usr/bin/env node
'use strict'
// Try the two ways in on this machine (Phase 2). Never a deployment: everything listens on
// 127.0.0.1, uses the development PostgreSQL (`npm run pg:dev`) and made-up data.
//
//   npm run build:web
//   node scripts/phase2-dev.js [--fresh] [--port 8790]
//
// Starts a "shop" (the service on its own database, with the sync agent), a "cloud" (the same
// service with role 'cloud' on another database, serving out/web), pairs them with a one-time
// code, and prints the address and the sign-in to use in a browser. --fresh starts from empty
// databases. The shop has no window here: use the browser, or run the desktop program against
// the shop database (HEROMARKET_DB_NAME=heromarket_p2_shop npm run dev) to see both at once.
const path = require('path')
const crypto = require('crypto')
const { Client } = require('pg')
const pgDev = require('./pg-dev')
const { createService } = require('../src/server/app')
const { newPairingCode } = require('../src/server/cloud/pairing')

const SHOP = 'heromarket_p2_shop'
const CLOUD = 'heromarket_p2_cloud'
const SECRET = 'phase2-dev-secret-'.padEnd(40, 'x')
const OWNER = { username: 'owner', password: 'Hero-Trial-2026' }
const CASHIER = { username: 'cashier', password: 'Till-Trial-2026' }

async function database(name, fresh) {
  const admin = new Client({ connectionString: pgDev.url('postgres') })
  await admin.connect()
  if (fresh) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
  if (!exists.rowCount)
    await admin.query(
      `CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`
    )
  await admin.end()
  return pgDev.url(name)
}

const caller = (svc) => async (op, body, token) => {
  const res = await svc.app.inject({
    method: 'POST',
    url: `/api/${op}`,
    payload: body || {},
    headers: token ? { authorization: `Bearer ${token}` } : {}
  })
  const json = res.body ? JSON.parse(res.body) : null
  if (res.statusCode !== 200) throw new Error(`${op}: ${res.statusCode} ${res.body}`)
  return json
}

async function seed(shop, call) {
  const owner = (await call('auth.setup', OWNER)).token
  const made = await call(
    'users.create',
    { username: CASHIER.username, roleKey: 'cashier' },
    owner
  ).catch(() => null)
  if (made?.temporaryPassword)
    await call('auth.setPassword', {
      username: CASHIER.username,
      currentPassword: made.temporaryPassword,
      newPassword: CASHIER.password
    })
  const c = await shop.pool.connect()
  try {
    await c.query('BEGIN')
    await c.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
    await c.query(`INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, category, reorder_limit) VALUES
      ('6221000000011', 'أرز مصري 1 كجم', 28, 34, 120, 'كيس', 'بقالة', 20),
      ('6221000000028', 'سكر أبيض 1 كجم', 30, 36, 80, 'كيس', 'بقالة', 20),
      ('6221000000035', 'زيت عباد الشمس 800 مل', 62, 75, 40, 'زجاجة', 'بقالة', 10),
      ('6221000000042', 'شاي 250 جم', 55, 68, 35, 'علبة', 'مشروبات', 10),
      ('6221000000059', 'مياه معدنية 1.5 لتر', 6, 8, 200, 'زجاجة', 'مشروبات', 48)`)
    await c.query("SELECT hm_post_opening_balances('phase 2 trial data')")
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    c.release()
  }
  const supplier = await call('suppliers.create', { name: 'شركة التوريدات الغذائية' }, owner)
  await call(
    'suppliers.addPurchase',
    {
      supplierId: supplier.id,
      invoice_ref: 'T-1001',
      total_amount: 1400,
      paid_amount: 500,
      clientRef: crypto.randomUUID(),
      items: [{ barcode: '6221000000011', qty: 50, unitCost: 28 }]
    },
    owner
  )
  const shift = await call('shifts.open', { startingCash: 300 }, owner)
  for (const items of [
    [
      { barcode: '6221000000011', qty: 2 },
      { barcode: '6221000000059', qty: 6 }
    ],
    [{ barcode: '6221000000035', qty: 1 }],
    [
      { barcode: '6221000000042', qty: 1 },
      { barcode: '6221000000028', qty: 2 }
    ]
  ])
    await call(
      'pos.checkout',
      { clientRef: crypto.randomUUID(), shiftId: shift.id, paymentType: 'نقدي', items },
      owner
    )
  return owner
}

async function main() {
  const args = process.argv.slice(2)
  const fresh = args.includes('--fresh')
  const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8790
  const url = `http://127.0.0.1:${port}`

  const cloud = await createService({
    databaseUrl: await database(CLOUD, fresh),
    secret: SECRET,
    timeZone: 'Africa/Cairo',
    role: 'cloud',
    webRoot: path.join(__dirname, '..', 'out', 'web'),
    insecureCookies: true,
    logger: { level: 'warn' }
  })
  await cloud.prepare()
  await cloud.app.listen({ host: '127.0.0.1', port })

  const shop = await createService({
    databaseUrl: await database(SHOP, fresh),
    secret: SECRET,
    timeZone: 'Africa/Cairo',
    syncAgent: true,
    syncIntervalMs: 15000,
    logger: { level: 'warn' }
  })
  await shop.prepare()
  // The shop's own API, as a second desktop terminal would reach it (this machine only).
  await shop.app.listen({ host: '127.0.0.1', port: port + 1 })
  const call = caller(shop)
  const hasUsers = (await shop.pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n > 0
  const owner = hasUsers ? (await call('auth.login', OWNER)).token : await seed(shop, call)

  const linked = (await call('sync.status', {}, owner)).linked
  if (!linked) {
    const { code } = await newPairingCode(cloud.pool, { name: 'هيرو ماركت (تجربة)' })
    const r = await call('sync.pair', { cloudUrl: url, code }, owner)
    console.log(`paired: ${r.paired.name} ${r.paired.fingerprint}`)
  }
  console.log(`\nHeroMarket from a browser: ${url}`)
  console.log(`  sign in: ${OWNER.username} / ${OWNER.password}`)
  console.log(
    `  (the cashier ${CASHIER.username} / ${CASHIER.password} has no internet permission)`
  )
  console.log(
    `The shop's own service (what the desktop program talks to): http://127.0.0.1:${port + 1}`
  )
  console.log('Ctrl+C to stop.')
  const stop = async () => {
    await shop.app.close().catch(() => {})
    await cloud.app.close().catch(() => {})
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
