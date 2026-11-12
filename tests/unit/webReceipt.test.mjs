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
