'use strict'
// Operations started from the internet, carried out here in the shop (Phase 2 milestone 1, D-101).
//
// The cloud sends the operation's name, its data, the user and an id. This module runs it through
// the service exactly as a desktop terminal would – the same route, the same permission check
// against this database's current roles, the same validation, the same handler – so it has the same
// business effects on the same shift, drawer, treasury and balances.
//
// At most once: the operation's id is written to remote_operations inside the handler's own
// transaction (the first one it opens). A second delivery of the same id finds the row and gets the
// stored outcome; a crash before the commit leaves neither the effects nor the row, so asking for
// the outcome answers "never carried out". A refusal by a business rule is stored too (nothing was
// changed), so the same id always has the same answer.
const crypto = require('crypto')
const { withTransaction } = require('../db/pool')
const { ServiceError } = require('../errors')
const { cloudRoute, withoutSecrets } = require('./operationKinds')

const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v))

async function stored(db, id) {
  const r = (await db.query('SELECT * FROM remote_operations WHERE op_id = $1', [id])).rows[0]
  if (!r) return null
  return {
    id,
    status: r.status,
    httpStatus: r.http_status,
    body: r.status === 'applied' ? r.result : null,
    error: r.error || null,
    appliedAt: r.applied_at,
    duplicate: true
  }
}

/**
 * The transaction function a remote operation's handler receives as ctx.tx. The first transaction
 * also claims the operation's id; with the id already there the handler never runs.
 */
function remoteTx(pool, rc) {
  return async (fn) => {
    if (rc.claimed) return withTransaction(pool, fn)
    const out = await withTransaction(pool, async (db) => {
      const claim = await db.query(
        `INSERT INTO remote_operations (op_id, operation, user_id, username, terminal, status, http_status)
         VALUES ($1, $2, $3, $4, $5, 'applied', 200) ON CONFLICT (op_id) DO NOTHING RETURNING op_id`,
        [rc.id, rc.operation, rc.userId, rc.username || null, rc.terminal || null]
      )
      if (!claim.rowCount)
        throw new ServiceError(409, 'already_applied', 'تم تنفيذ هذه العملية من قبل.')
      const result = await fn(db)
      await db.query('UPDATE remote_operations SET result = $2 WHERE op_id = $1', [
        rc.id,
        json(withoutSecrets(result))
      ])
      return result
    })
    rc.claimed = true
    return out
  }
}

/**
 * Carry out one remote operation. Returns { id, status, httpStatus, body, error, duplicate }:
 *   applied – done (now, or earlier under the same id);
 *   refused – a business rule, a permission or the data refused it; nothing was changed;
 *   failed  – an unexpected failure here; nothing was recorded, it may be sent again.
 */
async function executeRemote(app, op) {
  const pool = app.pool
  const prior = await stored(pool, op.id)
  if (prior) return prior
  const refuse = async (httpStatus, error) => {
    await pool.query(
      `INSERT INTO remote_operations (op_id, operation, user_id, username, terminal, status, http_status, error)
       VALUES ($1, $2, $3, $4, $5, 'refused', $6, $7) ON CONFLICT (op_id) DO NOTHING`,
      [
        op.id,
        op.operation,
        op.userId,
        op.username || null,
        op.terminal || null,
        httpStatus,
        json(error)
      ]
    )
    return (await stored(pool, op.id)) || { id: op.id, status: 'refused', httpStatus, error }
  }
  if (cloudRoute(op.operation) !== 'shop')
    return {
      ...(await refuse(400, {
        code: 'not_remote',
        message: 'هذه العملية لا تُنفَّذ عن بعد.'
      })),
      duplicate: false
    }

  const key = crypto.randomBytes(24).toString('base64url')
  const rc = {
    id: op.id,
    operation: op.operation,
    userId: op.userId,
    username: op.username,
    terminal: op.terminal || 'الإنترنت',
    claimed: false
  }
  app.remoteOperations.set(key, rc)
  let res
  try {
    res = await app.inject({
      method: 'POST',
      url: `/api/${op.operation}`,
      payload: op.body || {},
      headers: { 'x-heromarket-remote': key }
    })
  } finally {
    app.remoteOperations.delete(key)
  }
  let body = null
  try {
    body = res.body ? JSON.parse(res.body) : null
  } catch {
    /* not JSON */
  }
  if (res.statusCode >= 200 && res.statusCode < 300) {
    // The stored answer is the final one (a handler may shape it after its transaction).
    await pool.query(
      `INSERT INTO remote_operations (op_id, operation, user_id, username, terminal, status, http_status, result)
       VALUES ($1, $2, $3, $4, $5, 'applied', $6, $7)
       ON CONFLICT (op_id) DO UPDATE SET result = EXCLUDED.result, http_status = EXCLUDED.http_status`,
      [
        op.id,
        op.operation,
        op.userId,
        op.username || null,
        op.terminal || null,
        res.statusCode,
        json(withoutSecrets(body))
      ]
    )
    return { id: op.id, status: 'applied', httpStatus: res.statusCode, body, duplicate: false }
  }
  // Delivered twice at the same moment: the other delivery carried it out.
  const now = await stored(pool, op.id)
  if (now) return now
  const error = body?.error || { code: 'error', message: 'حدث خطأ غير متوقع.' }
  if (res.statusCode >= 500)
    return { id: op.id, status: 'failed', httpStatus: res.statusCode, error, duplicate: false }
  return { ...(await refuse(res.statusCode, error)), duplicate: false }
}

/** The outcome of an operation by its id, or null when it was never carried out here. */
const outcomeOf = (pool, id) => stored(pool, id)

module.exports = { executeRemote, outcomeOf, remoteTx }
