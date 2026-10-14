// Legacy HTML-to-text receipt conversion (used for shift and till reports, which are still HTML).
// Pure module: shared by src/main/printer.js and the unit test that proves the default receipt
// template prints the same lines as this converter.

const W = 48

const displayLen = (s) => s.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '').length

const lrPad = (l, r) => {
  const left = String(l || ''),
    right = String(r || '')
  return left + ' '.repeat(Math.max(1, W - displayLen(left) - displayLen(right))) + right
}

function parseItems(html) {
  const items = []
  const trRx = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let m,
    skip = true
  while ((m = trRx.exec(html)) !== null) {
    if (skip && m[1].includes('<th')) {
      skip = false
      continue
    }
    const cells = []
    const tdRx = /<td[^>]*>([\s\S]*?)<\/td>/gi
    let td
    while ((td = tdRx.exec(m[1])) !== null) cells.push(td[1].replace(/<[^>]+>/g, '').trim())
    // Support 3-col (name, qty, total) and 4-col (name, qty, price, total)
    if (cells.length === 4)
      items.push({ name: cells[0], qty: cells[1], price: cells[2], total: cells[3] })
    else if (cells.length === 3)
      items.push({ name: cells[0], qty: cells[1], price: '', total: cells[2] })
  }
  return items
}

function get(html, pat) {
  const m = html.match(pat)
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : ''
}

export function buildReceiptText(html, storeName = 'هيرو ماركت', branchName = 'الفرع الرئيسي') {
  const saleId =
    get(html, /رقم العملية[\s\S]*?#?\s*([\d?]+)/) || get(html, /فاتورة[\s\S]*?#?\s*([\d?]+)/) || '—'
  const date = get(html, /التاريخ:[\s\S]*?(?:<\/b>|:)\s*([^<]+)/)
  const time = get(html, /الوقت:[\s\S]*?(?:<\/b>|:)\s*([^<]+)/)
  const cashier = get(html, /الكاشير:[\s\S]*?(?:<\/b>|:)\s*([^<]+)/)
  const client = get(html, /العميل:[\s\S]*?(?:<\/b>|:)\s*([^<]+)/)
  const phone = get(html, /(?:هاتف العميل|الهاتف):[\s\S]*?(?:<\/b>|:)\s*([^<]+)/)
  const address = get(html, /العنوان:[\s\S]*?(?:<\/b>|:)\s*([^<]+)/)
  const title = get(html, /نوع التقرير:[\s\S]*?(?:<\/b>|:)\s*([^<]+)/) || 'فاتورة بيع'

  const total =
    get(html, /(?:الإجمالي النهائي|الإجمالي):<\/span>\s*<span>([^<]+)/) ||
    get(html, /(?:الإجمالي النهائي|الإجمالي)[\s\S]*?<span>([^<]+)/)
  const disc = get(html, /(?:خصم الفاتورة|الخصم):<\/span>\s*<span>([^<]+)/)
  const paid = get(html, /(?:المبلغ المدفوع|المدفوع):<\/span>\s*<span>([^<]+)/)
  const change = get(html, /الباقي للعميل:<\/span>\s*<span>([^<]+)/)
  const items = parseItems(html)

  // Format date and time on a single line
  let dateTimeLine = ''
  if (date && time) {
    dateTimeLine = lrPad(`الوقت: ${time}`, `التاريخ: ${date}`)
  } else if (date) {
    dateTimeLine = `[R]التاريخ: ${date}`
  }

  const lines = [
    `[C]${storeName}`,
    `[C]${branchName}`,
    `[C]${title}`,
    `[C]رقم العملية : ${saleId}`,
    `------------------------------------------------`,
    ...(dateTimeLine ? [dateTimeLine] : []),
    ...(cashier ? [`[R]الكاشير: ${cashier}`] : []),
    ...(client
      ? [
          `[BOX]العميل: ${client}` +
            (phone ? ` ~ الهاتف: ${phone}` : '') +
            (address ? ` ~ العنوان: ${address}` : '')
        ]
      : address
        ? [`[BOX]العنوان: ${address}`]
        : []),
    `------------------------------------------------`,
    `الصنف|ك|سعر|إجمالي`,
    `------------------------------------------------`,
    `------------------------------------------------`,
    ...items.map((item) => `${item.name}|${item.qty}|${item.price || ''}|${item.total}`),
    `------------------------------------------------`,
    ...(total ? [title.includes('تقرير') ? `الرصيد المتوقع|${total}` : `الإجمالي|${total}`] : []),
    ...(disc
      ? [title.includes('تقرير') ? `إجمالي العمولات|${disc}` : `خصم الفاتورة|- ${disc}`]
      : []),
    ...(paid ? [title.includes('تقرير') ? `صافي الكاش|${paid}` : `المدفوع|${paid}`] : []),
    ...(change
      ? [title.includes('تقرير') ? `الرصيد الافتتاحي|${change}` : `الباقي للعميل|${change}`]
      : []),
    `------------------------------------------------`,
    `[C]شكراً لتسوقكم معنا!`,
    `[C]- ${storeName} -`,
    '',
    ''
  ]

  return lines.join('\r\n')
}
