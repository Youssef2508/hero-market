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
//
// Phase 2 milestone 1 (D-101) adds two things, so that both ways in show the same state within a
// second or two:
//   - listen(): PostgreSQL tells the agent the moment a change is queued, and it is pushed at
//     once (the 15-second cycle stays as the fallback);
//   - the link (linkOnce / startLink): one request kept open to the cloud returns the operations
//     users started from the internet. Each is carried out here by its own handler
//     (sync/remoteOps.js), its rows are pushed, and then its answer is sent – so the cloud's copy
//     already shows the result when the user's screen gets the answer.
const { withTransaction } = require('../db/pool')
const { applyCommand } = require('./commands')
const { applyRecovered } = require('./recovery')
const { outcomeOf } = require('./remoteOps')
const { applyChanges } = require('./merge')

const LOCK_KEY = 48151624 // one agent per database at a time
const LINK_LOCK = 48151630 // one holder of the open link per database (D-104)
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
   * @param {(op: object) => Promise<object>} [o.execute]  carries out one operation started from
   *                                           the internet (sync/remoteOps.js executeRemote)
   * @param {(msg: string) => void} [o.log]
   */
  constructor({
    pool,
    transport,
    batchSize = 500,
    commandHooks,
    execute,
    kind,
    version,
    log = () => {}
  }) {
    // kind: who runs this agent ('service' | 'desktop' | 'server'), shown with its heartbeat.
    Object.assign(this, { pool, transport, batchSize, commandHooks, execute, kind, version, log })
    this.link = null
    this.timer = null
    this.failures = 0
    this.linking = false
    this.listener = null
    this.dirty = false
    this.pumping = null
  }

  /** The cloud's versions, as it last answered (architecture §14.1): kept for the sync screen. */
  async notePeer() {
    const p = this.link?.peer
    if (!p) return
    const key = `${p.version}|${p.schema}`
    if (key === this.peerKey) return
    this.peerKey = key
    await this.pool
      .query('UPDATE sync_state SET cloud_app_version = $1, cloud_schema = $2', [
        p.version || null,
        p.schema
      ])
      .catch(() => {})
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
        `SELECT id, table_name, pk, op, row_data::text AS row_text, prev_data::text AS prev_text, echo, version FROM sync_outbox
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
        // What the row was before (updates): the cloud merges field by field (D-103).
        p: x.prev_text || undefined,
        // Written here while merging the cloud's own changes: recorded there, never applied twice.
        e: x.echo || undefined,
        v: Number(x.version)
      }))
      // What will still be waiting after this batch: the cloud shows its figures as "live" only
      // when the shop has nothing left to send.
      const w = await this.waiting()
      const res = await this.link.push({
        epoch,
        rows: batch,
        pending: Math.max(0, w.pending - batch.length),
        seen: w.seen
      })
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
    const replacement = st.recover_from?.reason === 'replacement'
    const summary = await withTransaction(this.pool, async (db) => {
      if (replacement) {
        // A replacement PC (D-102) becomes the store: what its own first-run setup made (the first
        // administrator, the built-in roles) gives way to the store's records, and everyone signs
        // in again with their store account. It had no sales or shifts (checked when pairing).
        const tables = (await db.query('SELECT table_name FROM sync_tables')).rows.map(
          (r) => `"${r.table_name}"`
        )
        await db.query("SELECT set_config('hm.sync_capture', 'off', true)")
        await db.query(`TRUNCATE ${tables.join(', ')}, sessions CASCADE`)
      }
      const s = await applyRecovered(db, rows)
      if (replacement)
        await db.query(
          'UPDATE sessions SET revoked_at = LOCALTIMESTAMP(0) WHERE revoked_at IS NULL'
        )
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
          replacement
            ? `استلام بيانات المتجر من السحابة على الجهاز البديل (${rows.length} سجلاً)`
            : `استرجاع ${rows.length} تغييراً من السحابة بعد استعادة النسخة الاحتياطية`,
          JSON.stringify(detail)
        ]
      )
      return detail
    })
    this.log(`sync: recovered ${rows.length} rows`)
    return { recovered: true, ...summary }
  }

  /**
   * The cloud's own changes – made there while the shop could not be reached (D-103) – brought
   * into this database by the merge rules (sync/merge.js). Each batch is applied in one
   * transaction with the record of what was received, so each change is applied exactly once,
   * whatever is lost or repeated on the way; the cloud forgets a change only when told it arrived.
   */
  async fetchCloud() {
    if (typeof this.link.fetch !== 'function') return 0
    let total = 0
    for (let turn = 0; turn < 1000; turn++) {
      let got
      try {
        got = await this.link.fetch({ limit: 2000 })
      } catch (e) {
        if (e.status === 404) return 0 // a cloud that does not work on its own (test clouds)
        throw e
      }
      const rows = got.rows || []
      if (!rows.length) break
      const ids = rows.map((r) => r.id)
      const result = await withTransaction(this.pool, async (db) => {
        // One merger at a time (the link and the cycle may both fetch): the record of what was
        // received is read under this lock.
        await db.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY + 1])
        const seen = new Set(
          (
            await db.query(
              'SELECT outbox_id FROM sync_received WHERE origin = $1 AND outbox_id = ANY($2::bigint[])',
              [got.origin, ids]
            )
          ).rows.map((r) => Number(r.outbox_id))
        )
        const fresh = rows.filter((r) => !seen.has(Number(r.id)))
        const r = await applyChanges(db, fresh, { receiver: 'shop' })
        if (fresh.length)
          await db.query(
            'INSERT INTO sync_received (origin, outbox_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING',
            [got.origin, fresh.map((x) => x.id)]
          )
        return { ...r, fresh: fresh.length }
      })
      if (result.fresh)
        this.log(
          `sync: ${result.fresh} changes from the cloud (${result.conflicts} conflicts, ${result.attention.length} to look at)`
        )
      await this.link.ack({ ids })
      total += result.fresh
    }
    return total
  }

  /**
   * How many changes still wait to be sent, and the newest change this count has seen. Two reports
   * can reach the cloud out of order (the open link and a push): it keeps the one that saw more.
   */
  async waiting() {
    const r = (
      await this.pool.query(
        `SELECT (SELECT count(*) FROM sync_outbox WHERE acked_at IS NULL)::int AS pending,
                (SELECT COALESCE(max(id), 0) FROM sync_outbox)::float8 AS seen`
      )
    ).rows[0]
    return { pending: r.pending, seen: Number(r.seen) }
  }

  /** What the shop reports about itself with every contact: can it carry out operations now? */
  async health() {
    try {
      const w = await this.waiting()
      const paused = !!(await syncState(this.pool))?.recovery_pending
      // Reachable means: the database answers, operations can be carried out, work is not paused.
      return { ok: !!this.execute && !paused, db: true, paused, ...w }
    } catch (e) {
      return { ok: false, db: false, error: String(e.message).slice(0, 200) }
    }
  }

  /**
   * One turn of the link: wait (up to timeoutMs) for operations started from the internet, carry
   * them out, push their rows, then send their answers. Also accounts for operations the cloud
   * handed over earlier and never heard about, from this database's own record.
   */
  async linkOnce({ timeoutMs = 25000 } = {}) {
    await this.resolveLink()
    const st = await syncState(this.pool)
    if (st.recovery_pending) return { skipped: 'recovery_pending' }
    const turn = await this.link
      .wait({ timeoutMs, health: await this.health() })
      .finally(() => this.notePeer())
    // Work the cloud did while the shop was unreachable comes in before anything new is carried
    // out here, so an operation can rely on it (a customer added from the phone, for example).
    if (turn.changes) await this.fetchCloud()
    const results = []
    const unknown = []
    const pack = (o) => ({
      id: o.id,
      status: o.status,
      httpStatus: o.httpStatus || undefined,
      body: o.body ?? null,
      error: o.error || undefined
    })
    for (const id of turn.check || []) {
      // "Never carried out here" is decided in this database, once: the verdict takes the
      // operation's place in remote_operations, so a copy still carrying it out (another holder
      // of the link handing over, D-104) finds it there and changes nothing – or got there first,
      // and its real outcome is what is reported.
      let o = await outcomeOf(this.pool, id)
      if (!o) {
        await this.pool.query(
          `INSERT INTO remote_operations (op_id, operation, status, http_status, error)
           VALUES ($1, 'unknown', 'refused', 502, $2) ON CONFLICT (op_id) DO NOTHING`,
          [id, JSON.stringify({ code: 'not_executed', message: 'not carried out in the shop' })]
        )
        o = await outcomeOf(this.pool, id)
      }
      if (o.error?.code === 'not_executed') unknown.push(id)
      else results.push(pack(o))
    }
    for (const op of turn.ops || []) {
      let o
      try {
        o = this.execute
          ? await this.execute(op)
          : { id: op.id, status: 'failed', error: { code: 'no_executor', message: 'unavailable' } }
      } catch (e) {
        o = { id: op.id, status: 'failed', error: { code: 'error', message: e.message } }
      }
      results.push(pack(o))
    }
    // The rows first, then the answers: the cloud's copy shows the result before the user does.
    if ((turn.ops || []).length) {
      // Another cycle may hold the lock at this moment: wait for our own push (a few seconds at most).
      for (let i = 0; i < 30; i++) {
        const r = await this.runOnce({ check: false }).catch(() => ({ failed: true }))
        if (!r.skipped || r.skipped !== 'another agent is running') break
        await new Promise((res) => setTimeout(res, 100))
      }
    }
    if (results.length || unknown.length) await this.link.results({ results, unknown })
    return { carriedOut: (turn.ops || []).length, accounted: (turn.check || []).length }
  }

  /**
   * Keep the link open until stopLink(); after a failure, wait longer each time (up to 1 minute).
   *
   * One holder per database (D-104): the background service and the desktop program may both run.
   * The one that holds the link's lock – a lock kept on its own connection for as long as it runs –
   * keeps the link open and writes its heartbeat every 30 seconds; another copy waits and takes
   * over within half a minute if the holder stops (closed, crashed, or its PC connection lost).
   */
  startLink({ timeoutMs = 25000, holdRetryMs = 30000 } = {}) {
    if (this.linking) return
    this.linking = true
    let failures = 0
    const loop = async () => {
      while (this.linking) {
        if (!(await this.holdLink())) {
          await new Promise((res) => {
            this.linkSleep = setTimeout(res, holdRetryMs)
          })
          continue
        }
        try {
          const r = await this.linkOnce({ timeoutMs })
          failures = 0
          if (r.skipped) await new Promise((res) => setTimeout(res, 5000))
        } catch (e) {
          if (e.code !== 'not_linked') this.log(`link: ${e.message}`)
          failures += 1
          const wait = e.code === 'not_linked' ? 15000 : Math.min(2000 * 2 ** failures, 60000)
          await new Promise((res) => {
            this.linkSleep = setTimeout(res, wait)
          })
        }
      }
    }
    loop()
  }

  /** Take (or keep) the link's lock on its own connection. True while this copy holds it. */
  async holdLink() {
    if (this.holder) return true
    let client
    try {
      client = await this.pool.connect()
      const got = (await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LINK_LOCK])).rows[0]
        .ok
      if (!got) {
        client.release()
        return false
      }
    } catch {
      if (client) client.release(true)
      return false
    }
    this.holder = client
    // The lock goes with the connection: if it drops (PostgreSQL restarted), give it up for now.
    client.once('error', () => this.releaseLink(true))
    await this.heartbeat(true)
    this.beat = setInterval(() => this.heartbeat(false), 30000)
    return true
  }

  /** Who holds the link, and that it is alive (shown on the desktop's sync screen). */
  async heartbeat(starting) {
    await this.pool
      .query(
        `UPDATE sync_state SET agent_kind = $1, agent_pid = $2, agent_version = $3,
                agent_seen_at = LOCALTIMESTAMP(0),
                agent_started_at = CASE WHEN $4 THEN LOCALTIMESTAMP(0) ELSE agent_started_at END`,
        [this.kind || 'desktop', process.pid, this.version || null, !!starting]
      )
      .catch(() => {})
  }

  releaseLink(broken = false) {
    if (this.beat) clearInterval(this.beat)
    this.beat = null
    const client = this.holder
    this.holder = null
    if (!client) return
    if (broken) client.release(true)
    else
      client
        .query('SELECT pg_advisory_unlock($1)', [LINK_LOCK])
        .catch(() => {})
        .finally(() => client.release())
  }

  stopLink() {
    this.linking = false
    if (this.linkSleep) clearTimeout(this.linkSleep)
    this.releaseLink()
  }

  /** Push as soon as possible; changes queued while a push runs are pushed right after it. */
  kick() {
    this.dirty = true
    if (this.pumping) return this.pumping
    this.pumping = (async () => {
      try {
        while (this.dirty) {
          this.dirty = false
          await this.runOnce({ check: false }).catch(() => {})
        }
      } finally {
        this.pumping = null
      }
    })()
    return this.pumping
  }

  /** PostgreSQL announces each queued change (migration 0032): push it without waiting. */
  async listen() {
    if (this.listener) return
    const client = await this.pool.connect()
    this.listener = client
    let timer = null
    client.on('notification', () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        this.kick()
      }, 150)
    })
    const lost = () => {
      if (this.listener !== client) return
      this.listener = null
      try {
        client.release(true)
      } catch {
        /* already gone */
      }
      // The connection dropped (PostgreSQL restarted): the 15-second cycle covers until it is back.
      this.listenRetry = setTimeout(() => this.listen().catch(() => {}), 10000)
    }
    client.once('error', lost)
    client.once('end', lost)
    await client.query('LISTEN hm_sync_outbox')
  }

  async unlisten() {
    if (this.listenRetry) clearTimeout(this.listenRetry)
    const client = this.listener
    this.listener = null
    if (client) {
      await client.query('UNLISTEN *').catch(() => {})
      client.release()
    }
  }

  /**
   * One full cycle. Returns a summary; throws (and records the error) when the cloud is
   * unreachable. `check: false` skips the whole-table comparison (the fast path after a change).
   */
  async runOnce({ check = true } = {}) {
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
        // The cloud's own changes first (D-103): it refuses a new epoch while it still holds any.
        const fetched = await this.fetchCloud()
        const epoch = await this.ensureEpoch()
        let pushed = await this.push(epoch)
        const commands = await this.applyCommands()
        if (commands.some((c) => !c.duplicate)) pushed += await this.push(epoch)
        const checked = check ? await this.check(epoch) : undefined
        if (check)
          await this.pool.query(
            `DELETE FROM sync_outbox WHERE acked_at < LOCALTIMESTAMP(0) - make_interval(days => $1)`,
            [PRUNE_AFTER_DAYS]
          )
        await this.pool.query(
          'UPDATE sync_state SET last_error = NULL, last_error_at = NULL WHERE last_error IS NOT NULL'
        )
        this.failures = 0
        await this.notePeer()
        return { epoch, pushed, fetched, commands, check: checked }
      } catch (e) {
        await this.notePeer()
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

  /**
   * Run every `intervalMs`; after failures, back off up to 5 minutes. The whole-table comparison
   * (check) runs every `checkEveryMs` – it reads every row's version, so on a large store it is the
   * expensive part – and at once again while the last one found a difference or could not run.
   * Changes are sent on every cycle and at once after each change either way.
   */
  start(intervalMs = 15000, { checkEveryMs = 10 * 60 * 1000 } = {}) {
    this.stop()
    let lastCheck = 0
    let lastOk = false
    const tick = async () => {
      try {
        const due = !lastOk || Date.now() - lastCheck >= checkEveryMs
        const r = await this.runOnce({ check: due })
        if (due && r?.check && r.check.ok !== null && r.check.ok !== undefined) {
          lastCheck = Date.now()
          lastOk = r.check.ok
        }
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
