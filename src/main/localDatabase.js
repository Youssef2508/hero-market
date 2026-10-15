// Managed local PostgreSQL for a single-till store ("local" mode, see .docs/DATABASE_ARCHITECTURE.md §3).
//
// The installer ships the PostgreSQL server binaries (resources/pgsql). On first start this module
// creates a private cluster that listens on 127.0.0.1 only, with a random password kept in
// heromarket.json (saved BEFORE initdb, so an interrupted first start can always be completed). The
// app starts the server with pg_ctl when it opens and stops it when it quits. Nothing here ever deletes
// or re-initialises an existing cluster, and a cluster that existed once is never silently recreated.
import { app } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import fs from 'fs'
import net from 'net'
import crypto from 'crypto'
import pg from 'pg'
import { isToolSafePath, asciiMachineDir, runnablePgsqlRoot, pgsqlStamp } from './pgPaths'
import { storeDir } from './userDataPath'

const DB_NAME = 'heromarket'
const DB_USER = 'heromarket'

/**
 * Folder for the cluster, its log and the temporary password file: the shared store folder
 * (%ProgramData%\HeroMarket for an installed app – always ASCII). The PostgreSQL tools take their
 * arguments in the Windows ANSI code page, so a development or test folder with other characters
 * (e.g. an Arabic user name) gets an ASCII-only folder under ProgramData instead.
 */
function chooseBaseDir() {
  const base = storeDir()
  if (isToolSafePath(base)) return base
  const id = crypto.createHash('sha256').update(base).digest('hex').slice(0, 10)
  return asciiMachineDir(`store-${id}`)
}

// Data folders whose server this app session started (and may stop on quit).
const startedHere = new Set()

/** Can the store's server be reached with its credentials (possibly started by another session)? */
async function reachable(cfg) {
  const client = new pg.Client({
    connectionString: localUrl(cfg, 'postgres'),
    connectionTimeoutMillis: 3000
  })
  client.on('error', () => {})
  try {
    await client.connect()
    await client.end()
    return true
  } catch {
    return false
  }
}

const paths = (base) => ({
  data: join(base, 'pgdata'),
  logs: join(base, 'logs'),
  log: join(base, 'logs', 'postgres.log')
})

/** The shipped PostgreSQL tree (bin/, lib/, share/). */
function pgsqlRoot() {
  if (app.isPackaged) return join(process.resourcesPath, 'pgsql')
  const platform = process.platform === 'win32' ? 'windows' : process.platform
  return join(
    app.getAppPath(),
    'node_modules',
    '@embedded-postgres',
    `${platform}-${process.arch}`,
    'native'
  )
}

// The tools cannot start from a non-ASCII install path (K-34): they run from an ASCII copy then.
let runnableRoot = null
function binDir() {
  if (!runnableRoot) {
    const src = pgsqlRoot()
    if (!fs.existsSync(join(src, 'bin'))) throw new Error(`PostgreSQL binaries not found in ${src}`)
    runnableRoot = runnablePgsqlRoot(src, {
      cacheRoot: asciiMachineDir('runtime'),
      stamp: isToolSafePath(src) ? app.getVersion() : pgsqlStamp(src, app.getVersion())
    })
  }
  return join(runnableRoot, 'bin')
}

function exe(name) {
  return join(binDir(), process.platform === 'win32' ? `${name}.exe` : name)
}

// Windows exit status of a program that cannot load a DLL (0xC0000135): on a PC without the
// Microsoft Visual C++ runtime the PostgreSQL tools stop before printing anything (seen on a clean
// Windows, 1.4.0 release checks). The installer installs the runtime; this explains it if missing.
const DLL_NOT_FOUND = [0xc0000135, -1073741515]
function toolError(what, result) {
  if (DLL_NOT_FOUND.includes(result.code))
    return new Error(
      'تعذر تشغيل قاعدة البيانات لأن مكونات Microsoft Visual C++ غير مثبتة على هذا الجهاز. أعد تشغيل برنامج تثبيت HeroMarket ليثبّتها، ثم افتح البرنامج.'
    )
  const exit = result.code == null ? '' : ` (exit ${result.code})`
  return new Error(`${what}${exit}: ${result.output.slice(-800)}`)
}

/** Run a PostgreSQL tool and resolve with its exit code and output (stdio is never left attached). */
function run(tool, args) {
  return new Promise((resolve, reject) => {
    const out = []
    const child = spawn(exe(tool), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => out.push(d))
    child.on('error', reject)
    // 'exit', not 'close': pg_ctl start leaves the server running with inherited handles.
    child.on('exit', (code) => resolve({ code, output: Buffer.concat(out).toString('utf8') }))
  })
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)))
  })
}

async function choosePort(preferred) {
  for (let p = preferred; p < preferred + 50; p++) if (await portFree(p)) return p
  throw new Error('لا يوجد منفذ متاح لتشغيل قاعدة البيانات المحلية.')
}

export function localUrl(local, db = DB_NAME) {
  return `postgres://${DB_USER}:${encodeURIComponent(local.password)}@127.0.0.1:${local.port}/${db}`
}

async function isRunning(data) {
  const { code } = await run('pg_ctl', ['status', '-D', data])
  return code === 0
}

/**
 * Make sure the local cluster exists and is running.
 * @param {object|undefined} local   stored { dir, port, password, initialised } (undefined on first start)
 * @param {(local: object) => void} persist  saves the (new or changed) value in heromarket.json
 * @returns the current value (also persisted)
 */
export async function ensureLocalDatabase(local, persist) {
  if (!fs.existsSync(exe('pg_ctl'))) {
    throw new Error(`PostgreSQL binaries not found in ${binDir()}`)
  }
  let cfg = local && local.password ? { ...local } : null
  const base = cfg?.dir || chooseBaseDir()
  const p = paths(base)
  const hasCluster = fs.existsSync(join(p.data, 'PG_VERSION'))

  if (hasCluster && !cfg) {
    // A cluster without its credentials cannot be opened; never re-initialise over it.
    throw new Error(
      `توجد قاعدة بيانات محلية في ${p.data} لكن بيانات الدخول إليها مفقودة من heromarket.json. لم يتم تعديل أي بيانات.`
    )
  }
  if (!hasCluster && cfg && cfg.initialised !== false) {
    // The store's database existed and is gone (moved, deleted, quarantined). Creating an empty one
    // would hide the loss and re-import months-old data: stop and say so.
    throw new Error(
      `قاعدة البيانات المحلية غير موجودة في ${p.data}. أعد مجلد البيانات أو استعد نسخة احتياطية؛ لم يتم إنشاء قاعدة بيانات جديدة.`
    )
  }
  if (!hasCluster) {
    if (!cfg) {
      cfg = {
        dir: base,
        port: await choosePort(54330),
        password: crypto.randomBytes(24).toString('base64url'),
        initialised: false
      }
      persist(cfg) // before initdb: an interrupted first start can be resumed with the same password
    }
    fs.mkdirSync(p.data, { recursive: true })
    if (fs.readdirSync(p.data).length) {
      throw new Error(
        `المجلد ${p.data} يحتوي على ملفات من محاولة تجهيز سابقة لم تكتمل. انقلها إلى مكان آخر ثم أعد التشغيل.`
      )
    }
    const pwFile = join(base, `.pw-${process.pid}`)
    fs.writeFileSync(pwFile, cfg.password, { mode: 0o600 })
    try {
      const init = await run('initdb', [
        '-D',
        p.data,
        '-U',
        DB_USER,
        `--pwfile=${pwFile}`,
        '-E',
        'UTF8',
        '--locale=C',
        '--auth-host=scram-sha-256',
        '--auth-local=scram-sha-256'
      ])
      if (init.code !== 0) throw toolError('initdb failed', init)
    } finally {
      fs.rmSync(pwFile, { force: true })
    }
    cfg = { ...cfg, initialised: true }
    persist(cfg)
  }
  if (!cfg.dir) {
    cfg = { ...cfg, dir: base }
    persist(cfg)
  }

  // Another Windows session of this PC may already run the store's server (per-machine install):
  // use it as it is rather than starting a second one on the same data folder.
  const sharedRunning = hasCluster && (await reachable(cfg))
  if (!sharedRunning && !(await isRunning(p.data))) {
    if (!(await portFree(cfg.port))) {
      cfg = { ...cfg, port: await choosePort(cfg.port + 1) }
      persist(cfg)
    }
    fs.mkdirSync(p.logs, { recursive: true })
    const started = await run('pg_ctl', [
      'start',
      '-D',
      p.data,
      '-w',
      '-t',
      '90',
      '-l',
      p.log,
      '-o',
      `-p ${cfg.port} -c listen_addresses=127.0.0.1`
    ])
    if (started.code !== 0) {
      if (DLL_NOT_FOUND.includes(started.code)) throw toolError('pg_ctl start failed', started)
      let tail = ''
      try {
        tail = fs.readFileSync(p.log, 'utf8').slice(-800)
      } catch {
        /* no log yet */
      }
      throw new Error(`PostgreSQL did not start: ${started.output.slice(-400)} ${tail}`)
    }
    startedHere.add(p.data)
  }
  const client = new pg.Client({ connectionString: localUrl(cfg, 'postgres') })
  await client.connect()
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      DB_NAME
    ])
    if (!rowCount) {
      await client.query(
        `CREATE DATABASE ${DB_NAME} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`
      )
    }
  } finally {
    await client.end()
  }
  return cfg
}

/** The data folder of the cluster described by `local`. */
export function localDataDir(local) {
  return paths(local.dir || chooseBaseDir()).data
}

/**
 * Stop the cluster described by `local` (the value ensureLocalDatabase returned) when the app quits:
 * only if this session started it and no other HeroMarket session is still connected (another
 * Windows user of the same PC). `force` stops it regardless (pre-upgrade snapshot).
 */
export async function stopLocalDatabase(local, { force = false } = {}) {
  if (!local) return
  const { data } = paths(local.dir || chooseBaseDir())
  if (!fs.existsSync(join(data, 'PG_VERSION'))) return
  if (!force) {
    if (!startedHere.has(data)) return
    const others = await otherSessions(local)
    if (others > 0) {
      console.log(`[db] left running: ${others} connection(s) from another HeroMarket session`)
      return
    }
  }
  if (await isRunning(data)) await run('pg_ctl', ['stop', '-D', data, '-m', 'fast', '-w'])
  startedHere.delete(data)
}

/** Connections of other HeroMarket processes (this session's pool is closed before stopping). */
async function otherSessions(local) {
  const client = new pg.Client({
    connectionString: localUrl(local, 'postgres'),
    connectionTimeoutMillis: 3000
  })
  client.on('error', () => {})
  try {
    await client.connect()
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE application_name = 'heromarket-service' AND pid <> pg_backend_pid()`
    )
    return rows[0].n
  } catch {
    return 0
  } finally {
    await client.end().catch(() => {})
  }
}
