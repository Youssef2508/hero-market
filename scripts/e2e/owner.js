#!/usr/bin/env node
'use strict'
// Before the test helpers are loaded: they read the address once (HEROMARKET_TEST_DATABASE_URL,
// or the development PostgreSQL of npm run pg:dev).
process.env.HEROMARKET_TEST_DATABASE_URL ||= require('../pg-dev').url('postgres')
// Browser end-to-end checks of the owner's 1.8.0 report, in the real pages (out/web) served by a
// cloud paired with a shop, both on throw-away databases with made-up data. Never a real store.
//   * On a phone, with the shop offline: two supplier payment requests, one approved, one rejected,
//     the session kept (D-110); then both reach the shop once.
//   * The suppliers' page: every supplier's invoices below the supplier, today's by default; an
//     invoice corrected (preview, then save) (D-112).
//   * The till: 1, 01 and 001 – typed and Enter, chosen from the list, clicked – each adds itself.
//
//   npm run build:web
//   npm install --no-save playwright-core
//   node scripts/e2e/owner.js [--headed]
//
// Exit code 1 when a check fails. HEROMARKET_E2E_SHOTS=<dir> saves a screenshot of each screen.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { chromium } = require('playwright-core')
const { makeTwin, copyDifferences } = require('../../tests/service/cloudHelpers')
const { passwordFor, seedProducts } = require('../../tests/service/helpers')

const WEB = path.join(__dirname, '..', '..', 'out', 'web')
const HEADED = process.argv.includes('--headed')
const SHOTS = process.env.HEROMARKET_E2E_SHOTS || null
const SHELL = '.sidebar-nav, .phone-bar'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` – ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch(userDataDir, viewport) {
  const errors = []
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launchPersistentContext(userDataDir, {
        channel,
        headless: !HEADED,
        viewport,
        locale: 'ar-EG',
        ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {})
      })
    } catch (e) {
      errors.push(`${channel}: ${e.message.split('\n')[0]}`)
    }
  }
  throw new Error(`no browser: ${errors.join('; ')}`)
}

async function signIn(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.lock input[type=password]', { timeout: 20000 })
  await page.locator('.lock input').nth(0).fill('owner')
  await page.locator('.lock input[type=password]').first().fill(passwordFor('8642'))
  await page.keyboard.press('Enter')
  await page.waitForSelector(SHELL, { timeout: 20000 })
}

/** A page of the app by its navigation label (sidebar, compact sidebar or the phone's bar). */
async function go(page, label, phoneLabel) {
  const phone = page.locator('.phone-bar .phone-bar-item', { hasText: phoneLabel || label })
  if (await phone.count()) return phone.first().click()
  await page
    .locator('.sidebar-nav .nav-item', { hasText: label })
    .or(page.locator(`.sidebar-nav .nav-item[aria-label="${label}"]`))
    .first()
    .click()
}

/** The message dialog's text, closed. */
async function alertText(page) {
  await page.waitForSelector('#alert-message', { timeout: 20000 })
  const text = await page.locator('#alert-message').innerText()
  await page.locator('.dialog-alert .modal-footer button').first().click()
  return text
}

const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
}

;(async () => {
  if (!fs.existsSync(path.join(WEB, 'index.html'))) throw new Error('run npm run build:web first')
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
  const twin = await makeTwin({
    cloudOptions: { webRoot: WEB, insecureCookies: true, forwardTimeoutMs: 20000 }
  })
  const { shop, cloud } = twin
  twin.agent.start(1000)
  await twin.agent.listen()
  await cloud.app.listen({ host: '127.0.0.1', port: 0 })
  const url = `http://127.0.0.1:${cloud.app.server.address().port}`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-e2e-owner-'))
  const status = async (pool, id) =>
    (await pool.query('SELECT status FROM supplier_payment_requests WHERE id = $1', [id])).rows[0]
      ?.status
  let ctx
  try {
    await seedProducts(
      shop,
      `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES
       ('001', 'صنف ثلاثة أصفار', 3, 30, 50, 'قطعة'), ('01', 'صنف صفر واحد', 2, 20, 50, 'قطعة'),
       ('1', 'صنف واحد', 1, 10, 50, 'قطعة')`
    )
    const shift = (await shop.call('shifts.open', { startingCash: 500 }, twin.owner)).body
    const purchase = (
      await shop.call(
        'suppliers.addPurchase',
        {
          supplierId: twin.supplierId,
          invoice_ref: 'E2E-INV-1',
          total_amount: 300,
          paid_amount: 0,
          payment_type: 'آجل',
          clientRef: crypto.randomUUID(),
          items: [{ barcode: 'SUGAR', qty: 10, unitCost: 30 }]
        },
        twin.owner
      )
    ).body
    for (let i = 0; i < 100 && (await copyDifferences(twin)).length; i++) await sleep(200)

    // ── A phone, the shop offline ──────────────────────────────────
    ctx = await launch(path.join(dir, 'phone'), { width: 390, height: 844 })
    let page = ctx.pages()[0] || (await ctx.newPage())
    await signIn(page, url)
    twin.transport.down = true
    for (let i = 0; i < 200 && (await cloud.app.cloudLink.shopUp()); i++) await sleep(50)
    check('the shop is offline', !(await cloud.app.cloudLink.shopUp()))
    const create = (amount) =>
      page.evaluate(
        ({ amount, supplierId, shiftId }) =>
          window.api.call('supplierPayments.create', {
            supplierId,
            amount,
            currentShiftId: shiftId,
            clientRef: crypto.randomUUID()
          }),
        { amount, supplierId: twin.supplierId, shiftId: shift.id }
      )
    const r1 = (await create(60)).data.request.id
    const r2 = (await create(40)).data.request.id
    await go(page, 'الموردون والمشتريات', 'الموردون')
    await page.waitForSelector('text=طلبات سداد الموردين من الأدراج', { timeout: 20000 })
    await shot(page, '1-phone-requests-offline')
    const row = (id) => page.locator('tr', { hasText: `#${id}` })
    const t0 = Date.now()
    await row(r2).locator('button', { hasText: 'اعتماد' }).click()
    const approved = await alertText(page)
    check(
      'phone, shop offline: approve – done at once, still signed in',
      /تم اعتماد/.test(approved) &&
        (await page.locator('.lock input[type=password]').count()) === 0 &&
        (await status(cloud.pool, r2)) === 'approved',
      `${Date.now() - t0} ms: ${approved.slice(0, 60)}`
    )
    await row(r1).locator('button', { hasText: 'رفض' }).click()
    await page.locator('#spr-reverse-title').waitFor({ timeout: 10000 })
    await page
      .locator('form[aria-labelledby="spr-reverse-title"] input.input')
      .fill('المبلغ غير صحيح')
    await page.locator('.modal-content button[type=submit]').last().click()
    const rejected = await alertText(page)
    check(
      'phone, shop offline: reject – done at once, still signed in',
      /رُفض/.test(rejected) &&
        (await page.locator('.lock input[type=password]').count()) === 0 &&
        (await status(cloud.pool, r1)) === 'rejected',
      rejected.slice(0, 60)
    )
    await shot(page, '2-phone-decided-offline')

    // The shop is back: both reach it, once.
    twin.transport.down = false
    let together = false
    for (let i = 0; i < 150 && !together; i++) {
      await sleep(200)
      together =
        (await status(shop.pool, r1)) === 'rejected' &&
        (await status(shop.pool, r2)) === 'approved' &&
        !(await copyDifferences(twin)).length
    }
    const reversals = Number(
      (
        await shop.pool.query(
          "SELECT count(*) AS n FROM safe_ledger WHERE kind = 'supplier_payment_reversal'"
        )
      ).rows[0].n
    )
    check(
      'the shop back: both decisions there, once; both sides the same',
      together && reversals === 1
    )
    await ctx.close()

    // ── Desktop: every supplier's invoices, and a correction ──────
    ctx = await launch(path.join(dir, 'desk'), { width: 1366, height: 900 })
    page = ctx.pages()[0] || (await ctx.newPage())
    await signIn(page, url)
    await go(page, 'الموردون والمشتريات')
    await page.waitForSelector('#purchase-invoices-title', { timeout: 20000 })
    const listed = page.locator('section[aria-labelledby="purchase-invoices-title"] tr', {
      hasText: 'E2E-INV-1'
    })
    await listed.first().waitFor({ timeout: 20000 })
    check('suppliers page: today’s invoices listed without choosing a supplier', true)
    await shot(page, '3-desk-purchase-invoices')
    await listed.first().locator('button[title="عرض الفاتورة وأصنافها"]').click()
    await page.locator('button', { hasText: 'تصحيح الأصناف والمبالغ' }).click()
    await page.locator('#purchase-revision-title').waitFor({ timeout: 10000 })
    const qty = page.locator('input[aria-label^="كمية"]').first()
    await qty.fill('12')
    await page.locator('button', { hasText: 'معاينة التأثير' }).click()
    await page.locator('text=الفرق على حساب المورد').waitFor({ timeout: 15000 })
    await shot(page, '4-desk-revision-preview')
    // Saved while the cloud routes to the shop (after the offline part, the link may still be on its
    // way back): carried out in the shop at once. Saved in a gap, it is kept for the shop (D-111)
    // and carried out on the next contact – either way it must reach the shop once.
    for (let i = 0; i < 100 && !(await cloud.app.cloudLink.shopUp()); i++) await sleep(100)
    await page.locator('button', { hasText: 'حفظ التصحيح' }).click()
    const saved = await alertText(page)
    let p
    for (let i = 0; i < 60; i++) {
      p = (
        await shop.pool.query(
          'SELECT revision, total_amount::float8 AS t FROM supplier_purchases WHERE id = $1',
          [purchase.purchaseId]
        )
      ).rows[0]
      if (p.revision === 1) break
      await sleep(500)
    }
    const revisions = Number(
      (
        await shop.pool.query(
          'SELECT count(*) AS n FROM supplier_purchase_revisions WHERE purchase_id = $1',
          [purchase.purchaseId]
        )
      ).rows[0].n
    )
    check(
      'purchase correction: previewed, saved, in the shop once (revision 1, 360)',
      /تم تصحيح|حُفظت العملية/.test(saved) && p.revision === 1 && p.t === 360 && revisions === 1,
      saved.slice(0, 60)
    )

    // ── The till: 1, 01 and 001 ───────────────────────────────────
    await page.keyboard.press('Escape')
    await go(page, 'شاشة الكاشير')
    const field = page.locator('input[placeholder^="امسح الباركود"]')
    await field.waitFor({ timeout: 20000 })
    const lines = () => page.locator('.cart-table .line-name').allInnerTexts()
    await field.fill('1')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    await field.fill('01')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    // Chosen from the list: typed, the list shown, the result clicked.
    await field.fill('001')
    await page.locator('#pos-search-results .result-item').first().waitFor({ timeout: 10000 })
    await page.locator('#pos-search-results .result-item', { hasText: 'صنف ثلاثة أصفار' }).click()
    await page.waitForTimeout(800)
    // And with the arrows: 0 typed, ↓ to the row of 01, Enter.
    await field.fill('0')
    await page.locator('#pos-search-results .result-item').first().waitFor({ timeout: 10000 })
    const names = await page.locator('#pos-search-results .result-name').allInnerTexts()
    const target = names.indexOf('صنف صفر واحد')
    for (let i = 0; i <= target; i++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    const cart = await lines()
    await shot(page, '5-desk-till-codes')
    check(
      'till: 1 and 01 typed with Enter, 001 clicked, 01 with the arrows – each itself',
      JSON.stringify(cart) === JSON.stringify(['صنف واحد', 'صنف صفر واحد', 'صنف ثلاثة أصفار']) ||
        (cart.includes('صنف واحد') &&
          cart.includes('صنف صفر واحد') &&
          cart.includes('صنف ثلاثة أصفار') &&
          cart.length === 3),
      JSON.stringify(cart)
    )
    const qtyOf01 = await page
      .locator('.cart-table tr', { hasText: 'صنف صفر واحد' })
      .locator('input')
      .first()
      .inputValue()
      .catch(() => '')
    check('till: 01 chosen twice is one line of 2', qtyOf01 === '2', `qty ${qtyOf01}`)
  } catch (e) {
    check('run', false, e.stack.split('\n').slice(0, 3).join(' | '))
  } finally {
    await ctx?.close().catch(() => {})
    twin.agent.stop()
    await twin.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
})()
