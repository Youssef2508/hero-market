'use strict'
// Invoices back office (useSalesManager): history, details, returns, reprint data.
// Returns use the legacy refund formulas, now inside one locked transaction each.
const { badRequest, notFound, conflict, shiftRequired, forbidden } = require('../errors')
const { postMovement } = require('../inventory/stock')
const { toBaseQty, kindRule } = require('../inventory/units')
const { authorize, approverSchema } = require('../auth/approvals')
const { methodOf } = require('../money/methods')
const { addMovement } = require('../money/shiftLedger')
const { invoiceShift, assertInvoiceInScope } = require('../auth/invoiceScope')

const PER_PAGE = 12
const ORDER = {
  invoice_number: 's.id',
  timestamp: 's.timestamp',
  client_name: 's.client_name',
  total_amount: 's.total_amount',
  items_count: 'items_count',
  payment_type: 's.payment_type'
}
const returnNote = (reason, approval, ctx) =>
  (String(reason || '').trim() ? ` – السبب: ${String(reason).trim()}` : '') +
  (approval.approver && approval.approver !== ctx.user.username
    ? ` – بموافقة المشرف "${approval.approver}"`
    : '')
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

/** Discounts of an invoice: rules applied and the manual amount with who and why (D-057). */
async function saleDiscounts(db, saleId) {
  return (
    await db.query(
      `SELECT d.scope, d.name, d.value_type, d.value::float AS value, d.amount::float AS amount,
              d.reason, d.created_at, u.username
         FROM sale_discounts d LEFT JOIN users u ON u.id = d.user_id
        WHERE d.sale_id = $1 ORDER BY d.id`,
      [saleId]
    )
  ).rows
}

async function saleItems(db, saleId) {
  return (
    await db.query(
      'SELECT si.*, p.name, p.unit_kind FROM sale_items si LEFT JOIN products p ON si.product_barcode = p.barcode WHERE si.sale_id = $1 ORDER BY si.id',
      [saleId]
    )
  ).rows
}

/**
 * Shift whose drawer pays a cash refund: the actor's own open shift, else the sale's shift while it
 * is still open. A closed shift is final (migration 0011), so without an open drawer a cash refund
 * is refused with a clear message.
 */
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
  const own = (
    await db.query("SELECT id FROM shifts WHERE user_id = $1 AND status = 'open' LIMIT 1", [
      ctx.user.id
    ])
  ).rows[0]
  if (own) return own.id
  const original = (
    await db.query("SELECT id FROM shifts WHERE id = $1 AND status = 'open'", [sale.shift_id])
  ).rows[0]
  if (original) return original.id
  throw shiftRequired('يُصرف المرتجع نقداً من درج وردية مفتوحة: افتح وردية أولاً ثم أعد المحاولة.')
}

/**
 * Pay a refund through the right channel (audit 1.4.0, migration 0011): first what the customer
 * still owes for this invoice, then store balance the customer spent on it, and only the rest in
 * cash from an open drawer. A plain cash sale is refunded in cash as before; a credit (آجل) sale
 * entirely on account, as before. 1.5.0 (PAY-01): a Visa, wallet or InstaPay sale is refunded on
 * its own method: the open shift's movement for that method, never drawer cash.
 */
async function settleRefund(db, ctx, sale, amount, currentShiftId, label) {
  const refund = round2(amount)
  let toDebt = 0
  let toCredit = 0
  if (sale.client_id) {
    toDebt = round2(Math.min(refund, Math.max(0, Number(sale.on_account_open) || 0)))
    toCredit = round2(Math.min(refund - toDebt, Math.max(0, Number(sale.credit_open) || 0)))
  }
  const cash = round2(refund - toDebt - toCredit)
  const ledger = (amt, text) =>
    db.query(
      `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES ($1, 'payment', $2, $3, LOCALTIMESTAMP(0))`,
      [sale.client_id, amt, text]
    )
  if (toDebt > 0 || toCredit > 0) {
    await db.query('UPDATE clients SET debt_balance = debt_balance - $1 WHERE id = $2', [
      round2(toDebt + toCredit),
      sale.client_id
    ])
    await db.query(
      'UPDATE sales SET on_account_open = on_account_open - $1, credit_open = credit_open - $2 WHERE id = $3',
      [toDebt, toCredit, sale.id]
    )
    if (toDebt > 0)
      await ledger(
        toDebt,
        sale.payment_type === 'آجل'
          ? `${label.debtLegacy} #${sale.id}`
          : `${label.debt} #${sale.id}`
      )
    if (toCredit > 0)
      await ledger(toCredit, `إعادة رصيد مستخدم في الفاتورة #${sale.id} (${label.what})`)
  }
  let shiftId = null
  const method = methodOf(sale.payment_type) || 'cash'
  if (cash > 0) {
    shiftId = await refundShift(db, ctx, currentShiftId, sale)
    await addMovement(db, {
      shiftId,
      type: 'outflow',
      amount: cash,
      description: label.cash,
      method,
      kind: 'refund'
    })
  }
  // cash: what left the drawer; paidBack: what went back by the sale's own method (cash included).
  return {
    refund,
    cash: method === 'cash' ? cash : 0,
    paidBack: cash,
    method,
    toDebt,
    toCredit,
    shiftId
  }
}

/**
 * Returns (owner decision 2026-10-14): users with sales.return return directly; users with only
 * sales.return_request (cashiers) need a supervisor holding sales.return and pos.approve, and a
 * reason. The approval is checked inside the return's own transaction.
 */
function returnApproval(ctx, db, { subjectType, subjectId, amount, reason, approver, saleId }) {
  return authorize(ctx, db, {
    action: 'sale_return',
    selfAllowed: ctx.can('sales.return'),
    approverPermissions: ['sales.return', 'pos.approve'],
    subjectType,
    subjectId,
    amount,
    reason,
    reasonRequired: true,
    approver,
    details: { saleId }
  })
}

async function recordReturn(db, ctx, row) {
  await db.query(
    `INSERT INTO sale_returns (sale_id, sale_item_id, quantity, refund, reason, user_id, username, approval_id, shift_id, refund_method, paid_back)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      row.saleId,
      row.saleItemId ?? null,
      row.quantity ?? null,
      row.refund,
      String(row.reason || '').trim() || null,
      ctx.user.id,
      ctx.user.username,
      row.approvalId ?? null,
      row.shiftId ?? null,
      // What went back by which method (0017): the rest went to the customer's account.
      row.paidBack > 0 ? row.method : null,
      row.paidBack ?? null
    ]
  )
}

const returnFields = {
  currentShiftId: { type: ['integer', 'null'] },
  reason: { type: 'string', maxLength: 300 },
  approver: approverSchema
}

/**
 * The cost per base unit a sale line was sold at (its snapshot ÷ its unit factor), for the return
 * that reverses it (D-087). A line without a cost (product never priced) moves at the current price.
 */
function soldCost(line) {
  const cost = Number(line.cost_price) || 0
  if (!(cost > 0)) return undefined
  return Math.round((cost / (Number(line.unit_factor) || 1)) * 10000) / 10000
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
      const conditions = []
      if (search) {
        const clean = search.replace('#', '').trim()
        params.push(likeEscape(search))
        const textMatch = `s.client_name ILIKE '%' || $1 || '%' ESCAPE '\\' OR to_char(s.timestamp, 'YYYY-MM-DD HH24:MI:SS') LIKE '%' || $1 || '%' ESCAPE '\\'`
        if (/^\d+$/.test(clean)) {
          params.push(Number(clean))
          conditions.push(`(s.id = $2 OR ((s.id - 1) % 10000 + 1) = $2 OR ${textMatch})`)
        } else {
          conditions.push(`(${textMatch})`)
        }
      }
      // Without "all invoices": only the user's own open shift (D-081).
      const shiftId = await invoiceShift(ctx.pool, ctx)
      if (shiftId !== null) {
        params.push(shiftId)
        conditions.push(`s.shift_id = $${params.length}`)
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
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
      // scope tells the screen which invoices it lists: all, or the user's open shift only.
      return {
        total,
        page,
        perPage: PER_PAGE,
        rows,
        scope: shiftId === null ? 'all' : 'own_shift',
        shiftId: shiftId || null
      }
    }
  })

  // One invoice by its number for one action (1.5.1, D-082): returns, reprint or a payment method
  // change, from that action's own screen. Any cashier, shift or date, closed shifts included: the
  // action's permission decides, not «عرض الفواتير». The answer holds only what that action needs,
  // and finding an invoice authorizes nothing: each action checks its own permission again.
  const LOOKUP = {
    return: ['sales.return', 'sales.return_request'],
    reprint: ['sales.reprint'],
    payment: ['sales.change_payment']
  }
  app.operation({
    name: 'sales.lookup',
    anyPermission: [...new Set(Object.values(LOOKUP).flat())],
    schema: {
      type: 'object',
      required: ['saleId', 'action'],
      properties: {
        saleId: { type: 'integer', minimum: 1 },
        action: { type: 'string', enum: Object.keys(LOOKUP) }
      }
    },
    handler: async (ctx, { saleId, action }) => {
      if (!LOOKUP[action].some((p) => ctx.can(p))) throw forbidden()
      const s = (
        await ctx.pool.query(
          `SELECT s.id, s.timestamp, s.payment_type, s.total_amount, s.client_name, sh.status = 'open' AS shift_open
             FROM sales s LEFT JOIN shifts sh ON sh.id = s.shift_id WHERE s.id = $1`,
          [saleId]
        )
      ).rows[0]
      if (!s) throw notFound('لم يتم العثور على الفاتورة!')
      const sale = {
        id: s.id,
        timestamp: s.timestamp,
        payment_type: s.payment_type,
        total_amount: s.total_amount
      }
      if (action === 'return') {
        sale.client_name = s.client_name
        const items = (
          await ctx.pool.query(
            `SELECT si.id, si.product_barcode, si.quantity, si.returned_qty, si.unit_price, si.unit_name, p.name
               FROM sale_items si LEFT JOIN products p ON si.product_barcode = p.barcode
              WHERE si.sale_id = $1 ORDER BY si.id`,
            [saleId]
          )
        ).rows
        return { sale, items }
      }
      if (action === 'payment') {
        sale.shift_open = s.shift_open === true
        sale.has_return = !!(
          await ctx.pool.query('SELECT 1 FROM sale_returns WHERE sale_id = $1 LIMIT 1', [saleId])
        ).rows[0]
      }
      return { sale }
    }
  })

  app.operation({
    name: 'sales.detail',
    // Browsing an invoice (the invoices screen, a customer's invoices). Returns by invoice number
    // use sales.lookup (D-082).
    anyPermission: ['sales.view', 'customers.view'],
    schema: { type: 'object', required: ['saleId'], properties: { saleId: { type: 'integer' } } },
    handler: async (ctx, { saleId }) => {
      const sale = (await ctx.pool.query('SELECT * FROM sales WHERE id = $1', [saleId])).rows[0]
      if (!sale) throw notFound('لم يتم العثور على الفاتورة!')
      await assertInvoiceInScope(ctx.pool, ctx, sale)
      const withCashier = await saleWithCashier(ctx.pool, saleId)
      return {
        sale: withCashier || sale,
        items: await saleItems(ctx.pool, saleId),
        discounts: await saleDiscounts(ctx.pool, saleId),
        // PAY-02: payment method changes of this invoice, and whether its shift is still open.
        corrections: (
          await ctx.pool.query(
            'SELECT from_type, to_type, amount::float8 AS amount, reason, username, created_at FROM sale_payment_corrections WHERE sale_id = $1 ORDER BY id',
            [saleId]
          )
        ).rows,
        shiftOpen:
          (
            await ctx.pool.query("SELECT status = 'open' AS open FROM shifts WHERE id = $1", [
              sale.shift_id
            ])
          ).rows[0]?.open === true
      }
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
      return {
        sale,
        items: await saleItems(ctx.pool, saleId),
        discounts: await saleDiscounts(ctx.pool, saleId)
      }
    }
  })

  app.operation({
    name: 'sales.returnItem',
    anyPermission: ['sales.return', 'sales.return_request'],
    schema: {
      type: 'object',
      required: ['saleItemId', 'quantity'],
      properties: {
        saleItemId: { type: 'integer' },
        quantity: { type: 'number', exclusiveMinimum: 0 },
        ...returnFields
      }
    },
    handler: async (ctx, { saleItemId, quantity, currentShiftId, reason, approver }) =>
      ctx.tx(async (db) => {
        const item = (
          await db.query(
            'SELECT si.*, p.name, p.unit_kind FROM sale_items si LEFT JOIN products p ON si.product_barcode = p.barcode WHERE si.id = $1 FOR UPDATE OF si',
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
        // The quantity is in the line's unit (e.g. 0.25 carton = 6 packets); stock gets the base
        // equivalent, which must suit the product (whole pieces, or kg/l with 3 decimals).
        const factor = Number(item.unit_factor) || 1
        const { baseQty } = toBaseQty(
          await kindRule(db, item.unit_kind),
          quantity,
          factor,
          item.name || ''
        )
        const newReturned = already + quantity
        const remBefore = Number(item.quantity) - already
        const remAfter = Number(item.quantity) - newReturned
        // Rounded per line like checkout (weighed lines: 0.2 kg × 240 must be 48.00, not 47.999…).
        const grossAfter = round2(remAfter * Number(item.unit_price))
        let netRefund
        let lineDiscountAfter = 0
        let cartDiscountAfter = 0
        if (Number(sale.pricing_version) === 2) {
          // Rule-priced sale: the line keeps its own discounts. The refund is the drop in the
          // line's net, so successive partial returns add up exactly to what was paid.
          const ld = Number(item.line_discount) || 0
          const cd = Number(item.cart_discount) || 0
          lineDiscountAfter = remBefore > 0 ? round2((ld * remAfter) / remBefore) : 0
          cartDiscountAfter = remBefore > 0 ? round2((cd * remAfter) / remBefore) : 0
          const netBefore = Number(item.total_price) - ld - cd
          netRefund = round2(netBefore - (grossAfter - lineDiscountAfter - cartDiscountAfter))
        } else {
          // Legacy invoice-level discount: refund keeps the invoice's discount ratio as sold.
          const originalAmt =
            Number(sale.original_amount) || Number(sale.total_amount) + Number(sale.discount) || 1
          const ratio = Number(sale.discount) > 0 ? Number(sale.discount) / originalAmt : 0
          const gross = quantity * Number(item.unit_price)
          netRefund = round2(gross - round2(gross * ratio))
        }
        const approval = await returnApproval(ctx, db, {
          subjectType: 'sale_item',
          subjectId: item.id,
          amount: netRefund,
          reason,
          approver,
          saleId: sale.id
        })
        // Returned goods re-enter at the cost they were sold at (D-087); the product's purchase
        // price does not change.
        await postMovement(db, ctx, {
          barcode: item.product_barcode,
          qty: baseQty,
          unitCost: soldCost(item),
          kind: 'return',
          refType: 'sale_item',
          refId: item.id
        })
        await db.query(
          'UPDATE sale_items SET returned_qty = $1, total_price = $2, line_discount = $3, cart_discount = $4 WHERE id = $5',
          [newReturned, grossAfter, lineDiscountAfter, cartDiscountAfter, item.id]
        )
        // K-40: the invoice's discount stays as sold (the drawer counts sales as sold and the refund
        // as an outflow); only the remaining total goes down by the refund.
        await db.query(
          'UPDATE sales SET total_amount = GREATEST(0, total_amount - $1) WHERE id = $2',
          [netRefund, sale.id]
        )
        const paid = await settleRefund(db, ctx, sale, netRefund, currentShiftId, {
          what: `مرتجع صنف ${item.name || item.product_barcode}`,
          debtLegacy: 'إرجاع صنف من فاتورة آجل',
          debt: 'إرجاع صنف يخصم من المتبقي على العميل في الفاتورة',
          cash: `مرتجع صنف ${item.name || item.product_barcode} (${quantity}) للفاتورة #${sale.id}`
        })
        const shiftId = paid.shiftId
        await recordReturn(db, ctx, {
          saleId: sale.id,
          saleItemId: item.id,
          quantity,
          refund: netRefund,
          reason,
          approvalId: approval.approvalId,
          shiftId,
          method: paid.method,
          paidBack: paid.paidBack
        })
        await ctx.audit(
          db,
          'sale_return',
          `إرجاع ${quantity} من "${item.name || item.product_barcode}" من الفاتورة #${sale.id} بقيمة ${netRefund.toFixed(2)} ج.م${returnNote(reason, approval, ctx)}`
        )
        return {
          netRefund,
          cashRefund: paid.cash,
          // 1.5.0: the method the refund went back on, and how much (Visa, wallet, InstaPay or cash).
          refundMethod: paid.method,
          methodRefund: paid.paidBack,
          toAccount: round2(paid.toDebt + paid.toCredit),
          sale: await saleWithCashier(db, sale.id),
          items: await saleItems(db, sale.id)
        }
      })
  })

  app.operation({
    name: 'sales.returnEntire',
    anyPermission: ['sales.return', 'sales.return_request'],
    schema: {
      type: 'object',
      required: ['saleId'],
      properties: { saleId: { type: 'integer' }, ...returnFields }
    },
    handler: async (ctx, { saleId, currentShiftId, reason, approver }) =>
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
        // Rule-priced invoices: what is left of the lines' net value. This equals the remaining
        // total, plus any store balance the customer spent on the invoice – which the total does
        // not include, and which goes back to the customer's balance (audit 1.4.0). Legacy
        // invoices keep their remaining total.
        const refund =
          Number(sale.pricing_version) === 2
            ? round2(
                items.reduce(
                  (a, i) =>
                    a +
                    (Number(i.total_price) || 0) -
                    (Number(i.line_discount) || 0) -
                    (Number(i.cart_discount) || 0),
                  0
                )
              )
            : Number(sale.total_amount) || 0
        const approval = await returnApproval(ctx, db, {
          subjectType: 'sale',
          subjectId: sale.id,
          amount: refund,
          reason,
          approver,
          saleId: sale.id
        })
        for (const i of items) {
          const remaining = Number(i.quantity) - (Number(i.returned_qty) || 0)
          if (remaining > 0)
            await postMovement(db, ctx, {
              barcode: i.product_barcode,
              qty: Math.round(remaining * (Number(i.unit_factor) || 1) * 1000) / 1000,
              unitCost: soldCost(i),
              kind: 'return',
              refType: 'sale_item',
              refId: i.id
            })
        }
        await db.query(
          'UPDATE sale_items SET returned_qty = quantity, total_price = 0, line_discount = 0, cart_discount = 0 WHERE sale_id = $1',
          [saleId]
        )
        // K-40: discount stays as sold; the whole remaining total is refunded.
        await db.query('UPDATE sales SET total_amount = 0 WHERE id = $1', [saleId])
        const paid = await settleRefund(db, ctx, sale, refund, currentShiftId, {
          what: 'إرجاع كامل الفاتورة',
          debtLegacy: 'إرجاع كامل فاتورة آجل',
          debt: 'إرجاع كامل الفاتورة يخصم من المتبقي على العميل',
          cash: `مرتجع كامل الفاتورة #${saleId}`
        })
        const shiftId = paid.shiftId
        await recordReturn(db, ctx, {
          saleId,
          refund,
          reason,
          approvalId: approval.approvalId,
          shiftId,
          method: paid.method,
          paidBack: paid.paidBack
        })
        await ctx.audit(
          db,
          'sale_return',
          `إرجاع كامل الفاتورة #${saleId} بقيمة ${refund.toFixed(2)} ج.م${returnNote(reason, approval, ctx)}`
        )
        return {
          refund,
          cashRefund: paid.cash,
          // 1.5.0: the method the refund went back on, and how much (Visa, wallet, InstaPay or cash).
          refundMethod: paid.method,
          methodRefund: paid.paidBack,
          toAccount: round2(paid.toDebt + paid.toCredit),
          sale: await saleWithCashier(db, saleId),
          items: await saleItems(db, saleId)
        }
      })
  })
}
