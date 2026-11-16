'use strict'
// Purchase invoices: the list of every supplier's invoices, and correcting a recorded invoice
// (owner, 1.8.0, D-112).
//
// A recorded invoice already moved stock, the purchase price and the supplier's balance. When what
// was delivered turns out different – a product recorded instead of another, a missing or extra
// product, a wrong quantity, price or discount – the owner corrects the invoice itself:
//   * The invoice and its lines always show the corrected values; every correction is kept as a
//     revision with the lines before and after, the totals, and everything it moved.
//   * Stock: per product, the difference between the lines as they were and as they are now is
//     posted as a 'purchase_correction' movement on top of the history. The original receipt, the
//     sales since and every other movement stay as they were (stock may go below zero, D-041).
//   * Purchase price (the latest purchase price, D-087): a product takes the corrected price only
//     when this invoice is still its latest purchase and set its current price; otherwise it is
//     kept and the preview says why. Past sales keep the cost recorded on their lines (D-087): the
//     units sold since the invoice are shown, never re-costed.
//   * Supplier: the payable moves by (corrected net − previous net), one 'adjustment' ledger row.
//     Payments are never touched: paid more than the corrected invoice, the supplier owes the store
//     the difference (a balance below zero), as with purchase returns.
//   * Lines with goods already returned to the supplier keep their product and unit, and never fall
//     below what was returned; the returns already credited never exceed the corrected net.
//   * One transaction. The revision the screen was opened on must still be the invoice's
//     (`expectedRevision`), and a request id (`clientRef`) records a correction once.
const { badRequest, conflict, notFound } = require('../errors')
const { postMovement, roundQty } = require('../inventory/stock')
const { loadUnit, toBaseQty, round4, kindRule } = require('../inventory/units')

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`)
const ref = { type: 'string', minLength: 8, maxLength: 120 }
const DAY = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const PAYMENT_STATES = ['paid', 'partial', 'credit']
const PAID_FROM = ['shift', 'treasury', 'outside', 'none']
const PER_PAGE = 50

/** The invoice's lines as they are now, with what was returned of each (in the line's unit). */
async function linesOf(db, purchaseId) {
  return (
    await db.query(
      `SELECT i.id, i.product_barcode AS barcode, COALESCE(p.name, i.product_barcode) AS name,
              i.qty::float8 AS qty, i.unit_cost::float8 AS unit_cost, i.line_total::float8 AS line_total,
              i.unit_id, i.unit_name, COALESCE(i.unit_factor, 1)::float8 AS unit_factor,
              COALESCE((SELECT SUM(r.qty) FROM supplier_purchase_return_items r WHERE r.purchase_item_id = i.id), 0)::float8 AS returned
         FROM supplier_purchase_items i LEFT JOIN products p ON p.barcode = i.product_barcode
        WHERE i.purchase_id = $1 ORDER BY i.id`,
      [purchaseId]
    )
  ).rows.map((l) => ({ ...l, base_qty: roundQty(l.qty * l.unit_factor) }))
}

const lineView = (l) => ({
  itemId: l.id ?? l.itemId ?? null,
  barcode: l.barcode,
  name: l.name,
  unitId: l.unit_id ?? l.unitId ?? null,
  unitName: l.unit_name ?? l.unitName ?? null,
  factor: Number(l.unit_factor ?? l.factor ?? 1),
  qty: Number(l.qty),
  unitCost: Number(l.unit_cost ?? l.unitCost),
  lineTotal: Number(l.line_total ?? l.lineTotal)
})

/**
 * Correct a purchase in the caller's transaction (see the rules at the top). Writes everything it
 * moves; a preview runs it in a transaction that is then rolled back, so what it shows is exactly
 * what saving would do.
 */
async function revise(db, ctx, b) {
  const purchase = (
    await db.query(
      `SELECT sp.*, s.name AS supplier_name, s.debt_balance::float8 AS supplier_balance
         FROM supplier_purchases sp JOIN suppliers s ON s.id = sp.supplier_id
        WHERE sp.id = $1 FOR UPDATE OF sp`,
      [b.purchaseId]
    )
  ).rows[0]
  if (!purchase) throw notFound('فاتورة الشراء غير موجودة.')
  if (b.clientRef) {
    const done = (
      await db.query('SELECT * FROM supplier_purchase_revisions WHERE client_ref = $1', [
        b.clientRef
      ])
    ).rows[0]
    if (done) {
      if (done.purchase_id !== purchase.id) throw conflict('رقم الطلب مستخدم لتصحيح فاتورة أخرى.')
      return { duplicate: true, ...revisionView(done) }
    }
  }
  const label = `فاتورة الشراء #${purchase.invoice_ref || purchase.id}`
  if (Number(b.expectedRevision) !== Number(purchase.revision))
    throw conflict(
      `عُدّلت ${label} بعد أن فتحتها (المراجعة ${purchase.revision}). أعد فتحها لترى آخر ما سُجّل، ثم صحّحها.`,
      { code: 'purchase_changed', revision: purchase.revision }
    )
  // The supplier's row: payments, returns and other invoices of this supplier wait for this one.
  await db.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [purchase.supplier_id])

  const old = await linesOf(db, purchase.id)
  const oldById = new Map(old.map((l) => [l.id, l]))
  const kept = new Set()
  const keys = new Set()
  const next = []
  for (const i of b.items || []) {
    const barcode = String(i.barcode).trim()
    const product = (await db.query('SELECT * FROM products WHERE barcode = $1', [barcode])).rows[0]
    if (!product) throw notFound(`الصنف (${barcode}) غير مسجل.`)
    const unit = await loadUnit(db, product, i.unitId ?? null, { purpose: 'buy' })
    const { qty, baseQty } = toBaseQty(
      await kindRule(db, product.unit_kind),
      i.qty,
      unit.factor,
      product.name
    )
    const key = `${barcode}|${unit.id ?? ''}`
    if (keys.has(key)) throw badRequest(`الصنف "${product.name}" مكرر في الفاتورة بنفس الوحدة.`)
    keys.add(key)
    let was = null
    if (i.itemId !== undefined && i.itemId !== null) {
      was = oldById.get(i.itemId)
      if (!was || kept.has(was.id)) throw badRequest('سطر ليس من فاتورة الشراء هذه.')
      kept.add(was.id)
    }
    if (was && was.returned > 0) {
      if (was.barcode !== barcode || (was.unit_id ?? null) !== (unit.id ?? null))
        throw conflict(
          `أُرجع إلى المورد ${was.returned} من "${was.name}"؛ يبقى صنف هذا السطر ووحدته كما هما، وتُصحَّح كميته وسعره فقط.`
        )
      if (qty + 0.0005 < was.returned)
        throw conflict(
          `الكمية الجديدة من "${was.name}" (${qty}) أقل مما أُرجع منها إلى المورد (${was.returned}).`
        )
    }
    const unitCost = round4(Number(i.unitCost))
    next.push({
      itemId: was ? was.id : null,
      barcode,
      name: product.name,
      unitId: unit.id,
      unitName: unit.id === null ? product.unit || null : unit.name,
      factor: unit.factor,
      qty,
      baseQty,
      unitCost,
      lineTotal: round2(qty * unitCost)
    })
  }
  const removed = old.filter((l) => !kept.has(l.id))
  for (const l of removed)
    if (l.returned > 0)
      throw conflict(
        `أُرجع إلى المورد ${l.returned} من "${l.name}"؛ لا يُحذف سطره. صحّح كميته (لا تقل عما أُرجع).`
      )

  // The corrected totals, from the lines (a purchase recorded by its total only keeps that form).
  const oldNet = round2(purchase.total_amount)
  const oldDiscount = round2(purchase.discount || 0)
  const discount =
    b.discount === undefined || b.discount === null ? oldDiscount : round2(b.discount)
  let gross
  let net
  if (next.length) {
    gross = round2(next.reduce((a, l) => a + l.lineTotal, 0))
    if (discount > gross + 0.005) throw badRequest('الخصم أكبر من إجمالي الأصناف.')
    net = round2(gross - discount)
  } else if (!old.length && b.total !== undefined && b.total !== null) {
    net = round2(b.total)
    gross = round2(net + discount)
  } else
    throw badRequest(
      'أبقِ صنفاً واحداً على الأقل في الفاتورة. إن لم يُستلم شيء منها فسجّل مرتجع مشتريات بكل أصنافها.'
    )
  if (!(net > 0)) throw badRequest('صافي الفاتورة يجب أن يكون أكبر من صفر.')
  const credited = round2(
    (
      await db.query(
        'SELECT COALESCE(SUM(credit_value), 0) AS c FROM supplier_purchase_returns WHERE purchase_id = $1',
        [purchase.id]
      )
    ).rows[0].c
  )
  if (net + 0.005 < credited)
    throw conflict(
      `صافي الفاتورة بعد التصحيح (${net.toFixed(2)}) أقل مما خُصم من المورد بمرتجعات هذه الفاتورة (${credited.toFixed(2)}).`
    )
  const invoiceRef =
    b.invoiceRef === undefined ? purchase.invoice_ref || '' : (b.invoiceRef || '').trim()
  const notes = b.notes === undefined ? purchase.notes || '' : (b.notes || '').trim()
  const sameLines =
    !removed.length &&
    next.every((l) => {
      const w = l.itemId && oldById.get(l.itemId)
      return (
        w &&
        w.barcode === l.barcode &&
        (w.unit_id ?? null) === (l.unitId ?? null) &&
        Math.abs(w.qty - l.qty) < 0.0005 &&
        Math.abs(w.unit_cost - l.unitCost) < 0.00005
      )
    })
  if (
    sameLines &&
    next.length === old.length &&
    net === oldNet &&
    discount === oldDiscount &&
    invoiceRef === (purchase.invoice_ref || '') &&
    notes === (purchase.notes || '')
  )
    throw badRequest('لم يتغير شيء في الفاتورة.')

  const paid = round2(purchase.paid_amount || 0)
  const delta = round2(net - oldNet)
  const revision = Number(purchase.revision) + 1
  const reason = `تصحيح ${label} من ${purchase.supplier_name} (المراجعة ${revision})`

  // Per product: base quantity before and after, and the line prices per base unit.
  const products = new Map()
  const of = (barcode, name) => {
    if (!products.has(barcode))
      products.set(barcode, { barcode, name, oldBase: 0, newBase: 0, oldCost: null, newCost: null })
    return products.get(barcode)
  }
  for (const l of old) {
    const p = of(l.barcode, l.name)
    p.oldBase = roundQty(p.oldBase + l.base_qty)
    if (l.unit_cost > 0) p.oldCost = round4(l.unit_cost / l.unit_factor)
  }
  for (const l of next) {
    const p = of(l.barcode, l.name)
    p.newBase = roundQty(p.newBase + l.baseQty)
    if (l.unitCost > 0) {
      p.newCost = round4(l.unitCost / l.factor)
      p.newLine = l
    }
  }

  const stockChanges = []
  const costChanges = []
  const soldSince = []
  // Products locked in a stable order (sales and other purchases lock the same rows).
  for (const p of [...products.values()].sort((a, c) => (a.barcode < c.barcode ? -1 : 1))) {
    const row = (
      await db.query(
        'SELECT stock_qty::float8 AS stock, cost_price::float8 AS cost, name FROM products WHERE barcode = $1 FOR UPDATE',
        [p.barcode]
      )
    ).rows[0]
    const change = roundQty(p.newBase - p.oldBase)
    if (change !== 0) {
      const mv = await postMovement(db, ctx, {
        barcode: p.barcode,
        qty: change,
        kind: 'purchase_correction',
        unitCost: (change > 0 ? p.newCost : p.oldCost) ?? row.cost ?? 0,
        refType: 'purchase',
        refId: purchase.id,
        reason
      })
      stockChanges.push({
        barcode: p.barcode,
        name: row.name,
        before: Number(row.stock),
        change,
        after: mv.balanceAfter
      })
    }
    // The purchase price follows only while this invoice is the product's latest purchase (D-087).
    const later = (
      await db.query(
        `SELECT 1 FROM supplier_purchase_items i JOIN supplier_purchases sp ON sp.id = i.purchase_id
          WHERE i.product_barcode = $1 AND i.unit_cost > 0 AND sp.id <> $2
            AND (sp.timestamp, sp.id) > ($3::timestamp, $2) LIMIT 1`,
        [p.barcode, purchase.id, purchase.timestamp]
      )
    ).rowCount
    let target = p.newCost
    if (target === null && p.newBase === 0 && p.oldCost !== null) {
      // The product left the invoice: the price of its purchase before this one, if any.
      const prev = (
        await db.query(
          `SELECT round(i.unit_cost / COALESCE(i.unit_factor, 1), 4)::float8 AS cost
             FROM supplier_purchase_items i JOIN supplier_purchases sp ON sp.id = i.purchase_id
            WHERE i.product_barcode = $1 AND i.unit_cost > 0 AND sp.id <> $2
              AND (sp.timestamp, sp.id) < ($3::timestamp, $2)
            ORDER BY sp.timestamp DESC, sp.id DESC, i.id DESC LIMIT 1`,
          [p.barcode, purchase.id, purchase.timestamp]
        )
      ).rows[0]
      target = prev ? prev.cost : null
    }
    const current = round4(row.cost || 0)
    if (target !== null && Math.abs(target - current) >= 0.00005) {
      // Set by this invoice and not changed since (by hand or another way): it follows.
      const setHere = p.oldCost === null || Math.abs(current - p.oldCost) < 0.00005
      if (later)
        costChanges.push({
          barcode: p.barcode,
          name: row.name,
          from: current,
          to: current,
          kept: 'later_purchase'
        })
      else if (!setHere)
        costChanges.push({
          barcode: p.barcode,
          name: row.name,
          from: current,
          to: current,
          kept: 'changed_since'
        })
      else {
        await db.query('UPDATE products SET cost_price = $2 WHERE barcode = $1', [
          p.barcode,
          target
        ])
        // The packages' purchase prices follow, as on a purchase (D-096).
        const l = p.newLine
        if (l)
          await db.query(
            `UPDATE product_units SET purchase_cost = CASE WHEN id IS NOT DISTINCT FROM $2::int THEN $3::numeric
                                       ELSE round($3::numeric * factor / $4::numeric, 2) END,
                    updated_at = LOCALTIMESTAMP(0)
              WHERE product_barcode = $1 AND is_active`,
            [p.barcode, l.unitId, l.unitCost, l.factor]
          )
        costChanges.push({ barcode: p.barcode, name: row.name, from: current, to: target })
      }
    }
    // Sold since the invoice (base units, less what customers returned): their profit keeps the
    // cost recorded at the sale (D-087); shown so the owner sees what the correction cannot change.
    const sold = Number(
      (
        await db.query(
          `SELECT COALESCE(SUM((si.quantity - COALESCE(si.returned_qty, 0)) * COALESCE(si.unit_factor, 1)), 0)::float8 AS q
             FROM sale_items si JOIN sales s ON s.id = si.sale_id
            WHERE si.product_barcode = $1 AND s.timestamp >= $2::timestamp`,
          [p.barcode, purchase.timestamp]
        )
      ).rows[0].q
    )
    if (sold > 0 && (change !== 0 || costChanges.some((c) => c.barcode === p.barcode)))
      soldSince.push({ barcode: p.barcode, name: row.name, qty: roundQty(sold) })
  }

  // The lines: kept ones corrected in place, removed ones deleted, new ones added.
  for (const l of removed)
    await db.query('DELETE FROM supplier_purchase_items WHERE id = $1', [l.id])
  for (const l of next) {
    if (l.itemId)
      await db.query(
        `UPDATE supplier_purchase_items SET product_barcode = $2, qty = $3, unit_cost = $4, line_total = $5,
                unit_id = $6, unit_name = $7, unit_factor = $8 WHERE id = $1`,
        [l.itemId, l.barcode, l.qty, l.unitCost, l.lineTotal, l.unitId, l.unitName, l.factor]
      )
    else
      l.itemId = (
        await db.query(
          `INSERT INTO supplier_purchase_items (purchase_id, product_barcode, qty, unit_cost, line_total, unit_id, unit_name, unit_factor)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [purchase.id, l.barcode, l.qty, l.unitCost, l.lineTotal, l.unitId, l.unitName, l.factor]
        )
      ).rows[0].id
  }
  await db.query(
    `UPDATE supplier_purchases SET total_amount = $2, gross_amount = $3, discount = $4, remaining = $5,
            invoice_ref = $6, notes = $7, revision = $8 WHERE id = $1`,
    [purchase.id, net, gross, discount, round2(net - paid), invoiceRef, notes, revision]
  )
  if (delta !== 0) {
    await db.query('UPDATE suppliers SET debt_balance = debt_balance + $1 WHERE id = $2', [
      delta,
      purchase.supplier_id
    ])
    await db.query(
      `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, 'adjustment', $2, $3, LOCALTIMESTAMP(0))`,
      [
        purchase.supplier_id,
        delta,
        `تصحيح ${label} (المراجعة ${revision}): الصافي ${net.toFixed(2)} بدل ${oldNet.toFixed(2)}`
      ]
    )
  }
  const oldLines = old.map(lineView)
  const newLines = next.map(lineView)
  const row = (
    await db.query(
      `INSERT INTO supplier_purchase_revisions (purchase_id, supplier_id, revision, reason, old_total, new_total, delta,
              old_discount, new_discount, paid, old_lines, new_lines, stock_changes, cost_changes, sold_since,
              old_ref, new_ref, old_notes, new_notes, client_ref, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       RETURNING *`,
      [
        purchase.id,
        purchase.supplier_id,
        revision,
        (b.reason || '').trim() || null,
        oldNet,
        net,
        delta,
        oldDiscount,
        discount,
        paid,
        JSON.stringify(oldLines),
        JSON.stringify(newLines),
        JSON.stringify(stockChanges),
        JSON.stringify(costChanges),
        JSON.stringify(soldSince),
        purchase.invoice_ref || '',
        invoiceRef,
        purchase.notes || '',
        notes,
        b.clientRef || `preview:${purchase.id}:${revision}`,
        ctx.user?.id ?? null
      ]
    )
  ).rows[0]
  const balance = Number(
    (await db.query('SELECT debt_balance FROM suppliers WHERE id = $1', [purchase.supplier_id]))
      .rows[0].debt_balance
  )
  await ctx.audit(
    db,
    'supplier_purchase_revise',
    `${reason}: الصافي ${net.toFixed(2)} بدل ${oldNet.toFixed(2)} ج.م (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} على حساب المورد)، ${stockChanges.length} صنف تغير مخزونه${b.reason ? ` – السبب: ${String(b.reason).trim()}` : ''}`,
    { purchaseId: purchase.id, revision, oldTotal: oldNet, newTotal: net, delta, stockChanges }
  )
  return {
    ...revisionView(row),
    credited,
    // What the supplier is owed for this invoice now: below zero, the supplier owes the store.
    outstanding: round2(net - paid - credited),
    supplierBalanceBefore: round2(purchase.supplier_balance),
    supplierBalanceAfter: round2(balance)
  }
}

function revisionView(r) {
  return {
    purchaseId: r.purchase_id,
    revision: r.revision,
    reason: r.reason,
    oldTotal: Number(r.old_total),
    newTotal: Number(r.new_total),
    delta: Number(r.delta),
    oldDiscount: Number(r.old_discount),
    newDiscount: Number(r.new_discount),
    paid: Number(r.paid),
    oldLines: r.old_lines,
    newLines: r.new_lines,
    stockChanges: r.stock_changes,
    costChanges: r.cost_changes,
    soldSince: r.sold_since,
    oldRef: r.old_ref,
    newRef: r.new_ref,
    oldNotes: r.old_notes,
    newNotes: r.new_notes,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at_text || r.created_at
  }
}

const revisionBody = {
  type: 'object',
  required: ['purchaseId', 'expectedRevision', 'items'],
  additionalProperties: false,
  properties: {
    purchaseId: { type: 'integer' },
    expectedRevision: { type: 'integer', minimum: 0 },
    items: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        required: ['barcode', 'qty', 'unitCost'],
        additionalProperties: false,
        properties: {
          // The line being corrected; omitted or null for a product added by the correction.
          itemId: { type: ['integer', 'null'] },
          barcode: { type: 'string', minLength: 1, maxLength: 64 },
          unitId: { type: ['integer', 'null'] },
          qty: { type: 'number', exclusiveMinimum: 0 },
          unitCost: { type: 'number', minimum: 0 }
        }
      }
    },
    discount: { type: ['number', 'null'], minimum: 0 },
    // Only for a purchase recorded by its total, without lines.
    total: { type: ['number', 'null'], exclusiveMinimum: 0 },
    invoiceRef: { type: ['string', 'null'], maxLength: 80 },
    notes: { type: ['string', 'null'], maxLength: 1000 },
    reason: { type: ['string', 'null'], maxLength: 300 }
  }
}

module.exports = function purchaseRevisionsModule(app) {
  // Every supplier's purchase invoices, newest first, by day (today by default, in the store's
  // time zone), supplier, number, payment and where it was paid from; a page at a time.
  app.operation({
    name: 'suppliers.purchasesPage',
    anyPermission: ['suppliers.view', 'suppliers.manage'],
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        // Omitted: today. null: no limit on that side.
        from: DAY,
        to: DAY,
        supplierId: { type: ['integer', 'null'] },
        search: { type: ['string', 'null'], maxLength: 80 },
        payment: { type: ['string', 'null'], enum: [null, ...PAYMENT_STATES] },
        paidFrom: { type: ['string', 'null'], enum: [null, ...PAID_FROM] },
        revised: { type: ['boolean', 'null'] },
        page: { type: 'integer', minimum: 1 }
      }
    },
    handler: async (ctx, b) => {
      const today = (await ctx.pool.query("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d"))
        .rows[0].d
      const from = b.from === undefined ? today : b.from
      const to = b.to === undefined ? today : b.to
      const page = b.page || 1
      const params = []
      const where = []
      const add = (sql, v) => {
        params.push(v)
        where.push(sql.replace('$?', `$${params.length}`))
      }
      // Whole days in the store's own time: from the start of `from` to the end of `to`.
      if (from) add('sp.timestamp >= $?::date', from)
      if (to) add("sp.timestamp < $?::date + interval '1 day'", to)
      if (b.supplierId) add('sp.supplier_id = $?', b.supplierId)
      if (b.search && b.search.trim()) {
        const t = b.search.trim()
        params.push(likeEscape(t))
        const like = `$${params.length}`
        params.push(t.replace(/^#/, ''))
        where.push(
          `(sp.invoice_ref ILIKE '%' || ${like} || '%' ESCAPE '\\' OR sp.id::text = $${params.length})`
        )
      }
      if (b.payment === 'paid') where.push('COALESCE(sp.paid_amount, 0) >= sp.total_amount - 0.005')
      else if (b.payment === 'credit') where.push('COALESCE(sp.paid_amount, 0) <= 0')
      else if (b.payment === 'partial')
        where.push(
          'COALESCE(sp.paid_amount, 0) > 0 AND COALESCE(sp.paid_amount, 0) < sp.total_amount - 0.005'
        )
      if (b.paidFrom === 'none') where.push('sp.paid_from IS NULL')
      else if (b.paidFrom) add('sp.paid_from = $?', b.paidFrom)
      if (b.revised === true) where.push('sp.revision > 0')
      else if (b.revised === false) where.push('sp.revision = 0')
      const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const sums = (
        await ctx.pool.query(
          `SELECT count(*)::int AS count, COALESCE(SUM(sp.total_amount), 0)::float8 AS total,
                  COALESCE(SUM(sp.paid_amount), 0)::float8 AS paid
             FROM supplier_purchases sp ${w}`,
          params
        )
      ).rows[0]
      const rows = (
        await ctx.pool.query(
          `SELECT sp.id, sp.supplier_id, s.name AS supplier_name, sp.invoice_ref, sp.payment_type, sp.paid_from,
                  sp.total_amount::float8 AS total_amount, COALESCE(sp.gross_amount, sp.total_amount)::float8 AS gross_amount,
                  COALESCE(sp.discount, 0)::float8 AS discount, COALESCE(sp.paid_amount, 0)::float8 AS paid_amount,
                  sp.revision, sp.notes, to_char(sp.timestamp, 'YYYY-MM-DD HH24:MI:SS') AS timestamp,
                  (SELECT COUNT(*) FROM supplier_purchase_items i WHERE i.purchase_id = sp.id)::int AS item_count,
                  (SELECT COALESCE(SUM(credit_value), 0) FROM supplier_purchase_returns r WHERE r.purchase_id = sp.id)::float8 AS returned_value
             FROM supplier_purchases sp JOIN suppliers s ON s.id = sp.supplier_id
             ${w}
            ORDER BY sp.timestamp DESC NULLS LAST, sp.id DESC
            LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`,
          params
        )
      ).rows.map((r) => ({
        ...r,
        payment_state:
          r.paid_amount >= r.total_amount - 0.005
            ? 'paid'
            : r.paid_amount > 0
              ? 'partial'
              : 'credit',
        outstanding: round2(r.total_amount - r.paid_amount - r.returned_value)
      }))
      return {
        rows,
        page,
        perPage: PER_PAGE,
        count: sums.count,
        total: round2(sums.total),
        paid: round2(sums.paid),
        filters: { ...b, from, to, page },
        today
      }
    }
  })

  // The invoice's corrections, newest first.
  app.operation({
    name: 'suppliers.purchaseRevisions',
    anyPermission: ['suppliers.view', 'suppliers.manage'],
    schema: {
      type: 'object',
      required: ['purchaseId'],
      properties: { purchaseId: { type: 'integer' } }
    },
    handler: async (ctx, { purchaseId }) =>
      (
        await ctx.pool.query(
          `SELECT r.*, u.username AS created_by_name, to_char(r.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at_text
             FROM supplier_purchase_revisions r LEFT JOIN users u ON u.id = r.created_by
            WHERE r.purchase_id = $1 ORDER BY r.revision DESC`,
          [purchaseId]
        )
      ).rows.map(revisionView)
  })

  // What a correction would do – totals, the supplier's balance, stock and purchase prices – without
  // saving anything: the same work as saving, rolled back.
  app.operation({
    name: 'suppliers.previewRevision',
    permission: 'suppliers.purchase_revise',
    schema: revisionBody,
    handler: async (ctx, b) => {
      const client = await ctx.pool.connect()
      try {
        await client.query('BEGIN')
        const result = await revise(client, { ...ctx, audit: async () => {} }, b)
        return { ...result, preview: true }
      } finally {
        await client.query('ROLLBACK').catch(() => {})
        client.release()
      }
    }
  })

  app.operation({
    name: 'suppliers.revisePurchase',
    permission: 'suppliers.purchase_revise',
    schema: {
      ...revisionBody,
      required: [...revisionBody.required, 'clientRef'],
      properties: { ...revisionBody.properties, clientRef: ref }
    },
    handler: async (ctx, b) => ctx.tx((db) => revise(db, ctx, b))
  })
}

module.exports.helpers = { revise, linesOf }
