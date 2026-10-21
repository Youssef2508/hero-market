'use strict'
// Cashier operations: product lookup/search, customer autocomplete and checkout.
// Checkout reproduces usePOSController.handleCheckout, but on the server, in one transaction:
//  - prices come from the catalogue, not from the terminal (G-04);
//  - the new sale id comes from INSERT … RETURNING, never MAX(id) (G-03);
//  - a new customer is created inside the same transaction (K-12);
//  - a client-generated key makes retries return the same sale instead of a second one (G-21).
const path = require('path')
const { pathToFileURL } = require('url')
const { postMovement } = require('../inventory/stock')
const {
  baseUnit,
  unitPrice,
  loadUnit,
  toBaseQty,
  kindRule,
  parseScaleLabel,
  round3,
  round4
} = require('../inventory/units')
const { badRequest, forbidden, conflict, notFound } = require('../errors')
const { loadShift } = require('./shifts').helpers
const { maskCost } = require('./catalog')
const { readAll } = require('./settings')
const { priceCart, activeRules } = require('../pricing/discounts')
const { ADDRESSES } = require('./customers').helpers

const PAYMENT_TYPES = ['نقدي', 'فودافون كاش', 'انستا باي', 'آجل', 'دفع جزئي']
const CREDIT_TYPES = ['آجل', 'دفع جزئي']
const CASH_TENDER_TYPES = ['نقدي', 'دفع جزئي']
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`)

async function summarizeSale(db, saleId) {
  const { rows } = await db.query(
    'SELECT id, total_amount, original_amount, discount, payment_type, client_id, timestamp FROM sales WHERE id = $1',
    [saleId]
  )
  return rows[0]
}

/**
 * Price the till's items from the catalogue: unit, validated quantity, unit price, gross line total
 * and cost per unit. `products` maps barcode → product row. A stale unit price is refused.
 */
async function buildLines(db, items, products) {
  const lines = []
  for (const i of items) {
    const p = products.get(i.barcode)
    if (!p) throw notFound(`الصنف (${i.barcode}) غير مسجل في قاعدة البيانات!`)
    if (p.is_active === false)
      throw conflict(`الصنف "${p.name}" موقوف عن البيع. احذفه من الفاتورة.`, {
        barcode: p.barcode,
        inactive: true
      })
    const unit = await loadUnit(db, p, i.unitId, { purpose: 'sell' })
    const label = unit.id === null ? p.name : `${p.name} – ${unit.name}`
    const { qty, baseQty } = toBaseQty(await kindRule(db, p.unit_kind), i.qty, unit.factor, label)
    const price = unitPrice(p, unit)
    if (i.unitPrice !== undefined && Math.abs(Number(i.unitPrice) - price) > 0.0001) {
      throw conflict(
        `تغيّر سعر الصنف "${label}" إلى ${price.toFixed(2)} ج.م أثناء البيع. احذفه وأعد إضافته ثم أكمل.`,
        {
          barcode: p.barcode,
          unitId: unit.id,
          price
        }
      )
    }
    const avg = Number(p.cost_price) || 0
    lines.push({
      barcode: p.barcode,
      name: p.name,
      unitId: unit.id,
      unitName: unit.id === null ? p.unit || null : unit.name,
      factor: unit.factor,
      qty,
      baseQty,
      price,
      total: round2(qty * price),
      // Cost per selling unit (snapshot): the average per base unit × factor.
      cost: round4(avg * unit.factor),
      baseCost: avg
    })
  }
  return lines
}

module.exports = function posModule(app) {
  // Exact lookup over the candidate spellings the terminal derived from a scan (as-is, without / with a leading zero).
  app.operation({
    name: 'pos.lookup',
    permission: 'pos.sell',
    schema: {
      type: 'object',
      required: ['codes'],
      properties: {
        codes: { type: 'array', items: { type: 'string', maxLength: 64 }, minItems: 1, maxItems: 5 }
      }
    },
    handler: async (ctx, { codes }) => {
      const { rows } = await ctx.pool.query(
        'SELECT * FROM products WHERE barcode = ANY($1::text[]) AND is_active LIMIT 1',
        [codes]
      )
      return rows[0] ? maskCost(ctx, rows)[0] : null
    }
  })

  // Scan → product AND unit: the product barcode (base unit), an extra barcode (base or packaging
  // unit), or a scale label per the store's settings (weight or price embedded). Also returns the
  // product's sellable units so the cart can switch between them.
  app.operation({
    name: 'pos.resolve',
    permission: 'pos.sell',
    schema: {
      type: 'object',
      required: ['code'],
      properties: { code: { type: 'string', minLength: 1, maxLength: 64 } }
    },
    handler: async (ctx, { code }) => {
      const raw = code.trim()
      const variants = [...new Set([raw, raw.replace(/^0+/, ''), '0' + raw].filter(Boolean))]
      const db = ctx.pool
      let product = (
        await db.query('SELECT * FROM products WHERE barcode = ANY($1::text[]) LIMIT 1', [variants])
      ).rows[0]
      let unit = product ? baseUnit(product) : null
      let qty = null
      let scale = null
      if (!product) {
        const extra = (
          await db.query(
            'SELECT product_barcode, unit_id FROM product_barcodes WHERE barcode = ANY($1::text[]) LIMIT 1',
            [variants]
          )
        ).rows[0]
        if (extra) {
          product = (
            await db.query('SELECT * FROM products WHERE barcode = $1', [extra.product_barcode])
          ).rows[0]
          unit = await loadUnit(db, product, extra.unit_id, { purpose: 'sell' })
        }
      }
      if (!product) {
        const settings = await readAll(db)
        let cfg = null
        try {
          cfg = JSON.parse(settings.scale_labels)
        } catch {
          cfg = null
        }
        scale = parseScaleLabel(cfg, raw)
        // A code shaped like a label of these settings is explained, never silently "not found".
        if (scale && scale.error === 'check_digit')
          throw badRequest(
            `ملصق الميزان (${raw}) غير صالح: رقم التحقق خاطئ. أعد مسحه أو اكتبه بدقة.`,
            { scale: 'check_digit' }
          )
        if (scale && scale.error === 'zero_value')
          throw badRequest(
            `ملصق الميزان (${raw}) يحمل ${scale.kind === 'weight' ? 'وزناً' : 'سعراً'} صفراً.`,
            {
              scale: 'zero_value'
            }
          )
        if (scale) {
          const c = scale.code
          // The product may be registered under the code digits (00001 / 1) or under the label's
          // digits up to the code (2000001, as the owner registers them).
          const candidates = [...new Set([scale.fullCode, c, c.replace(/^0+/, '')].filter(Boolean))]
          product = (
            await db.query(
              'SELECT * FROM products WHERE barcode = ANY($1::text[]) ORDER BY array_position($1::text[], barcode) LIMIT 1',
              [candidates]
            )
          ).rows[0]
          if (!product)
            throw notFound(
              `لا يوجد صنف مسجل بكود الميزان ${scale.fullCode} (${c}). سجّل الصنف بهذا الكود أولاً.`,
              { scale: 'unknown_product', code: scale.fullCode }
            )
          if (scale.kind === 'weight' && (await kindRule(db, product.unit_kind)).decimals === 0)
            throw badRequest(
              `الصنف "${product.name}" يباع بالعدد، والملصق يحمل وزناً. عدّل طريقة قياس الصنف إلى "بالوزن".`,
              { scale: 'kind_mismatch' }
            )
          if (product) {
            unit = baseUnit(product)
            const price = unitPrice(product, unit)
            qty =
              scale.kind === 'weight'
                ? round3(scale.value)
                : price > 0
                  ? round3(scale.value / price)
                  : null
          }
        }
      }
      if (!product) return null
      if (product.is_active === false)
        throw conflict(`الصنف "${product.name}" موقوف عن البيع.`, { inactive: true })
      const units = (
        await db.query(
          'SELECT id, name, factor, retail_price FROM product_units WHERE product_barcode = $1 AND is_active AND sellable ORDER BY factor, id',
          [product.barcode]
        )
      ).rows.map((u) => ({
        id: u.id,
        name: u.name,
        factor: Number(u.factor),
        price: unitPrice(product, {
          ...u,
          factor: Number(u.factor),
          retail_price: u.retail_price === null ? null : Number(u.retail_price)
        })
      }))
      const base = baseUnit(product)
      return {
        product: maskCost(ctx, [product])[0],
        unit: {
          id: unit.id,
          name: unit.id === null ? product.unit || '' : unit.name,
          factor: Number(unit.factor),
          price: unitPrice(product, unit)
        },
        units: [
          { id: null, name: product.unit || '', factor: 1, price: unitPrice(product, base) },
          ...units
        ],
        qty,
        scale
      }
    }
  })

  // Products whose barcode ends with the scanned digits (partial scans).
  app.operation({
    name: 'pos.suffixCandidates',
    permission: 'pos.sell',
    schema: {
      type: 'object',
      required: ['suffix'],
      properties: { suffix: { type: 'string', minLength: 1, maxLength: 64 } }
    },
    handler: async (ctx, { suffix }) =>
      maskCost(
        ctx,
        (
          await ctx.pool.query(
            `SELECT * FROM products WHERE barcode LIKE '%' || $1 ESCAPE '\\' AND is_active LIMIT 5`,
            [likeEscape(suffix)]
          )
        ).rows
      )
  })

  app.operation({
    name: 'pos.searchProducts',
    permission: 'pos.sell',
    schema: {
      type: 'object',
      required: ['term'],
      properties: { term: { type: 'string', maxLength: 100 } }
    },
    handler: async (ctx, { term }) => {
      const t = likeEscape(term)
      return maskCost(
        ctx,
        (
          await ctx.pool.query(
            `SELECT * FROM products WHERE (name ILIKE '%' || $1 || '%' ESCAPE '\\' OR barcode ILIKE '%' || $1 || '%' ESCAPE '\\') AND is_active ORDER BY name LIMIT 8`,
            [t]
          )
        ).rows
      )
    }
  })

  app.operation({
    name: 'pos.searchClients',
    anyPermission: ['pos.sell', 'customers.view'],
    schema: {
      type: 'object',
      required: ['term'],
      properties: { term: { type: 'string', maxLength: 100 } }
    },
    handler: async (ctx, { term }) => {
      const t = likeEscape(term)
      return (
        await ctx.pool.query(
          `SELECT c.*, ${ADDRESSES} AS addresses FROM clients c
            WHERE c.name ILIKE '%' || $1 || '%' ESCAPE '\\' OR c.phone ILIKE '%' || $1 || '%' ESCAPE '\\'
               OR c.phone2 ILIKE '%' || $1 || '%' ESCAPE '\\' ORDER BY c.name, c.id LIMIT 8`,
          [t]
        )
      ).rows
    }
  })

  // While a number is typed for a selected customer, the till says beforehand whether it will be
  // saved: not when it belongs to another customer, not when both slots are taken. Only a yes/no
  // about another customer is returned (no name), and the checkout applies the same rules.
  app.operation({
    name: 'pos.phoneOwner',
    permission: 'pos.sell',
    schema: {
      type: 'object',
      required: ['phone', 'clientId'],
      properties: {
        phone: { type: 'string', maxLength: 40 },
        clientId: { type: 'integer', minimum: 1 }
      }
    },
    handler: async (ctx, { phone, clientId }) => {
      const { normalizePhone } = await import(
        pathToFileURL(path.join(__dirname, '..', '..', 'shared', 'phone.mjs')).href
      )
      const r = normalizePhone(phone)
      if (r.error || !r.value) return { valid: false, error: r.error || '' }
      const { rows } = await ctx.pool.query(
        `SELECT id, regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') AS p1,
                regexp_replace(COALESCE(phone2, ''), '[^0-9+]', '', 'g') AS p2
           FROM clients
          WHERE id = $1
             OR regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = $2
             OR regexp_replace(COALESCE(phone2, ''), '[^0-9+]', '', 'g') = $2`,
        [clientId, r.value]
      )
      const self = rows.find((x) => x.id === clientId)
      const savedHere = !!self && [self.p1, self.p2].includes(r.value)
      return {
        valid: true,
        value: r.value,
        savedHere,
        otherCustomer: rows.some((x) => x.id !== clientId),
        freeSlot: !!self && (!self.p1 || !self.p2)
      }
    }
  })

  // After a checkout whose reply was lost (timeout, dropped link) the till asks whether that attempt
  // was recorded before it sells a changed cart. Waiting on the attempt's advisory lock makes an
  // in-flight checkout with this key finish first, so the answer is final.
  app.operation({
    name: 'pos.checkoutStatus',
    permission: 'pos.sell',
    schema: {
      type: 'object',
      required: ['clientRef'],
      properties: { clientRef: { type: 'string', minLength: 8, maxLength: 64 } }
    },
    handler: async (ctx, { clientRef }) =>
      ctx.tx(async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [clientRef])
        const { rows } = await db.query(
          'SELECT id, total_amount FROM sales WHERE client_ref = $1 AND user_id = $2',
          [clientRef, ctx.user.id]
        )
        return rows.length
          ? { recorded: true, saleId: rows[0].id, total: Number(rows[0].total_amount) }
          : { recorded: false }
      })
  })

  // Price preview for the till: the same lines and automatic discounts checkout will apply, with
  // nothing written. The till shows this total and sends it back as expectedTotal.
  app.operation({
    name: 'pos.price',
    permission: 'pos.sell',
    schema: {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          maxItems: 500,
          items: {
            type: 'object',
            required: ['barcode', 'qty'],
            properties: {
              barcode: { type: 'string', maxLength: 64 },
              unitId: { type: ['integer', 'null'] },
              qty: { type: 'number', exclusiveMinimum: 0 },
              unitPrice: { type: 'number' }
            }
          }
        }
      }
    },
    handler: async (ctx, b) => {
      if (!b.items.length)
        return { lines: [], subTotal: 0, discount: 0, afterDiscount: 0, applied: [] }
      const barcodes = [...new Set(b.items.map((i) => i.barcode))]
      const db = ctx.pool
      const rows = (
        await db.query('SELECT * FROM products WHERE barcode = ANY($1::text[])', [barcodes])
      ).rows
      const products = new Map(rows.map((r) => [r.barcode, r]))
      const lines = await buildLines(db, b.items, products)
      const pricing = priceCart(
        lines.map((l, i) => ({ key: i, barcode: l.barcode, gross: l.total, baseQty: l.baseQty })),
        await activeRules(db, barcodes)
      )
      return {
        lines: pricing.lines.map((pl, i) => ({
          barcode: lines[i].barcode,
          unitId: lines[i].unitId,
          gross: pl.gross,
          lineDiscount: pl.lineDiscount,
          cartDiscount: pl.cartDiscount,
          net: pl.net,
          productRule: pl.productRule
        })),
        subTotal: pricing.subTotal,
        discount: pricing.discount,
        afterDiscount: pricing.afterDiscount,
        applied: pricing.applied
      }
    }
  })

  app.operation({
    name: 'pos.checkout',
    permission: 'pos.sell',
    schema: {
      type: 'object',
      required: ['clientRef', 'shiftId', 'items', 'paymentType'],
      properties: {
        clientRef: { type: 'string', minLength: 8, maxLength: 64 },
        shiftId: { type: 'integer' },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 500,
          items: {
            type: 'object',
            required: ['barcode', 'qty'],
            properties: {
              barcode: { type: 'string', maxLength: 64 },
              // Selling unit (product_units.id); omitted or null = the product's base unit.
              unitId: { type: ['integer', 'null'] },
              qty: { type: 'number', exclusiveMinimum: 0 },
              unitPrice: { type: 'number' }
            }
          }
        },
        // Manual discounts no longer exist (owner, 2026-10-15): only 0 is accepted.
        discount: { type: 'number', minimum: 0 },
        // The total the till showed (after automatic discounts and applied credit). If the
        // service computes another total (a rule or price changed), the sale is refused.
        expectedTotal: { type: 'number' },
        paymentType: { type: 'string', enum: PAYMENT_TYPES },
        paidAmount: { type: ['number', 'null'], minimum: 0 },
        appliedCredit: { type: 'number', minimum: 0 },
        depositChange: { type: 'number', minimum: 0 },
        isDelivery: { type: 'boolean' },
        client: {
          type: ['object', 'null'],
          properties: {
            id: { type: ['integer', 'null'] },
            name: { type: 'string', maxLength: 120 },
            phone: { type: 'string', maxLength: 40 },
            address: { type: 'string', maxLength: 300 },
            // One of the customer's saved addresses for a delivery (client_addresses.id).
            addressId: { type: ['integer', 'null'] }
          }
        }
      }
    },
    handler: async (ctx, b) => {
      const credit = Number(b.appliedCredit || 0)
      if (CREDIT_TYPES.includes(b.paymentType) && !ctx.can('pos.credit'))
        throw forbidden('البيع الآجل يتطلب صلاحية.')
      // No operator can grant a discount: discounts come only from the administrator's rules.
      if (Number(b.discount || 0) > 0)
        throw forbidden('الخصومات تُطبَّق تلقائياً حسب قواعد الإدارة؛ لا يمكن إدخال خصم يدوي.')
      // One line per product unit (a carton and loose packets of one product are two lines).
      const lineKeys = b.items.map((i) => `${i.barcode}|${i.unitId ?? ''}`)
      if (new Set(lineKeys).size !== lineKeys.length) throw badRequest('الصنف مكرر في الفاتورة.')
      const barcodes = [...new Set(b.items.map((i) => i.barcode))]

      return ctx.tx(async (db) => {
        // Idempotency: a retry of a sale that already committed returns that sale.
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [b.clientRef])
        const prior = await db.query('SELECT id FROM sales WHERE client_ref = $1', [b.clientRef])
        if (prior.rows.length)
          return {
            ...(await summarizeSale(db, prior.rows[0].id)),
            saleId: prior.rows[0].id,
            duplicate: true
          }

        const shift = await loadShift(db, ctx, b.shiftId)
        if (shift.user_id !== ctx.user.id) throw forbidden('لا يمكن البيع على وردية مستخدم آخر.')
        if (shift.status !== 'open')
          throw conflict(
            'فشل البيع: لا يمكن تسجيل المعاملة لأن الوردية مغلقة.\nيرجى فتح وردية جديدة للبدء.'
          )

        // Lock the products in a stable order so concurrent terminals cannot deadlock or oversell.
        const sorted = [...barcodes].sort()
        const prodRows = (
          await db.query(
            'SELECT * FROM products WHERE barcode = ANY($1::text[]) ORDER BY barcode FOR UPDATE',
            [sorted]
          )
        ).rows
        const products = new Map(prodRows.map((p) => [p.barcode, p]))
        const lines = await buildLines(db, b.items, products)
        const subTotal = round2(lines.reduce((s, l) => s + l.total, 0))
        // Automatic discounts, evaluated here from the rules in force (never from the till).
        const pricing = priceCart(
          lines.map((l, i) => ({ key: i, barcode: l.barcode, gross: l.total, baseQty: l.baseQty })),
          await activeRules(db, barcodes)
        )
        const discount = pricing.discount

        // Customer: same resolution order as before (selected → by name/phone → new).
        const c = b.client && b.client.name && b.client.name.trim() ? b.client : null
        let clientId = null
        let clientRow = null
        let orderPhone = null // the number used for this order (known customers)
        let savedPhone = null // a new number kept on the customer
        let savedAddress = null // a new address kept on the customer
        let phoneNotSaved = null // why a typed number was used but not kept
        let addressNotSaved = null // why a typed address was used but not kept
        if (c) {
          if (c.id) {
            clientRow = (await db.query('SELECT * FROM clients WHERE id = $1 FOR UPDATE', [c.id]))
              .rows[0]
            if (!clientRow) throw notFound('العميل غير موجود.')
            // The number used for this order (one of the saved ones, or a new one). A new number
            // is kept on the customer when a slot is free, so the next order can just pick it.
            if (c.phone && c.phone.trim()) {
              const { normalizePhone } = await import(
                pathToFileURL(path.join(__dirname, '..', '..', 'shared', 'phone.mjs')).href
              )
              const r = normalizePhone(c.phone)
              if (r.error) throw badRequest(`هاتف العميل: ${r.error}`)
              const digits = (v) => String(v || '').replace(/[^0-9+]/g, '')
              const known = [clientRow.phone, clientRow.phone2].map(digits)
              orderPhone = r.value
              if (!known.includes(r.value)) {
                // Owner rule (1.4.0): a number of another customer, or one beyond the two slots,
                // serves this order only; the reply says so, and the till tells the cashier.
                const taken = await db.query(
                  `SELECT 1 FROM clients WHERE id <> $1
                     AND (regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = $2
                       OR regexp_replace(COALESCE(phone2, ''), '[^0-9+]', '', 'g') = $2) LIMIT 1`,
                  [clientRow.id, r.value]
                )
                if (taken.rowCount) phoneNotSaved = 'other_customer'
                else if (clientRow.phone && clientRow.phone2) phoneNotSaved = 'no_free_slot'
                else {
                  const col = clientRow.phone ? 'phone2' : 'phone'
                  await db.query(`UPDATE clients SET ${col} = $2 WHERE id = $1`, [
                    clientRow.id,
                    r.value
                  ])
                  savedPhone = r.value
                }
              }
            }
          } else {
            // A typed number is validated like in the customers screen and matches either of a
            // customer's two numbers.
            let phone = null
            if (c.phone && c.phone.trim()) {
              const { normalizePhone } = await import(
                pathToFileURL(path.join(__dirname, '..', '..', 'shared', 'phone.mjs')).href
              )
              const r = normalizePhone(c.phone)
              if (r.error) throw badRequest(`هاتف العميل: ${r.error}`)
              phone = r.value
            }
            // A typed phone identifies the customer (either of their numbers); a name alone only
            // when exactly one customer has it. Matching "name OR phone" (audit 1.4.0) could put
            // a credit sale on another person who shares the name.
            if (phone) {
              clientRow = (
                await db.query(
                  `SELECT * FROM clients
                    WHERE regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = $1
                       OR regexp_replace(COALESCE(phone2, ''), '[^0-9+]', '', 'g') = $1
                    ORDER BY id LIMIT 1 FOR UPDATE`,
                  [phone]
                )
              ).rows[0]
            } else {
              const named = (
                await db.query(
                  'SELECT * FROM clients WHERE name = $1 ORDER BY id LIMIT 2 FOR UPDATE',
                  [c.name.trim()]
                )
              ).rows
              if (named.length > 1)
                throw conflict(
                  `يوجد أكثر من عميل باسم "${c.name.trim()}". اختر العميل من القائمة أو اكتب رقم هاتفه.`
                )
              clientRow = named[0]
            }
            if (!clientRow) {
              clientRow = (
                await db.query(
                  `INSERT INTO clients (name, phone, address, debt_balance, points, created_at)
                   VALUES ($1, $2, $3, 0, 0, LOCALTIMESTAMP(0)) RETURNING *`,
                  [c.name.trim(), phone, (c.address || '').trim()]
                )
              ).rows[0]
              // A new customer's address becomes their default delivery address (1.4.0).
              if ((c.address || '').trim())
                await db.query(
                  `INSERT INTO client_addresses (client_id, label, address, is_default)
                   VALUES ($1, 'other', $2, true)`,
                  [clientRow.id, c.address.trim()]
                )
            }
          }
          clientId = clientRow.id
        }
        if (CREDIT_TYPES.includes(b.paymentType) && !clientId) {
          throw badRequest('البيع الآجل أو الدفع الجزئي يتطلب تحديد العميل.')
        }
        if (credit > 0) {
          if (!clientId) throw badRequest('الخصم من الرصيد يتطلب تحديد العميل.')
          const available = Math.max(0, -Number(clientRow.debt_balance || 0))
          if (credit > available + 0.0001 || credit > subTotal - discount + 0.0001)
            throw badRequest('قيمة الخصم من الرصيد أكبر من الرصيد المتاح.')
        }
        const total = round2(Math.max(0, subTotal - discount - credit))
        if (b.expectedTotal !== undefined && Math.abs(Number(b.expectedTotal) - total) > 0.005) {
          throw conflict(
            `تغيّر إجمالي الفاتورة إلى ${total.toFixed(2)} ج.م (خصومات أو أسعار محدّثة). راجع الإجمالي ثم أكمل.`,
            { total, discount, applied: pricing.applied }
          )
        }
        const paid =
          b.paidAmount === null || b.paidAmount === undefined ? null : Number(b.paidAmount)
        const change = paid ? round2(Math.max(0, paid - total)) : 0
        const deposit = Math.min(Number(b.depositChange || 0), change)
        if (deposit > 0 && !clientId) throw badRequest('حفظ الباقي في الرصيد يتطلب تحديد العميل.')

        // Delivery address (1.4.0): one of the customer's saved addresses, a typed one, or the
        // customer's default. Kept on the invoice as it was at the time of the sale.
        let deliveryAddress = null
        if (b.isDelivery) {
          if (c && c.addressId) {
            if (!clientId) throw badRequest('اختر العميل أولاً ثم عنوان التوصيل.')
            const a = (
              await db.query(
                'SELECT address, details FROM client_addresses WHERE id = $1 AND client_id = $2',
                [c.addressId, clientId]
              )
            ).rows[0]
            if (!a) throw badRequest('عنوان التوصيل المختار لا يخص هذا العميل.')
            deliveryAddress = a.details ? `${a.address} – ${a.details}` : a.address
          } else if (c && (c.address || '').trim()) {
            deliveryAddress = c.address.trim()
            // A new address typed for a known customer is saved (up to three), so the next order
            // can pick it instead of typing it again.
            if (c.id && clientId) {
              const saved = (
                await db.query(
                  'SELECT address, is_default FROM client_addresses WHERE client_id = $1',
                  [clientId]
                )
              ).rows
              const dup = saved.some(
                (a) => a.address.trim().toLowerCase() === deliveryAddress.toLowerCase()
              )
              // Owner rule (1.4.0): a fourth address serves this order (and its invoice) only.
              if (!dup && saved.length >= 3) addressNotSaved = 'limit'
              if (!dup && saved.length < 3) {
                await db.query(
                  `INSERT INTO client_addresses (client_id, label, address, is_default)
                   VALUES ($1, 'other', $2, $3)`,
                  [clientId, deliveryAddress, saved.length === 0]
                )
                if (saved.length === 0)
                  await db.query('UPDATE clients SET address = $2 WHERE id = $1', [
                    clientId,
                    deliveryAddress
                  ])
                savedAddress = deliveryAddress
              }
            }
          } else if (clientId) {
            const a = (
              await db.query(
                'SELECT address, details FROM client_addresses WHERE client_id = $1 AND is_default',
                [clientId]
              )
            ).rows[0]
            if (a) deliveryAddress = a.details ? `${a.address} – ${a.details}` : a.address
          }
          if (!deliveryAddress) throw badRequest('اكتب عنوان التوصيل أو اختر أحد عناوين العميل.')
        }

        let clientName = c ? c.name : ''
        if (c) {
          if (orderPhone || c.phone) clientName += ` (${orderPhone || c.phone})`
          if (deliveryAddress) clientName += ` - ${deliveryAddress}`
        }

        // What this invoice leaves on the customer's account and the store balance it consumes:
        // a later return goes back through these first, not out of the drawer (migration 0011).
        const onAccount = !clientId
          ? 0
          : b.paymentType === 'آجل'
            ? total
            : b.paymentType === 'دفع جزئي'
              ? round2(Math.max(0, total - Math.min(total, Math.max(0, paid || 0))))
              : 0
        const sale = (
          await db.query(
            `INSERT INTO sales (shift_id, user_id, timestamp, total_amount, original_amount, discount, payment_type, client_name, client_id, client_ref, pricing_version, on_account_open, credit_open, is_delivery, delivery_address)
             VALUES ($1, $2, LOCALTIMESTAMP(0), $3, $4, $5, $6, $7, $8, $9, 2, $10, $11, $12, $13) RETURNING id, timestamp`,
            [
              shift.id,
              ctx.user.id,
              total,
              subTotal || total,
              discount,
              b.paymentType,
              clientName,
              clientId,
              b.clientRef,
              onAccount,
              clientId ? credit : 0,
              !!b.isDelivery,
              deliveryAddress
            ]
          )
        ).rows[0]
        const saleId = sale.id
        for (const [i, l] of lines.entries()) {
          const pl = pricing.lines[i]
          await db.query(
            `INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, cost_price, unit_id, unit_name, unit_factor, line_discount, cart_discount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              saleId,
              l.barcode,
              l.qty,
              l.price,
              l.total,
              l.cost,
              l.unitId,
              l.unitName,
              l.factor,
              pl.lineDiscount,
              pl.cartDiscount
            ]
          )
          // Negative stock is allowed (owner decision); the sale leaves at the line's cost.
          await postMovement(db, ctx, {
            barcode: l.barcode,
            qty: -l.baseQty,
            kind: 'sale',
            unitCost: l.baseCost,
            refType: 'sale',
            refId: saleId
          })
        }

        for (const a of pricing.applied) {
          await db.query(
            'INSERT INTO sale_discounts (sale_id, rule_id, scope, name, value_type, value, amount) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [saleId, a.ruleId, a.scope, a.name, a.valueType, a.value, a.amount]
          )
        }

        if (clientId) {
          await db.query('UPDATE clients SET points = points + $1 WHERE id = $2', [
            Math.floor(total / 100),
            clientId
          ])
          const ledger = (type, amount, description) =>
            db.query(
              'INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES ($1, $2, $3, $4, LOCALTIMESTAMP(0))',
              [clientId, type, amount, description]
            )
          if (b.paymentType === 'آجل') {
            await db.query('UPDATE clients SET debt_balance = debt_balance + $1 WHERE id = $2', [
              total,
              clientId
            ])
            await ledger('sale', total, `شراء آجل فاتورة رقم #${saleId}`)
          } else if (b.paymentType === 'دفع جزئي') {
            const upfront = Math.min(total, Math.max(0, paid || 0))
            const remaining = Math.max(0, total - upfront)
            if (remaining > 0) {
              await db.query('UPDATE clients SET debt_balance = debt_balance + $1 WHERE id = $2', [
                remaining,
                clientId
              ])
              await ledger('sale', remaining, `متبقي بيع دفع جزئي فاتورة رقم #${saleId}`)
            }
            if (upfront > 0) {
              await db.query(
                `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES ($1, 'inflow', $2, $3, LOCALTIMESTAMP(0))`,
                [shift.id, upfront, `مقدم نقدي بيع دفع جزئي فاتورة رقم #${saleId}`]
              )
            }
          }
          if (credit > 0) {
            await db.query('UPDATE clients SET debt_balance = debt_balance + $1 WHERE id = $2', [
              credit,
              clientId
            ])
            await ledger('sale', credit, `استهلاك رصيد كخصم في فاتورة رقم #${saleId}`)
          }
          if (deposit > 0) {
            await db.query('UPDATE clients SET debt_balance = debt_balance - $1 WHERE id = $2', [
              deposit,
              clientId
            ])
            await ledger('payment', deposit, `حفظ الباقي نقدي رصيد في فاتورة رقم #${saleId}`)
            // K-36: the kept change is cash that stays in the drawer. Wallet payments never
            // reach the drawer, so only cash tenders record it.
            if (CASH_TENDER_TYPES.includes(b.paymentType)) {
              await db.query(
                `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES ($1, 'inflow', $2, $3, LOCALTIMESTAMP(0))`,
                [shift.id, deposit, `باقي محفوظ كرصيد للعميل فاتورة رقم #${saleId}`]
              )
            }
          }
        }
        await ctx.audit(
          db,
          'checkout_sale',
          `إتمام عملية بيع فاتورة بقيمة ${total.toFixed(2)} ج.م (طريقة الدفع: ${b.paymentType})`
        )
        return {
          saleId,
          timestamp: sale.timestamp,
          subTotal,
          discount,
          discounts: pricing.applied,
          lines: lines.map((l, i) => ({
            ...l,
            lineDiscount: pricing.lines[i].lineDiscount,
            cartDiscount: pricing.lines[i].cartDiscount
          })),
          appliedCredit: credit,
          total,
          paid,
          change,
          deposit,
          clientId,
          deliveryAddress,
          savedPhone,
          savedAddress,
          notSaved: { phone: phoneNotSaved, address: addressNotSaved },
          duplicate: false
        }
      })
    }
  })
}

module.exports.PAYMENT_TYPES = PAYMENT_TYPES
