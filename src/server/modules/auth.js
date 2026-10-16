'use strict'
// Sign-in (stage 4 phase 3): username + password. PINs are only accepted once, to move an existing
// user to a password (see src/server/auth/credentials.js); choosing the password erases the PIN.
const crypto = require('crypto')
const { describeUser } = require('../auth/access')
const { shiftRequiredFor } = require('../auth/shiftRule')
const { checkCredentials } = require('../auth/credentials')
const {
  passwordProblem,
  hashPassword,
  verifyPassword,
  newRecoveryCode,
  hashRecoveryCode,
  verifyRecoveryCode,
  burnTime
} = require('../auth/password')
const { guardKeys, checkGuard, recordFailure, clearTerminal } = require('../auth/guard')
const { badRequest, unauthorized, conflict } = require('../errors')
const { sha256 } = require('../app')

const WRONG = 'اسم المستخدم أو كلمة المرور غير صحيحة.'

function safeEqual(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
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

async function openShiftOf(db, userId) {
  const { rows } = await db.query(
    "SELECT * FROM shifts WHERE user_id = $1 AND status = 'open' ORDER BY id LIMIT 1",
    [userId]
  )
  return rows[0] || null
}

/**
 * Store a new password: erases any PIN, clears the "must change" flag, ends the user's other
 * sessions. A super administrator without a recovery code receives one (returned once, stored hashed).
 */
async function storePassword(db, userId, password, { keepSessions = false } = {}) {
  await db.query(
    `UPDATE users SET password_scrypt = $1, must_change_password = false, password_changed_at = LOCALTIMESTAMP(0),
            pin_lookup = NULL, pin_hash = NULL, password_hash = NULL, updated_at = LOCALTIMESTAMP(0)
      WHERE id = $2`,
    [hashPassword(password), userId]
  )
  if (!keepSessions)
    await db.query(
      'UPDATE sessions SET revoked_at = LOCALTIMESTAMP(0) WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    )
  return ensureRecoveryCode(db, userId)
}

/** Issue a recovery code to a super administrator who has none. Returns the code or null. */
async function ensureRecoveryCode(db, userId, { replace = false } = {}) {
  const { rows } = await db.query(
    `SELECT u.recovery_hash, r.key AS role_key FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [userId]
  )
  const u = rows[0]
  if (!u || u.role_key !== 'super_admin' || (u.recovery_hash && !replace)) return null
  const code = newRecoveryCode()
  await db.query(
    'UPDATE users SET recovery_hash = $1, recovery_created_at = LOCALTIMESTAMP(0) WHERE id = $2',
    [hashRecoveryCode(code), userId]
  )
  return code
}

function assertNewPassword(password, username) {
  const problem = passwordProblem(password, username)
  if (problem) throw badRequest(problem, { code: 'weak_password' })
}

const passwordSchema = { type: 'string', minLength: 1, maxLength: 128 }
const usernameSchema = { type: 'string', minLength: 1, maxLength: 40 }

async function audit(db, userId, username, action, description) {
  await db.query(
    `INSERT INTO system_logs (timestamp, user_id, username, action_type, description)
     VALUES (LOCALTIMESTAMP(0), $1, $2, $3, $4)`,
    [userId, username, action, description]
  )
}

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
      required: ['username', 'password'],
      properties: {
        username: { type: 'string', minLength: 2, maxLength: 40 },
        password: passwordSchema,
        setupCode: { type: 'string', maxLength: 64 }
      }
    },
    handler: async (ctx, { username, password, setupCode }) => {
      if (ctx.setupCode) {
        const key = guardKeys(ctx, 'setup|')
        checkGuard(ctx.guard, key)
        if (!safeEqual(String(setupCode || '').trim(), ctx.setupCode)) {
          recordFailure(ctx.guard, key)
          throw unauthorized('رمز الإعداد غير صحيح. تجده في سجل تشغيل خادم HeroMarket.')
        }
      }
      const name = username.trim()
      assertNewPassword(password, name)
      return ctx.tx(async (db) => {
        await db.query('LOCK TABLE users IN EXCLUSIVE MODE')
        const { rows } = await db.query('SELECT count(*)::int AS n FROM users')
        if (rows[0].n > 0) throw conflict('تم إعداد النظام بالفعل.')
        const role = await db.query("SELECT id FROM roles WHERE key = 'super_admin'")
        const user = await db.query(
          `INSERT INTO users (username, role, role_id, is_active, created_at)
           VALUES ($1, 'admin', $2, true, LOCALTIMESTAMP(0)) RETURNING id`,
          [name, role.rows[0].id]
        )
        const id = user.rows[0].id
        const recoveryCode = await storePassword(db, id, password)
        await audit(db, id, name, 'user_create', 'إعداد النظام: إنشاء أول مدير للنظام')
        const token = await createSession(db, ctx, id)
        return { token, user: await describeUser(db, id), recoveryCode, shiftRequired: false }
      })
    }
  })

  // Sign-in. When the user must choose a password (first sign-in with the old PIN, or a temporary
  // password) no session is issued: the answer is { passwordChangeRequired: true } and the terminal
  // continues with auth.setPassword using the same current secret.
  app.operation({
    name: 'auth.login',
    public: true,
    schema: {
      type: 'object',
      required: ['username', 'password'],
      properties: { username: usernameSchema, password: passwordSchema }
    },
    handler: async (ctx, { username, password }) => {
      const key = guardKeys(ctx)
      checkGuard(ctx.guard, key)
      const { account, state } = await checkCredentials(ctx.pool, username, password)
      if (state === 'invalid') {
        recordFailure(ctx.guard, key)
        throw unauthorized(WRONG)
      }
      clearTerminal(ctx.guard, key)
      if (state === 'change_required')
        return {
          passwordChangeRequired: true,
          username: account.username,
          firstPassword: !account.password_scrypt
        }
      return ctx.tx(async (db) => {
        const token = await createSession(db, ctx, account.id)
        const user = await describeUser(db, account.id)
        return {
          token,
          user,
          openShift: await openShiftOf(db, account.id),
          shiftRequired: await shiftRequiredFor(db, user)
        }
      })
    }
  })

  // Choose a password with the current secret (old PIN, temporary password or current password).
  app.operation({
    name: 'auth.setPassword',
    public: true,
    schema: {
      type: 'object',
      required: ['username', 'currentPassword', 'newPassword'],
      properties: {
        username: usernameSchema,
        currentPassword: passwordSchema,
        newPassword: passwordSchema
      }
    },
    handler: async (ctx, { username, currentPassword, newPassword }) => {
      const key = guardKeys(ctx)
      checkGuard(ctx.guard, key)
      const { account, state } = await checkCredentials(ctx.pool, username, currentPassword)
      if (state === 'invalid') {
        recordFailure(ctx.guard, key)
        throw unauthorized(WRONG)
      }
      clearTerminal(ctx.guard, key)
      assertNewPassword(newPassword, account.username)
      if (newPassword === currentPassword)
        throw badRequest('كلمة المرور الجديدة يجب أن تختلف عن الحالية.', {
          code: 'weak_password'
        })
      return ctx.tx(async (db) => {
        const recoveryCode = await storePassword(db, account.id, newPassword)
        await audit(
          db,
          account.id,
          account.username,
          'user_update',
          account.password_scrypt
            ? `تعيين كلمة مرور جديدة للمستخدم "${account.username}"`
            : `تفعيل كلمة المرور للمستخدم "${account.username}" وإلغاء رمز PIN`
        )
        const token = await createSession(db, ctx, account.id)
        const user = await describeUser(db, account.id)
        return {
          token,
          user,
          openShift: await openShiftOf(db, account.id),
          shiftRequired: await shiftRequiredFor(db, user),
          recoveryCode
        }
      })
    }
  })

  // Forgotten password of a super administrator: the one-time recovery code. A new code is issued.
  app.operation({
    name: 'auth.recover',
    public: true,
    schema: {
      type: 'object',
      required: ['username', 'recoveryCode', 'newPassword'],
      properties: {
        username: usernameSchema,
        recoveryCode: { type: 'string', minLength: 1, maxLength: 64 },
        newPassword: passwordSchema
      }
    },
    handler: async (ctx, { username, recoveryCode, newPassword }) => {
      const key = guardKeys(ctx, 'recover|')
      checkGuard(ctx.guard, key)
      return ctx.tx(async (db) => {
        const { rows } = await db.query(
          `SELECT u.id, u.username, u.recovery_hash FROM users u JOIN roles r ON r.id = u.role_id
            WHERE lower(u.username) = lower($1) AND u.is_active AND r.key = 'super_admin'
            ORDER BY (u.username = $1) DESC LIMIT 1 FOR UPDATE OF u`,
          [String(username).trim()]
        )
        const u = rows[0]
        const ok = u?.recovery_hash
          ? verifyRecoveryCode(recoveryCode, u.recovery_hash)
          : burnTime(recoveryCode)
        if (!ok) {
          recordFailure(ctx.guard, key)
          throw unauthorized('اسم المستخدم أو رمز الاسترداد غير صحيح.')
        }
        clearTerminal(ctx.guard, key)
        assertNewPassword(newPassword, u.username)
        await db.query('UPDATE users SET recovery_hash = NULL WHERE id = $1', [u.id])
        const newCode = await storePassword(db, u.id, newPassword)
        await audit(
          db,
          u.id,
          u.username,
          'password_recovery',
          `استعادة كلمة مرور مدير النظام "${u.username}" برمز الاسترداد (تم إصدار رمز جديد)`
        )
        const token = await createSession(db, ctx, u.id)
        const user = await describeUser(db, u.id)
        return {
          token,
          user,
          openShift: await openShiftOf(db, u.id),
          shiftRequired: await shiftRequiredFor(db, user),
          recoveryCode: newCode
        }
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

  app.operation({
    name: 'auth.changePassword',
    schema: {
      type: 'object',
      required: ['currentPassword', 'newPassword'],
      properties: { currentPassword: passwordSchema, newPassword: passwordSchema }
    },
    handler: async (ctx, { currentPassword, newPassword }) => {
      const key = guardKeys(ctx, 'change|')
      checkGuard(ctx.guard, key)
      return ctx.tx(async (db) => {
        const { rows } = await db.query(
          'SELECT password_scrypt FROM users WHERE id = $1 FOR UPDATE',
          [ctx.user.id]
        )
        if (!verifyPassword(currentPassword, rows[0]?.password_scrypt)) {
          recordFailure(ctx.guard, key)
          throw badRequest('كلمة المرور الحالية غير صحيحة!')
        }
        assertNewPassword(newPassword, ctx.user.username)
        if (newPassword === currentPassword)
          throw badRequest('كلمة المرور الجديدة يجب أن تختلف عن الحالية.')
        // Other terminals signed in as this user are signed out; this session stays.
        await storePassword(db, ctx.user.id, newPassword, { keepSessions: true })
        await db.query(
          'UPDATE sessions SET revoked_at = LOCALTIMESTAMP(0) WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL',
          [ctx.user.id, ctx.sessionId]
        )
        await ctx.audit(db, 'user_update', `تغيير كلمة المرور للمستخدم "${ctx.user.username}"`)
      })
    }
  })

  // A super administrator replaces their recovery code (e.g. the paper copy was lost).
  app.operation({
    name: 'auth.newRecoveryCode',
    schema: {
      type: 'object',
      required: ['currentPassword'],
      properties: { currentPassword: passwordSchema }
    },
    handler: async (ctx, { currentPassword }) => {
      if (ctx.user.roleKey !== 'super_admin')
        throw badRequest('رمز الاسترداد متاح لمدير النظام فقط.')
      const key = guardKeys(ctx, 'change|')
      checkGuard(ctx.guard, key)
      return ctx.tx(async (db) => {
        const { rows } = await db.query(
          'SELECT password_scrypt FROM users WHERE id = $1 FOR UPDATE',
          [ctx.user.id]
        )
        if (!verifyPassword(currentPassword, rows[0]?.password_scrypt)) {
          recordFailure(ctx.guard, key)
          throw badRequest('كلمة المرور الحالية غير صحيحة!')
        }
        const recoveryCode = await ensureRecoveryCode(db, ctx.user.id, { replace: true })
        await ctx.audit(db, 'user_update', `إصدار رمز استرداد جديد للمستخدم "${ctx.user.username}"`)
        return { recoveryCode }
      })
    }
  })
}

module.exports.helpers = { createSession, storePassword, assertNewPassword, passwordSchema }
