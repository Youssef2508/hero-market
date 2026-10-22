// Automatic midnight backup (owner, 2026-10-21, D-060; BACKUP-01). No Electron imports: tests run
// the whole job against a development database. The program runs it as "--scheduled-backup" from
// the Windows Task Scheduler (taskXml), as the system account, with nobody signed in.
//
// The copy is the program's own backup format (backup.export, restorable from "النسخ الاحتياطي"),
// read in one consistent snapshot (exportSnapshot) and gzip-compressed. PostgreSQL's pg_dump is not
// part of the bundled database, so it is not used.
//
// One run: if today's daily copy already exists and is verified, nothing happens (a catch-up after
// a missed midnight and a second trigger the same day are harmless). Otherwise the copy is written
// to a .partial file, read back completely (format, schema, every table and its row count), its
// SHA-256 written next to it, and only then renamed to its final name (never over an existing
// file). The first good copy of an ISO week is also kept as that week's copy. Pruning keeps the
// newest 14 daily and 8 weekly verified copies and never removes the newest good one.
//
// After a shift close (owner, 2026-10-22, D-074): the same job with { afterClose: true } writes a
// "close" copy every time (no once-a-day check), verified the same way, into the same folder; the
// newest 20 are kept. The till never asks anyone: it starts the on-demand task (closeTaskXml).
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import zlib from 'zlib'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

const KEEP = { daily: 14, weekly: 8, close: 20 }
const EXT = '.json.gz'
const NAME =
  /^HeroMarket-(daily|weekly|close)-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})?\.json\.gz$/
// Tables a good copy must contain (the shop's own records).
const REQUIRED_TABLES = ['products', 'sales', 'sale_items', 'shifts', 'stock_movements', 'users']

const pad = (n) => String(n).padStart(2, '0')

/** "HeroMarket-daily-2026-10-22_0000.json.gz" (local date and time); close copies with seconds. */
function backupName(kind, d) {
  const sec = kind === 'close' ? pad(d.getSeconds()) : ''
  return `HeroMarket-${kind}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${sec}${EXT}`
}

function parseName(file) {
  const m = NAME.exec(file)
  if (!m) return null
  return {
    kind: m[1],
    day: `${m[2]}-${m[3]}-${m[4]}`,
    stamp: `${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}${m[7] || '00'}`
  }
}

const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** ISO 8601 week ("2026-W43") of a local date. */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const year = t.getUTCFullYear()
  const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7)
  return `${year}-W${pad(week)}`
}

const weekOfDay = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return isoWeek(new Date(y, m - 1, d))
}

/** Verified copies in dir, newest first: a known name with its .sha256 next to it. */
function listCopies(dir) {
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  return names
    .map((f) => ({ file: f, ...parseName(f) }))
    .filter((c) => c.kind && names.includes(`${c.file}.sha256`))
    .sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : a.kind < b.kind ? -1 : 1))
}

/** What to do now: a daily copy unless today's exists; a weekly copy unless this week's exists. */
function plan(copies, now) {
  const today = dayOf(now)
  const week = isoWeek(now)
  return {
    daily: !copies.some((c) => c.kind === 'daily' && c.day === today),
    weekly: !copies.some((c) => c.kind === 'weekly' && weekOfDay(c.day) === week)
  }
}

/**
 * Copies to delete: beyond the newest KEEP of each kind. The newest copy of each kind is never in
 * it, so a store always keeps its last good backup.
 */
function prunable(copies, keep = KEEP) {
  const out = []
  for (const kind of ['daily', 'weekly', 'close']) {
    const list = copies.filter((c) => c.kind === kind)
    out.push(...list.slice(Math.max(1, keep[kind])))
  }
  return out
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

/** Write a backup object as gzip-compressed JSON. */
async function writeCopy(file, data) {
  const json = Buffer.from(JSON.stringify(data))
  await pipeline(Readable.from([json]), zlib.createGzip({ level: 6 }), fs.createWriteStream(file))
  return { tables: Object.keys(data.tables), rows: countRows(data) }
}

function countRows(data) {
  return Object.fromEntries(Object.entries(data.tables).map(([t, v]) => [t, v.rows.length]))
}

/** Read a copy back completely; returns the backup object (also used by a restore). */
function readCopy(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'))
}

/**
 * The copy must read back as the program's backup format, of this database's schema, with the
 * shop's tables and exactly the rows that were written.
 */
function verifyCopy(file, { schema, rows }) {
  let data
  try {
    data = readCopy(file)
  } catch (e) {
    return { ok: false, reason: `unreadable: ${e.message}` }
  }
  if (data.format !== 'heromarket-backup' || data.version !== 1 || !data.tables)
    return { ok: false, reason: 'not a HeroMarket backup' }
  if (schema && JSON.stringify(data.schema) !== JSON.stringify(schema))
    return { ok: false, reason: 'schema differs' }
  const missing = REQUIRED_TABLES.filter((t) => !data.tables[t])
  if (missing.length) return { ok: false, reason: `missing tables: ${missing.join(', ')}` }
  if (rows) {
    const got = countRows(data)
    const diff = Object.keys(rows).filter((t) => got[t] !== rows[t])
    if (diff.length) return { ok: false, reason: `row counts differ: ${diff.join(', ')}` }
  }
  return { ok: true }
}

/**
 * Calls fn until it succeeds, for up to timeoutMs. A missed midnight is made up as soon as the PC
 * starts, often before the database service accepts connections: the copy waits for it instead of
 * failing for the day (nothing would retry it).
 */
async function retryUntil(
  fn,
  { timeoutMs = 10 * 60 * 1000, intervalMs = 5000, log = () => {} } = {}
) {
  const until = Date.now() + timeoutMs
  let waited = false
  for (;;) {
    try {
      const r = await fn()
      if (waited) log('backup: the database is available')
      return r
    } catch (e) {
      if (Date.now() + intervalMs > until) throw e
      if (!waited) log(`backup: waiting for the database (${e.message})`)
      waited = true
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
}

/**
 * The backup job. exportData() returns the backup object (exportSnapshot). Returns the run's status
 * (also written to statusFile, keeping the time of the last good run): { result: 'done' |
 * 'skipped' | 'failed', ... }. Never throws.
 */
async function runBackup({
  dir,
  exportData,
  schema,
  now = new Date(),
  statusFile,
  log = () => {},
  afterClose = false,
  lockWaitMs = 20 * 60 * 1000
}) {
  const started = Date.now()
  const status = { at: now.toISOString(), result: 'failed', files: [] }
  const lock = path.join(dir, '.backup.lock')
  let locked = false
  try {
    fs.mkdirSync(dir, { recursive: true })
    // One run at a time. A run that finds another one (a shift closed just before midnight, or a
    // catch-up and the midnight trigger together) waits for it, then decides: giving up would lose
    // that night's copy, since the scheduler counts the run as done. A lock older than six hours
    // is from a run that died.
    const waitUntil = Date.now() + lockWaitMs
    while (!locked) {
      try {
        fs.writeFileSync(lock, String(process.pid), { flag: 'wx' })
        locked = true
      } catch {
        let age = 0
        try {
          age = Date.now() - fs.statSync(lock).mtimeMs
        } catch {
          continue // released in between: try again
        }
        if (age >= 6 * 3600 * 1000) {
          fs.writeFileSync(lock, String(process.pid))
          locked = true
        } else if (Date.now() >= waitUntil) {
          status.result = 'skipped'
          status.reason = 'another backup is running'
          return status
        } else {
          await new Promise((r) => setTimeout(r, Math.min(2000, Math.max(50, lockWaitMs / 20))))
        }
      }
    }
    // Leftovers of an interrupted run are never valid copies.
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.partial')) fs.rmSync(path.join(dir, f))

    // After a close: always one new copy, never the daily or weekly ones.
    const need = afterClose ? { daily: true, weekly: false } : plan(listCopies(dir), now)
    if (!need.daily) {
      status.result = 'skipped'
      status.reason = "today's copy already exists"
      return status
    }
    const name = backupName(afterClose ? 'close' : 'daily', now)
    const final = path.join(dir, name)
    if (fs.existsSync(final)) throw new Error(`${name} already exists; it is never overwritten`)
    const partial = `${final}.partial`
    log(`backup: writing ${name}`)
    const t0 = Date.now()
    const data = await exportData()
    status.exportSeconds = Math.round((Date.now() - t0) / 100) / 10
    const written = await writeCopy(partial, data)
    const check = verifyCopy(partial, { schema, rows: written.rows })
    if (!check.ok) throw new Error(`the new copy did not verify: ${check.reason}`)
    const hash = await sha256(partial)
    fs.renameSync(partial, final)
    fs.writeFileSync(`${final}.sha256`, `${hash}  ${name}\n`)
    status.files.push({ file: name, bytes: fs.statSync(final).size, sha256: hash })
    status.rows = Object.values(written.rows).reduce((a, b) => a + b, 0)
    if (need.weekly) {
      const weeklyName = backupName('weekly', now)
      const weekly = path.join(dir, weeklyName)
      if (!fs.existsSync(weekly)) {
        fs.copyFileSync(final, `${weekly}.partial`)
        if ((await sha256(`${weekly}.partial`)) !== hash) throw new Error('weekly copy differs')
        fs.renameSync(`${weekly}.partial`, weekly)
        fs.writeFileSync(`${weekly}.sha256`, `${hash}  ${weeklyName}\n`)
        status.files.push({ file: weeklyName, bytes: fs.statSync(weekly).size, sha256: hash })
      }
    }
    // Pruning only after the new copy is verified and in place.
    const removed = []
    for (const c of prunable(listCopies(dir))) {
      fs.rmSync(path.join(dir, c.file), { force: true })
      fs.rmSync(path.join(dir, `${c.file}.sha256`), { force: true })
      removed.push(c.file)
    }
    status.removed = removed
    status.result = 'done'
    log(`backup: done ${name} (${status.files[0].bytes} bytes), removed ${removed.length}`)
    return status
  } catch (e) {
    status.result = 'failed'
    status.reason = String(e.message || e)
    log(`backup: FAILED ${status.reason}`)
    // A copy that failed is never left looking like one.
    try {
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.partial')) fs.rmSync(path.join(dir, f))
    } catch {
      /* the folder may not exist */
    }
    return status
  } finally {
    status.seconds = Math.round((Date.now() - started) / 100) / 10
    status.kept = listCopies(dir).map((c) => c.file)
    if (locked) fs.rmSync(lock, { force: true })
    if (statusFile) {
      try {
        let prev = {}
        try {
          prev = JSON.parse(fs.readFileSync(statusFile, 'utf8'))
        } catch {
          /* first run */
        }
        const lastGood = status.result === 'done' ? status.at : prev.lastGood || null
        fs.writeFileSync(statusFile, JSON.stringify({ ...status, lastGood }, null, 2))
      } catch {
        /* the status is informational */
      }
    }
  }
}

/**
 * Task Scheduler definition: every day at 00:00 local time, as the system account (nobody needs to
 * be signed in), one catch-up run as soon as possible after a missed start (StartWhenAvailable),
 * never two at once, stopped if it runs over two hours, also on battery.
 */
function taskXml(exePath, { start = '2026-01-01T00:00:00' } = {}) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>HeroMarket: automatic database backup every night (keeps 14 daily and 8 weekly copies).</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${start}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${esc(exePath)}</Command>
      <Arguments>--scheduled-backup</Arguments>
    </Exec>
  </Actions>
</Task>
`
}

/**
 * The after-close task (D-074): started on demand by the till after each shift close; no schedule.
 * It runs as the system account like the nightly task, so the copy lands in the locked folder. Its
 * security descriptor lets Windows users read and run it (start it), nothing else.
 */
function closeTaskXml(exePath) {
  return taskXml(exePath)
    .replace(
      /<Description>[^<]*<\/Description>/,
      '<Description>HeroMarket: automatic database backup after each shift close (keeps the newest 20).</Description>\n' +
        '    <SecurityDescriptor>D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;BU)</SecurityDescriptor>'
    )
    .replace(/\s*<Triggers>[\s\S]*?<\/Triggers>/, '')
    .replace(
      '<StartWhenAvailable>true</StartWhenAvailable>',
      '<StartWhenAvailable>false</StartWhenAvailable>'
    )
    .replace(
      '<ExecutionTimeLimit>PT2H</ExecutionTimeLimit>',
      '<ExecutionTimeLimit>PT1H</ExecutionTimeLimit>'
    )
    .replace(
      '<Arguments>--scheduled-backup</Arguments>',
      '<Arguments>--scheduled-backup --after-close</Arguments>'
    )
}

export {
  KEEP,
  closeTaskXml,
  retryUntil,
  REQUIRED_TABLES,
  backupName,
  parseName,
  isoWeek,
  listCopies,
  plan,
  prunable,
  writeCopy,
  readCopy,
  verifyCopy,
  runBackup,
  taskXml,
  sha256
}
