'use strict'
// «تحتاج انتباهك»: what a person must look at after the shop and the cloud came together (Phase 2
// milestone 3, D-103). The list is written by the merge (sync/merge.js) on the shop and reaches the
// cloud like any record; settling an item is an ordinary operation on either way in. Settling only
// records the decision: the correction itself (a count, a refund, an edit) is made with the
// ordinary operations, so no entry is ever invented here.
const { notFound, conflict } = require('../errors')

const LABELS = {
  conflict: 'نفس الحقل تغيّر في المتجر والسحابة – بقيت قيمة المتجر',
  not_applied: 'سجل من الجهة الأخرى لم يُحفظ هنا',
  delete_kept: 'حذف من الجهة الأخرى لم يُنفّذ لأن السجل مستخدم',
  stock_negative: 'الرصيد بالسالب بعد بيع نفس البضاعة في الجهتين',
  overpaid: 'رصيد سُدّد أكثر من المستحق في الجهتين',
  returned_twice: 'نفس الصنف أُرجع في الجهتين أكثر من المباع',
  after_close: 'مبيعات من السحابة وصلت بعد إغلاق ورديتها في المتجر',
  two_open_shifts: 'وردية مفتوحة لنفس المستخدم في الجهتين'
}

module.exports = function attentionModule(app) {
  app.operation({
    name: 'attention.list',
    permission: 'sync.resolve',
    schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'resolved', 'all'] } }
    },
    handler: async (ctx, { status = 'open' }) => {
      const rows = (
        await ctx.pool.query(
          `SELECT a.*, u.username AS resolved_by_name FROM sync_attention a
             LEFT JOIN users u ON u.id = a.resolved_by
            WHERE $1 = 'all' OR a.status = $1 ORDER BY a.id DESC LIMIT 500`,
          [status]
        )
      ).rows
      return rows.map((r) => ({ ...r, label: LABELS[r.kind] || r.kind }))
    }
  })

  app.operation({
    name: 'attention.count',
    permission: 'sync.resolve',
    handler: async (ctx) => ({
      open: Number(
        (await ctx.pool.query("SELECT count(*) AS n FROM sync_attention WHERE status = 'open'"))
          .rows[0].n
      )
    })
  })

  app.operation({
    name: 'attention.resolve',
    permission: 'sync.resolve',
    schema: {
      type: 'object',
      required: ['id', 'note'],
      properties: {
        id: { type: 'integer' },
        note: { type: 'string', minLength: 3, maxLength: 500 }
      }
    },
    handler: async (ctx, { id, note }) =>
      ctx.tx(async (db) => {
        const a = (await db.query('SELECT * FROM sync_attention WHERE id = $1 FOR UPDATE', [id]))
          .rows[0]
        if (!a) throw notFound('العنصر غير موجود.')
        if (a.status === 'resolved') throw conflict('تمت معالجة هذا العنصر من قبل.')
        await db.query(
          `UPDATE sync_attention SET status = 'resolved', resolved_by = $2,
                  resolved_at = LOCALTIMESTAMP(0), note = $3 WHERE id = $1`,
          [id, ctx.user.id, note.trim()]
        )
        await ctx.audit(
          db,
          'sync_attention',
          `معالجة عنصر مزامنة #${id} (${LABELS[a.kind] || a.kind}): ${note.trim()}`,
          { id, kind: a.kind }
        )
        return { ok: true }
      })
  })
}

module.exports.LABELS = LABELS
