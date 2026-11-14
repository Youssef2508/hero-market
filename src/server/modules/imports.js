'use strict'
// Import jobs (1.6.3, D-108; migration 0038): the store's Excel file imported in the background.
//
// imports.start stores the rows the screen read from the file as a job and answers at once; the
// job is carried out here by src/server/imports/runner.js, whether or not the page stays open.
// The screens follow it with imports.get / imports.list and may cancel it with imports.cancel.
//
// From the website the job is started in the shop while it can be reached (like every change,
// D-101) and followed in the cloud's copy, which receives the job's progress with the shop's
// other changes; while the shop cannot be reached the cloud carries it out itself (D-103).
//
// Who sees a job: the person who started it, and the administrators. Another user asking for a
// job's id is answered "not found", as for a job that does not exist (a job's id is not a key).
// Permission data.import for all four.
const crypto = require('crypto')
const { ServiceError, badRequest, conflict, notFound } = require('../errors')
const { ImportRunner } = require('../imports/runner')

const rowSchema = { type: 'object', properties: { row: { type: 'integer' } } }
const list = (max) => ({ type: 'array', maxItems: max, items: rowSchema })
const ADMINS = ['super_admin', 'store_admin']

const COLUMNS = `id, user_id, username, filename, status, stage, total_rows, processed_rows,
  successful_rows, failed_rows, skipped_rows, summary, error_code, error_message, cancel_requested,
  attempts, created_at, started_at, heartbeat_at, finished_at, jsonb_array_length(errors) AS errors_count,
  EXTRACT(epoch FROM COALESCE(finished_at, LOCALTIMESTAMP(0)) - COALESCE(started_at, created_at))::int AS elapsed_seconds,
  EXTRACT(epoch FROM LOCALTIMESTAMP(0) - COALESCE(heartbeat_at, created_at))::int AS quiet_seconds`

function describe(r, { errors } = {}) {
  return {
    id: r.id,
    username: r.username,
    filename: r.filename,
    status: r.status,
    stage: r.stage,
    totalRows: r.total_rows,
    processedRows: r.processed_rows,
    successfulRows: r.successful_rows,
    failedRows: r.failed_rows,
    skippedRows: r.skipped_rows,
    summary: r.summary || null,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    errorsCount: r.errors_count ?? 0,
    cancelRequested: r.cancel_requested,
    attempts: r.attempts,
    createdAt: r.created_at,
    startedAt: r.started_at,
    heartbeatAt: r.heartbeat_at,
    finishedAt: r.finished_at,
    elapsedSeconds: r.elapsed_seconds ?? null,
    // Seconds since the job last reported (a running job reports every batch).
    quietSeconds: r.quiet_seconds ?? null,
    ...(errors ? { errors } : {})
  }
}

/** The job if this user may see it (their own, or any for an administrator). */
async function visibleJob(db, ctx, id, { lock = false, errors = false } = {}) {
  const r = (
    await db.query(
      `SELECT ${COLUMNS}${errors ? ', errors' : ''} FROM import_jobs WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id]
    )
  ).rows[0]
  if (!r || (r.user_id !== ctx.user.id && !ADMINS.includes(ctx.user.roleKey)))
    throw notFound('عملية الاستيراد غير موجودة.')
  return r
}

module.exports = function importsModule(app) {
  const cfg = app.config
  const runner = new ImportRunner({
    pool: app.pool,
    pollMs: cfg.importPollMs || 5000,
    onStep: cfg.importOnStep || null,
    log: (m, level = 'info') => app.log[level](m)
  })
  app.decorate('importRunner', runner)
  if (cfg.importJobs !== false) {
    app.addHook('onReady', async () => runner.start())
    // A running job is undone and stays open for the next start (runner.js).
    app.addHook('preClose', async () => runner.stop())
  }

  app.operation({
    name: 'imports.start',
    permission: 'data.import',
    bodyLimit: 64 * 1024 * 1024,
    schema: {
      type: 'object',
      required: ['id'],
      properties: {
        // Made by the screen: sending the same start again never makes a second job.
        id: { type: 'string', format: 'uuid' },
        filename: { type: 'string', maxLength: 200 },
        products: list(20000),
        customers: list(20000),
        suppliers: list(2000),
        // The same rows were imported before: only when the person confirmed it.
        allowRepeat: { type: 'boolean' }
      }
    },
    handler: async (ctx, body) => {
      const rows = {
        products: body.products || [],
        customers: body.customers || [],
        suppliers: body.suppliers || []
      }
      const total = rows.products.length + rows.customers.length + rows.suppliers.length
      if (!total) throw badRequest('لا توجد صفوف للاستيراد.')
      const id = body.id.toLowerCase()
      const hash = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
      // Only the file's own name, never a path.
      const filename = String(body.filename || '')
        .split(/[\\/]/)
        .pop()
        .replace(/\p{Cc}/gu, '')
        .slice(0, 120)
      const job = await ctx.tx(async (db) => {
        // One start at a time, so two starts cannot both see "nothing running".
        await db.query("SELECT pg_advisory_xact_lock(hashtext('hm_import_start'))")
        const same = (await db.query('SELECT user_id FROM import_jobs WHERE id = $1', [id])).rows[0]
        if (same) {
          if (same.user_id !== ctx.user.id) throw conflict('رقم عملية الاستيراد مستخدم.')
          return visibleJob(db, ctx, id)
        }
        const open = (
          await db.query(
            "SELECT username, filename FROM import_jobs WHERE status IN ('queued', 'processing') ORDER BY created_at LIMIT 1"
          )
        ).rows[0]
        if (open)
          throw new ServiceError(
            409,
            'import_running',
            `يوجد استيراد لم ينتهِ بعد (${open.filename || 'ملف'} – ${open.username || ''}). انتظر حتى ينتهي أو ألغِه.`
          )
        if (!body.allowRepeat) {
          const before = (
            await db.query(
              "SELECT finished_at FROM import_jobs WHERE content_hash = $1 AND status = 'completed' ORDER BY finished_at DESC LIMIT 1",
              [hash]
            )
          ).rows[0]
          if (before)
            throw new ServiceError(
              409,
              'already_imported',
              `نفس هذا الملف استُورد من قبل (${before.finished_at}).`
            )
        }
        await db.query(
          `INSERT INTO import_jobs (id, user_id, username, terminal, filename, content_hash, total_rows)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, ctx.user.id, ctx.user.username, ctx.terminal, filename, hash, total]
        )
        await db.query('INSERT INTO import_job_data (job_id, rows) VALUES ($1, $2)', [
          id,
          JSON.stringify(rows)
        ])
        return visibleJob(db, ctx, id)
      })
      // After the commit: the runner finds the job (a runner of another process does within seconds).
      runner.kick()
      return describe(job)
    }
  })

  app.operation({
    name: 'imports.get',
    permission: 'data.import',
    schema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        // The problems found in the file: for the error report.
        withErrors: { type: 'boolean' }
      }
    },
    handler: async (ctx, { id, withErrors }) => {
      const r = await visibleJob(ctx.pool, ctx, id.toLowerCase(), { errors: !!withErrors })
      return describe(r, { errors: withErrors ? r.errors : undefined })
    }
  })

  // The open jobs and the latest ones: the screen's history, and what it follows after a reload.
  app.operation({
    name: 'imports.list',
    permission: 'data.import',
    schema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }
    },
    handler: async (ctx, { limit = 20 }) => {
      const all = ADMINS.includes(ctx.user.roleKey)
      const { rows } = await ctx.pool.query(
        `SELECT ${COLUMNS} FROM import_jobs ${all ? '' : 'WHERE user_id = $2'}
          ORDER BY (status IN ('queued', 'processing')) DESC, created_at DESC LIMIT $1`,
        all ? [limit] : [limit, ctx.user.id]
      )
      return { jobs: rows.map((r) => describe(r)) }
    }
  })

  app.operation({
    name: 'imports.cancel',
    permission: 'data.import',
    schema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } }
    },
    handler: async (ctx, { id }) => {
      const job = await ctx.tx(async (db) => {
        const r = await visibleJob(db, ctx, id.toLowerCase(), { lock: true })
        if (r.status === 'queued') {
          await db.query('DELETE FROM import_job_data WHERE job_id = $1', [r.id])
          await db.query(
            `UPDATE import_jobs SET status = 'cancelled', stage = 'cancelled', cancel_requested = true,
                    finished_at = LOCALTIMESTAMP(0) WHERE id = $1`,
            [r.id]
          )
        } else if (r.status === 'processing')
          // The runner stops at its next batch and undoes everything (runner.js).
          await db.query('UPDATE import_jobs SET cancel_requested = true WHERE id = $1', [r.id])
        else
          throw new ServiceError(
            409,
            'import_finished',
            'انتهت عملية الاستيراد هذه بالفعل ولا يمكن إلغاؤها.'
          )
        return visibleJob(db, ctx, r.id)
      })
      return describe(job)
    }
  })
}
