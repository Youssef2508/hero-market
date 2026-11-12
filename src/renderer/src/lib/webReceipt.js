// Receipts on the phone (Phase 2, D-106). The shop's receipt printer is a shop PC device; in the
// browser the same receipt – the store's own template and details, built by the shared
// src/shared/receipt.mjs exactly as on the shop PC – is shown on screen, to print or save as PDF
// through the phone's own print dialog, or to share as text (WhatsApp, for example).
import {
  buildReceiptHtml,
  buildReceiptLines,
  defaultTemplate,
  normalizeTemplate
} from '../../../shared/receipt.mjs'

/** The receipt's lines as plain text: the printer's layout tags and the logo line removed. */
export function receiptText(lines) {
  return lines
    .filter((l) => !String(l).startsWith('[LOGO]'))
    .map((l) =>
      String(l)
        .replace(/\[(?:B|BIG|SMALL|C|R|L|SEP)\]/g, '')
        .replace(/\s+$/, '')
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Build the sale's receipt from the store's settings and ask the screen to show it. */
export async function showWebReceipt(call, data) {
  const res = await call('settings.public', {})
  const s = res.data?.settings || {}
  const templates = res.data?.receiptTemplates || {}
  const store = {
    name: s.store_name || 'HeroMarket',
    branch: s.branch_name || '',
    address: s.store_address || '',
    phone: s.store_phone || ''
  }
  const of = (paper) =>
    normalizeTemplate(templates[paper] ? templates[paper].config : defaultTemplate(paper)).value
  const paper = s.receipt_paper === '58mm' ? '58mm' : '80mm'
  const html = buildReceiptHtml(of('A4'), data, store, { logoDataUrl: s.store_logo || '' })
  const text = receiptText(buildReceiptLines(of(paper), data, store))
  window.dispatchEvent(
    new CustomEvent('heromarket:receipt', {
      detail: { html, text, title: `${store.name} – فاتورة ${data.saleId ?? ''}`.trim() }
    })
  )
  return { success: true }
}
