'use strict'
// Customers (useClientsManager): directory, monthly report, profile, add/edit/delete, repayments.
const { badRequest, conflict, notFound } = require('../errors')
const treasury = require('../money/treasury')
const { addMovement, recorded } = require('../money/shiftLedger')
const { METHODS } = require('../money/methods')

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

// Addresses (src/shared/address.mjs): at most three, one default.
let addressLib = null
async function addressRules() {
  if (!addressLib)
    addressLib = await import(
      pathToFileURL(path.join(__dirname, '..', '..', 'shared', 'address.mjs')).href
    )
  return addressLib
}

/**
 * Replace a customer's addresses with `list` (already validated): kept ones are updated, new ones
 * inserted, missing ones deleted; clients.address mirrors the default for older screens.
 */
async function saveAddresses(db, clientId, list) {
  const own = new Set(
    (
      await db.query('SELECT id FROM client_addresses WHERE client_id = $1 FOR UPDATE', [clientId])
    ).rows.map((r) => r.id)
  )
  const keep = list.filter((a) => a.id !== undefined).map((a) => a.id)
  if (keep.some((id) => !own.has(id))) throw badRequest('العنوان لا يخص هذا العميل.')
  await db.query(
    'DELETE FROM client_addresses WHERE client_id = $1 AND NOT (id = ANY($2::int[]))',
    [clientId, keep]
  )
  // Clear the default first: only one default is allowed at any moment (unique index).
  await db.query('UPDATE client_addresses SET is_default = false WHERE client_id = $1', [clientId])
  for (const a of list) {
    if (a.id !== undefined)
      await db.query(
        `UPDATE client_addresses SET label = $3, address = $4, details = $5, is_default = $6,
                updated_at = LOCALTIMESTAMP(0) WHERE id = $1 AND client_id = $2`,
        [a.id, clientId, a.label, a.address, a.details, a.isDefault]
      )
    else
      await db.query(
        `INSERT INTO client_addresses (client_id, label, address, details, is_default)
         VALUES ($1, $2, $3, $4, $5)`,
        [clientId, a.label, a.address, a.details, a.isDefault]
      )
  }
  const def = list.find((a) => a.isDefault)
  await db.query('UPDATE clients SET address = $2 WHERE id = $1', [
    clientId,
    def ? def.address : ''
  ])
}

/** Validated addresses of a customer body: `addresses`, or the legacy single `address`. */
async function bodyAddresses(db, c) {
  if (Array.isArray(c.addresses)) {
    const { addresses, error } = (await addressRules()).normalizeAddresses(c.addresses)
    if (error) throw badRequest(error)
    return addresses
  }
  if (c.address === undefined) return undefined // not part of this request: keep as they are
  // Older clients send one address: it replaces the default and keeps the others.
  const others = c.id
    ? (
        await db.query(
          'SELECT id, label, address, details FROM client_addresses WHERE client_id = $1 AND NOT is_default ORDER BY id',
          [c.id]
        )
      ).rows
    : []
  const list = [
    ...(String(c.address || '').trim()
      ? [{ label: 'other', address: c.address, isDefault: true }]
      : []),
    ...others.map((o) => ({ ...o, isDefault: false }))
  ]
  const { addresses, error } = (await addressRules()).normalizeAddresses(list)
  if (error) throw badRequest(error)
  return addresses
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
    address: { type: ['string', 'null'], maxLength: 300 },
    // Up to three delivery addresses (also enforced by the database), one default.
    addresses: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          label: { type: 'string', enum: ['home', 'work', 'other'] },
          address: { type: 'string', maxLength: 300 },
          details: { type: ['string', 'null'], maxLength: 200 },
          isDefault: { type: 'boolean' }
        }
      }
    }
  }
}

const ADDRESSES = `COALESCE((SELECT json_agg(json_build_object('id', a.id, 'label', a.label, 'address', a.address,
  'details', a.details, 'isDefault', a.is_default) ORDER BY a.is_default DESC, a.id)
  FROM client_addresses a WHERE a.client_id = c.id), '[]'::json)`

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
        (
          await db.query(`SELECT c.*, ${ADDRESSES} AS addresses FROM clients c WHERE c.id = $1`, [
            clientId
          ])
        ).rows[0] || null
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
        const addresses = await bodyAddresses(db, { ...c, id: undefined })
        await assertPhonesFree(db, [phone, phone2])
        const r = await db.query(
          `INSERT INTO clients (name, phone, phone2, address, debt_balance, points, created_at) VALUES ($1, $2, $3, '', 0, 0, LOCALTIMESTAMP(0)) RETURNING *`,
          [c.name.trim(), phone, phone2]
        )
        if (addresses && addresses.length) await saveAddresses(db, r.rows[0].id, addresses)
        await ctx.audit(db, 'client_create', `إضافة العميل "${c.name}"`)
        return (
          await db.query(`SELECT c.*, ${ADDRESSES} AS addresses FROM clients c WHERE c.id = $1`, [
            r.rows[0].id
          ])
        ).rows[0]
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
          'UPDATE clients SET name = $2, phone = $3, phone2 = $4 WHERE id = $1 RETURNING *',
          [c.id, c.name.trim(), phone, phone2]
        )
        if (!r.rowCount) throw notFound('العميل غير موجود.')
        const addresses = await bodyAddresses(db, c)
        if (addresses !== undefined) await saveAddresses(db, c.id, addresses)
        await ctx.audit(db, 'client_update', `تعديل بيانات العميل "${c.name}"`)
        return (
          await db.query(`SELECT c.*, ${ADDRESSES} AS addresses FROM clients c WHERE c.id = $1`, [
            c.id
          ])
        ).rows[0]
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
        currentShiftId: { type: ['integer', 'null'] },
        // 1.5.0 (CUST-02): into the user's shift (any of the four methods) or, for treasury
        // managers, straight into the treasury (cash) without a shift.
        destination: { type: 'string', enum: ['shift', 'treasury'] },
        method: { type: 'string', enum: METHODS },
        clientRef: { type: 'string', minLength: 8, maxLength: 120 }
      }
    },
    handler: async (
      ctx,
      { clientId, amount, currentShiftId, destination, method = 'cash', clientRef }
    ) =>
      ctx.tx(async (db) => {
        const c = (await db.query('SELECT * FROM clients WHERE id = $1 FOR UPDATE', [clientId]))
          .rows[0]
        if (!c) throw notFound('العميل غير موجود.')
        // A retried collection (same request id) is recorded once (D-064).
        if (clientRef && (await recorded(db, `client-pay:${clientRef}`)))
          return (await db.query('SELECT * FROM clients WHERE id = $1', [clientId])).rows[0]
        const dest = await treasury.resolveDestination(db, ctx, { destination, currentShiftId })
        if (dest.destination === 'treasury') {
          const entry = await treasury.post(db, ctx, {
            kind: 'customer_payment',
            method,
            amount,
            refType: 'client',
            refId: c.id,
            description: `تحصيل من العميل: ${c.name}`,
            idemKey: clientRef ? `client-pay:${clientRef}` : null
          })
          if (entry.duplicate)
            return (await db.query('SELECT * FROM clients WHERE id = $1', [clientId])).rows[0]
        }
        if (Number(c.debt_balance) <= 0) throw badRequest('العميل ليس لديه مديونية مستحقة!')
        await db.query('UPDATE clients SET debt_balance = debt_balance - $1 WHERE id = $2', [
          amount,
          clientId
        ])
        await db.query(
          `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES ($1, 'payment', $2, $3, LOCALTIMESTAMP(0))`,
          [
            clientId,
            amount,
            dest.destination === 'treasury'
              ? 'سداد نقدي من العميل (الخزنة)'
              : method === 'cash'
                ? 'سداد نقدي من العميل'
                : `سداد من العميل (${method})`
          ]
        )
        if (dest.destination === 'shift') {
          await addMovement(db, {
            shiftId: dest.shift.id,
            type: 'inflow',
            amount,
            description: `سداد دين العميل: ${c.name}`,
            method,
            kind: 'customer_payment',
            clientRef: clientRef ? `client-pay:${clientRef}` : null
          })
        }
        await ctx.audit(
          db,
          'client_payment',
          `سداد ${amount.toFixed(2)} ج.م من العميل "${c.name}"${dest.destination === 'treasury' ? ' إلى الخزنة' : ''}`
        )
        return (await db.query('SELECT * FROM clients WHERE id = $1', [clientId])).rows[0]
      })
  })
}

module.exports.helpers = { ADDRESSES, saveAddresses, addressRules }
