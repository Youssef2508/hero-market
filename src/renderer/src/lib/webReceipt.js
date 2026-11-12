// Printouts on the phone (Phase 2, D-106). The shop's receipt printer is a shop PC device. In the
// browser, whatever the shop would print – a sale's receipt, a shift or closing report, a purchase
// invoice, the shortages list – is built by the same shared code as on the shop PC and shown on
// screen as the paper would look (the printer's own layout rules, resources/print_receipt.ps1), to
// print or save as PDF with the phone's print dialog, or to share as text. Everything shown is
// already saved, and the shop PC can print it on its receipt printer at any time.
import {
  buildReceiptHtml,
  buildReceiptLines,
  defaultTemplate,
  normalizeTemplate
} from '../../../shared/receipt.mjs'
import { REPORTS, buildShortagesLines } from '../../../shared/reportLines.mjs'

const TAGS = /^\[(C|R|L|B|N|BIG|SMALL|BOX|LOGO|NEW)\]/
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  )

function split(line) {
  const tags = {}
  let rest = String(line ?? '')
  let m
  while ((m = TAGS.exec(rest))) {
    tags[m[1]] = true
    rest = rest.slice(m[0].length)
  }
  return { tags, rest }
}

/** The receipt's lines as plain text: the printer's layout tags and the logo line removed. */
export function receiptText(lines) {
  return lines
    .map(split)
    .filter(({ tags }) => !tags.LOGO)
    .map(({ rest }) => rest.replace(/~/g, '\n').replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The paper as the shop's receipt printer lays it out (print_receipt.ps1): right-aligned by default,
 * [C] centre, [L] left; [C] is bold unless [N], [B] anywhere; [BIG] larger; [BOX] a framed block of
 * "~"-separated lines; "a|b|c|d" an item row, "a|b" a label and its value; two parts set apart by
 * three spaces at both ends; a line of dashes a separator.
 */
export function printoutHtml(lines, { title = '', paper = '80mm', logoDataUrl = '' } = {}) {
  const width = paper === '58mm' ? '58mm' : '80mm'
  const rows = lines.map((line) => {
    const { tags, rest } = split(line)
    if (tags.LOGO) {
      if (!logoDataUrl) return ''
      const side = tags.L ? 'left' : tags.R ? 'right' : 'center'
      return `<div style="text-align:${side}"><img src="${esc(logoDataUrl)}" alt="" style="max-width:${tags.SMALL ? 40 : tags.BIG ? 85 : 60}%"></div>`
    }
    const bold = tags.BOX ? !tags.N : (tags.C && !tags.N) || tags.B
    const cls = [bold ? 'b' : '', tags.BIG ? 'big' : ''].join(' ').trim()
    const side = tags.C ? 'center' : tags.L ? 'left' : 'right'
    if (!rest.trim()) return '<div class="gap"></div>'
    if (/^[-=._]{8,}$/.test(rest.trim())) return '<hr>'
    if (tags.BOX)
      return `<div class="box ${cls}" style="text-align:${side}">${rest
        .split('~')
        .map((x) => esc(x.trim()))
        .join('<br>')}</div>`
    if (rest.includes('|')) {
      const p = rest.split('|').map((x) => esc(x.trim()))
      if (p.length === 4)
        return `<div class="row4 ${cls}"><span>${p[0]}</span><span class="c">${p[1]}</span><span class="c">${p[2]}</span><span class="l">${p[3]}</span></div>`
      if (p.length === 2)
        return `<div class="row2 ${cls}"><span>${p[0]}</span><span class="l">${p[1]}</span></div>`
    }
    const two = !tags.C && !tags.L && !tags.R && /^(.*\S)\s{3,}(\S.*)$/.exec(rest)
    if (two)
      return `<div class="row2 ${cls}"><span>${esc(two[2])}</span><span class="l">${esc(two[1])}</span></div>`
    return `<div class="${cls}" style="text-align:${side}">${esc(rest)}</div>`
  })
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: ${width} auto; margin: 4mm; }
  body { margin: 0; background: #e9ecef; font-family: Tahoma, Arial, sans-serif; color: #000; }
  .paper { width: ${width}; max-width: 100%; margin: 12px auto; background: #fff; padding: 4mm; box-sizing: border-box;
           box-shadow: 0 1px 4px rgba(0,0,0,.25); font-size: 12px; line-height: 1.45; }
  .b { font-weight: 700; } .big { font-size: 16px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
  .gap { height: 6px; }
  .row4 { display: grid; grid-template-columns: 1fr 14% 18% 22%; gap: 2px; }
  .row2 { display: flex; justify-content: space-between; gap: 8px; }
  .c { text-align: center; } .l { text-align: left; direction: ltr; }
  .box { border: 1px solid #000; padding: 3px 4px; margin: 3px 0; }
  @media print { body { background: #fff; } .paper { box-shadow: none; margin: 0; width: auto; } }
</style></head><body><div class="paper">${rows.join('\n')}</div></body></html>`
}

/** The store's details and templates as the shop PC prints them (settings.public). */
async function storeOf(call) {
  const res = await call('settings.public', {})
  const s = res.data?.settings || {}
  return {
    settings: s,
    templates: res.data?.receiptTemplates || {},
    store: {
      name: s.store_name || 'HeroMarket',
      branch: s.branch_name || '',
      address: s.store_address || '',
      phone: s.store_phone || ''
    },
    paper: s.receipt_paper === '58mm' ? '58mm' : '80mm',
    logo: s.store_logo || ''
  }
}
const templateOf = (templates, paper) =>
  normalizeTemplate(templates[paper] ? templates[paper].config : defaultTemplate(paper)).value

function show(detail) {
  window.dispatchEvent(new CustomEvent('heromarket:receipt', { detail }))
  return { success: true }
}

/** A sale's receipt, as the receipt printer would print it. */
export async function showSaleReceipt(call, data) {
  const st = await storeOf(call)
  const lines = buildReceiptLines(templateOf(st.templates, st.paper), data, st.store)
  const title = `${st.store.name} – فاتورة ${data.saleId ?? ''}`.trim()
  return show({
    title,
    html: printoutHtml(lines, { title, paper: st.paper, logoDataUrl: st.logo }),
    text: receiptText(lines),
    reprint: 'من «إعادة طباعة فاتورة» أو «الفواتير والمرتجعات»'
  })
}

/** The sale as the A4 invoice (the desktop's "save as PDF"). */
export async function showSaleInvoice(call, data, config = null) {
  const st = await storeOf(call)
  const tpl = config
    ? normalizeTemplate({ ...config, paper: 'A4' }).value
    : templateOf(st.templates, 'A4')
  const title = `${st.store.name} – فاتورة ${data.saleId ?? ''}`.trim()
  return show({
    title,
    html: buildReceiptHtml(tpl, data, st.store, { logoDataUrl: st.logo }),
    text: receiptText(buildReceiptLines(templateOf(st.templates, st.paper), data, st.store)),
    reprint: 'من «إعادة طباعة فاتورة» أو «الفواتير والمرتجعات»'
  })
}

const REPORT_TITLES = {
  shift: 'تقرير الوردية',
  close: 'تقرير إغلاق الوردية',
  purchase: 'فاتورة شراء',
  momkn: 'تقرير ماكينة ممكن',
  wallets: 'تقرير المحافظ'
}
const REPORT_REPRINT = {
  shift: 'من «الورديات»',
  close: 'من «الورديات» (تقرير الإغلاق)',
  purchase: 'من «الموردون والمشتريات» (تفاصيل الفاتورة)'
}

/** A report (shift, close, purchase, Momkn, wallets), as the receipt printer would print it. */
export async function showReport(call, kind, data) {
  const build = Object.hasOwn(REPORTS, kind) ? REPORTS[kind] : null
  if (!build || !data || typeof data !== 'object') throw new Error('Unknown report')
  const st = await storeOf(call)
  const printedAt = new Date().toLocaleString('en-GB', { hour12: false })
  const lines = build(data, { store: st.store, paper: st.paper, printedAt })
  const title = REPORT_TITLES[kind] || 'تقرير'
  return show({
    title,
    html: printoutHtml(lines, { title, paper: st.paper }),
    text: receiptText(lines),
    reprint: REPORT_REPRINT[kind] || null
  })
}

/** The stock shortages list. */
export async function showShortages(call, items) {
  const st = await storeOf(call)
  const lines = buildShortagesLines(items, {
    storeName: st.store.name,
    branchName: st.store.branch
  })
  const title = 'تقرير نواقص المخزون'
  return show({
    title,
    html: printoutHtml(lines, { title, paper: st.paper }),
    text: receiptText(lines),
    reprint: 'من «إعادة الطلب» على جهاز المتجر'
  })
}

/** The receipt designer's test print: the template with sample data. */
export async function showTemplateTest(call, config, data) {
  const st = await storeOf(call)
  const tpl = normalizeTemplate(config).value
  if (tpl.paper === 'A4') return showSaleInvoice(call, data, config)
  const lines = buildReceiptLines(tpl, data, st.store)
  const title = 'تجربة تصميم الفاتورة'
  return show({
    title,
    html: printoutHtml(lines, { title, paper: tpl.paper, logoDataUrl: st.logo }),
    text: receiptText(lines)
  })
}
