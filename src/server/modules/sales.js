'use strict'
// Invoices back office (useSalesManager): history, details, returns, reprint data.
// Returns use the legacy refund formulas, now inside one locked transaction each.
const { badRequest, notFound, conflict } = require('../errors')

const PER_PAGE = 12
const ORDER = {
  invoice_number: 's.id',
  timestamp: 's.timestamp',
  client_name: 's.client_name',
  total_amount: 's.total_amount',
  items_count: 'items_count',
  payment_type: 's.payment_type'
}
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`)

async function saleWithCashier(db, saleId) {
  return (
    await db.query(
      `SELECT s.*, u.username FROM sales s JOIN shifts sh ON s.shift_id = sh.id JOIN users u ON sh.user_id = u.id WHERE s.id = $1`,
      [saleId]
    )
  ).rows[0]
}

async function saleItems(db, saleId) {
  return (
    await db.query(
      'SELECT si.*, p.name FROM sale_items si LEFT JOIN products p ON si.product_barcode = p.barcode WHERE si.sale_id = $1 ORDER BY si.id',
      [saleId]
    )
  ).rows
}

/** Shift that receives a cash refund: the actor's own open shift if given, else the sale's shift (legacy rule). */
async function refundShift(db, ctx, currentShiftId, sale) {
  if (currentShiftId) {
    const s = (
      await db.query("SELECT id FROM shifts WHERE id = $1 AND user_id = $2 AND status = 'open'", [
        currentShiftId,
        ctx.user.id
      ])
    ).rows[0]
    if (s) return s.id
  }
  return sale.shift_id
}

module.exports = function salesModule(app) {
  app.operation({
    name: 'sales.page',
    permission: 'sales.view',
    schema: {
      type: 'object',
      properties: {
        search: { type: 'string', maxLength: 100 },
        sortField: { type: 'string' },
        sortAsc: { type: 'boolean' },
        page: { type: 'integer', minimum: 1 }
      }
    },
    handler: async (
      ctx,
      { search = '', sortField = 'invoice_number', sortAsc = false, page = 1 }
    ) => {
      const params = []
      let where = ''
      if (search) {
        const clean = search.replace('#', '').trim()
        params.push(likeEscape(search))
        const textMatch = `s.client_name ILIKE '%' || $1 || '%' ESCAPE '\\' OR to_char(s.timestamp, 'YYYY-MM-DD HH24:MI:SS') LIKE '%' || $1 || '%' ESCAPE '\\'`
        if (/^\d+$/.test(clean)) {
          params.push(Number(clean))
          where = `WHERE s.id = $2 OR ((s.id - 1) % 10000 + 1) = $2 OR ${textMatch}`
        } else {
          where = `WHERE ${textMatch}`
        }
      }
      const base = `FROM sales s JOIN shifts sh ON s.shift_id = sh.id JOIN users u ON sh.user_id = u.id ${where}`
      const total = (await ctx.pool.query(`SELECT COUNT(*) AS count ${base}`, params)).rows[0].count
      const order = ORDER[sortField] || 's.id'
      const rows = (
        await ctx.pool.query(
          `SELECT s.*, u.username, (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) AS items_count ${base}
           ORDER BY ${order} ${sortAsc ? 'ASC' : 'DESC'}, s.id DESC LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`,
          params
        )
      ).rows
      return { total, page, perPage: PER_PAGE, rows }
    }
  })

  app.operation({
    name: 'sales.detail',
    anyPermission: ['sales.view', 'customers.view'],
    schema: { type: 'object', required: ['saleId'], properties: { saleId: { type: 'integer' } } },
    handler: async (ctx, { saleId }) => {
      const sale = (await ctx.pool.query('SELECT * FROM sales WHERE id = $1', [saleId])).rows[0]
      if (!sale) throw notFound('لم يتم العثور على الفاتورة!')
      const withCashier = await saleWithCashier(ctx.pool, saleId)
      return { sale: withCashier || sale, items: await saleItems(ctx.pool, saleId) }
    }
  })

  // Data for generateReprintHtml (usePOSController.handleReprintSale).
  app.operation({
    name: 'sales.reprintData',
    permission: 'sales.reprint',
    schema: { type: 'object', required: ['saleId'], properties: { saleId: { type: 'integer' } } },
    handler: async (ctx, { saleId }) => {
      const sale = await saleWithCashier(ctx.pool, saleId)
      if (!sale) throw notFound('لم يتم العثور على الفاتورة!')
      return { sale, items: await saleItems(ctx.pool, saleId) }
    }
  })

  app.operation({
    name: 'sales.returnItem',
    permission: 'sales.return',
    schema: {
      type: 'object',
      required: ['saleItemId', 'quantity'],
      properties: {
        saleItemId: { type: 'integer' },
        quantity: { type: 'number', exclusiveMinimum: 0 },
        currentShiftId: { type: ['integer', 'null'] }
      }
    },
    handler: async (ctx, { saleItemId, quantity, currentShiftId }) =>
      ctx.tx(async (db) => {
        const item = (
          await db.query(
            'SELECT si.*, p.name FROM sale_items si LEFT JOIN products p ON si.product_barcode = p.barcode WHERE si.id = $1 FOR UPDATE OF si',
            [saleItemId]
          )
        ).rows[0]
        if (!item) throw notFound()
        const sale = (
          await db.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [item.sale_id])
        ).rows[0]
        if (!sale) throw notFound('لم يتم العثور على الفاتورة!')
        const already = Number(item.returned_qty) || 0
        const maxReturnable = Number(item.quantity) - already
        if (quantity > maxReturnable + 1e-9) {
          throw badRequest(
            `الرجاء إدخال كمية مرتجع صحيحة (أكبر من 0 ولا تزيد عن المتبقي: ${maxReturnable}).`
          )
        }
        const originalAmt =
          Number(sale.original_amount) || Number(sale.total_amount) + Number(sale.discount) || 1
        const currentDiscount = Number(sale.discount) || 0
        const ratio = currentDiscount > 0 && originalAmt > 0 ? currentDiscount / originalAmt : 0
        const gross = quantity * Number(item.unit_price)
        const discountShare = round2(gross * ratio)
        const netRefund = round2(gross - discountShare)
        const newReturned = already + quantity
        await db.query('UPDATE products SET stock_qty = stock_qty + $1 WHERE barcode = $2', [
          quantity,
          item.product_barcode
        ])
        await db.query('UPDATE sale_items SET returned_qty = $1, total_price = $2 WHERE id = $3', [
          newReturned,
          (Number(item.quantity) - newReturned) * Number(item.unit_price),
          item.id
        ])
        await db.query(
          `UPDATE sales SET discount = GREATEST(0, discount - $1),
             total_amount = GREATEST(0, (SELECT COALESCE(SUM(total_price), 0) FROM sale_items WHERE sale_id = $2) - GREATEST(0, discount - $1))
           WHERE id = $2`,
          [discountShare, sale.id]
        )
        if (sale.payment_type === 'آجل' && sale.client_id) {
          await db.query('UPDATE clients SET debt_balance = debt_balance - $1 WHERE id = $2', [
            netRefund,
            sale.client_id
          ])
          await db.query(
            `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES ($1, 'payment', $2, $3, LOCALTIMESTAMP(0))`,
            [sale.client_id, netRefund, `إرجاع صنف من فاتورة آجل #${sale.id}`]
          )
        } else {
          await db.query(
            `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES ($1, 'outflow', $2, $3, LOCALTIMESTAMP(0))`,
            [
              await refundShift(db, ctx, currentShiftId, sale),
              netRefund,
              `مرتجع صنف ${item.name || item.product_barcode} (${quantity}) للفاتورة #${sale.id}`
            ]
          )
        }
        await ctx.audit(
          db,
          'sale_return',
          `إرجاع ${quantity} من "${item.name || item.product_barcode}" من الفاتورة #${sale.id} بقيمة ${netRefund.toFixed(2)} ج.م`
        )
        return {
          netRefund,
          sale: await saleWithCashier(db, sale.id),
          items: await saleItems(db, sale.id)
        }
      })
  })

  app.operation({
    name: 'sales.returnEntire',
    permission: 'sales.return',
    schema: {
      type: 'object',
      required: ['saleId'],
      properties: { saleId: { type: 'integer' }, currentShiftId: { type: ['integer', 'null'] } }
    },
    handler: async (ctx, { saleId, currentShiftId }) =>
      ctx.tx(async (db) => {
        const sale = (await db.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]))
          .rows[0]
        if (!sale) throw notFound('لم يتم العثور على الفاتورة!')
        const items = (
          await db.query('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id FOR UPDATE', [
            saleId
          ])
        ).rows
        if (
          items.every((i) => Number(i.quantity) - (Number(i.returned_qty) || 0) <= 0) &&
          Number(sale.total_amount) === 0
        ) {
          throw conflict('تم إرجاع هذه الفاتورة بالكامل من قبل.')
        }
        for (const i of items) {
          const remaining = Number(i.quantity) - (Number(i.returned_qty) || 0)
          if (remaining > 0)
            await db.query('UPDATE products SET stock_qty = stock_qty + $1 WHERE barcode = $2', [
              remaining,
              i.product_barcode
            ])
        }
        await db.query(
          'UPDATE sale_items SET returned_qty = quantity, total_price = 0 WHERE sale_id = $1',
          [saleId]
        )
        await db.query('UPDATE sales SET total_amount = 0, discount = 0 WHERE id = $1', [saleId])
        const refund = Number(sale.total_amount) || 0
        if (sale.payment_type === 'آجل' && sale.client_id) {
          await db.query('UPDATE clients SET debt_balance = debt_balance - $1 WHERE id = $2', [
            refund,
            sale.client_id
          ])
          await db.query(
            `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES ($1, 'payment', $2, $3, LOCALTIMESTAMP(0))`,
            [sale.client_id, refund, `إرجاع كامل فاتورة آجل #${saleId}`]
          )
        } else {
          await db.query(
            `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES ($1, 'outflow', $2, $3, LOCALTIMESTAMP(0))`,
            [
              await refundShift(db, ctx, currentShiftId, sale),
              refund,
              `مرتجع كامل الفاتورة #${saleId}`
            ]
          )
        }
        await ctx.audit(
          db,
          'sale_return',
          `إرجاع كامل الفاتورة #${saleId} بقيمة ${refund.toFixed(2)} ج.م`
        )
        return {
          refund,
          sale: await saleWithCashier(db, saleId),
          items: await saleItems(db, saleId)
        }
      })
  })
}
