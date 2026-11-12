'use strict'
// HeroMarket service: owns the PostgreSQL connection, authenticates staff, authorises every operation.
// The same instance runs in-process inside the desktop app (standalone store) or as a network service
// for several terminals (see .docs/ARCHITECTURE.md and .docs/DATABASE_ARCHITECTURE.md).
const crypto = require('crypto')
const Fastify = require('fastify')
const { createPool, withTransaction } = require('./db/pool')
const { migrate, listMigrations, DEFAULT_DIR } = require('./db/migrate')
const { schemaState, assertNotNewer } = require('./db/upgrade')
const { ensureAccessControl, describeUser } = require('./auth/access')
const { ServiceError, unauthorized, forbidden, fromDatabaseError } = require('./errors')
const { KEYS } = require('./auth/permissions')
const { cloudRoute, kindOf, CLOUD_REFUSED } = require('./sync/operationKinds')
const { remoteTx } = require('./sync/remoteOps')

const SESSION_HOURS = 12
// Signing in through the internet needs this permission, on top of the user's own (D-101). It
// opens the door only: what the user may do is decided by their other permissions, as in the shop.
const INTERNET = 'internet.access'
const NO_INTERNET = 'هذا الحساب غير مصرح له بالدخول عبر الإنترنت. اطلب الصلاحية من مدير النظام.'

// While a restored database waits for recovery from the cloud (stage 4 phase 4), only these
// operations run: signing in, the recovery itself, store settings, and backups.
const DURING_RECOVERY = /^(auth\.|sync\.|backup\.|settings\.public$)/

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

// The browser's session cookie (the internet way in). Never readable by page scripts.
const SESSION_COOKIE = 'hm_session'
function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null
  }
  return null
}
function sessionCookie(token, { secure, hours }) {
  return [
    `${SESSION_COOKIE}=${token || ''}`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : null,
    `Max-Age=${token ? hours * 3600 : 0}`
  ]
    .filter(Boolean)
    .join('; ')
}

/**
 * @param {object} cfg
 * @param {string} cfg.databaseUrl  PostgreSQL connection string
 * @param {string} cfg.secret       server secret (≥ 32 chars) for PIN lookup keys
 * @param {string} [cfg.timeZone]   store time zone for LOCALTIMESTAMP (default: this machine's)
 * @param {string} [cfg.migrationsDir]
 * @param {'auto'|'refuse'} [cfg.migrationPolicy] 'refuse' (installed store): pending migrations are
 *        applied by the installer after its verified copy, never by the program (code setup_incomplete)
 * @param {object|boolean} [cfg.logger] fastify/pino logger options
 * @param {string} [cfg.setupCode] one-time code required by auth.setup (networked servers)
 * @param {'store'|'cloud'} [cfg.role] 'cloud': the internet way in (D-101). Reads are answered from
 *        this copy; every change is carried out in the shop by the same operation (cloud/link.js)
 */
async function createService(cfg) {
  if (!cfg.secret || String(cfg.secret).length < 32)
    throw new Error('HEROMARKET_SECRET must be at least 32 characters')
  const timeZone = cfg.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const app = Fastify({
    logger: cfg.logger ?? {
      level: process.env.HEROMARKET_LOG_LEVEL || 'info',
      // Never write credentials to the log (request bodies are not logged by default; this also
      // covers any future debug logging).
      redact: [
        'req.headers.authorization',
        'body.pin',
        'body.password',
        'body.currentPassword',
        'body.newPassword',
        'body.recoveryCode',
        'body.deviceToken',
        'body.approver.password',
        'body.setupCode'
      ]
    },
    bodyLimit: 2 * 1024 * 1024,
    // Behind a reverse proxy (the cloud behind Caddy): the visitor's address comes from the proxy's
    // X-Forwarded-For, trusted only from the addresses listed here (D-105). Without it every visitor
    // would share the proxy's address, and one person's wrong guesses would lock out everyone.
    trustProxy: cfg.trustProxy || false
  })
  const pool = createPool(cfg.databaseUrl, { logger: app.log, max: cfg.poolSize })
  // Every connection works in the store's local time: LOCALTIMESTAMP matches the legacy local-time text.
  pool.on('connect', (client) => {
    client.query(`SET TIME ZONE '${timeZone.replace(/'/g, '')}'`).catch(() => {})
  })

  const operations = new Map()
  const loginGuard = new Map() // key → { failures, first, lockedUntil }
  const cloud = cfg.role === 'cloud'
  // Operations being carried out here for a user working from the internet (sync/remoteOps.js):
  // one-time key → { id, operation, userId, terminal }. The key never leaves this process.
  const remoteOperations = new Map()

  app.decorate('pool', pool)
  app.decorate('remoteOperations', remoteOperations)
  app.decorate('config', { ...cfg, timeZone })
  app.decorate('loginGuard', loginGuard)

  // Error shape: { error: { code, message } } with an HTTP status.
  app.setErrorHandler((err, req, reply) => {
    let e = err instanceof ServiceError ? err : fromDatabaseError(err)
    if (!e && err.validation)
      e = new ServiceError(400, 'bad_request', 'بيانات غير صالحة.', err.validation)
    if (!e) {
      req.log.error({ err }, 'unhandled error')
      e = new ServiceError(500, 'internal', 'حدث خطأ غير متوقع في الخادم.')
    }
    reply.status(e.status).send({ error: { code: e.code, message: e.message, details: e.details } })
  })

  /** Resolve the bearer token to a session and user; refuses revoked, expired or disabled accounts. */
  async function authenticate(req) {
    const remoteKey = req.headers['x-heromarket-remote']
    if (remoteKey) {
      // Carried out for a user of the cloud: no session here, the same user and permissions.
      const remote = remoteOperations.get(String(remoteKey))
      if (!remote) throw unauthorized()
      const user = await describeUser(pool, remote.userId)
      if (!user || !user.isActive) throw unauthorized('تم تعطيل هذا الحساب.')
      return { sessionId: 0, user, remote }
    }
    const header = req.headers.authorization || ''
    let token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token && cloud) {
      // A browser's session is an HTTP-only cookie. A cookie is sent by the browser on its own, so
      // the request must also carry a header only our own page can add (cross-site forgery).
      token = cookieOf(req, SESSION_COOKIE)
      if (token && req.headers['x-heromarket-web'] !== '1') throw unauthorized()
    }
    if (!token) throw unauthorized()
    const { rows } = await pool.query(
      `UPDATE sessions SET last_seen_at = LOCALTIMESTAMP(0)
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > LOCALTIMESTAMP(0)
       RETURNING id, user_id`,
      [sha256(token)]
    )
    if (!rows.length) throw unauthorized()
    const user = await describeUser(pool, rows[0].user_id)
    if (!user || !user.isActive) throw unauthorized('تم تعطيل هذا الحساب.')
    if (cloud && !user.permissions.includes(INTERNET)) throw forbidden(NO_INTERNET)
    return { sessionId: rows[0].id, user }
  }

  /** Register a named operation as POST /api/<name>. Permission checks happen here, for every call. */
  function operation(def) {
    if (operations.has(def.name)) throw new Error(`duplicate operation ${def.name}`)
    const perms = def.permission ? [].concat(def.permission) : []
    for (const p of perms) if (!KEYS.has(p)) throw new Error(`${def.name}: unknown permission ${p}`)
    operations.set(def.name, def)
    // Sign-in and permissions are checked before the request body is validated (preValidation):
    // a caller without access learns nothing about an operation's fields (audit 1.4.0).
    const authorize = async (req) => {
      // What only the shop PC does is refused on the internet way in before anything else.
      if (cloud && cloudRoute(def.name) === 'refused')
        throw new ServiceError(409, 'shop_only', CLOUD_REFUSED[def.name])
      if (def.public) return
      const auth = await authenticate(req)
      // `permission` = all required; `anyPermission` = at least one.
      if (perms.length && !perms.every((p) => auth.user.permissions.includes(p))) throw forbidden()
      if (def.anyPermission && !def.anyPermission.some((p) => auth.user.permissions.includes(p)))
        throw forbidden()
      if (app.syncFlags?.recoveryPending && !DURING_RECOVERY.test(def.name))
        throw new ServiceError(
          423,
          'recovery_pending',
          'تمت استعادة نسخة احتياطية: يجب استرجاع البيانات من السحابة (أو تخطي ذلك) من شاشة المزامنة قبل متابعة العمل.'
        )
      req.hmAuth = auth
    }
    app.post(
      `/api/${def.name}`,
      {
        schema: def.schema ? { body: def.schema } : undefined,
        bodyLimit: def.bodyLimit,
        preValidation: authorize
      },
      async (req, reply) => {
        const auth = req.hmAuth || null
        const remote = auth?.remote || null
        if (cloud && cloudRoute(def.name) === 'shop') {
          // The internet way in: reads from this copy; a change is carried out in the shop while it
          // can be reached (D-101). While it cannot, the same operation runs here on this copy and
          // reaches the shop when it is back (D-103) – except the few that need both sides together.
          if (await app.cloudLink.shopUp())
            return app.cloudLink.forward({ def, auth, body: req.body || {}, req })
          if (kindOf(def.name) === 'linked')
            throw new ServiceError(
              503,
              'shop_unreachable',
              'المتجر غير متصل الآن. هذه العملية تحتاج اتصال المتجر (تغيير باركود أو حذف سجل أو إعادة ضبط)؛ حاول عند عودة الاتصال.'
            )
        }
        const ctx = {
          pool,
          user: auth?.user || null,
          sessionId: auth?.sessionId ?? null,
          ip: req.ip,
          cloud,
          terminal: remote ? remote.terminal : req.headers['x-heromarket-terminal'] || null,
          log: req.log,
          can: (p) => !!auth && auth.user.permissions.includes(p),
          require: (p) => {
            if (!auth || !auth.user.permissions.includes(p)) throw forbidden()
          },
          // A remote operation records its id in its own transaction: at most once (D-101).
          tx: remote ? remoteTx(pool, remote) : (fn) => withTransaction(pool, fn),
          audit: (db, actionType, description, details) =>
            db.query(
              `INSERT INTO system_logs (timestamp, user_id, username, action_type, description, details)
             VALUES (LOCALTIMESTAMP(0), $1, $2, $3, $4, $5)`,
              [
                auth?.user.id ?? null,
                auth?.user.username ?? null,
                actionType,
                description,
                // The record is the same as from the desktop; the log also says it came remotely.
                remote
                  ? JSON.stringify({ ...(details || {}), remoteOperation: remote.id })
                  : details
                    ? JSON.stringify(details)
                    : null
              ]
            ),
          guard: loginGuard,
          sessionHours: SESSION_HOURS,
          secret: cfg.secret,
          setupCode: cfg.setupCode || null
        }
        const result = await def.handler(ctx, req.body || {})
        if (cloud && result?.token && result.user && !result.user.permissions.includes(INTERNET)) {
          // Signed in with the right password but without the internet permission: no session.
          await pool.query(
            'UPDATE sessions SET revoked_at = LOCALTIMESTAMP(0) WHERE token_hash = $1',
            [sha256(result.token)]
          )
          throw forbidden(NO_INTERNET)
        }
        if (cloud && req.headers['x-heromarket-web'] === '1') {
          // A browser never holds the session token: it goes into the cookie, out of the answer.
          const cookie = { secure: !cfg.insecureCookies, hours: SESSION_HOURS }
          if (result?.token) {
            reply.header('set-cookie', sessionCookie(result.token, cookie))
            const { token: _kept, ...rest } = result
            return rest
          }
          if (def.name === 'auth.logout') reply.header('set-cookie', sessionCookie(null, cookie))
        }
        return result === undefined ? { ok: true } : result
      }
    )
  }
  app.decorate('operation', operation)

  app.get('/api/health', async () => {
    const r = await pool.query('SELECT 1 AS ok')
    return { status: r.rows[0].ok === 1 ? 'ok' : 'degraded', time: new Date().toISOString() }
  })
  app.post('/api/operations.list', async (req) => {
    await authenticate(req)
    return [...operations.values()].map((o) => ({
      name: o.name,
      permission: o.permission || null,
      public: !!o.public
    }))
  })

  // Feature modules. The cloud has no link of its own to configure (shopOnly), and gains the
  // other end of the shop's link.
  for (const mod of require('./modules')) if (!(cloud && mod.shopOnly)) mod(app)
  if (cloud) require('./cloud/link')(app, cfg)

  async function prepare() {
    const dir = cfg.migrationsDir || DEFAULT_DIR
    const client = await pool.connect()
    let state
    try {
      state = await schemaState(
        client,
        listMigrations(dir).map((m) => m.version)
      )
    } finally {
      client.release()
    }
    // Never open a database migrated by a newer version (safe updates and rollbacks).
    assertNotNewer(state)
    if (cfg.migrationPolicy === 'refuse' && state.pending.length) {
      const e = new Error(
        `قاعدة البيانات تحتاج تحديثاً (${state.pending.join(', ')}) يقوم به برنامج التثبيت بعد نسخة احتياطية موثقة. شغّل برنامج تثبيت HeroMarket مرة أخرى.`
      )
      e.code = 'setup_incomplete'
      throw e
    }
    // The cloud: what its own migrations write (seed rows) is not work to send to the shop.
    const hasOutbox =
      cloud && (await pool.query("SELECT to_regclass('sync_outbox') IS NOT NULL AS ok")).rows[0].ok
    const seenBefore = hasOutbox
      ? Number((await pool.query('SELECT COALESCE(max(id), 0) AS n FROM sync_outbox')).rows[0].n)
      : 0
    await migrate(pool, { dir, logger: { info: (m) => app.log.info(m) } })
    // The cloud's users, roles and permissions are the shop's, received through the link.
    if (cloud) await app.cloudLink.prepare({ seenBefore })
    else await withTransaction(pool, (c) => ensureAccessControl(c))
  }

  app.addHook('onClose', async () => {
    await pool.end()
  })

  return { app, pool, prepare, operations }
}

module.exports = { createService, sha256, SESSION_HOURS }
