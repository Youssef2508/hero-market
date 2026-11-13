// Cloud rehearsal (pre-production audit): a disposable shop pairs with a real HeroMarket cloud and
// works through the shop and through the internet while failures are injected – the shop killed
// with changes waiting, the cloud service and its database restarted under load, the shop off while
// the phone keeps working. The driver records everything it submits and checks both databases
// against that record, then compares them row for row with plain SQL (to_jsonb by key), never with
// the sync code under test.
//
// DESTRUCTIVE FOR THE CLOUD: only against a cloud that holds no real store – before the handover,
// or a staging copy. It pairs a test store with it; afterwards empty it (deploy/cloud/reset-empty.sh).
// Needs: the development PostgreSQL (npm run pg:dev), and SSH to the server as `ssh heromarket`
// (for the one-time pairing code, the restarts and reading the cloud's copy).
//
//   node scripts/cloud-rehearsal/run.js [https://cloud-address]
const REPO = require('path').join(__dirname, '..', '..')
const path = require('path')
const crypto = require('crypto')
const { spawn, execFileSync } = require('child_process')
const { Client } = require(`${REPO}/node_modules/pg`)
const pgDev = require(`${REPO}/scripts/pg-dev`)
const { hashPassword } = require(`${REPO}/src/server/auth/password`)

const CLOUD = process.argv[2] || 'https://heromarket.duckdns.org'
const PORT = 18791
const SHOP = `http://127.0.0.1:${PORT}`
const SECRET = 'live-campaign-shop-secret-'.padEnd(48, 'x')
const DBNAME = `hm_live_${crypto.randomBytes(4).toString('hex')}`
const PASS = { owner: 'Kq7-mango-river-71', cashier: 'Zt4-cedar-lamp-53' }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ref = (p) => `${p}-${crypto.randomUUID()}`

// ── What the driver submitted (ground truth) ───────────────────────────────────
const truth = {
  sales: new Map(), // clientRef → { total, payment, items: [[barcode, qty]] }
  stockOut: new Map(), // barcode → units sold or damaged, net of returns
  returns: [], // { saleRef, barcode, qty }
  expenses: new Map() // clientRef → amount
}
const PRODUCTS = Array.from({ length: 20 }, (_, i) => ({
  barcode: `AUD${String(i + 1).padStart(3, '0')}`,
  name: `صنف اختبار ${i + 1}`,
  price: 5 + i,
  stock: 1000
}))
const priceOf = Object.fromEntries(PRODUCTS.map((p) => [p.barcode, p.price]))

// ── Shop process ───────────────────────────────────────────────────────────────
let shopProc = null
function startShop() {
  return new Promise((resolve, reject) => {
    shopProc = spawn(process.execPath, [path.join(__dirname, 'shop.js')], {
      env: { ...process.env, HM_DB: pgDev.url(DBNAME), HM_SECRET: SECRET, HM_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    shopProc.stdout.on('data', (d) => {
      out += d
      if (out.includes('READY')) resolve()
    })
    shopProc.stderr.on('data', (d) => process.stderr.write(`[shop] ${d}`))
    shopProc.on('exit', (code) => {
      if (!out.includes('READY')) reject(new Error(`shop exited ${code}`))
    })
  })
}
/** A crash or power cut: no shutdown, no flush, nothing finishes. */
function killShop() {
  if (!shopProc) return
  if (process.platform === 'win32')
    execFileSync('taskkill', ['/F', '/PID', String(shopProc.pid)], { stdio: 'ignore' })
  else shopProc.kill('SIGKILL')
  shopProc = null
}

// ── Calls ──────────────────────────────────────────────────────────────────────
async function call(base, op, body = {}, token = null, headers = {}) {
  const res = await fetch(`${base}/api/${op}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000)
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text.slice(0, 200) }
  }
  return { status: res.status, body: json }
}
const ok = (r, what) => {
  if (r.status !== 200)
    throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`)
  return r.body
}
const shop = (op, body, token, h) => call(SHOP, op, body, token, h)
const cloud = (op, body, token, h) => call(CLOUD, op, body, token, h)

// ── Databases ──────────────────────────────────────────────────────────────────
async function shopDb(sql, params) {
  const c = new Client({ connectionString: pgDev.url(DBNAME) })
  await c.connect()
  try {
    return (await c.query(sql, params)).rows
  } finally {
    await c.end()
  }
}
function ssh(cmd, input) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', 'heromarket', cmd], {
    encoding: 'utf8',
    input,
    maxBuffer: 256 * 1024 * 1024
  })
}
const COMPOSE = 'cd /opt/heromarket && sudo docker compose -f deploy/cloud/docker-compose.yml'
/** An SSH command in the background, so the driver keeps working while it runs. */
function spawnSsh(cmd) {
  return new Promise((resolve) => {
    const p = spawn('ssh', ['-o', 'BatchMode=yes', 'heromarket', cmd], { stdio: 'ignore' })
    p.on('exit', resolve)
  })
}
/** One query on the cloud's database, rows as JSON (read-only use). */
function cloudSql(sql) {
  // Compressed, so a large answer is a short transfer (a long one was reset on the shop's Wi-Fi).
  for (let attempt = 1; ; attempt++) {
    try {
      const out = ssh(
        `${COMPOSE} exec -T db psql -U heromarket -d heromarket -At -v ON_ERROR_STOP=1 | gzip -c | base64 -w0`,
        `SELECT COALESCE(json_agg(q), '[]') FROM (${sql}) q;\n`
      )
      const text = require('zlib').gunzipSync(Buffer.from(out.trim(), 'base64')).toString('utf8')
      return JSON.parse(text.trim() || '[]')
    } catch (e) {
      if (attempt >= 4) throw e
      log(`  cloud query retry ${attempt}: ${String(e.message).slice(0, 80)}`)
    }
  }
}

// ── Sale helpers ───────────────────────────────────────────────────────────────
function basket(seed) {
  const n = 1 + (seed % 3)
  return Array.from({ length: n }, (_, i) => [
    PRODUCTS[(seed * 7 + i * 3) % PRODUCTS.length].barcode,
    1 + ((seed + i) % 4)
  ])
}
async function sell(via, token, shiftId, seed, payment = 'نقدي', extra = {}, headers = {}) {
  const items = basket(seed)
  const clientRef = ref(`sale-${seed}`)
  const total = items.reduce((s, [b, q]) => s + priceOf[b] * q, 0)
  const body = {
    clientRef,
    shiftId,
    paymentType: payment,
    items: items.map(([barcode, qty]) => ({ barcode, qty })),
    ...extra
  }
  const r = await via('pos.checkout', body, token, headers)
  if (r.status === 200) {
    truth.sales.set(clientRef, { total, payment, items })
    for (const [b, q] of items) truth.stockOut.set(b, (truth.stockOut.get(b) || 0) + q)
  }
  return { r, clientRef, total, items, body }
}

// ── Convergence ────────────────────────────────────────────────────────────────
async function shopPending() {
  return Number((await shopDb('SELECT count(*) n FROM sync_outbox WHERE acked_at IS NULL'))[0].n)
}
async function waitSynced(label, ms = 240000) {
  const until = Date.now() + ms
  let n
  while (Date.now() < until) {
    n = await shopPending().catch(() => -1)
    if (n === 0) {
      log(`${label}: shop outbox empty`)
      return
    }
    await sleep(2000)
  }
  throw new Error(`${label}: still ${n} changes waiting after ${ms / 1000}s`)
}

// ── Oracle ─────────────────────────────────────────────────────────────────────
// Independent of the sync code: plain to_jsonb rows of every synchronised table, by key.
const LOCAL_ONLY = new Set(['remote_operations', 'applied_commands'])
async function tablesAndKeys() {
  return (await shopDb('SELECT table_name, key_column FROM sync_tables ORDER BY 1')).filter(
    (t) => !LOCAL_ONLY.has(t.table_name)
  )
}
const keyOf = (row, keyCol) =>
  keyCol
    .split(',')
    .map((k) => row[k.trim()])
    .join('|')
async function compareCopies() {
  const tables = await tablesAndKeys()
  const diffs = []
  const colDiffs = new Map()
  let rows = 0
  for (const { table_name: t, key_column: k } of tables) {
    const sql = `SELECT to_jsonb(x) r FROM "${t}" x`
    const a = new Map((await shopDb(sql)).map((x) => [keyOf(x.r, k), x.r]))
    const b = new Map(cloudSql(sql).map((x) => [keyOf(x.r, k), x.r]))
    rows += a.size
    for (const [key, row] of a) {
      const other = b.get(key)
      if (!other) {
        diffs.push(`${t}/${key}: missing in the cloud`)
        continue
      }
      for (const col of Object.keys(row)) {
        if (JSON.stringify(row[col]) !== JSON.stringify(other[col])) {
          const ck = `${t}.${col}`
          colDiffs.set(ck, (colDiffs.get(ck) || 0) + 1)
        }
      }
    }
    for (const key of b.keys()) if (!a.has(key)) diffs.push(`${t}/${key}: only in the cloud`)
  }
  return { tables: tables.length, rows, diffs, colDiffs: [...colDiffs.entries()] }
}

/** The business the driver submitted, against what each database holds. */
async function checkTruth(label, q) {
  const problems = []
  const refs = [...truth.sales.keys()]
  const held = await q(
    `SELECT client_ref, total_amount::float8 total, payment_type FROM sales WHERE client_ref IS NOT NULL`
  )
  const byRef = new Map(held.map((s) => [s.client_ref, s]))
  for (const r of refs) {
    const want = truth.sales.get(r)
    const got = byRef.get(r)
    if (!got) problems.push(`sale ${r} missing`)
    else if (Math.abs(got.total - want.total) > 0.005)
      problems.push(`sale ${r} total ${got.total} != ${want.total}`)
  }
  const dupes = await q(
    `SELECT client_ref, count(*) n FROM sales WHERE client_ref IS NOT NULL GROUP BY 1 HAVING count(*) > 1`
  )
  for (const d of dupes) problems.push(`sale ${d.client_ref} recorded ${d.n} times`)
  const extra = held.filter(
    (s) => s.client_ref.startsWith('sale-') && !truth.sales.has(s.client_ref)
  )
  for (const e of extra)
    problems.push(`sale ${e.client_ref} recorded but the driver saw it refused`)
  // Stock: opening minus what was sold, damaged or returned – and equal to its movements.
  const stock = await q(
    `SELECT p.barcode, p.stock_qty::float8 qty, COALESCE((SELECT sum(qty) FROM stock_movements m WHERE m.product_barcode = p.barcode), 0)::float8 moved
       FROM products p WHERE p.barcode LIKE 'AUD%'`
  )
  for (const s of stock) {
    const want = 1000 - (truth.stockOut.get(s.barcode) || 0)
    if (Math.abs(s.qty - want) > 0.0005) problems.push(`stock ${s.barcode} ${s.qty} != ${want}`)
    if (Math.abs(s.qty - s.moved) > 0.0005)
      problems.push(`stock ${s.barcode} ${s.qty} != its movements ${s.moved}`)
  }
  const orphans = await q(
    `SELECT 'sale_items' t, count(*) n FROM sale_items i WHERE NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = i.sale_id)
     UNION ALL SELECT 'sales.client', count(*) FROM sales s WHERE s.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = s.client_id)
     UNION ALL SELECT 'sales.shift', count(*) FROM sales s WHERE s.shift_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shifts h WHERE h.id = s.shift_id)
     UNION ALL SELECT 'treasury.shift', count(*) FROM treasury_ledger t WHERE t.shift_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shifts h WHERE h.id = t.shift_id)`
  )
  for (const o of orphans) if (Number(o.n)) problems.push(`${o.n} orphan ${o.t}`)
  // Every expense the driver made is 37.25; exactly as many must exist, once each.
  const exp = await q(`SELECT count(*)::int n FROM expenses WHERE amount = 37.25`)
  if (exp[0].n !== truth.expenses.size)
    problems.push(`expenses ${exp[0].n} != ${truth.expenses.size}`)
  log(
    `${label}: ${truth.sales.size} sales, ${truth.expenses.size} expenses checked – ${problems.length ? 'PROBLEMS' : 'all as submitted'}`
  )
  return problems
}

// ── The campaign ───────────────────────────────────────────────────────────────
const report = []
const step = (name, result) => {
  report.push({ name, ...result })
  log(`${result.pass ? 'PASS' : 'FAIL'} ${name}${result.note ? ' – ' + result.note : ''}`)
}

async function main() {
  // 0. A disposable shop database.
  const admin = new Client({ connectionString: pgDev.url('postgres') })
  await admin.connect()
  await admin.query(
    `CREATE DATABASE ${DBNAME} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`
  )
  await admin.end()
  log(`shop database ${DBNAME}`)
  await startShop()

  // 1. The shop's first run, made-up data only.
  const setup = ok(
    await shop('auth.setup', { username: 'audit-owner', password: PASS.owner }),
    'setup'
  )
  const owner = setup.token
  await shopDb(
    `INSERT INTO roles (key, name, description) VALUES (NULL, 'كاشير اختبار إنترنت', 'اختبار التدقيق');
     INSERT INTO role_permissions (role_id, permission)
       SELECT (SELECT id FROM roles WHERE name = 'كاشير اختبار إنترنت'), permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = 'cashier'
       UNION SELECT (SELECT id FROM roles WHERE name = 'كاشير اختبار إنترنت'), unnest(ARRAY['internet.access', 'expenses.manage', 'suppliers.payment_request']);
     UPDATE settings SET value = 'متجر اختبار التدقيق' WHERE key = 'store_name'`
  )
  await shopDb(
    `INSERT INTO users (username, role, role_id, password_scrypt, is_active, created_at)
     VALUES ('audit-cashier', 'cashier', (SELECT id FROM roles WHERE name = 'كاشير اختبار إنترنت'), $1, true, LOCALTIMESTAMP(0))`,
    [await hashPassword(PASS.cashier)]
  )
  {
    const c = new Client({ connectionString: pgDev.url(DBNAME) })
    await c.connect()
    await c.query('BEGIN')
    await c.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
    for (const p of PRODUCTS)
      await c.query(
        `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, category, reorder_limit)
         VALUES ($1, $2, $3, $4, $5, 'قطعة', 'اختبار', 5)`,
        [p.barcode, p.name, p.price - 2, p.price, p.stock]
      )
    await c.query("SELECT hm_post_opening_balances('audit seed')")
    await c.query('COMMIT')
    await c.end()
  }
  const cashier = ok(
    await shop('auth.login', { username: 'audit-cashier', password: PASS.cashier }, null, {
      'x-heromarket-terminal': 'Audit-Till-1'
    }),
    'cashier login'
  ).token
  const supplier = ok(
    await shop('suppliers.create', { name: 'مورد اختبار التدقيق' }, owner),
    'supplier'
  )
  const shift = ok(await shop('shifts.open', { startingCash: 500 }, cashier), 'shift')
  for (let i = 0; i < 10; i++) await sell(shop, cashier, shift.id, i)
  log(`shop ready: ${truth.sales.size} sales before pairing`)

  // 2. Pairing with the real cloud: a one-time code made on the server, never printed.
  const out = ssh(
    `${COMPOSE} exec -T cloud node src/server/cli.js cloud-pair "متجر اختبار التدقيق"`
  )
  const code = (out.match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/) || [])[0]
  if (!code) throw new Error('no pairing code in the server output')
  const paired = ok(await shop('sync.pair', { cloudUrl: CLOUD, code }, owner), 'pair')
  step('pairing with the deployed cloud', { pass: !!paired, note: 'one-time code, HTTPS' })
  const reuse = await shop('sync.pair', { cloudUrl: CLOUD, code }, owner)
  step('a pairing code works once', {
    pass: reuse.status !== 200,
    note: `second use → ${reuse.status}`
  })
  await waitSynced('first registration')
  const first = await compareCopies()
  step('first registration: the cloud holds exactly the shop', {
    pass: !first.diffs.length,
    note: `${first.tables} tables, ${first.rows} rows, ${first.diffs.length} row differences`
  })

  // 3. Connected: the internet way in, carried out by the shop.
  await sleep(4000)
  const ownerWeb = ok(
    await cloud('auth.login', { username: 'audit-owner', password: PASS.owner }, null, {
      'x-heromarket-terminal': 'Audit-Phone'
    }),
    'cloud login'
  ).token
  const cashierWeb = ok(
    await cloud('auth.login', { username: 'audit-cashier', password: PASS.cashier }, null, {
      'x-heromarket-terminal': 'Audit-Phone-2'
    }),
    'cloud cashier login'
  ).token
  const viaWeb = await sell(
    cloud,
    cashierWeb,
    shift.id,
    100,
    'نقدي',
    {},
    { 'x-heromarket-operation-id': crypto.randomUUID() }
  )
  step('a sale from the internet is carried out by the shop', {
    pass: viaWeb.r.status === 200,
    note: `${viaWeb.r.status}`
  })
  // The same operation id twice, at the same moment: one sale.
  {
    const opId = crypto.randomUUID()
    const items = basket(101)
    const body = {
      clientRef: ref('sale-dup'),
      shiftId: shift.id,
      paymentType: 'نقدي',
      items: items.map(([barcode, qty]) => ({ barcode, qty }))
    }
    const [a, b] = await Promise.all([
      cloud('pos.checkout', body, cashierWeb, { 'x-heromarket-operation-id': opId }),
      cloud('pos.checkout', body, cashierWeb, { 'x-heromarket-operation-id': opId })
    ])
    if (a.status === 200 || b.status === 200) {
      truth.sales.set(body.clientRef, {
        total: items.reduce((s, [x, q]) => s + priceOf[x] * q, 0),
        payment: 'نقدي',
        items
      })
      for (const [x, q] of items) truth.stockOut.set(x, (truth.stockOut.get(x) || 0) + q)
    }
    step('the same internet operation sent twice at once', {
      pass: [a.status, b.status].includes(200),
      note: `${a.status}/${b.status}`
    })
  }
  // A lost answer: the phone gives up waiting, then retries with the same id.
  {
    const opId = crypto.randomUUID()
    const items = basket(102)
    const body = {
      clientRef: ref('sale-lost'),
      shiftId: shift.id,
      paymentType: 'نقدي',
      items: items.map(([barcode, qty]) => ({ barcode, qty }))
    }
    const ctl = new AbortController()
    const first = fetch(`${CLOUD}/api/pos.checkout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cashierWeb}`,
        'x-heromarket-operation-id': opId
      },
      body: JSON.stringify(body),
      signal: ctl.signal
    }).catch(() => null)
    await sleep(150)
    ctl.abort()
    await first
    await sleep(3000)
    const again = await cloud('pos.checkout', body, cashierWeb, {
      'x-heromarket-operation-id': opId
    })
    if (again.status === 200) {
      truth.sales.set(body.clientRef, {
        total: items.reduce((s, [x, q]) => s + priceOf[x] * q, 0),
        payment: 'نقدي',
        items
      })
      for (const [x, q] of items) truth.stockOut.set(x, (truth.stockOut.get(x) || 0) + q)
    }
    step('a lost answer, then a retry with the same id', {
      pass: again.status === 200,
      note: `${again.status}`
    })
  }
  // An expense from the internet and one at the shop.
  for (const [via, token] of [
    [cloud, cashierWeb],
    [shop, cashier]
  ]) {
    const clientRef = ref('expense')
    const r = await via(
      'expenses.create',
      { amount: 37.25, currentShiftId: shift.id, clientRef, destination: 'shift' },
      token,
      via === cloud ? { 'x-heromarket-operation-id': crypto.randomUUID() } : {}
    )
    if (r.status === 200) truth.expenses.set(clientRef, 37.25)
    else
      log(
        `expense via ${via === cloud ? 'cloud' : 'shop'}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`
      )
  }
  // A supplier payment beyond what is owed, from the internet (1.6.1).
  const pay = await cloud(
    'supplierPayments.create',
    { supplierId: supplier.id, amount: 250, currentShiftId: shift.id, clientRef: ref('pay') },
    cashierWeb,
    { 'x-heromarket-operation-id': crypto.randomUUID() }
  )
  step('supplier advance from the internet (1.6.1)', {
    pass: pay.status === 200,
    note: `${pay.status} ${pay.status !== 200 ? JSON.stringify(pay.body).slice(0, 150) : ''}`
  })
  // Concurrent selling: 12 at the shop and 6 from the internet at the same time.
  {
    const jobs = []
    for (let i = 0; i < 12; i++) jobs.push(sell(shop, cashier, shift.id, 200 + i))
    for (let i = 0; i < 6; i++)
      jobs.push(
        sell(
          cloud,
          cashierWeb,
          shift.id,
          300 + i,
          'نقدي',
          {},
          { 'x-heromarket-operation-id': crypto.randomUUID() }
        )
      )
    const res = await Promise.all(jobs)
    const okCount = res.filter((x) => x.r.status === 200).length
    step('18 checkouts at once, shop and internet', {
      pass: okCount === 18,
      note: `${okCount}/18 accepted; refused: ${res
        .filter((x) => x.r.status !== 200)
        .map((x) => x.r.status)
        .join(',')}`
    })
  }
  await waitSynced('connected work')
  let t = await checkTruth('shop after connected work', shopDb)
  let c = await checkTruth('cloud after connected work', async (s) => cloudSql(s))
  step('connected work: both sides hold exactly what was submitted', {
    pass: !t.length && !c.length,
    note: [...t, ...c].slice(0, 5).join('; ')
  })

  // 4. A crash of the shop PC in the middle of sending a backlog.
  // The cloud restarts meanwhile, so a backlog builds; the shop is killed while it is waiting.
  const slow = ssh(`${COMPOSE} stop cloud`)
  for (let i = 0; i < 60; i++) await sell(shop, cashier, shift.id, 400 + i)
  const pendingAtKill = await shopPending()
  killShop()
  ssh(`${COMPOSE} start cloud`)
  void slow
  log(`shop killed with ${pendingAtKill} changes waiting`)
  await sleep(3000)
  await startShop()
  await waitSynced('after the crash')
  t = await checkTruth('shop after crash', shopDb)
  c = await checkTruth('cloud after crash', async (s) => cloudSql(s))
  step('shop crash mid-backlog: nothing lost or doubled', {
    pass: !t.length && !c.length,
    note: `${pendingAtKill} waiting at the crash; ${[...t, ...c].slice(0, 5).join('; ')}`
  })

  // 5. The cloud service restarted while the shop sends.
  // Selling while the cloud restarts underneath: the restart runs in the background.
  const restartCloud = spawnSsh(`${COMPOSE} restart cloud`)
  for (let i = 0; i < 120; i++) await sell(shop, cashier, shift.id, 600 + i)
  await restartCloud
  log(`cloud container restarted during the selling; ${await shopPending()} changes waiting`)
  await waitSynced('after the cloud restart', 300000)
  c = await checkTruth('cloud after its restart', async (s) => cloudSql(s))
  step('cloud restarted mid-push: nothing lost or doubled', {
    pass: !c.length,
    note: c.slice(0, 5).join('; ')
  })

  // 6. The cloud's PostgreSQL restarted while the shop sends.
  const restartDb = spawnSsh(`${COMPOSE} restart db`)
  for (let i = 0; i < 120; i++) await sell(shop, cashier, shift.id, 800 + i)
  await restartDb
  log(`cloud database restarted during the selling; ${await shopPending()} changes waiting`)
  await waitSynced('after the database restart', 300000)
  c = await checkTruth('cloud after its database restart', async (s) => cloudSql(s))
  const health = await call(CLOUD, 'auth.status', {})
  step('cloud database restarted mid-push: recovers, nothing lost or doubled', {
    pass: !c.length && health.status === 200,
    note: `status ${health.status}; ${c.slice(0, 5).join('; ')}`
  })

  // 7. The shop is off; the phone keeps working; the shop comes back.
  killShop()
  log('shop off; waiting until the cloud no longer hears it')
  let apartShift = null
  for (let i = 0; i < 60; i++) {
    await sleep(5000)
    const r = await cloud('shifts.open', { startingCash: 100 }, ownerWeb, {
      'x-heromarket-operation-id': crypto.randomUUID()
    })
    if (r.status === 200) {
      apartShift = r.body
      break
    }
    if (i % 6 === 0) log(`  open shift from the phone: ${r.status} ${r.body?.error?.code}`)
  }
  step('the phone opens its own shift while the shop is off', {
    pass: !!apartShift,
    note: apartShift ? `shift ${apartShift.id}` : 'never accepted'
  })
  if (apartShift) {
    for (let i = 0; i < 8; i++)
      await sell(
        cloud,
        ownerWeb,
        apartShift.id,
        1000 + i,
        'نقدي',
        {},
        { 'x-heromarket-operation-id': crypto.randomUUID() }
      )
    const closeApart = await cloud(
      'shifts.close',
      { shiftId: apartShift.id, actualCash: 0, clientRef: ref('close') },
      ownerWeb,
      { 'x-heromarket-operation-id': crypto.randomUUID() }
    )
    log(
      `  phone closes its shift: ${closeApart.status} ${closeApart.status !== 200 ? JSON.stringify(closeApart.body).slice(0, 150) : ''}`
    )
  }
  await startShop()
  await sleep(20000)
  await waitSynced('the shop back after working apart', 300000)
  await sleep(10000)
  t = await checkTruth('shop after working apart', shopDb)
  c = await checkTruth('cloud after working apart', async (s) => cloudSql(s))
  step('apart, then together: both sides hold everything, once', {
    pass: !t.length && !c.length,
    note: [...t, ...c].slice(0, 6).join('; ')
  })

  // 8. Row for row, independently of the sync code.
  await waitSynced('final')
  await sleep(8000)
  const final = await compareCopies()
  step('final: the cloud is the shop row for row (plain to_jsonb, by key)', {
    pass: !final.diffs.length,
    note: `${final.tables} tables, ${final.rows} rows; ${final.diffs.length} row differences${final.diffs.length ? ': ' + final.diffs.slice(0, 8).join('; ') : ''}`
  })
  log(
    'column differences on rows present on both sides (to be explained):',
    JSON.stringify(final.colDiffs)
  )

  killShop()
  console.log('\n=== SUMMARY ===')
  for (const r of report)
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? '  (' + r.note + ')' : ''}`)
  console.log(`shop database kept for inspection: ${DBNAME}`)
}

main().catch((e) => {
  console.error('CAMPAIGN STOPPED:', e)
  try {
    killShop()
  } catch {}
  process.exit(1)
})
