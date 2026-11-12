// The background synchronisation service on the installed store PC (Phase 2 milestone 4, D-104).
//
// The Windows Task Scheduler starts "HeroMarket-POS.exe --sync-service" as the system account when
// Windows starts – before anyone signs in – and checks every five minutes that it still runs,
// starting it again if it stopped (one copy at a time). No window opens. It runs the HeroMarket
// service against the store's own database, exactly as the desktop program does, and keeps the
// link to the cloud open: it sends the shop's changes, receives the cloud's, and carries out the
// operations users start from the internet. The desktop program may be open or closed; when both
// run, only one holds the link (sync/agent.js holdLink) and the other takes over if it stops.
//
// Its log is logs\sync.log in the store folder (no passwords, no customer data).
import { app } from 'electron'
import { createRequire } from 'module'
import { join } from 'path'
import fs from 'fs'
import os from 'os'
import { execFile } from 'child_process'
import { storeDir } from './userDataPath'
import { readConfig } from './backend'
import { localUrl } from './localDatabase'
import { systemTool } from './winTools'
import { syncTaskXml } from './syncTask'

export const SYNC_TASK_NAME = 'HeroMarket\\HeroMarket Sync'

const nodeRequire = createRequire(import.meta.url)
const server = (rel) => nodeRequire(join(app.getAppPath(), 'src', 'server', rel))

function exec(cmd, args) {
  return new Promise((resolve) =>
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, output: `${stdout || ''}${stderr || ''}` })
    )
  )
}

export function syncLog(line) {
  try {
    const logs = join(storeDir(), 'logs')
    fs.mkdirSync(logs, { recursive: true })
    fs.appendFileSync(join(logs, 'sync.log'), `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    /* the log is informational */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Run until stopped. Waits for the store's database (the PC may have just started), never changes
 * its schema (the installer does, after its verified copy), and exits with a code when it cannot
 * run at all – the task starts it again.
 */
export async function runSyncService() {
  const cfg = readConfig()
  const local = cfg && cfg.mode === 'local' ? cfg.local : null
  // The installed store's own database; in development, the database the program is pointed at.
  const databaseUrl =
    local && local.port && local.user ? localUrl(local) : !app.isPackaged && cfg?.databaseUrl
  if (!databaseUrl) {
    syncLog('sync service: this PC has no local store; nothing to do')
    return 2
  }
  const { createService } = server('app.js')
  let svc = null
  for (let attempt = 1; !svc; attempt++) {
    try {
      const s = await createService({
        databaseUrl,
        secret: cfg.secret,
        logger: { level: 'warn' },
        syncAgent: true,
        agentKind: 'service',
        appVersion: app.getVersion(),
        migrationPolicy: app.isPackaged ? 'refuse' : 'auto'
      })
      await s.prepare()
      await s.app.ready()
      svc = s
    } catch (e) {
      // The database is still starting, or an update has not finished: wait and try again.
      syncLog(`sync service: waiting for the store (${e.code || 'error'}: ${e.message})`)
      if (e.code === 'setup_incomplete' || attempt >= 60) return 3
      await sleep(Math.min(5000 * attempt, 60000))
    }
  }
  syncLog(`sync service: running (version ${app.getVersion()}, process ${process.pid})`)
  await new Promise((resolve) => {
    const stop = () => resolve()
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
    app.once('before-quit', stop)
  })
  await svc.app.close().catch(() => {})
  syncLog('sync service: stopped')
  return 0
}

/** Installer step (elevated): register the task and start it now. */
export async function registerSyncTask({ log = () => {} } = {}) {
  const xmlFile = join(os.tmpdir(), `heromarket-sync-task-${process.pid}.xml`)
  fs.writeFileSync(
    xmlFile,
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(syncTaskXml(process.execPath), 'utf16le')
    ])
  )
  try {
    const r = await exec(systemTool('schtasks.exe'), [
      '/Create',
      '/TN',
      SYNC_TASK_NAME,
      '/XML',
      xmlFile,
      '/F'
    ])
    if (r.code !== 0) throw new Error(`sync service task: ${r.output.trim()}`)
    log('sync service task registered:', SYNC_TASK_NAME)
  } finally {
    fs.rmSync(xmlFile, { force: true })
  }
  const run = await exec(systemTool('schtasks.exe'), ['/Run', '/TN', SYNC_TASK_NAME])
  log(run.code === 0 ? 'sync service started' : `sync service not started: ${run.output.trim()}`)
}

/** Before files are replaced or removed: stop the running copy (the task ends it). */
export async function stopSyncTask() {
  await exec(systemTool('schtasks.exe'), ['/End', '/TN', SYNC_TASK_NAME])
}

/** Uninstall: the task goes; the store's data stays. */
export async function removeSyncTask() {
  await stopSyncTask()
  await exec(systemTool('schtasks.exe'), ['/Delete', '/TN', SYNC_TASK_NAME, '/F'])
}
