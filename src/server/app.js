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

const SESSION_HOURS = 12

// While a restored database waits for recovery from the cloud (stage 4 phase 4), only these
// operations run: signing in, the recovery itself, store settings, and backups.
const DURING_RECOVERY = /^(auth\.|sync\.|backup\.|settings\.public$)/

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
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
    bodyLimit: 2 * 1024 * 1024
  })
  const pool = createPool(cfg.databaseUrl, { logger: app.log, max: cfg.poolSize })
  // Every connection works in the store's local time: LOCALTIMESTAMP matches the legacy local-time text.
  pool.on('connect', (client) => {
    client.query(`SET TIME ZONE '${timeZone.replace(/'/g, '')}'`).catch(() => {})
  })

  const operations = new Map()
  const loginGuard = new Map() // key → { failures, first, lockedUntil }

  app.decorate('pool', pool)
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
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
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
      async (req) => {
        const auth = req.hmAuth || null
        const ctx = {
          pool,
          user: auth?.user || null,
          sessionId: auth?.sessionId || null,
          ip: req.ip,
          terminal: req.headers['x-heromarket-terminal'] || null,
          log: req.log,
          can: (p) => !!auth && auth.user.permissions.includes(p),
          require: (p) => {
            if (!auth || !auth.user.permissions.includes(p)) throw forbidden()
          },
          tx: (fn) => withTransaction(pool, fn),
          audit: (db, actionType, description, details) =>
            db.query(
              `INSERT INTO system_logs (timestamp, user_id, username, action_type, description, details)
             VALUES (LOCALTIMESTAMP(0), $1, $2, $3, $4, $5)`,
              [
                auth?.user.id ?? null,
                auth?.user.username ?? null,
                actionType,
                description,
                details ? JSON.stringify(details) : null
              ]
            ),
          guard: loginGuard,
          sessionHours: SESSION_HOURS,
          secret: cfg.secret,
          setupCode: cfg.setupCode || null
        }
        const result = await def.handler(ctx, req.body || {})
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

  // Feature modules
  for (const mod of require('./modules')) mod(app)

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
    await migrate(pool, { dir, logger: { info: (m) => app.log.info(m) } })
    await withTransaction(pool, (c) => ensureAccessControl(c))
  }

  app.addHook('onClose', async () => {
    await pool.end()
  })

  return { app, pool, prepare, operations }
}

module.exports = { createService, sha256, SESSION_HOURS }
