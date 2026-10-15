'use strict'
// Cloud side of store synchronisation (stage 4 phase 4). Phase 4 runs it only locally, as the test
// cloud for the failure-injection suite; no cloud resource exists (hosting awaits the owner's
// approval, D-043). Phase 5 adds the owner's web app (TOTP) on top of it.
//
// The PC is the only writer of store data. This service:
//   - stores the PC's row changes: a row is replaced only by a strictly newer (epoch, version), so
//     duplicated, delayed and reordered batches change nothing; each batch commits all or nothing
//     and is acknowledged only after the commit;
//   - accepts changes only for the store's current epoch, so a PC restored elsewhere cannot be
//     overwritten by an old one;
//   - hands out the owner's queued commands, and marks them applied only when the PC's outcome
//     row arrives.
// Only the PC connects here (outbound HTTPS from the shop); nothing in the shop is reachable.
const crypto = require('crypto')
const path = require('path')
const Fastify = require('fastify')
const { createPool, withTransaction } = require('../db/pool')
const { migrate } = require('../db/migrate')

const MIGRATIONS = path.join(__dirname, 'migrations')
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

class CloudError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const rowSchema = {
  type: 'object',
  required: ['id', 't', 'k', 'op', 'v'],
  properties: {
    id: { type: 'integer' },
    t: { type: 'string', maxLength: 64 },
    k: { type: 'string', maxLength: 200 },
    op: { type: 'string', enum: ['upsert', 'delete'] },
    r: { type: ['string', 'null'], maxLength: 1000000 }, // the row as JSON text (exact numbers)
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

/** Queue an owner command for the store (phase 5: from the owner's authenticated web app). */
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
 * @param {object} cfg
 * @param {string} cfg.databaseUrl
 * @param {object|boolean} [cfg.logger]
 * @param {object} [cfg.hooks] failure injection for tests: beforeCommit(db, batch) may throw
 */
async function createCloudService(cfg) {
  const app = Fastify({
    logger: cfg.logger ?? { level: 'info', redact: ['req.headers.authorization'] },
    bodyLimit: 16 * 1024 * 1024
  })
  const pool = createPool(cfg.databaseUrl, { logger: app.log, max: cfg.poolSize })
  const hooks = cfg.hooks || {}

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof CloudError)
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } })
    if (err.validation)
      return reply.status(400).send({ error: { code: 'bad_request', message: err.message } })
    req.log.error({ err }, 'cloud error')
    return reply.status(500).send({ error: { code: 'internal', message: 'internal error' } })
  })

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
    await pool.query('UPDATE cloud_stores SET last_seen_at = now() WHERE store_id = $1', [id])
    return s
  }

  // A new epoch: first registration, or a PC that restored a backup. Older epochs stop being
  // accepted from here on.
  app.post('/api/sync.epoch', async (req) => {
    const s = await store(req)
    const { rows } = await pool.query(
      `UPDATE cloud_stores SET max_epoch = max_epoch + 1, current_epoch = max_epoch + 1
        WHERE store_id = $1 RETURNING current_epoch`,
      [s.store_id]
    )
    return { epoch: rows[0].current_epoch }
  })

  app.post(
    '/api/sync.push',
    {
      schema: {
        body: {
          type: 'object',
          required: ['epoch', 'rows'],
          properties: {
            epoch: { type: 'integer', minimum: 1 },
            rows: { type: 'array', maxItems: 5000, items: rowSchema }
          }
        }
      }
    },
    async (req) => {
      const s = await store(req)
      const { epoch, rows } = req.body
      return withTransaction(pool, async (db) => {
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
        // Newest version per row within the batch, then keep whichever of (stored, incoming) is
        // newer. Re-sent, duplicated or reordered rows are therefore no-ops.
        await db.query(
          `INSERT INTO cloud_rows (store_id, table_name, pk, epoch, version, deleted, row_data, received_at)
           SELECT DISTINCT ON (x.t, x.k) $1, x.t, x.k, $2, x.v, x.op = 'delete',
                  CASE WHEN x.op = 'delete' THEN NULL ELSE x.r::jsonb END, now()
             FROM jsonb_to_recordset($3::jsonb) AS x(t text, k text, op text, r text, v bigint)
            ORDER BY x.t, x.k, x.v DESC
           ON CONFLICT (store_id, table_name, pk) DO UPDATE
              SET epoch = EXCLUDED.epoch, version = EXCLUDED.version, deleted = EXCLUDED.deleted,
                  row_data = EXCLUDED.row_data, received_at = EXCLUDED.received_at
            WHERE (cloud_rows.epoch, cloud_rows.version) < (EXCLUDED.epoch, EXCLUDED.version)`,
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
        if (hooks.beforeCommit) await hooks.beforeCommit(db, req.body)
        return { acked: rows.map((x) => x.id) }
      })
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

  app.post('/api/sync.checksums', async (req) => {
    const s = await store(req)
    return {
      epoch: s.current_epoch,
      tables: await cloudChecksums(pool, s.store_id, s.current_epoch)
    }
  })

  async function prepare() {
    await migrate(pool, { dir: MIGRATIONS, logger: { info: (m) => app.log.info(m) } })
  }

  app.addHook('onClose', async () => {
    await pool.end()
  })

  return { app, pool, prepare }
}

module.exports = { createCloudService, registerStore, createCommand, cloudChecksums, sha256 }
