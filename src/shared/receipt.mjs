// Receipt templates: one data model, two outputs.
//   buildReceiptLines → the thermal line language printed by resources/print_receipt.ps1
//   buildReceiptHtml  → A4 invoice / PDF and the designer's preview of A4
// The designer's thermal preview renders the *same lines* the printer receives, so preview = print.
// Templates are plain data (no code, no HTML): only known fields, labels and options.
//
// Line language (print_receipt.ps1):
//   [C]text   centred, bold        [R]text right   [L]text left
//   [BOX]a~b  framed centred block (one line per ~)
//   a|b|c|d   item row (name | qty | price | total)
//   a|b       label | value;  [B]a|b  label | value in bold
//   anything else: right-aligned text (separators are plain text)

export const PAPERS = {
  '58mm': { width: 32, label: 'حراري 58 مم' },
  '80mm': { width: 48, label: 'حراري 80 مم' },
  A4: { width: 48, label: 'A4 / PDF' }
}

export const SEPARATORS = { dashed: '-', double: '=', dotted: '.', none: '' }

export const DEFAULT_LABELS = {
  title: 'فاتورة بيع',
  invoiceNo: 'رقم العملية',
  date: 'التاريخ',
  time: 'الوقت',
  cashier: 'الكاشير',
  customer: 'العميل',
  phone: 'الهاتف',
  address: 'العنوان',
  item: 'الصنف',
  qty: 'ك',
  price: 'سعر',
  lineTotal: 'إجمالي',
  subtotal: 'المجموع قبل الخصم',
  total: 'الإجمالي',
  discount: 'خصم الفاتورة',
  paid: 'المدفوع',
  change: 'الباقي للعميل',
  paymentType: 'طريقة الدفع',
  itemCount: 'عدد الأصناف',
  currency: 'ج.م'
}

/** The default template reproduces the legacy printed receipt line for line (see tests/unit/receipt.test.mjs). */
export function defaultTemplate(paper = '80mm') {
  return {
    version: 1,
    paper,
    header: {
      showLogo: true,
      showStoreName: true,
      showBranch: true,
      showAddress: false,
      showPhone: false,
      showTitle: true,
      extraLines: []
    },
    info: {
      showInvoiceNo: true,
      showDate: true,
      showTime: true,
      showCashier: true,
      showCustomer: true,
      showCustomerPhone: true,
      showCustomerAddress: true,
      showPaymentType: false
    },
    items: { showUnitPrice: true, showBarcode: false },
    totals: {
      showSubtotal: false,
      showDiscount: true,
      showPaid: true,
      showChange: true,
      showItemCount: false,
      boldTotal: true
    },
    footer: { lines: ['شكراً لتسوقكم معنا!'], showStoreName: true },
    style: { fontSize: 8, separator: 'dashed' },
    labels: { ...DEFAULT_LABELS }
  }
}

const BOOL_GROUPS = {
  header: ['showLogo', 'showStoreName', 'showBranch', 'showAddress', 'showPhone', 'showTitle'],
  info: [
    'showInvoiceNo',
    'showDate',
    'showTime',
    'showCashier',
    'showCustomer',
    'showCustomerPhone',
    'showCustomerAddress',
    'showPaymentType'
  ],
  items: ['showUnitPrice', 'showBarcode'],
  totals: ['showSubtotal', 'showDiscount', 'showPaid', 'showChange', 'showItemCount', 'boldTotal'],
  footer: ['showStoreName']
}

// Characters that would change the meaning of a line in the print language.
const CONTROL_RE = /[|~\r\n]|^\[(C|R|L|B|BOX)\]/g
const cleanText = (s, max = 60) =>
  String(s ?? '')
    .replace(CONTROL_RE, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, max)

/**
 * Validate and normalise a template. Unknown keys are dropped; missing keys take defaults.
 * Returns { ok, errors, value }.
 */
export function normalizeTemplate(input) {
  const errors = []
  const src = input && typeof input === 'object' ? input : {}
  const paper = PAPERS[src.paper] ? src.paper : '80mm'
  if (src.paper && !PAPERS[src.paper]) errors.push('مقاس الورق غير مدعوم.')
  const base = defaultTemplate(paper)
  const out = { version: 1, paper }
  for (const [group, keys] of Object.entries(BOOL_GROUPS)) {
    out[group] = { ...base[group] }
    for (const k of keys)
      if (src[group] && typeof src[group][k] === 'boolean') out[group][k] = src[group][k]
  }
  const extra = Array.isArray(src.header?.extraLines) ? src.header.extraLines : []
  if (extra.length > 3) errors.push('الحد الأقصى 3 أسطر إضافية في رأس الفاتورة.')
  out.header.extraLines = extra
    .slice(0, 3)
    .map((l) => cleanText(l))
    .filter(Boolean)
  const footer = Array.isArray(src.footer?.lines) ? src.footer.lines : base.footer.lines
  if (footer.length > 4) errors.push('الحد الأقصى 4 أسطر في تذييل الفاتورة.')
  out.footer.lines = footer
    .slice(0, 4)
    .map((l) => cleanText(l))
    .filter(Boolean)
  const size = Number(src.style?.fontSize ?? base.style.fontSize)
  if (!(size >= 7 && size <= 11)) errors.push('حجم الخط يجب أن يكون بين 7 و 11.')
  out.style = {
    fontSize: Math.min(11, Math.max(7, Math.round(size) || 8)),
    separator:
      SEPARATORS[src.style?.separator] !== undefined ? src.style.separator : base.style.separator
  }
  out.labels = { ...DEFAULT_LABELS }
  for (const k of Object.keys(DEFAULT_LABELS)) {
    if (src.labels && typeof src.labels[k] === 'string') {
      const v = cleanText(src.labels[k], 30)
      if (!v) errors.push(`التسمية "${DEFAULT_LABELS[k]}" لا يمكن أن تكون فارغة.`)
      else out.labels[k] = v
    }
  }
  return { ok: errors.length === 0, errors, value: out }
}

const displayLen = (s) => String(s).replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '').length
const fixed2 = (n) => (Number(n) || 0).toFixed(2)

function lrPad(width, l, r) {
  const left = String(l || '')
  const right = String(r || '')
  return left + ' '.repeat(Math.max(1, width - displayLen(left) - displayLen(right))) + right
}

/**
 * @param {object} tpl   normalised template
 * @param {object} d     { saleId, date, time, cashier, client:{name,phone,address}, items:[{name,barcode,qty,price,total}],
 *                         subTotal, total, discount, paid, change, paymentType }
 * @param {object} store { name, branch, address, phone }
 * @returns {string[]}   lines for print_receipt.ps1
 */
export function buildReceiptLines(tpl, d, store = {}) {
  const t = normalizeTemplate(tpl).value
  const L = t.labels
  const W = PAPERS[t.paper].width
  const sepChar = SEPARATORS[t.style.separator]
  const sep = sepChar ? sepChar.repeat(W) : null
  const cur = L.currency
  const lines = []
  const push = (...xs) => lines.push(...xs.filter((x) => x !== null && x !== undefined))

  if (t.header.showStoreName && store.name) push(`[C]${store.name}`)
  if (t.header.showBranch && store.branch) push(`[C]${store.branch}`)
  if (t.header.showAddress && store.address) push(`[C]${cleanText(store.address, 80)}`)
  if (t.header.showPhone && store.phone) push(`[C]${L.phone}: ${cleanText(store.phone, 30)}`)
  for (const l of t.header.extraLines) push(`[C]${l}`)
  if (t.header.showTitle) push(`[C]${L.title}`)
  if (t.info.showInvoiceNo) push(`[C]${L.invoiceNo} : ${d.saleId ?? '—'}`)
  push(sep)

  if (t.info.showDate && t.info.showTime && d.date && d.time)
    push(lrPad(W, `${L.time}: ${d.time}`, `${L.date}: ${d.date}`))
  else if (t.info.showDate && d.date) push(`[R]${L.date}: ${d.date}`)
  else if (t.info.showTime && d.time) push(`[R]${L.time}: ${d.time}`)
  if (t.info.showCashier && d.cashier) push(`[R]${L.cashier}: ${d.cashier}`)
  if (t.info.showPaymentType && d.paymentType) push(`[R]${L.paymentType}: ${d.paymentType}`)

  const c = d.client || {}
  const phone = t.info.showCustomerPhone && c.phone ? c.phone : ''
  const address = t.info.showCustomerAddress && c.address ? c.address : ''
  if (t.info.showCustomer && c.name) {
    push(
      `[BOX]${L.customer}: ${cleanText(c.name)}` +
        (phone ? ` ~ ${L.phone}: ${cleanText(phone)}` : '') +
        (address ? ` ~ ${L.address}: ${cleanText(address)}` : '')
    )
  } else if (address) {
    push(`[BOX]${L.address}: ${cleanText(address)}`)
  }

  push(sep)
  push(`${L.item}|${L.qty}|${t.items.showUnitPrice ? L.price : ''}|${L.lineTotal}`)
  push(sep, sep)
  for (const it of d.items || []) {
    const name =
      cleanText(it.name, 80) +
      (t.items.showBarcode && it.barcode ? ` (${cleanText(it.barcode, 20)})` : '')
    push(`${name}|${it.qty}|${t.items.showUnitPrice ? fixed2(it.price) : ''}|${fixed2(it.total)}`)
  }
  push(sep)

  const bold = t.totals.boldTotal ? '[B]' : ''
  if (t.totals.showItemCount) push(`${L.itemCount}|${(d.items || []).length}`)
  if (t.totals.showSubtotal && d.subTotal !== undefined)
    push(`${L.subtotal}|${fixed2(d.subTotal)} ${cur}`)
  push(`${bold}${L.total}|${fixed2(d.total)} ${cur}`)
  if (t.totals.showDiscount && Number(d.discount) > 0)
    push(`${L.discount}|- ${fixed2(d.discount)} ${cur}`)
  if (t.totals.showPaid) push(`${L.paid}|${fixed2(d.paid)} ${cur}`)
  if (t.totals.showChange) push(`${L.change}|${fixed2(d.change)} ${cur}`)
  push(sep)

  for (const l of t.footer.lines) push(`[C]${l}`)
  if (t.footer.showStoreName && store.name) push(`[C]- ${store.name} -`)
  push('', '')
  return lines
}

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  )

/** A4 invoice (and PDF) from the same template and data. Self-contained HTML, RTL, no external assets. */
export function buildReceiptHtml(tpl, d, store = {}, { logoDataUrl } = {}) {
  const t = normalizeTemplate(tpl).value
  const L = t.labels
  const cur = L.currency
  const c = d.client || {}
  const rows = (d.items || [])
    .map(
      (
        it,
        i
      ) => `<tr><td class="n">${i + 1}</td><td>${esc(it.name)}${t.items.showBarcode && it.barcode ? `<div class="bc">${esc(it.barcode)}</div>` : ''}</td>
        <td class="num">${esc(it.qty)}</td>${t.items.showUnitPrice ? `<td class="num">${fixed2(it.price)}</td>` : ''}<td class="num">${fixed2(it.total)}</td></tr>`
    )
    .join('')
  const info = [
    t.info.showInvoiceNo && [L.invoiceNo, d.saleId],
    t.info.showDate && d.date && [L.date, d.date],
    t.info.showTime && d.time && [L.time, d.time],
    t.info.showCashier && d.cashier && [L.cashier, d.cashier],
    t.info.showPaymentType && d.paymentType && [L.paymentType, d.paymentType],
    t.info.showCustomer && c.name && [L.customer, c.name],
    t.info.showCustomerPhone && c.phone && [L.phone, c.phone],
    t.info.showCustomerAddress && c.address && [L.address, c.address]
  ].filter(Boolean)
  const totals = [
    t.totals.showItemCount && [L.itemCount, (d.items || []).length, false],
    t.totals.showSubtotal &&
      d.subTotal !== undefined && [L.subtotal, `${fixed2(d.subTotal)} ${cur}`, false],
    t.totals.showDiscount &&
      Number(d.discount) > 0 && [L.discount, `- ${fixed2(d.discount)} ${cur}`, false],
    [L.total, `${fixed2(d.total)} ${cur}`, t.totals.boldTotal],
    t.totals.showPaid && [L.paid, `${fixed2(d.paid)} ${cur}`, false],
    t.totals.showChange && [L.change, `${fixed2(d.change)} ${cur}`, false]
  ].filter(Boolean)
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(L.title)} ${esc(d.saleId)}</title>
<style>
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #111; margin: 0; font-size: ${t.style.fontSize + 3}pt; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #153B32; padding-bottom: 12px; }
header .store h1 { margin: 0; font-size: 20pt; color: #153B32; }
header .store p { margin: 2px 0; color: #444; }
header img { max-height: 64px; max-width: 160px; }
h2 { font-size: 15pt; margin: 18px 0 8px; }
dl { display: grid; grid-template-columns: max-content 1fr max-content 1fr; gap: 4px 14px; margin: 0 0 14px; }
dt { color: #555; } dd { margin: 0; font-weight: 600; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 7px 8px; border-bottom: 1px solid #ddd; text-align: right; }
th { background: #EEF3EF; font-weight: 700; }
td.num, th.num { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.n { width: 32px; color: #777; }
.bc { font-size: 8pt; color: #777; direction: ltr; text-align: right; }
.totals { margin-inline-start: auto; width: 46%; margin-top: 12px; }
.totals div { display: flex; justify-content: space-between; padding: 4px 0; }
.totals .strong { font-weight: 800; font-size: 1.15em; border-top: 2px solid #153B32; margin-top: 4px; padding-top: 6px; }
footer { margin-top: 28px; text-align: center; color: #444; }
</style></head><body>
<header><div class="store">
${t.header.showStoreName && store.name ? `<h1>${esc(store.name)}</h1>` : ''}
${t.header.showBranch && store.branch ? `<p>${esc(store.branch)}</p>` : ''}
${t.header.showAddress && store.address ? `<p>${esc(store.address)}</p>` : ''}
${t.header.showPhone && store.phone ? `<p>${esc(L.phone)}: ${esc(store.phone)}</p>` : ''}
${t.header.extraLines.map((l) => `<p>${esc(l)}</p>`).join('')}
</div>${t.header.showLogo && logoDataUrl ? `<img src="${esc(logoDataUrl)}" alt="">` : ''}</header>
${t.header.showTitle ? `<h2>${esc(L.title)}</h2>` : ''}
<dl>${info.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
<table><thead><tr><th class="n">#</th><th>${esc(L.item)}</th><th class="num">${esc(L.qty)}</th>${t.items.showUnitPrice ? `<th class="num">${esc(L.price)}</th>` : ''}<th class="num">${esc(L.lineTotal)}</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="totals">${totals.map(([k, v, strong]) => `<div class="${strong ? 'strong' : ''}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>
<footer>${t.footer.lines.map((l) => `<div>${esc(l)}</div>`).join('')}${t.footer.showStoreName && store.name ? `<div>- ${esc(store.name)} -</div>` : ''}</footer>
</body></html>`
}

/** Representative data for the designer preview. */
export const SAMPLE_RECEIPT = {
  saleId: 1024,
  date: '13/10/2026',
  time: '10:42:05 ص',
  cashier: 'كاشير 1',
  paymentType: 'نقدي',
  client: { name: 'أحمد محمود', phone: '01012345678', address: 'شارع النيل' },
  items: [
    { name: 'جبنة رومي قديم فرط', barcode: '00515', qty: 0.75, price: 240, total: 180 },
    { name: 'لوبيا الضحى 500جم', barcode: '6223000660515', qty: 2, price: 112.7, total: 225.4 },
    { name: 'مياه معدنية 1.5 لتر', barcode: '6224000301000', qty: 6, price: 1.72, total: 10.32 }
  ],
  subTotal: 415.72,
  discount: 5.72,
  total: 410,
  paid: 500,
  change: 90
}
