import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateReceiptHtml } from '../../src/renderer/src/lib/printTemplates.js'
import { buildReceiptText } from '../../src/shared/legacyReceiptText.mjs'
import {
  buildReceiptLines,
  buildReceiptHtml,
  defaultTemplate,
  normalizeTemplate,
  SAMPLE_RECEIPT
} from '../../src/shared/receipt.mjs'

const store = { name: 'هيرو ماركت', branch: 'الفرع الرئيسي' }

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
  // The template marks the total row bold explicitly ([B]); the printer renders it as before.
  assert.deepEqual(
    fresh.map((l) => l.replace(/^\[B\]/, '')),
    legacy
  )
})

test('the only intended difference: the discount line no longer prints a double minus (K-29)', () => {
  const { legacy, fresh } = legacyAndNew({ discount: 5.4, paid: 0 })
  const stripped = fresh.map((l) => l.replace(/^\[B\]/, ''))
  const diff = stripped.map((l, i) => [l, legacy[i]]).filter(([a, b]) => a !== b)
  assert.deepEqual(diff, [['خصم الفاتورة|- 5.40 ج.م', 'خصم الفاتورة|- -5.40 ج.م']])
})

test('template text cannot inject printer control syntax', () => {
  const t = defaultTemplate('80mm')
  t.footer.lines = ['[C]evil|x~y', 'ok']
  t.labels.total = 'TOTAL|99'
  const n = normalizeTemplate(t)
  const lines = buildReceiptLines(n.value, SAMPLE_RECEIPT, store)
  assert.ok(
    lines.every(
      (l) =>
        (l.match(/\|/g) || []).length === 0 ||
        (l.match(/\|/g) || []).length === 1 ||
        (l.match(/\|/g) || []).length === 3
    )
  )
  assert.ok(!lines.some((l) => l.includes('evil|')), 'pipe removed from custom text')
  assert.ok(
    lines.some((l) => l.startsWith('[B]TOTAL 99|')),
    'label sanitised but kept'
  )
})

test('58 mm uses 32-character separators; unknown options are rejected or defaulted', () => {
  const lines = buildReceiptLines(defaultTemplate('58mm'), SAMPLE_RECEIPT, store)
  assert.ok(lines.includes('-'.repeat(32)))
  const bad = normalizeTemplate({
    paper: 'A5',
    style: { fontSize: 40 },
    footer: { lines: ['1', '2', '3', '4', '5'] }
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.value.paper, '80mm')
  assert.equal(bad.value.style.fontSize, 11)
  assert.equal(bad.value.footer.lines.length, 4)
})

test('hidden fields are not printed; A4 HTML escapes data', () => {
  const t = defaultTemplate('80mm')
  t.items.showUnitPrice = false
  t.info.showCashier = false
  const lines = buildReceiptLines(t, SAMPLE_RECEIPT, store)
  assert.ok(!lines.some((l) => l.includes('الكاشير')))
  assert.ok(lines.includes('جبنة رومي قديم فرط|0.75||180.00'))
  const html = buildReceiptHtml(
    defaultTemplate('A4'),
    { ...SAMPLE_RECEIPT, client: { name: '<script>x</script>' } },
    store
  )
  assert.ok(!html.includes('<script>x'))
  assert.ok(html.includes('&lt;script&gt;'))
})
