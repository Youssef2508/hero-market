'use strict'
// Pairing a shop installation with its cloud (D-102).
//
// Nothing links by itself. Someone with access to the server makes a code (newPairingCode, the
// `cloud-pair` command): one use, 15 minutes, kept only as a hash. An administrator enters it on
// the shop PC, which makes its own secret and presents the code with the secret's hash. From then
// on that secret is the store's device token; it is never displayed and never travels.
//
// A cloud serves one store. Pairing again (a replacement PC) replaces the device secret, so the
// previous device is refused from that moment; the store's data here is not touched, and the new
// PC is told the store's id so it continues the same store.
const crypto = require('crypto')
const { withTransaction } = require('../db/pool')
const { ServiceError } = require('../errors')

const MINUTES = 15
const MAX_FAILURES = 5 // wrong codes within the window before every open code is cancelled
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const normalize = (code) =>
  String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')

/** A short description of a store id for people to compare on both screens. */
const fingerprint = (storeId) => {
  const s = String(storeId).replace(/-/g, '').toUpperCase()
  return `${s.slice(0, 4)}-${s.slice(-4)}`
}

/** Make a pairing code (cancels any earlier unused one). Returns it once: { code, expiresAt }. */
async function newPairingCode(pool, { name = '' } = {}) {
  let code = ''
  for (let i = 0; i < 12; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)]
  const shown = code.match(/.{4}/g).join('-')
  const { rows } = await withTransaction(pool, async (db) => {
    await db.query('UPDATE cloud_pairing_codes SET used_at = now() WHERE used_at IS NULL')
    await db.query('DELETE FROM cloud_pairing_failures')
    return db.query(
      `INSERT INTO cloud_pairing_codes (code_hash, store_name, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3)) RETURNING expires_at`,
      [sha256(code), name, MINUTES]
    )
  })
  return { code: shown, expiresAt: rows[0].expires_at, minutes: MINUTES }
}

const WRONG = 'رمز الربط غير صحيح أو انتهت صلاحيته. أنشئ رمزاً جديداً من الخادم.'

/**
 * A shop PC presents a code. `secretHash` is the SHA-256 (hex) of the secret it made.
 * Returns { storeId, name, fingerprint, replaced }.
 */
async function pair(pool, { code, storeId, secretHash, name, fresh = false }) {
  if (!/^[0-9a-f]{64}$/.test(String(secretHash)) || !/^[0-9a-f-]{36}$/i.test(String(storeId)))
    throw new ServiceError(400, 'bad_request', 'بيانات الربط غير صالحة.')
  const out = await withTransaction(pool, async (db) => {
    await db.query('LOCK TABLE cloud_pairing_codes IN EXCLUSIVE MODE')
    const c = (
      await db.query(
        'SELECT * FROM cloud_pairing_codes WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()',
        [sha256(normalize(code))]
      )
    ).rows[0]
    if (!c) return null
    const existing = (await db.query('SELECT * FROM cloud_stores ORDER BY created_at LIMIT 1'))
      .rows[0]
    // Taking over a store from another installation needs an installation with no business of
    // its own: its records will be replaced by the store's. Refused before the code is used, so
    // the same code can then be entered on the right PC.
    if (existing && existing.store_id !== storeId && !fresh)
      throw new ServiceError(
        409,
        'not_fresh',
        'هذه السحابة تخدم متجراً آخر، وهذا الجهاز عليه مبيعات أو ورديات. الجهاز البديل يجب أن يكون تثبيتاً جديداً بلا عمليات. لم يُستخدم رمز الربط.'
      )
    await db.query('UPDATE cloud_pairing_codes SET used_at = now(), used_by = $2 WHERE id = $1', [
      c.id,
      storeId
    ])
    if (existing) {
      // A replacement device for the same store: the old secret stops working now. The store's
      // records, its epoch and its copy here stay exactly as they are.
      await db.query(
        'UPDATE cloud_stores SET token_hash = $2, paired_at = now() WHERE store_id = $1',
        [existing.store_id, secretHash]
      )
      return {
        storeId: existing.store_id,
        name: existing.name,
        replaced: true,
        epoch: existing.current_epoch
      }
    }
    const storeName = c.store_name || String(name || '').slice(0, 120)
    await db.query(
      'INSERT INTO cloud_stores (store_id, name, token_hash, paired_at) VALUES ($1, $2, $3, now())',
      [storeId, storeName, secretHash]
    )
    return { storeId, name: storeName, replaced: false }
  })
  if (!out) {
    // Guessing is hopeless (30^12 codes); still, repeated wrong codes cancel what is open.
    const n = Number(
      (
        await pool.query(
          `WITH x AS (INSERT INTO cloud_pairing_failures DEFAULT VALUES RETURNING 1)
           SELECT (SELECT count(*) FROM cloud_pairing_failures
                    WHERE at > now() - make_interval(mins => $1)) + 1 AS n`,
          [MINUTES]
        )
      ).rows[0].n
    )
    if (n >= MAX_FAILURES)
      await pool.query('UPDATE cloud_pairing_codes SET used_at = now() WHERE used_at IS NULL')
    throw new ServiceError(403, 'pairing_refused', WRONG)
  }
  return { ...out, fingerprint: fingerprint(out.storeId) }
}

module.exports = { newPairingCode, pair, fingerprint, sha256, MINUTES }
