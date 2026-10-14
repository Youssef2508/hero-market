// Connects the desktop app to the HeroMarket service (see .docs/ARCHITECTURE.md).
//
//   standalone – this PC runs the service in-process against a PostgreSQL database (single-till store);
//   client     – this PC is a till that talks to a central HeroMarket server over the LAN.
//
// The renderer never sees SQL, database credentials or the session token: it sends an operation
// name + data over IPC, and this module attaches the token and terminal name.
import { app } from 'electron'
import { createRequire } from 'module'
import { join } from 'path'
import fs from 'fs'
import crypto from 'crypto'
import os from 'os'

const nodeRequire = createRequire(import.meta.url)
const isDev = !app.isPackaged
const configFile = () => join(app.getPath('userData'), 'heromarket.json')

let backend = null // { mode, call(op, body, headers) }
let token = null
let lastError = null

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
    serverUrl: process.env.HEROMARKET_SERVER_URL
  }
}

export function readConfig() {
  if (isDev && !fs.existsSync(configFile())) return devConfig()
  if (!fs.existsSync(configFile())) return null
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'))
  } catch {
    return null
  }
}

/** Persist the machine configuration. The secret is generated once and never sent to the renderer. */
export function writeConfig(cfg) {
  const current = readConfig() || {}
  const next = {
    mode: cfg.mode === 'client' ? 'client' : 'standalone',
    databaseUrl: cfg.mode === 'client' ? undefined : cfg.databaseUrl,
    serverUrl: cfg.mode === 'client' ? cfg.serverUrl : undefined,
    terminalName: cfg.terminalName || current.terminalName || os.hostname(),
    secret: current.secret || crypto.randomBytes(32).toString('base64url')
  }
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), { mode: 0o600 })
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
    logger: { level: isDev ? 'info' : 'warn' }
  })
  await svc.prepare()
  await svc.app.ready()
  return {
    mode: 'standalone',
    close: () => svc.app.close(),
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

function startClient(cfg) {
  const base = String(cfg.serverUrl || '').replace(/\/+$/, '')
  return {
    mode: 'client',
    close: async () => {},
    call: async (op, body, headers) => {
      const res = await fetch(`${base}/api/${op}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(15000)
      })
      const text = await res.text()
      return { status: res.status, body: text ? JSON.parse(text) : null }
    }
  }
}

export async function startBackend() {
  lastError = null
  const cfg = readConfig()
  if (
    !cfg ||
    (cfg.mode !== 'client' && !cfg.databaseUrl) ||
    (cfg.mode === 'client' && !cfg.serverUrl)
  ) {
    backend = null
    lastError = 'not_configured'
    return status()
  }
  try {
    if (backend) await backend.close().catch(() => {})
    backend = cfg.mode === 'client' ? startClient(cfg) : await startStandalone(cfg)
  } catch (e) {
    backend = null
    lastError = e.message
    console.error('[backend] failed to start:', e.message)
  }
  return status()
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

export async function stopBackend() {
  if (backend) await backend.close().catch(() => {})
  backend = null
}

/**
 * Forward one operation. Login/setup responses hand the token to this module only;
 * logout clears it. Errors come back as { error: { code, message } } with an HTTP-like status.
 */
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
  if ((op === 'auth.login' || op === 'auth.setup') && token) {
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
      if (res.status === 401 && op !== 'auth.login') token = null
      return {
        status: res.status,
        error: res.body?.error || { code: 'error', message: 'حدث خطأ غير متوقع.' }
      }
    }
    let data = res.body
    if ((op === 'auth.login' || op === 'auth.setup') && data && data.token) {
      token = data.token
      const { token: _hidden, ...rest } = data
      data = rest
    }
    if (op === 'auth.logout') token = null
    return { status: res.status, data }
  } catch (e) {
    const offline = /ECONNREFUSED|fetch failed|timeout|ENOTFOUND/i.test(String(e.message))
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
