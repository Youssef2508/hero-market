'use strict'
// Carries out import jobs in the background (1.6.3, D-108; migration 0038).
//
// One job at a time per database: the runner that holds the import lock – a PostgreSQL lock kept on
// its own connection – claims the oldest open job whose rows are stored here and carries it out.
// The shop PC may run two copies of the service (the background service and the desktop program):
// whichever holds the lock works, the other waits. A job is written in one transaction (all its
// rows or none, as the screen's import always was):
//
//   - progress (stage, rows written so far, heartbeat) is written beside it on another connection,
//     so the screens follow it; nothing is "saved" until the job's own commit. That commit also
//     marks the job's stored rows "committed" (import_job_data.committed, not synchronised); the
//     job's row is marked completed right after it. The job's row is never changed inside the long
//     transaction: its changes reach the cloud in the order they were made (the cloud merges a row
//     field by field, D-103). A stop between the two: the next runner only marks it completed;
//   - cancelled: the transaction is undone and the job ends 'cancelled', nothing written;
//   - the process stopped or crashed: PostgreSQL undoes the transaction and frees the lock; the
//     job is still 'processing' and the next runner to hold the lock starts it again from the
//     beginning (the stored rows are kept until the job ends). Nothing can be written twice;
//   - a problem in the rows (checked again here: the store may have changed since the screen's
//     check) ends it 'failed' with every problem listed, nothing written;
//   - an unexpected failure is tried again (MAX_ATTEMPTS in all), then ends 'failed'.
const { checkRows, writeRows } = require('./storeData')
const { fromDatabaseError } = require('../errors')

const IMPORT_LOCK = 0x484d494d // 'HMIM'
const MAX_ATTEMPTS = 3

class Stop extends Error {
  constructor(kind) {
    super(kind)
    this.kind = kind // 'cancelled' | 'stopping'
  }
}

/** Rows with at least one problem (a row may have several). */
function rowsWithProblems(errors) {
  return new Set(errors.map((e) => `${e.sheet}|${e.row}`)).size
}

class ImportRunner {
  /**
   * @param {object} o
   * @param {import('pg').Pool} o.pool
   * @param {(m: string, level?: string) => void} [o.log]
   * @param {number} [o.pollMs] how often open jobs are looked for without a kick
   * @param {(stage: string, done: number) => Promise<void>} [o.onStep] tests: called at each step
   */
  constructor({ pool, log = () => {}, pollMs = 5000, onStep = null }) {
    this.pool = pool
    this.log = log
    this.pollMs = pollMs
    this.onStep = onStep
    this.timer = null
    this.running = null
    this.again = false
    // Not started yet: a kick does nothing (a service may run without jobs, cfg.importJobs false).
    this.stopping = true
  }

  start() {
    this.stopping = false
    if (this.timer) return
    const tick = () => {
      this.kick()
      this.timer = setTimeout(tick, this.pollMs)
      this.timer.unref?.()
    }
    tick()
  }

  /** Look for work now (a job was just stored). */
  kick() {
    if (this.stopping) return this.running
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.work()
      .catch((e) => this.log(`imports: ${e.message}`, 'error'))
      .finally(() => {
        this.running = null
        if (this.again && !this.stopping) {
          this.again = false
          this.kick()
        }
      })
    return this.running
  }

  /** Stop after the current step: a running job is undone and stays open for the next start. */
  async stop() {
    this.stopping = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.running
  }

  async work() {
    let client
    try {
      client = await this.pool.connect()
    } catch (e) {
      this.log(`imports: no database connection (${e.message})`, 'warn')
      return
    }
    let locked = false
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock($1) AS ok', [IMPORT_LOCK])).rows[0]
        .ok
      if (!locked) return
      for (;;) {
        if (this.stopping) return
        const job = await this.claim(client)
        if (!job) return
        await this.run(client, job)
      }
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [IMPORT_LOCK]).catch(() => {})
      client.release()
    }
  }

  /**
   * The oldest open job with its rows here. Holding the lock, a job 'processing' is nobody's.
   * None while a restored store waits for its recovery from the cloud (writes are paused then).
   * A job being cancelled at this moment is skipped (its row is locked), and the status is
   * checked again on the row that is changed, so a cancelled job is never taken back.
   */
  async claim(client) {
    const paused = (
      await client.query('SELECT COALESCE(bool_or(recovery_pending), false) AS p FROM sync_state')
    ).rows[0].p
    if (paused) return null
    const { rows } = await client.query(
      `UPDATE import_jobs j
          SET status = 'processing', stage = 'checking', processed_rows = 0,
              attempts = attempts + 1, started_at = COALESCE(started_at, LOCALTIMESTAMP(0)),
              heartbeat_at = LOCALTIMESTAMP(0)
        WHERE j.id = (SELECT o.id FROM import_jobs o JOIN import_job_data d ON d.job_id = o.id
                       WHERE o.status IN ('queued', 'processing')
                       ORDER BY o.created_at, o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED)
          AND j.status IN ('queued', 'processing')
        RETURNING j.*`
    )
    return rows[0] || null
  }

  /** End a job outside its transaction (failed, cancelled): its stored rows are no longer needed. */
  async finish(id, fields) {
    const keys = Object.keys(fields)
    await this.pool.query(
      `WITH d AS (DELETE FROM import_job_data WHERE job_id = $1)
       UPDATE import_jobs SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')},
              finished_at = LOCALTIMESTAMP(0), heartbeat_at = LOCALTIMESTAMP(0)
        WHERE id = $1`,
      [id, ...keys.map((k) => (k === 'errors' ? JSON.stringify(fields[k]) : fields[k]))]
    )
  }

  /** The job's records are saved: mark it completed and let its stored rows go. */
  async completed(job, summary) {
    await this.finish(job.id, {
      status: 'completed',
      stage: 'done',
      processed_rows: job.total_rows,
      successful_rows: job.total_rows,
      failed_rows: 0,
      summary: JSON.stringify(summary),
      error_code: null,
      error_message: null
    })
  }

  async run(client, job) {
    const stored = (
      await client.query('SELECT rows, committed FROM import_job_data WHERE job_id = $1', [job.id])
    ).rows[0]
    // Its rows went with a cancel or a restore at the very moment it was taken: it ends here.
    if (!stored)
      return this.finish(job.id, {
        status: 'cancelled',
        stage: 'cancelled',
        processed_rows: 0
      })
    // Saved before the process stopped: only its row is left to mark.
    if (stored.committed) return this.completed(job, stored.committed)
    if (job.cancel_requested)
      return this.finish(job.id, { status: 'cancelled', stage: 'cancelled', processed_rows: 0 })
    if (job.attempts > MAX_ATTEMPTS)
      return this.finish(job.id, {
        status: 'failed',
        stage: 'failed',
        processed_rows: 0,
        error_code: 'interrupted',
        error_message: 'توقف الاستيراد عدة مرات قبل أن يكتمل، ولم يُحفظ منه شيء. حاول مرة أخرى.'
      })
    const data = stored.rows
    const total = job.total_rows
    // Progress, on another connection: committed at once, so the screens see it.
    const step = async (stage, done) => {
      if (this.onStep) await this.onStep(stage, done, job)
      const r = await this.pool.query(
        `UPDATE import_jobs SET stage = $2, processed_rows = $3, heartbeat_at = LOCALTIMESTAMP(0)
          WHERE id = $1 RETURNING cancel_requested`,
        [job.id, stage, done]
      )
      if (r.rows[0]?.cancel_requested) throw new Stop('cancelled')
      if (this.stopping) throw new Stop('stopping')
    }
    const ctx = {
      user: job.user_id ? { id: job.user_id, username: job.username } : null,
      terminal: job.terminal
    }
    const started = Date.now()
    let saved = null
    try {
      await client.query('BEGIN')
      const { errors, summary, clean } = await checkRows(client, data)
      if (errors.length) {
        await client.query('ROLLBACK')
        return this.finish(job.id, {
          status: 'failed',
          stage: 'checked',
          processed_rows: total,
          failed_rows: rowsWithProblems(errors),
          summary: JSON.stringify(summary),
          errors,
          error_code: 'invalid_rows',
          error_message: `في الملف ${errors.length} خطأ، ولم يُستورد شيء. صحح الأخطاء ثم استورد الملف مرة أخرى.`
        })
      }
      await writeRows(client, ctx, clean, { step })
      await client.query(
        `INSERT INTO system_logs (timestamp, user_id, username, action_type, description, details)
         VALUES (LOCALTIMESTAMP(0), $1, $2, 'store_import', $3, $4)`,
        [
          job.user_id,
          job.username,
          `استيراد بيانات المتجر: ${summary.products} صنف، ${summary.customers} عميل، ${summary.suppliers} مورد`,
          JSON.stringify({ ...summary, importJob: job.id, filename: job.filename })
        ]
      )
      // Saved with its records, in one commit; the job's row is marked just after.
      await client.query('UPDATE import_job_data SET committed = $2 WHERE job_id = $1', [
        job.id,
        JSON.stringify(summary)
      ])
      await client.query('COMMIT')
      saved = summary
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      if (e instanceof Stop && e.kind === 'cancelled')
        return this.finish(job.id, { status: 'cancelled', stage: 'cancelled', processed_rows: 0 })
      if (e instanceof Stop) {
        // Closing: the job stays open and starts again with the next runner.
        await this.pool
          .query(
            // Not a failed attempt: it does not count towards MAX_ATTEMPTS.
            "UPDATE import_jobs SET stage = 'interrupted', processed_rows = 0, attempts = attempts - 1 WHERE id = $1",
            [job.id]
          )
          .catch(() => {})
        return
      }
      this.log(
        `imports: job ${job.id} attempt ${job.attempts}: ${e.code || ''} ${e.message}`,
        'error'
      )
      // A rule of the database refused a row (another terminal added the same barcode meanwhile,
      // a business rule of a trigger): trying again would give the same answer.
      if (/^23|^P0001$/.test(String(e.code || '')))
        return this.finish(job.id, {
          status: 'failed',
          stage: 'failed',
          processed_rows: 0,
          error_code: 'conflict',
          error_message: `${fromDatabaseError(e).message} لم يُستورد شيء من الملف. ربما أُضيف سجل بنفس البيانات أثناء الاستيراد: افحص الملف مرة أخرى.`
        })
      if (job.attempts < MAX_ATTEMPTS) {
        await this.pool.query(
          "UPDATE import_jobs SET status = 'queued', stage = 'retrying', processed_rows = 0 WHERE id = $1",
          [job.id]
        )
        this.again = true
        return
      }
      return this.finish(job.id, {
        status: 'failed',
        stage: 'failed',
        processed_rows: 0,
        error_code: 'error',
        error_message: 'تعذر إكمال الاستيراد بسبب خطأ غير متوقع، ولم يُحفظ منه شيء. حاول مرة أخرى.'
      })
    }
    // Outside the attempt: the records are saved whatever happens now. If this fails too, the job
    // stays open with its "committed" mark and the next runner marks it.
    if (saved) {
      await this.completed(job, saved)
      this.log(`imports: job ${job.id} completed, ${total} rows in ${Date.now() - started} ms`)
    }
  }
}

module.exports = { ImportRunner, IMPORT_LOCK, MAX_ATTEMPTS, rowsWithProblems }
