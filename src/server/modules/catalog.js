'use strict'
// Products (useProductsManager), reorder data (ReorderingTab), product lookup for damaged goods.
const { badRequest, conflict, notFound } = require('../errors')
const { validateFactor, kindRule, checkStockValue } = require('../inventory/units')
const { postMovement, adjustTo, verifyLedger } = require('../inventory/stock')

const PER_PAGE = 12
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const SORTABLE = ['name', 'barcode', 'stock_qty', 'retail_price', 'cost_price', 'reorder_limit'] // legacy whitelist
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`)

/** Hide cost figures from roles without products.view_cost. */
function maskCost(ctx, rows) {
  if (ctx.can('products.view_cost')) return rows
  return rows.map((r) => {
    const { cost_price: _c, cost: _k, ...rest } = r
    return rest
  })
}

const productSchema = {
  type: 'object',
  required: ['barcode', 'name'],
  properties: {
    barcode: { type: 'string', minLength: 1, maxLength: 64 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    cost_price: { type: 'number', minimum: 0 },
    retail_price: { type: 'number', minimum: 0 },
    // Negative stock is allowed (owner decision). On update, stock_qty is the target and
    // stock_base the stock the form showed when it was opened (K-37).
    stock_qty: { type: 'number' },
    stock_base: { type: ['number', 'null'] },
    reorder_limit: { type: 'number', minimum: 0 },
    unit: { type: 'string', maxLength: 40 },
    // How the base unit is measured: count (whole pieces), weight (kg, 3 decimals), volume (l, 3
    // decimals), or a kind the owner added (measure_kinds, migration 0014).
    unit_kind: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,39}$' },
    // Primary category (categories.id); null = uncategorised. Omitted on update = unchanged.
    category_id: { type: ['integer', 'null'] },
    // false = stopped from sale (hidden from search and browsing, refused at checkout).
    is_active: { type: 'boolean' }
  }
}

/**
 * The category a product may be assigned to: an existing, active category (or none). Returns
 * { id, name } – the name is mirrored in products.category for older readers.
 */
async function categoryRef(db, id) {
  if (id === null || id === undefined) return { id: null, name: '' }
  const c = (await db.query('SELECT id, name, is_active FROM categories WHERE id = $1', [id]))
    .rows[0]
  if (!c) throw badRequest('التصنيف المختار غير موجود.')
  if (!c.is_active) throw badRequest(`التصنيف "${c.name}" موقوف؛ فعّله أولاً أو اختر تصنيفاً آخر.`)
  return { id: c.id, name: c.name }
}

/** A kind a product may be given now: it must exist and not be stopped. */
async function assignableKind(db, key) {
  const k = (
    await db.query('SELECT key, name, decimals, is_active FROM measure_kinds WHERE key = $1', [key])
  ).rows[0]
  if (!k) throw badRequest('طريقة القياس غير معروفة.')
  if (!k.is_active) throw badRequest(`طريقة القياس "${k.name}" موقوفة؛ فعّلها أولاً أو اختر غيرها.`)
  return { key: k.key, decimals: Number(k.decimals) }
}

module.exports = function catalogModule(app) {
  app.operation({
    name: 'products.page',
    permission: 'products.view',
    schema: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        search: { type: 'string', maxLength: 100 },
        sortField: { type: 'string' },
        sortAsc: { type: 'boolean' },
        // A category id, or 0 for products without a category.
        categoryId: { type: ['integer', 'null'] }
      }
    },
    handler: async (
      ctx,
      { page = 1, search = '', sortField = 'name', sortAsc = true, categoryId }
    ) => {
      const field = SORTABLE.includes(sortField) ? sortField : 'name'
      const params = []
      const conds = []
      if (search) {
        params.push(likeEscape(search))
        conds.push(
          `(p.barcode ILIKE '%' || $${params.length} || '%' ESCAPE '\\' OR p.name ILIKE '%' || $${params.length} || '%' ESCAPE '\\')`
        )
      }
      if (categoryId === 0) conds.push('p.category_id IS NULL')
      else if (Number.isInteger(categoryId)) {
        params.push(categoryId)
        conds.push(`p.category_id = $${params.length}`)
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
      const total = (
        await ctx.pool.query(`SELECT count(*) AS count FROM products p ${where}`, params)
      ).rows[0].count
      const rows = (
        await ctx.pool.query(
          // The largest active package (D-065): the stock is also shown as complete packages and
          // loose units; the stock itself stays one quantity in the base unit.
          `SELECT p.*, c.name AS category_name, pk.name AS pack_name, pk.factor::float8 AS pack_factor
             FROM products p LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN LATERAL (SELECT name, factor FROM product_units u
                                 WHERE u.product_barcode = p.barcode AND u.is_active
                                 ORDER BY u.factor DESC, u.id LIMIT 1) pk ON true
            ${where} ORDER BY p.${field} ${sortAsc ? 'ASC' : 'DESC'}, p.barcode LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`,
          params
        )
      ).rows
      return { total, page, perPage: PER_PAGE, field, rows: maskCost(ctx, rows) }
    }
  })

  app.operation({
    name: 'products.get',
    anyPermission: ['products.view', 'inventory.damaged'],
    schema: {
      type: 'object',
      required: ['barcode'],
      properties: { barcode: { type: 'string', maxLength: 64 } }
    },
    handler: async (ctx, { barcode }) => {
      const r = (await ctx.pool.query('SELECT * FROM products WHERE barcode = $1', [barcode])).rows
      return r.length ? maskCost(ctx, r)[0] : null
    }
  })

  app.operation({
    name: 'products.create',
    permission: 'products.manage',
    schema: productSchema,
    handler: async (ctx, p) =>
      ctx.tx(async (db) => {
        const barcode = p.barcode.trim()
        const rule = await assignableKind(db, p.unit_kind || 'count')
        const kind = rule.key
        if (Number(p.stock_qty)) checkStockValue(rule, p.stock_qty)
        const category = await categoryRef(db, p.category_id)
        await db.query(
          // Two prices per unit (D-096): purchase and selling. The old wholesale column stays 0.
          `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, reorder_limit, unit, unit_kind, category_id, category, is_active)
           VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10)`,
          [
            barcode,
            p.name,
            p.cost_price || 0,
            p.retail_price || 0,
            p.reorder_limit || 0,
            p.unit || '',
            kind,
            category.id,
            category.name,
            p.is_active !== false
          ]
        )
        if (Number(p.stock_qty)) {
          await postMovement(db, ctx, {
            barcode,
            qty: Number(p.stock_qty),
            kind: 'opening',
            refType: 'product',
            reason: 'رصيد أول عند إضافة الصنف'
          })
        }
        await ctx.audit(db, 'product_create', `إضافة صنف "${p.name}" (${p.barcode})`)
      })
  })

  app.operation({
    name: 'products.update',
    permission: 'products.manage',
    schema: productSchema,
    handler: async (ctx, p) =>
      ctx.tx(async (db) => {
        const before = (
          await db.query('SELECT * FROM products WHERE barcode = $1 FOR UPDATE', [p.barcode])
        ).rows[0]
        if (!before) throw notFound('الصنف غير موجود.')
        const kind = p.unit_kind || before.unit_kind || 'count'
        const rule =
          kind === before.unit_kind ? await kindRule(db, kind) : await assignableKind(db, kind)
        const was = await kindRule(db, before.unit_kind)
        if (kind !== before.unit_kind && rule.decimals < was.decimals) {
          // Fewer decimals (e.g. to whole pieces): today's stock and every unit factor must fit.
          checkStockValue(rule, before.stock_qty || 0)
          const frac = await db.query(
            'SELECT name FROM product_units WHERE product_barcode = $1 AND is_active AND factor <> round(factor, $2) LIMIT 1',
            [p.barcode, rule.decimals]
          )
          if (frac.rowCount)
            throw badRequest(
              rule.decimals === 0
                ? `الوحدة "${frac.rows[0].name}" معاملها كسري؛ عدّلها قبل تحويل الصنف للبيع بالعدد.`
                : `معامل الوحدة "${frac.rows[0].name}" به كسور أكثر مما تسمح به طريقة القياس الجديدة؛ عدّله أولاً.`
            )
        }
        if (p.stock_qty !== undefined && p.stock_qty !== null) checkStockValue(rule, p.stock_qty)
        // Category and active status change only when the form sends them (older forms do not).
        const category =
          p.category_id === undefined
            ? { id: before.category_id, name: before.category || '' }
            : p.category_id === before.category_id
              ? { id: before.category_id, name: before.category || '' }
              : await categoryRef(db, p.category_id)
        const active = p.is_active === undefined ? before.is_active : p.is_active
        await db.query(
          // The old wholesale price is no longer written (D-096): its stored value is kept as it is.
          `UPDATE products SET name = $2, cost_price = $3, retail_price = $4, reorder_limit = $5, unit = $6, unit_kind = $7,
                  category_id = $8, category = $9, is_active = $10
           WHERE barcode = $1`,
          [
            p.barcode,
            p.name,
            p.cost_price || 0,
            p.retail_price || 0,
            p.reorder_limit || 0,
            p.unit || '',
            kind,
            category.id,
            category.name,
            active
          ]
        )
        // K-37: the form's stock is a target relative to what it showed (stock_base), so sales
        // recorded while the form was open are kept. Without a base, a changed stock is refused.
        const wantsStock = p.stock_qty !== undefined && p.stock_qty !== null
        const hasBase = p.stock_base !== undefined && p.stock_base !== null
        let adjusted = null
        if (wantsStock && hasBase) {
          adjusted = await adjustTo(db, ctx, {
            barcode: p.barcode,
            target: p.stock_qty,
            base: p.stock_base,
            kind: 'adjustment',
            reason: 'تعديل الكمية من شاشة الصنف'
          })
        } else if (wantsStock && Number(p.stock_qty) !== (Number(before.stock_qty) || 0)) {
          throw conflict('تغيّر رصيد الصنف. أعد فتح الصنف ثم عدّل الكمية.', {
            stock: Number(before.stock_qty) || 0
          })
        }
        const changes = {}
        for (const k of [
          'name',
          'cost_price',
          'retail_price',
          'reorder_limit',
          'unit',
          'unit_kind'
        ]) {
          const a = before[k] ?? ''
          const b = p[k] ?? (k === 'name' || k === 'unit' ? '' : 0)
          if (String(a) !== String(b)) changes[k] = { from: a, to: b }
        }
        if (category.id !== before.category_id)
          changes.category = { from: before.category || '', to: category.name }
        if (active !== before.is_active) changes.is_active = { from: before.is_active, to: active }
        if (adjusted)
          changes.stock_qty = {
            from: Number(before.stock_qty) || 0,
            to: adjusted.balanceAfter,
            movement: adjusted.id
          }
        if (Object.keys(changes).length)
          await ctx.audit(db, 'product_update', `تعديل صنف "${p.name}" (${p.barcode})`, changes)
      })
  })

  // PROD-01: change a product's barcode. Its whole history (sale lines, stock movements, units,
  // extra barcodes, purchases, damaged goods, discount rules) follows it to the new barcode in the
  // same transaction (ON UPDATE CASCADE, 0017); nothing else changes.
  app.operation({
    name: 'products.changeBarcode',
    permission: 'products.manage',
    schema: {
      type: 'object',
      required: ['barcode', 'newBarcode'],
      properties: {
        barcode: { type: 'string', minLength: 1, maxLength: 64 },
        newBarcode: { type: 'string', minLength: 1, maxLength: 64 }
      }
    },
    handler: async (ctx, { barcode, newBarcode }) =>
      ctx.tx(async (db) => {
        const next = newBarcode.trim()
        if (!next) throw badRequest('اكتب الباركود الجديد.')
        if (next === barcode) return { barcode }
        const p = (
          await db.query('SELECT barcode, name FROM products WHERE barcode = $1 FOR UPDATE', [
            barcode
          ])
        ).rows[0]
        if (!p) throw notFound('الصنف غير موجود.')
        // Stock movements are immutable (0004); the cascade only renames their product, so it is
        // allowed for this one statement and switched off again at once.
        await db.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
        await db.query('UPDATE products SET barcode = $1 WHERE barcode = $2', [next, barcode])
        await db.query("SELECT set_config('hm.ledger_rebuild', 'off', true)")
        await ctx.audit(
          db,
          'product_barcode_change',
          `تغيير باركود الصنف "${p.name}" من ${barcode} إلى ${next}`,
          { from: barcode, to: next }
        )
        return { barcode: next }
      })
  })

  app.operation({
    name: 'products.delete',
    permission: 'products.manage',
    schema: {
      type: 'object',
      required: ['barcode'],
      properties: { barcode: { type: 'string', maxLength: 64 } }
    },
    handler: async (ctx, { barcode }) =>
      ctx.tx(async (db) => {
        try {
          const used = await db.query(
            "SELECT 1 FROM stock_movements WHERE product_barcode = $1 AND kind <> 'opening' LIMIT 1",
            [barcode]
          )
          if (used.rowCount)
            throw conflict(
              'لا يمكن حذف هذا الصنف لأن له حركات مخزون مسجلة (بيع أو استلام أو تسوية). يمكنك جرد كميته إلى صفر بدلاً من حذفه.'
            )
          // Only an opening balance: remove it with the product (administrative rebuild).
          await db.query("SELECT set_config('hm.ledger_rebuild', 'on', true)")
          await db.query('DELETE FROM stock_movements WHERE product_barcode = $1', [barcode])
          await db.query("SELECT set_config('hm.ledger_rebuild', 'off', true)")
          const r = await db.query('DELETE FROM products WHERE barcode = $1 RETURNING name', [
            barcode
          ])
          if (!r.rowCount) throw notFound('الصنف غير موجود.')
          await ctx.audit(db, 'product_delete', `حذف صنف "${r.rows[0].name}" (${barcode})`)
        } catch (e) {
          if (e.code === '23503') {
            throw conflict(
              'لا يمكن حذف هذا المنتج لأنه مرتبط بمبيعات أو فواتير سابقة في الداتا بيس.\nيمكنك بدلاً من حذفه تعديل كميته المتاحة إلى صفر.'
            )
          }
          throw e
        }
      })
  })

  // ReorderingTab: all products + quantities sold in shifts that started within the last 30 days.
  app.operation({
    name: 'inventory.reorderData',
    permission: 'inventory.reorder',
    handler: async (ctx) => {
      const products = (
        await ctx.pool.query(
          'SELECT barcode, name, stock_qty AS stock, reorder_limit, unit, cost_price AS cost, retail_price AS price FROM products ORDER BY barcode'
        )
      ).rows
      const sales = (
        await ctx.pool.query(
          `SELECT product_barcode, SUM(quantity * unit_factor) AS total_qty FROM sale_items si JOIN sales s ON si.sale_id = s.id
           WHERE s.shift_id IN (SELECT id FROM shifts WHERE start_time >= (CURRENT_DATE - 30)::timestamp)
           GROUP BY product_barcode`
        )
      ).rows
      return { products: maskCost(ctx, products), sales }
    }
  })
}

module.exports.maskCost = maskCost
module.exports.registerInventory = function inventoryOperations(app) {
  // Units and packaging of one product, with their barcodes (base-unit barcodes have unit_id null).
  app.operation({
    name: 'productUnits.get',
    anyPermission: ['products.view', 'pos.sell'],
    schema: {
      type: 'object',
      required: ['barcode'],
      properties: { barcode: { type: 'string', minLength: 1, maxLength: 64 } }
    },
    handler: async (ctx, { barcode }) => {
      const product = (
        await ctx.pool.query(
          'SELECT barcode, name, unit, unit_kind, retail_price FROM products WHERE barcode = $1',
          [barcode]
        )
      ).rows[0]
      if (!product) throw notFound('الصنف غير موجود.')
      const units = (
        await ctx.pool.query(
          'SELECT id, name, factor, retail_price, retail_auto, purchase_cost, sellable, purchasable FROM product_units WHERE product_barcode = $1 AND is_active ORDER BY factor, id',
          [barcode]
        )
      ).rows
      const codes = (
        await ctx.pool.query(
          'SELECT barcode, unit_id FROM product_barcodes WHERE product_barcode = $1 ORDER BY barcode',
          [barcode]
        )
      ).rows
      return {
        product,
        baseBarcodes: codes.filter((c) => c.unit_id === null).map((c) => c.barcode),
        units: units.map((u) => ({
          ...u,
          // The automatic price (D-096): the piece's selling price × the factor, now.
          auto_price: round2((Number(product.retail_price) || 0) * Number(u.factor)),
          barcodes: codes.filter((c) => c.unit_id === u.id).map((c) => c.barcode)
        }))
      }
    }
  })

  // Replace a product's units and extra barcodes. Units left out are deactivated (history keeps
  // pointing at them); factors and prices of existing units may change (lines keep snapshots).
  app.operation({
    name: 'productUnits.save',
    permission: 'products.manage',
    schema: {
      type: 'object',
      required: ['barcode', 'units'],
      properties: {
        barcode: { type: 'string', minLength: 1, maxLength: 64 },
        baseBarcodes: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 64 }
        },
        units: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            required: ['name', 'factor'],
            properties: {
              id: { type: ['integer', 'null'] },
              name: { type: 'string', minLength: 1, maxLength: 40 },
              factor: { type: 'number', exclusiveMinimum: 0 },
              retail_price: { type: ['number', 'null'], minimum: 0 },
              // true: the selling price follows the piece price × factor (D-096); false: typed.
              // Omitted: automatic when no price is given, typed otherwise.
              retail_auto: { type: 'boolean' },
              // The price the owner pays for one package (D-065), the default cost in purchases.
              purchase_cost: { type: ['number', 'null'], minimum: 0 },
              sellable: { type: 'boolean' },
              purchasable: { type: 'boolean' },
              barcodes: {
                type: 'array',
                maxItems: 20,
                items: { type: 'string', minLength: 1, maxLength: 64 }
              }
            }
          }
        }
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const product = (
          await db.query('SELECT * FROM products WHERE barcode = $1 FOR UPDATE', [b.barcode])
        ).rows[0]
        if (!product) throw notFound('الصنف غير موجود.')
        const kind = await kindRule(db, product.unit_kind)
        const names = new Set()
        const codes = new Set()
        const addCode = (c) => {
          const code = c.trim()
          if (!code) return null
          if (code === product.barcode)
            throw badRequest('الباركود الأساسي للصنف لا يُضاف كباركود إضافي.')
          if (codes.has(code)) throw badRequest(`الباركود (${code}) مكرر.`)
          codes.add(code)
          return code
        }
        const units = b.units.map((u) => {
          const name = u.name.trim()
          if (names.has(name.toLowerCase())) throw badRequest(`اسم الوحدة "${name}" مكرر.`)
          names.add(name.toLowerCase())
          if (name === (product.unit || '').trim())
            throw badRequest(`"${name}" هو اسم الوحدة الأساسية بالفعل.`)
          const factor = validateFactor(kind, u.factor)
          if (factor === 1)
            throw badRequest(
              `الوحدة "${name}" بمعامل 1 مطابقة للوحدة الأساسية؛ استخدم باركوداً إضافياً بدلاً منها.`
            )
          // The package's selling price (owner, 1.5.2, D-096): automatic (the piece price × the
          // factor, following both) unless the owner typed his own, which is then kept.
          const given = u.retail_price !== null && u.retail_price !== undefined
          const auto = u.retail_auto === undefined ? !given : u.retail_auto
          if (!auto && !given)
            throw badRequest(`اكتب سعر بيع "${name}" أو اختر «تلقائي» (سعر القطعة × المعامل).`)
          return {
            ...u,
            name,
            factor,
            retail_auto: auto,
            retail_price: auto ? null : round2(u.retail_price),
            sellable: u.sellable !== false,
            purchasable: u.purchasable !== false,
            barcodes: (u.barcodes || []).map(addCode).filter(Boolean)
          }
        })
        const baseCodes = (b.baseBarcodes || []).map(addCode).filter(Boolean)

        const existing = (
          await db.query('SELECT * FROM product_units WHERE product_barcode = $1 AND is_active', [
            b.barcode
          ])
        ).rows
        const changes = { added: [], updated: [], deactivated: [] }
        const keep = new Set()
        await db.query('DELETE FROM product_barcodes WHERE product_barcode = $1', [b.barcode])
        for (const u of units) {
          let id = u.id
          const prev = id ? existing.find((e) => e.id === id) : null
          if (id && !prev) throw badRequest(`الوحدة رقم ${id} لا تخص هذا الصنف.`)
          if (prev) {
            await db.query(
              `UPDATE product_units SET name = $2, factor = $3, retail_price = $4, retail_auto = $5, sellable = $6, purchasable = $7, purchase_cost = $8, updated_at = LOCALTIMESTAMP(0)
               WHERE id = $1`,
              [
                id,
                u.name,
                u.factor,
                u.retail_price,
                u.retail_auto,
                u.sellable,
                u.purchasable,
                u.purchase_cost ?? null
              ]
            )
            const diff = {}
            for (const k of [
              'name',
              'factor',
              'retail_price',
              'retail_auto',
              'sellable',
              'purchasable',
              'purchase_cost'
            ]) {
              const a = prev[k] === null ? null : String(prev[k])
              const c = u[k] === null || u[k] === undefined ? null : String(u[k])
              if (a !== c) diff[k] = { from: prev[k], to: u[k] ?? null }
            }
            if (Object.keys(diff).length) changes.updated.push({ id, name: u.name, ...diff })
          } else {
            id = (
              await db.query(
                `INSERT INTO product_units (product_barcode, name, factor, retail_price, retail_auto, sellable, purchasable, purchase_cost)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
                [
                  b.barcode,
                  u.name,
                  u.factor,
                  u.retail_price,
                  u.retail_auto,
                  u.sellable,
                  u.purchasable,
                  u.purchase_cost ?? null
                ]
              )
            ).rows[0].id
            changes.added.push({ id, name: u.name, factor: u.factor })
          }
          keep.add(id)
          for (const code of u.barcodes)
            await db.query(
              'INSERT INTO product_barcodes (barcode, product_barcode, unit_id) VALUES ($1, $2, $3)',
              [code, b.barcode, id]
            )
        }
        for (const e of existing.filter((x) => !keep.has(x.id))) {
          await db.query(
            'UPDATE product_units SET is_active = false, updated_at = LOCALTIMESTAMP(0) WHERE id = $1',
            [e.id]
          )
          changes.deactivated.push({ id: e.id, name: e.name })
        }
        for (const code of baseCodes)
          await db.query(
            'INSERT INTO product_barcodes (barcode, product_barcode, unit_id) VALUES ($1, $2, NULL)',
            [code, b.barcode]
          )
        await ctx.audit(
          db,
          'product_units',
          `تعديل وحدات وعبوات الصنف "${product.name}" (${b.barcode})`,
          {
            ...changes,
            barcodes: [...codes]
          }
        )
        return { ok: true }
      })
  })

  // Movement history of one product, newest first.
  app.operation({
    name: 'inventory.movements',
    permission: 'products.view',
    schema: {
      type: 'object',
      required: ['barcode'],
      properties: {
        barcode: { type: 'string', minLength: 1, maxLength: 64 },
        limit: { type: 'integer', minimum: 1, maximum: 500 }
      }
    },
    handler: async (ctx, { barcode, limit }) => {
      const rows = (
        await ctx.pool.query(
          `SELECT m.id::int, m.qty, m.kind, m.unit_cost AS cost, m.balance_after, m.ref_type, m.ref_id, m.reason,
                  m.created_at, u.username
             FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
            WHERE m.product_barcode = $1 ORDER BY m.id DESC LIMIT $2`,
          [barcode, limit || 100]
        )
      ).rows
      return maskCost(ctx, rows)
    }
  })

  // Stock count: counted quantity against the stock shown when counting started (base).
  app.operation({
    name: 'inventory.count',
    permission: 'inventory.adjust',
    schema: {
      type: 'object',
      required: ['barcode', 'counted', 'reason'],
      properties: {
        barcode: { type: 'string', minLength: 1, maxLength: 64 },
        counted: { type: 'number' },
        base: { type: ['number', 'null'] },
        reason: { type: 'string', minLength: 2, maxLength: 300 }
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const row = (
          await db.query('SELECT stock_qty FROM products WHERE barcode = $1 FOR UPDATE', [
            b.barcode
          ])
        ).rows[0]
        if (!row) throw notFound('الصنف غير موجود.')
        const before = Number(row.stock_qty) || 0
        const mv = await adjustTo(db, ctx, {
          barcode: b.barcode,
          target: b.counted,
          base: b.base,
          kind: 'count',
          reason: b.reason
        })
        const stock = mv ? mv.balanceAfter : before
        if (mv)
          await ctx.audit(
            db,
            'stock_count',
            `جرد الصنف ${b.barcode}: المعدود ${b.counted}، الرصيد من ${before} إلى ${stock}`,
            { movement: mv.id, reason: b.reason, base: b.base ?? null }
          )
        return { stock, movementId: mv ? mv.id : null }
      })
  })

  // Products with negative stock (sold before their receipt was entered).
  app.operation({
    name: 'inventory.negative',
    permission: 'products.view',
    handler: async (ctx) =>
      (
        await ctx.pool.query(
          `SELECT barcode, name, unit, stock_qty AS stock,
                  (SELECT MAX(created_at) FROM stock_movements m WHERE m.product_barcode = p.barcode AND m.balance_after < 0) AS negative_since
             FROM products p WHERE stock_qty < 0 ORDER BY stock_qty, barcode`
        )
      ).rows
  })

  // Ledger check: every product's stock equals the sum of its movements (empty list = healthy).
  app.operation({
    name: 'inventory.verify',
    permission: 'reports.view',
    handler: async (ctx) => {
      const mismatches = await verifyLedger(ctx.pool)
      return { ok: mismatches.length === 0, mismatches }
    }
  })
}
