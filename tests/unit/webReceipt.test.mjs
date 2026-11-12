// Receipts on the phone (D-106): the same receipt as the shop's, as text to share.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { receiptText } from '../../src/renderer/src/lib/webReceipt.js'
import { buildReceiptLines, defaultTemplate } from '../../src/shared/receipt.mjs'

test("a sale's receipt as plain text: the printer's tags and the logo line removed", () => {
  const lines = buildReceiptLines(
    defaultTemplate('80mm'),
    {
      saleId: 'W-3',
      date: '2026-11-12',
      time: '18:30',
      cashier: 'owner',
      items: [{ name: 'أرز', barcode: '200001', qty: 2, price: 24, total: 48 }],
      total: 48,
      paid: 50,
      change: 2,
      paymentType: 'نقدي'
    },
    { name: 'هيرو ماركت', phone: '0100' }
  )
  const text = receiptText(lines)
  assert.match(text, /هيرو ماركت/)
  assert.match(text, /W-3/)
  assert.match(text, /أرز/)
  assert.doesNotMatch(text, /\[(B|BIG|SMALL|C|R|L|LOGO|SEP)\]/)
  assert.doesNotMatch(text, /\n{3,}/)
})

test("the printout follows the receipt printer's layout rules, and never runs typed text", async () => {
  const { printoutHtml } = await import('../../src/renderer/src/lib/webReceipt.js')
  const html = printoutHtml(
    [
      '[C][BIG]هيرو ماركت',
      '[LOGO][C]',
      '------------------------------------------------',
      'أرز|2|24.00|48.00',
      'الإجمالي|48.00 ج.م',
      '[BOX][C]ملاحظة~سطر ثان',
      '[R]<script>alert(1)</script>',
      ''
    ],
    { title: 'x' }
  )
  assert.match(html, /class="b big" style="text-align:center">هيرو ماركت/)
  assert.match(html, /<hr>/)
  assert.match(html, /class="row4 ">.*أرز.*48\.00/)
  assert.match(html, /class="row2 ">.*الإجمالي.*48\.00 ج\.م/)
  assert.match(html, /class="box b".*ملاحظة<br>سطر ثان/)
  assert.doesNotMatch(html, /<script>alert/, 'typed text is escaped')
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<img/, 'no logo given: nothing drawn')
})

test('every report the shop prints has its on-screen printout (close, shift, purchase, shortages)', async () => {
  const { REPORTS, buildShortagesLines } = await import('../../src/shared/reportLines.mjs')
  const { printoutHtml } = await import('../../src/renderer/src/lib/webReceipt.js')
  const lines = buildShortagesLines([{ name: 'سكر|~', stock_qty: 2, min_limit: 5 }], {
    storeName: 'هيرو ماركت',
    branchName: 'الفرع'
  })
  assert.ok(lines.includes('سكر|2|5| '), 'the delimiters in a name are removed')
  assert.match(printoutHtml(lines), /تقرير نواقص المخزون/)
  assert.deepEqual(Object.keys(REPORTS).sort(), ['close', 'momkn', 'purchase', 'shift', 'wallets'])
})
