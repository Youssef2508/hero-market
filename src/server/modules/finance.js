'use strict'
// Suppliers & purchases, cheques, expenses, damaged goods (useSuppliersManager, useChecksManager,
// useExpensesManager, useDamagedGoodsManager). Legacy amounts and ledger texts are unchanged.
const { badRequest, conflict, notFound } = require('../errors')

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`)
const str = (max) => ({ type: ['string', 'null'], maxLength: max })

/** The actor's own open shift (cash movements need one: safe_ledger.shift_id is required). */
async function ownOpenShift(db, ctx, shiftId) {
  if (!shiftId) return null
  return (
    (
      await db.query("SELECT * FROM shifts WHERE id = $1 AND user_id = $2 AND status = 'open'", [
        shiftId,
        ctx.user.id
      ])
    ).rows[0] || null
  )
}

module.exports = function financeModule(app) {
  // ── Suppliers ──────────────────────────────────────────────
  app.operation({
    name: 'suppliers.list',
    anyPermission: ['suppliers.view', 'suppliers.manage'],
    schema: { type: 'object', properties: { search: { type: 'string', maxLength: 100 } } },
    handler: async (ctx, { search = '' }) =>
      (
        await ctx.pool.query(
          search
            ? `SELECT * FROM suppliers WHERE name ILIKE '%' || $1 || '%' ESCAPE '\\' OR phone ILIKE '%' || $1 || '%' ESCAPE '\\' ORDER BY name ASC, id`
            : 'SELECT * FROM suppliers ORDER BY name ASC, id',
          search ? [likeEscape(search)] : []
        )
      ).rows
  })

  app.operation({
    name: 'suppliers.profile',
    anyPermission: ['suppliers.view', 'suppliers.manage'],
    schema: {
      type: 'object',
      required: ['supplierId'],
      properties: { supplierId: { type: 'integer' } }
    },
    handler: async (ctx, { supplierId }) => ({
      supplier:
        (await ctx.pool.query('SELECT * FROM suppliers WHERE id = $1', [supplierId])).rows[0] ||
        null,
      ledger: (
        await ctx.pool.query(
          'SELECT * FROM supplier_ledger WHERE supplier_id = $1 ORDER BY id DESC LIMIT 50',
          [supplierId]
        )
      ).rows,
      purchases: (
        await ctx.pool.query(
          'SELECT * FROM supplier_purchases WHERE supplier_id = $1 ORDER BY id DESC',
          [supplierId]
        )
      ).rows
    })
  })

  app.operation({
    name: 'suppliers.create',
    permission: 'suppliers.manage',
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        phone: str(40),
        address: str(300),
        contact_person: str(120)
      }
    },
    handler: async (ctx, s) =>
      ctx.tx(async (db) => {
        const r = await db.query(
          `INSERT INTO suppliers (name, phone, address, contact_person, debt_balance, created_at)
           VALUES ($1, $2, $3, $4, 0, LOCALTIMESTAMP(0)) RETURNING *`,
          [s.name, s.phone || '', s.address || '', s.contact_person || '']
        )
        await ctx.audit(db, 'supplier_create', `إضافة المورد "${s.name}"`)
        return r.rows[0]
      })
  })

  app.operation({
    name: 'suppliers.addPurchase',
    permission: 'suppliers.manage',
    schema: {
      type: 'object',
      required: ['supplierId', 'total_amount'],
      properties: {
        supplierId: { type: 'integer' },
        invoice_ref: str(80),
        total_amount: { type: 'number', exclusiveMinimum: 0 },
        paid_amount: { type: 'number', minimum: 0 },
        payment_type: str(40),
        notes: str(1000),
        currentShiftId: { type: ['integer', 'null'] }
      }
    },
    handler: async (ctx, p) =>
      ctx.tx(async (db) => {
        const s = (
          await db.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [p.supplierId])
        ).rows[0]
        if (!s) throw notFound('المورد غير موجود.')
        const total = p.total_amount
        const paid = p.paid_amount || 0
        const remaining = total - paid
        const ref = p.invoice_ref || ''
        const shift = await ownOpenShift(db, ctx, p.currentShiftId)
        if (paid > 0 && !shift) throw conflict('يجب فتح وردية لتسجيل المبلغ المدفوع من الخزينة.')
        await db.query(
          `INSERT INTO supplier_purchases (supplier_id, invoice_ref, total_amount, paid_amount, remaining, payment_type, timestamp, notes)
           VALUES ($1, $2, $3, $4, $5, $6, LOCALTIMESTAMP(0), $7)`,
          [s.id, ref, total, paid, remaining, p.payment_type || 'آجل', p.notes || '']
        )
        if (remaining > 0) {
          await db.query('UPDATE suppliers SET debt_balance = debt_balance + $1 WHERE id = $2', [
            remaining,
            s.id
          ])
          await db.query(
            `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, 'purchase', $2, $3, LOCALTIMESTAMP(0))`,
            [s.id, remaining, `فاتورة شراء #${ref} - متبقي آجل`]
          )
        }
        if (paid > 0) {
          await db.query(
            `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES ($1, 'outflow', $2, $3, LOCALTIMESTAMP(0))`,
            [shift.id, paid, `دفعة لمورد: ${s.name} - فاتورة #${ref}`]
          )
        }
        await ctx.audit(
          db,
          'supplier_purchase',
          `فاتورة شراء #${ref} من "${s.name}" بقيمة ${total.toFixed(2)} ج.م`
        )
        return (await db.query('SELECT * FROM suppliers WHERE id = $1', [s.id])).rows[0]
      })
  })

  app.operation({
    name: 'suppliers.repay',
    permission: 'suppliers.manage',
    schema: {
      type: 'object',
      required: ['supplierId', 'amount'],
      properties: {
        supplierId: { type: 'integer' },
        amount: { type: 'number', exclusiveMinimum: 0 },
        currentShiftId: { type: ['integer', 'null'] }
      }
    },
    handler: async (ctx, { supplierId, amount, currentShiftId }) =>
      ctx.tx(async (db) => {
        const s = (await db.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]))
          .rows[0]
        if (!s) throw notFound('المورد غير موجود.')
        await db.query('UPDATE suppliers SET debt_balance = debt_balance - $1 WHERE id = $2', [
          amount,
          s.id
        ])
        await db.query(
          `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, 'payment', $2, 'دفعة سداد للمورد', LOCALTIMESTAMP(0))`,
          [s.id, amount]
        )
        // Legacy rule: the drawer outflow is recorded only when there is an open shift.
        const shift = await ownOpenShift(db, ctx, currentShiftId)
        if (shift) {
          await db.query(
            `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES ($1, 'outflow', $2, $3, LOCALTIMESTAMP(0))`,
            [shift.id, amount, `سداد دين مورد: ${s.name}`]
          )
        }
        await ctx.audit(db, 'supplier_payment', `سداد ${amount.toFixed(2)} ج.م للمورد "${s.name}"`)
        return (await db.query('SELECT * FROM suppliers WHERE id = $1', [s.id])).rows[0]
      })
  })

  app.operation({
    name: 'suppliers.delete',
    permission: 'suppliers.manage',
    schema: {
      type: 'object',
      required: ['supplierId'],
      properties: { supplierId: { type: 'integer' } }
    },
    handler: async (ctx, { supplierId }) =>
      ctx.tx(async (db) => {
        const s = (await db.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]))
          .rows[0]
        if (!s) throw notFound('المورد غير موجود.')
        // Legacy behaviour: the supplier is removed together with its ledger and purchases.
        const ledger = await db.query('DELETE FROM supplier_ledger WHERE supplier_id = $1', [
          supplierId
        ])
        const purchases = await db.query('DELETE FROM supplier_purchases WHERE supplier_id = $1', [
          supplierId
        ])
        await db.query('DELETE FROM suppliers WHERE id = $1', [supplierId])
        await ctx.audit(
          db,
          'supplier_delete',
          `حذف المورد "${s.name}" مع ${ledger.rowCount} حركة و${purchases.rowCount} فاتورة شراء`,
          {
            supplier: s
          }
        )
      })
  })

  // ── Cheques ────────────────────────────────────────────────
  app.operation({
    name: 'checks.list',
    permission: 'checks.manage',
    handler: async (ctx) => ({
      all: (await ctx.pool.query('SELECT * FROM checks_register ORDER BY due_date ASC, id')).rows,
      // K-27: "today" is the store's local date (was the UTC date).
      dueToday: (
        await ctx.pool.query(
          "SELECT * FROM checks_register WHERE status = 'غير مسدد' AND due_date = CURRENT_DATE ORDER BY due_date ASC, id"
        )
      ).rows
    })
  })

  app.operation({
    name: 'checks.create',
    permission: 'checks.manage',
    schema: {
      type: 'object',
      required: ['check_type', 'party_name', 'due_date', 'amount'],
      properties: {
        check_type: { type: 'string', maxLength: 40 },
        check_number: str(80),
        bank_name: str(120),
        party_name: { type: 'string', minLength: 1, maxLength: 120 },
        issue_date: { type: ['string', 'null'], pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' },
        due_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        amount: { type: 'number', minimum: 0 },
        notes: str(1000)
      }
    },
    handler: async (ctx, c) =>
      ctx.tx(async (db) => {
        await db.query(
          `INSERT INTO checks_register (check_type, check_number, bank_name, party_name, issue_date, due_date, amount, status, notes, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'غير مسدد', $8, LOCALTIMESTAMP(0))`,
          [
            c.check_type,
            c.check_number || '',
            c.bank_name || '',
            c.party_name,
            c.issue_date || null,
            c.due_date,
            c.amount,
            c.notes || ''
          ]
        )
        await ctx.audit(
          db,
          'check_create',
          `تسجيل شيك ${c.check_type} باسم "${c.party_name}" بقيمة ${Number(c.amount).toFixed(2)} ج.م`
        )
      })
  })

  app.operation({
    name: 'checks.markPaid',
    permission: 'checks.manage',
    schema: { type: 'object', required: ['checkId'], properties: { checkId: { type: 'integer' } } },
    handler: async (ctx, { checkId }) =>
      ctx.tx(async (db) => {
        const r = await db.query(
          "UPDATE checks_register SET status = 'مسدد' WHERE id = $1 RETURNING party_name",
          [checkId]
        )
        if (!r.rowCount) throw notFound()
        await ctx.audit(db, 'check_paid', `تسديد شيك "${r.rows[0].party_name}" #${checkId}`)
      })
  })

  app.operation({
    name: 'checks.delete',
    permission: 'checks.manage',
    schema: { type: 'object', required: ['checkId'], properties: { checkId: { type: 'integer' } } },
    handler: async (ctx, { checkId }) =>
      ctx.tx(async (db) => {
        const r = await db.query('DELETE FROM checks_register WHERE id = $1 RETURNING *', [checkId])
        if (!r.rowCount) throw notFound()
        await ctx.audit(db, 'check_delete', `حذف شيك "${r.rows[0].party_name}" #${checkId}`, {
          check: r.rows[0]
        })
      })
  })

  // ── Expenses ───────────────────────────────────────────────
  app.operation({
    name: 'expenses.list',
    permission: 'expenses.manage',
    handler: async (ctx) => (await ctx.pool.query('SELECT * FROM expenses ORDER BY id DESC')).rows
  })

  app.operation({
    name: 'expenses.create',
    permission: 'expenses.manage',
    schema: {
      type: 'object',
      required: ['amount', 'description'],
      properties: {
        amount: { type: 'number', exclusiveMinimum: 0 },
        category: str(80),
        description: { type: 'string', minLength: 1, maxLength: 1000 },
        currentShiftId: { type: ['integer', 'null'] }
      }
    },
    handler: async (ctx, e) =>
      ctx.tx(async (db) => {
        const shift = await ownOpenShift(db, ctx, e.currentShiftId)
        if (!shift) throw conflict('يجب فتح وردية لتسجيل المصروف وخصمه من الخزنة.')
        const category = e.category || 'عام'
        await db.query(
          `INSERT INTO expenses (shift_id, amount, category, description, timestamp) VALUES ($1, $2, $3, $4, LOCALTIMESTAMP(0))`,
          [shift.id, e.amount, category, e.description]
        )
        await db.query(
          `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES ($1, 'outflow', $2, $3, LOCALTIMESTAMP(0))`,
          [shift.id, e.amount, `مصروفات - تصنيف: ${category} - ${e.description}`]
        )
        await ctx.audit(
          db,
          'expense_create',
          `تسجيل مصروف ${e.amount.toFixed(2)} ج.م (${category})`
        )
      })
  })

  app.operation({
    name: 'expenses.delete',
    permission: 'expenses.manage',
    schema: {
      type: 'object',
      required: ['expenseId'],
      properties: { expenseId: { type: 'integer' } }
    },
    handler: async (ctx, { expenseId }) =>
      ctx.tx(async (db) => {
        const x = (await db.query('DELETE FROM expenses WHERE id = $1 RETURNING *', [expenseId]))
          .rows[0]
        if (!x) throw notFound()
        // Reverse the matching drawer outflow – exactly one row (K-28: the legacy query removed every identical row).
        await db.query(
          `DELETE FROM safe_ledger WHERE ctid = (
             SELECT ctid FROM safe_ledger WHERE shift_id IS NOT DISTINCT FROM $1 AND type = 'outflow' AND amount = $2 AND description = $3
             ORDER BY id DESC LIMIT 1)`,
          [x.shift_id, x.amount, `مصروفات - تصنيف: ${x.category} - ${x.description}`]
        )
        await ctx.audit(
          db,
          'expense_delete',
          `حذف مصروف ${Number(x.amount).toFixed(2)} ج.م (${x.category})`,
          { expense: x }
        )
      })
  })

  // ── Damaged goods ──────────────────────────────────────────
  app.operation({
    name: 'damaged.list',
    permission: 'inventory.damaged',
    handler: async (ctx) =>
      (
        await ctx.pool.query(
          'SELECT dg.*, p.name AS product_name, p.unit FROM damaged_goods dg JOIN products p ON dg.product_barcode = p.barcode ORDER BY dg.id DESC'
        )
      ).rows
  })

  app.operation({
    name: 'damaged.create',
    permission: 'inventory.damaged',
    schema: {
      type: 'object',
      required: ['barcode', 'quantity'],
      properties: {
        barcode: { type: 'string', minLength: 1, maxLength: 64 },
        quantity: { type: 'number', exclusiveMinimum: 0 },
        reason: str(80),
        currentShiftId: { type: ['integer', 'null'] }
      }
    },
    handler: async (ctx, d) =>
      ctx.tx(async (db) => {
        const barcode = d.barcode.trim()
        const p = (
          await db.query(
            'SELECT name, stock_qty, cost_price FROM products WHERE barcode = $1 FOR UPDATE',
            [barcode]
          )
        ).rows[0]
        if (!p) throw notFound('لم يتم العثور على هذا المنتج في المخزن!')
        if (Number(p.stock_qty) < d.quantity) {
          throw badRequest(
            `الكمية التالفة المدخلة (${d.quantity}) أكبر من المخزون المتوفر حالياً (${p.stock_qty})!`
          )
        }
        const shift = await ownOpenShift(db, ctx, d.currentShiftId)
        await db.query('UPDATE products SET stock_qty = stock_qty - $1 WHERE barcode = $2', [
          d.quantity,
          barcode
        ])
        await db.query(
          `INSERT INTO damaged_goods (shift_id, product_barcode, quantity, reason, cost_price, timestamp) VALUES ($1, $2, $3, $4, $5, LOCALTIMESTAMP(0))`,
          [shift ? shift.id : null, barcode, d.quantity, d.reason || '', Number(p.cost_price) || 0]
        )
        await ctx.audit(
          db,
          'damaged_create',
          `تسجيل هالك ${d.quantity} من "${p.name}" (${d.reason || ''})`
        )
      })
  })

  app.operation({
    name: 'damaged.delete',
    permission: 'inventory.damaged',
    schema: {
      type: 'object',
      required: ['damagedId'],
      properties: { damagedId: { type: 'integer' } }
    },
    handler: async (ctx, { damagedId }) =>
      ctx.tx(async (db) => {
        const r = (
          await db.query('DELETE FROM damaged_goods WHERE id = $1 RETURNING *', [damagedId])
        ).rows[0]
        if (!r) throw notFound()
        await db.query('UPDATE products SET stock_qty = stock_qty + $1 WHERE barcode = $2', [
          r.quantity,
          r.product_barcode
        ])
        await ctx.audit(
          db,
          'damaged_delete',
          `إلغاء سجل هالك #${damagedId} وإرجاع ${r.quantity} للمخزن`
        )
      })
  })
}
