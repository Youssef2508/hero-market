'use strict'
// Cashier operations: product lookup/search, customer autocomplete and checkout.
// Checkout reproduces usePOSController.handleCheckout, but on the server, in one transaction:
//  - prices come from the catalogue, not from the terminal (G-04);
//  - the new sale id comes from INSERT … RETURNING, never MAX(id) (G-03);
//  - a new customer is created inside the same transaction (K-12);
//  - a client-generated key makes retries return the same sale instead of a second one (G-21).
const { postMovement } = require('../inventory/stock')
const {
  baseUnit,
  unitPrice,
  loadUnit,
  toBaseQty,
  parseScaleLabel,
  round3,
  round4
} = require('../inventory/units')
const { badRequest, forbidden, conflict, notFound } = require('../errors')
const { loadShift } = require('./shifts').helpers
const { maskCost } = require('./catalog')
const { readAll } = require('./settings')

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
        'SELECT * FROM products WHERE barcode = ANY($1::text[]) LIMIT 1',
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
        if (scale) {
          const c = scale.code
          product = (
            await db.query('SELECT * FROM products WHERE barcode = ANY($1::text[]) LIMIT 1', [
              [...new Set([c, c.replace(/^0+/, '')].filter(Boolean))]
            ])
          ).rows[0]
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
            `SELECT * FROM products WHERE barcode LIKE '%' || $1 ESCAPE '\\' LIMIT 5`,
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
            `SELECT * FROM products WHERE name ILIKE '%' || $1 || '%' ESCAPE '\\' OR barcode ILIKE '%' || $1 || '%' ESCAPE '\\' LIMIT 8`,
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
          `SELECT * FROM clients WHERE name ILIKE '%' || $1 || '%' ESCAPE '\\' OR phone ILIKE '%' || $1 || '%' ESCAPE '\\' LIMIT 5`,
          [t]
        )
      ).rows
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
        discount: { type: 'number', minimum: 0 },
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
            address: { type: 'string', maxLength: 300 }
          }
        }
      }
    },
    handler: async (ctx, b) => {
      const discount = Number(b.discount || 0)
      const credit = Number(b.appliedCredit || 0)
      if (CREDIT_TYPES.includes(b.paymentType) && !ctx.can('pos.credit'))
        throw forbidden('البيع الآجل يتطلب صلاحية.')
      if (discount > 0 && !ctx.can('pos.discount')) throw forbidden('منح الخصم يتطلب صلاحية.')
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
        const lines = []
        for (const i of b.items) {
          const p = products.get(i.barcode)
          if (!p) throw notFound(`الصنف (${i.barcode}) غير مسجل في قاعدة البيانات!`)
          const unit = await loadUnit(db, p, i.unitId, { purpose: 'sell' })
          const label = unit.id === null ? p.name : `${p.name} – ${unit.name}`
          const { qty, baseQty } = toBaseQty(p.unit_kind || 'count', i.qty, unit.factor, label)
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
        const subTotal = round2(lines.reduce((s, l) => s + l.total, 0))
        if (discount > subTotal) throw badRequest('قيمة الخصم أكبر من إجمالي الفاتورة.')

        // Customer: same resolution order as before (selected → by name/phone → new).
        const c = b.client && b.client.name && b.client.name.trim() ? b.client : null
        let clientId = null
        let clientRow = null
        if (c) {
          if (c.id) {
            clientRow = (await db.query('SELECT * FROM clients WHERE id = $1 FOR UPDATE', [c.id]))
              .rows[0]
            if (!clientRow) throw notFound('العميل غير موجود.')
          } else {
            const phone = c.phone && c.phone.trim() ? c.phone.trim() : null
            clientRow = (
              await db.query(
                phone
                  ? 'SELECT * FROM clients WHERE name = $1 OR phone = $2 ORDER BY id LIMIT 1 FOR UPDATE'
                  : 'SELECT * FROM clients WHERE name = $1 ORDER BY id LIMIT 1 FOR UPDATE',
                phone ? [c.name, phone] : [c.name]
              )
            ).rows[0]
            if (!clientRow) {
              clientRow = (
                await db.query(
                  `INSERT INTO clients (name, phone, address, debt_balance, points, created_at)
                   VALUES ($1, $2, $3, 0, 0, LOCALTIMESTAMP(0)) RETURNING *`,
                  [c.name, phone, c.address || '']
                )
              ).rows[0]
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
        const paid =
          b.paidAmount === null || b.paidAmount === undefined ? null : Number(b.paidAmount)
        const change = paid ? round2(Math.max(0, paid - total)) : 0
        const deposit = Math.min(Number(b.depositChange || 0), change)
        if (deposit > 0 && !clientId) throw badRequest('حفظ الباقي في الرصيد يتطلب تحديد العميل.')

        let clientName = c ? c.name : ''
        if (c) {
          if (c.phone) clientName += ` (${c.phone})`
          if (b.isDelivery && c.address) clientName += ` - ${c.address}`
        }

        const sale = (
          await db.query(
            `INSERT INTO sales (shift_id, user_id, timestamp, total_amount, original_amount, discount, payment_type, client_name, client_id, client_ref)
             VALUES ($1, $2, LOCALTIMESTAMP(0), $3, $4, $5, $6, $7, $8, $9) RETURNING id, timestamp`,
            [
              shift.id,
              ctx.user.id,
              total,
              subTotal || total,
              discount,
              b.paymentType,
              clientName,
              clientId,
              b.clientRef
            ]
          )
        ).rows[0]
        const saleId = sale.id
        for (const l of lines) {
          await db.query(
            `INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, cost_price, unit_id, unit_name, unit_factor)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [saleId, l.barcode, l.qty, l.price, l.total, l.cost, l.unitId, l.unitName, l.factor]
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
          appliedCredit: credit,
          total,
          paid,
          change,
          deposit,
          clientId,
          lines,
          duplicate: false
        }
      })
    }
  })
}

module.exports.PAYMENT_TYPES = PAYMENT_TYPES
