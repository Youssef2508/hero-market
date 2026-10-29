'use strict'
// Temporary reservations against concurrent editing (owner, 1.5.2, D-099).
//
//   pending – a preliminary supplier invoice being completed: 30 minutes;
//   request – a supplier debt-payment request being decided on: 5 minutes.
//
// The state lives in the record's own row (reserved_by, reserved_at, reserved_until,
// reserve_token), never in a screen. Taking it is one conditional UPDATE: the row lock makes two
// simultaneous attempts serialize, and the second sees the first's reservation. Every check uses
// the database clock. HEROMARKET_TEST_CLOCK_OFFSET_SECONDS shifts that clock for the tests only;
// nothing sets it in the program.
const crypto = require('crypto')
const { conflict, notFound } = require('../errors')

const KINDS = {
  pending: {
    table: 'supplier_pending_invoices',
    minutes: 30,
    eligible: "status = 'pending'",
    busy: (name, until) =>
      `«${name}» بيعدل الفاتورة حاليًا. تتاح للتعديل عند إكمالها أو انتهاء الحجز (الساعة ${until}).`,
    notEligible: (row) =>
      row.status === 'converted'
        ? `الفاتورة المبدئية #${row.id} أُكملت من قبل.`
        : `الفاتورة المبدئية #${row.id} ملغاة.`,
    stale: 'انتهى حجزك لهذه الفاتورة (30 دقيقة) أو حجزها مستخدم آخر. أعد فتحها لتعديلها.'
  },
  request: {
    table: 'supplier_payment_requests',
    minutes: 5,
    eligible: "status IN ('pending', 'disputed')",
    busy: (name, until) =>
      `«${name}» بيعدل طلب السداد حاليًا. يتاح عند انتهائه أو انتهاء الحجز (الساعة ${until}).`,
    notEligible: (row) => `طلب السداد #${row.id} تم البت فيه من قبل.`,
    stale: 'انتهى حجزك لهذا الطلب (5 دقائق) أو حجزه مستخدم آخر. أعد فتحه.'
  }
}

/** Seconds added to the database clock (tests only). */
function offset() {
  const v = Number(process.env.HEROMARKET_TEST_CLOCK_OFFSET_SECONDS || 0)
  return Number.isFinite(v) ? v : 0
}
/** "Now" in SQL, with its parameter number. */
const now = (n) => `(LOCALTIMESTAMP(0) + make_interval(secs => $${n}::double precision))`
const hhmm = (ts) => String(ts || '').match(/\d{2}:\d{2}/)?.[0] || ''

async function holderOf(db, kind, id) {
  const k = KINDS[kind]
  return (
    await db.query(
      `SELECT t.*, u.username AS reserved_by_name, (t.reserved_until > ${now(2)}) AS active,
              to_char(t.reserved_until, 'YYYY-MM-DD HH24:MI:SS') AS until_text
         FROM ${k.table} t LEFT JOIN users u ON u.id = t.reserved_by WHERE t.id = $1`,
      [id, offset()]
    )
  ).rows[0]
}

/**
 * Reserve a record for the user, or renew the user's own valid reservation (same token).
 * Refused while another user's reservation is valid, or when the record is no longer eligible.
 */
async function acquire(db, ctx, kind, id) {
  const k = KINDS[kind]
  const token = crypto.randomUUID()
  const got = (
    await db.query(
      `UPDATE ${k.table}
          SET reserve_token = CASE WHEN reserved_by = $2 AND reserved_until > ${now(5)} THEN reserve_token ELSE $3 END,
              reserved_by = $2,
              reserved_at = CASE WHEN reserved_by = $2 AND reserved_until > ${now(5)} THEN reserved_at ELSE ${now(5)} END,
              reserved_until = ${now(5)} + make_interval(mins => $4)
        WHERE id = $1 AND ${k.eligible}
          AND (reserved_until IS NULL OR reserved_until <= ${now(5)} OR reserved_by = $2)
        RETURNING reserve_token AS token, to_char(reserved_until, 'YYYY-MM-DD HH24:MI:SS') AS until`,
      [id, ctx.user.id, token, k.minutes, offset()]
    )
  ).rows[0]
  if (got) return { token: got.token, until: got.until, minutes: k.minutes }
  const row = await holderOf(db, kind, id)
  if (!row) throw notFound()
  if (!(await eligible(db, kind, id))) throw conflict(k.notEligible(row), { code: 'not_eligible' })
  throw conflict(k.busy(row.reserved_by_name || 'مستخدم آخر', hhmm(row.until_text)), {
    code: 'reserved',
    holder: row.reserved_by_name,
    until: row.until_text
  })
}

async function eligible(db, kind, id) {
  const k = KINDS[kind]
  return (
    (await db.query(`SELECT 1 FROM ${k.table} WHERE id = $1 AND ${k.eligible}`, [id])).rowCount > 0
  )
}

/**
 * Before a write on a locked row: refused while another user holds a valid reservation; with a
 * token, the caller must hold the valid reservation it names (a stale screen cannot write after
 * its reservation expired or passed to someone else).
 */
async function check(db, ctx, kind, id, token) {
  const k = KINDS[kind]
  const row = await holderOf(db, kind, id)
  if (!row) throw notFound()
  const mine = row.reserved_by === ctx.user.id && row.active
  if (token) {
    if (!(mine && row.reserve_token === token)) {
      if (row.active && row.reserved_by !== ctx.user.id)
        throw conflict(k.busy(row.reserved_by_name, hhmm(row.until_text)), {
          code: 'reserved',
          holder: row.reserved_by_name
        })
      throw conflict(k.stale, { code: 'reservation_expired' })
    }
    return
  }
  if (row.active && row.reserved_by !== ctx.user.id)
    throw conflict(k.busy(row.reserved_by_name, hhmm(row.until_text)), {
      code: 'reserved',
      holder: row.reserved_by_name
    })
}

/** The columns a finishing UPDATE sets to clear the reservation. */
const CLEAR = 'reserved_by = NULL, reserved_at = NULL, reserved_until = NULL, reserve_token = NULL'

/** Give a reservation back (the holder leaves the screen). Only the holder's own token clears it. */
async function release(db, ctx, kind, id, token) {
  const k = KINDS[kind]
  const r = await db.query(
    `UPDATE ${k.table} SET ${CLEAR} WHERE id = $1 AND reserved_by = $2 AND reserve_token = $3`,
    [id, ctx.user.id, token]
  )
  return { released: r.rowCount > 0 }
}

/** SQL columns describing a row's reservation for lists (alias t, users joined as ru). */
const LIST_COLUMNS = (n) => `ru.username AS reserved_by_name,
  to_char(t.reserved_until, 'YYYY-MM-DD HH24:MI:SS') AS reserved_until_text,
  COALESCE(t.reserved_until > ${now(n)}, false) AS reserved_active`

module.exports = { KINDS, acquire, check, release, CLEAR, LIST_COLUMNS, offset }
