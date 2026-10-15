'use strict'
// Product categories (1.4.0, migration 0013): administration and category browsing at the till.
//
// Browsing is a complement to scanning and search, never a separate way to sell: the till adds a
// browsed product through the same pos.resolve → cart → pos.price → pos.checkout path, so prices,
// units, stock rules and automatic discounts are always the current ones from the database.
//
// The till caches what it browses (src/renderer/src/lib/catalogCache.js) and reloads only when
// catalog_state.version changes – names, prices, units, categories or active status – not on
// every sale.
const { badRequest, conflict, notFound } = require('../errors')
const { unitPrice, baseUnit } = require('../inventory/units')

const UNCATEGORISED = 0 // the till's "بدون تصنيف" group (category_id IS NULL)
const PAGE = 200

async function catalogVersion(db) {
  return Number((await db.query('SELECT version FROM catalog_state')).rows[0].version)
}

const categorySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    id: { type: 'integer' },
    name: { type: 'string', minLength: 1, maxLength: 60 },
    description: { type: ['string', 'null'], maxLength: 200 },
    sortOrder: { type: 'integer', minimum: 0, maximum: 100000 },
    isActive: { type: 'boolean' }
  }
}

module.exports = function categoriesModule(app) {
  // Everyone who works with products or sells sees the list (with active product counts).
  app.operation({
    name: 'categories.list',
    anyPermission: ['products.view', 'categories.manage', 'pos.sell'],
    handler: async (ctx) => {
      const { rows } = await ctx.pool.query(
        `SELECT c.id, c.name, c.description, c.sort_order AS "sortOrder", c.is_active AS "isActive",
                count(p.barcode) FILTER (WHERE p.is_active)::int AS products,
                count(p.barcode) FILTER (WHERE NOT p.is_active)::int AS "inactiveProducts"
           FROM categories c LEFT JOIN products p ON p.category_id = c.id
          GROUP BY c.id ORDER BY c.sort_order, c.name, c.id`
      )
      const none = (
        await ctx.pool.query(
          'SELECT count(*)::int AS n FROM products WHERE category_id IS NULL AND is_active'
        )
      ).rows[0].n
      return { categories: rows, uncategorised: none, version: await catalogVersion(ctx.pool) }
    }
  })

  app.operation({
    name: 'categories.save',
    permission: 'categories.manage',
    schema: categorySchema,
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const name = b.name.replace(/\s+/g, ' ').trim()
        if (!name) throw badRequest('اسم التصنيف مطلوب.')
        const dup = await db.query(
          'SELECT id FROM categories WHERE lower(btrim(name)) = lower($1) AND ($2::int IS NULL OR id <> $2)',
          [name, b.id ?? null]
        )
        if (dup.rowCount) throw conflict('يوجد تصنيف بنفس الاسم بالفعل.')
        let row
        if (b.id) {
          const before = (
            await db.query('SELECT * FROM categories WHERE id = $1 FOR UPDATE', [b.id])
          ).rows[0]
          if (!before) throw notFound('التصنيف غير موجود.')
          row = (
            await db.query(
              `UPDATE categories SET name = $2, description = $3, sort_order = $4,
                      is_active = $5, updated_at = LOCALTIMESTAMP(0) WHERE id = $1 RETURNING *`,
              [
                b.id,
                name,
                b.description ?? before.description,
                b.sortOrder ?? before.sort_order,
                b.isActive ?? before.is_active
              ]
            )
          ).rows[0]
          // products.category mirrors the name for older readers.
          if (before.name !== name)
            await db.query('UPDATE products SET category = $2 WHERE category_id = $1', [b.id, name])
          await ctx.audit(db, 'category_update', `تعديل التصنيف "${before.name}" → "${name}"`, {
            before,
            after: row
          })
        } else {
          const next =
            b.sortOrder ??
            Number(
              (await db.query('SELECT COALESCE(max(sort_order), 0) + 1 AS n FROM categories'))
                .rows[0].n
            )
          row = (
            await db.query(
              `INSERT INTO categories (name, description, sort_order, is_active)
               VALUES ($1, $2, $3, $4) RETURNING *`,
              [name, b.description ?? null, next, b.isActive ?? true]
            )
          ).rows[0]
          await ctx.audit(db, 'category_create', `إضافة التصنيف "${name}"`)
        }
        return row
      })
  })

  app.operation({
    name: 'categories.setActive',
    permission: 'categories.manage',
    schema: {
      type: 'object',
      required: ['id', 'isActive'],
      properties: { id: { type: 'integer' }, isActive: { type: 'boolean' } }
    },
    handler: async (ctx, { id, isActive }) =>
      ctx.tx(async (db) => {
        const r = (
          await db.query(
            'UPDATE categories SET is_active = $2, updated_at = LOCALTIMESTAMP(0) WHERE id = $1 RETURNING *',
            [id, isActive]
          )
        ).rows[0]
        if (!r) throw notFound('التصنيف غير موجود.')
        // A stopped category hides its group while browsing; its products stay sellable by scan
        // and search and keep their category.
        await ctx.audit(
          db,
          'category_update',
          `${isActive ? 'تفعيل' : 'إيقاف'} التصنيف "${r.name}"`
        )
        return r
      })
  })

  // Only an empty category can be deleted: products are never deleted or orphaned with it.
  app.operation({
    name: 'categories.delete',
    permission: 'categories.manage',
    schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    handler: async (ctx, { id }) =>
      ctx.tx(async (db) => {
        const c = (await db.query('SELECT * FROM categories WHERE id = $1 FOR UPDATE', [id]))
          .rows[0]
        if (!c) throw notFound('التصنيف غير موجود.')
        const used = Number(
          (await db.query('SELECT count(*) AS n FROM products WHERE category_id = $1', [id]))
            .rows[0].n
        )
        if (used)
          throw conflict(
            `لا يمكن حذف التصنيف "${c.name}" لأنه يحتوي على ${used} صنف. انقل الأصناف لتصنيف آخر أو أوقف التصنيف بدلاً من حذفه.`
          )
        await db.query('DELETE FROM categories WHERE id = $1', [id])
        await ctx.audit(db, 'category_delete', `حذف التصنيف "${c.name}"`)
      })
  })

  // Move products into a category (or out of any category with categoryId = null).
  app.operation({
    name: 'categories.assign',
    permission: 'categories.manage',
    schema: {
      type: 'object',
      required: ['categoryId', 'barcodes'],
      properties: {
        categoryId: { type: ['integer', 'null'] },
        barcodes: {
          type: 'array',
          minItems: 1,
          maxItems: 1000,
          items: { type: 'string', minLength: 1, maxLength: 64 }
        }
      }
    },
    handler: async (ctx, { categoryId, barcodes }) =>
      ctx.tx(async (db) => {
        let name = ''
        if (categoryId !== null) {
          const c = (
            await db.query('SELECT name, is_active FROM categories WHERE id = $1', [categoryId])
          ).rows[0]
          if (!c) throw badRequest('التصنيف المختار غير موجود.')
          if (!c.is_active) throw badRequest(`التصنيف "${c.name}" موقوف؛ فعّله أولاً.`)
          name = c.name
        }
        const unique = [...new Set(barcodes)]
        const r = await db.query(
          `UPDATE products SET category_id = $1, category = $2
            WHERE barcode = ANY($3::text[]) AND category_id IS DISTINCT FROM $1`,
          [categoryId, name, unique]
        )
        const missing = (
          await db.query(
            'SELECT b FROM unnest($1::text[]) b WHERE NOT EXISTS (SELECT 1 FROM products WHERE barcode = b)',
            [unique]
          )
        ).rows.map((x) => x.b)
        if (missing.length) throw badRequest(`أصناف غير موجودة: ${missing.slice(0, 5).join('، ')}`)
        await ctx.audit(
          db,
          'category_assign',
          `نقل ${r.rowCount} صنف إلى ${categoryId === null ? 'بدون تصنيف' : `التصنيف "${name}"`}`
        )
        return { moved: r.rowCount }
      })
  })

  // ── Browsing at the till ──────────────────────────────────────────────────

  // One tiny query: has anything the till shows changed since it loaded?
  app.operation({
    name: 'pos.catalogVersion',
    permission: 'pos.sell',
    handler: async (ctx) => ({ version: await catalogVersion(ctx.pool) })
  })

  // Active categories with their active product counts, plus the uncategorised group.
  app.operation({
    name: 'pos.categories',
    permission: 'pos.sell',
    handler: async (ctx) => {
      const { rows } = await ctx.pool.query(
        `SELECT c.id, c.name, count(p.barcode)::int AS products
           FROM categories c JOIN products p ON p.category_id = c.id AND p.is_active
          WHERE c.is_active
          GROUP BY c.id ORDER BY c.sort_order, c.name, c.id`
      )
      const none = (
        await ctx.pool.query(
          `SELECT count(*)::int AS n FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.is_active AND (p.category_id IS NULL OR NOT c.is_active)`
        )
      ).rows[0].n
      return {
        version: await catalogVersion(ctx.pool),
        categories: rows,
        uncategorised: none
      }
    }
  })

  // Products of one category (or uncategorised: id 0, which also holds products of stopped
  // categories so nothing becomes impossible to find), alphabetically, a page at a time.
  app.operation({
    name: 'pos.categoryProducts',
    permission: 'pos.sell',
    schema: {
      type: 'object',
      required: ['categoryId'],
      properties: {
        categoryId: { type: 'integer', minimum: 0 },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: PAGE }
      }
    },
    handler: async (ctx, { categoryId, offset = 0, limit = PAGE }) => {
      const where =
        categoryId === UNCATEGORISED
          ? `p.is_active AND (p.category_id IS NULL OR NOT EXISTS
               (SELECT 1 FROM categories c WHERE c.id = p.category_id AND c.is_active))`
          : 'p.is_active AND p.category_id = $1'
      const params = categoryId === UNCATEGORISED ? [] : [categoryId]
      const { rows } = await ctx.pool.query(
        `SELECT p.barcode, p.name, p.unit, p.unit_kind, p.retail_price, p.stock_qty,
                (SELECT count(*)::int FROM product_units u WHERE u.product_barcode = p.barcode AND u.is_active AND u.sellable) AS packs
           FROM products p WHERE ${where}
          ORDER BY p.name, p.barcode
          LIMIT ${limit + 1} OFFSET ${offset}`,
        params
      )
      return {
        version: await catalogVersion(ctx.pool),
        products: rows.slice(0, limit).map((p) => ({
          barcode: p.barcode,
          name: p.name,
          unit: p.unit || '',
          unitKind: p.unit_kind || 'count',
          price: unitPrice(p, baseUnit(p)),
          stock: Number(p.stock_qty) || 0,
          packs: p.packs
        })),
        more: rows.length > limit
      }
    }
  })
}

module.exports.UNCATEGORISED = UNCATEGORISED
