import './userDataPath'
import { app, shell, BrowserWindow, ipcMain, nativeTheme, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  startBackend,
  stopBackend,
  callOperation,
  waitForStatus as backendStatus,
  writeConfig,
  clearSession,
  resetPasswordOnThisPc
} from './backend'
import { getPrintSettings } from './printSettings'
import fs from 'fs'
import { initializePrinter, registerSalePrinting } from './printer'
import { registerDataIpc } from './dataIpc'

// Silence logs and redirect warnings/errors to log file in production with 24-hour cleanup
if (app.isPackaged) {
  const logPath = join(app.getPath('userData'), 'app.log')

  if (fs.existsSync(logPath)) {
    try {
      const stats = fs.statSync(logPath)
      const now = new Date()
      const timeDiff = now.getTime() - stats.mtime.getTime()
      if (timeDiff > 24 * 60 * 60 * 1000) {
        fs.writeFileSync(
          logPath,
          `[LOG ENGINE] [${new Date().toISOString()}] Log file reset (exceeded 24 hours).\n`,
          'utf8'
        )
      }
    } catch (_) {}
  }

  const logStream = fs.createWriteStream(logPath, { flags: 'a' })

  console.log = (...args) => {
    logStream.write(
      `[INFO] [${new Date().toISOString()}] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}\n`
    )
  }
  console.info = (...args) => {
    logStream.write(
      `[INFO] [${new Date().toISOString()}] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}\n`
    )
  }
  console.warn = (...args) => {
    logStream.write(
      `[WARN] [${new Date().toISOString()}] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}\n`
    )
  }
  console.error = (...args) => {
    logStream.write(
      `[ERROR] [${new Date().toISOString()}] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}\n`
    )
  }
}

// Local password reset: "HeroMarket-POS.exe" --reset-password=<username> (see src/server/auth/reset.js).
const RESET_ARG = '--reset-password='
const resetUser = process.argv.find((a) => a.startsWith(RESET_ARG))?.slice(RESET_ARG.length)

// One instance per PC: a second copy would share – and on quit stop – the local database.
if (!app.requestSingleInstanceLock()) {
  if (resetUser)
    app.whenReady().then(() => {
      dialog.showErrorBox(
        'إعادة تعيين كلمة المرور',
        'أغلق برنامج HeroMarket أولاً، ثم أعد تشغيل أمر إعادة تعيين كلمة المرور.'
      )
      app.exit(1)
    })
  else app.exit(0)
}

async function runPasswordReset(username) {
  let code = 0
  try {
    const r = await resetPasswordOnThisPc(username)
    await dialog.showMessageBox({
      type: 'info',
      title: 'إعادة تعيين كلمة المرور',
      message: `كلمة المرور المؤقتة للمستخدم "${r.username}":\n\n${r.temporaryPassword}\n\nاكتبها الآن، فلن تظهر مرة أخرى. يجب تغييرها عند أول تسجيل دخول.`,
      buttons: ['تم']
    })
  } catch (e) {
    code = 1
    const msg =
      e.code === 'unknown_user'
        ? `لا يوجد مستخدم بالاسم "${username}".`
        : e.message === 'client_mode'
          ? 'هذا الجهاز متصل بخادم متجر؛ أعد تعيين كلمة المرور على الخادم.'
          : `تعذرت إعادة تعيين كلمة المرور: ${e.message}`
    dialog.showErrorBox('إعادة تعيين كلمة المرور', msg)
  } finally {
    await stopBackend().catch(() => {})
    app.exit(code)
  }
}
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'HeroMarket POS',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0D1412' : '#F4F6F3',
    autoHideMenuBar: true,
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Forward renderer console logs (warnings and errors in production)
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (!app.isPackaged || level >= 2) {
      console.log(`[RENDERER CONSOLE] ${message} (at ${sourceId}:${line})`)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })
  // The window only ever shows the bundled app (or the dev server).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed =
      process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL'])
    if (!allowed) event.preventDefault()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.heromarket.pos')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  if (resetUser) {
    runPasswordReset(resetUser)
    return
  }

  // Data service (PostgreSQL via the HeroMarket service) and printer
  registerDataIpc({ callOperation, backendStatus, startBackend, writeConfig, clearSession })
  initializePrinter({ callOperation })
  registerSalePrinting({ callOperation })

  // IPC Typst shortages PDF Generator
  ipcMain.handle('generate-shortages-pdf', async (event, items) => {
    try {
      const shortagesCount = items ? items.length : 0
      let tableRows = ''
      if (items && items.length > 0) {
        items.forEach((item, index) => {
          const nameClean = String(item.name || '').replace(/[[\]]/g, '') // escape typst brackets
          tableRows += `    [${index + 1}], [${nameClean}], [${item.stock_qty || 0}], [${item.min_limit || 0}],\n`
        })
      }

      const todayStr = new Date().toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })

      const typstTemplate = `// HeroMarket POS - تقرير نواقص المخزون
#set page(
  width: 80mm,
  height: auto,
  margin: (x: 2mm, top: 5mm, bottom: 5mm)
)

#set text(
  font: ("Cairo", "Amiri", "Segoe UI", "Arial"),
  size: 9pt,
  lang: "ar",
  dir: rtl,
)

#align(center)[
  #text(13pt, weight: "bold")[هيرو ماركت] \\
  #v(2pt)
  #text(10pt, weight: "bold")[تقرير نواقص المخزون] \\
  #text(8pt, fill: rgb("#57606a"))[التاريخ: ${todayStr}]
]

#line(length: 100%, stroke: 0.5pt + rgb("#000000"))
#v(2pt)

#text(8pt)[*تنبيه:* تم رصد عدد (${shortagesCount}) أصناف تحت حد الطلب.]
#v(4pt)

#set table(
  stroke: (x, y) => if y == 0 { 0.8pt + black } else { 0.3pt + rgb("#e1e8ed") },
  inset: (x: 2pt, y: 5pt),
)

#show table.cell.where(y: 0): set text(weight: "bold", size: 8.5pt)

#align(center)[
  #table(
    columns: (18pt, 1fr, 35pt, 35pt),
    align: (center + horizon, right + horizon, center + horizon, center + horizon),
    
    [م], [الصنف], [المخزون], [الحد],
    
${tableRows}  )
]
`

      const tempTypPath = join(app.getPath('temp'), 'heromarket_shortages.typ')
      const pdfOutputPath = join(app.getPath('temp'), 'heromarket_shortages.pdf')
      fs.writeFileSync(tempTypPath, typstTemplate, 'utf8')

      const isDev = !app.isPackaged
      const typstBin = isDev
        ? join(process.cwd(), 'typst.exe')
        : join(process.resourcesPath, 'typst.exe')

      const { exec } = require('child_process')
      return new Promise((resolve, reject) => {
        exec(`"${typstBin}" compile "${tempTypPath}" "${pdfOutputPath}"`, (err) => {
          if (err) {
            console.error('Typst compile error:', err)
            reject(err)
          } else {
            shell.openPath(pdfOutputPath)
            resolve({ success: true, path: pdfOutputPath })
          }
        })
      })
    } catch (e) {
      console.error('Failed to generate shortages PDF:', e)
      throw e
    }
  })

  // IPC Direct Shortages Printer
  ipcMain.handle('print-shortages-to-printer', async (event, items) => {
    const { storeName, branchName, printerName } = await getPrintSettings(callOperation)

    const todayStr = new Date().toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    const timeStr = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })

    const lines = [
      `[C]${storeName}`,
      `[C]${branchName}`,
      `[C]تقرير نواقص المخزون`,
      `------------------------------------------------`,
      `[R]التاريخ: ${todayStr} ~ الوقت: ${timeStr}`,
      `------------------------------------------------`,
      `الصنف|المخزون|حد الطلب| `,
      `------------------------------------------------`,
      ...items.map((item) => {
        const nameClean = String(item.name || '').replace(/[|~]/g, '') // strip delimiters
        return `${nameClean}|${item.stock_qty || 0}|${item.min_limit || 0}| `
      }),
      `------------------------------------------------`,
      `[C]إجمالي عدد النواقص: ${items.length} صنف`,
      '',
      '',
      ''
    ]

    const textContent = lines.join('\r\n')
    console.log('[PRINTER-SHORTAGES] Invoked with items count:', items.length)
    console.log('[PRINTER-SHORTAGES] Text Content built:\n', textContent)

    return new Promise((resolve, reject) => {
      const ts = Date.now()
      const os = require('os')
      const tempTxtPath = join(os.tmpdir(), `shortages_${ts}.txt`)

      try {
        fs.writeFileSync(tempTxtPath, textContent, { encoding: 'utf8' })
        console.log('[PRINTER-SHORTAGES] Text file written:', tempTxtPath)

        const script = app.isPackaged
          ? join(process.resourcesPath, 'print_receipt.ps1')
          : join(__dirname, '../../resources/print_receipt.ps1')
        const cmd = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${script}" -TextFile "${tempTxtPath}" -PrinterName "${printerName}"`
        console.log('[PRINTER-SHORTAGES] Running cmd:', cmd)

        const { exec } = require('child_process')
        exec(cmd, { timeout: 20000 }, (err, stdout, stderr) => {
          console.log('[PRINTER-SHORTAGES] stdout:', stdout ? stdout.trim() : '')
          if (stderr) console.warn('[PRINTER-SHORTAGES] stderr:', stderr.trim())
          try {
            if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath)
          } catch (_) {}
          if (err) {
            console.error('[PRINTER-SHORTAGES] Error:', err.message)
            return reject(err)
          }
          resolve(true)
        })
      } catch (err) {
        console.error('[PRINTER-SHORTAGES] Catch error:', err)
        try {
          if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath)
        } catch (_) {}
        reject(err)
      }
    })
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  startBackend().then((st) => console.log('[backend]', JSON.stringify(st)))
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
// The managed local PostgreSQL is stopped cleanly before the app exits (fast shutdown, no data loss).
let stopped = false
app.on('before-quit', (event) => {
  if (stopped) return
  event.preventDefault()
  stopBackend()
    .catch((e) => console.error('[backend] stop failed:', e.message))
    .finally(() => {
      stopped = true
      app.quit()
    })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
