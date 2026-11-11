'use strict'
// The cloud's end of the shop's link (Phase 2 milestone 1, D-101).
//
// One business, two ways in. While the shop is reachable, this side never decides anything about
// the business itself:
//   - it keeps a copy of the store's tables, written from the rows the shop PC sends
//     (cloud/app.js routes; applyRecovered writes them as they are), and answers reads from it;
//   - every change a signed-in user makes is handed to the shop PC, which carries it out by the
//     operation's own handler in the shop's database (sync/remoteOps.js); the answer comes back
//     here, after the changed rows have arrived, and goes to the user.
// Only the shop PC opens connections: it keeps one request open (link.wait) that returns the
// moment an operation is waiting. That open request is also how this side knows the shop is
// reachable.
//
// An operation is handed over at most once and carried out at most once:
//   queued → sent → applied | refused | not_executed        (or queued → withdrawn)
// If the answer does not come back, the operation stays "sent" – shown to the user as waiting for
// the shop's confirmation – and is never carried out here instead. On its next contact the shop PC
// is asked about every "sent" operation and answers from its own record.
const crypto = require('crypto')
const { withTransaction } = require('../db/pool')
const { migrate } = require('../db/migrate')
const { ServiceError, notFound } = require('../errors')
const { applyRecovered } = require('../sync/recovery')
const { SECRET_BODY, withoutSecrets } = require('../sync/operationKinds')
const { registerSyncRoutes, MIGRATIONS } = require('./app')
const { pair } = require('./pairing')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v))

const UNREACHABLE =
  'المتجر غير متصل الآن، فلم تُنفَّذ العملية ولم يتغير شيء. حاول مرة أخرى عند عودة الاتصال.'
const PENDING =
  'أُرسلت العملية إلى المتجر ولم يصل تأكيد تنفيذها بعد. ستظهر نتيجتها عند عودة الاتصال؛ لا تكررها.'
const NOT_EXECUTED = 'تعذر تنفيذ العملية في المتجر ولم يتغير شيء. حاول مرة أخرى.'

module.exports = function cloudLink(app, cfg) {
  const pool = app.pool
  // How long after the shop's last contact it still counts as reachable (it holds a request open
  // for 25 seconds at a time), and how long a user's request waits for the shop's answer.
  const graceMs = cfg.linkGraceMs ?? 40000
  const forwardMs = cfg.forwardTimeoutMs ?? 20000

  const live = {
    held: 0, // requests the shop PC is holding open right now
    lastContact: 0, // when it last called (ms)
    wake: new Set(), // resolvers of held link.wait requests
    answers: new Map(), // operation id → resolver of the user's waiting request
    bodies: new Map(), // operation id → data kept out of the database (passwords)
    seq: 0, // grows whenever the copy or the link's state changes
    watchers: new Set()
  }
  const changed = () => {
    live.seq += 1
    for (const w of [...live.watchers]) w()
  }
  const reachable = () => live.held > 0 || Date.now() - live.lastContact < graceMs

  async function theStore(db = pool) {
    return (await db.query('SELECT * FROM cloud_stores ORDER BY created_at LIMIT 1')).rows[0]
  }

  // ── The copy of the store ────────────────────────────────────
  const { store } = registerSyncRoutes(app, pool, {
    ...(cfg.cloudHooks || {}),
    // A new epoch: the shop sends everything again; what is here is replaced, not mixed.
    onEpoch: async (db) => {
      const tables = (await db.query('SELECT table_name FROM sync_tables')).rows.map(
        (r) => `"${r.table_name}"`
      )
      await db.query("SELECT set_config('hm.sync_capture', 'off', true)")
      await db.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`)
    },
    onAccepted: async (db, rows) => {
      // A user whose password changed or who was disabled is signed out here too.
      const ids = rows.filter((r) => r.t === 'users' && !r.deleted).map((r) => Number(r.k))
      const before = ids.length
        ? (
            await db.query(
              'SELECT id, password_scrypt, is_active FROM users WHERE id = ANY($1::int[])',
              [ids]
            )
          ).rows
        : []
      await applyRecovered(db, rows, { fixStock: false })
      if (before.length)
        await db.query(
          `UPDATE sessions s SET revoked_at = LOCALTIMESTAMP(0)
             FROM users u, jsonb_to_recordset($1::jsonb) AS b(id int, password_scrypt text, is_active boolean)
            WHERE u.id = b.id AND s.user_id = u.id AND s.revoked_at IS NULL
              AND (NOT u.is_active OR u.password_scrypt IS DISTINCT FROM b.password_scrypt)`,
          [JSON.stringify(before)]
        )
      if (cfg.cloudHooks?.onAccepted) await cfg.cloudHooks.onAccepted(db, rows)
    },
    afterCommit: async (s, rows, waiting) => {
      await report(s.store_id, waiting, null, true)
      if (rows.length) changed()
    }
  })

  /**
   * What the shop last said about itself. Its count of changes still to send arrives on two paths
   * (the open link and each batch) and may arrive out of order: the report that saw more of the
   * shop's changes wins, and of two that saw the same, the smaller count (more was sent since).
   */
  async function report(storeId, waiting, health, pushed = false) {
    await withTransaction(pool, async (db) => {
      const cur =
        (
          await db.query('SELECT health FROM cloud_stores WHERE store_id = $1 FOR UPDATE', [
            storeId
          ])
        ).rows[0]?.health || {}
      const next = { ...cur, ...(health || {}) }
      const seen = Number(waiting?.seen ?? -1)
      const had = Number(cur.seen ?? -1)
      if (waiting && Number.isInteger(waiting.pending)) {
        if (seen > had) Object.assign(next, { pending: waiting.pending, seen })
        else if (seen === had)
          next.pending = Math.min(Number(cur.pending ?? Infinity), waiting.pending)
        else Object.assign(next, { pending: cur.pending, seen: cur.seen })
      } else Object.assign(next, { pending: cur.pending, seen: cur.seen })
      await db.query(
        `UPDATE cloud_stores SET health = $2,
                last_push_at = CASE WHEN $3 THEN now() ELSE last_push_at END,
                synced_at = CASE WHEN $4 THEN now() ELSE synced_at END
          WHERE store_id = $1`,
        [storeId, JSON.stringify(next), pushed, next.pending === 0]
      )
    })
  }

  // ── Pairing (D-102): the only call a shop PC makes without a device token ──
  app.post(
    '/api/link.pair',
    {
      schema: {
        body: {
          type: 'object',
          required: ['code', 'storeId', 'secretHash'],
          properties: {
            code: { type: 'string', minLength: 8, maxLength: 40 },
            storeId: { type: 'string', minLength: 36, maxLength: 36 },
            secretHash: { type: 'string', minLength: 64, maxLength: 64 },
            name: { type: 'string', maxLength: 120 }
          }
        }
      }
    },
    async (req) => {
      const r = await pair(pool, req.body)
      live.lastContact = 0 // whoever held the link before must present the new secret
      changed()
      return r
    }
  )

  // ── The shop PC's side of the hand-over ──────────────────────
  async function settle(id, r) {
    const status =
      r.status === 'applied' ? 'applied' : r.status === 'refused' ? 'refused' : 'not_executed'
    const done = await pool.query(
      `UPDATE cloud_operations SET status = $2, http_status = $3, result = $4, error = $5, done_at = now()
        WHERE id = $1 AND status IN ('queued', 'sent') RETURNING id`,
      [id, status, r.httpStatus || null, json(withoutSecrets(r.body)), json(r.error)]
    )
    live.bodies.delete(id)
    const answer = live.answers.get(id)
    if (answer) answer({ ...r, status })
    return done.rowCount
  }

  const resultSchema = {
    type: 'object',
    required: ['id', 'status'],
    properties: {
      id: { type: 'string', maxLength: 36 },
      status: { type: 'string', enum: ['applied', 'refused', 'failed'] },
      httpStatus: { type: 'integer' },
      body: {},
      error: {}
    }
  }

  // The shop PC reports what it carried out, and which "sent" operations it has no record of.
  app.post(
    '/api/link.results',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            results: { type: 'array', maxItems: 200, items: resultSchema },
            unknown: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 36 } }
          }
        }
      }
    },
    async (req) => {
      await store(req)
      live.lastContact = Date.now()
      let n = 0
      for (const r of req.body.results || []) if (UUID.test(r.id)) n += await settle(r.id, r)
      for (const id of req.body.unknown || [])
        if (UUID.test(id))
          n += await settle(id, {
            status: 'not_executed',
            error: { code: 'not_executed', message: NOT_EXECUTED }
          })
      if (n) changed()
      return { settled: n }
    }
  )

  // The request the shop PC keeps open. It carries the shop's health, and returns the operations
  // waiting for it (now "sent") and the ids it must account for.
  app.post(
    '/api/link.wait',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            timeoutMs: { type: 'integer', minimum: 0, maximum: 60000 },
            health: { type: 'object' }
          }
        }
      }
    },
    async (req) => {
      const s = await store(req)
      const wasReachable = reachable()
      live.lastContact = Date.now()
      live.held += 1
      try {
        const { pending, seen, ...health } = req.body.health || {}
        await report(s.store_id, { pending, seen }, health)
        if (!wasReachable) changed()
        // Handed over before and never answered: the shop PC looks them up in its own record.
        const check = (
          await pool.query(
            "SELECT id FROM cloud_operations WHERE store_id = $1 AND status = 'sent' ORDER BY seq LIMIT 200",
            [s.store_id]
          )
        ).rows.map((r) => r.id)
        const take = async () =>
          (
            await pool.query(
              `UPDATE cloud_operations o SET status = 'sent', sent_at = now()
                WHERE o.id IN (SELECT id FROM cloud_operations WHERE store_id = $1 AND status = 'queued'
                                ORDER BY seq LIMIT 20 FOR UPDATE SKIP LOCKED)
              RETURNING o.id, o.seq, o.operation, o.body, o.user_id, o.username, o.terminal`,
              [s.store_id]
            )
          ).rows.sort((a, b) => Number(a.seq) - Number(b.seq))
        let ops = await take()
        if (!ops.length && !check.length && (req.body.timeoutMs ?? 25000) > 0) {
          await new Promise((resolve) => {
            const done = () => {
              clearTimeout(timer)
              live.wake.delete(done)
              resolve()
            }
            const timer = setTimeout(done, req.body.timeoutMs ?? 25000)
            live.wake.add(done)
            req.raw.on?.('close', done)
          })
          ops = await take()
        }
        const out = []
        for (const o of ops) {
          const body = SECRET_BODY.has(o.operation) ? live.bodies.get(o.id) : o.body
          if (body === undefined) {
            // Its data was never stored and this process restarted: it cannot be carried out.
            await settle(o.id, {
              status: 'not_executed',
              error: { code: 'not_executed', message: NOT_EXECUTED }
            })
            continue
          }
          out.push({
            id: o.id,
            operation: o.operation,
            body: body || {},
            userId: o.user_id,
            username: o.username,
            terminal: o.terminal
          })
        }
        return { ops: out, check }
      } finally {
        live.held -= 1
        live.lastContact = Date.now()
      }
    }
  )

  // ── A signed-in user's change: carried out in the shop ───────
  function answerOf(row) {
    if (row.status === 'applied') return row.result === null ? { ok: true } : row.result
    if (row.status === 'refused')
      throw new ServiceError(
        row.http_status || 409,
        row.error?.code || 'refused',
        row.error?.message || 'رفض المتجر العملية.',
        row.error?.details
      )
    if (row.status === 'not_executed' || row.status === 'withdrawn')
      throw new ServiceError(502, 'not_executed', NOT_EXECUTED, { operationId: row.id })
    throw new ServiceError(504, 'pending_confirmation', PENDING, { operationId: row.id })
  }

  async function forward({ def, auth, body, req }) {
    const s = await theStore()
    if (!s || !reachable() || s.health?.ok === false)
      throw new ServiceError(503, 'shop_unreachable', UNREACHABLE)
    // The caller's id for this attempt (a retry sends the same one), or a new one.
    const given = String(req.headers['x-heromarket-operation-id'] || '')
    const id = UUID.test(given) ? given.toLowerCase() : crypto.randomUUID()
    const terminal = String(req.headers['x-heromarket-terminal'] || 'الإنترنت').slice(0, 80)
    const secret = SECRET_BODY.has(def.name)
    if (secret) live.bodies.set(id, body)
    const created = await pool.query(
      `INSERT INTO cloud_operations (id, store_id, operation, body, user_id, username, terminal)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [
        id,
        s.store_id,
        def.name,
        secret ? null : json(body),
        auth.user.id,
        auth.user.username,
        terminal
      ]
    )
    if (!created.rowCount) {
      // The same attempt again: its one outcome, never a second operation.
      const prior = (await pool.query('SELECT * FROM cloud_operations WHERE id = $1', [id])).rows[0]
      if (prior.user_id !== auth.user.id || prior.operation !== def.name)
        throw new ServiceError(409, 'conflict', 'رقم العملية مستخدم لعملية أخرى.')
      if (!['queued', 'sent'].includes(prior.status)) return answerOf(prior)
    }
    const answer = new Promise((resolve) => {
      const timer = setTimeout(() => {
        live.answers.delete(id)
        resolve(null)
      }, forwardMs)
      live.answers.set(id, (r) => {
        clearTimeout(timer)
        live.answers.delete(id)
        resolve(r)
      })
    })
    for (const w of [...live.wake]) w()
    const r = await answer
    if (r) {
      if (r.status === 'applied')
        return r.body === null || r.body === undefined ? { ok: true } : r.body
      if (r.status === 'refused')
        throw new ServiceError(
          r.httpStatus || 409,
          r.error?.code || 'refused',
          r.error?.message || 'رفض المتجر العملية.',
          r.error?.details
        )
      throw new ServiceError(502, 'not_executed', NOT_EXECUTED, { operationId: id })
    }
    // No answer in time. Never handed over: taken back, nothing happened. Handed over: unknown.
    const back = await pool.query(
      "UPDATE cloud_operations SET status = 'withdrawn', done_at = now() WHERE id = $1 AND status = 'queued' RETURNING id",
      [id]
    )
    if (back.rowCount) {
      live.bodies.delete(id)
      throw new ServiceError(503, 'shop_unreachable', UNREACHABLE)
    }
    const now = (await pool.query('SELECT * FROM cloud_operations WHERE id = $1', [id])).rows[0]
    return answerOf(now)
  }

  // ── What the screens ask about the link ──────────────────────
  async function describe() {
    const s = await theStore()
    const open = s
      ? (
          await pool.query(
            `SELECT count(*) FILTER (WHERE status = 'sent')::int AS waiting,
                    count(*) FILTER (WHERE status = 'queued')::int AS queued
               FROM cloud_operations WHERE store_id = $1 AND status IN ('queued', 'sent')`,
            [s.store_id]
          )
        ).rows[0]
      : { waiting: 0, queued: 0 }
    const up = !!s && reachable() && s.health?.ok !== false
    const pending = Number(s?.health?.pending ?? 0)
    return {
      linked: !!s,
      reachable: up,
      // live: the shop is reachable and has nothing left to send; delayed: reachable, with
      // changes still on their way; unavailable: what is shown is as of lastSyncedAt.
      freshness: !up ? 'unavailable' : pending > 0 ? 'delayed' : 'live',
      lastSeenAt: s?.last_seen_at || null,
      lastSyncedAt: s?.synced_at || null,
      lastChangeAt: s?.last_push_at || null,
      pendingChanges: pending,
      waitingOperations: open.waiting,
      seq: live.seq
    }
  }

  app.operation({ name: 'link.state', handler: async () => describe() })

  // Returns when something changed (the copy, an operation's outcome, the shop's reachability) or
  // after timeoutMs: the screens keep one such request open instead of polling.
  app.operation({
    name: 'link.watch',
    schema: {
      type: 'object',
      properties: {
        after: { type: 'integer', minimum: 0 },
        timeoutMs: { type: 'integer', minimum: 0, maximum: 60000 }
      }
    },
    handler: async (ctx, { after = 0, timeoutMs = 25000 }) => {
      if (live.seq <= after && timeoutMs > 0)
        await new Promise((resolve) => {
          const done = () => {
            clearTimeout(timer)
            live.watchers.delete(done)
            resolve()
          }
          const timer = setTimeout(done, timeoutMs)
          live.watchers.add(done)
        })
      return describe()
    }
  })

  // The outcome of an operation by its id (after "waiting for the shop's confirmation").
  app.operation({
    name: 'link.operation',
    schema: {
      type: 'object',
      required: ['operationId'],
      properties: { operationId: { type: 'string', minLength: 36, maxLength: 36 } }
    },
    handler: async (ctx, { operationId }) => {
      const o = UUID.test(operationId)
        ? (await pool.query('SELECT * FROM cloud_operations WHERE id = $1', [operationId])).rows[0]
        : null
      if (!o || (o.user_id !== ctx.user.id && !ctx.can('sync.manage')))
        throw notFound('العملية غير موجودة.')
      return {
        id: o.id,
        operation: o.operation,
        status: o.status,
        // waiting: handed to the shop, outcome not established yet
        waiting: o.status === 'sent',
        result: o.status === 'applied' ? o.result : null,
        error: o.error || null,
        createdAt: o.created_at,
        doneAt: o.done_at
      }
    }
  })

  // Operations that are waiting or need a look, newest first.
  app.operation({
    name: 'link.operations',
    handler: async (ctx) => {
      const all = ctx.can('sync.manage')
      return (
        await pool.query(
          `SELECT id, operation, username, status, error, created_at, sent_at, done_at
             FROM cloud_operations
            WHERE ($1 OR user_id = $2) AND status IN ('queued', 'sent', 'not_executed')
            ORDER BY seq DESC LIMIT 200`,
          [all, ctx.user.id]
        )
      ).rows
    }
  })

  app.decorate('cloudLink', {
    forward,
    describe,
    reachable,
    // The cloud's own tables, recorded apart from the store's migrations in the same database.
    prepare: () =>
      migrate(pool, {
        dir: MIGRATIONS,
        table: 'cloud_schema_migrations',
        logger: { info: (m) => app.log.info(m) }
      }),
    transaction: (fn) => withTransaction(pool, fn)
  })
}
