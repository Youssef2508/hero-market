// The automatic midnight backup on the installed store PC (BACKUP-01, D-060). The Windows Task
// Scheduler starts "HeroMarket-POS.exe --scheduled-backup" every night at 00:00 as the system
// account (taskXml in backupJob.js), with or without anyone signed in; a missed midnight is made up
// once at the next start of the PC. No window opens; the till may be open meanwhile.
//
// The copy goes to %ProgramData%\HeroMarket\backups\scheduled: written by the system account and
// administrators only, read-only for Windows users (so the owner can restore one or copy it to a
// USB stick, and nobody can change or delete a copy). Its log is logs\backup.log and its last result
// logs\backup-status.json (no passwords, no customer data).
import { app } from 'electron'
import { createRequire } from 'module'
import { join } from 'path'
import fs from 'fs'
import os from 'os'
import pg from 'pg'
import { storeDir } from './userDataPath'
import { readConfig } from './backend'
import { runBackup, taskXml } from './backupJob'
import { systemTool } from './winTools'
import { execFile } from 'child_process'

export const TASK_NAME = 'HeroMarket\\HeroMarket Backup'
const SID = { system: '*S-1-5-18', admins: '*S-1-5-32-544', users: '*S-1-5-32-545' }

const nodeRequire = createRequire(import.meta.url)
const server = (rel) => nodeRequire(join(app.getAppPath(), 'src', 'server', rel))

export const scheduledDir = () => join(storeDir(), 'backups', 'scheduled')

function exec(cmd, args) {
  return new Promise((resolve) =>
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, output: `${stdout || ''}${stderr || ''}` })
    )
  )
}

function backupLog(line) {
  try {
    const logs = join(storeDir(), 'logs')
    fs.mkdirSync(logs, { recursive: true })
    fs.appendFileSync(join(logs, 'backup.log'), `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    /* the log is informational */
  }
}

/** One scheduled run. Exit code: 0 done or skipped, 1 failed (the reason is in backup.log). */
export async function runScheduledBackup() {
  const cfg = readConfig()
  const local = cfg && cfg.mode === 'local' ? cfg.local : null
  if (!local || !local.port || !local.user) {
    backupLog('backup: FAILED this PC has no local store (nothing to back up)')
    return 1
  }
  const { exportSnapshot } = server(join('modules', 'backup.js'))
  const { listMigrations } = server(join('db', 'migrate.js'))
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port: local.port,
    user: local.user,
    password: local.password,
    database: 'heromarket',
    max: 1,
    connectionTimeoutMillis: 20000
  })
  try {
    const status = await runBackup({
      dir: scheduledDir(),
      exportData: () => exportSnapshot(pool),
      schema: listMigrations().map((m) => m.version),
      statusFile: join(storeDir(), 'logs', 'backup-status.json'),
      log: backupLog
    })
    if (status.result === 'skipped') backupLog(`backup: skipped (${status.reason})`)
    return status.result === 'failed' ? 1 : 0
  } finally {
    await pool.end().catch(() => {})
  }
}

/**
 * Installer step (elevated): the locked backup folder and the nightly task. The task runs the
 * installed program, so an update keeps it pointing at the right file.
 */
export async function registerBackupTask({ log = () => {} } = {}) {
  const dir = scheduledDir()
  fs.mkdirSync(dir, { recursive: true })
  const icacls = systemTool('icacls.exe')
  const acl = await exec(icacls, [
    dir,
    '/inheritance:r',
    '/grant:r',
    `${SID.system}:(OI)(CI)F`,
    `${SID.admins}:(OI)(CI)F`,
    `${SID.users}:(OI)(CI)RX`
  ])
  if (acl.code !== 0) throw new Error(`backup folder permissions: ${acl.output.trim()}`)
  const xmlFile = join(os.tmpdir(), `heromarket-backup-task-${process.pid}.xml`)
  // Task Scheduler reads UTF-16 with its byte-order mark.
  fs.writeFileSync(
    xmlFile,
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(taskXml(process.execPath), 'utf16le')])
  )
  try {
    const r = await exec(systemTool('schtasks.exe'), [
      '/Create',
      '/TN',
      TASK_NAME,
      '/XML',
      xmlFile,
      '/F'
    ])
    if (r.code !== 0) throw new Error(`scheduled backup task: ${r.output.trim()}`)
    log('nightly backup task registered:', TASK_NAME)
  } finally {
    fs.rmSync(xmlFile, { force: true })
  }
}

/** Uninstall: the task goes; the copies stay (they are the store's data). */
export async function removeBackupTask() {
  await exec(systemTool('schtasks.exe'), ['/Delete', '/TN', TASK_NAME, '/F'])
}
