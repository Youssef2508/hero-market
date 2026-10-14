import { ipcMain, app, BrowserWindow, dialog } from 'electron'
import { exec } from 'child_process'
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getPrintSettings } from './printSettings'
import { buildReceiptText } from '../shared/legacyReceiptText.mjs'
import { REPORTS } from '../shared/reportLines.mjs'
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
  if (!tpl.blocks.some((b) => b.type === 'logo' && b.visible)) return ''
  if (settings.logo && settings.logo.startsWith('data:image/png;base64,')) {
    const p = join(tmpdir(), `heromarket_logo_${process.pid}.png`)
    writeFileSync(p, Buffer.from(settings.logo.split(',')[1], 'base64'))
    return p
  }
  return existsSync(brandLogoPath()) ? brandLogoPath() : ''
}

export function runPrintScript(
  lines,
  { printerName, fontSize = 8, paper = '80mm', logoFile = '', templateLayout = false }
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
        `-LogoFile "${String(logoFile || '').replace(/"/g, '')}"`,
        ...(templateLayout ? ['-TemplateLayout'] : [])
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
  // Shift-close, Momkn and wallets reports, laid out in the printer's line language (K-32).
  ipcMain.handle('print-report', async (_event, kind, data) => {
    const build = Object.hasOwn(REPORTS, kind) ? REPORTS[kind] : null
    if (!build || !data || typeof data !== 'object') throw new Error('Unknown report')
    const settings = await getPrintSettings(callOperation)
    const paper = settings.paper === '58mm' ? '58mm' : '80mm'
    const printedAt = new Date().toLocaleString('en-GB', { hour12: false })
    const lines = build(data, { store: settings.store, paper, printedAt })
    return runPrintScript(lines, {
      printerName: settings.printerName,
      fontSize: 8,
      paper,
      templateLayout: true
    })
  })

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
      logoFile: logoFileFor(settings, tpl),
      templateLayout: true
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
      logoFile: logoFileFor(settings, tpl),
      templateLayout: true
    })
    return { success: true }
  })

  // A4 invoice → PDF file (also used to preview A4 output exactly as printed).
  ipcMain.handle('sale-pdf', async (_event, data, config = null) => {
    const settings = await getPrintSettings(callOperation)
    const tpl = config
      ? normalizeTemplate({ ...config, paper: 'A4' }).value
      : templateFor(settings, 'A4')
    // Same logo as the thermal receipt: the store's own, otherwise the HeroMarket mark.
    const brand = existsSync(brandLogoPath())
      ? `data:image/png;base64,${readFileSync(brandLogoPath()).toString('base64')}`
      : ''
    const html = buildReceiptHtml(tpl, data, settings.store, {
      logoDataUrl: settings.logo || brand
    })
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
