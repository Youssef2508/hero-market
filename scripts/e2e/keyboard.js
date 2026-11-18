#!/usr/bin/env node
'use strict'
// Before the test helpers are loaded: they read the address once (HEROMARKET_TEST_DATABASE_URL,
// or the development PostgreSQL of npm run pg:dev).
process.env.HEROMARKET_TEST_DATABASE_URL ||= require('../pg-dev').url('postgres')
// The keyboard-first till in the real desktop program (1.9.0, D-116 – D-119), on a throw-away
// database with made-up data. After the window opens, everything is done with the keyboard: key
// presses only, no click, no programmatic focus. A scanner is a burst of digits and Enter.
//   1. A sale: scan, type 50 over the quantity, Enter; a scale label (product 1, 0.125 kg → 0.5);
//      01 typed by hand (its weight window); the arrows to «فيزا», Enter; the arrows to the paid
//      amount; the customer, chosen from its list; the delivery box; the arrows to «تأكيد الدفع».
//   2. The same sale by codes typed by hand, paid in cash.
//   3. A return without an invoice, from the sidebar, by the keyboard.
//   4. Every screen of the sidebar: reached with ↑ ↓ and Enter, and ← into it.
//
//   npm run build
//   npm install --no-save playwright-core
//   node scripts/e2e/keyboard.js            (HEROMARKET_E2E_SHOTS=<dir> for screenshots)
//
// Exit code 1 when a check fails.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { _electron: electron } = require('playwright-core')
const {
  freshDatabase,
  startService,
  createUser,
  login,
  passwordFor,
  seedProducts
} = require('../../tests/service/helpers')
const { ean13CheckDigit } = require('../../src/server/inventory/units')

const ROOT = path.join(__dirname, '..', '..')
const SHOTS = process.env.HEROMARKET_E2E_SHOTS || null
const results = []
const trail = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` – ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SCALE = {
  enabled: true,
  length: 13,
  codeStart: 2,
  codeLength: 5,
  valueStart: 7,
  valueLength: 5,
  weightDivisor: 1000,
  priceDivisor: 100,
  prefixes: { 20: 'weight' },
  checkDigit: 'ean13'
}
const label = (code, grams) => {
  const t = `20${String(code).padStart(5, '0')}${String(grams).padStart(5, '0')}`
  return t + ean13CheckDigit(t)
}

;(async () => {
  if (!fs.existsSync(path.join(ROOT, 'out', 'main', 'index.js')))
    throw new Error('run npm run build first')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-keys-'))
  const db = await freshDatabase()
  const dbName = new URL(db.url).pathname.slice(1)
  {
    const svc = await startService(db.url, { importJobs: false })
    await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
    const owner = await login(svc, '8642')
    await svc.call('settings.update', { values: { scale_labels: JSON.stringify(SCALE) } }, owner)
    await seedProducts(
      svc,
      `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, unit_kind, category) VALUES
       ('6223001360063', 'بيبسي 330 ملي', 10, 13, 100, 'علبة', 'count', 'مشروبات'),
       ('6221234567890', 'أرز 1 كيلو', 20, 25, 100, 'كيس', 'count', 'بقالة'),
       ('1', 'جبنة رومي', 300, 400, 20, 'كيلو', 'weight', 'ألبان'),
       ('01', 'جبنة بيضاء', 100, 140, 20, 'كيلو', 'weight', 'ألبان'),
       ('001', 'جبنة شيدر', 300, 380, 20, 'كيلو', 'weight', 'ألبان')`
    )
    const marked = await svc.call('products.setScaleItem', { barcode: '1', enabled: true }, owner)
    if (marked.status !== 200) throw new Error(JSON.stringify(marked.body))
    await svc.call(
      'clients.create',
      {
        name: 'أم أحمد',
        phone: '01012345678',
        addresses: [{ label: 'home', address: 'شارع النصر 12', isDefault: true }]
      },
      owner
    )
    await svc.close()
  }
  const pool = new (require('pg').Pool)({ connectionString: db.url, max: 2 })
  const one = async (sql, p) => (await pool.query(sql, p)).rows[0]
  const env = {
    ...process.env,
    HEROMARKET_DB_NAME: dbName,
    HEROMARKET_USER_DATA: path.join(dir, 'profile')
  }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT],
    cwd: ROOT,
    env
  })
  const win = await app.firstWindow()
  win.setDefaultTimeout(30000)
  for (let i = 0; i < 10; i++) {
    const done = await app
      .evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        if (!w) return false
        w.setSize(1366, 768)
        return true
      })
      .catch(() => false)
    if (done) break
    await sleep(500)
  }
  // Typing by hand is slower than a scanner (useBarcode tells them apart by speed): 90 ms a key.
  // Each character waits until the focused field shows it (deterministic, not a fixed pause); a
  // field that does not keep text (a button, a closed list) just gets the key.
  const kb = {
    press: (k) => win.keyboard.press(k),
    type: async (t, o = {}) => {
      if (o.delay !== undefined) return win.keyboard.type(t, { delay: o.delay })
      for (const ch of t) {
        const before = await win.evaluate(() => document.activeElement?.value ?? null)
        await win.keyboard.type(ch)
        if (before === null) continue
        await win
          .waitForFunction((b) => (document.activeElement?.value ?? null) !== b, before, {
            timeout: 3000
          })
          .catch(() => {})
        // Slower than a scanner (useBarcode tells them apart by speed: 35 ms).
        await sleep(60)
        const v = await win.evaluate(() => [
          document.activeElement?.getAttribute('aria-label'),
          document.activeElement?.value,
          document.activeElement?.selectionStart,
          document.activeElement?.selectionEnd
        ])
        trail.push(`  typed «${ch}» → ${JSON.stringify(v)}`)
      }
    }
  }
  /** After a payment: the new sale in the database, then the print question or error (no printer
   * here) answered and gone, and the focus back in the product field. */
  const afterPayment = async (salesBefore) => {
    for (let i = 0; i < 100; i++) {
      if ((await one('SELECT count(*)::int AS n FROM sales')).n > salesBefore) break
      await sleep(100)
    }
    for (let i = 0; i < 30; i++) {
      if (await win.locator('.modal-overlay').count()) {
        await shot('after-pay-window')
        trail.push(
          'after the sale: ' +
            (await win.locator('.modal-overlay').first().innerText())
              .replace(/\s+/g, ' ')
              .slice(0, 120)
        )
        await win.keyboard.press('Escape')
        await win
          .waitForSelector('.modal-overlay', { state: 'detached', timeout: 5000 })
          .catch(() => {})
      }
      const a = await active()
      if (a.text === 'الصنف: باركود أو اسم' && !(await win.locator('.modal-overlay').count())) {
        // Quiet for a moment: nothing more arrives.
        await sleep(400)
        if (!(await win.locator('.modal-overlay').count())) return
      }
      await sleep(150)
    }
  }
  /** What has the focus: its label, kind and text, and whether its text is all selected. */
  const active = () =>
    win.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return { none: true }
      const text = (
        el.getAttribute('aria-label') ||
        (el.type === 'checkbox' || el.type === 'radio' ? el.closest('label')?.innerText : '') ||
        el.innerText ||
        el.value ||
        ''
      )
        .trim()
        .slice(0, 60)
      let allSelected = null
      try {
        allSelected =
          el.value !== undefined && el.selectionStart === 0 && el.selectionEnd === el.value.length
      } catch {
        /* no selection */
      }
      return {
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        text,
        cls: el.className || '',
        lineKey: el.dataset?.lineKey || null,
        pressed: el.getAttribute('aria-pressed'),
        checked: el.checked ?? null,
        value: el.value ?? null,
        allSelected,
        inModal: !!el.closest('.modal-overlay'),
        inSidebar: !!el.closest('.sidebar')
      }
    })
  const press = async (key, note = '') => {
    await kb.press(key)
    await sleep(140)
    const a = await active()
    trail.push(
      `${key}${note ? ` (${note})` : ''} → ${a.none ? '—' : `${a.tag}${a.type ? `[${a.type}]` : ''} «${a.text}»`}`
    )
    return a
  }
  /** Press `key` until `want(active)`; returns the element or null after `max` presses. */
  const walk = async (key, want, max = 25, note = '') => {
    for (let i = 0; i < max; i++) {
      const a = await press(key, note)
      if (want(a)) return a
    }
    return null
  }
  const scan = async (code) => {
    // A keyboard-wedge scanner: the digits in a burst, then Enter.
    await kb.type(code, { delay: 8 })
    await kb.press('Enter')
    trail.push(`scan ${code}`)
    await sleep(700)
  }
  const cartLines = () =>
    win.evaluate(() =>
      [...document.querySelectorAll('.cart-table tbody tr')].map((tr) => ({
        code: tr.querySelector('.line-code')?.innerText?.trim(),
        qty: tr.querySelector('.qty-input')?.value
      }))
    )
  const lineCount = () => win.locator('[data-testid=cart-line-count] strong').innerText()
  const shot = async (name) =>
    SHOTS && win.screenshot({ path: path.join(SHOTS, `keys-${name}.png`) })

  try {
    // ── Sign in and open the shift, by the keyboard.
    await win.waitForSelector('.lock input[type=password]', { timeout: 60000 })
    await sleep(500)
    let a = await active()
    if (a.type !== 'text') await press('Tab')
    await kb.type('owner')
    await kb.press('Tab')
    await kb.type(passwordFor('8642'))
    await kb.press('Enter')
    await win.waitForSelector('.sidebar-nav')
    // The open-shift window: opened by itself on some stores; else «فتح وردية» in the top bar,
    // reached with the arrows from the product field. Then the float, Enter to its confirm, Enter.
    await sleep(1500)
    if (!(await win.locator('.modal-overlay').count())) {
      const btn = await walk('ArrowUp', (x) => /فتح وردية/.test(x.text), 4, 'to «فتح وردية»')
      check('the arrows reach «فتح وردية» in the top bar', !!btn)
      await press('Enter', 'open the shift window')
    }
    await win.waitForSelector('.modal-overlay', { timeout: 15000 })
    await sleep(400)
    a = await active()
    check(
      'the open-shift window takes the focus (its float field)',
      a.inModal && a.tag === 'input',
      JSON.stringify(a)
    )
    check(
      '   its pre-filled float is selected (typing replaces it)',
      a.allSelected === true,
      JSON.stringify(a)
    )
    // Tab stays inside the window (both ways) and comes back round to the float.
    const inside = []
    for (let i = 0; i < 6; i++) inside.push((await press('Tab', 'Tab inside the window')).inModal)
    for (let i = 0; i < 6; i++)
      inside.push((await press('Shift+Tab', 'Shift+Tab inside the window')).inModal)
    a = await active()
    check(
      'Tab / Shift+Tab: 12 presses all stay inside the open window, back on the float',
      inside.every(Boolean) && a.text === 'العهدة الافتتاحية لدرج السوبر ماركت',
      JSON.stringify(inside)
    )
    await win.keyboard.press('Control+A')
    await kb.type('500')
    // Enter: to the window's confirm button (forms that move money), or straight to it.
    a = await press('Enter', 'float typed')
    if (await win.locator('.modal-overlay').count()) await press('Enter', 'confirm')
    await win.waitForSelector('.modal-overlay', { state: 'detached', timeout: 15000 })
    const shiftRow = await one("SELECT initial_cash::float8 AS c FROM shifts WHERE status = 'open'")
    check(
      '   the shift opened with 500 (not 200500)',
      shiftRow?.c === 500,
      JSON.stringify(shiftRow)
    )
    await sleep(600)
    a = await active()
    if (process.env.HEROMARKET_E2E_DEBUG) {
      console.log(
        'DEBUG',
        JSON.stringify(
          await win.evaluate(() => {
            const out = {
              keyboard: !!window.__heroKeyboard,
              overlays: document.querySelectorAll('.modal-overlay').length
            }
            const seen = []
            document.addEventListener('keydown', (e) =>
              seen.push([
                e.key,
                e.defaultPrevented,
                document.activeElement?.getAttribute('aria-label')
              ])
            )
            window.__seen = seen
            return out
          })
        )
      )
      await kb.press('ArrowLeft')
      await sleep(200)
      console.log(
        'DEBUG after ←',
        JSON.stringify(await win.evaluate(() => window.__seen)),
        JSON.stringify(await active())
      )
    }
    check(
      '1. the till opens with the focus in the product field',
      a.text === 'الصنف: باركود أو اسم',
      JSON.stringify(a)
    )
    check('   «عدد الأصناف» starts at 0', (await lineCount()) === '0')
    // Tab and Shift+Tab are unchanged: Tab leaves the product field, Shift+Tab comes back to it.
    a = await press('Tab', 'Tab')
    const tabbed = a.text !== 'الصنف: باركود أو اسم' && !a.none
    a = await press('Shift+Tab', 'Shift+Tab')
    check(
      'Tab moves on from the product field and Shift+Tab comes back to it',
      tabbed && a.text === 'الصنف: باركود أو اسم',
      JSON.stringify(a)
    )

    // ── 2. A scan → the line's quantity, selected → 50 replaces 1 → Enter → the product field.
    await scan('6223001360063')
    a = await active()
    check(
      '3. after a scan, the focus is on that line’s quantity',
      a.lineKey?.startsWith('6223001360063|'),
      JSON.stringify(a)
    )
    check(
      '4. its quantity is selected (typing replaces it)',
      a.allSelected === true && a.value === '1',
      JSON.stringify(a)
    )
    await kb.type('50')
    a = await press('Enter', 'commit 50')
    check(
      '5. Enter: back to the product field',
      a.text === 'الصنف: باركود أو اسم',
      JSON.stringify(a)
    )
    let lines = await cartLines()
    check('   the quantity is 50 (not 150, not 501)', lines[0]?.qty === '50', JSON.stringify(lines))
    check('   «عدد الأصناف» = 1', (await lineCount()) === '1')

    // ── A scale label of product 1 (its own code; 0.125 kg), corrected to 0.5.
    await scan(label(1, 125))
    a = await active()
    check(
      '6. a scale label adds product 1 with 0.125 kg, its quantity focused',
      a.lineKey === '1|' && a.value === '0.125',
      JSON.stringify(a)
    )
    await kb.type('0.5')
    await press('Enter')
    lines = await cartLines()
    check(
      '7. the weight 0.5 is kept, «عدد الأصناف» = 2',
      lines.find((l) => l.code === '1')?.qty === '0.5' && (await lineCount()) === '2',
      JSON.stringify(lines)
    )
    // An invalid quantity is refused, the line kept, the focus stays.
    await scan('6223001360063')
    a = await active()
    check(
      '   the same product again: its own line (51), not a new one',
      a.lineKey?.startsWith('6223001360063|') && a.value === '51',
      JSON.stringify(a)
    )
    await kb.type('2.5')
    a = await press('Enter', 'invalid for pieces')
    const err = await win
      .locator('.qty-error')
      .first()
      .innerText()
      .catch(() => '')
    check(
      '   2.5 pieces: an error shown, the focus stays in the quantity',
      a.lineKey?.startsWith('6223001360063|') && /عدداً صحيحاً/.test(err),
      err
    )
    await kb.type('3')
    await press('Enter')
    check(
      '   3 is accepted',
      (await cartLines()).find((l) => l.code === '6223001360063')?.qty === '3'
    )

    // ── 01 typed by hand: exactly 01 (not 1 or 001); its weight window; 250 g.
    await kb.type('01')
    await press('Enter', 'resolve 01')
    await win.waitForSelector('.modal-overlay', { timeout: 10000 })
    await kb.type('250')
    await press('Enter', 'weight')
    await sleep(500)
    a = await active()
    check(
      '8. 01 typed: the weight window, then its quantity focused',
      a.lineKey === '01|' && a.value === '0.25',
      JSON.stringify(a)
    )
    await press('Enter')
    check('   «عدد الأصناف» = 3', (await lineCount()) === '3')
    lines = await cartLines()
    check(
      '   the lines are 6223001360063, 1 and 01 – never 001',
      JSON.stringify(lines.map((l) => l.code).sort()) ===
        JSON.stringify(['01', '1', '6223001360063']),
      JSON.stringify(lines)
    )
    await shot('cart')

    // ── 10. The arrows to the payment methods; «فيزا» by Enter.
    let pay = await walk(
      'ArrowLeft',
      (x) => x.cls.includes('pay-option'),
      6,
      'to the payment panel'
    )
    if (!pay)
      pay = await walk('ArrowDown', (x) => x.cls.includes('pay-option'), 12, 'down to the methods')
    if (!pay)
      pay = await walk('ArrowUp', (x) => x.cls.includes('pay-option'), 12, 'up to the methods')
    check(
      '10. the arrows reach the payment methods',
      !!pay,
      pay ? pay.text : trail.slice(-6).join(' | ')
    )
    const visa =
      pay?.text === 'فيزا'
        ? pay
        : (await walk('ArrowLeft', (x) => x.text === 'فيزا', 4, 'to فيزا')) ||
          (await walk('ArrowRight', (x) => x.text === 'فيزا', 4, 'to فيزا'))
    check('    «فيزا» reached', !!visa)
    a = await press('Enter', 'choose فيزا')
    const visaOn = await win
      .locator('.pay-option', { hasText: 'فيزا' })
      .getAttribute('aria-pressed')
    check('11. Enter chooses «فيزا»', visaOn === 'true')
    // ── 12. The paid amount.
    a = await walk('ArrowDown', (x) => x.text === 'المبلغ المدفوع', 6, 'to the paid amount')
    check('12. the arrows reach the paid amount', !!a)
    const total = await win
      .locator('.total-amount, .amount-due')
      .first()
      .innerText()
      .catch(() => '')
    await kb.type('250')
    // ── 14. The customer, from its list.
    a = await walk('ArrowDown', (x) => x.text === 'اسم العميل', 6, 'to the customer')
    check('14. the arrows reach the customer name', !!a)
    await kb.type('أم أحمد')
    await sleep(900)
    a = await press('ArrowDown', 'into the matches')
    a = await press('Enter', 'pick the customer')
    const chosen = await win.locator('input[aria-label="اسم العميل"]').inputValue()
    check('15. the customer chosen from the list', chosen.includes('أم أحمد'), chosen)
    // ── 16. The delivery box.
    a = await walk('ArrowDown', (x) => x.type === 'checkbox', 8, 'to the delivery box')
    check('16. the arrows reach «طلب توصيل»', !!a)
    a = await press('Enter', 'toggle delivery')
    check('17. Enter ticks it', a.checked === true, JSON.stringify(a))
    // ── 18. The arrows to «تأكيد الدفع»; Enter.
    // No receipt printer here: the receipt is switched off from the keyboard first («فاتورة» →
    // «بدون فاتورة», beside the confirm button), so no print error can arrive later.
    a = await walk('ArrowDown', (x) => /تأكيد الدفع/.test(x.text), 12, 'to confirm')
    check('18. the arrows reach «تأكيد الدفع»', !!a)
    const receipt = await walk('ArrowLeft', (x) => /طباعة الفاتورة/.test(x.text), 3, 'to «فاتورة»')
    check('    the arrows reach the receipt switch «فاتورة»', !!receipt)
    a = await press('Enter', 'receipt off')
    check('    Enter switches printing off', /معطّلة/.test(a.text), a.text)
    a = await walk(
      'ArrowRight',
      (x) => /تأكيد الدفع|دفع بدون فاتورة/.test(x.text),
      3,
      'back to confirm'
    )
    check('    and back to «تأكيد الدفع»', !!a)
    await shot('before-pay')
    const before = await one('SELECT count(*)::int AS n FROM sales')
    await press('Enter', 'pay')
    await afterPayment(before.n)
    const sale = await one(
      `SELECT s.id, s.total_amount::float8 AS total, s.payment_type, s.client_name, s.is_delivery
         FROM sales s ORDER BY s.id DESC LIMIT 1`
    )
    const after = await one('SELECT count(*)::int AS n FROM sales')
    check(
      '19. one sale saved, paid by Visa, for the customer, with delivery',
      after.n === before.n + 1 &&
        sale.payment_type === 'فيزا' &&
        sale.client_name?.startsWith('أم أحمد') &&
        sale.is_delivery === true,
      JSON.stringify(sale)
    )
    const items = (
      await pool.query(
        'SELECT product_barcode AS b, quantity::float8 AS q FROM sale_items WHERE sale_id = $1 ORDER BY product_barcode',
        [sale.id]
      )
    ).rows
    check(
      '20. its lines: 01 0.25, 1 0.5, 6223001360063 3',
      JSON.stringify(items) ===
        JSON.stringify([
          { b: '01', q: 0.25 },
          { b: '1', q: 0.5 },
          { b: '6223001360063', q: 3 }
        ]),
      JSON.stringify(items)
    )
    const stock = (
      await pool.query(
        "SELECT barcode, stock_qty::float8 AS s FROM products WHERE barcode IN ('1','01','001','6223001360063') ORDER BY barcode"
      )
    ).rows
    check(
      '    stock: 001 untouched, the others lower by what was sold',
      JSON.stringify(stock) ===
        JSON.stringify([
          { barcode: '001', s: 20 },
          { barcode: '01', s: 19.75 },
          { barcode: '1', s: 19.5 },
          { barcode: '6223001360063', s: 97 }
        ]),
      JSON.stringify(stock)
    )
    await sleep(500)
    a = await active()
    check(
      '    after the sale: the product field, «عدد الأصناف» = 0',
      a.text === 'الصنف: باركود أو اسم' && (await lineCount()) === '0',
      JSON.stringify(a)
    )
    void total

    // ── The same by codes typed by hand, paid in cash (F9, F2 kept working).
    await kb.type('6221234567890')
    await sleep(200)
    await press('Enter', 'typed code')
    await sleep(500)
    a = await active()
    check(
      '2b. a typed code: its quantity focused',
      a.lineKey?.startsWith('6221234567890|'),
      JSON.stringify(a)
    )
    await kb.type('4')
    await press('Enter')
    await kb.type('001')
    await press('Enter')
    await win.waitForSelector('.modal-overlay', { timeout: 10000 })
    await kb.type('500')
    await press('Enter')
    await sleep(400)
    await press('Enter')
    lines = await cartLines()
    check(
      '2b. 001 typed is 001; «عدد الأصناف» = 2',
      JSON.stringify(lines.map((l) => l.code).sort()) ===
        JSON.stringify(['001', '6221234567890']) && (await lineCount()) === '2',
      JSON.stringify(lines)
    )
    await press('F9')
    await kb.type('300')
    const paidNow = await active()
    check(
      '2b. F9: the paid amount field, 300 typed into it',
      paidNow.text === 'المبلغ المدفوع' && paidNow.value === '300',
      JSON.stringify(paidNow)
    )
    const salesNow = (await one('SELECT count(*)::int AS n FROM sales')).n
    await press('F2', 'pay without printing')
    await afterPayment(salesNow)
    const cashSale = await one(
      'SELECT payment_type, total_amount::float8 AS t FROM sales ORDER BY id DESC LIMIT 1'
    )
    check(
      '2b. paid in cash with F9 and F2: 4 × 25 + 0.5 × 380 = 290',
      cashSale.payment_type === 'نقدي' && cashSale.t === 290,
      JSON.stringify(cashSale)
    )

    // ── «عدد الأصناف» (D-119): a merge keeps it, a removal (F4) and a clear (Esc) lower it.
    await scan('6223001360063')
    await press('Enter')
    await scan('6223001360063')
    await press('Enter')
    check(
      '4. the same product twice: one line, «عدد الأصناف» = 1',
      (await lineCount()) === '1' && (await cartLines())[0]?.qty === '2',
      JSON.stringify(await cartLines())
    )
    await scan('6221234567890')
    await press('Enter')
    check('4. a second product: «عدد الأصناف» = 2', (await lineCount()) === '2')
    await press('F4', 'remove the last line')
    await sleep(300)
    check('4. F4 removes the last line: «عدد الأصناف» = 1', (await lineCount()) === '1')
    await press('Escape', 'clear the invoice')
    await win.waitForSelector('.modal-overlay', { timeout: 5000 })
    const yes =
      (await walk('ArrowLeft', (x) => x.inModal && /تأكيد/.test(x.text), 3)) ||
      (await walk('ArrowRight', (x) => x.inModal && /تأكيد/.test(x.text), 3))
    check('4. the clear question: its confirm button by the arrows', !!yes)
    await press('Enter', 'clear')
    await win.waitForSelector('.modal-overlay', { state: 'detached', timeout: 5000 })
    await sleep(300)
    a = await active()
    check(
      '4. cleared: «عدد الأصناف» = 0, the focus back in the product field',
      (await lineCount()) === '0' && a.text === 'الصنف: باركود أو اسم',
      JSON.stringify(a)
    )

    // ── 3. A return without an invoice, from the sidebar, by the keyboard.
    a = await walk('ArrowRight', (x) => x.inSidebar, 6, 'to the sidebar')
    check('9. → from the till reaches the sidebar', !!a)
    a = await walk(
      'ArrowDown',
      (x) => x.inSidebar && /مرتجع بدون فاتورة/.test(x.text),
      12,
      'to مرتجع بدون فاتورة'
    )
    if (!a) a = await walk('ArrowUp', (x) => x.inSidebar && /مرتجع بدون فاتورة/.test(x.text), 12)
    check('    ↑ ↓ in the sidebar reach «مرتجع بدون فاتورة»', !!a)
    await press('Enter', 'open it')
    await win.waitForSelector('[data-testid=rni-code]')
    await sleep(500)
    a = await active()
    check(
      '3. the return screen opens with the focus in its product field',
      a.text?.startsWith('الصنف المرتجع'),
      JSON.stringify(a)
    )
    await scan('6223001360063')
    a = await active()
    check('3. a scan: its quantity, selected', a.allSelected === true, JSON.stringify(a))
    await kb.type('2')
    await press('Enter')
    a = await walk('ArrowDown', (x) => x.text === 'سبب المرتجع', 10, 'to the reason')
    check('3. the arrows reach the reason', !!a)
    await kb.type('عميل معروف')
    a = await walk('ArrowDown', (x) => /وإتمام المرتجع/.test(x.text), 6, 'to the confirm button')
    check('3. the arrows reach the confirm button', !!a)
    const stockBefore = (
      await one("SELECT stock_qty::float8 AS s FROM products WHERE barcode = '6223001360063'")
    ).s
    await press('Enter', 'confirm')
    await win.waitForSelector('.modal-overlay', { timeout: 10000 })
    a = await active()
    // The confirmation window: its confirm button by the arrows, then Enter.
    const ok =
      (await walk(
        'ArrowLeft',
        (x) => x.inModal && /تأكيد/.test(x.text),
        4,
        'to the window’s confirm'
      )) || (await walk('ArrowRight', (x) => x.inModal && /تأكيد/.test(x.text), 4))
    check('3. the confirmation window: its confirm button by the arrows', !!ok, JSON.stringify(a))
    await press('Enter', 'yes')
    await win.waitForSelector('text=تم المرتجع بدون فاتورة', { timeout: 15000 })
    const ret = await one(
      'SELECT id, total::float8 AS total, ledger_id FROM customer_returns ORDER BY id DESC LIMIT 1'
    )
    const stockAfter = (
      await one("SELECT stock_qty::float8 AS s FROM products WHERE barcode = '6223001360063'")
    ).s
    check(
      '3. saved: 26.00 refunded in cash, 2 back in stock',
      ret && ret.total === 26 && ret.ledger_id && stockAfter === stockBefore + 2,
      JSON.stringify({ ret, stockBefore, stockAfter })
    )
    await shot('return')

    // ── 4. Every screen of the sidebar: ↑ ↓ to it, Enter, ← into it, and something there gets focus.
    const screens = await win.evaluate(() =>
      [...document.querySelectorAll('.sidebar-nav .nav-item')]
        .map((x) => (x.getAttribute('aria-label') || x.innerText).trim())
        .filter(Boolean)
    )
    const sweep = []
    // Start from the first sidebar item.
    a = await walk('ArrowRight', (x) => x.inSidebar, 6)
    await walk('ArrowUp', () => false, 40)
    for (const name of screens) {
      a = await active()
      if (!a.inSidebar) a = await walk('ArrowRight', (x) => x.inSidebar, 8)
      // Move to this item.
      // Up or down the list, whichever side the screen is on.
      const here = screens.indexOf(a?.text)
      // From the sidebar's footer buttons (below the list) it is always up.
      const dirKey = here === -1 || screens.indexOf(name) < here ? 'ArrowUp' : 'ArrowDown'
      let at =
        a && a.text === name ? a : await walk(dirKey, (x) => x.inSidebar && x.text === name, 45)
      if (!at) {
        sweep.push({ name, reached: false })
        continue
      }
      await press('Enter', `open ${name}`)
      await sleep(900)
      // A window the screen opens by itself (the open-shift question at the till): Esc.
      if (await win.locator('.modal-overlay').count()) await press('Escape')
      const inside = await walk('ArrowLeft', (x) => !x.inSidebar && !x.none, 4)
      // How many controls of the main area the arrows reach from there (↓ then ←, up to 25 steps).
      const seen = new Set()
      if (inside) {
        seen.add(inside.text)
        for (let i = 0; i < 12; i++) seen.add((await press('ArrowDown')).text)
        for (let i = 0; i < 6; i++) seen.add((await press('ArrowLeft')).text)
      }
      sweep.push({ name, reached: true, entered: !!inside, controls: seen.size })
      // Back to the sidebar for the next one.
      if (!(await walk('ArrowRight', (x) => x.inSidebar, 12)))
        console.log(
          'STUCK',
          name,
          JSON.stringify(
            await win.evaluate(() => {
              const el = document.activeElement
              const r = el.getBoundingClientRect()
              const all = [
                ...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')
              ]
              const right = all.filter(
                (c) =>
                  c !== el &&
                  c.getBoundingClientRect().left >= r.right - 4 &&
                  c.getBoundingClientRect().width > 0
              )
              let tried
              try {
                const n = window.__heroNav.moveFocus(el, 'right')
                const nr = n?.getBoundingClientRect()
                tried = n
                  ? [
                      n.tagName,
                      n.type,
                      n.closest('label')?.innerText?.slice(0, 40),
                      n.getAttribute('aria-label'),
                      Math.round(nr.left),
                      Math.round(nr.top),
                      Math.round(nr.width),
                      Math.round(nr.height),
                      n === el
                    ]
                  : 'null'
              } catch (e) {
                tried = 'ERROR ' + e.message
              }
              return {
                tried,
                scrollY: window.scrollY,
                docScroll: document.scrollingElement.scrollTop,
                rect: [r.left, r.top, r.width, r.height],
                vh: innerHeight,
                area: el.closest('.topbar, .sidebar, .app-content, .phone-bar')?.className,
                overlays: document.querySelectorAll('.modal-overlay').length,
                right: right.length,
                rightSample: right
                  .slice(0, 3)
                  .map((c) => [
                    c.innerText?.slice(0, 20),
                    Math.round(c.getBoundingClientRect().left),
                    Math.round(c.getBoundingClientRect().top),
                    c.tabIndex,
                    c.disabled
                  ])
              }
            })
          )
        )
      await sleep(200)
    }
    const failed = sweep.filter((s) => !s.reached || !s.entered)
    check(
      `4. every sidebar screen (${sweep.length}) is opened and entered with the arrows`,
      failed.length === 0,
      failed.map((s) => s.name).join('، ')
    )
    fs.writeFileSync(path.join(dir, 'sweep.json'), JSON.stringify(sweep, null, 1))
    console.log(JSON.stringify(sweep))
  } catch (e) {
    check('no unexpected error', false, e.stack)
    await shot('failure').catch(() => {})
  } finally {
    if (process.env.HEROMARKET_E2E_TRAIL)
      fs.writeFileSync(process.env.HEROMARKET_E2E_TRAIL, trail.join('\n'))
    await app.close().catch(() => {})
    await pool.end()
    await db.dispose()
  }
  const bad = results.filter((r) => !r.ok)
  console.log(`\n${results.length - bad.length}/${results.length} checks passed`)
  void crypto
  process.exit(bad.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
