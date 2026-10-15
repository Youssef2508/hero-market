'use strict'
// Cloud synchronisation on the store PC (stage 4 phase 4, D-042 / D-047): the link settings, the
// status shown to the administrator, "sync now", and recovery after a restore. The agent itself is
// src/server/sync/agent.js; it runs in the background only when the desktop app asks for it
// (cfg.syncAgent) and the link is enabled. Selling never depends on it.
const { SyncAgent, syncState } = require('../sync/agent')
const { HttpTransport, TransportError } = require('../sync/transport')
const { badRequest, conflict, ServiceError } = require('../errors')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const linked = (st) => !!(st && st.enabled && st.cloud_url && st.device_token)

/** Status for the administrator (never the device token). */
async function describe(db) {
  const st = await syncState(db)
  const pending = Number(
    (await db.query('SELECT count(*) AS n FROM sync_outbox WHERE acked_at IS NULL')).rows[0].n
  )
  const commands = (
    await db.query(
      'SELECT status, count(*)::int AS n FROM applied_commands GROUP BY status ORDER BY status'
    )
  ).rows
  return {
    linked: linked(st),
    enabled: st.enabled,
    cloudUrl: st.cloud_url,
    storeId: st.store_id,
    hasToken: !!st.device_token,
    linkedAt: st.linked_at,
    epoch: st.epoch,
    pending,
    lastPushAt: st.last_push_at,
    lastPullAt: st.last_pull_at,
    lastCheckAt: st.last_check_at,
    checkOk: st.check_ok,
    checkDetail: st.check_detail,
    lastError: st.last_error,
    lastErrorAt: st.last_error_at,
    recoveryPending: st.recovery_pending,
    recoverFrom: st.recover_from,
    recoveredAt: st.recovered_at,
    recoveryDetail: st.recovery_detail,
    commands
  }
}

const syncFailed = (e) =>
  new ServiceError(
    502,
    e.code === 'not_linked' ? 'not_linked' : 'sync_failed',
    e.code === 'not_linked'
      ? 'المتجر غير مربوط بالسحابة. أدخل بيانات الربط أولاً.'
      : e.code === 'backup_from_another_store'
        ? 'النسخة الاحتياطية المستعادة تخص متجراً آخر غير المربوط بالسحابة؛ لا يمكن الاسترجاع منها.'
        : e instanceof TransportError
          ? `تعذر الاتصال بالسحابة: ${e.message}`
          : `فشلت المزامنة على هذا الجهاز ولم يتغير شيء: ${e.message}`
  )

module.exports = function syncModule(app) {
  const cfg = app.config
  const transport = async () => {
    const st = await syncState(app.pool)
    if (!linked(st)) return null
    if (cfg.syncTransport) return cfg.syncTransport(st)
    return new HttpTransport({ url: st.cloud_url, storeId: st.store_id, token: st.device_token })
  }
  const agent = new SyncAgent({
    pool: app.pool,
    transport,
    log: (m) => app.log.info(m)
  })
  app.decorate('syncAgent', agent)

  // Writes pause after a restore of a synchronised store until recovery (or an explicit skip).
  const flags = { recoveryPending: false }
  app.decorate('syncFlags', flags)
  const refresh = async () => {
    flags.recoveryPending = !!(await syncState(app.pool))?.recovery_pending
  }
  app.decorate('refreshSyncFlags', refresh)

  app.addHook('onReady', async () => {
    await refresh().catch(() => {})
    if (cfg.syncAgent) agent.start(cfg.syncIntervalMs || 15000)
  })
  app.addHook('onClose', async () => agent.stop())

  // Anyone signed in: is the till paused for recovery? (The screens show why writes are refused.)
  app.operation({
    name: 'sync.state',
    handler: async (ctx) => {
      const st = await syncState(ctx.pool)
      return { recoveryPending: st.recovery_pending, linked: linked(st) }
    }
  })

  app.operation({
    name: 'sync.status',
    permission: 'sync.manage',
    handler: async (ctx) => describe(ctx.pool)
  })

  app.operation({
    name: 'sync.configure',
    permission: 'sync.manage',
    schema: {
      type: 'object',
      required: ['cloudUrl', 'storeId', 'enabled'],
      properties: {
        cloudUrl: { type: 'string', minLength: 8, maxLength: 300 },
        storeId: { type: 'string', maxLength: 36 },
        deviceToken: { type: 'string', maxLength: 200 },
        enabled: { type: 'boolean' },
        // Linking this PC to a different cloud store than before (everything is sent again).
        relink: { type: 'boolean' }
      }
    },
    handler: async (ctx, b) => {
      const url = b.cloudUrl.trim().replace(/\/+$/, '')
      if (!/^https:\/\//i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url))
        throw badRequest('عنوان السحابة يجب أن يبدأ بـ https://')
      if (!UUID.test(b.storeId)) throw badRequest('رقم المتجر غير صالح.')
      const token = b.deviceToken?.trim()
      if (token !== undefined && token !== '' && token.length < 20)
        throw badRequest('رمز الجهاز غير صالح.')
      const result = await ctx.tx(async (db) => {
        const st = (await db.query('SELECT * FROM sync_state FOR UPDATE')).rows[0]
        if (!token && !st.device_token) throw badRequest('أدخل رمز الجهاز من حساب المالك.')
        const changesStore = st.store_id !== b.storeId
        if (changesStore && st.epoch && !b.relink)
          throw conflict(
            'هذا الجهاز مربوط بمتجر آخر في السحابة. لتغيير الربط أكّد إعادة الربط (سيُرسل كل شيء من جديد).'
          )
        if (changesStore) {
          await db.query('DELETE FROM sync_outbox')
          await db.query('DELETE FROM sync_row_versions')
        }
        await db.query(
          `UPDATE sync_state SET cloud_url = $1, store_id = $2, device_token = COALESCE($3, device_token),
                  enabled = $4, linked_at = COALESCE(linked_at, LOCALTIMESTAMP(0)),
                  epoch = CASE WHEN $5 THEN NULL ELSE epoch END, last_error = NULL`,
          [url, b.storeId, token || null, b.enabled, changesStore]
        )
        await ctx.audit(
          db,
          'sync_configure',
          `ربط المتجر بالسحابة: ${url} (${b.enabled ? 'مفعّل' : 'متوقف'})${changesStore ? ' – متجر جديد في السحابة' : ''}`
        )
        return describe(db)
      })
      if (cfg.syncAgent && b.enabled) agent.start(cfg.syncIntervalMs || 15000)
      if (!b.enabled) agent.stop()
      return result
    }
  })

  app.operation({
    name: 'sync.unlink',
    permission: 'sync.manage',
    handler: async (ctx) => {
      agent.stop()
      return ctx.tx(async (db) => {
        await db.query(
          `UPDATE sync_state SET enabled = false, cloud_url = NULL, device_token = NULL, epoch = NULL,
                  recovery_pending = false`
        )
        await ctx.audit(db, 'sync_configure', 'إلغاء ربط المتجر بالسحابة')
        const s = await describe(db)
        flags.recoveryPending = false
        return s
      })
    }
  })

  app.operation({
    name: 'sync.runNow',
    permission: 'sync.manage',
    handler: async (ctx) => {
      try {
        if (!linked(await syncState(ctx.pool))) {
          const e = new Error('not_linked')
          e.code = 'not_linked'
          throw e
        }
        const r = await agent.runOnce()
        return { result: r, status: await describe(ctx.pool) }
      } catch (e) {
        throw syncFailed(e)
      }
    }
  })

  app.operation({
    name: 'sync.recover',
    permission: 'sync.manage',
    handler: async (ctx) => {
      let r
      try {
        r = await agent.recover()
      } catch (e) {
        throw syncFailed(e)
      }
      await refresh()
      // Start the new epoch straight away; a failure here is retried by the background agent.
      const next = await agent.runOnce().catch((e) => ({ error: e.message }))
      return { recovery: r, sync: next, status: await describe(ctx.pool) }
    }
  })

  app.operation({
    name: 'sync.skipRecovery',
    permission: 'sync.manage',
    schema: {
      type: 'object',
      required: ['confirm'],
      properties: { confirm: { const: 'SKIP' } }
    },
    handler: async (ctx) => {
      const s = await ctx.tx(async (db) => {
        const st = (await db.query('SELECT * FROM sync_state FOR UPDATE')).rows[0]
        if (!st.recovery_pending) return describe(db)
        await db.query(
          `UPDATE sync_state SET recovery_pending = false, recover_from = NULL,
                  recovery_detail = $1`,
          [JSON.stringify({ skipped: true, by: ctx.user.username, from: st.recover_from })]
        )
        await ctx.audit(
          db,
          'sync_recovery',
          'تخطي استرجاع البيانات من السحابة بعد استعادة النسخة الاحتياطية (التغييرات التي وصلت للسحابة بعد النسخة لن تعود لهذا الجهاز)'
        )
        return describe(db)
      })
      await refresh()
      return s
    }
  })
}
