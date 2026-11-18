'use strict'
// Returns without an invoice (owner, 1.9.0, D-116): a trusted customer brings goods back without
// the receipt. Separate from invoice returns (sales.returnItem / returnEntire), which keep their
// rules; allowed only to users with sales.return_without_invoice (administrators by default).
//
// One document per return (customer_returns + its lines), in one transaction with:
//   - the goods back into stock: one 'customer_return' movement per product;
//   - the refund out of the cashier's own open shift drawer: one cash 'refund' movement, described
//     «مرتجع بدون فاتورة …», so the drawer's expected cash, the close report and the treasury count
//     it as a return (shifts.js drawerFigures);
//   - the price of each line: the product's selling price now (no invoice says what it was sold
//     at), kept on the line so a later price change never changes the return.
// A request id (clientRef) makes a retry return the same document: never a second refund.
const { badRequest, notFound, shiftRequired } = require('../errors')
const { postMovement } = require('../inventory/stock')
const { kindRule, toBaseQty, loadUnit, unitPrice, round2 } = require('../inventory/units')
const { addMovement } = require('../money/shiftLedger')

const PERMISSION = 'sales.return_without_invoice'

/** The cashier's own open shift (the one named by the screen, if it is theirs and open). */
async function ownOpenShift(db, ctx, currentShiftId) {
  const { rows } = await db.query(
    `SELECT id FROM shifts WHERE user_id = $1 AND status = 'open'
      ORDER BY (id = $2) DESC, id DESC LIMIT 1`,
    [ctx.user.id, currentShiftId ?? 0]
  )
  if (!rows[0])
    throw shiftRequired(
      'يُصرف مرتجع بدون فاتورة نقداً من درج ورديتك: افتح وردية أولاً ثم أعد المحاولة.'
    )
  return rows[0].id
}

async function documentOf(db, id) {
  const head = (
    await db.query(
      `SELECT r.id, r.shift_id AS "shiftId", r.user_id AS "userId", r.username, r.client_id AS "clientId",
              r.client_name AS "clientName", r.reason, r.total::float8 AS total, r.method,
              r.ledger_id AS "ledgerId", r.client_ref AS "clientRef", r.created_at AS "createdAt"
         FROM customer_returns r WHERE r.id = $1`,
      [id]
    )
  ).rows[0]
  if (!head) return null
  head.items = (
    await db.query(
      `SELECT id, product_barcode AS barcode, product_name AS name, unit_id AS "unitId", unit_name AS "unitName",
              unit_factor::float8 AS factor, quantity::float8 AS quantity, unit_price::float8 AS "unitPrice",
              total::float8 AS total, movement_id AS "movementId"
         FROM customer_return_items WHERE return_id = $1 ORDER BY id`,
      [id]
    )
  ).rows
  return head
}

const lineSchema = {
  type: 'object',
  required: ['barcode', 'quantity'],
  additionalProperties: false,
  properties: {
    barcode: { type: 'string', minLength: 1, maxLength: 64 },
    unitId: { type: ['integer', 'null'] },
    quantity: { type: 'number', exclusiveMinimum: 0, maximum: 100000 }
  }
}

module.exports = function customerReturnsModule(app) {
  app.operation({
    name: 'sales.returnWithoutInvoice',
    permission: PERMISSION,
    schema: {
      type: 'object',
      required: ['clientRef', 'lines', 'reason'],
      additionalProperties: false,
      properties: {
        clientRef: { type: 'string', minLength: 8, maxLength: 120 },
        lines: { type: 'array', minItems: 1, maxItems: 200, items: lineSchema },
        clientId: { type: ['integer', 'null'] },
        reason: { type: 'string', maxLength: 300 },
        currentShiftId: { type: ['integer', 'null'] }
      }
    },
    handler: async (ctx, { clientRef, lines, clientId, reason, currentShiftId }) =>
      ctx.tx(async (db) => {
        // The same request again (a lost reply, a double press): the same return, once.
        const done = (
          await db.query('SELECT id FROM customer_returns WHERE client_ref = $1', [clientRef])
        ).rows[0]
        if (done) return { ...(await documentOf(db, done.id)), duplicate: true }
        const why = String(reason || '').trim()
        if (!why) throw badRequest('اكتب سبب المرتجع (مثلاً: عميل معروف بدون الفاتورة).')
        const shiftId = await ownOpenShift(db, ctx, currentShiftId)
        let client = null
        if (clientId) {
          client = (await db.query('SELECT id, name, code FROM clients WHERE id = $1', [clientId]))
            .rows[0]
          if (!client) throw notFound('العميل غير موجود.')
        }
        // One line per product and unit: the same product scanned twice is one line.
        const merged = new Map()
        for (const l of lines) {
          const k = `${l.barcode.trim()}|${l.unitId ?? ''}`
          const prev = merged.get(k)
          merged.set(k, {
            barcode: l.barcode.trim(),
            unitId: l.unitId ?? null,
            quantity: (prev?.quantity || 0) + Number(l.quantity)
          })
        }
        const priced = []
        for (const l of merged.values()) {
          const product = (
            await db.query('SELECT * FROM products WHERE barcode = $1 FOR UPDATE', [l.barcode])
          ).rows[0]
          if (!product) throw notFound(`الصنف (${l.barcode}) غير مسجل.`)
          if (product.is_active === false)
            throw badRequest(`الصنف "${product.name}" موقوف؛ لا يمكن استلامه كمرتجع.`)
          const unit = await loadUnit(db, product, l.unitId, { purpose: 'sell' })
          const factor = Number(unit.factor) || 1
          const { qty, baseQty } = toBaseQty(
            await kindRule(db, product.unit_kind),
            l.quantity,
            factor,
            product.name
          )
          const price = round2(unitPrice(product, unit))
          if (!(price > 0))
            throw badRequest(
              `سعر بيع "${product.name}" صفر: حدّد سعره أولاً، فالمرتجع يُحسب بسعر البيع الحالي.`
            )
          priced.push({
            product,
            unit,
            factor,
            qty,
            baseQty,
            price,
            total: round2(qty * price),
            unitName: unit.id === null ? product.unit || '' : unit.name
          })
        }
        const total = round2(priced.reduce((a, l) => a + l.total, 0))
        const head = (
          await db.query(
            `INSERT INTO customer_returns (shift_id, user_id, username, client_id, client_name, reason, total, client_ref)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [
              shiftId,
              ctx.user.id,
              ctx.user.username,
              client?.id ?? null,
              client?.name ?? null,
              why,
              total,
              clientRef
            ]
          )
        ).rows[0]
        for (const l of priced) {
          const move = await postMovement(db, ctx, {
            barcode: l.product.barcode,
            qty: l.baseQty,
            kind: 'customer_return',
            refType: 'customer_return',
            refId: head.id,
            reason: `مرتجع بدون فاتورة #${head.id}`
          })
          await db.query(
            `INSERT INTO customer_return_items (return_id, product_barcode, product_name, unit_id, unit_name, unit_factor,
                                                quantity, unit_price, total, movement_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              head.id,
              l.product.barcode,
              l.product.name,
              l.unit.id,
              l.unitName,
              l.factor,
              l.qty,
              l.price,
              l.total,
              move.id
            ]
          )
        }
        // The refund leaves the drawer: a cash outflow of the cashier's shift. "مرتجع" first, so the
        // drawer's figures count it with the returns (shifts.js).
        const items = priced.map((l) => `${l.product.name} ×${l.qty}`).join('، ')
        const ledger = await addMovement(db, {
          shiftId,
          type: 'outflow',
          amount: total,
          description:
            `مرتجع بدون فاتورة #${head.id}${client ? ` – ${client.name}` : ''}: ${items}`.slice(
              0,
              500
            ),
          method: 'cash',
          kind: 'refund',
          refType: 'customer_return',
          refId: head.id,
          party: client?.name || null,
          userId: ctx.user.id
        })
        await db.query('UPDATE customer_returns SET ledger_id = $1 WHERE id = $2', [
          ledger.id,
          head.id
        ])
        await ctx.audit(
          db,
          'customer_return',
          `مرتجع بدون فاتورة #${head.id} بقيمة ${total.toFixed(2)} ج.م${client ? ` من العميل ${client.name}` : ''} – السبب: ${why}`,
          {
            items: priced.map((l) => ({
              barcode: l.product.barcode,
              qty: l.qty,
              unit: l.unitName,
              price: l.price
            })),
            shiftId,
            ledgerId: ledger.id
          }
        )
        return documentOf(db, head.id)
      })
  })

  // The list of returns without an invoice, newest first (20 per page), and one return.
  app.operation({
    name: 'sales.returnsWithoutInvoice',
    anyPermission: [PERMISSION, 'sales.view_all'],
    schema: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
      }
    },
    handler: async (ctx, { page = 1, from, to }) => {
      const where = []
      const params = []
      if (from) {
        params.push(from)
        where.push(`r.created_at >= $${params.length}::date`)
      }
      if (to) {
        params.push(to)
        where.push(`r.created_at < $${params.length}::date + 1`)
      }
      const cond = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = Number(
        (await ctx.pool.query(`SELECT count(*) FROM customer_returns r ${cond}`, params)).rows[0]
          .count
      )
      params.push((page - 1) * 20)
      const rows = (
        await ctx.pool.query(
          `SELECT r.id, r.created_at AS "createdAt", r.username, r.client_name AS "clientName", r.reason,
                  r.total::float8 AS total, r.shift_id AS "shiftId",
                  (SELECT count(*)::int FROM customer_return_items i WHERE i.return_id = r.id) AS lines
             FROM customer_returns r ${cond} ORDER BY r.created_at DESC, r.id DESC LIMIT 20 OFFSET $${params.length}`,
          params
        )
      ).rows
      return { rows, total, pages: Math.max(1, Math.ceil(total / 20)) }
    }
  })

  app.operation({
    name: 'sales.returnWithoutInvoiceDetail',
    anyPermission: [PERMISSION, 'sales.view_all'],
    schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    handler: async (ctx, { id }) => {
      const doc = await documentOf(ctx.pool, id)
      if (!doc) throw notFound('المرتجع غير موجود.')
      return doc
    }
  })
}

module.exports.helpers = { documentOf }
