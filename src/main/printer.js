import { ipcMain, app, BrowserWindow, dialog } from 'electron'
import { exec } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getPrintSettings } from './printSettings'
import {
  buildReceiptLines,
  buildReceiptHtml,
  normalizeTemplate,
  defaultTemplate
} from '../shared/receipt.mjs'

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

export function initializePrinter({ callOperation }) {
  ipcMain.handle('print-receipt', async (event, htmlContent) => {
    const { storeName, branchName, printerName } = await getPrintSettings(callOperation)

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

// ── Template-driven sale receipts (receipt designer) ─────────────────────────
// The renderer sends structured sale data; the active template for the paper size decides the layout.
// The same buildReceiptLines() feeds the designer's preview, so the preview shows exactly these lines.

function brandLogoPath() {
  return app.isPackaged
    ? join(process.resourcesPath, 'brand-logo.png')
    : join(__dirname, '../../resources/brand/png/heromarket-mark-256.png')
}

function logoFileFor(settings, tpl) {
  if (!tpl.header.showLogo) return ''
  if (settings.logo && settings.logo.startsWith('data:image/png;base64,')) {
    const p = join(tmpdir(), `heromarket_logo_${process.pid}.png`)
    writeFileSync(p, Buffer.from(settings.logo.split(',')[1], 'base64'))
    return p
  }
  return existsSync(brandLogoPath()) ? brandLogoPath() : ''
}

export function runPrintScript(
  lines,
  { printerName, fontSize = 8, paper = '80mm', logoFile = '' }
) {
  return new Promise((resolve, reject) => {
    const txt = join(
      tmpdir(),
      `receipt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`
    )
    try {
      writeFileSync(txt, lines.join('\r\n'), { encoding: 'utf8' })
      const args = [
        `-File "${getScriptPath()}"`,
        `-TextFile "${txt}"`,
        `-PrinterName "${String(printerName).replace(/"/g, '')}"`,
        `-FontSize ${Number(fontSize) || 8}`,
        `-Paper "${paper === '58mm' ? '58mm' : '80mm'}"`,
        `-LogoFile "${String(logoFile || '').replace(/"/g, '')}"`
      ]
      const cmd = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass ${args.join(' ')}`
      exec(cmd, { timeout: 20000 }, (err, stdout) => {
        try {
          if (existsSync(txt)) unlinkSync(txt)
        } catch (_) {}
        if (err) return reject(new Error(`Print failed: ${err.message}`))
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
}

function templateFor(settings, paper) {
  const active = settings.templates?.[paper]
  return normalizeTemplate(active ? active.config : defaultTemplate(paper)).value
}

export function registerSalePrinting({ callOperation }) {
  // Thermal (58/80 mm) printing of a sale with the active template.
  ipcMain.handle('print-sale', async (_event, data, opts = {}) => {
    const settings = await getPrintSettings(callOperation)
    const paper = (opts.paper || settings.paper) === '58mm' ? '58mm' : '80mm'
    const tpl = templateFor(settings, paper)
    const lines = buildReceiptLines(tpl, data, settings.store)
    return runPrintScript(lines, {
      printerName: settings.printerName,
      fontSize: tpl.style.fontSize,
      paper,
      logoFile: logoFileFor(settings, tpl)
    })
  })

  // Test print from the receipt designer (sample data, given template).
  ipcMain.handle('print-template-test', async (_event, config, data) => {
    const settings = await getPrintSettings(callOperation)
    const tpl = normalizeTemplate(config).value
    if (tpl.paper === 'A4') return { success: false, error: 'A4 uses PDF export' }
    const lines = buildReceiptLines(tpl, data, settings.store)
    await runPrintScript(lines, {
      printerName: settings.printerName,
      fontSize: tpl.style.fontSize,
      paper: tpl.paper,
      logoFile: logoFileFor(settings, tpl)
    })
    return { success: true }
  })

  // A4 invoice → PDF file (also used to preview A4 output exactly as printed).
  ipcMain.handle('sale-pdf', async (_event, data, config = null) => {
    const settings = await getPrintSettings(callOperation)
    const tpl = config
      ? normalizeTemplate({ ...config, paper: 'A4' }).value
      : templateFor(settings, 'A4')
    const html = buildReceiptHtml(tpl, data, settings.store, { logoDataUrl: settings.logo || '' })
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, javascript: false }
    })
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true })
      const { filePath } = await dialog.showSaveDialog({
        title: 'حفظ الفاتورة PDF',
        defaultPath: `invoice-${data.saleId || 'preview'}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (!filePath) return { success: false, error: 'User cancelled' }
      writeFileSync(filePath, pdf)
      return { success: true, filePath }
    } finally {
      win.destroy()
    }
  })
}
