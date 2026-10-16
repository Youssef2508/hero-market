import { ensureStoreDir } from './userDataPath'
import { setupService, stopServiceOnly, removeService, restorePreInstall } from './serviceSetup'
import { openLogFile } from './logFile'
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
import { initializePrinter, registerSalePrinting, runPrintScript } from './printer'
import { registerDataIpc } from './dataIpc'

// Production: warnings and errors go to a log file (started afresh after a day). The installer's
// steps log to logs/setup.log only, so the administrator never creates the program's app.log.
const SERVICE_STEP_ARGS = [
  '--setup-service',
  '--stop-service',
  '--remove-service',
  '--restore-pre-install'
]
if (app.isPackaged) {
  const logs = join(ensureStoreDir(), 'logs')
  const installerStep = SERVICE_STEP_ARGS.some((a) =>
    process.argv.some((x) => x === a || x.startsWith(`${a}=`))
  )
  const log = openLogFile(
    installerStep
      ? [join(logs, 'setup.log')]
      : [join(logs, 'app.log'), join(app.getPath('userData'), 'logs', 'app.log')]
  )
  // Errors keep their message and stack (JSON.stringify(new Error()) is "{}", which hid the reason
  // of a failed print in the 1.4.0 release checks).
  const logText = (a) => {
    if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`
    if (a && typeof a === 'object') {
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    }
    return a
  }
  const writer =
    (level) =>
    (...args) =>
      log.write(`[${level}] [${new Date().toISOString()}] ${args.map(logText).join(' ')}
`)
  console.log = writer('INFO')
  console.info = writer('INFO')
  console.warn = writer('WARN')
  console.error = writer('ERROR')
}

// Local password reset: "HeroMarket-POS.exe" --reset-password=<username> (see src/server/auth/reset.js).
const RESET_ARG = '--reset-password='
const resetUser = process.argv.find((a) => a.startsWith(RESET_ARG))?.slice(RESET_ARG.length)

// Installer steps (run elevated by the per-machine installer, no window): set up, stop or remove the
// store's database service (serviceSetup.js). Exit code 0 = done; the reason is in logs/setup.log.
// Support (elevated): --restore-pre-install[=<copy>] puts back a verified copy taken before an
// installation or update (.docs/UPDATE_GUIDE.md, recovery).
const RESTORE_ARG = process.argv.find(
  (a) => a === '--restore-pre-install' || a.startsWith('--restore-pre-install=')
)
const SERVICE_STEPS = {
  '--setup-service': setupService,
  '--stop-service': stopServiceOnly,
  '--remove-service': removeService,
  '--restore-pre-install': () => restorePreInstall(RESTORE_ARG && RESTORE_ARG.split('=')[1])
}
const serviceStep = RESTORE_ARG
  ? '--restore-pre-install'
  : Object.keys(SERVICE_STEPS).find((a) => process.argv.includes(a))
if (serviceStep) {
  app.whenReady().then(async () => {
    try {
      await SERVICE_STEPS[serviceStep]()
      app.exit(0)
    } catch (e) {
      console.error(`[setup] ${serviceStep} failed:`, e.message)
      try {
        fs.appendFileSync(
          join(ensureStoreDir(), 'logs', 'setup.log'),
          `[${new Date().toISOString()}] FAILED ${serviceStep}: ${e.stack || e.message}
`
        )
      } catch {
        /* nothing more to do */
      }
      app.exit(1)
    }
  })
}

// One instance per PC: a second copy would share – and on quit stop – the local database.
if (!serviceStep && !app.requestSingleInstanceLock()) {
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
      // Sandboxed renderer: the page and its preload get no Node.js access (audit 1.4.0).
      sandbox: true,
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
  if (serviceStep) return // installer step: no window, no backend
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
          // Names are inserted as Typst string literals, never as markup: a product name cannot
          // run Typst code such as #read() (audit 1.4.0).
          const name = String(item.name || '')
            .replace(/[\r\n]+/g, ' ')
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
          const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
          tableRows += `    [${index + 1}], [#"${name}"], [${num(item.stock_qty)}], [${num(item.min_limit)}],\n`
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

      const { execFile } = require('child_process')
      return new Promise((resolve, reject) => {
        execFile(
          typstBin,
          ['compile', tempTypPath, pdfOutputPath],
          { windowsHide: true },
          (err) => {
            if (err) {
              console.error('Typst compile error:', err)
              reject(err)
            } else {
              shell.openPath(pdfOutputPath)
              resolve({ success: true, path: pdfOutputPath })
            }
          }
        )
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

    // Through the same no-shell printing path as receipts (audit 1.4.0).
    return runPrintScript(lines, { printerName })
  })

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
