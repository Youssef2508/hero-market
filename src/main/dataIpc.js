// IPC surface between the renderer and the HeroMarket service. The renderer can only name an
// operation and pass data; there is no SQL channel anymore.
import { ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { describeRoot } from './tlsPin'
import { storeDir } from './userDataPath'

const OP_RE = /^[a-zA-Z]+\.[a-zA-Z]+$/

export function registerDataIpc({
  callOperation,
  backendStatus,
  startBackend,
  writeConfig,
  clearSession
}) {
  ipcMain.handle('api:call', async (_event, op, body) => {
    if (typeof op !== 'string' || !OP_RE.test(op)) {
      return { status: 400, error: { code: 'bad_request', message: 'عملية غير صالحة.' } }
    }
    return callOperation(op, body && typeof body === 'object' ? body : {})
  })

  ipcMain.handle('backend:status', async () => backendStatus())

  // First-run / connection settings screen. Only the mode, addresses and terminal name come from the UI.
  ipcMain.handle('backend:configure', async (_event, cfg) => {
    if (!cfg || typeof cfg !== 'object') return { ready: false, error: 'bad_request' }
    const mode = ['client', 'local'].includes(cfg.mode) ? cfg.mode : 'standalone'
    if (mode === 'standalone' && !/^postgres(ql)?:\/\//i.test(String(cfg.databaseUrl || ''))) {
      return { ready: false, error: 'عنوان قاعدة البيانات يجب أن يبدأ بـ postgres://' }
    }
    if (mode === 'client' && !/^https?:\/\//i.test(String(cfg.serverUrl || ''))) {
      return { ready: false, error: 'عنوان الخادم يجب أن يبدأ بـ http:// أو https://' }
    }
    let serverCaPem
    if (mode === 'client' && cfg.serverCaPem) {
      try {
        describeRoot(cfg.serverCaPem)
        serverCaPem = cfg.serverCaPem
      } catch (e) {
        return { ready: false, error: e.message }
      }
    }
    writeConfig({
      mode,
      databaseUrl: cfg.databaseUrl,
      serverUrl: cfg.serverUrl,
      serverCaPem,
      terminalName: cfg.terminalName
    })
    clearSession()
    return startBackend()
  })

  // Cashier terminal: choose the store server's root certificate (root.crt from the server, public).
  ipcMain.handle('backend:pickServerCa', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      title: 'شهادة خادم المتجر',
      filters: [{ name: 'Certificate', extensions: ['crt', 'pem', 'cer'] }],
      properties: ['openFile']
    })
    if (!filePaths || !filePaths.length) return null
    try {
      const pem = fs.readFileSync(filePaths[0], 'utf8')
      return { pem, ...describeRoot(pem) }
    } catch (e) {
      return { error: e.message.includes('CA') ? e.message : 'الملف المختار ليس شهادة صالحة.' }
    }
  })

  ipcMain.handle('backup:save', async () => {
    const res = await callOperation('backup.export', {})
    if (res.error) return { success: false, error: res.error.message }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const { filePath } = await dialog.showSaveDialog({
      title: 'حفظ نسخة احتياطية من قاعدة البيانات',
      defaultPath: `heromarket-backup-${stamp}.json`,
      filters: [{ name: 'HeroMarket backup', extensions: ['json'] }]
    })
    if (!filePath) return { success: false, error: 'User cancelled' }
    fs.writeFileSync(filePath, JSON.stringify(res.data))
    return { success: true, filePath }
  })

  ipcMain.handle('backup:restore', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      title: 'استعادة نسخة احتياطية',
      filters: [{ name: 'HeroMarket backup', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (!filePaths || !filePaths.length) return { success: false, error: 'User cancelled' }
    let backup
    try {
      backup = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'))
    } catch {
      return { success: false, error: 'الملف المختار ليس نسخة احتياطية صالحة.' }
    }
    // Safety copy of the current data before anything is replaced (G-14).
    const safety = await callOperation('backup.export', {})
    if (safety.error) return { success: false, error: safety.error.message }
    const dir = join(storeDir(), 'backups')
    fs.mkdirSync(dir, { recursive: true })
    const safetyPath = join(
      dir,
      `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
    )
    fs.writeFileSync(safetyPath, JSON.stringify(safety.data))
    const res = await callOperation('backup.restore', { backup, confirm: 'RESTORE' })
    if (res.error) return { success: false, error: res.error.message, safetyBackup: safetyPath }
    clearSession() // a restore signs everyone out
    return {
      success: true,
      restored: res.data.restored,
      safetyBackup: safetyPath,
      requiresLogin: true
    }
  })
}
