#!/usr/bin/env node
'use strict'
// Before the test helpers are loaded: they read the address once (HEROMARKET_TEST_DATABASE_URL,
// or the development PostgreSQL of npm run pg:dev).
process.env.HEROMARKET_TEST_DATABASE_URL ||= require('../pg-dev').url('postgres')
// The desktop program, never paired and with no cloud: Excel imports of 50 to 5,000 products
// through the real window (1.6.3), with the window reloaded, the program closed and the program
// killed in the middle of an import. Then, separately, the same database is paired with a cloud
// and its first synchronisation is timed and checked. Throw-away databases on the development
// PostgreSQL (npm run pg:dev) and made-up data only; never a real store.
//
//   npm run build
//   npm install --no-save playwright-core
//   node scripts/e2e/desktop.js            (HEROMARKET_TEST_DATABASE_URL, or npm run pg:dev)
//
// Prints one line per check and a timing table; exit code 1 when a check fails.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { _electron: electron } = require('playwright-core')
const {
  freshDatabase,
  startService,
  createUser,
  login,
  passwordFor
} = require('../../tests/service/helpers')
const { copyDifferences } = require('../../tests/service/cloudHelpers')
const { newPairingCode } = require('../../src/server/cloud/pairing')

const ROOT = path.join(__dirname, '..', '..')
// The file sizes imported one after the other; 20,000 is the most one file may hold
// (storeImport LIMITS). CI runs up to 5,000: HEROMARKET_E2E_SIZES=50,200,500,3000,5000.
const SIZES = (process.env.HEROMARKET_E2E_SIZES || '50,200,500,3000,5000,10000,20000')
  .split(',')
  .map(Number)
const SHELL = '.sidebar-nav, .phone-bar'
const SIGN_IN = '.lock input[type=password]'
const results = []
const timings = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` – ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function workbook(n, prefix, file) {
  const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href)
  const { exportSheets } = await imp('src/shared/storeImport.mjs')
  const writeExcelFile = (await imp('node_modules/write-excel-file/node/index.js')).default
  const products = Array.from({ length: n }, (_, i) => ({
    barcode: i % 10 === 7 ? '' : `${prefix}${String(i).padStart(8, '0')}`,
    name: `${prefix} صنف ${i}`,
    retail_price: 10 + (i % 40) + 0.5,
    cost_price: 8 + (i % 40),
    stock_qty: i % 10 === 3 ? 2.5 : i % 3 ? 12 : 0,
    unit: i % 10 === 3 ? 'كيلو' : 'قطعة',
    unit_kind: i % 10 === 3 ? 'بالوزن' : 'بالعدد',
    category: `${prefix} فئة ${i % 15}`,
    reorder_limit: 3,
    pack_name: i % 10 === 1 ? 'كرتونة' : null,
    pack_factor: i % 10 === 1 ? 12 : null,
    pack_barcode: i % 10 === 1 ? `${prefix}P${i}` : null,
    pack_price: null,
    pack_cost: null
  }))
  fs.writeFileSync(
    file,
    await writeExcelFile(exportSheets({ products, customers: [], suppliers: [] })).toBuffer()
  )
  return products
}

;(async () => {
  if (!fs.existsSync(path.join(ROOT, 'out', 'main', 'index.js')))
    throw new Error('run npm run build first')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-desk-'))
  const db = await freshDatabase()
  const dbName = new URL(db.url).pathname.slice(1)
  // A fresh store with its owner, as after the first-run setup. Never paired.
  {
    const svc = await startService(db.url, { importJobs: false })
    await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
    await svc.close()
  }
  const pool = new (require('pg').Pool)({ connectionString: db.url, max: 2 })
  const one = async (sql, p) => (await pool.query(sql, p)).rows[0]
  const num = async (sql, p) => Number(Object.values(await one(sql, p))[0])

  const env = {
    ...process.env,
    HEROMARKET_DB_NAME: dbName,
    HEROMARKET_USER_DATA: path.join(dir, 'profile')
  }
  // The VS Code terminal sets this; Electron would then run as plain Node.
  delete env.ELECTRON_RUN_AS_NODE
  let app = null
  let win = null
  const launch = async () => {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [ROOT],
      cwd: ROOT,
      env
    })
    win = await app.firstWindow()
    win.setDefaultTimeout(30000)
    // Narrower than 1,200 px, as on a small screen (and on CI's 1024×768): the compact sidebar.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760))
  }
  const signIn = async () => {
    await win.waitForSelector(SIGN_IN, { timeout: 60000 })
    await win.locator('.lock input').nth(0).fill('owner')
    await win.locator(SIGN_IN).first().fill(passwordFor('8642'))
    await win.keyboard.press('Enter')
    await win.waitForSelector(SHELL)
  }
  const openImport = async () => {
    // A narrow window shows the compact sidebar: icons, named by aria-label.
    const label = 'استيراد وتصدير'
    await win
      .locator('.sidebar-nav .nav-item', { hasText: label })
      .or(win.locator(`.sidebar-nav .nav-item[aria-label="${label}"]`))
      .first()
      .click()
    await win.waitForSelector('text=استيراد بيانات المتجر من Excel')
  }
  // By the file's name: two jobs may start within the same second.
  const latestJob = (file) =>
    one(
      `SELECT id, status, total_rows, successful_rows, failed_rows, attempts,
              EXTRACT(epoch FROM finished_at - started_at)::float8 AS seconds
         FROM import_jobs WHERE filename = $1 ORDER BY created_at DESC LIMIT 1`,
      [path.basename(file)]
    )
  /** Choose the file and wait for the check; then start. Returns the times of both. */
  const chooseAndStart = async (file) => {
    const t0 = Date.now()
    await win.setInputFiles('input[type=file]', file)
    await win.waitForSelector('text=الملف سليم وجاهز للاستيراد', { timeout: 120000 })
    const checkMs = Date.now() - t0
    const t1 = Date.now()
    await win.getByRole('button', { name: 'استيراد', exact: true }).click()
    await win.waitForSelector('.import-progress')
    return { checkMs, t1 }
  }
  const waitDone = async (t1) => {
    await win.waitForSelector('text=تم الاستيراد:', { timeout: 300000 })
    return Date.now() - t1
  }
  const closeCard = async () => {
    const close = win.getByRole('button', { name: 'إغلاق', exact: true })
    if (await close.count()) await close.first().click()
  }
  /** Wait until the running job has written at least `rows` rows (not yet saved). */
  const midway = async (rows) => {
    for (let i = 0; i < 600; i++) {
      const j = await one(
        "SELECT status, processed_rows FROM import_jobs WHERE status IN ('queued','processing') ORDER BY created_at DESC LIMIT 1"
      )
      if (j && j.status === 'processing' && j.processed_rows >= rows) return j.processed_rows
      if (!j) return null
      await sleep(20)
    }
    return null
  }
  const products = (prefix) =>
    num('SELECT count(*) FROM products WHERE barcode LIKE $1 OR name LIKE $2', [
      `${prefix}%`,
      `${prefix} %`
    ])

  try {
    await launch()
    await signIn()
    const st = await one('SELECT enabled, cloud_url, store_id FROM sync_state')
    check(
      'never paired: no cloud address, the link off',
      !st.enabled && !st.cloud_url,
      JSON.stringify(st)
    )
    await openImport(win)

    // ── 50 → 5,000, one after the other ───────────────────────
    for (const [n, prefix] of SIZES.map((n, i) => [n, `D${'ABCDEFGHIJ'[i]}`])) {
      const file = path.join(dir, `products-${n}.xlsx`)
      await workbook(n, prefix, file)
      const { checkMs, t1 } = await chooseAndStart(file)
      const importMs = await waitDone(t1)
      const job = await latestJob(file)
      const count = await products(prefix)
      timings.push({
        rows: n,
        fileKB: Math.round(fs.statSync(file).size / 1024),
        checkMs,
        importMs,
        jobSeconds: job.seconds
      })
      check(
        `${n} products: completed, every row saved once`,
        job.status === 'completed' && job.successful_rows === n && count === n,
        `read+check ${checkMs} ms, import ${importMs} ms` +
          (job.status === 'completed' && job.successful_rows === n && count === n
            ? ''
            : ` ${JSON.stringify({ job, count })}`)
      )
      await closeCard()
    }

    // ── The window reloaded during an import ──────────────────
    {
      const file = path.join(dir, 'reload-3000.xlsx')
      await workbook(3000, 'DR', file)
      const { t1 } = await chooseAndStart(file)
      await win.reload()
      // The till always starts locked (G-16): sign in again; the import is found again.
      await signIn()
      await openImport()
      await waitDone(t1)
      const job = await latestJob(file)
      check(
        'window reloaded during an import: it went on, shown again, completed once',
        job.status === 'completed' && (await products('DR')) === 3000,
        JSON.stringify(job)
      )
      await closeCard()
    }

    // ── The program closed during an import, then started again ──
    {
      const file = path.join(dir, 'close-5000.xlsx')
      await workbook(5000, 'DS', file)
      await chooseAndStart(file)
      const at = await midway(1000)
      await app.close()
      const left = await one(
        'SELECT status, successful_rows FROM import_jobs WHERE filename = $1',
        [path.basename(file)]
      )
      const kept = await products('DS')
      await launch()
      await signIn()
      await openImport()
      await win.waitForSelector('text=تم الاستيراد:', { timeout: 300000 })
      const job = await latestJob(file)
      check(
        'program closed during an import (at row ' +
          at +
          '): nothing half-saved, finished after the restart, once',
        at !== null &&
          left.status === 'processing' &&
          kept === 0 &&
          job.status === 'completed' &&
          (await products('DS')) === 5000,
        JSON.stringify({ left, kept, job })
      )
      await closeCard()
    }

    // ── The program killed (no close at all) during an import ──
    {
      const file = path.join(dir, 'kill-5000.xlsx')
      await workbook(5000, 'DK', file)
      await chooseAndStart(file)
      const at = await midway(2000)
      // The whole program at once, as a crash or a power cut would (on Windows, killing only the
      // main process leaves its helpers holding the single-instance lock).
      const pid = app.process().pid
      if (process.platform === 'win32')
        require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'])
      else app.process().kill('SIGKILL')
      app = null
      await sleep(2000)
      const kept = await products('DK')
      await launch()
      await signIn()
      await openImport()
      await win.waitForSelector('text=تم الاستيراد:', { timeout: 300000 })
      const job = await latestJob(file)
      check(
        'program killed during an import (at row ' +
          at +
          '): nothing half-saved, finished after the restart, once',
        at !== null &&
          kept === 0 &&
          job.status === 'completed' &&
          job.attempts === 2 &&
          (await products('DK')) === 5000,
        JSON.stringify({ kept, job })
      )
    }
    await app.close()
    app = null

    // ── Integrity of everything imported ───────────────────────
    const total = SIZES.reduce((a, n) => a + n, 0) + 3000 + 5000 + 5000
    const counts = await one(
      `SELECT (SELECT count(*) FROM products)::int AS products,
              (SELECT count(*) FROM product_units)::int AS units,
              (SELECT count(*) FROM stock_movements WHERE kind = 'opening' AND ref_type = 'import')::int AS openings,
              (SELECT count(*) FROM products p WHERE p.stock_qty <> COALESCE((SELECT sum(qty) FROM stock_movements m WHERE m.product_barcode = p.barcode), 0))::int AS stock_off,
              (SELECT count(*) FROM import_job_data)::int AS stored,
              (SELECT count(*) FROM import_jobs WHERE status <> 'completed')::int AS unfinished`
    )
    check(
      `integrity: ${total} products, each stock equal to its ledger, no rows left over`,
      counts.products === total &&
        counts.stock_off === 0 &&
        counts.stored === 0 &&
        counts.unfinished === 0,
      JSON.stringify(counts)
    )

    // ── Then, separately: pairing and the first synchronisation ──
    const cloudDb = await freshDatabase()
    const cloud = await startService(cloudDb.url, { role: 'cloud' })
    await cloud.app.listen({ host: '127.0.0.1', port: 0 })
    const cloudUrl = `http://127.0.0.1:${cloud.app.server.address().port}`
    const shop = await startService(db.url, { syncAgent: true, syncIntervalMs: 1000 })
    try {
      const owner = await login(shop, '8642')
      const { code } = await newPairingCode(cloud.pool, { name: 'متجر تجربة' })
      const t0 = Date.now()
      const paired = await shop.call('sync.pair', { cloudUrl, code }, owner)
      check(
        'pairing after the imports',
        paired.status === 200,
        JSON.stringify(paired.body).slice(0, 200)
      )
      // Until the PC has nothing left to send (its first contact queues one snapshot of every
      // record); the two databases are compared once, after.
      let left = null
      let lastLog = Date.now()
      for (let i = 0; i < 3600; i++) {
        await sleep(500)
        const st = await one(
          'SELECT epoch, (SELECT count(*) FROM sync_outbox WHERE acked_at IS NULL)::int AS left FROM sync_state'
        )
        left = st.left
        if (st.epoch && left === 0) break
        if (Date.now() - lastLog > 30000) {
          lastLog = Date.now()
          console.log(
            `  … synchronising: ${left} changes left after ${Math.round((Date.now() - t0) / 1000)} s`
          )
        }
      }
      const syncMs = Date.now() - t0
      const diffs = await copyDifferences({ shop, cloud })
      const cloudCounts = await (async () => {
        const q = async (sql) => Number(Object.values((await cloud.pool.query(sql)).rows[0])[0])
        return {
          products: await q('SELECT count(*) FROM products'),
          stock: await q('SELECT COALESCE(sum(stock_qty), 0) FROM products'),
          units: await q('SELECT count(*) FROM product_units'),
          barcodes: await q('SELECT count(*) FROM product_barcodes'),
          categories: await q('SELECT count(*) FROM categories')
        }
      })()
      const shopStock = await num('SELECT COALESCE(sum(stock_qty), 0) FROM products')
      timings.push({ sync: true, products: total, syncMs })
      check(
        'first synchronisation: the cloud holds every record exactly as the PC, each product once',
        !diffs.length && cloudCounts.products === total && cloudCounts.stock === shopStock,
        `${syncMs} ms; ${JSON.stringify(cloudCounts)}${diffs.length ? ` diffs: ${diffs.slice(0, 3)}` : ''}`
      )
    } finally {
      await shop.close()
      await cloud.close()
      await cloudDb.dispose()
    }
  } catch (e) {
    check('run', false, e.stack.split('\n').slice(0, 3).join(' | '))
    if (win && process.env.HEROMARKET_E2E_SHOTS)
      await win
        .screenshot({ path: path.join(process.env.HEROMARKET_E2E_SHOTS, 'desktop-failure.png') })
        .catch(() => {})
  } finally {
    if (app) await app.close().catch(() => {})
    await pool.end()
    await db.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
  console.log('\nlocal import (desktop window, never paired):')
  for (const t of timings.filter((x) => !x.sync))
    console.log(
      `  ${String(t.rows).padStart(5)} rows  file ${t.fileKB} KB  read+check ${t.checkMs} ms  import ${t.importMs} ms (job ${t.jobSeconds}s)  ${Math.round(t.rows / (t.importMs / 1000))} rows/s`
    )
  for (const t of timings.filter((x) => x.sync))
    console.log(`first synchronisation of ${t.products} products: ${t.syncMs} ms`)
  const failed = results.filter((x) => !x.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
