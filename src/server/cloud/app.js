'use strict'
// Cloud side of store synchronisation (stage 4 phase 4; Phase 2 milestone 1, D-101).
//
// The shop PC connects here (outbound HTTPS from the shop); nothing in the shop is reachable.
//   - the PC's row changes are stored: a row is replaced only by a strictly newer (epoch, version),
//     so duplicated, delayed and reordered batches change nothing; each batch commits all or
//     nothing and is acknowledged only after the commit;
//   - changes are accepted only for the store's current epoch, so a PC restored elsewhere cannot
//     be overwritten by an old one;
//   - the owner's queued commands of stage 4 are handed out, and marked applied only when the PC's
//     outcome row arrives.
// registerSyncRoutes() adds these routes to any Fastify app. createCloudService() is the bare
// service used by the synchronisation proof suite; the real cloud (server/app.js with role
// 'cloud', cloud/link.js) adds the same routes to the HeroMarket service and, through the hooks,
// writes every accepted row into its own copy of the store's tables.
const crypto = require('crypto')
const path = require('path')
const Fastify = require('fastify')
const { createPool, withTransaction } = require('../db/pool')
const { migrate } = require('../db/migrate')
const { ServiceError } = require('../errors')

const MIGRATIONS = path.join(__dirname, 'migrations')
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

class CloudError extends ServiceError {}

const rowSchema = {
  type: 'object',
  required: ['id', 't', 'k', 'op', 'v'],
  properties: {
    id: { type: 'integer' },
    t: { type: 'string', maxLength: 64 },
    k: { type: 'string', maxLength: 200 },
    op: { type: 'string', enum: ['upsert', 'delete'] },
    r: { type: ['string', 'null'], maxLength: 1000000 }, // the row as JSON text (exact numbers)
    p: { type: ['string', 'null'], maxLength: 1000000 }, // the row before an update (D-103)
    e: { type: 'boolean' }, // written by the shop while merging the cloud's changes (D-103)
    v: { type: 'integer', minimum: 1 }
  }
}

/** Register a store (pairing). Returns the device token, shown once. */
async function registerStore(pool, { storeId, name = '' }) {
  const token = crypto.randomBytes(32).toString('base64url')
  await pool.query('INSERT INTO cloud_stores (store_id, name, token_hash) VALUES ($1, $2, $3)', [
    storeId,
    name,
    sha256(token)
  ])
  return { storeId, token }
}

/** Queue an owner command for the store (stage 4; replaced by cloud/link.js operations). */
async function createCommand(
  pool,
  storeId,
  { id = crypto.randomUUID(), type, payload, createdBy }
) {
  await pool.query(
    'INSERT INTO cloud_commands (id, store_id, type, payload, created_by) VALUES ($1, $2, $3, $4, $5)',
    [id, storeId, type, JSON.stringify(payload || {}), createdBy || 'owner']
  )
  return id
}

/**
 * Per-table count and fingerprint of live rows of the current epoch, comparable with the PC's
 * (src/server/sync/agent.js localChecksums). Rows from older epochs never match.
 */
async function cloudChecksums(db, storeId, epoch) {
  const { rows } = await db.query(
    `SELECT table_name,
            count(*)::int AS rows,
            md5(string_agg(pk || ':' || epoch || ':' || version, ',' ORDER BY pk COLLATE "C")) AS hash
       FROM cloud_rows WHERE store_id = $1 AND NOT deleted
      GROUP BY table_name`,
    [storeId]
  )
  return Object.fromEntries(rows.map((r) => [r.table_name, { rows: r.rows, hash: r.hash, epoch }]))
}

/**
 * The routes the shop PC calls. `hooks`:
 *   beforeCommit(db, batch)       failure injection for tests (may throw)
 *   onEpoch(db, store, epoch)     a new epoch starts (everything will be sent again)
 *   onAccepted(db, rows, store)   rows that were newer than what the cloud held, inside the
 *                                 batch's transaction: [{ t, k, deleted, r (JSON text) }]
 *   afterCommit(store, rows)      after a batch committed
 *   schemaCheck(version)          the calling shop's database version (may throw)
 * Returns { store } – the authenticator of the calling store, for further routes.
 */
function registerSyncRoutes(app, pool, hooks = {}) {
  /** The calling store, from its device token (constant-time compare of hashes). */
  async function store(req) {
    const id = String(req.headers['x-store-id'] || '')
    const header = String(req.headers.authorization || '')
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!/^[0-9a-f-]{36}$/i.test(id) || !token)
      throw new CloudError(401, 'unauthorized', 'unauthorized')
    const s = (await pool.query('SELECT * FROM cloud_stores WHERE store_id = $1', [id])).rows[0]
    const ok =
      s &&
      crypto.timingSafeEqual(Buffer.from(s.token_hash, 'hex'), Buffer.from(sha256(token), 'hex'))
    if (!ok) throw new CloudError(401, 'unauthorized', 'unauthorized')
    if (hooks.schemaCheck) await hooks.schemaCheck(req.headers['x-heromarket-schema'])
    await pool.query('UPDATE cloud_stores SET last_seen_at = now() WHERE store_id = $1', [id])
    return s
  }

  // A new epoch: first registration, or a PC that restored a backup. Older epochs stop being
  // accepted from here on.
  app.post('/api/sync.epoch', async (req) => {
    const s = await store(req)
    return withTransaction(pool, async (db) => {
      const { rows } = await db.query(
        `UPDATE cloud_stores SET max_epoch = max_epoch + 1, current_epoch = max_epoch + 1
          WHERE store_id = $1 RETURNING current_epoch`,
        [s.store_id]
      )
      if (hooks.onEpoch) await hooks.onEpoch(db, s, rows[0].current_epoch)
      return { epoch: rows[0].current_epoch }
    })
  })

  app.post(
    '/api/sync.push',
    {
      bodyLimit: 16 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['epoch', 'rows'],
          properties: {
            epoch: { type: 'integer', minimum: 1 },
            rows: { type: 'array', maxItems: 5000, items: rowSchema },
            // Changes the PC still has to send after this batch.
            pending: { type: 'integer', minimum: 0 },
            seen: { type: 'number', minimum: 0 }
          }
        }
      }
    },
    async (req) => {
      const s = await store(req)
      const { epoch, rows } = req.body
      const answer = await withTransaction(pool, async (db) => {
        // Serialise batches of one store, and refuse a stale epoch inside the same transaction.
        const cur = (
          await db.query('SELECT current_epoch FROM cloud_stores WHERE store_id = $1 FOR UPDATE', [
            s.store_id
          ])
        ).rows[0]
        if (cur.current_epoch !== epoch)
          throw new CloudError(
            409,
            'stale_epoch',
            `epoch ${epoch} is not the store's current epoch (${cur.current_epoch})`
          )
        // Which of these changes are new here: newer than what is stored for their row. Every one of
        // them is handed on in the order it was made (a running total needs each step, D-103).
        const stored = new Map(
          (
            await db.query(
              `SELECT table_name || chr(1) || pk AS id, epoch, version FROM cloud_rows
                WHERE store_id = $1 AND (table_name, pk) IN
                      (SELECT x.t, x.k FROM jsonb_to_recordset($2::jsonb) AS x(t text, k text))`,
              [s.store_id, JSON.stringify(rows.map((x) => ({ t: x.t, k: x.k })))]
            )
          ).rows.map((r) => [r.id, r])
        )
        const fresh = [...rows]
          .sort((a, b) => a.v - b.v)
          .filter((x) => {
            const had = stored.get(`${x.t}\u0001${x.k}`)
            return !had || had.epoch < epoch || (had.epoch === epoch && Number(had.version) < x.v)
          })
        // Newest version per row within the batch, then keep whichever of (stored, incoming) is
        // newer. Re-sent, duplicated or reordered rows are therefore no-ops.
        const accepted = await db.query(
          `INSERT INTO cloud_rows (store_id, table_name, pk, epoch, version, deleted, row_data, received_at)
           SELECT DISTINCT ON (x.t, x.k) $1, x.t, x.k, $2, x.v, x.op = 'delete',
                  CASE WHEN x.op = 'delete' THEN NULL ELSE x.r::jsonb END, now()
             FROM jsonb_to_recordset($3::jsonb) AS x(t text, k text, op text, r text, v bigint)
            ORDER BY x.t, x.k, x.v DESC
           ON CONFLICT (store_id, table_name, pk) DO UPDATE
              SET epoch = EXCLUDED.epoch, version = EXCLUDED.version, deleted = EXCLUDED.deleted,
                  row_data = EXCLUDED.row_data, received_at = EXCLUDED.received_at
            WHERE (cloud_rows.epoch, cloud_rows.version) < (EXCLUDED.epoch, EXCLUDED.version)
           RETURNING table_name AS t, pk AS k, deleted, row_data::text AS r, version`,
          [s.store_id, epoch, JSON.stringify(rows)]
        )
        // Outcomes of owner commands, as recorded by the PC.
        await db.query(
          `UPDATE cloud_commands c
              SET status = r.row_data->>'status', result = r.row_data->'detail',
                  applied_at = (r.row_data->>'applied_at')::timestamp
             FROM cloud_rows r
            WHERE r.store_id = $1 AND r.table_name = 'applied_commands' AND NOT r.deleted
              AND c.store_id = r.store_id AND c.id::text = r.pk AND c.status = 'pending'
              AND r.pk = ANY($2::text[])`,
          [s.store_id, rows.filter((x) => x.t === 'applied_commands').map((x) => x.k)]
        )
        if (hooks.onAccepted && fresh.length) await hooks.onAccepted(db, fresh, s)
        if (hooks.beforeCommit) await hooks.beforeCommit(db, req.body)
        return { acked: rows.map((x) => x.id), accepted: accepted.rows }
      })
      if (hooks.afterCommit)
        await hooks.afterCommit(s, answer.accepted, {
          pending: req.body.pending,
          seen: req.body.seen
        })
      return { acked: answer.acked }
    }
  )

  // Pending owner commands, oldest first. A command stays pending until the PC's outcome arrives,
  // so a PC that crashed before reporting will receive it again (and skip it as already applied).
  app.post('/api/sync.commands', async (req) => {
    const s = await store(req)
    const limit = Math.min(Number(req.body?.limit) || 50, 200)
    const { rows } = await pool.query(
      `SELECT id, type, payload FROM cloud_commands
        WHERE store_id = $1 AND status = 'pending' ORDER BY seq LIMIT $2`,
      [s.store_id, limit]
    )
    return { commands: rows }
  })

  // After a restore on the PC: every row (and deletion) newer than the backup's sync point, oldest
  // first, so the PC can write back what it lost. Paged by (epoch, version), which is unique.
  app.post(
    '/api/sync.recover',
    {
      schema: {
        body: {
          type: 'object',
          required: ['afterEpoch', 'afterVersion'],
          properties: {
            afterEpoch: { type: 'integer', minimum: 0 },
            afterVersion: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 5000 }
          }
        }
      }
    },
    async (req) => {
      const s = await store(req)
      const { afterEpoch, afterVersion, limit = 2000 } = req.body
      const { rows } = await pool.query(
        `SELECT table_name AS t, pk AS k, epoch, version, deleted, row_data::text AS r
           FROM cloud_rows WHERE store_id = $1 AND (epoch, version) > ($2, $3)
          ORDER BY epoch, version LIMIT $4`,
        [s.store_id, afterEpoch, afterVersion, limit]
      )
      return {
        rows: rows.map((x) => ({ ...x, version: Number(x.version) }))
      }
    }
  )

  app.post('/api/sync.checksums', async (req) => {
    const s = await store(req)
    return {
      epoch: s.current_epoch,
      tables: await cloudChecksums(pool, s.store_id, s.current_epoch)
    }
  })

  return { store }
}

/**
 * The bare synchronisation service (proof suite, local test cloud).
 * @param {object} cfg
 * @param {string} cfg.databaseUrl
 * @param {object|boolean} [cfg.logger]
 * @param {object} [cfg.hooks] see registerSyncRoutes
 */
async function createCloudService(cfg) {
  const app = Fastify({
    logger: cfg.logger ?? { level: 'info', redact: ['req.headers.authorization'] },
    bodyLimit: 16 * 1024 * 1024
  })
  const pool = createPool(cfg.databaseUrl, { logger: app.log, max: cfg.poolSize })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof CloudError)
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } })
    if (err.validation)
      return reply.status(400).send({ error: { code: 'bad_request', message: err.message } })
    req.log.error({ err }, 'cloud error')
    return reply.status(500).send({ error: { code: 'internal', message: 'internal error' } })
  })

  registerSyncRoutes(app, pool, cfg.hooks || {})

  async function prepare() {
    await migrate(pool, { dir: MIGRATIONS, logger: { info: (m) => app.log.info(m) } })
  }

  app.addHook('onClose', async () => {
    await pool.end()
  })

  return { app, pool, prepare }
}

module.exports = {
  createCloudService,
  registerSyncRoutes,
  registerStore,
  createCommand,
  cloudChecksums,
  sha256,
  CloudError,
  MIGRATIONS
}
