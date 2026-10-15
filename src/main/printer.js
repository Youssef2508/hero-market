import { ipcMain, app } from 'electron'
import { exec } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { executeSql } from './db'

// ─────────────────────────────────────────────────────────────
// Thermal Printer Bridge
// Writes UTF-8 text file → PowerShell PrintDocument (GDI)
// GDI handles Arabic Unicode natively, minimal margins
// CT-S300: 80mm paper, ~42 chars/line
// ─────────────────────────────────────────────────────────────

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

function buildReceiptText(html, storeName = 'هيرو ماركت', branchName = 'الفرع الرئيسي') {
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

function getScriptPath() {
  return app.isPackaged
    ? join(process.resourcesPath, 'print_receipt.ps1')
    : join(__dirname, '../../resources/print_receipt.ps1')
}

export function initializePrinter() {
  ipcMain.handle('print-receipt', async (event, htmlContent) => {
    let storeName = 'هيرو ماركت'
    let branchName = 'الفرع الرئيسي'
    let printerName = 'CITIZEN CT-S300'
    try {
      const dbSettings = await executeSql(
        "SELECT key, value FROM settings WHERE key IN ('store_name', 'branch_name', 'printer_name');"
      )
      if (Array.isArray(dbSettings)) {
        const storeSetting = dbSettings.find((s) => s.key === 'store_name')
        const branchSetting = dbSettings.find((s) => s.key === 'branch_name')
        const printerSetting = dbSettings.find((s) => s.key === 'printer_name')
        if (storeSetting) storeName = storeSetting.value
        if (branchSetting) branchName = branchSetting.value
        if (printerSetting) printerName = printerSetting.value
      }
    } catch (err) {
      console.error('[PRINTER] Failed to fetch settings from DB:', err)
    }

    return new Promise((resolve, reject) => {
      const ts = Date.now()
      const txt = join(tmpdir(), `receipt_${ts}.txt`)

      try {
        const text = buildReceiptText(htmlContent, storeName, branchName)
        writeFileSync(txt, text, { encoding: 'utf8' })
        console.log('[PRINTER] Text file written:', txt)

        const script = getScriptPath()
        const cmd = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${script}" -TextFile "${txt}" -PrinterName "${printerName}"`
        console.log('[PRINTER] Running:', cmd)

        exec(cmd, { timeout: 20000 }, (err, stdout, stderr) => {
          try {
            if (existsSync(txt)) unlinkSync(txt)
          } catch (_) {}

          if (err) {
            console.error('[PRINTER] Error:', err.message)
            return reject(new Error(`Print failed: ${err.message}`))
          }
          console.log('[PRINTER]', stdout.trim())
          if (stderr) console.warn('[PRINTER] stderr:', stderr.trim())

          stdout.includes('PRINT_DONE')
            ? resolve(true)
            : reject(new Error('Not confirmed: ' + stdout))
        })
      } catch (err) {
        try {
          if (existsSync(txt)) unlinkSync(txt)
        } catch (_) {}
        reject(err)
      }
    })
  })
}
