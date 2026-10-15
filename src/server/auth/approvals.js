'use strict'
// Supervisor approvals (owner decisions 2026-10-14, stage 4 phase 3).
//
// The approval travels with the action itself: the terminal sends the supervisor's username and
// password in the same request, the service checks them and performs the action in one transaction.
// An approval therefore cannot be reused for another action, amount or invoice.
//
// Every decision is recorded in `approvals`:
//   approved – the supervisor's credentials and authority were verified (written with the action,
//              so it exists only if the action happened);
//   refused  – the supervisor signed in and pressed "refuse";
//   failed   – wrong credentials, no authority, the requester approving themselves, or a supervisor
//              who still has to choose a password.
// Refused and failed attempts are written on a separate connection, so they are kept although the
// action is rolled back.
const { checkCredentials } = require('./credentials')
const { describeUser } = require('./access')
const { guardKeys, checkGuard, recordFailure, clearTerminal } = require('./guard')
const { badRequest, approvalRequired, approvalRefused } = require('../errors')

const LABELS = {
  sale_return: 'مرتجع',
  shift_difference: 'فرق إغلاق الوردية'
}

const FAILURES = {
  invalid_credentials: 'اسم المستخدم أو كلمة المرور للمشرف غير صحيحة. لم تُنفذ العملية.',
  password_not_set:
    'يجب على المشرف تسجيل الدخول مرة واحدة واختيار كلمة مرور قبل اعتماد العمليات. لم تُنفذ العملية.',
  same_user: 'لا يمكنك اعتماد عمليتك بنفسك. يجب أن يعتمدها مشرف آخر.',
  no_authority: 'هذا الحساب لا يملك صلاحية اعتماد هذه العملية. لم تُنفذ العملية.'
}

async function record(db, ctx, row) {
  const { rows } = await db.query(
    `INSERT INTO approvals (action, decision, requested_by, requested_username, approver_id, approver_username,
       self_approved, subject_type, subject_id, amount, reason, failure, terminal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [
      row.action,
      row.decision,
      ctx.user.id,
      ctx.user.username,
      row.approverId ?? null,
      row.approverUsername ?? null,
      !!row.self,
      row.subjectType,
      row.subjectId,
      row.amount ?? null,
      row.reason || null,
      row.failure || null,
      ctx.terminal
    ]
  )
  return rows[0].id
}

/**
 * Decide whether `ctx.user` may perform an action that needs supervision.
 *
 * opts:
 *   action            'sale_return' | 'shift_difference'
 *   selfAllowed       the requester holds the authority (e.g. sales.return, pos.approve)
 *   recordSelf        record a self-approval row too (shift acknowledgements)
 *   approverPermissions  permissions the approving supervisor must hold
 *   subjectType, subjectId, amount
 *   reason, reasonRequired
 *   approver          { username, password, decision?: 'approve' | 'refuse' } from the terminal
 *   details           shown to the terminal with approval_required (amount, invoice, …)
 *
 * Returns { approvalId, approver } (approvalId is null for an unrecorded self-approval).
 * Throws approval_required (403) when credentials are missing, approval_refused (403) otherwise.
 */
async function authorize(ctx, db, opts) {
  const reason = String(opts.reason || '').trim()
  const base = {
    action: opts.action,
    subjectType: opts.subjectType,
    subjectId: opts.subjectId,
    amount: opts.amount,
    reason
  }
  if (opts.selfAllowed) {
    const approvalId = opts.recordSelf
      ? await record(db, ctx, {
          ...base,
          decision: 'approved',
          self: true,
          approverId: ctx.user.id,
          approverUsername: ctx.user.username
        })
      : null
    return { approvalId, approver: ctx.user.username }
  }
  const cred = opts.approver || {}
  if (!cred.username || !cred.password)
    throw approvalRequired(`تحتاج هذه العملية (${LABELS[opts.action]}) إلى موافقة المشرف.`, {
      action: opts.action,
      amount: opts.amount ?? null,
      reasonRequired: !!opts.reasonRequired,
      ...opts.details
    })
  if (opts.reasonRequired && reason.length < 3)
    throw badRequest('يجب كتابة سبب العملية (3 أحرف على الأقل).', { code: 'reason_required' })

  const keys = guardKeys(ctx, 'approve|')
  checkGuard(ctx.guard, keys)
  const { account, state } = await checkCredentials(ctx.pool, cred.username, cred.password)
  let failure = null
  let approver = null
  if (state === 'invalid') failure = 'invalid_credentials'
  else if (state === 'change_required') failure = 'password_not_set'
  else if (account.id === ctx.user.id) failure = 'same_user'
  else {
    approver = await describeUser(ctx.pool, account.id)
    if (!opts.approverPermissions.every((p) => approver.permissions.includes(p)))
      failure = 'no_authority'
  }
  const typed = String(cred.username).trim().slice(0, 40)

  if (failure) {
    if (failure === 'invalid_credentials') recordFailure(ctx.guard, keys)
    const id = await record(ctx.pool, ctx, {
      ...base,
      decision: 'failed',
      failure,
      approverId: account && state !== 'invalid' ? account.id : null,
      approverUsername: typed
    })
    await ctx.audit(
      ctx.pool,
      'approval_failed',
      `محاولة اعتماد فاشلة (${LABELS[opts.action]}) للمستخدم "${ctx.user.username}" باسم المشرف "${typed}": ${failure}`,
      { approvalId: id, subjectType: opts.subjectType, subjectId: opts.subjectId }
    )
    throw approvalRefused(FAILURES[failure], { failure })
  }
  clearTerminal(ctx.guard, keys)

  if (cred.decision === 'refuse') {
    const id = await record(ctx.pool, ctx, {
      ...base,
      decision: 'refused',
      approverId: approver.id,
      approverUsername: approver.username
    })
    await ctx.audit(
      ctx.pool,
      'approval_refused',
      `رفض المشرف "${approver.username}" عملية (${LABELS[opts.action]}) للمستخدم "${ctx.user.username}"`,
      { approvalId: id, subjectType: opts.subjectType, subjectId: opts.subjectId }
    )
    throw approvalRefused(`رفض المشرف "${approver.username}" العملية. لم تُنفذ.`, {
      failure: 'refused'
    })
  }

  const approvalId = await record(db, ctx, {
    ...base,
    decision: 'approved',
    approverId: approver.id,
    approverUsername: approver.username
  })
  await ctx.audit(
    db,
    'manager_approval',
    `اعتماد عملية (${LABELS[opts.action]}) للمستخدم "${ctx.user.username}" بواسطة "${approver.username}"`,
    { approvalId, subjectType: opts.subjectType, subjectId: opts.subjectId, reason }
  )
  return { approvalId, approver: approver.username }
}

/** Request body fragment for actions that may need a supervisor. */
const approverSchema = {
  type: 'object',
  properties: {
    username: { type: 'string', maxLength: 40 },
    password: { type: 'string', maxLength: 128 },
    decision: { type: 'string', enum: ['approve', 'refuse'] }
  }
}

module.exports = { authorize, approverSchema }
