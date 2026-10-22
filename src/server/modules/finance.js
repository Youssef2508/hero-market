'use strict'
// Suppliers & purchases, cheques, expenses, damaged goods (useSuppliersManager, useChecksManager,
// useExpensesManager, useDamagedGoodsManager). Legacy amounts and ledger texts are unchanged.
const { badRequest, conflict, notFound, shiftRequired, forbidden } = require('../errors')
const treasury = require('../money/treasury')
const { addMovement, recorded } = require('../money/shiftLedger')
const { METHODS } = require('../money/methods')
const { postMovement, receiveStock } = require('../inventory/stock')
const { loadUnit, toBaseQty, round4, kindRule } = require('../inventory/units')

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`)
const str = (max) => ({ type: ['string', 'null'], maxLength: max })

// Prices a purchase line may set on its product (D-068): request key, products column, label.
const NEW_PRICES = [
  { key: 'newRetailPrice', column: 'retail_price', label: 'سعر البيع' },
  { key: 'newWholesalePrice', column: 'wholesale_price', label: 'سعر الجملة' }
]

/** A supplier's contact fields, trimmed and checked (SUP-03). */
function supplierContact(b) {
  const t = (v) => String(v ?? '').trim()
  const c = {
    name: t(b.name),
    phone: t(b.phone),
    address: t(b.address),
    contact_person: t(b.contact_person)
  }
  if (!c.name) throw badRequest('اسم المورد مطلوب.')
  if (c.phone && !/^[0-9+\-\s()/]{3,40}$/.test(c.phone))
    throw badRequest('رقم الهاتف يحتوي على حروف غير مسموحة.')
  return c
}

const balanceText = (n) =>
  n === 0
    ? 'لا شيء'
    : n > 0
      ? `${n.toFixed(2)} ج.م مستحقة للمورد`
      : `${(-n).toFixed(2)} ج.م مستحقة على المورد`

/**
 * Bring a supplier's opening balance to `target` (+ owed to the supplier, − owed by it): one
 * 'opening' ledger line for the difference, in the caller's transaction. Same target = nothing.
 */
async function setOpening(db, ctx, s, target) {
  const current = round2(
    (
      await db.query(
        "SELECT COALESCE(SUM(amount), 0) AS v FROM supplier_ledger WHERE supplier_id = $1 AND type = 'opening'",
        [s.id]
      )
    ).rows[0].v
  )
  const delta = round2(target - current)
  if (!delta) return
  await db.query('UPDATE suppliers SET debt_balance = debt_balance + $1 WHERE id = $2', [
    delta,
    s.id
  ])
  await db.query(
    `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, 'opening', $2, $3, LOCALTIMESTAMP(0))`,
    [
      s.id,
      delta,
      current === 0
        ? 'رصيد افتتاحي'
        : `تعديل الرصيد الافتتاحي: من ${current.toFixed(2)} إلى ${target.toFixed(2)}`
    ]
  )
  await ctx.audit(
    db,
    'supplier_opening',
    `الرصيد الافتتاحي للمورد "${s.name}": ${balanceText(current)} ← ${balanceText(target)}`,
    { supplierId: s.id, from: current, to: target }
  )
}

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

/**
 * Record a supplier invoice and receive its lines into stock (K-38), in the caller's transaction.
 * `drawer: false` (owner commands from the cloud): any paid amount was paid outside the drawer,
 * so no shift is needed and no drawer movement is written.
 */
// `payable: false` (a preliminary invoice converted, D-064): the payment and the supplier's payable
// were recorded with the preliminary invoice; only stock, cost and the purchase record are written.
async function recordPurchase(db, ctx, p, { drawer = true, payable = true } = {}) {
  const s = (await db.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [p.supplierId]))
    .rows[0]
  if (!s) throw notFound('المورد غير موجود.')
  // total_amount is what the invoice is owed for: its lines' value (gross) less an optional
  // invoice-level discount (SUP-02, D-066). The lines keep their prices, so product costs are not
  // changed by the discount; reports count it as a purchase gain.
  const total = p.total_amount
  const discount = round2(p.discount || 0)
  const gross = round2(total + discount)
  const paid = p.paid_amount || 0
  const remaining = total - paid
  const ref = p.invoice_ref || ''
  // A remote invoice (owner command) never touches the drawer: the owner paid outside it.
  const shift = drawer ? await ownOpenShift(db, ctx, p.currentShiftId) : null
  if (drawer && paid > 0 && !shift)
    throw shiftRequired('يجب فتح وردية لتسجيل المبلغ المدفوع من الخزينة.')
  const items = (p.items || []).map((i) => ({
    barcode: i.barcode.trim(),
    unitId: i.unitId ?? null,
    qty: Number(i.qty),
    unitCost: Number(i.unitCost),
    lineTotal: round2(Number(i.qty) * Number(i.unitCost)),
    // New selling and wholesale prices for the product's base unit (D-068); empty = keep.
    ...Object.fromEntries(
      NEW_PRICES.map(({ key }) => [
        key,
        i[key] === null || i[key] === undefined || i[key] === '' ? null : round2(i[key])
      ])
    )
  }))
  if (items.length) {
    const sum = round2(items.reduce((a, i) => a + i.lineTotal, 0))
    if (Math.abs(sum - gross) > 0.005)
      throw badRequest(
        discount > 0
          ? `إجمالي الأصناف (${sum.toFixed(2)}) − الخصم (${discount.toFixed(2)}) لا يساوي صافي الفاتورة (${Number(total).toFixed(2)}).`
          : `إجمالي الأصناف (${sum.toFixed(2)}) لا يساوي قيمة الفاتورة (${Number(total).toFixed(2)}).`
      )
    if (new Set(items.map((i) => `${i.barcode}|${i.unitId ?? ''}`)).size !== items.length)
      throw badRequest('الصنف مكرر في فاتورة الشراء.')
    // One product bought in two units (pieces and boxes) may carry one new price of each kind.
    for (const { key, label } of NEW_PRICES) {
      const prices = new Map()
      for (const i of items.filter((x) => x[key] !== null)) {
        if (prices.has(i.barcode) && prices.get(i.barcode) !== i[key])
          throw badRequest(`سعران مختلفان (${label}) للصنف (${i.barcode}) في نفس الفاتورة.`)
        prices.set(i.barcode, i[key])
      }
    }
    const known = new Set(
      (
        await db.query('SELECT barcode FROM products WHERE barcode = ANY($1::text[])', [
          items.map((i) => i.barcode)
        ])
      ).rows.map((r) => r.barcode)
    )
    const missing = items.find((i) => !known.has(i.barcode))
    if (missing) throw notFound(`الصنف (${missing.barcode}) غير مسجل.`)
  }
  if (paid > total + 0.005)
    throw badRequest(
      `المدفوع (${Number(paid).toFixed(2)}) أكبر من صافي الفاتورة (${Number(total).toFixed(2)}).`
    )
  const purchaseId = (
    await db.query(
      `INSERT INTO supplier_purchases (supplier_id, invoice_ref, total_amount, paid_amount, remaining, payment_type, timestamp, notes, gross_amount, discount)
         VALUES ($1, $2, $3, $4, $5, $6, LOCALTIMESTAMP(0), $7, $8, $9) RETURNING id`,
      [s.id, ref, total, paid, remaining, p.payment_type || 'آجل', p.notes || '', gross, discount]
    )
  ).rows[0].id
  // Lock the products in a stable order (concurrent sales lock the same rows).
  const priceChanges = new Map()
  for (const i of [...items].sort((a, b) => (a.barcode < b.barcode ? -1 : 1))) {
    const product = (await db.query('SELECT * FROM products WHERE barcode = $1', [i.barcode]))
      .rows[0]
    for (const { key, column } of NEW_PRICES)
      if (i[key] !== null && !priceChanges.has(`${i.barcode}|${column}`))
        priceChanges.set(`${i.barcode}|${column}`, {
          barcode: i.barcode,
          column,
          name: product.name,
          from: Number(product[column]) || 0,
          to: i[key]
        })
    const old = (column, key) =>
      i[key] === null ? null : priceChanges.get(`${i.barcode}|${column}`).from
    const unit = await loadUnit(db, product, i.unitId, { purpose: 'buy' })
    const { baseQty } = toBaseQty(
      await kindRule(db, product.unit_kind),
      i.qty,
      unit.factor,
      product.name
    )
    await db.query(
      `INSERT INTO supplier_purchase_items (purchase_id, product_barcode, qty, unit_cost, line_total, unit_id, unit_name, unit_factor,
                                          new_retail_price, old_retail_price, new_wholesale_price, old_wholesale_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        purchaseId,
        i.barcode,
        i.qty,
        i.unitCost,
        i.lineTotal,
        unit.id,
        unit.id === null ? product.unit || null : unit.name,
        unit.factor,
        i.newRetailPrice,
        old('retail_price', 'newRetailPrice'),
        i.newWholesalePrice,
        old('wholesale_price', 'newWholesalePrice')
      ]
    )
    // Stock and the moving average work per base unit.
    await receiveStock(db, ctx, {
      barcode: i.barcode,
      qty: baseQty,
      unitCost: round4(i.unitCost / unit.factor),
      refType: 'purchase',
      refId: purchaseId,
      reason: `فاتورة شراء #${ref} من ${s.name}`
    })
  }
  if (payable && remaining > 0) {
    await db.query('UPDATE suppliers SET debt_balance = debt_balance + $1 WHERE id = $2', [
      remaining,
      s.id
    ])
    await db.query(
      `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, 'purchase', $2, $3, LOCALTIMESTAMP(0))`,
      [s.id, remaining, `فاتورة شراء #${ref} - متبقي آجل`]
    )
  }
  if (drawer && paid > 0) {
    await addMovement(db, {
      shiftId: shift.id,
      type: 'outflow',
      amount: paid,
      description: `دفعة لمورد: ${s.name} - فاتورة #${ref}`,
      kind: 'supplier_payment'
    })
  }
  // New prices (D-068), in the purchase's transaction: the base unit's selling and wholesale
  // prices only, each when its own field was filled; package prices are left as they are. Each
  // change is in the activity log.
  for (const c of priceChanges.values()) {
    if (c.from === c.to) continue
    // column comes from NEW_PRICES, never from the request.
    await db.query(`UPDATE products SET ${c.column} = $2 WHERE barcode = $1`, [c.barcode, c.to])
    const label = NEW_PRICES.find((x) => x.column === c.column).label
    await ctx.audit(
      db,
      'product_price_change',
      `${label} "${c.name}" (${c.barcode}): ${c.from.toFixed(2)} ← ${c.to.toFixed(2)} ج.م (فاتورة شراء #${ref || purchaseId} من "${s.name}")`,
      { barcode: c.barcode, price: c.column, from: c.from, to: c.to, purchaseId }
    )
  }
  await ctx.audit(
    db,
    'supplier_purchase',
    `فاتورة شراء #${ref} من "${s.name}" بقيمة ${total.toFixed(2)} ج.م${discount > 0 ? ` (إجمالي ${gross.toFixed(2)} − خصم ${discount.toFixed(2)})` : ''}${items.length ? ` (${items.length} صنف استُلم للمخزن)` : ''}`,
    { purchaseId, gross, discount, net: total, paid }
  )
  const supplier = (await db.query('SELECT * FROM suppliers WHERE id = $1', [s.id])).rows[0]
  return { ...supplier, purchaseId, receivedItems: items.length }
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
        (
          await ctx.pool.query(
            `SELECT s.*, (SELECT COALESCE(SUM(amount), 0) FROM supplier_ledger l WHERE l.supplier_id = s.id AND l.type = 'opening')::float8 AS opening_balance
               FROM suppliers s WHERE s.id = $1`,
            [supplierId]
          )
        ).rows[0] || null,
      ledger: (
        await ctx.pool.query(
          'SELECT * FROM supplier_ledger WHERE supplier_id = $1 ORDER BY id DESC LIMIT 50',
          [supplierId]
        )
      ).rows,
      purchases: (
        await ctx.pool.query(
          `SELECT sp.*, (SELECT COUNT(*) FROM supplier_purchase_items i WHERE i.purchase_id = sp.id)::int AS item_count,
                  (SELECT COALESCE(SUM(credit_value), 0) FROM supplier_purchase_returns r WHERE r.purchase_id = sp.id)::float8 AS returned_value
             FROM supplier_purchases sp WHERE sp.supplier_id = $1 ORDER BY sp.id DESC`,
          [supplierId]
        )
      ).rows,
      // Preliminary invoices waiting for their lines (D-064).
      pending: (
        await ctx.pool.query(
          "SELECT *, total::float8 AS total, paid::float8 AS paid FROM supplier_pending_invoices WHERE supplier_id = $1 AND status = 'pending' ORDER BY id DESC",
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
        contact_person: str(120),
        // SUP-03 (D-070): + the store owes the supplier, − the supplier owes the store.
        openingBalance: { type: ['number', 'null'] }
      }
    },
    handler: async (ctx, s) =>
      ctx.tx(async (db) => {
        const c = supplierContact(s)
        const opening = round2(s.openingBalance || 0)
        if (opening && !ctx.can('suppliers.opening'))
          throw forbidden('الرصيد الافتتاحي للمورد يتطلب صلاحية.')
        const r = await db.query(
          `INSERT INTO suppliers (name, phone, address, contact_person, debt_balance, created_at)
           VALUES ($1, $2, $3, $4, 0, LOCALTIMESTAMP(0)) RETURNING *`,
          [c.name, c.phone, c.address, c.contact_person]
        )
        await ctx.audit(db, 'supplier_create', `إضافة المورد "${c.name}"`)
        if (opening) await setOpening(db, ctx, r.rows[0], opening)
        return (await db.query('SELECT * FROM suppliers WHERE id = $1', [r.rows[0].id])).rows[0]
      })
  })

  // Contact details after creation (SUP-03): never touches invoices, payments or balances.
  app.operation({
    name: 'suppliers.update',
    permission: 'suppliers.manage',
    schema: {
      type: 'object',
      required: ['supplierId', 'name'],
      properties: {
        supplierId: { type: 'integer' },
        name: { type: 'string', minLength: 1, maxLength: 120 },
        phone: str(40),
        address: str(300),
        contact_person: str(120)
      }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const s = (
          await db.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [b.supplierId])
        ).rows[0]
        if (!s) throw notFound('المورد غير موجود.')
        const c = supplierContact(b)
        const diff = {}
        for (const k of ['name', 'phone', 'address', 'contact_person'])
          if ((s[k] || '') !== c[k]) diff[k] = { from: s[k] || '', to: c[k] }
        if (!Object.keys(diff).length) return s
        await db.query(
          'UPDATE suppliers SET name = $2, phone = $3, address = $4, contact_person = $5 WHERE id = $1',
          [s.id, c.name, c.phone, c.address, c.contact_person]
        )
        await ctx.audit(db, 'supplier_update', `تعديل بيانات المورد "${c.name}"`, {
          supplierId: s.id,
          ...diff
        })
        return (await db.query('SELECT * FROM suppliers WHERE id = $1', [s.id])).rows[0]
      })
  })

  // The opening balance (SUP-03): set, or corrected, as its own ledger line – never a purchase,
  // a payment or a stock receipt. A correction adds the difference; earlier lines stay.
  app.operation({
    name: 'suppliers.setOpening',
    permission: 'suppliers.opening',
    schema: {
      type: 'object',
      required: ['supplierId', 'amount'],
      properties: { supplierId: { type: 'integer' }, amount: { type: 'number' } }
    },
    handler: async (ctx, b) =>
      ctx.tx(async (db) => {
        const s = (
          await db.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [b.supplierId])
        ).rows[0]
        if (!s) throw notFound('المورد غير موجود.')
        await setOpening(db, ctx, s, round2(b.amount))
        return (await db.query('SELECT * FROM suppliers WHERE id = $1', [s.id])).rows[0]
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
        // Net owed (lines − discount). The discount is optional and invoice-level (D-066).
        total_amount: { type: 'number', exclusiveMinimum: 0 },
        discount: { type: 'number', minimum: 0 },
        paid_amount: { type: 'number', minimum: 0 },
        payment_type: str(40),
        notes: str(1000),
        currentShiftId: { type: ['integer', 'null'] },
        // Lines received into stock (K-38). When present, their total must equal total_amount.
        items: {
          type: 'array',
          maxItems: 500,
          items: {
            type: 'object',
            required: ['barcode', 'qty', 'unitCost'],
            properties: {
              barcode: { type: 'string', minLength: 1, maxLength: 64 },
              // Purchase unit (product_units.id); omitted or null = base unit. qty and unitCost
              // are in that unit (e.g. 3 cartons at 120 each).
              unitId: { type: ['integer', 'null'] },
              qty: { type: 'number', exclusiveMinimum: 0 },
              unitCost: { type: 'number', minimum: 0 },
              // A new selling price for the product's base unit (D-068); omitted or null = unchanged.
              newRetailPrice: { type: ['number', 'null'], minimum: 0 },
              newWholesalePrice: { type: ['number', 'null'], minimum: 0 }
            }
          }
        }
      }
    },
    handler: async (ctx, p) => ctx.tx((db) => recordPurchase(db, ctx, p))
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
        currentShiftId: { type: ['integer', 'null'] },
        // 1.5.0 (CUST-02): 'treasury' pays from the treasury without a shift (treasury.manage).
        destination: { type: 'string', enum: ['shift', 'treasury'] },
        // 1.5.0 (D-064): how it was paid; a retry with the same request id pays once.
        method: { type: 'string', enum: METHODS },
        clientRef: { type: 'string', minLength: 8, maxLength: 120 }
      }
    },
    handler: async (
      ctx,
      { supplierId, amount, currentShiftId, destination, method = 'cash', clientRef }
    ) =>
      ctx.tx(async (db) => {
        const s = (await db.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]))
          .rows[0]
        if (!s) throw notFound('المورد غير موجود.')
        if (clientRef && (await recorded(db, `supplier-pay:${clientRef}`)))
          return (await db.query('SELECT * FROM suppliers WHERE id = $1', [s.id])).rows[0]
        if (
          destination === 'treasury' ||
          (!destination && !currentShiftId && ctx.can('treasury.manage'))
        ) {
          const dest = await treasury.resolveDestination(db, ctx, { destination, currentShiftId })
          if (dest.destination === 'treasury') {
            const entry = await treasury.post(db, ctx, {
              kind: 'supplier_payment',
              method,
              amount: -amount,
              refType: 'supplier',
              refId: s.id,
              description: `سداد للمورد: ${s.name}`,
              idemKey: clientRef ? `supplier-pay:${clientRef}` : null
            })
            if (entry.duplicate)
              return (await db.query('SELECT * FROM suppliers WHERE id = $1', [s.id])).rows[0]
            await db.query('UPDATE suppliers SET debt_balance = debt_balance - $1 WHERE id = $2', [
              amount,
              s.id
            ])
            await db.query(
              `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, 'payment', $2, 'دفعة سداد للمورد من الخزنة', LOCALTIMESTAMP(0))`,
              [s.id, amount]
            )
            await ctx.audit(
              db,
              'supplier_payment',
              `سداد ${amount.toFixed(2)} ج.م للمورد "${s.name}" من الخزنة`
            )
            return (await db.query('SELECT * FROM suppliers WHERE id = $1', [s.id])).rows[0]
          }
        }
        await db.query('UPDATE suppliers SET debt_balance = debt_balance - $1 WHERE id = $2', [
          amount,
          s.id
        ])
        await db.query(
          `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, 'payment', $2, 'دفعة سداد للمورد', LOCALTIMESTAMP(0))`,
          [s.id, amount]
        )
        // Legacy rule: the drawer outflow is recorded only when there is an open shift. A payment
        // that names the shift as its destination (1.5.0) needs that shift.
        const shift = await ownOpenShift(db, ctx, currentShiftId)
        if (destination === 'shift' && !shift)
          throw shiftRequired('لا توجد وردية مفتوحة لك: افتح وردية أو اختر الخزنة.')
        if (shift) {
          await addMovement(db, {
            shiftId: shift.id,
            type: 'outflow',
            amount,
            description: `سداد دين مورد: ${s.name}`,
            method,
            kind: 'supplier_settlement',
            clientRef: clientRef ? `supplier-pay:${clientRef}` : null
          })
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
        // Like customers: a supplier still owed money (or owing it) cannot disappear with its
        // ledger (audit 1.4.0).
        if (Math.abs(Number(s.debt_balance) || 0) > 0.004)
          throw conflict('لا يمكن حذف مورد لديه رصيد مالي (له أو عليه). سدّد الرصيد أولاً.')
        // Invoices that received goods are part of the stock history and cannot disappear.
        const received = await db.query(
          'SELECT 1 FROM supplier_purchase_items i JOIN supplier_purchases p ON p.id = i.purchase_id WHERE p.supplier_id = $1 LIMIT 1',
          [supplierId]
        )
        if (received.rowCount)
          throw conflict(
            'لا يمكن حذف هذا المورد لأن فواتيره أضافت أصنافاً إلى المخزون. سجل حركة المخزون يبقى مرتبطاً بها.'
          )
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

  // ── Cheques: read-only archive ─────────────────────────────
  // Cheque processing is removed (owner, 2026-10-21, D-060): nothing creates, settles or deletes a
  // cheque any more. The records stay in checks_register (and in backups); administrators may read
  // them here.
  app.operation({
    name: 'checks.archive',
    permission: 'checks.archive',
    handler: async (ctx) => ({
      rows: (
        await ctx.pool.query(
          'SELECT id, check_type, check_number, bank_name, party_name, issue_date, due_date, amount, status, notes, created_at FROM checks_register ORDER BY due_date DESC, id DESC'
        )
      ).rows
    })
  })

  // ── Expenses ───────────────────────────────────────────────
  // 1.5.0 (owner feedback EXP-01/02/03, Q2): each user sees and deletes only the expenses they
  // created; expenses.view_all (administrators) sees every one. An expense is paid from the user's
  // open shift drawer or, for treasury managers, from the treasury without a shift.
  const expenseScope = (ctx) =>
    ctx.can('expenses.view_all')
      ? { sql: '', params: [] }
      : { sql: 'WHERE x.created_by = $1', params: [ctx.user.id] }

  app.operation({
    name: 'expenses.list',
    permission: 'expenses.manage',
    handler: async (ctx) => {
      const scope = expenseScope(ctx)
      return (
        await ctx.pool.query(
          `SELECT x.*, u.username AS created_by_name FROM expenses x LEFT JOIN users u ON u.id = x.created_by
           ${scope.sql} ORDER BY x.id DESC`,
          scope.params
        )
      ).rows
    }
  })

  app.operation({
    name: 'expenses.create',
    permission: 'expenses.manage',
    schema: {
      type: 'object',
      // The note is optional (owner feedback EXP-02): amount and category are enough.
      required: ['amount'],
      properties: {
        amount: { type: 'number', exclusiveMinimum: 0 },
        category: str(80),
        categoryId: { type: ['integer', 'null'] },
        description: str(1000),
        currentShiftId: { type: ['integer', 'null'] },
        destination: { type: 'string', enum: ['shift', 'treasury'] },
        // How it was paid (D-064); cash unless stated.
        method: { type: 'string', enum: METHODS },
        clientRef: { type: 'string', minLength: 8, maxLength: 120 }
      }
    },
    handler: async (ctx, e) =>
      ctx.tx(async (db) => {
        const method = e.method || 'cash'
        if (e.clientRef) {
          const prior = await recorded(db, `expense:${e.clientRef}`)
          if (prior) {
            const x = (await db.query('SELECT id FROM expenses WHERE ledger_id = $1', [prior.id]))
              .rows[0]
            return { id: x ? x.id : null, destination: 'shift', duplicate: true }
          }
        }
        const dest = await treasury.resolveDestination(db, ctx, e)
        let category = (e.category || '').trim() || 'عام'
        let categoryId = null
        if (e.categoryId) {
          const c = (
            await db.query('SELECT * FROM expense_categories WHERE id = $1', [e.categoryId])
          ).rows[0]
          if (!c || !c.is_active) throw badRequest('تصنيف المصروف غير موجود أو موقوف.')
          category = c.name
          categoryId = c.id
        } else {
          const c = (
            await db.query(
              'SELECT id FROM expense_categories WHERE lower(btrim(name)) = lower(btrim($1))',
              [category]
            )
          ).rows[0]
          categoryId = c ? c.id : null
        }
        const note = (e.description || '').trim()
        const text = `مصروفات - تصنيف: ${category}${note ? ` - ${note}` : ''}`
        if (dest.destination === 'treasury') {
          const idemKey = e.clientRef ? `expense:${e.clientRef}` : null
          const prior = idemKey
            ? (await db.query('SELECT ref_id FROM treasury_ledger WHERE idem_key = $1', [idemKey]))
                .rows[0]
            : null
          if (prior) return { id: prior.ref_id, destination: 'treasury', duplicate: true }
          const x = (
            await db.query(
              `INSERT INTO expenses (shift_id, amount, category, description, timestamp, created_by, category_id, destination)
               VALUES (NULL, $1, $2, $3, LOCALTIMESTAMP(0), $4, $5, 'treasury') RETURNING id`,
              [e.amount, category, note, ctx.user.id, categoryId]
            )
          ).rows[0]
          const entry = await treasury.post(db, ctx, {
            kind: 'expense',
            method,
            amount: -e.amount,
            refType: 'expense',
            refId: x.id,
            description: text.slice(0, 300),
            idemKey
          })
          // The same request arriving twice at once: the second one is rolled back.
          if (entry.duplicate) throw conflict('تم تسجيل هذا المصروف بالفعل.')
          await db.query('UPDATE expenses SET treasury_entry_id = $1 WHERE id = $2', [
            entry.id,
            x.id
          ])
          await ctx.audit(
            db,
            'expense_create',
            `تسجيل مصروف من الخزنة ${e.amount.toFixed(2)} ج.م (${category})`,
            { expenseId: x.id, treasuryEntryId: entry.id }
          )
          return { id: x.id, destination: 'treasury' }
        }
        const shift = dest.shift
        const ledger = await addMovement(db, {
          shiftId: shift.id,
          type: 'outflow',
          amount: e.amount,
          description: text,
          method,
          kind: 'expense',
          clientRef: e.clientRef ? `expense:${e.clientRef}` : null
        })
        const x = (
          await db.query(
            `INSERT INTO expenses (shift_id, amount, category, description, timestamp, created_by, category_id, destination, ledger_id)
             VALUES ($1, $2, $3, $4, LOCALTIMESTAMP(0), $5, $6, 'shift', $7) RETURNING id`,
            [shift.id, e.amount, category, note, ctx.user.id, categoryId, ledger.id]
          )
        ).rows[0]
        await ctx.audit(
          db,
          'expense_create',
          `تسجيل مصروف ${e.amount.toFixed(2)} ج.م (${category})`,
          { expenseId: x.id }
        )
        return { id: x.id, destination: 'shift' }
      })
  })

  app.operation({
    name: 'expenses.delete',
    permission: 'expenses.manage',
    schema: {
      type: 'object',
      required: ['expenseId'],
      properties: { expenseId: { type: 'integer' }, reason: str(300) }
    },
    handler: async (ctx, { expenseId, reason }) =>
      ctx.tx(async (db) => {
        const x = (await db.query('SELECT * FROM expenses WHERE id = $1 FOR UPDATE', [expenseId]))
          .rows[0]
        // Another user's expense is "not found" for someone who may not see it (EXP-01).
        if (!x || (!ctx.can('expenses.view_all') && x.created_by !== ctx.user.id)) throw notFound()
        if (x.destination === 'treasury') {
          // Posted treasury money is never removed: the expense is undone by a reversal (TREAS-01).
          if (!ctx.can('treasury.manage'))
            throw forbidden('إلغاء مصروف الخزنة يتطلب صلاحية الخزنة.')
          const original = (
            await db.query('SELECT * FROM treasury_ledger WHERE id = $1', [x.treasury_entry_id])
          ).rows[0]
          if (original)
            await treasury.post(db, ctx, {
              kind: 'reversal',
              method: original.method,
              amount: -Number(original.amount),
              reversesId: original.id,
              refType: 'expense',
              refId: x.id,
              description: `عكس مصروف من الخزنة #${x.id}`,
              reason,
              idemKey: `reverse:${original.id}`
            })
          await db.query('DELETE FROM expenses WHERE id = $1', [x.id])
        } else {
          await db.query('DELETE FROM expenses WHERE id = $1', [x.id])
          if (x.ledger_id) {
            await db.query('DELETE FROM safe_ledger WHERE id = $1', [x.ledger_id])
          } else {
            // Before 1.5.0 the expense was matched to its drawer row by text – exactly one row
            // (K-28), in both text forms (with and without a note).
            await db.query(
              `DELETE FROM safe_ledger WHERE ctid = (
                 SELECT ctid FROM safe_ledger WHERE shift_id IS NOT DISTINCT FROM $1 AND type = 'outflow' AND amount = $2
                    AND description = ANY($3::text[])
                 ORDER BY id DESC LIMIT 1)`,
              [
                x.shift_id,
                x.amount,
                [
                  `مصروفات - تصنيف: ${x.category} - ${x.description || ''}`,
                  `مصروفات - تصنيف: ${x.category}${x.description ? ` - ${x.description}` : ''}`
                ]
              ]
            )
          }
        }
        await ctx.audit(
          db,
          'expense_delete',
          `حذف مصروف ${Number(x.amount).toFixed(2)} ج.م (${x.category})`,
          { expense: x, reason: reason || null }
        )
      })
  })

  // Expense categories (EXP-02): renaming keeps the name stored on older expenses; a category is
  // stopped, never deleted, so no expense loses its category.
  app.operation({
    name: 'expenseCategories.list',
    anyPermission: ['expenses.manage', 'expenses.categories'],
    handler: async (ctx) =>
      (
        await ctx.pool.query(
          `SELECT c.*, (SELECT COUNT(*)::int FROM expenses x WHERE x.category_id = c.id) AS uses
             FROM expense_categories c ORDER BY c.is_active DESC, c.sort_order, c.name`
        )
      ).rows
  })

  app.operation({
    name: 'expenseCategories.save',
    permission: 'expenses.categories',
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        id: { type: ['integer', 'null'] },
        name: { type: 'string', minLength: 1, maxLength: 60 },
        isActive: { type: 'boolean' }
      }
    },
    handler: async (ctx, c) =>
      ctx.tx(async (db) => {
        const name = c.name.trim()
        if (!name) throw badRequest('اكتب اسم التصنيف.')
        const dup = (
          await db.query(
            'SELECT id FROM expense_categories WHERE lower(btrim(name)) = lower($1) AND id IS DISTINCT FROM $2',
            [name, c.id ?? null]
          )
        ).rows[0]
        if (dup) throw conflict('يوجد تصنيف بنفس الاسم.')
        if (c.id) {
          const r = await db.query(
            `UPDATE expense_categories SET name = $2, is_active = COALESCE($3, is_active), updated_at = LOCALTIMESTAMP(0)
              WHERE id = $1 RETURNING *`,
            [c.id, name, c.isActive ?? null]
          )
          if (!r.rowCount) throw notFound()
          await ctx.audit(db, 'expense_category_save', `تعديل تصنيف مصروفات "${name}"`)
          return r.rows[0]
        }
        const r = await db.query(
          `INSERT INTO expense_categories (name, sort_order, is_active)
           VALUES ($1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM expense_categories), COALESCE($2, true)) RETURNING *`,
          [name, c.isActive ?? null]
        )
        await ctx.audit(db, 'expense_category_save', `إضافة تصنيف مصروفات "${name}"`)
        return r.rows[0]
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
            'SELECT name, stock_qty, cost_price, unit_kind FROM products WHERE barcode = $1 FOR UPDATE',
            [barcode]
          )
        ).rows[0]
        if (!p) throw notFound('لم يتم العثور على هذا المنتج في المخزن!')
        // Damaged goods are recorded in the base unit (whole pieces, or kg/l with 3 decimals).
        toBaseQty(await kindRule(db, p.unit_kind), d.quantity, 1, p.name)
        // Negative stock is allowed (owner decision); the negative-stock report shows the result.
        const shift = await ownOpenShift(db, ctx, d.currentShiftId)
        const damagedId = (
          await db.query(
            `INSERT INTO damaged_goods (shift_id, product_barcode, quantity, reason, cost_price, timestamp) VALUES ($1, $2, $3, $4, $5, LOCALTIMESTAMP(0)) RETURNING id`,
            [
              shift ? shift.id : null,
              barcode,
              d.quantity,
              d.reason || '',
              Number(p.cost_price) || 0
            ]
          )
        ).rows[0].id
        await postMovement(db, ctx, {
          barcode,
          qty: -d.quantity,
          kind: 'damaged',
          refType: 'damaged',
          refId: damagedId,
          reason: d.reason || ''
        })
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
        await postMovement(db, ctx, {
          barcode: r.product_barcode,
          qty: Number(r.quantity),
          kind: 'damaged_reversal',
          refType: 'damaged',
          refId: damagedId
        })
        await ctx.audit(
          db,
          'damaged_delete',
          `إلغاء سجل هالك #${damagedId} وإرجاع ${r.quantity} للمخزن`
        )
      })
  })
}

module.exports.helpers = { recordPurchase }
