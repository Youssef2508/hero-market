'use strict'
// HeroMarket service: owns the PostgreSQL connection, authenticates staff, authorises every operation.
// The same instance runs in-process inside the desktop app (standalone store) or as a network service
// for several terminals (see .docs/ARCHITECTURE.md and .docs/DATABASE_ARCHITECTURE.md).
const crypto = require('crypto')
const Fastify = require('fastify')
const { createPool, withTransaction } = require('./db/pool')
const { migrate, DEFAULT_DIR } = require('./db/migrate')
const { ensureAccessControl, describeUser } = require('./auth/access')
const { ServiceError, unauthorized, forbidden, fromDatabaseError } = require('./errors')
const { KEYS } = require('./auth/permissions')

const SESSION_HOURS = 12

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

/**
 * @param {object} cfg
 * @param {string} cfg.databaseUrl  PostgreSQL connection string
 * @param {string} cfg.secret       server secret (≥ 32 chars) for PIN lookup keys
 * @param {string} [cfg.timeZone]   store time zone for LOCALTIMESTAMP (default: this machine's)
 * @param {string} [cfg.migrationsDir]
 * @param {object|boolean} [cfg.logger] fastify/pino logger options
 */
async function createService(cfg) {
  if (!cfg.secret || String(cfg.secret).length < 32)
    throw new Error('HEROMARKET_SECRET must be at least 32 characters')
  const timeZone = cfg.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const app = Fastify({
    logger: cfg.logger ?? {
      level: process.env.HEROMARKET_LOG_LEVEL || 'info',
      redact: ['req.headers.authorization', 'body.pin']
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
    app.post(
      `/api/${def.name}`,
      { schema: def.schema ? { body: def.schema } : undefined },
      async (req) => {
        let auth = null
        if (!def.public) {
          auth = await authenticate(req)
          // `permission` = all required; `anyPermission` = at least one.
          if (perms.length && !perms.every((p) => auth.user.permissions.includes(p)))
            throw forbidden()
          if (
            def.anyPermission &&
            !def.anyPermission.some((p) => auth.user.permissions.includes(p))
          )
            throw forbidden()
        }
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
          sessionHours: SESSION_HOURS,
          secret: cfg.secret
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
    await migrate(pool, {
      dir: cfg.migrationsDir || DEFAULT_DIR,
      logger: { info: (m) => app.log.info(m) }
    })
    await withTransaction(pool, (c) => ensureAccessControl(c))
  }

  app.addHook('onClose', async () => {
    await pool.end()
  })

  return { app, pool, prepare, operations }
}

module.exports = { createService, sha256, SESSION_HOURS }
