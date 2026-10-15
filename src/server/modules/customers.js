'use strict'
// Customers (useClientsManager): directory, monthly report, profile, add/edit/delete, repayments.
const { badRequest, conflict, notFound } = require('../errors')

const path = require('path')
const { pathToFileURL } = require('url')

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`)

// Shared with the screens (src/shared/phone.mjs): same validation everywhere.
let phoneLib = null
async function phones() {
  if (!phoneLib)
    phoneLib = await import(
      pathToFileURL(path.join(__dirname, '..', '..', 'shared', 'phone.mjs')).href
    )
  return phoneLib
}

/** Validated numbers of a customer body: `phones` [primary, second?] or legacy `phone`/`phone2`. */
async function bodyPhones(c) {
  const list = Array.isArray(c.phones) ? c.phones : [c.phone, c.phone2]
  const { phones: out, error } = (await phones()).normalizePhones(list)
  if (error) throw badRequest(error)
  return { phone: out[0] || null, phone2: out[1] || null }
}

// Stored numbers compared by their digits (and +), so "0100 123 4567" equals "01001234567".
const DIGITS = (col) => `regexp_replace(COALESCE(${col}, ''), '[^0-9+]', '', 'g')`

const clientSchema = {
  type: 'object',
  required: ['name'],
  properties: {
    id: { type: 'integer' },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    phone: { type: ['string', 'null'], maxLength: 40 },
    phone2: { type: ['string', 'null'], maxLength: 40 },
    // Preferred form: primary first; at most two numbers (also enforced by the database).
    phones: { type: 'array', maxItems: 2, items: { type: ['string', 'null'], maxLength: 40 } },
    address: { type: ['string', 'null'], maxLength: 300 }
  }
}

async function assertPhonesFree(db, list, exceptId = null) {
  const wanted = list.filter(Boolean)
  if (!wanted.length) return
  const r = await db.query(
    `SELECT id FROM clients
      WHERE ($2::int IS NULL OR id <> $2)
        AND (${DIGITS('phone')} = ANY($1::text[]) OR ${DIGITS('phone2')} = ANY($1::text[]))
      LIMIT 1`,
    [wanted, exceptId]
  )
  if (r.rows.length) throw conflict('رقم الهاتف هذا مسجل لعميل آخر بالفعل!')
}

module.exports = function customersModule(app) {
  app.operation({
    name: 'clients.list',
    anyPermission: ['customers.view', 'customers.manage'],
    schema: { type: 'object', properties: { search: { type: 'string', maxLength: 100 } } },
    handler: async (ctx, { search = '' }) => {
      if (!search) return (await ctx.pool.query('SELECT * FROM clients ORDER BY name ASC, id')).rows
      return (
        await ctx.pool.query(
          `SELECT * FROM clients WHERE name ILIKE '%' || $1 || '%' ESCAPE '\\' OR phone ILIKE '%' || $1 || '%' ESCAPE '\\' OR phone2 ILIKE '%' || $1 || '%' ESCAPE '\\' ORDER BY name ASC, id`,
          [likeEscape(search)]
        )
      ).rows
    }
  })

  // Highest points + this month's ranking by purchases (legacy fetchClientStats).
  app.operation({
    name: 'clients.stats',
    anyPermission: ['customers.view', 'customers.manage'],
    handler: async (ctx) => {
      const top =
        (
          await ctx.pool.query(
            'SELECT * FROM clients WHERE points > 0 ORDER BY points DESC, id LIMIT 1'
          )
        ).rows[0] || null
      const report = (
        await ctx.pool.query(
          `SELECT s.client_id AS id, COALESCE(c.name, 'عميل محذوف') AS name, COALESCE(c.phone, '') AS phone, c.phone2, SUM(s.total_amount) AS "totalSpent"
           FROM sales s LEFT JOIN clients c ON c.id = s.client_id
           WHERE s.client_id IS NOT NULL AND date_trunc('month', s.timestamp) = date_trunc('month', LOCALTIMESTAMP)
           GROUP BY s.client_id, c.name, c.phone, c.phone2
           ORDER BY "totalSpent" DESC, s.client_id`
        )
      ).rows
      return {
        highestPointsCustomer: top,
        monthlyClientsReport: report,
        bestCustomerOfMonth: report.length
          ? { ...report[0], monthlySpent: report[0].totalSpent }
          : null
      }
    }
  })

  app.operation({
    name: 'clients.profile',
    anyPermission: ['customers.view', 'customers.manage'],
    schema: {
      type: 'object',
      required: ['clientId'],
      properties: { clientId: { type: 'integer' } }
    },
    handler: async (ctx, { clientId }) => {
      const db = ctx.pool
      const client =
        (await db.query('SELECT * FROM clients WHERE id = $1', [clientId])).rows[0] || null
      const purchases = (
        await db.query(
          `SELECT s.*, u.username, (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) AS items_count
           FROM sales s JOIN shifts sh ON s.shift_id = sh.id JOIN users u ON sh.user_id = u.id
           WHERE s.client_id = $1 ORDER BY s.id DESC`,
          [clientId]
        )
      ).rows
      const ledger = (
        await db.query('SELECT * FROM client_ledger WHERE client_id = $1 ORDER BY id DESC', [
          clientId
        ])
      ).rows
      const saleItems = (
        await db.query(
          `SELECT si.quantity, si.unit_name, si.unit_factor, si.total_price - si.line_discount - si.cart_discount AS total_price, si.product_barcode, p.name, s.timestamp, s.id AS sale_id
           FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_barcode = p.barcode
           WHERE s.client_id = $1 ORDER BY si.id`,
          [clientId]
        )
      ).rows
      return { client, purchases, ledger, saleItems }
    }
  })

  app.operation({
    name: 'clients.create',
    permission: 'customers.manage',
    schema: clientSchema,
    handler: async (ctx, c) =>
      ctx.tx(async (db) => {
        // K-26: an empty phone is stored as NULL (the unique index treats '' as a value).
        const { phone, phone2 } = await bodyPhones(c)
        await assertPhonesFree(db, [phone, phone2])
        const r = await db.query(
          `INSERT INTO clients (name, phone, phone2, address, debt_balance, points, created_at) VALUES ($1, $2, $3, $4, 0, 0, LOCALTIMESTAMP(0)) RETURNING *`,
          [c.name, phone, phone2, c.address || '']
        )
        await ctx.audit(db, 'client_create', `إضافة العميل "${c.name}"`)
        return r.rows[0]
      })
  })

  app.operation({
    name: 'clients.update',
    permission: 'customers.manage',
    schema: { ...clientSchema, required: ['id', 'name'] },
    handler: async (ctx, c) =>
      ctx.tx(async (db) => {
        const { phone, phone2 } = await bodyPhones(c)
        await assertPhonesFree(db, [phone, phone2], c.id)
        const r = await db.query(
          'UPDATE clients SET name = $2, phone = $3, phone2 = $4, address = $5 WHERE id = $1 RETURNING *',
          [c.id, c.name, phone, phone2, c.address || '']
        )
        if (!r.rowCount) throw notFound('العميل غير موجود.')
        await ctx.audit(db, 'client_update', `تعديل بيانات العميل "${c.name}"`)
        return r.rows[0]
      })
  })

  app.operation({
    name: 'clients.delete',
    permission: 'customers.manage',
    schema: {
      type: 'object',
      required: ['clientId'],
      properties: { clientId: { type: 'integer' } }
    },
    handler: async (ctx, { clientId }) =>
      ctx.tx(async (db) => {
        const c = (await db.query('SELECT * FROM clients WHERE id = $1 FOR UPDATE', [clientId]))
          .rows[0]
        if (!c) throw notFound('العميل غير موجود.')
        if (Number(c.debt_balance) !== 0)
          throw conflict('لا يمكن حذف عميل لديه رصيد مالي (دائن أو مدين)!')
        try {
          await db.query('DELETE FROM clients WHERE id = $1', [clientId])
        } catch (e) {
          if (e.code === '23503')
            throw conflict(
              'لا يمكن حذف هذا العميل لأنه لديه معاملات أو فواتير سابقة مسجلة بالنظام.'
            )
          throw e
        }
        await ctx.audit(db, 'client_delete', `حذف العميل "${c.name}"`)
      })
  })

  app.operation({
    name: 'clients.repay',
    permission: 'customers.payments',
    schema: {
      type: 'object',
      required: ['clientId', 'amount'],
      properties: {
        clientId: { type: 'integer' },
        amount: { type: 'number', exclusiveMinimum: 0 },
        currentShiftId: { type: ['integer', 'null'] }
      }
    },
    handler: async (ctx, { clientId, amount, currentShiftId }) =>
      ctx.tx(async (db) => {
        const c = (await db.query('SELECT * FROM clients WHERE id = $1 FOR UPDATE', [clientId]))
          .rows[0]
        if (!c) throw notFound('العميل غير موجود.')
        if (Number(c.debt_balance) <= 0) throw badRequest('العميل ليس لديه مديونية مستحقة!')
        const shift = currentShiftId
          ? (
              await db.query(
                "SELECT id FROM shifts WHERE id = $1 AND user_id = $2 AND status = 'open'",
                [currentShiftId, ctx.user.id]
              )
            ).rows[0]
          : null
        // Cash goes into the drawer of an open shift (safe_ledger.shift_id is required).
        if (!shift) throw conflict('يجب فتح وردية لتسجيل السداد النقدي في الخزينة.')
        await db.query('UPDATE clients SET debt_balance = debt_balance - $1 WHERE id = $2', [
          amount,
          clientId
        ])
        await db.query(
          `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES ($1, 'payment', $2, 'سداد نقدي من العميل', LOCALTIMESTAMP(0))`,
          [clientId, amount]
        )
        await db.query(
          `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES ($1, 'inflow', $2, $3, LOCALTIMESTAMP(0))`,
          [shift.id, amount, `سداد دين العميل: ${c.name}`]
        )
        await ctx.audit(db, 'client_payment', `سداد ${amount.toFixed(2)} ج.م من العميل "${c.name}"`)
        return (await db.query('SELECT * FROM clients WHERE id = $1', [clientId])).rows[0]
      })
  })
}
