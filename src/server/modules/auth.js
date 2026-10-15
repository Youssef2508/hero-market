'use strict'
const crypto = require('crypto')
const { pinLookup, hashPin, verifyPin, legacyCandidates, isValidPin } = require('../auth/pin')
const { describeUser } = require('../auth/access')
const { badRequest, unauthorized, conflict, tooMany } = require('../errors')
const { sha256 } = require('../app')

// Two layers: 5 failures in 5 min lock one terminal for 60 s (the original till behaviour), and
// 20 failures in 15 min lock the whole source address for 15 min. The terminal name is chosen by the
// client, so only the per-address limit stops a network client from rotating names to guess PINs.
const LIMITS = {
  terminal: { max: 5, windowMs: 5 * 60 * 1000, lockMs: 60 * 1000 },
  address: { max: 20, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 }
}

function guardKeys(ctx, prefix = '') {
  return [
    [`${prefix}t|${ctx.terminal || 'unknown'}|${ctx.ip}`, LIMITS.terminal],
    [`${prefix}a|${ctx.ip}`, LIMITS.address]
  ]
}

function checkGuard(guard, keys) {
  const now = Date.now()
  for (const [key] of keys) {
    const g = guard.get(key)
    if (g && g.lockedUntil > now) {
      const secs = Math.ceil((g.lockedUntil - now) / 1000)
      throw tooMany(`محاولات دخول خاطئة كثيرة. حاول مرة أخرى بعد ${secs} ثانية.`)
    }
  }
}

function recordFailure(guard, keys) {
  const now = Date.now()
  if (guard.size > 5000) {
    for (const [k, g] of guard)
      if (g.lockedUntil < now && now - g.first > LIMITS.address.windowMs) guard.delete(k)
  }
  for (const [key, limit] of keys) {
    let g = guard.get(key)
    if (!g || now - g.first > limit.windowMs) g = { failures: 0, first: now, lockedUntil: 0 }
    g.failures += 1
    if (g.failures >= limit.max) {
      g.lockedUntil = now + limit.lockMs
      g.failures = 0
      g.first = now
    }
    guard.set(key, g)
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** A successful login clears the terminal counter only; address-level failures still count. */
function clearTerminal(guard, keys) {
  guard.delete(keys[0][0])
}

async function createSession(db, ctx, userId) {
  const token = crypto.randomBytes(32).toString('base64url')
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, terminal, expires_at)
     VALUES ($1, $2, $3, LOCALTIMESTAMP(0) + make_interval(hours => $4))`,
    [sha256(token), userId, ctx.terminal, ctx.sessionHours]
  )
  return token
}

/** Find the active user owning `pin`; upgrades a legacy PIN to the keyed hash on success. */
async function findUserByPin(db, secret, pin) {
  const lookup = pinLookup(secret, pin)
  const modern = await db.query(
    'SELECT id, pin_hash FROM users WHERE pin_lookup = $1 AND is_active',
    [lookup]
  )
  if (modern.rows.length) {
    return verifyPin(pin, modern.rows[0].pin_hash) ? modern.rows[0].id : null
  }
  const [sha, plain] = legacyCandidates(pin)
  const legacy = await db.query(
    'SELECT id FROM users WHERE pin_lookup IS NULL AND is_active AND (password_hash = $1 OR password_hash = $2) ORDER BY id',
    [sha, plain]
  )
  if (legacy.rows.length !== 1) {
    // Keyed lookups made with another server secret (backup restored on another installation,
    // or a rotated secret): verify against the scrypt hashes and re-key the match.
    const keyed = await db.query(
      'SELECT id, pin_hash FROM users WHERE is_active AND pin_hash IS NOT NULL ORDER BY id LIMIT 200'
    )
    const hit = keyed.rows.find((u) => verifyPin(pin, u.pin_hash))
    if (!hit) return null
    await db.query('UPDATE users SET pin_lookup = $1 WHERE id = $2', [lookup, hit.id])
    return hit.id
  }
  const id = legacy.rows[0].id
  await db.query(
    'UPDATE users SET pin_lookup = $1, pin_hash = $2, password_hash = NULL, updated_at = LOCALTIMESTAMP(0) WHERE id = $3',
    [lookup, hashPin(pin), id]
  )
  return id
}

/** Throws when another user already uses this PIN (PINs identify the user at login). */
async function assertPinFree(db, secret, pin, exceptUserId = null) {
  const [sha, plain] = legacyCandidates(pin)
  const { rows } = await db.query(
    `SELECT id FROM users WHERE ($1::int IS NULL OR id <> $1)
       AND (pin_lookup = $2 OR (pin_lookup IS NULL AND (password_hash = $3 OR password_hash = $4))) LIMIT 1`,
    [exceptUserId, pinLookup(secret, pin), sha, plain]
  )
  if (rows.length) throw conflict('رمز المرور هذا مستخدم لحساب آخر، اختر رمزاً مختلفاً.')
}

const pinSchema = { type: 'string', pattern: '^[0-9]{4,8}$' }

module.exports = function authModule(app) {
  app.operation({
    name: 'auth.status',
    public: true,
    handler: async (ctx) => {
      const { rows } = await ctx.pool.query('SELECT count(*)::int AS n FROM users')
      // A networked server requires the one-time setup code from its log (see src/server/cli.js).
      return { needsSetup: rows[0].n === 0, setupCodeRequired: !!ctx.setupCode && rows[0].n === 0 }
    }
  })

  // First run: create the first super administrator. Only possible while there are no users at all.
  app.operation({
    name: 'auth.setup',
    public: true,
    schema: {
      type: 'object',
      required: ['username', 'pin'],
      properties: {
        username: { type: 'string', minLength: 2, maxLength: 40 },
        pin: pinSchema,
        setupCode: { type: 'string', maxLength: 64 }
      }
    },
    handler: async (ctx, { username, pin, setupCode }) => {
      if (ctx.setupCode) {
        const key = guardKeys(ctx, 'setup|')
        checkGuard(app.loginGuard, key)
        if (!safeEqual(String(setupCode || '').trim(), ctx.setupCode)) {
          recordFailure(app.loginGuard, key)
          throw unauthorized('رمز الإعداد غير صحيح. تجده في سجل تشغيل خادم HeroMarket.')
        }
      }
      // The first account has every permission: refuse the PINs anyone would try first.
      if (['0000', '1234', '1111'].includes(String(pin).trim()))
        throw badRequest('اختر رمزاً غير متوقع لمدير النظام (ليس 0000 أو 1234 أو 1111).')
      return ctx.tx(async (db) => {
        await db.query('LOCK TABLE users IN EXCLUSIVE MODE')
        const { rows } = await db.query('SELECT count(*)::int AS n FROM users')
        if (rows[0].n > 0) throw conflict('تم إعداد النظام بالفعل.')
        const role = await db.query("SELECT id FROM roles WHERE key = 'super_admin'")
        const user = await db.query(
          `INSERT INTO users (username, role, role_id, pin_lookup, pin_hash, is_active, created_at)
           VALUES ($1, 'admin', $2, $3, $4, true, LOCALTIMESTAMP(0)) RETURNING id`,
          [username.trim(), role.rows[0].id, pinLookup(ctx.secret, pin), hashPin(pin)]
        )
        const id = user.rows[0].id
        await db.query(
          `INSERT INTO system_logs (timestamp, user_id, username, action_type, description)
           VALUES (LOCALTIMESTAMP(0), $1, $2, 'user_create', 'إعداد النظام: إنشاء أول مدير للنظام')`,
          [id, username.trim()]
        )
        const token = await createSession(db, ctx, id)
        return { token, user: await describeUser(db, id) }
      })
    }
  })

  app.operation({
    name: 'auth.login',
    public: true,
    schema: {
      type: 'object',
      required: ['pin'],
      properties: { pin: { type: 'string', maxLength: 16 } }
    },
    handler: async (ctx, { pin }) => {
      const key = guardKeys(ctx)
      checkGuard(app.loginGuard, key)
      const clean = String(pin).trim()
      if (!isValidPin(clean)) {
        recordFailure(app.loginGuard, key)
        throw unauthorized('رمز الدخول خاطئ، يرجى المحاولة مرة أخرى.')
      }
      return ctx.tx(async (db) => {
        const userId = await findUserByPin(db, ctx.secret, clean)
        if (!userId) {
          recordFailure(app.loginGuard, key)
          throw unauthorized('رمز الدخول خاطئ، يرجى المحاولة مرة أخرى.')
        }
        clearTerminal(app.loginGuard, key)
        const token = await createSession(db, ctx, userId)
        const user = await describeUser(db, userId)
        const shift = await db.query(
          "SELECT * FROM shifts WHERE user_id = $1 AND status = 'open' ORDER BY id LIMIT 1",
          [userId]
        )
        return { token, user, openShift: shift.rows[0] || null }
      })
    }
  })

  app.operation({
    name: 'auth.logout',
    handler: async (ctx) => {
      await ctx.pool.query('UPDATE sessions SET revoked_at = LOCALTIMESTAMP(0) WHERE id = $1', [
        ctx.sessionId
      ])
    }
  })

  app.operation({ name: 'auth.me', handler: async (ctx) => ctx.user })

  // Supervisor approval on a till: another user's PIN, checked here; the approver needs pos.approve.
  app.operation({
    name: 'auth.verifyApprover',
    permission: 'pos.sell',
    schema: {
      type: 'object',
      required: ['pin'],
      properties: { pin: { type: 'string', maxLength: 16 } }
    },
    handler: async (ctx, { pin }) => {
      const key = guardKeys(ctx, 'approve|')
      checkGuard(app.loginGuard, key)
      const clean = String(pin).trim()
      const approverId = isValidPin(clean)
        ? await ctx.tx((db) => findUserByPin(db, ctx.secret, clean))
        : null
      const approver = approverId ? await describeUser(ctx.pool, approverId) : null
      if (!approver || !approver.permissions.includes('pos.approve')) {
        recordFailure(app.loginGuard, key)
        return { approved: false }
      }
      clearTerminal(app.loginGuard, key)
      await ctx.audit(
        ctx.pool,
        'manager_approval',
        `اعتماد عملية للكاشير "${ctx.user.username}" بواسطة "${approver.username}"`
      )
      return { approved: true, approver: approver.username }
    }
  })

  app.operation({
    name: 'auth.changePin',
    schema: {
      type: 'object',
      required: ['currentPin', 'newPin'],
      properties: { currentPin: { type: 'string', maxLength: 16 }, newPin: pinSchema }
    },
    handler: async (ctx, { currentPin, newPin }) => {
      if (newPin === currentPin)
        throw badRequest('رمز المرور الجديد لا يجب أن يكون متطابقاً مع القديم!')
      return ctx.tx(async (db) => {
        const { rows } = await db.query(
          'SELECT pin_hash, password_hash FROM users WHERE id = $1 FOR UPDATE',
          [ctx.user.id]
        )
        const u = rows[0]
        const [sha, plain] = legacyCandidates(currentPin)
        const ok = u.pin_hash
          ? verifyPin(String(currentPin).trim(), u.pin_hash)
          : u.password_hash === sha || u.password_hash === plain
        if (!ok) throw badRequest('رمز المرور الحالي غير صحيح!')
        await assertPinFree(db, ctx.secret, newPin, ctx.user.id)
        await db.query(
          'UPDATE users SET pin_lookup = $1, pin_hash = $2, password_hash = NULL, updated_at = LOCALTIMESTAMP(0) WHERE id = $3',
          [pinLookup(ctx.secret, newPin), hashPin(newPin), ctx.user.id]
        )
        await ctx.audit(db, 'user_update', `تغيير رمز المرور للمستخدم "${ctx.user.username}"`)
      })
    }
  })
}

module.exports.helpers = { assertPinFree, createSession, findUserByPin, pinSchema }
