'use strict'
// Discount rules, managed only by the administrator (permission discounts.manage). Checkout applies
// them automatically (pricing/discounts.js); no operator can grant, choose or remove a discount.
const { conflict, notFound } = require('../errors')
const { validateRule } = require('../pricing/discounts')

const ruleSchema = {
  type: 'object',
  required: ['name', 'scope', 'valueType', 'value'],
  properties: {
    id: { type: ['integer', 'null'] },
    version: { type: ['integer', 'null'] },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    scope: { type: 'string', enum: ['product', 'cart'] },
    productBarcode: { type: ['string', 'null'], maxLength: 64 },
    valueType: { type: 'string', enum: ['percent', 'amount'] },
    value: { type: 'number', exclusiveMinimum: 0 },
    minTotal: { type: ['number', 'null'], minimum: 0 },
    startsAt: { type: ['string', 'null'], maxLength: 25 },
    endsAt: { type: ['string', 'null'], maxLength: 25 },
    isActive: { type: 'boolean' }
  }
}

const SELECT = `SELECT r.*, p.name AS product_name, p.unit AS product_unit,
                       cu.username AS created_by_name, uu.username AS updated_by_name,
                       (r.is_active AND (r.starts_at IS NULL OR r.starts_at <= LOCALTIMESTAMP(0))
                                    AND (r.ends_at IS NULL OR r.ends_at > LOCALTIMESTAMP(0))) AS in_force
                  FROM discount_rules r
                  LEFT JOIN products p ON p.barcode = r.product_barcode
                  LEFT JOIN users cu ON cu.id = r.created_by
                  LEFT JOIN users uu ON uu.id = r.updated_by`

module.exports = function discountsModule(app) {
  app.operation({
    name: 'discounts.list',
    permission: 'discounts.manage',
    handler: async (ctx) =>
      (await ctx.pool.query(`${SELECT} ORDER BY r.is_active DESC, r.scope, r.min_total, r.id`)).rows
  })

  // Create (no id) or update (id + the version the form was loaded with: stale edits are refused).
  app.operation({
    name: 'discounts.save',
    permission: 'discounts.manage',
    schema: ruleSchema,
    handler: async (ctx, body) =>
      ctx.tx(async (db) => {
        const r = validateRule(body)
        if (r.productBarcode) {
          const p = await db.query('SELECT 1 FROM products WHERE barcode = $1', [r.productBarcode])
          if (!p.rowCount) throw notFound('الصنف غير موجود.')
        }
        const isActive = body.isActive !== false
        if (!body.id) {
          const id = (
            await db.query(
              `INSERT INTO discount_rules (name, scope, product_barcode, value_type, value, min_total, starts_at, ends_at, is_active, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
              [
                r.name,
                r.scope,
                r.productBarcode,
                r.valueType,
                r.value,
                r.minTotal,
                r.startsAt,
                r.endsAt,
                isActive,
                ctx.user.id
              ]
            )
          ).rows[0].id
          await ctx.audit(db, 'discount_create', `إنشاء خصم "${r.name}"`, { id, ...r, isActive })
          return (await db.query(`${SELECT} WHERE r.id = $1`, [id])).rows[0]
        }
        const before = (
          await db.query('SELECT * FROM discount_rules WHERE id = $1 FOR UPDATE', [body.id])
        ).rows[0]
        if (!before) throw notFound('الخصم غير موجود.')
        if (body.version !== undefined && body.version !== null && body.version !== before.version)
          throw conflict('عدّل مستخدم آخر هذا الخصم بعد فتحه. أعد فتحه ثم احفظ.')
        await db.query(
          `UPDATE discount_rules SET name = $2, scope = $3, product_barcode = $4, value_type = $5, value = $6, min_total = $7,
                  starts_at = $8, ends_at = $9, is_active = $10, version = version + 1, updated_by = $11, updated_at = LOCALTIMESTAMP(0)
            WHERE id = $1`,
          [
            body.id,
            r.name,
            r.scope,
            r.productBarcode,
            r.valueType,
            r.value,
            r.minTotal,
            r.startsAt,
            r.endsAt,
            isActive,
            ctx.user.id
          ]
        )
        const after = (await db.query('SELECT * FROM discount_rules WHERE id = $1', [body.id]))
          .rows[0]
        const changes = {}
        for (const k of [
          'name',
          'scope',
          'product_barcode',
          'value_type',
          'value',
          'min_total',
          'starts_at',
          'ends_at',
          'is_active'
        ])
          if (String(before[k]) !== String(after[k])) changes[k] = { from: before[k], to: after[k] }
        await ctx.audit(db, 'discount_update', `تعديل خصم "${after.name}"`, {
          id: body.id,
          changes
        })
        return (await db.query(`${SELECT} WHERE r.id = $1`, [body.id])).rows[0]
      })
  })

  // Activate / deactivate (rules are never deleted: sales keep pointing at them).
  app.operation({
    name: 'discounts.setActive',
    permission: 'discounts.manage',
    schema: {
      type: 'object',
      required: ['id', 'isActive'],
      properties: { id: { type: 'integer' }, isActive: { type: 'boolean' } }
    },
    handler: async (ctx, { id, isActive }) =>
      ctx.tx(async (db) => {
        const r = (
          await db.query(
            `UPDATE discount_rules SET is_active = $2, version = version + 1, updated_by = $3, updated_at = LOCALTIMESTAMP(0)
              WHERE id = $1 RETURNING name`,
            [id, isActive, ctx.user.id]
          )
        ).rows[0]
        if (!r) throw notFound('الخصم غير موجود.')
        await ctx.audit(
          db,
          isActive ? 'discount_activate' : 'discount_deactivate',
          `${isActive ? 'تفعيل' : 'إيقاف'} خصم "${r.name}"`,
          { id }
        )
        return (await db.query(`${SELECT} WHERE r.id = $1`, [id])).rows[0]
      })
  })
}
