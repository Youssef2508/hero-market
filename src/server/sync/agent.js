'use strict'
// PC sync agent (stage 4 phase 4, D-042 / D-047). One cycle:
//   1. epoch      – on first registration, get an epoch from the cloud and queue every current row;
//   2. push       – send unacknowledged outbox rows in batches; mark them acknowledged only after
//                   the cloud answered (it answers after its commit). A lost answer means a re-send,
//                   which the cloud ignores by version. No high-water mark is used, so a sale that
//                   commits during a push is sent on the next one, never skipped;
//   3. commands   – pull the owner's pending commands and apply each exactly once
//                   (src/server/sync/commands.js); their outcomes are pushed straight away;
//   4. check      – once nothing is pending, compare per-table counts and fingerprints with the
//                   cloud; a mismatching table is queued again.
// Batches never split one local transaction (unless it is a bulk transaction larger than a batch
// can carry, such as the first snapshot), so the cloud applies a sale or a receipt all or nothing.
// After a restore of a synchronised store, recover() first writes back the rows that reached the
// cloud after the backup; until then nothing is pushed (the service pauses writes meanwhile).
// All state is in the database (outbox, applied_commands, sync_state): a restarted agent continues
// where the last one stopped. Selling never waits for any of this.
const { withTransaction } = require('../db/pool')
const { applyCommand } = require('./commands')
const { applyRecovered } = require('./recovery')

const LOCK_KEY = 48151624 // one agent per database at a time
const PRUNE_AFTER_DAYS = 7
const MAX_BATCH_ROWS = 4000 // the cloud accepts up to 5000 rows per batch
const RECOVERY_PAGE = 2000

async function syncState(db) {
  return (await db.query('SELECT * FROM sync_state')).rows[0]
}

/** Per-table count and fingerprint of the rows the cloud must hold (compare cloudChecksums). */
async function localChecksums(db, epoch) {
  const { rows } = await db.query(
    `SELECT table_name,
            count(*)::int AS rows,
            md5(string_agg(pk || ':' || $1::int || ':' || version, ',' ORDER BY pk COLLATE "C")) AS hash
       FROM sync_row_versions WHERE NOT deleted
      GROUP BY table_name`,
    [epoch]
  )
  return Object.fromEntries(rows.map((r) => [r.table_name, { rows: r.rows, hash: r.hash }]))
}

class SyncAgent {
  /**
   * @param {object} o
   * @param {import('pg').Pool} o.pool        the store database
   * @param {object|Function} o.transport      InProcessTransport / HttpTransport (transport.js), or
   *                                           an async function returning one (read every cycle)
   * @param {number} [o.batchSize]
   * @param {object} [o.commandHooks]          failure injection for tests
   * @param {(msg: string) => void} [o.log]
   */
  constructor({ pool, transport, batchSize = 500, commandHooks, log = () => {} }) {
    Object.assign(this, { pool, transport, batchSize, commandHooks, log })
    this.link = null
    this.timer = null
    this.failures = 0
  }

  async resolveLink() {
    this.link = typeof this.transport === 'function' ? await this.transport() : this.transport
    if (!this.link) {
      const err = new Error('not_linked')
      err.code = 'not_linked'
      throw err
    }
    return this.link
  }

  async ensureEpoch() {
    const st = await syncState(this.pool)
    if (st.epoch) return st.epoch
    const { epoch } = await this.link.newEpoch()
    // First contact in this epoch: what was queued before is superseded by a full snapshot.
    const queued = await withTransaction(this.pool, async (db) => {
      await db.query('DELETE FROM sync_outbox')
      await db.query('DELETE FROM sync_row_versions')
      await db.query('UPDATE sync_state SET epoch = $1', [epoch])
      return Number((await db.query('SELECT hm_sync_snapshot() AS n')).rows[0].n)
    })
    this.log(`sync: epoch ${epoch}, ${queued} rows queued`)
    return epoch
  }

  async rowsWhere(cond, params) {
    // Rows travel as PostgreSQL's own JSON text: parsing them into JavaScript numbers would drop
    // numeric scale (25.00 → 25) and could lose digits of large or precise amounts.
    return (
      await this.pool.query(
        `SELECT id, table_name, pk, op, row_data::text AS row_text, version FROM sync_outbox
          WHERE acked_at IS NULL AND ${cond} ORDER BY id`,
        params
      )
    ).rows
  }

  /**
   * The oldest unacknowledged rows, extended so that every local transaction they belong to is
   * sent whole. A transaction larger than a batch can carry is sent in pieces (bulk work only).
   */
  async nextBatch() {
    const head = (
      await this.pool.query(
        'SELECT id, tx_id::text AS tx FROM sync_outbox WHERE acked_at IS NULL ORDER BY id LIMIT $1',
        [this.batchSize]
      )
    ).rows
    if (!head.length) return []
    const txs = [...new Set(head.map((r) => r.tx))]
    const sizes = Object.fromEntries(
      (
        await this.pool.query(
          `SELECT tx_id::text AS tx, count(*)::int AS n FROM sync_outbox
            WHERE acked_at IS NULL AND tx_id = ANY($1::xid8[]) GROUP BY 1`,
          [txs]
        )
      ).rows.map((r) => [r.tx, r.n])
    )
    const chosen = []
    let total = 0
    for (const tx of txs) {
      if (total + sizes[tx] > MAX_BATCH_ROWS) {
        if (!chosen.length) {
          // One bulk transaction bigger than a batch: send its first rows now, the rest next.
          const ids = head.filter((r) => r.tx === tx).map((r) => r.id)
          return this.rowsWhere('id = ANY($1::bigint[])', [ids])
        }
        break
      }
      chosen.push(tx)
      total += sizes[tx]
    }
    return this.rowsWhere('tx_id = ANY($1::xid8[])', [chosen])
  }

  async push(epoch) {
    let sent = 0
    for (;;) {
      const rows = await this.nextBatch()
      if (!rows.length) break
      const batch = rows.map((x) => ({
        id: Number(x.id),
        t: x.table_name,
        k: x.pk,
        op: x.op,
        r: x.row_text,
        v: Number(x.version)
      }))
      const res = await this.link.push({ epoch, rows: batch })
      const mine = new Set(batch.map((b) => b.id))
      const acked = (res?.acked || []).filter((id) => mine.has(id))
      if (acked.length)
        await this.pool.query(
          'UPDATE sync_outbox SET acked_at = LOCALTIMESTAMP(0) WHERE id = ANY($1::bigint[]) AND acked_at IS NULL',
          [acked]
        )
      sent += acked.length
      if (acked.length < batch.length) break // not everything confirmed: retry on the next cycle
    }
    await this.pool.query('UPDATE sync_state SET last_push_at = LOCALTIMESTAMP(0)')
    return sent
  }

  async applyCommands() {
    const commands = await this.link.pullCommands()
    const outcomes = []
    for (const c of commands) {
      const r = await applyCommand(this.pool, c, { hooks: this.commandHooks })
      outcomes.push({ id: c.id, type: c.type, ...r })
    }
    await this.pool.query('UPDATE sync_state SET last_pull_at = LOCALTIMESTAMP(0)')
    return outcomes
  }

  async check(epoch) {
    const pending = Number(
      (await this.pool.query('SELECT count(*) AS n FROM sync_outbox WHERE acked_at IS NULL'))
        .rows[0].n
    )
    if (pending) return { ok: null, pending }
    const local = await localChecksums(this.pool, epoch)
    const remote = await this.link.checksums()
    const tables = [...new Set([...Object.keys(local), ...Object.keys(remote.tables || {})])]
    const mismatched = tables.filter((t) => {
      const a = local[t]
      const b = remote.tables?.[t]
      return !a || !b || a.rows !== b.rows || a.hash !== b.hash
    })
    const ok = remote.epoch === epoch && mismatched.length === 0
    const detail = ok
      ? null
      : {
          epoch: { local: epoch, cloud: remote.epoch },
          tables: mismatched.map((t) => ({
            table: t,
            local: local[t]?.rows ?? 0,
            cloud: remote.tables?.[t]?.rows ?? 0
          }))
        }
    // Re-send the tables that differ (rows the PC holds; rows only in the cloud are reported).
    for (const t of mismatched.filter((x) => local[x]))
      await this.pool.query('SELECT hm_sync_snapshot($1)', [t])
    await this.pool.query(
      'UPDATE sync_state SET last_check_at = LOCALTIMESTAMP(0), check_ok = $1, check_detail = $2',
      [ok, detail ? JSON.stringify(detail) : null]
    )
    return { ok, mismatched, detail }
  }

  /**
   * After a restore of a synchronised store: fetch every row newer than the backup's sync point
   * from the cloud and write it back in one transaction; then writes may resume and the next cycle
   * starts a new epoch. Returns a summary.
   */
  async recover() {
    await this.resolveLink()
    const st = await syncState(this.pool)
    if (!st.recovery_pending) return { recovered: false, reason: 'not_pending' }
    const point = st.recover_from?.sync || {}
    if (point.storeId && point.storeId !== st.store_id) {
      const err = new Error('backup_from_another_store')
      err.code = 'backup_from_another_store'
      throw err
    }
    let afterEpoch = Number(point.epoch) || 0
    let afterVersion = afterEpoch ? Number(point.version) || 0 : 0
    const rows = []
    for (;;) {
      const page = await this.link.recoverRows(afterEpoch, afterVersion, RECOVERY_PAGE)
      rows.push(...page)
      if (page.length < RECOVERY_PAGE) break
      afterEpoch = page[page.length - 1].epoch
      afterVersion = page[page.length - 1].version
    }
    const summary = await withTransaction(this.pool, async (db) => {
      const s = await applyRecovered(db, rows)
      const detail = { ...s, rows: rows.length, from: point }
      await db.query(
        `UPDATE sync_state SET recovery_pending = false, recovered_at = LOCALTIMESTAMP(0),
                recovery_detail = $1, recover_from = NULL, epoch = NULL`,
        [JSON.stringify(detail)]
      )
      await db.query(
        `INSERT INTO system_logs (timestamp, user_id, username, action_type, description, details)
         VALUES (LOCALTIMESTAMP(0), NULL, NULL, 'sync_recovery', $1, $2)`,
        [
          `استرجاع ${rows.length} تغييراً من السحابة بعد استعادة النسخة الاحتياطية`,
          JSON.stringify(detail)
        ]
      )
      return detail
    })
    this.log(`sync: recovered ${rows.length} rows`)
    return { recovered: true, ...summary }
  }

  /** One full cycle. Returns a summary; throws (and records the error) when the cloud is unreachable. */
  async runOnce() {
    const lock = await this.pool.connect()
    try {
      const got = (await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])).rows[0].ok
      if (!got) return { skipped: 'another agent is running' }
      try {
        const st = await syncState(this.pool)
        if (st.recovery_pending) return { skipped: 'recovery_pending' }
        try {
          await this.resolveLink()
        } catch (e) {
          if (e.code === 'not_linked') return { skipped: 'not_linked' } // nothing to do, not an error
          throw e
        }
        const epoch = await this.ensureEpoch()
        let pushed = await this.push(epoch)
        const commands = await this.applyCommands()
        if (commands.some((c) => !c.duplicate)) pushed += await this.push(epoch)
        const check = await this.check(epoch)
        await this.pool.query(
          `DELETE FROM sync_outbox WHERE acked_at < LOCALTIMESTAMP(0) - make_interval(days => $1)`,
          [PRUNE_AFTER_DAYS]
        )
        await this.pool.query('UPDATE sync_state SET last_error = NULL, last_error_at = NULL')
        this.failures = 0
        return { epoch, pushed, commands, check }
      } catch (e) {
        this.failures += 1
        await this.pool
          .query('UPDATE sync_state SET last_error = $1, last_error_at = LOCALTIMESTAMP(0)', [
            String(e.message).slice(0, 500)
          ])
          .catch(() => {})
        throw e
      } finally {
        await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
      }
    } finally {
      lock.release()
    }
  }

  /** Run every `intervalMs`; after failures, back off up to 5 minutes. */
  start(intervalMs = 15000) {
    this.stop()
    const tick = async () => {
      try {
        await this.runOnce()
      } catch (e) {
        this.log(`sync: ${e.message}`)
      }
      if (!this.timer) return
      const wait = Math.min(intervalMs * 2 ** Math.min(this.failures, 5), 5 * 60 * 1000)
      this.timer = setTimeout(tick, wait)
    }
    this.timer = setTimeout(tick, 0)
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

module.exports = { SyncAgent, localChecksums, syncState }
