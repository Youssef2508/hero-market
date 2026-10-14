import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { generateReceiptHtml } from '../../src/renderer/src/lib/printTemplates.js'
import { buildReceiptText } from '../../src/shared/legacyReceiptText.mjs'
import {
  buildReceiptLines,
  buildReceiptHtml,
  defaultTemplate,
  normalizeTemplate,
  newBlock,
  SAMPLE_RECEIPT
} from '../../src/shared/receipt.mjs'

const store = { name: 'هيرو ماركت', branch: 'الفرع الرئيسي' }
const withoutLogo = (lines) => lines.filter((l) => !l.startsWith('[LOGO]'))
const block = (tpl, id) => tpl.blocks.find((b) => b.id === id)
const ZONE_RANK = { top: 0, middle: 1, bottom: 2 }

function legacyAndNew({ discount, paid, client }) {
  const cart = [
    { barcode: '00515', name: 'جبنة رومي قديم فرط', qty: 0.75, price: 240, total: 180 },
    { barcode: '6223000660515', name: 'لوبيا الضحى 500جم', qty: 2, price: 112.7, total: 225.4 }
  ]
  const subTotal = 405.4
  const total = Math.round((subTotal - discount) * 100) / 100
  const date = '١٣‏/١٠‏/٢٠٢٦'
  const time = '١٠:٤٢:٠٥ ص'
  // Exactly what the legacy checkout passed to generateReceiptHtml.
  const html = generateReceiptHtml({
    storeName: store.name,
    branchName: store.branch,
    displaySaleId: 57,
    datePart: date,
    timePart: time,
    currentUser: { username: 'cashier1' },
    clientName: client?.name || '',
    clientPhone: client?.phone || '',
    clientAddress: client?.address || '',
    cart,
    cartTotal: total,
    finalDiscount: discount,
    paidAmount: paid ? paid : total,
    changeRemaining: paid ? Math.max(0, paid - total) : 0,
    paymentType: 'نقدي'
  })
  const legacy = buildReceiptText(html, store.name, store.branch).split('\r\n')
  // What usePOSController now sends to print-sale.
  const fresh = buildReceiptLines(
    defaultTemplate('80mm'),
    {
      saleId: 57,
      date,
      time,
      cashier: 'cashier1',
      paymentType: 'نقدي',
      client: client || {},
      items: cart,
      subTotal,
      discount,
      total,
      paid: paid ? paid : total,
      change: paid ? Math.max(0, paid - total) : 0
    },
    store
  )
  return { legacy, fresh }
}

test('default 80 mm template prints the same lines as the legacy receipt', () => {
  const { legacy, fresh } = legacyAndNew({
    discount: 0,
    paid: 500,
    client: { name: 'أحمد', phone: '0100', address: 'شارع النيل' }
  })
  // The legacy printer always drew the logo first; the template now places it with an explicit line.
  assert.equal(fresh[0], '[LOGO][C]')
  // The template marks the total row bold explicitly ([B]); the printer renders it as before.
  assert.deepEqual(
    withoutLogo(fresh).map((l) => l.replace(/^\[B\]/, '')),
    legacy
  )
})

test('the only intended difference: the discount line no longer prints a double minus (K-29)', () => {
  const { legacy, fresh } = legacyAndNew({ discount: 5.4, paid: 0 })
  const stripped = withoutLogo(fresh).map((l) => l.replace(/^\[B\]/, ''))
  const diff = stripped.map((l, i) => [l, legacy[i]]).filter(([a, b]) => a !== b)
  assert.deepEqual(diff, [['خصم الفاتورة|- 5.40 ج.م', 'خصم الفاتورة|- -5.40 ج.م']])
})

test('templates saved before the block layout print exactly as before (15 golden cases)', () => {
  const golden = JSON.parse(
    fs.readFileSync(new URL('./fixtures/receipt-v1-golden.json', import.meta.url), 'utf8')
  )
  for (const c of golden.cases) {
    const fresh = buildReceiptLines(c.template, golden.datas[c.data], golden.store)
    const label = `${c.variant} / ${c.data}`
    assert.deepEqual(withoutLogo(fresh), c.lines, label)
    const logos = fresh.filter((l) => l.startsWith('[LOGO]'))
    if (c.template.header.showLogo === false) assert.equal(logos.length, 0, label)
    else assert.deepEqual([fresh[0], logos.length], ['[LOGO][C]', 1], label)
    const v2 = normalizeTemplate(c.template).value
    assert.equal(v2.version, 2)
    assert.deepEqual(normalizeTemplate(v2).value, v2, `${label}: normalisation is stable`)
  }
})

test('any element can be placed at the top, middle or bottom, aligned right, centre or left', () => {
  const t = defaultTemplate('80mm')
  Object.assign(block(t, 'logo'), { zone: 'bottom', align: 'left', size: 'small' })
  Object.assign(block(t, 'storeName'), { align: 'left', bold: false, size: 'large' })
  Object.assign(block(t, 'total'), { zone: 'top', align: 'center' })
  Object.assign(block(t, 'customer'), { zone: 'bottom', align: 'right', bold: false })
  Object.assign(block(t, 'dateTime'), { align: 'center' })
  Object.assign(block(t, 'cashier'), { align: 'left', bold: true })
  const ids = t.blocks.map((b) => b.id)
  t.blocks.push({ ...newBlock('text', 'top', ids), text: 'العروض كل خميس', align: 'right' })
  const lines = buildReceiptLines(t, SAMPLE_RECEIPT, store)
  const at = (line) => lines.indexOf(line)

  assert.ok(at('[L][BIG]هيرو ماركت') >= 0, 'store name: left, regular, large')
  assert.ok(at('[C]الإجمالي: 410.00 ج.م') >= 0, 'total: centred one-liner, still bold')
  assert.ok(at('[R][B]العروض كل خميس') >= 0, 'custom text: right, bold')
  assert.ok(at('[L][B]الكاشير: كاشير 1') >= 0, 'cashier: left, bold')
  assert.ok(at('[C][N]التاريخ: 13/10/2026   الوقت: 10:42:05 ص') >= 0, 'date and time centred')
  assert.ok(
    lines.includes('[BOX][R][N]العميل: أحمد محمود ~ الهاتف: 01012345678 ~ العنوان: شارع النيل'),
    'customer box: right, regular'
  )
  // Zones: the total (moved to the top) prints before the items; customer and logo (bottom) after them.
  const itemsHeader = at('الصنف|ك|سعر|إجمالي')
  assert.ok(at('[C]الإجمالي: 410.00 ج.م') < itemsHeader)
  assert.ok(at('[R][B]العروض كل خميس') < itemsHeader, 'text added to the top zone')
  const lastItem = at('مياه معدنية 1.5 لتر|6|1.72|10.32')
  assert.ok(at('[LOGO][L][SMALL]') > lastItem, 'logo moved below the items, bottom left')
  assert.ok(at('[LOGO][L][SMALL]') < at('[C]- هيرو ماركت -'), 'first element of the bottom zone')
  assert.ok(lines.findIndex((l) => l.startsWith('[BOX]')) > itemsHeader)

  const html = buildReceiptHtml(t, SAMPLE_RECEIPT, store, {
    logoDataUrl: 'data:image/png;base64,AA'
  })
  assert.ok(html.includes('<h1 class="a-left large">هيرو ماركت</h1>'))
  assert.ok(html.includes('<p class="a-center strong">الإجمالي: 410.00 ج.م</p>'))
  assert.ok(
    html.indexOf('<img class="logo logo-small"') > html.indexOf('</table>'),
    'A4 follows the same order'
  )
  assert.ok(html.includes('<div class="a-left"><img class="logo logo-small"'))
})

test('validation: required elements stay visible, limits enforced, unknown input dropped', () => {
  const t = defaultTemplate('58mm')
  for (const id of ['items', 'total', 'banner']) block(t, id).visible = false
  t.blocks.push({ type: 'storeName', zone: 'bottom' }, { type: 'script', text: 'x' })
  for (let i = 0; i < 13; i++) t.blocks.push(newBlock('text', 'bottom', []))
  t.blocks = t.blocks.filter((b) => b.id !== 'paid')
  const n = normalizeTemplate(t)
  assert.equal(n.ok, false, 'too many text elements is reported')
  for (const id of ['items', 'total', 'banner']) assert.equal(block(n.value, id).visible, true, id)
  assert.equal(n.value.blocks.filter((b) => b.type === 'storeName').length, 1, 'duplicates dropped')
  assert.ok(!n.value.blocks.some((b) => b.type === 'script'), 'unknown types dropped')
  assert.equal(n.value.blocks.filter((b) => b.type === 'text').length, 12)
  assert.equal(new Set(n.value.blocks.map((b) => b.id)).size, n.value.blocks.length, 'ids unique')
  assert.equal(block(n.value, 'paid').visible, false, 'missing element re-added, hidden')
  const ranks = n.value.blocks.map((b) => ZONE_RANK[b.zone])
  assert.deepEqual(ranks, [...ranks].sort(), 'ordered top → middle → bottom')

  const bad = normalizeTemplate({ version: 2, paper: 'A5', style: { fontSize: 40 }, blocks: [] })
  assert.equal(bad.ok, false)
  assert.equal(bad.value.paper, '80mm')
  assert.equal(bad.value.style.fontSize, 11)
  const legacyBad = normalizeTemplate({
    paper: '80mm',
    footer: { lines: ['1', '2', '3', '4', '5'] }
  })
  assert.equal(legacyBad.ok, false)
  assert.equal(legacyBad.value.blocks.filter((b) => b.type === 'text').length, 4)
})

test('template text and sale data cannot inject printer control syntax', () => {
  const t = defaultTemplate('80mm')
  block(t, 'text-1').text = '[LOGO][C]evil|x~y'
  t.labels.total = 'TOTAL|99'
  const data = { ...SAMPLE_RECEIPT, items: [{ name: '[BIG]|evil', qty: 1, price: 1, total: 1 }] }
  const lines = buildReceiptLines(t, data, { name: '[LOGO]' + store.name })
  const pipes = (l) => (l.match(/\|/g) || []).length
  assert.ok(
    lines.every((l) => [0, 1, 3].includes(pipes(l))),
    'column structure intact'
  )
  assert.equal(lines.filter((l) => l.startsWith('[LOGO]')).length, 1, 'only the template logo')
  assert.ok(lines.includes('[C]evil x y'), 'tags and separators stripped from free text')
  assert.ok(lines.includes(`[C]${store.name}`), 'store name without the injected tag')
  assert.ok(
    lines.some((l) => l.startsWith('[B]TOTAL 99|')),
    'label sanitised but kept'
  )
  assert.ok(lines.includes('evil|1|1.00|1.00'), 'item name cannot add tags or columns')
})

test('58 mm uses 32-character separators; hidden fields are not printed; A4 escapes data', () => {
  const lines58 = buildReceiptLines(defaultTemplate('58mm'), SAMPLE_RECEIPT, store)
  assert.ok(lines58.includes('-'.repeat(32)))
  const t = defaultTemplate('80mm')
  block(t, 'items').showUnitPrice = false
  block(t, 'cashier').visible = false
  const lines = buildReceiptLines(t, SAMPLE_RECEIPT, store)
  assert.ok(!lines.some((l) => l.includes('الكاشير')))
  assert.ok(lines.includes('جبنة رومي قديم فرط|0.75||180.00'))
  const html = buildReceiptHtml(
    defaultTemplate('A4'),
    {
      ...SAMPLE_RECEIPT,
      client: { name: '<script>x</script>' },
      items: [{ name: '<img src=x onerror=alert(1)>', qty: 1, price: 1, total: 1 }]
    },
    store
  )
  assert.ok(!html.includes('<script>') && !html.includes('<img src=x'))
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
})

test('review fixes: typing keeps spaces, real bracketed names survive, phone alone, safe lookups', () => {
  const t = defaultTemplate('80mm')
  block(t, 'text-1').text = 'شكراً '
  t.labels.total = 'الإجمالي '
  const typed = normalizeTemplate(t).value
  assert.equal(block(typed, 'text-1').text, 'شكراً ', 'trailing space kept while editing')
  assert.equal(typed.labels.total, 'الإجمالي ')
  const lines = buildReceiptLines(typed, SAMPLE_RECEIPT, store)
  assert.ok(lines.includes('[C]شكراً'), 'trimmed when printed')
  assert.ok(lines.some((l) => l.startsWith('[B]الإجمالي|')))

  const named = buildReceiptLines(
    defaultTemplate('80mm'),
    { ...SAMPLE_RECEIPT, items: [{ name: '[NEW] Pepsi 1L', qty: 1, price: 1, total: 1 }] },
    store
  )
  assert.ok(named.includes('[NEW] Pepsi 1L|1|1.00|1.00'), 'only printer tags are stripped')

  const phoneOnly = defaultTemplate('80mm')
  Object.assign(block(phoneOnly, 'customer'), { showName: false, showAddress: false })
  assert.ok(
    buildReceiptLines(phoneOnly, SAMPLE_RECEIPT, store).includes('[BOX]الهاتف: 01012345678'),
    'phone printed on its own when the name is hidden'
  )

  const proto = normalizeTemplate({
    version: 2,
    paper: 'toString',
    blocks: [{ type: 'constructor' }, { type: 'storeName', zone: 'valueOf' }]
  })
  assert.equal(proto.value.paper, '80mm')
  assert.ok(!proto.value.blocks.some((b) => b.type === 'constructor'))
  assert.equal(block(proto.value, 'storeName').zone, 'top')

  const big = defaultTemplate('80mm')
  block(big, 'dateTime').size = 'large'
  const bigLines = buildReceiptLines(big, SAMPLE_RECEIPT, store)
  assert.ok(bigLines.includes('[R][BIG]التاريخ: 13/10/2026'), 'too long for one large line: date')
  assert.ok(bigLines.includes('[R][BIG]الوقت: 10:42:05 ص'), '… and time on the next line')
})
