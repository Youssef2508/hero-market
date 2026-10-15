// Connects the desktop app to the HeroMarket service (see .docs/ARCHITECTURE.md).
//
//   local      – single-till store: the app runs its own private PostgreSQL (localDatabase.js) and the
//                service in-process. Default for a new or upgraded installation; the old SQLite database
//                is imported once, with verified parity, and left untouched.
//   standalone – the service runs in-process against a PostgreSQL server the store manages;
//   client     – this PC is a till that talks to a central HeroMarket server over the LAN.
//
// The renderer never sees SQL, database credentials or the session token: it sends an operation
// name + data over IPC, and this module attaches the token and terminal name.
import { app, session } from 'electron'
import { createRequire } from 'module'
import { join } from 'path'
import fs from 'fs'
import crypto from 'crypto'
import os from 'os'
import { ensureLocalDatabase, stopLocalDatabase, localUrl, localDataDir } from './localDatabase'
import { needsSnapshot, snapshotDataDir, pruneSnapshots } from './upgradeSnapshot'
import { legacyDatabaseFile, storeDir, ensureStoreDir, perUserConfigFile } from './userDataPath'
import { copyAndVerify } from './upgradeSnapshot'
import { verifyPinnedChain } from './tlsPin'

const nodeRequire = createRequire(import.meta.url)
const isDev = !app.isPackaged
const configFile = () => join(storeDir(), 'heromarket.json')

let backend = null // { mode, call(op, body, headers) }
let token = null
let lastError = null
let starting = null // in-flight startBackend() promise
let stage = null // what the startup is doing, for the waiting screen
// Client mode: the store server's certificate was refused (Chromium caches the verdict, so this
// stays set until a request succeeds).
let serverCertRefused = false
let localStarted = null // the managed cluster this session started (stopped on quit or mode change)

function serverDir() {
  return join(app.getAppPath(), 'src', 'server')
}

/** Development defaults: the local cluster from `npm run pg:dev`, a per-checkout secret. */
function devConfig() {
  const root = app.getAppPath()
  let databaseUrl = process.env.HEROMARKET_DATABASE_URL
  if (!databaseUrl) {
    const credFile = join(root, '.pgdata', 'credentials.json')
    if (fs.existsSync(credFile)) {
      const c = JSON.parse(fs.readFileSync(credFile, 'utf8'))
      databaseUrl = `postgres://${c.user}:${encodeURIComponent(c.password)}@127.0.0.1:${c.port}/${process.env.HEROMARKET_DB_NAME || 'heromarket'}`
    }
  }
  let secret = process.env.HEROMARKET_SECRET
  if (!secret) {
    const secretFile = join(root, '.pgdata', 'dev-secret.txt')
    if (!fs.existsSync(secretFile)) {
      fs.mkdirSync(join(root, '.pgdata'), { recursive: true })
      fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('base64url'))
    }
    secret = fs.readFileSync(secretFile, 'utf8').trim()
  }
  return {
    mode: process.env.HEROMARKET_SERVER_URL ? 'client' : 'standalone',
    databaseUrl,
    secret,
    serverUrl: process.env.HEROMARKET_SERVER_URL,
    serverCaPem: process.env.HEROMARKET_SERVER_CA
      ? fs.readFileSync(process.env.HEROMARKET_SERVER_CA, 'utf8')
      : undefined
  }
}

export function readConfig() {
  if (!fs.existsSync(configFile())) {
    // Development uses the npm run pg:dev cluster unless the managed local database is requested.
    if (isDev && process.env.HEROMARKET_LOCAL_DB !== '1') return devConfig()
    return { mode: 'local' }
  }
  // A damaged file (e.g. power cut during a write) falls back to the copy kept by writeConfig.
  for (const file of [configFile(), `${configFile()}.bak`]) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      /* try the backup */
    }
  }
  return null
}

/** Persist the machine configuration. The secret is generated once and never sent to the renderer. */
export function writeConfig(cfg) {
  const current = readConfig() || {}
  const next = {
    mode: ['client', 'local'].includes(cfg.mode) ? cfg.mode : 'standalone',
    databaseUrl: cfg.mode === 'standalone' ? cfg.databaseUrl : undefined,
    serverUrl: cfg.mode === 'client' ? cfg.serverUrl : undefined,
    // Root certificate of the store server's TLS proxy (public; pinned instead of trusted machine-wide).
    serverCaPem: cfg.mode === 'client' ? cfg.serverCaPem || current.serverCaPem : undefined,
    terminalName: cfg.terminalName || current.terminalName || os.hostname(),
    secret: current.secret || crypto.randomBytes(32).toString('base64url'),
    // Credentials of the managed local cluster are kept even when switching modes, so it can be reopened.
    local: cfg.local || current.local
  }
  // Atomic replace (temp file + rename) and a copy of the previous version: this file holds the only
  // copy of the local database password.
  const tmp = `${configFile()}.tmp`
  const fd = fs.openSync(tmp, 'w', 0o600)
  try {
    fs.writeFileSync(fd, JSON.stringify(next, null, 2))
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  if (fs.existsSync(configFile())) fs.copyFileSync(configFile(), `${configFile()}.bak`)
  fs.renameSync(tmp, configFile())
  return next
}

function terminalName() {
  return (readConfig() || {}).terminalName || os.hostname()
}

async function startStandalone(cfg) {
  const { createService } = nodeRequire(join(serverDir(), 'app.js'))
  const svc = await createService({
    databaseUrl: cfg.databaseUrl,
    secret: cfg.secret,
    logger: { level: isDev ? 'info' : 'warn' },
    // Cloud synchronisation runs in the background once an administrator links the store
    // (المزامنة السحابية). Selling never waits for it.
    syncAgent: true
  })
  await svc.prepare()
  await svc.app.ready()
  return {
    mode: 'standalone',
    close: () => svc.app.close(),
    resetPassword: (username) =>
      nodeRequire(join(serverDir(), 'auth', 'reset.js')).resetPassword(svc.pool, username, {
        via: 'reset-password'
      }),
    call: async (op, body, headers) => {
      const res = await svc.app.inject({
        method: 'POST',
        url: `/api/${op}`,
        payload: body || {},
        headers
      })
      return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }
    }
  }
}

/**
 * Requests to the store server go through Chromium's network stack in a dedicated in-memory session.
 * HTTPS certificates are accepted when Windows trusts them, or when their chain ends at the root the
 * owner pinned for this till (`serverCaPem`, see tlsPin.js). Everything else is refused.
 */
function serverSession(cfg) {
  const ses = session.fromPartition('heromarket-server')
  const bare = (h) => String(h).replace(/^\[|\]$/g, '')
  const host = bare(new URL(cfg.serverUrl).hostname)
  ses.setCertificateVerifyProc((req, callback) => {
    if (req.verificationResult === 'net::OK') return callback(0)
    if (!cfg.serverCaPem || bare(req.hostname) !== host) {
      serverCertRefused = true
      return callback(-2)
    }
    const chain = []
    for (let c = req.certificate; c; c = c.issuerCert) chain.push(c.data)
    const result = verifyPinnedChain(chain, cfg.serverCaPem, host)
    if (!result.ok) {
      serverCertRefused = true
      console.error('[backend] server certificate refused:', result.reason)
    }
    callback(result.ok ? 0 : -2)
  })
  return ses
}

function startClient(cfg) {
  const base = String(cfg.serverUrl || '').replace(/\/+$/, '')
  const ses = serverSession(cfg)
  return {
    mode: 'client',
    close: async () => {},
    call: async (op, body, headers) => {
      const res = await ses.fetch(`${base}/api/${op}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(15000)
      })
      serverCertRefused = false
      const text = await res.text()
      return { status: res.status, body: text ? JSON.parse(text) : null }
    }
  }
}

/**
 * First start of local mode on a machine that ran the SQLite version: import its database once.
 * Skipped when an import already completed or the new database is already in use. Any problem stops
 * the start-up with the reason; the SQLite file is only read (after a verified backup copy).
 */
async function importLegacyIfPresent(databaseUrl) {
  const legacy = legacyDatabaseFile()
  if (!fs.existsSync(legacy)) return null
  const { createPool } = nodeRequire(join(serverDir(), 'db', 'pool.js'))
  const { migrate } = nodeRequire(join(serverDir(), 'db', 'migrate.js'))
  const { importLegacy, rebrandStoreName } = nodeRequire(
    join(serverDir(), 'db', 'legacy-import.js')
  )
  const quiet = { info: (m) => console.log(m), warn: console.warn, error: console.error }
  const pool = createPool(databaseUrl, { max: 2 })
  try {
    await migrate(pool, { logger: quiet })
    const done = await pool.query(
      "SELECT to_regclass('legacy_import_runs') IS NOT NULL AS has_runs, (SELECT count(*)::int FROM users) AS users"
    )
    const imported =
      done.rows[0].has_runs &&
      (await pool.query("SELECT 1 FROM legacy_import_runs WHERE status = 'completed'")).rowCount > 0
    // Idempotent: completes the store rename if an earlier start stopped right after the import.
    if (imported) await rebrandStoreName(pool)
    if (imported || done.rows[0].users > 0) return null
    stage = 'importing'
    const backups = join(storeDir(), 'backups')
    const report = await importLegacy(pool, legacy, {
      backupDir: join(backups, 'legacy-sqlite'),
      logger: quiet
    })
    report.storeName = await rebrandStoreName(pool)
    fs.writeFileSync(
      join(backups, `legacy-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
      JSON.stringify(report, null, 2)
    )
    console.log('[backend] legacy SQLite database imported, parity', report.parity.ok)
    return report
  } catch (e) {
    throw new Error(
      `تعذر نقل بيانات النسخة السابقة إلى قاعدة البيانات الجديدة. لم يتم تعديل ملف البيانات القديم. (${e.message})`
    )
  } finally {
    await pool.end()
  }
}

/**
 * Before a new version migrates the store's database: stop PostgreSQL, copy and verify the whole
 * data folder (upgradeSnapshot.js), start it again. Any failure stops the start-up before a single
 * migration runs. A brand-new database (nothing applied yet) needs no snapshot.
 */
async function snapshotBeforeUpgrade(local, persist) {
  const { listMigrations } = nodeRequire(join(serverDir(), 'db', 'migrate.js'))
  const all = listMigrations().map((m) => m.version)
  const pg = nodeRequire('pg')
  const client = new pg.Client({ connectionString: localUrl(local) })
  let applied = []
  await client.connect()
  try {
    const has = await client.query("SELECT to_regclass('schema_migrations') IS NOT NULL AS ok")
    if (has.rows[0].ok)
      applied = (
        await client.query('SELECT version FROM schema_migrations ORDER BY version')
      ).rows.map((r) => r.version)
  } finally {
    await client.end()
  }
  if (!needsSnapshot(applied, all)) return null
  stage = 'backup'
  const dir = join(storeDir(), 'backups', 'pre-upgrade')
  let target = null
  let failure = null
  await stopLocalDatabase(local, { force: true })
  try {
    target = snapshotDataDir(
      localDataDir(local),
      dir,
      `app-${app.getVersion()}-db-${applied[applied.length - 1]}-to-${all[all.length - 1]}`
    )
    pruneSnapshots(dir)
    console.log('[backend] pre-upgrade snapshot verified:', target)
  } catch (e) {
    failure = e
  }
  // Start the database again either way; on failure the start-up stops before migrating.
  await ensureLocalDatabase(local, persist)
  if (failure)
    throw new Error(
      `تعذر أخذ نسخة احتياطية من قاعدة البيانات قبل تحديثها، لذلك لم يتم التحديث ولم تتغير بياناتك. حرّر مساحة على القرص ثم أعد تشغيل البرنامج. (${failure.message})`
    )
  return target
}

/**
 * 1.4.0 moved the store's data from one Windows user's profile to the shared store folder. A store
 * that was set up per user before is adopted once: its database folder is copied and verified file
 * by file (upgradeSnapshot.js), the configuration is written to the shared folder, and the old
 * files are kept untouched as a fallback (heromarket.json is renamed so it is not adopted twice).
 */
function adoptPerUserStore() {
  const old = perUserConfigFile()
  if (!old || fs.existsSync(configFile()) || !fs.existsSync(old)) return null
  const cfg = JSON.parse(fs.readFileSync(old, 'utf8'))
  stage = 'moving'
  if (cfg.local && cfg.local.dir) {
    const from = join(cfg.local.dir, 'pgdata')
    const to = join(storeDir(), 'pgdata')
    if (fs.existsSync(join(from, 'PG_VERSION'))) {
      if (fs.existsSync(to) && fs.readdirSync(to).length)
        throw new Error(
          `يوجد بالفعل مجلد قاعدة بيانات في ${to}. لم يتم نقل بيانات المستخدم الحالي؛ راجع الدعم الفني.`
        )
      copyAndVerify(from, to)
    }
    cfg.local = { ...cfg.local, dir: storeDir() }
  }
  writeConfig(cfg)
  fs.renameSync(old, `${old}.moved-to-${storeDir().replace(/[\\/:]/g, '_')}`)
  console.log('[backend] per-user store adopted into', storeDir())
  return cfg
}

async function doStart() {
  lastError = null
  try {
    ensureStoreDir()
    adoptPerUserStore()
  } catch (e) {
    backend = null
    lastError = e.message
    stage = null
    return
  }
  let cfg = readConfig()
  if (
    !cfg ||
    (cfg.mode === 'standalone' && !cfg.databaseUrl) ||
    (cfg.mode === 'client' && !cfg.serverUrl)
  ) {
    backend = null
    lastError = 'not_configured'
    return
  }
  try {
    if (backend) await backend.close().catch(() => {})
    backend = null
    if (cfg.mode !== 'local' && localStarted) {
      // Switched away from this computer's database: stop the cluster this session started.
      await stopLocalDatabase(localStarted).catch(() => {})
      localStarted = null
    }
    if (cfg.mode === 'local') {
      stage = 'database'
      const local = await ensureLocalDatabase(cfg.local, (value) => {
        cfg = writeConfig({ ...cfg, local: value })
      })
      if (!fs.existsSync(configFile())) cfg = writeConfig({ ...cfg, local })
      localStarted = local
      const databaseUrl = localUrl(local)
      await snapshotBeforeUpgrade(local, (value) => {
        cfg = writeConfig({ ...cfg, local: value })
      })
      await importLegacyIfPresent(databaseUrl)
      stage = 'service'
      backend = await startStandalone({ ...cfg, databaseUrl })
    } else {
      backend = cfg.mode === 'client' ? startClient(cfg) : await startStandalone(cfg)
    }
  } catch (e) {
    backend = null
    lastError = e.message
    console.error('[backend] failed to start:', e.message)
  } finally {
    stage = null
  }
}

export async function startBackend() {
  if (!starting) starting = doStart().finally(() => (starting = null))
  await starting
  return status()
}

/** Status for the renderer; waits for a start-up in progress so the UI never sees a half-started state. */
export async function waitForStatus() {
  if (starting) await starting
  return status()
}

export function startupStage() {
  return stage
}

export function status() {
  const cfg = readConfig()
  return {
    configured: !!cfg,
    mode: cfg?.mode || null,
    ready: !!backend,
    error: lastError,
    terminalName: terminalName()
  }
}

/**
 * "--reset-password=<username>" on this PC: starts the local database, gives the user a temporary
 * password and stops again. Needs the store's own database (local or standalone mode).
 */
export async function resetPasswordOnThisPc(username) {
  await startBackend()
  if (!backend) throw new Error(lastError || 'not_configured')
  if (!backend.resetPassword) throw new Error('client_mode')
  return backend.resetPassword(username)
}

export async function stopBackend() {
  if (starting) await starting.catch(() => {})
  if (backend) await backend.close().catch(() => {})
  backend = null
  // Stopped only if this session started it and no other session is still using it.
  if (localStarted) await stopLocalDatabase(localStarted).catch(() => {})
  localStarted = null
}

/**
 * Forward one operation. Login/setup responses hand the token to this module only;
 * logout clears it. Errors come back as { error: { code, message } } with an HTTP-like status.
 */
// Operations that sign a user in and return a session token (kept in this process only).
const SIGN_IN = new Set(['auth.login', 'auth.setup', 'auth.setPassword', 'auth.recover'])

export async function callOperation(op, body) {
  if (!backend) {
    return {
      status: 503,
      error: {
        code: 'backend_unavailable',
        message: 'الخادم غير متصل. راجع إعدادات الاتصال بقاعدة البيانات.'
      }
    }
  }
  const headers = { 'x-heromarket-terminal': terminalName() }
  // A new login on this till ends the previous session (e.g. after a renderer reload or a lock).
  if (SIGN_IN.has(op) && token) {
    const previous = token
    token = null
    await backend
      .call('auth.logout', {}, { ...headers, authorization: `Bearer ${previous}` })
      .catch(() => {})
  }
  if (token) headers.authorization = `Bearer ${token}`
  try {
    const res = await backend.call(op, body, headers)
    if (res.status >= 400) {
      if (res.status === 401 && !SIGN_IN.has(op)) token = null
      return {
        status: res.status,
        error: res.body?.error || { code: 'error', message: 'حدث خطأ غير متوقع.' }
      }
    }
    let data = res.body
    if (SIGN_IN.has(op) && data && data.token) {
      token = data.token
      const { token: _hidden, ...rest } = data
      data = rest
    }
    if (op === 'auth.logout') token = null
    return { status: res.status, data }
  } catch (e) {
    const msg = String(e.message)
    // A refusal by our verifier surfaces only as net::ERR_FAILED.
    if (/ERR_CERT|ERR_SSL|ERR_BAD_SSL/i.test(msg) || serverCertRefused) {
      return {
        status: 503,
        error: {
          code: 'server_certificate',
          message: 'شهادة أمان خادم المتجر غير موثوقة. اختر شهادة الخادم من إعدادات الاتصال.'
        }
      }
    }
    // Node (ECONNREFUSED…) and Chromium (net::ERR_CONNECTION_REFUSED…) spellings of "unreachable".
    const offline =
      /ECONNREFUSED|fetch failed|timeout|ENOTFOUND|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_INTERNET_DISCONNECTED|ERR_TIMED_OUT|ERR_NETWORK|ERR_EMPTY_RESPONSE|ECONNRESET|socket hang up/i.test(
        msg
      )
    return {
      status: 503,
      error: {
        code: offline ? 'server_unreachable' : 'error',
        message: offline
          ? 'تعذر الاتصال بخادم HeroMarket. تحقق من الشبكة وتشغيل الخادم.'
          : e.message
      }
    }
  }
}

export function clearSession() {
  token = null
}
