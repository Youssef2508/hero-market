#!/usr/bin/env node
'use strict'
// Before the test helpers are loaded: they read the address once (HEROMARKET_TEST_DATABASE_URL,
// or the development PostgreSQL of npm run pg:dev).
process.env.HEROMARKET_TEST_DATABASE_URL ||= require('../pg-dev').url('postgres')
// Browser end-to-end checks of the website (1.6.3): the session across reloads, reopened tabs and
// a restarted browser, and an import followed through a reload and a lost connection. A real
// Chromium (the installed Edge or Chrome) drives the real pages (out/web) served by a cloud paired
// with a shop, both on throw-away databases with made-up data. Never a real store.
//
//   npm run build:web
//   npm install --no-save playwright-core
//   node scripts/e2e/browser.js [--headed]   (HEROMARKET_TEST_DATABASE_URL, or npm run pg:dev)
//
// Exit code 1 when a check fails.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { chromium } = require('playwright-core')
const { makeTwin } = require('../../tests/service/cloudHelpers')
const { passwordFor } = require('../../tests/service/helpers')

const WEB = path.join(__dirname, '..', '..', 'out', 'web')
const HEADED = process.argv.includes('--headed')
const SHELL = '.sidebar-nav, .phone-bar'
const SIGN_IN = '.lock input[type=password]'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` – ${detail}` : ''}`)
}

async function launch(userDataDir) {
  const errors = []
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launchPersistentContext(userDataDir, {
        channel,
        headless: !HEADED,
        viewport: { width: 1366, height: 900 },
        locale: 'ar-EG'
      })
    } catch (e) {
      errors.push(`${channel}: ${e.message.split('\n')[0]}`)
    }
  }
  throw new Error(`no browser: ${errors.join('; ')}`)
}

// Records whether the sign-in form was ever on the page (even for a moment) since it loaded. (The
// start-up screen shares its layout, without a password field.)
const WATCH_LOCK = () => {
  window.__sawLock = false
  new MutationObserver(() => {
    if (document.querySelector('.lock input[type=password]')) window.__sawLock = true
  }).observe(document, { childList: true, subtree: true })
}

async function signIn(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.lock input[type=password]', { timeout: 20000 })
  await page.locator('.lock input').nth(0).fill('owner')
  await page.locator('.lock input[type=password]').first().fill(passwordFor('8642'))
  await page.keyboard.press('Enter')
  await page.waitForSelector(SHELL, { timeout: 20000 })
}

/** After a load: the shell, never the sign-in screen on the way. */
async function stayedIn(page) {
  await page.waitForSelector(`${SHELL}, ${SIGN_IN}`, { timeout: 20000 })
  await page.waitForTimeout(300)
  return {
    shell: (await page.locator(SHELL).count()) > 0,
    sawLock: await page.evaluate(() => window.__sawLock)
  }
}

async function openImport(page) {
  await page.locator('.sidebar-nav .nav-item', { hasText: 'استيراد وتصدير' }).first().click()
  await page.waitForSelector('text=استيراد بيانات المتجر من Excel', { timeout: 15000 })
}

async function workbook(n, file) {
  const imp = (p) => import(pathToFileURL(path.join(__dirname, '..', '..', p)).href)
  const { exportSheets } = await imp('src/shared/storeImport.mjs')
  const writeExcelFile = (await imp('node_modules/write-excel-file/node/index.js')).default
  const products = Array.from({ length: n }, (_, i) => ({
    barcode: i % 10 === 7 ? '' : `E2E${String(i).padStart(8, '0')}`,
    name: `صنف تجربة ${i}`,
    retail_price: 10 + (i % 40),
    cost_price: 8 + (i % 40),
    stock_qty: i % 3 ? 12 : 0,
    unit: i % 10 === 3 ? 'كيلو' : 'قطعة',
    unit_kind: i % 10 === 3 ? 'بالوزن' : 'بالعدد',
    category: `فئة تجربة ${i % 15}`,
    reorder_limit: 3,
    pack_name: i % 10 === 1 ? 'كرتونة' : null,
    pack_factor: i % 10 === 1 ? 12 : null,
    pack_barcode: i % 10 === 1 ? `E2EP${i}` : null,
    pack_price: null,
    pack_cost: null
  }))
  fs.writeFileSync(
    file,
    await writeExcelFile(exportSheets({ products, customers: [], suppliers: [] })).toBuffer()
  )
}

;(async () => {
  if (!fs.existsSync(path.join(WEB, 'index.html'))) throw new Error('run npm run build:web first')
  const twin = await makeTwin({
    cloudOptions: { webRoot: WEB, insecureCookies: true, forwardTimeoutMs: 20000 },
    // Slow enough to reload and cut the connection while the import runs.
    shopOptions: {
      importPollMs: 500,
      importOnStep: () => new Promise((r) => setTimeout(r, 350))
    }
  })
  // The shop sends its changes as it makes them (the import's progress among them).
  twin.agent.start(1000)
  await twin.agent.listen()
  await twin.cloud.app.listen({ host: '127.0.0.1', port: 0 })
  const url = `http://127.0.0.1:${twin.cloud.app.server.address().port}`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-e2e-'))
  let ctx = await launch(path.join(dir, 'profile'))
  const q = async (pool, sql, p) => Number(Object.values((await pool.query(sql, p)).rows[0])[0])
  try {
    await ctx.addInitScript(WATCH_LOCK)
    let page = ctx.pages()[0] || (await ctx.newPage())
    if (process.env.HEROMARKET_E2E_DEBUG) {
      ctx.on('console', (m) => console.log(`console ${m.type()}: ${m.text().slice(0, 200)}`))
      ctx.on('weberror', (e) => console.log(`page error: ${e.error().message}`))
      ctx.on('requestfinished', async (r) => {
        if (r.url().includes('/api/') && !/link\.(wait|state)/.test(r.url()))
          console.log(`api ${r.url().split('/api/')[1]} ${(await r.response())?.status()}`)
      })
      ctx.on('requestfailed', (r) => console.log(`failed ${r.url()} ${r.failure()?.errorText}`))
    }

    // ── Session ────────────────────────────────────────────────
    await signIn(page, url)
    const sessions = await q(
      twin.cloud.pool,
      'SELECT count(*) FROM sessions WHERE revoked_at IS NULL'
    )
    check('1. sign in', sessions === 1)

    await page.reload({ waitUntil: 'domcontentloaded' })
    let r = await stayedIn(page)
    check(
      '1. reload: still signed in, the sign-in screen never shown',
      r.shell && !r.sawLock,
      JSON.stringify(r)
    )

    let all = true
    for (let i = 0; i < 4; i++) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      r = await stayedIn(page)
      all = all && r.shell && !r.sawLock
    }
    check('2. four more reloads in a row', all)
    check(
      '2. no new session made by the reloads',
      (await q(twin.cloud.pool, 'SELECT count(*) FROM sessions')) === 1
    )

    await page.reload({ waitUntil: 'domcontentloaded' })
    const right = await page.evaluate(() =>
      Promise.all(
        ['products.page', 'link.state', 'auth.session'].map((op) => window.api.call(op, {}))
      )
    )
    check(
      '8. requests right after a reload',
      right.every((x) => x.status === 200),
      right.map((x) => x.status).join(',')
    )
    await page.waitForSelector(SHELL)
    check(
      '9. no sign-in screen while the session is being checked',
      !(await page.evaluate(() => window.__sawLock))
    )

    // A second tab with the same session; the first tab closed and opened again.
    const tab2 = await ctx.newPage()
    await tab2.goto(url, { waitUntil: 'domcontentloaded' })
    r = await stayedIn(tab2)
    check('10. a second tab shares the session', r.shell && !r.sawLock)
    await page.close()
    page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    r = await stayedIn(page)
    check('3. tab closed and opened again', r.shell && !r.sawLock)

    // The whole browser closed and started again (the cookie lasts for the session's 12 hours).
    await ctx.close()
    ctx = await launch(path.join(dir, 'profile'))
    await ctx.addInitScript(WATCH_LOCK)
    page = ctx.pages()[0] || (await ctx.newPage())
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    r = await stayedIn(page)
    check('3. browser closed and started again', r.shell && !r.sawLock)

    // ── Import followed through a reload, a lost connection and a reopened tab ──
    const file = path.join(dir, 'products-e2e.xlsx')
    await workbook(3000, file)
    const before = await q(twin.shop.pool, 'SELECT count(*) FROM products')
    await openImport(page)
    await page.setInputFiles('input[type=file]', file)
    await page.waitForSelector('text=الملف سليم وجاهز للاستيراد', { timeout: 60000 })
    await page.getByRole('button', { name: 'استيراد', exact: true }).click()
    await page.waitForSelector('.import-progress', { timeout: 20000 })
    check('import: started, progress shown from the server', true)

    // Refresh at once: the job is found again.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector(SHELL)
    await openImport(page)
    await page.waitForSelector('.import-progress', { timeout: 20000 })
    const restored = await page.locator('.card', { hasText: 'products-e2e.xlsx' }).count()
    check('import: refresh right after the start – the running import is shown again', restored > 0)

    // The browser loses its connection: told so, never told the import failed.
    await ctx.setOffline(true)
    await page.waitForSelector('text=تعذر الاتصال بالخادم الآن', { timeout: 20000 })
    const failedShown = await page.locator('text=لم يتم').count()
    check('import: connection lost – "trying again", not "failed"', failedShown === 0)
    await page.waitForTimeout(4000)
    await ctx.setOffline(false)

    // The tab closed while it runs, then opened again.
    await page.close()
    page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(SHELL)
    await openImport(page)
    await page.waitForSelector('text=تم الاستيراد:', { timeout: 180000 })
    check('import: tab reopened – followed to the end, "completed" shown', true)

    const job = (
      await twin.shop.pool.query(
        'SELECT status, total_rows, successful_rows, failed_rows FROM import_jobs ORDER BY created_at DESC LIMIT 1'
      )
    ).rows[0]
    const added = (await q(twin.shop.pool, 'SELECT count(*) FROM products')) - before
    check(
      'import: what the job reports is what the shop holds',
      job.status === 'completed' && job.successful_rows === 3000 && added === 3000,
      JSON.stringify({ ...job, added })
    )
    const history = await page.locator('text=آخر عمليات الاستيراد').count()
    check('import: listed in the history', history > 0)

    // ── Session endings ────────────────────────────────────────
    // 5. Sign out in one tab: the other is signed out at its next request.
    const other = await ctx.newPage()
    await other.goto(url, { waitUntil: 'domcontentloaded' })
    await stayedIn(other)
    await page.evaluate(() => window.api.call('auth.logout', {}))
    await other.reload({ waitUntil: 'domcontentloaded' })
    await other.waitForSelector(SIGN_IN, { timeout: 20000 })
    check('5. signed out in one tab: the other shows the sign-in screen', true)
    await other.close()

    // 4. Expired.
    await signIn(page, url)
    await twin.cloud.pool.query(
      "UPDATE sessions SET expires_at = LOCALTIMESTAMP(0) - interval '1 minute' WHERE revoked_at IS NULL"
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector(SIGN_IN, { timeout: 20000 })
    check('4. an expired session: the sign-in screen', true)

    // 6. Revoked.
    await signIn(page, url)
    await twin.cloud.pool.query('UPDATE sessions SET revoked_at = LOCALTIMESTAMP(0)')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector(SIGN_IN, { timeout: 20000 })
    check('6. a revoked session: the sign-in screen', true)

    // 7. A forged cookie.
    await ctx.clearCookies()
    await ctx.addCookies([{ name: 'hm_session', value: 'not-a-session', url: `${url}/api` }])
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector(SIGN_IN, { timeout: 20000 })
    check('7. an invalid cookie: the sign-in screen', true)
  } catch (e) {
    check('run', false, e.stack.split('\n').slice(0, 3).join(' | '))
    const shots = process.env.HEROMARKET_E2E_SHOTS
    if (shots)
      for (const [i, p] of ctx.pages().entries())
        await p
          .screenshot({ path: path.join(shots, `failure-${i}.png`), fullPage: true })
          .catch(() => {})
  } finally {
    await ctx.close().catch(() => {})
    await twin.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
  const failed = results.filter((x) => !x.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
