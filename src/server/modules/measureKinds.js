'use strict'
// Measurement kinds (1.4.0, migration 0014): the three built-in kinds and those the owner adds.
//
// A kind has a name ("بالمتر"), the unit shown with quantities and on receipts ("متر") and how
// many decimals a quantity may have (0 = whole numbers only, up to 3). The built-in kinds (count,
// weight, volume) cannot be changed: weighing and existing rules depend on them. A kind the owner
// added can be renamed; its decimals can be raised at any time, but lowered only while no product
// uses it. It is stopped rather than deleted while products use it.
const { badRequest, conflict, notFound } = require('../errors')

const kindSchema = {
  type: 'object',
  required: ['name', 'unit', 'decimals'],
  properties: {
    key: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,39}$' },
    name: { type: 'string', minLength: 1, maxLength: 40 },
    unit: { type: 'string', minLength: 1, maxLength: 20 },
    decimals: { type: 'integer', minimum: 0, maximum: 3 }
  }
}

async function listKinds(db) {
  return (
    await db.query(
      `SELECT k.key, k.name, k.unit, k.decimals::int, k.is_system AS "isSystem", k.is_active AS "isActive",
              k.sort_order AS "sortOrder", count(p.barcode)::int AS products
         FROM measure_kinds k LEFT JOIN products p ON p.unit_kind = k.key
        GROUP BY k.key ORDER BY k.sort_order, k.created_at, k.key`
    )
  ).rows
}

async function lockedKind(db, key) {
  const k = (await db.query('SELECT * FROM measure_kinds WHERE key = $1 FOR UPDATE', [key])).rows[0]
  if (!k) throw notFound('طريقة القياس غير موجودة.')
  if (k.is_system) throw badRequest('طرق القياس الأساسية (بالعدد، بالوزن، بالحجم) لا تُعدَّل.')
  return k
}

const productsUsing = async (db, key) =>
  (await db.query('SELECT count(*)::int AS n FROM products WHERE unit_kind = $1', [key])).rows[0].n

module.exports = function measureKindsModule(app) {
  // Every signed-in user: the till, stock, purchases and receipts show quantities with them.
  app.operation({
    name: 'measureKinds.list',
    handler: async (ctx) => ({ kinds: await listKinds(ctx.pool) })
  })

  app.operation({
    name: 'measureKinds.save',
    permission: 'products.manage',
    schema: kindSchema,
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const name = b.name.trim()
        const unit = b.unit.trim()
        if (!name || !unit) throw badRequest('اكتب اسم طريقة القياس والوحدة.')
        if (/[|~<>]/.test(name + unit))
          throw badRequest('لا يُسمح بالرموز | ~ < > في الاسم أو الوحدة.')
        const same = await db.query(
          'SELECT key FROM measure_kinds WHERE lower(btrim(name)) = lower($1) AND key IS DISTINCT FROM $2',
          [name, b.key ?? null]
        )
        if (same.rowCount) throw conflict(`توجد طريقة قياس بالاسم "${name}" بالفعل.`)
        if (!b.key) {
          const key = `custom_${(await db.query("SELECT nextval('measure_kinds_custom_seq') AS n")).rows[0].n}`
          const order = (
            await db.query('SELECT COALESCE(max(sort_order), 0) + 1 AS n FROM measure_kinds')
          ).rows[0].n
          await db.query(
            'INSERT INTO measure_kinds (key, name, unit, decimals, sort_order) VALUES ($1, $2, $3, $4, $5)',
            [key, name, unit, b.decimals, order]
          )
          await ctx.audit(
            db,
            'measure_kind_create',
            `إضافة طريقة قياس "${name}" (${unit}، ${b.decimals} خانات عشرية)`,
            { key, name, unit, decimals: b.decimals }
          )
          return { key, kinds: await listKinds(db) }
        }
        const before = await lockedKind(db, b.key)
        if (b.decimals < before.decimals) {
          const n = await productsUsing(db, b.key)
          if (n)
            throw conflict(
              `لا يمكن تقليل الخانات العشرية لأن ${n} صنفاً يستخدم طريقة القياس "${before.name}". يمكن زيادتها فقط.`
            )
        }
        await db.query(
          'UPDATE measure_kinds SET name = $2, unit = $3, decimals = $4, updated_at = LOCALTIMESTAMP(0) WHERE key = $1',
          [b.key, name, unit, b.decimals]
        )
        await ctx.audit(db, 'measure_kind_update', `تعديل طريقة القياس "${name}"`, {
          key: b.key,
          from: { name: before.name, unit: before.unit, decimals: before.decimals },
          to: { name, unit, decimals: b.decimals }
        })
        return { key: b.key, kinds: await listKinds(db) }
      })
  })

  // Stopped kinds are no longer offered for products; products that use them keep them.
  app.operation({
    name: 'measureKinds.setActive',
    permission: 'products.manage',
    schema: {
      type: 'object',
      required: ['key', 'isActive'],
      properties: { key: { type: 'string', maxLength: 40 }, isActive: { type: 'boolean' } }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const k = await lockedKind(db, b.key)
        await db.query(
          'UPDATE measure_kinds SET is_active = $2, updated_at = LOCALTIMESTAMP(0) WHERE key = $1',
          [b.key, b.isActive]
        )
        await ctx.audit(
          db,
          'measure_kind_update',
          `${b.isActive ? 'تفعيل' : 'إيقاف'} طريقة القياس "${k.name}"`,
          { key: b.key, isActive: b.isActive }
        )
        return { kinds: await listKinds(db) }
      })
  })

  // Only a kind no product uses can be deleted (sales and stock history keep their quantities).
  app.operation({
    name: 'measureKinds.delete',
    permission: 'products.manage',
    schema: {
      type: 'object',
      required: ['key'],
      properties: { key: { type: 'string', maxLength: 40 } }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const k = await lockedKind(db, b.key)
        const n = await productsUsing(db, b.key)
        if (n)
          throw conflict(
            `طريقة القياس "${k.name}" مستخدمة في ${n} صنف؛ أوقفها بدلاً من حذفها، أو غيّر طريقة قياس هذه الأصناف أولاً.`
          )
        await db.query('DELETE FROM measure_kinds WHERE key = $1', [b.key])
        await ctx.audit(db, 'measure_kind_delete', `حذف طريقة القياس "${k.name}"`, { key: b.key })
        return { kinds: await listKinds(db) }
      })
  })
}
