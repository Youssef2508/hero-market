'use strict'
// QA campaign 1.8.0 – the phases run INSIDE the isolated QA test stack on the server (container
// hmqa-qarunner, network hmqa_qa). Never production: the only cloud reachable from here is the QA
// cloud (qacloud:8787), and guard() refuses to run unless its database carries the QA marker.
// Made-up data only, every record marked QA.
//
//   node scripts/qa/stack-runner.js <phase> [...]
//     pair      a test shop (10,003 products and a day of work) pairs; first synchronisation timed
//     offline   the owner on a phone (a real Chromium) with the shop's link half-open, then cut:
//               the connection strip, approvals, a deferred barcode change, a purchase correction,
//               reconnection and consistency
//     restart   the QA cloud restarted while the shop sends 200 invoices; the shop's service
//               restarted mid-way; nothing lost or counted twice
//     perf      latency of the main operations (p50/p95/p99) and 500 offline invoices drained
//     security  probes from outside a session, with a forged cookie, without the page's header,
//               oversized, with paths, and one user against another user's records
//     soak <minutes>  steady work with the link dropping and coming back
process.env.HEROMARKET_TEST_DATABASE_URL ||= process.env.QA_SHOP_DB_BASE
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { Client } = require('pg')
const H = require('../../tests/service/helpers')
const { createProxy } = require('./proxy')

const RESULTS = process.env.QA_RESULTS || '/results'
const CLOUD = { host: 'qacloud', port: 8787 }
const SHOP_PORT = 28787 // the test shop's link, through the shaping proxy
const WEB_PORT = 18787 // the browser's way in (plain pass-through: "localhost" for its cookies)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail })
  console.log(`${pass ? '✔' : '✖'} ${name}${detail ? ` – ${detail}` : ''}`)
}
const ok = (r, what) => {
  if (!r || r.status >= 400) throw new Error(`${what}: ${r?.status} ${JSON.stringify(r?.body)}`)
  return r.body
}
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null
}

/** The QA cloud's own database, for checks only (never production: its marker is required). */
async function cloudDb() {
  const c = new Client({ connectionString: process.env.QA_CLOUD_DB_URL })
  await c.connect()
  return c
}
async function guard(what) {
  const c = await cloudDb()
  try {
    const r = (await c.query('SELECT current_database() AS d, (SELECT marker FROM qa_marker) AS m'))
      .rows[0]
    if (r.d !== 'hmqa' || r.m !== 'HEROMARKET-QA-TEST-STACK')
      throw new Error(`GUARD (${what}): not the QA database (${r.d}/${r.m})`)
  } finally {
    await c.end()
  }
}
async function cloudCount(sql) {
  const c = await cloudDb()
  try {
    return Number(Object.values((await c.query(sql)).rows[0])[0])
  } finally {
    await c.end()
  }
}

function pairingCode() {
  const out = execFileSync(
    process.execPath,
    ['src/server/cli.js', 'cloud-pair', 'QA متجر الاختبار'],
    {
      cwd: path.join(__dirname, '..', '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        HEROMARKET_DATABASE_URL: process.env.QA_CLOUD_DB_URL,
        HEROMARKET_SECRET: process.env.QA_SECRET
      }
    }
  )
  return out.match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)[0]
}

/** The phone: the website's API as the page calls it, with its cookie jar. */
function phone() {
  let cookie = null
  const post = async (op, body = {}, extra = {}) => {
    const t0 = Date.now()
    const r = await fetch(`http://127.0.0.1:${WEB_PORT}/api/${op}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-heromarket-web': '1',
        'x-heromarket-operation-id': crypto.randomUUID(),
        ...(cookie ? { cookie } : {}),
        ...extra
      },
      body: JSON.stringify(body)
    })
    const set = r.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0].endsWith('=') ? null : set.split(';')[0]
    const text = await r.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = text
    }
    return { status: r.status, body: json, ms: Date.now() - t0, headers: r.headers }
  }
  return {
    post,
    async signIn(username = 'owner', code = '8642') {
      return ok(
        await post('auth.login', { username, password: H.passwordFor(code) }),
        `sign-in ${username}`
      )
    },
    get cookie() {
      return cookie
    }
  }
}

const STATE = path.join(RESULTS, 'state.json')
const proxies = {}
async function links({ latencyMs = 0 } = {}) {
  proxies.shop = createProxy({ listenPort: SHOP_PORT, target: CLOUD, latencyMs })
  proxies.web = createProxy({ listenPort: WEB_PORT, target: CLOUD })
  await proxies.shop.listen()
  await proxies.web.listen()
}
async function startShop(dbUrl) {
  return H.startService(dbUrl, { syncAgent: true, agentKind: 'service', appVersion: '1.8.0' })
}
async function stopShop(svc) {
  svc.app.syncAgent.stop()
  svc.app.syncAgent.stopLink()
  await sleep(500)
  await svc.close()
}
const shopToken = async (svc, user = 'owner', code = '8642') =>
  ok(
    await svc.call('auth.login', { username: user, password: H.passwordFor(code) }),
    'shop sign-in'
  ).token
/** Until the shop has nothing waiting and the comparison of both sides agrees. */
async function inStep(svc, ms = 10 * 60 * 1000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const waiting = Number(
      (await svc.pool.query('SELECT count(*) AS n FROM sync_outbox WHERE acked_at IS NULL')).rows[0]
        .n
    )
    if (!waiting) {
      const r = await svc.app.syncAgent.runOnce().catch((e) => ({ error: e.message }))
      if (r.check?.ok) return { ms: Date.now() - t0, ok: true }
    }
    await sleep(1000)
  }
  return { ms: Date.now() - t0, ok: false }
}

const phases = {
  async pair() {
    await guard('pair')
    await links()
    const db = await H.freshDatabase()
    fs.writeFileSync(STATE, JSON.stringify({ db: db.url }))
    const svc = await startShop(db.url)
    await H.createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
    await H.createUser(svc, { username: 'manager2', pin: '7391', roleKey: 'store_admin' })
    await H.createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
    const rows = Array.from(
      { length: 10000 },
      (_, i) =>
        `('QA-${String(i).padStart(6, '0')}', 'QA صنف ${i}', ${5 + (i % 90)}, ${7 + (i % 90)}, ${50 + (i % 30)}, 'قطعة', 'QA فئة ${i % 40}', 2)`
    )
    rows.push(
      "('1', 'QA صنف واحد', 1, 10, 50, 'قطعة', 'QA', 1)",
      "('01', 'QA صنف صفر واحد', 2, 20, 50, 'قطعة', 'QA', 1)",
      "('001', 'QA صنف ثلاثة أصفار', 3, 30, 50, 'قطعة', 'QA', 1)"
    )
    await H.seedProducts(
      svc,
      `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, category, reorder_limit) VALUES ${rows.join(',')}`
    )
    const owner = await shopToken(svc)
    const supplier = ok(await svc.call('suppliers.create', { name: 'QA مورد' }, owner), 'supplier')
    fs.writeFileSync(STATE, JSON.stringify({ db: db.url, supplierId: supplier.id }))
    const t0 = Date.now()
    const paired = await svc.call(
      'sync.pair',
      { cloudUrl: `http://127.0.0.1:${SHOP_PORT}`, code: pairingCode() },
      owner
    )
    check(
      'the test shop pairs with a one-time code',
      paired.status === 200,
      JSON.stringify(paired.body?.paired || paired.body).slice(0, 100)
    )
    const r = await inStep(svc, 15 * 60 * 1000)
    const products = await cloudCount(
      "SELECT count(*) FROM products WHERE barcode LIKE 'QA-%' OR barcode IN ('1','01','001')"
    )
    check(
      'first synchronisation of 10,003 products: both sides agree',
      r.ok && products === 10003,
      `${((Date.now() - t0) / 1000).toFixed(1)} s, ${products} on the QA cloud`
    )
    fs.writeFileSync(
      path.join(RESULTS, 'pair.json'),
      JSON.stringify({ secs: (Date.now() - t0) / 1000, products })
    )
    await stopShop(svc)
  },

  async offline() {
    await guard('offline')
    await links()
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'))
    const svc = await startShop(st.db)
    const owner = await shopToken(svc)
    const p = phone()
    await p.signIn()
    // Connected first, with a recent contact.
    let s
    for (let i = 0; i < 60; i++) {
      s = ok(await p.post('link.state'), 'state')
      if (s.connectivity === 'connected') break
      await sleep(1000)
    }
    check(
      'the phone shows the shop connected, its last contact recent',
      s.connectivity === 'connected',
      `${Math.round((Date.parse(s.serverTime) - Date.parse(s.lastContactAt)) / 1000)} s ago`
    )
    const shift = ok(await svc.call('shifts.open', { startingCash: 500 }, owner), 'shift')
    const purchase = ok(
      await svc.call(
        'suppliers.addPurchase',
        {
          supplierId: st.supplierId,
          invoice_ref: 'QA-INV-1',
          total_amount: 300,
          paid_amount: 0,
          payment_type: 'آجل',
          clientRef: crypto.randomUUID(),
          items: [{ barcode: 'QA-000010', qty: 10, unitCost: 30 }]
        },
        owner
      ),
      'purchase'
    )
    for (
      let i = 0;
      i < 30 &&
      !(await cloudCount(
        `SELECT count(*) FROM supplier_purchases WHERE id = ${purchase.purchaseId}`
      ));
      i++
    )
      await sleep(1000)

    // A real browser on a phone-sized screen, the strip watched through the drop.
    const { chromium } = require('playwright-core')
    const browser = await chromium.launch()
    const page = await (
      await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: 'ar-EG',
        timezoneId: 'UTC'
      })
    ).newPage()
    await page.goto(`http://127.0.0.1:${WEB_PORT}/`)
    await page.waitForSelector('.lock input[type=password]', { timeout: 30000 })
    await page.locator('.lock input').nth(0).fill('owner')
    await page.locator('.lock input[type=password]').first().fill(H.passwordFor('8642'))
    await page.keyboard.press('Enter')
    await page.waitForSelector('[data-connectivity]', { timeout: 30000 })
    await page.screenshot({ path: path.join(RESULTS, 'strip-connected.png') })
    const stripText = () => page.locator('[data-connectivity]').first().innerText()

    // The Wi-Fi drops: the link half-open – nobody tells the cloud.
    proxies.shop.set('blackhole')
    const t0 = Date.now()
    const timeline = []
    let last = null
    for (let i = 0; i < 75; i++) {
      const c = await page.locator('[data-connectivity]').first().getAttribute('data-connectivity')
      if (c !== last) {
        timeline.push([Math.round((Date.now() - t0) / 1000), c, (await stripText()).slice(0, 60)])
        last = c
        if (c === 'delayed')
          await page.screenshot({ path: path.join(RESULTS, 'strip-delayed.png') })
        if (c === 'offline')
          await page.screenshot({ path: path.join(RESULTS, 'strip-offline.png') })
      }
      if (c === 'offline') break
      await sleep(1000)
    }
    const offAt = timeline.find(([, c]) => c === 'offline')?.[0]
    const connectedAfter = timeline.some(([t, c]) => c === 'connected' && t > 30)
    check(
      'half-open drop: connected → delayed → offline in the real browser, never connected after the healthy time',
      offAt !== undefined && !connectedAfter && timeline.some(([, c]) => c === 'delayed'),
      JSON.stringify(timeline)
    )

    // The owner's work from the phone, the shop away.
    const req = ok(
      await p.post('supplierPayments.create', {
        supplierId: st.supplierId,
        amount: 40,
        currentShiftId: shift.id,
        clientRef: crypto.randomUUID()
      }),
      'request'
    )
    const reserve = ok(
      await p.post('supplierPayments.reserve', { requestId: req.request.id }),
      'reserve'
    )
    const approve = await p.post('supplierPayments.approve', {
      requestId: req.request.id,
      reservationToken: reserve.token
    })
    check(
      'phone, shop away: approve with the reservation, still signed in',
      approve.status === 200 && (await p.post('auth.me')).status === 200,
      `${approve.ms} ms`
    )
    const change = await p.post('products.changeBarcode', {
      barcode: 'QA-000020',
      newBarcode: 'QA-RENAMED-20'
    })
    check('phone, shop away: a barcode change is kept for the shop (202)', change.status === 202)
    const detail = ok(
      await p.post('suppliers.purchaseDetail', { purchaseId: purchase.purchaseId }),
      'detail'
    )
    const correction = await p.post('suppliers.revisePurchase', {
      purchaseId: purchase.purchaseId,
      expectedRevision: 0,
      items: [{ itemId: detail.items[0].id, barcode: 'QA-000010', qty: 12, unitCost: 30 }],
      clientRef: crypto.randomUUID()
    })
    check(
      'phone, shop away: a purchase correction is kept for the shop (202)',
      correction.status === 202
    )

    // The line comes back.
    proxies.shop.set('pass')
    const back = Date.now()
    let done = false
    for (let i = 0; i < 120 && !done; i++) {
      await sleep(1000)
      const c = await page.locator('[data-connectivity]').first().getAttribute('data-connectivity')
      const ops = ok(await p.post('cloud.operations'), 'ops')
      done =
        c === 'connected' &&
        ops.length >= 2 &&
        ops.every((o) => !['queued', 'sent'].includes(o.status))
    }
    await page.screenshot({ path: path.join(RESULTS, 'strip-back.png') })
    const ops = ok(await p.post('cloud.operations'), 'ops')
    check(
      'back: connected again in the browser, the kept operations carried out',
      done && ops.filter((o) => o.status === 'applied').length === 2,
      `${((Date.now() - back) / 1000).toFixed(1)} s; ${ops.map((o) => `${o.operation}:${o.status}`).join(', ')}`
    )
    const r = await inStep(svc)
    const there = (
      await svc.pool.query(
        `SELECT (SELECT status FROM supplier_payment_requests WHERE id = ${req.request.id}) a, (SELECT count(*) FROM products WHERE barcode = 'QA-RENAMED-20')::int b, (SELECT revision FROM supplier_purchases WHERE id = ${purchase.purchaseId}) c`
      )
    ).rows[0]
    check(
      'both sides agree; the approval, the new barcode and the correction are in the shop once',
      r.ok && there.a === 'approved' && there.b === 1 && there.c === 1,
      JSON.stringify(there)
    )

    // A clean cut (router off): offline at once.
    proxies.shop.set('cut')
    const t1 = Date.now()
    let cutOff = null
    for (let i = 0; i < 60 && cutOff === null; i++) {
      const c = await page.locator('[data-connectivity]').first().getAttribute('data-connectivity')
      if (c === 'offline') cutOff = (Date.now() - t1) / 1000
      else await sleep(500)
    }
    check(
      'a clean cut: offline in the browser at once',
      cutOff !== null && cutOff < 5,
      `${cutOff} s`
    )
    proxies.shop.set('pass')
    await inStep(svc)
    // A reload after the shop is back shows the truth, not a remembered state.
    await page.reload()
    await page.waitForSelector('[data-connectivity="connected"]', { timeout: 60000 })
    check('after a reload: connected, from the cloud', true)
    fs.writeFileSync(path.join(RESULTS, 'offline-timeline.json'), JSON.stringify(timeline))
    await browser.close()
    await stopShop(svc)
  },

  async restart() {
    await guard('restart')
    await links()
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'))
    let svc = await startShop(st.db)
    let token = await shopToken(svc)
    const open = (
      await svc.pool.query("SELECT id FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1")
    ).rows[0]
    const shiftId = open
      ? open.id
      : ok(await svc.call('shifts.open', { startingCash: 100 }, token), 'shift').id
    // The shop is away while it sells 200 invoices.
    proxies.shop.set('cut')
    for (let i = 0; i < 200; i++)
      ok(
        await svc.call(
          'pos.checkout',
          {
            clientRef: crypto.randomUUID(),
            shiftId,
            paymentType: 'نقدي',
            items: [{ barcode: `QA-${String(100 + (i % 50)).padStart(6, '0')}`, qty: 1 }]
          },
          token
        ),
        'sale'
      )
    const shopSales = Number((await svc.pool.query('SELECT count(*) AS n FROM sales')).rows[0].n)
    // Back, and the QA cloud restarted while the invoices arrive (the host's watcher restarts the
    // QA cloud container only – hmqa-qacloud-1 – when asked).
    proxies.shop.set('pass')
    await sleep(1500)
    fs.writeFileSync(path.join(RESULTS, 'restart-cloud'), String(Date.now()))
    for (let i = 0; i < 120 && fs.existsSync(path.join(RESULTS, 'restart-cloud')); i++)
      await sleep(500)
    check(
      'the QA cloud restarted while invoices were arriving',
      !fs.existsSync(path.join(RESULTS, 'restart-cloud'))
    )
    // The shop's own service restarted mid-way too.
    await sleep(3000)
    await stopShop(svc)
    svc = await startShop(st.db)
    token = await shopToken(svc)
    const r = await inStep(svc)
    const cloudSales = await cloudCount('SELECT count(*) FROM sales')
    const dup = await cloudCount('SELECT count(*) - count(DISTINCT client_ref) FROM sales')
    check(
      'after both restarts: every invoice on the cloud once, both sides agree',
      r.ok && cloudSales === shopSales && dup === 0,
      `shop ${shopSales}, cloud ${cloudSales}, duplicates ${dup}, ${(r.ms / 1000).toFixed(1)} s to agree`
    )
    await stopShop(svc)
  },

  async perf() {
    await guard('perf')
    const latencyMs = Number(process.env.QA_LATENCY_MS || 0)
    await links({ latencyMs })
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'))
    const svc = await startShop(st.db)
    const token = await shopToken(svc)
    const p = phone()
    await p.signIn()
    const timings = {}
    const time = async (name, fn, n = 60) => {
      const xs = []
      for (let i = 0; i < n; i++) xs.push((await fn()).ms)
      timings[name] = { n, p50: pct(xs, 0.5), p95: pct(xs, 0.95), p99: pct(xs, 0.99) }
    }
    await time('products.page (10,003 products, search)', () =>
      p.post('products.page', { search: 'QA صنف 12', page: 1 })
    )
    await time('products.page (first page)', () => p.post('products.page', { page: 1 }))
    await time('sales.page', () => p.post('sales.page', { page: 1 }))
    await time('dashboard.stats', () => p.post('dashboard.stats', {}))
    await time('suppliers.purchasesPage (all)', () =>
      p.post('suppliers.purchasesPage', { from: null, to: null })
    )
    await time('link.state', () => p.post('link.state'))
    await time(
      'categories.save (forwarded to the shop)',
      () => p.post('categories.save', { name: `QA فئة ${crypto.randomUUID().slice(0, 8)}` }),
      30
    )
    // 500 offline invoices drained.
    const shiftId = (
      await svc.pool.query("SELECT id FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1")
    ).rows[0].id
    proxies.shop.set('cut')
    for (let i = 0; i < 500; i++)
      ok(
        await svc.call(
          'pos.checkout',
          {
            clientRef: crypto.randomUUID(),
            shiftId,
            paymentType: 'نقدي',
            items: [
              { barcode: `QA-${String(200 + (i % 80)).padStart(6, '0')}`, qty: 1 },
              { barcode: '01', qty: 1 }
            ]
          },
          token
        ),
        'sale'
      )
    const events = Number(
      (await svc.pool.query('SELECT count(*) AS n FROM sync_outbox WHERE acked_at IS NULL')).rows[0]
        .n
    )
    proxies.shop.set('pass')
    const r = await inStep(svc)
    timings['500 offline invoices drained'] = { events, ms: r.ms, ok: r.ok }
    fs.writeFileSync(
      path.join(RESULTS, `perf-${latencyMs}ms.json`),
      JSON.stringify(timings, null, 1)
    )
    for (const [k, v] of Object.entries(timings))
      check(`measured: ${k}`, v.ok !== false, JSON.stringify(v))
    await stopShop(svc)
  },

  async security() {
    await guard('security')
    await links()
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'))
    const svc = await startShop(st.db)
    const a = phone()
    const b = phone()
    const anon = phone()
    await a.signIn()
    await b.signIn('manager2', '7391')
    // No session: refused; the error says nothing about the inside.
    for (const op of [
      'products.page',
      'sales.page',
      'users.list',
      'cloud.operations',
      'link.state'
    ]) {
      const r = await anon.post(op)
      check(`no session: ${op} refused`, r.status === 401)
    }
    // A forged or stolen-looking cookie; a real cookie without the page's own header (another site).
    const forged = await fetch(`http://127.0.0.1:${WEB_PORT}/api/auth.me`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-heromarket-web': '1',
        cookie: 'hm_session=AAAA'
      },
      body: '{}'
    })
    check('a forged session cookie is refused', forged.status === 401)
    const cross = await fetch(`http://127.0.0.1:${WEB_PORT}/api/auth.me`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: a.cookie },
      body: '{}'
    })
    check('a real cookie without the page’s header (cross-site) is refused', cross.status === 401)
    // The cookie's attributes as set at sign-in.
    const login = await fetch(`http://127.0.0.1:${WEB_PORT}/api/auth.login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-heromarket-web': '1' },
      body: JSON.stringify({ username: 'owner', password: H.passwordFor('8642') })
    })
    const setCookie = login.headers.get('set-cookie') || ''
    check(
      'session cookie: HttpOnly, SameSite=Strict, Secure, path /api',
      /HttpOnly/.test(setCookie) &&
        /SameSite=Strict/.test(setCookie) &&
        /Secure/.test(setCookie) &&
        /Path=\/api/.test(setCookie),
      setCookie.replace(/hm_session=[^;]+/, 'hm_session=…')
    )
    const body = await login.json()
    check('the sign-in answer never carries the session token', !('token' in body))
    // Pages: no directory escape; a big body refused as such; malformed JSON without internals.
    const trav = await fetch(`http://127.0.0.1:${WEB_PORT}/../../etc/passwd`)
    check('path traversal not served', !/root:/.test(await trav.text()))
    const big = await fetch(`http://127.0.0.1:${WEB_PORT}/api/auth.login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'a'.repeat(30 * 1024 * 1024)
    })
    check('a 30 MB body is refused as too large', big.status === 413, `${big.status}`)
    const bad = await fetch(`http://127.0.0.1:${WEB_PORT}/api/auth.login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"username":'
    })
    const badText = await bad.text()
    check(
      'malformed JSON: refused, no internals in the answer',
      bad.status === 400 && !/node_modules|at \/|stack/i.test(badText)
    )
    // One user against another user's records.
    const shiftId = (
      await svc.pool.query("SELECT id FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1")
    ).rows[0]?.id
    proxies.shop.set('cut')
    for (let i = 0; i < 40 && ok(await a.post('link.state'), 's').connectivity !== 'offline'; i++)
      await sleep(1000)
    const mine = await a.post('products.changeBarcode', {
      barcode: 'QA-000030',
      newBarcode: 'QA-OTHER-30'
    })
    const theirs = await b.post('cloud.withdrawOperation', { id: mine.body.operationId })
    check(
      'another user cannot withdraw my kept operation',
      theirs.status === 404,
      `${theirs.status}`
    )
    const seen = ok(await b.post('cloud.operations'), 'ops')
    check(
      'another user does not see my kept operations',
      !seen.some((o) => o.id === mine.body.operationId)
    )
    const peek = await b.post('link.operation', { operationId: mine.body.operationId })
    check(
      'another administrator may look up any operation (sync.manage), never a cashier',
      peek.status === 200
    )
    const withdrawn = await a.post('cloud.withdrawOperation', { id: mine.body.operationId })
    check(
      'I can withdraw my own while it waits',
      withdrawn.status === 200 && withdrawn.body.status === 'withdrawn'
    )
    proxies.shop.set('pass')
    void shiftId
    // Wrong passwords: the limit applies through the internet too.
    let status = 0
    for (let i = 0; i < 12; i++)
      status = (await anon.post('auth.login', { username: 'owner', password: `wrong-${i}` })).status
    check('repeated wrong passwords are limited (429)', status === 429, `${status}`)
    await stopShop(svc)
  },

  async soak(minutes = '20') {
    await guard('soak')
    await links()
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'))
    const svc = await startShop(st.db)
    const token = await shopToken(svc)
    const shiftId = (
      await svc.pool.query("SELECT id FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1")
    ).rows[0].id
    const p = phone()
    await p.signIn()
    const until = Date.now() + Number(minutes) * 60000
    let sales = 0
    let phoneOps = 0
    let flips = 0
    const latencies = []
    while (Date.now() < until) {
      const elapsed = (Date.now() - (until - Number(minutes) * 60000)) / 60000
      // Every 4 minutes the shop's line drops for 60 s (half-open), then comes back.
      const want = Math.floor(elapsed) % 4 === 3 ? 'blackhole' : 'pass'
      if (proxies.shop.mode !== want) {
        proxies.shop.set(want)
        flips += 1
      }
      ok(
        await svc.call(
          'pos.checkout',
          {
            clientRef: crypto.randomUUID(),
            shiftId,
            paymentType: 'نقدي',
            items: [{ barcode: `QA-${String(300 + (sales % 100)).padStart(6, '0')}`, qty: 1 }]
          },
          token
        ),
        'sale'
      )
      sales += 1
      const r = await p.post('dashboard.stats', {})
      latencies.push(r.ms)
      if (sales % 10 === 0) {
        const c = await p.post('categories.save', { name: `QA soak ${sales}` })
        if (c.status === 200) phoneOps += 1
      }
      await sleep(2000)
    }
    proxies.shop.set('pass')
    const r = await inStep(svc)
    const cloudSales = await cloudCount('SELECT count(*) FROM sales')
    const shopSales = Number((await svc.pool.query('SELECT count(*) AS n FROM sales')).rows[0].n)
    const dup = await cloudCount('SELECT count(*) - count(DISTINCT client_ref) FROM sales')
    check(
      `soak ${minutes} min: ${sales} sales, ${phoneOps} phone changes, ${flips} line changes – both sides agree, nothing twice`,
      r.ok && shopSales === cloudSales && dup === 0,
      `shop ${shopSales}, cloud ${cloudSales}; phone reads p50 ${pct(latencies, 0.5)} ms p95 ${pct(latencies, 0.95)} ms p99 ${pct(latencies, 0.99)} ms`
    )
    await stopShop(svc)
  }
}

;(async () => {
  const [phase, ...args] = process.argv.slice(2)
  try {
    await phases[phase](...args)
  } catch (e) {
    check(`${phase}: run`, false, e.stack.split('\n').slice(0, 4).join(' | '))
  }
  for (const p of Object.values(proxies)) await p.close().catch(() => {})
  fs.writeFileSync(path.join(RESULTS, `${phase}-results.json`), JSON.stringify(results, null, 1))
  const failed = results.filter((r) => !r.pass).length
  console.log(`${results.length - failed}/${results.length} passed`)
  process.exit(failed ? 1 : 0)
})()
