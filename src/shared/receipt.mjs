// Receipt templates: one data model, two outputs.
//   buildReceiptLines → the thermal line language printed by resources/print_receipt.ps1
//   buildReceiptHtml  → A4 invoice / PDF and the designer's preview of A4
// The designer's thermal preview renders the *same lines* the printer receives, so preview = print.
//
// A template is plain data (no code, no HTML): an ordered list of blocks. Every block — logo, store
// name, invoice number, customer box, items table, each total, free text, separators — has a zone
// (top / middle / bottom of the receipt), an alignment (right / centre / left, or "spread" for
// label-and-value rows), a weight and a size, and can be shown or hidden. Version-1 templates (fixed
// layout with show/hide switches) are converted on read and print exactly as before.
//
// Line language (print_receipt.ps1). A line starts with zero or more tags:
//   [C] centre (bold unless [N])   [R] right   [L] left   [B] bold   [N] regular   [BIG] larger text
//   [BOX]a~b   framed block, one line per ~ (centred and bold unless [R]/[L] or [N])
//   [LOGO]     the store logo, aligned with [R]/[C]/[L], sized with [SMALL]/[BIG]
//   a|b|c|d    item row (name | qty | price | total)
//   a|b        label | value across the width
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

export const ZONES = { top: 'أعلى الفاتورة', middle: 'وسط الفاتورة', bottom: 'أسفل الفاتورة' }
const ZONE_ORDER = { top: 0, middle: 1, bottom: 2 }

export const ALIGN_LABELS = { right: 'يمين', center: 'وسط', left: 'يسار', spread: 'على الطرفين' }

export const SIZE_LABELS = {
  normal: 'عادي',
  large: 'كبير',
  small: 'صغير',
  medium: 'متوسط'
}

export const OPTION_LABELS = {
  showDate: 'التاريخ',
  showTime: 'الوقت',
  showName: 'الاسم',
  showPhone: 'الهاتف',
  showAddress: 'العنوان',
  showUnitPrice: 'سعر الوحدة',
  showBarcode: 'الباركود'
}

/**
 * Block catalogue. kind: logo | line (one line of text) | box (framed lines) | pair (label + value)
 * | table (items) | rule (separator). Blocks without `max` appear once; `required` blocks cannot be
 * hidden (a sales receipt always shows its items, its total and the copy/return marker).
 */
export const BLOCK_TYPES = {
  logo: { label: 'الشعار', kind: 'logo', zone: 'top', align: 'center' },
  storeName: { label: 'اسم المتجر', kind: 'line', zone: 'top', align: 'center', bold: true },
  branch: { label: 'اسم الفرع', kind: 'line', zone: 'top', align: 'center', bold: true },
  storeAddress: { label: 'عنوان المتجر', kind: 'line', zone: 'top', align: 'center', bold: true },
  storePhone: { label: 'هاتف المتجر', kind: 'line', zone: 'top', align: 'center', bold: true },
  title: { label: 'عنوان المستند', kind: 'line', zone: 'top', align: 'center', bold: true },
  banner: {
    label: 'علامة النسخة المكررة / المرتجع',
    kind: 'line',
    zone: 'top',
    align: 'center',
    bold: true,
    required: true
  },
  invoiceNo: { label: 'رقم الفاتورة', kind: 'line', zone: 'top', align: 'center', bold: true },
  dateTime: {
    label: 'التاريخ والوقت',
    kind: 'line',
    zone: 'middle',
    align: 'spread',
    spread: true,
    options: { showDate: true, showTime: true }
  },
  cashier: { label: 'اسم الكاشير', kind: 'line', zone: 'middle', align: 'right' },
  paymentType: { label: 'طريقة الدفع', kind: 'line', zone: 'middle', align: 'right' },
  customer: {
    label: 'بيانات العميل',
    kind: 'box',
    zone: 'middle',
    align: 'center',
    bold: true,
    options: { showName: true, showPhone: true, showAddress: true }
  },
  items: {
    label: 'جدول الأصناف',
    kind: 'table',
    zone: 'middle',
    required: true,
    options: { showUnitPrice: true, showBarcode: false }
  },
  itemCount: { label: 'عدد الأصناف', kind: 'pair', zone: 'middle', align: 'spread' },
  subtotal: { label: 'المجموع قبل الخصم', kind: 'pair', zone: 'middle', align: 'spread' },
  total: {
    label: 'الإجمالي',
    kind: 'pair',
    zone: 'middle',
    align: 'spread',
    bold: true,
    required: true
  },
  discount: { label: 'الخصم', kind: 'pair', zone: 'middle', align: 'spread' },
  paid: { label: 'المدفوع', kind: 'pair', zone: 'middle', align: 'spread' },
  change: { label: 'الباقي للعميل', kind: 'pair', zone: 'middle', align: 'spread' },
  storeNameFooter: {
    label: 'اسم المتجر (سطر ختامي)',
    kind: 'line',
    zone: 'bottom',
    align: 'center',
    bold: true
  },
  text: { label: 'نص حر', kind: 'line', zone: 'bottom', align: 'center', bold: true, max: 12 },
  separator: { label: 'خط فاصل', kind: 'rule', zone: 'middle', max: 16 }
}

/** Alignments a block type accepts (empty for full-width blocks). */
export function alignsFor(type) {
  const meta = BLOCK_TYPES[type]
  if (!meta || meta.kind === 'table' || meta.kind === 'rule') return []
  const h = ['right', 'center', 'left']
  return meta.kind === 'pair' || meta.spread ? ['spread', ...h] : h
}

/** Sizes a block type accepts (empty when it has none). */
export function sizesFor(type) {
  const kind = BLOCK_TYPES[type]?.kind
  if (kind === 'logo') return ['small', 'medium', 'large']
  if (kind === 'line' || kind === 'pair' || kind === 'box') return ['normal', 'large']
  return []
}

const hasWeight = (type) => ['line', 'pair', 'box'].includes(BLOCK_TYPES[type]?.kind)
const ID_RE = /^[a-z]+-[a-z0-9]{1,12}$/

// Column/box separators and line breaks become spaces, '<' '>' are dropped, and leading printer tags
// are removed from every value placed on a line, so data and template text can never change
// alignment, add a logo or split a line. Other bracketed words (e.g. "[NEW] Pepsi") are kept.
const LEADING_TAGS = /^(\s*\[(C|R|L|B|N|BIG|SMALL|BOX|LOGO)\])+/i
const sanitize = (s, max) =>
  String(s ?? '')
    .replace(/[<>]/g, '')
    .replace(/[|~\r\n]/g, ' ')
    .replace(LEADING_TAGS, '')
    .slice(0, max)
const cleanText = (s, max = 60) =>
  sanitize(s, max + 40)
    .trim()
    .slice(0, max)
const has = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key)

/** A block of `type` with every property set: defaults from the catalogue, overridden by valid `raw` values. */
export function makeBlock(type, raw = {}) {
  const meta = BLOCK_TYPES[type]
  const b = {
    id: meta.max ? (ID_RE.test(raw.id || '') ? raw.id : `${type}-1`) : type,
    type,
    zone: has(ZONES, raw.zone) ? raw.zone : meta.zone,
    visible: meta.required ? true : typeof raw.visible === 'boolean' ? raw.visible : true
  }
  const aligns = alignsFor(type)
  if (aligns.length) b.align = aligns.includes(raw.align) ? raw.align : meta.align
  if (hasWeight(type)) b.bold = typeof raw.bold === 'boolean' ? raw.bold : !!meta.bold
  const sizes = sizesFor(type)
  if (sizes.length) {
    const fallback = meta.kind === 'logo' ? 'medium' : 'normal'
    b.size = sizes.includes(raw.size) ? raw.size : fallback
  }
  for (const [k, v] of Object.entries(meta.options || {}))
    b[k] = typeof raw[k] === 'boolean' ? raw[k] : v
  if (type === 'text') b.text = sanitize(raw.text, 80)
  return b
}

function defaultBlocks() {
  const hidden = { visible: false }
  return [
    makeBlock('logo'),
    makeBlock('storeName'),
    makeBlock('branch'),
    makeBlock('storeAddress', hidden),
    makeBlock('storePhone', hidden),
    makeBlock('title'),
    makeBlock('banner'),
    makeBlock('invoiceNo'),
    makeBlock('separator', { id: 'separator-1', zone: 'top' }),
    makeBlock('dateTime'),
    makeBlock('cashier'),
    makeBlock('paymentType', hidden),
    makeBlock('customer'),
    makeBlock('separator', { id: 'separator-2' }),
    makeBlock('items'),
    makeBlock('separator', { id: 'separator-3' }),
    makeBlock('itemCount', hidden),
    makeBlock('subtotal', hidden),
    makeBlock('total'),
    makeBlock('discount'),
    makeBlock('paid'),
    makeBlock('change'),
    makeBlock('separator', { id: 'separator-4' }),
    makeBlock('text', { id: 'text-1', text: 'شكراً لتسوقكم معنا!' }),
    makeBlock('storeNameFooter')
  ]
}

/** The default template reproduces the legacy printed receipt line for line (see tests/unit/receipt.test.mjs). */
export function defaultTemplate(paper = '80mm') {
  return {
    version: 2,
    paper: PAPERS[paper] ? paper : '80mm',
    style: { fontSize: 8, separator: 'dashed' },
    labels: { ...DEFAULT_LABELS },
    blocks: defaultBlocks()
  }
}

/** A new block for the designer: free text and separators get a fresh id. */
export function newBlock(type, zone, existingIds = []) {
  let n = 1
  while (existingIds.includes(`${type}-${n}`)) n++
  return makeBlock(type, { id: `${type}-${n}`, zone })
}

// ── Version 1 (fixed layout with switches) → blocks ─────────────────────────────────────────────
const V1_DEFAULTS = {
  header: { showLogo: true, showStoreName: true, showBranch: true, showTitle: true },
  info: {
    showInvoiceNo: true,
    showDate: true,
    showTime: true,
    showCashier: true,
    showCustomer: true,
    showCustomerPhone: true,
    showCustomerAddress: true
  },
  items: { showUnitPrice: true },
  totals: { showDiscount: true, showPaid: true, showChange: true, boldTotal: true },
  footer: { showStoreName: true }
}

function fromVersion1(src, errors) {
  const on = (group, key) =>
    typeof src[group]?.[key] === 'boolean' ? src[group][key] : !!V1_DEFAULTS[group]?.[key]
  const extra = Array.isArray(src.header?.extraLines) ? src.header.extraLines : []
  if (extra.length > 3) errors.push('الحد الأقصى 3 أسطر إضافية في رأس الفاتورة.')
  const footer = Array.isArray(src.footer?.lines) ? src.footer.lines : ['شكراً لتسوقكم معنا!']
  if (footer.length > 4) errors.push('الحد الأقصى 4 أسطر في تذييل الفاتورة.')
  const texts = (list, zone, prefix) =>
    list
      .slice(0, list === extra ? 3 : 4)
      .map((l) => cleanText(l))
      .filter(Boolean)
      .map((text, i) => makeBlock('text', { id: `text-${prefix}${i + 1}`, zone, text }))
  const show = (visible) => ({ visible })
  return [
    makeBlock('logo', show(on('header', 'showLogo'))),
    makeBlock('storeName', show(on('header', 'showStoreName'))),
    makeBlock('branch', show(on('header', 'showBranch'))),
    makeBlock('storeAddress', show(on('header', 'showAddress'))),
    makeBlock('storePhone', show(on('header', 'showPhone'))),
    ...texts(extra, 'top', 'h'),
    makeBlock('title', show(on('header', 'showTitle'))),
    makeBlock('banner'),
    makeBlock('invoiceNo', show(on('info', 'showInvoiceNo'))),
    makeBlock('separator', { id: 'separator-1', zone: 'top' }),
    makeBlock('dateTime', {
      visible: on('info', 'showDate') || on('info', 'showTime'),
      showDate: on('info', 'showDate'),
      showTime: on('info', 'showTime')
    }),
    makeBlock('cashier', show(on('info', 'showCashier'))),
    makeBlock('paymentType', show(on('info', 'showPaymentType'))),
    makeBlock('customer', {
      visible: on('info', 'showCustomer') || on('info', 'showCustomerAddress'),
      showName: on('info', 'showCustomer'),
      showPhone: on('info', 'showCustomer') && on('info', 'showCustomerPhone'),
      showAddress: on('info', 'showCustomerAddress')
    }),
    makeBlock('separator', { id: 'separator-2' }),
    makeBlock('items', {
      showUnitPrice: on('items', 'showUnitPrice'),
      showBarcode: on('items', 'showBarcode')
    }),
    makeBlock('separator', { id: 'separator-3' }),
    makeBlock('itemCount', show(on('totals', 'showItemCount'))),
    makeBlock('subtotal', show(on('totals', 'showSubtotal'))),
    makeBlock('total', { bold: on('totals', 'boldTotal') }),
    makeBlock('discount', show(on('totals', 'showDiscount'))),
    makeBlock('paid', show(on('totals', 'showPaid'))),
    makeBlock('change', show(on('totals', 'showChange'))),
    makeBlock('separator', { id: 'separator-4' }),
    ...texts(footer, 'bottom', 'f'),
    makeBlock('storeNameFooter', show(on('footer', 'showStoreName')))
  ]
}

/**
 * Validate and normalise a template (either version). Unknown keys and block types are dropped,
 * missing values take defaults, blocks are ordered top → middle → bottom (keeping their order
 * inside a zone). Returns { ok, errors, value } where value is a version-2 template.
 */
export function normalizeTemplate(input) {
  const errors = []
  const src = input && typeof input === 'object' ? structuredClone(input) : {}
  const paper = has(PAPERS, src.paper) ? src.paper : '80mm'
  if (src.paper && !has(PAPERS, src.paper)) errors.push('مقاس الورق غير مدعوم.')

  const size = Number(src.style?.fontSize ?? 8)
  if (!(size >= 7 && size <= 11)) errors.push('حجم الخط يجب أن يكون بين 7 و 11.')
  const style = {
    fontSize: Math.min(11, Math.max(7, Math.round(size) || 8)),
    separator: has(SEPARATORS, src.style?.separator) ? src.style.separator : 'dashed'
  }
  const labels = { ...DEFAULT_LABELS }
  for (const k of Object.keys(DEFAULT_LABELS)) {
    if (src.labels && typeof src.labels[k] === 'string') {
      // Kept as typed (spaces included) so the designer can edit it; trimmed where it is printed.
      const v = sanitize(src.labels[k], 30)
      if (!v.trim()) errors.push(`التسمية "${DEFAULT_LABELS[k]}" لا يمكن أن تكون فارغة.`)
      else labels[k] = v
    }
  }

  const rawBlocks = Array.isArray(src.blocks) ? src.blocks : fromVersion1(src, errors)
  const blocks = []
  const seen = new Set()
  const ids = new Set()
  const counts = {}
  for (const raw of rawBlocks.slice(0, 100)) {
    const meta = raw && has(BLOCK_TYPES, raw.type) && BLOCK_TYPES[raw.type]
    if (!meta) continue
    if (meta.max) {
      counts[raw.type] = (counts[raw.type] || 0) + 1
      if (counts[raw.type] === meta.max + 1)
        errors.push(`الحد الأقصى ${meta.max} من عنصر "${meta.label}".`)
      if (counts[raw.type] > meta.max) continue
    } else if (seen.has(raw.type)) continue
    seen.add(raw.type)
    const b = makeBlock(raw.type, raw)
    if (meta.max) {
      let n = 1
      while (ids.has(b.id)) b.id = `${raw.type}-${n++}`
    }
    ids.add(b.id)
    blocks.push(b)
  }
  // Every single-use element exists (hidden when it was missing), so the designer can always offer it.
  const hidden = { visible: false }
  for (const [type, meta] of Object.entries(BLOCK_TYPES))
    if (!meta.max && !seen.has(type)) blocks.push(makeBlock(type, hidden))
  blocks.sort((a, b) => ZONE_ORDER[a.zone] - ZONE_ORDER[b.zone])

  return { ok: errors.length === 0, errors, value: { version: 2, paper, style, labels, blocks } }
}

// Zero-width and bidirectional control characters (U+200B–U+200F, U+202A–U+202E, U+FEFF) take no column.
const INVISIBLE = new RegExp(
  `[${[
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0xfeff, 0xfeff]
  ]
    .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`)
    .join('')}]`,
  'g'
)
const displayLen = (s) => String(s).replace(INVISIBLE, '').length
const fixed2 = (n) => (Number(n) || 0).toFixed(2)

function lrPad(width, l, r) {
  const left = String(l || '')
  const right = String(r || '')
  return left + ' '.repeat(Math.max(1, width - displayLen(left) - displayLen(right))) + right
}

/** Tags for a one-line block. Centre + bold is the legacy "[C]" so default receipts print as before. */
function lineTags(b) {
  let t
  if (b.align === 'center') t = b.bold ? '[C]' : '[C][N]'
  else if (b.align === 'left') t = b.bold ? '[L][B]' : '[L]'
  else t = b.bold ? '[R][B]' : '[R]'
  return b.size === 'large' ? `${t}[BIG]` : t
}

/** Label/value of a totals block, or null when it has nothing to show for this sale. */
function pairValue(type, d, cur) {
  switch (type) {
    case 'itemCount':
      return String((d.items || []).length)
    case 'subtotal':
      return d.subTotal === undefined ? null : `${fixed2(d.subTotal)} ${cur}`
    case 'total':
      return `${fixed2(d.total)} ${cur}`
    case 'discount':
      return Number(d.discount) > 0 ? `- ${fixed2(d.discount)} ${cur}` : null
    case 'paid':
      return `${fixed2(d.paid)} ${cur}`
    case 'change':
      return `${fixed2(d.change)} ${cur}`
    default:
      return null
  }
}

/** Text of a one-line block for this sale and store, or '' when there is nothing to print. */
function lineText(b, d, store, L) {
  switch (b.type) {
    case 'storeName':
      return cleanText(store.name, 80)
    case 'branch':
      return cleanText(store.branch, 80)
    case 'storeAddress':
      return cleanText(store.address, 80)
    case 'storePhone':
      return store.phone ? `${L.phone}: ${cleanText(store.phone, 30)}` : ''
    case 'title':
      return L.title
    case 'banner':
      return cleanText(d.banner)
    case 'invoiceNo':
      return `${L.invoiceNo} : ${cleanText(d.saleId ?? '—', 20)}`
    case 'cashier':
      return d.cashier ? `${L.cashier}: ${cleanText(d.cashier, 40)}` : ''
    case 'paymentType':
      return d.paymentType ? `${L.paymentType}: ${cleanText(d.paymentType, 30)}` : ''
    case 'storeNameFooter':
      return store.name ? `- ${cleanText(store.name, 80)} -` : ''
    case 'text':
      return b.text.trim()
    default:
      return ''
  }
}

function customerLines(b, d, L) {
  const c = d.client || {}
  const out = []
  if (b.showName && c.name) out.push(`${L.customer}: ${cleanText(c.name)}`)
  // The phone belongs to the name when both are shown (as before); on its own when the name is hidden.
  if (b.showPhone && c.phone && (c.name || !b.showName))
    out.push(`${L.phone}: ${cleanText(c.phone)}`)
  if (b.showAddress && c.address) out.push(`${L.address}: ${cleanText(c.address)}`)
  return out
}

function dateTimeParts(b, d, L) {
  return {
    date: b.showDate && d.date ? `${L.date}: ${cleanText(d.date, 30)}` : '',
    time: b.showTime && d.time ? `${L.time}: ${cleanText(d.time, 30)}` : ''
  }
}

/**
 * @param {object} tpl   template (either version; normalised here)
 * @param {object} d     { saleId, date, time, cashier, client:{name,phone,address}, items:[{name,barcode,qty,price,total}],
 *                         subTotal, total, discount, paid, change, paymentType, banner }
 * @param {object} store { name, branch, address, phone }
 * @returns {string[]}   lines for print_receipt.ps1
 */
export function buildReceiptLines(tpl, d, store = {}) {
  const t = normalizeTemplate(tpl).value
  const L = Object.fromEntries(Object.entries(t.labels).map(([k, v]) => [k, v.trim()]))
  const W = PAPERS[t.paper].width
  const sepChar = SEPARATORS[t.style.separator]
  const sep = sepChar ? sepChar.repeat(W) : null
  const lines = []
  const push = (...xs) => lines.push(...xs.filter((x) => x !== null && x !== undefined))

  for (const b of t.blocks) {
    if (!b.visible) continue
    const kind = BLOCK_TYPES[b.type].kind
    if (kind === 'logo') {
      const align = { right: '[R]', center: '[C]', left: '[L]' }[b.align]
      push(`[LOGO]${align}${{ small: '[SMALL]', large: '[BIG]' }[b.size] || ''}`)
    } else if (kind === 'rule') {
      push(sep)
    } else if (kind === 'table') {
      push(`${L.item}|${L.qty}|${b.showUnitPrice ? L.price : ''}|${L.lineTotal}`)
      push(sep, sep)
      for (const it of d.items || []) {
        const name =
          cleanText(it.name, 80) +
          (b.showBarcode && it.barcode ? ` (${cleanText(it.barcode, 20)})` : '')
        push(
          `${name}|${cleanText(it.qty, 24)}|${b.showUnitPrice ? fixed2(it.price) : ''}|${fixed2(it.total)}`
        )
      }
    } else if (kind === 'pair') {
      const value = pairValue(b.type, d, L.currency)
      if (value === null) continue
      if (b.align === 'spread') {
        push(`${b.bold ? '[B]' : ''}${b.size === 'large' ? '[BIG]' : ''}${L[b.type]}|${value}`)
      } else push(`${lineTags(b)}${L[b.type]}: ${value}`)
    } else if (kind === 'box') {
      const parts = customerLines(b, d, L)
      if (!parts.length) continue
      const tags =
        ({ right: '[R]', left: '[L]' }[b.align] || '') +
        (b.bold ? '' : '[N]') +
        (b.size === 'large' ? '[BIG]' : '')
      push(`[BOX]${tags}${parts.join(' ~ ')}`)
    } else if (b.type === 'dateTime') {
      const { date, time } = dateTimeParts(b, d, L)
      if (!date && !time) continue
      if (b.align === 'spread') {
        // Legacy layout: time and date at the two ends of one line; a single value is right-aligned.
        if (date && time) {
          // Large type (font + 4) fits fewer characters on the line: pad to the narrower width.
          const width =
            b.size === 'large' ? Math.floor((W * t.style.fontSize) / (t.style.fontSize + 4)) : W
          if (b.size === 'large' && displayLen(time) + displayLen(date) + 1 > width) {
            // Large type that does not fit one line: date and time on two right-aligned lines.
            // (Normal size keeps the legacy single line, as earlier receipts printed it.)
            const tags = lineTags({ ...b, align: 'right' })
            push(`${tags}${date}`, `${tags}${time}`)
          } else
            push(
              `${b.bold ? '[B]' : ''}${b.size === 'large' ? '[BIG]' : ''}${lrPad(width, time, date)}`
            )
        } else push(`${lineTags({ ...b, align: 'right' })}${date || time}`)
      } else push(`${lineTags(b)}${[date, time].filter(Boolean).join('   ')}`)
    } else {
      const text = lineText(b, d, store, L)
      if (text || b.type === 'text') push(`${lineTags(b)}${text}`)
    }
  }
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
  const L = Object.fromEntries(Object.entries(t.labels).map(([k, v]) => [k, v.trim()]))
  const out = []
  let pairs = [] // consecutive label/value rows share one totals box
  const flush = () => {
    if (pairs.length) out.push(`<div class="totals">${pairs.join('')}</div>`)
    pairs = []
  }
  const cls = (b, ...extra) =>
    [`a-${b.align || 'right'}`, b.bold && 'strong', b.size === 'large' && 'large', ...extra]
      .filter(Boolean)
      .join(' ')

  for (const b of t.blocks) {
    if (!b.visible) continue
    const kind = BLOCK_TYPES[b.type].kind
    if (kind === 'pair') {
      const value = pairValue(b.type, d, L.currency)
      if (value === null) continue
      if (b.align === 'spread') {
        pairs.push(
          `<div class="${[b.bold && 'strong', b.size === 'large' && 'large'].filter(Boolean).join(' ')}"><span>${esc(L[b.type])}</span><span>${esc(value)}</span></div>`
        )
      } else {
        flush()
        out.push(`<p class="${cls(b)}">${esc(L[b.type])}: ${esc(value)}</p>`)
      }
      continue
    }
    flush()
    if (kind === 'logo') {
      if (logoDataUrl)
        out.push(
          `<div class="${cls(b)}"><img class="logo logo-${b.size}" src="${esc(logoDataUrl)}" alt=""></div>`
        )
    } else if (kind === 'rule') {
      if (t.style.separator !== 'none') out.push(`<hr class="sep-${t.style.separator}">`)
    } else if (kind === 'table') {
      const rows = (d.items || [])
        .map(
          (it, i) =>
            `<tr><td class="n">${i + 1}</td><td>${esc(it.name)}${b.showBarcode && it.barcode ? `<div class="bc">${esc(it.barcode)}</div>` : ''}</td><td class="num">${esc(it.qty)}</td>${b.showUnitPrice ? `<td class="num">${fixed2(it.price)}</td>` : ''}<td class="num">${fixed2(it.total)}</td></tr>`
        )
        .join('')
      out.push(
        `<table><thead><tr><th class="n">#</th><th>${esc(L.item)}</th><th class="num">${esc(L.qty)}</th>${b.showUnitPrice ? `<th class="num">${esc(L.price)}</th>` : ''}<th class="num">${esc(L.lineTotal)}</th></tr></thead><tbody>${rows}</tbody></table>`
      )
    } else if (kind === 'box') {
      const parts = customerLines(b, d, L)
      if (parts.length)
        out.push(
          `<div class="box ${cls(b)}">${parts.map((p) => `<div>${esc(p)}</div>`).join('')}</div>`
        )
    } else if (b.type === 'dateTime') {
      const { date, time } = dateTimeParts(b, d, L)
      if (!date && !time) continue
      if (b.align === 'spread' && date && time)
        out.push(
          `<div class="spread ${cls(b)}"><span>${esc(date)}</span><span>${esc(time)}</span></div>`
        )
      else
        out.push(
          `<p class="${cls(b.align === 'spread' ? { ...b, align: 'right' } : b)}">${esc([date, time].filter(Boolean).join('   '))}</p>`
        )
    } else {
      const text = lineText(b, d, store, L)
      if (!text && b.type !== 'text') continue
      const tag = b.type === 'storeName' ? 'h1' : b.type === 'title' ? 'h2' : 'p'
      out.push(`<${tag} class="${cls(b)}">${esc(text) || '&nbsp;'}</${tag}>`)
    }
  }
  flush()

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(L.title)} ${esc(d.saleId)}</title>
<style>
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #111; margin: 0; font-size: ${t.style.fontSize + 3}pt; }
p, h1, h2 { margin: 3px 0; }
h1 { font-size: 20pt; color: #153B32; }
h2 { font-size: 15pt; margin: 10px 0 6px; }
.a-right { text-align: right; } .a-center { text-align: center; } .a-left { text-align: left; }
.strong { font-weight: 700; } .large { font-size: 1.35em; }
h1.large { font-size: 26pt; } h2.large { font-size: 19pt; }
.logo { display: inline-block; } .logo-small { max-height: 40px; } .logo-medium { max-height: 64px; } .logo-large { max-height: 100px; }
.box { border: 1px solid #555; border-radius: 4px; padding: 6px 10px; margin: 8px 0; }
.spread { display: flex; justify-content: space-between; gap: 16px; margin: 4px 0; }
hr { border: 0; margin: 10px 0; } hr.sep-dashed { border-top: 1px dashed #999; }
hr.sep-double { border-top: 3px double #999; } hr.sep-dotted { border-top: 2px dotted #999; }
table { width: 100%; border-collapse: collapse; margin: 6px 0; }
th, td { padding: 7px 8px; border-bottom: 1px solid #ddd; text-align: right; }
th { background: #EEF3EF; font-weight: 700; }
td.num, th.num { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.n { width: 32px; color: #777; }
.bc { font-size: 8pt; color: #777; direction: ltr; text-align: right; }
.totals { margin-inline-start: auto; width: 46%; margin-top: 8px; }
.totals div { display: flex; justify-content: space-between; padding: 4px 0; }
.totals .strong { font-weight: 800; border-top: 2px solid #153B32; margin-top: 4px; padding-top: 6px; }
</style></head><body>
${out.join('\n')}
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
