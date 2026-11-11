#!/usr/bin/env node
'use strict'
// Opens every screen of the browser build at phone size and reports what a phone user would hit
// (Phase 2 milestone 2): sideways scrolling, content cut off at the screen's edge, and buttons too
// small for a finger. Needs the trial stack and a browser driver:
//
//   npm run build:web && node scripts/phase2-dev.js --fresh        (another window)
//   npm install --no-save playwright-core                          (once; uses the installed Edge or Chrome)
//   node scripts/phone-check.js [--url http://127.0.0.1:8790] [--shots <folder>] [--width 390] [--height 844]
//
// Exit code 1 when any screen scrolls sideways or cuts content off.
const path = require('path')
const fs = require('fs')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const URL = arg('url', 'http://127.0.0.1:8790')
const SHOTS = arg('shots', null)
const WIDTH = Number(arg('width', 390))
const HEIGHT = Number(arg('height', 844))
const USER = arg('user', 'owner')
const PASSWORD = arg('password', 'Hero-Trial-2026')
const MIN_TARGET = 40

/** Runs in the page: what is wrong with the screen as it is now. */
function measure(minTarget) {
  const vw = window.innerWidth
  const scrollsInside = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true
      if (p.classList.contains('sidebar')) return true
    }
    return false
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const root = document.querySelector('.modal-overlay') || document.querySelector('.app-content')
  const cut = []
  if (root)
    for (const el of root.querySelectorAll('*')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if ((r.right > vw + 1 || r.left < -1) && !scrollsInside(el)) {
        cut.push(
          `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.left)}..${Math.round(r.right)}`
        )
        if (cut.length >= 4) break
      }
    }
  const small = []
  if (root)
    for (const el of root.querySelectorAll(
      'button, a[href], input:not([type=hidden]), select, [role=button]'
    )) {
      if (!visible(el) || scrollsInside(el)) continue
      const r = el.getBoundingClientRect()
      if (el.type === 'checkbox' || el.type === 'radio') continue
      if (r.height < minTarget || r.width < minTarget)
        small.push(
          `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} ${Math.round(r.width)}x${Math.round(r.height)}`
        )
    }
  return {
    sideways: document.documentElement.scrollWidth > vw + 1,
    cut,
    small: small.length,
    smallSample: [...new Set(small.map((s) => s.replace(/ \d+x\d+$/, '')))].slice(0, 4),
    failed: !!document.querySelector('.error-boundary, [data-error-boundary]')
  }
}

;(async () => {
  let chromium
  try {
    ;({ chromium } = require('playwright-core'))
  } catch {
    console.error('playwright-core is not installed: npm install --no-save playwright-core')
    process.exit(2)
  }
  let browser
  for (const channel of ['msedge', 'chrome']) {
    try {
      browser = await chromium.launch({ channel, headless: true })
      break
    } catch {
      /* try the next browser */
    }
  }
  if (!browser) {
    console.error('No Edge or Chrome found to drive.')
    process.exit(2)
  }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ar-EG'
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.locator('input').nth(0).fill(USER)
  await page.locator('input[type=password]').first().fill(PASSWORD)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.phone-bar', { timeout: 15000 })

  const more = page.locator('.phone-bar-item').last()
  await more.click()
  const labels = await page
    .locator('.sidebar-nav .nav-item')
    .evaluateAll((els) => els.map((e) => e.innerText.trim()))
  await more.click()

  const results = []
  let n = 0
  for (const label of labels) {
    n += 1
    await more.click()
    await page.locator('.sidebar-nav .nav-item', { hasText: label }).first().click()
    await page.waitForTimeout(900)
    const m = await page.evaluate(measure, MIN_TARGET)
    if (SHOTS)
      await page.screenshot({ path: path.join(SHOTS, `${String(n).padStart(2, '0')}.png`) })
    // A message the screen raised by itself on opening (an operation it could not do here).
    const alert = page.locator('.modal-overlay [role=alertdialog]')
    let said = null
    if (await alert.count()) {
      said = (await alert.first().innerText()).replace(/\s+/g, ' ').slice(0, 160)
      await alert.first().locator('button').last().click()
      await page.waitForTimeout(200)
    }
    results.push({ label, ...m, said })
  }
  await browser.close()

  let bad = 0
  for (const r of results) {
    const problems = [
      r.failed ? 'FAILED TO OPEN' : null,
      r.said ? `message on opening: ${r.said}` : null,
      r.sideways ? 'page scrolls sideways' : null,
      r.cut.length ? `cut off: ${r.cut.join('; ')}` : null,
      r.small ? `${r.small} small targets (${r.smallSample.join(', ')})` : null
    ].filter(Boolean)
    if (r.failed || r.sideways || r.cut.length) bad += 1
    console.log(
      `${problems.length ? '✖' : '✔'} ${r.label}${problems.length ? '\n    ' + problems.join('\n    ') : ''}`
    )
  }
  console.log(
    `\n${results.length} screens at ${WIDTH}x${HEIGHT}: ${results.length - bad} without sideways scrolling or cut-off content, ${bad} with; ${results.filter((r) => r.small).length} with small targets`
  )
  if (errors.length) console.log(`page errors: ${[...new Set(errors)].slice(0, 5).join(' | ')}`)
  process.exit(bad || errors.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
