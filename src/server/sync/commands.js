'use strict'
// Owner commands from the cloud, applied on the PC (stage 4 phase 4, D-042 §4.2).
//
// Exactly once: the command id is inserted into applied_commands in the same transaction as the
// command's effects. A command delivered again (retry, duplicate, re-pull after a crash) finds its
// id and is skipped; a crash before commit leaves nothing behind and the command is applied on a
// later pull. The outcome row syncs back to the cloud, so the owner sees "applied" only after the
// PC actually applied it.
//
// Outcomes:
//   applied            – every effect was applied;
//   partially_applied  – field edits where some fields had changed on the PC since the owner's
//                        base values: those fields were left as they are (conflicts listed);
//   rejected           – a business rule refused the command (unknown product, invalid quantity,
//                        all fields in conflict, …): nothing was applied, the reason is kept.
// A database or connection failure is not an outcome: the transaction rolls back and the command
// stays pending.
const { ServiceError } = require('../errors')
const { receiveStock } = require('../inventory/stock')
const { round4 } = require('../inventory/units')
const { helpers: finance } = require('../modules/finance')

const OWNER = 'المالك (عن بعد)'
const PRODUCT_FIELDS = ['name', 'unit', 'reorder_limit', 'category']
const PRICE_FIELDS = ['retail_price', 'wholesale_price', 'cost_price']
const NUMERIC = new Set(['reorder_limit', 'retail_price', 'wholesale_price', 'cost_price'])

class Rejected extends Error {}

/** Service-like context for the owner's remote identity; every effect is audited with the id. */
function ownerContext(commandId) {
  return {
    user: { id: null, username: OWNER, permissions: [] },
    terminal: 'cloud',
    can: () => false,
    audit: (db, actionType, description, details) =>
      db.query(
        `INSERT INTO system_logs (timestamp, user_id, username, action_type, description, details)
         VALUES (LOCALTIMESTAMP(0), NULL, $1, $2, $3, $4)`,
        [
          OWNER,
          actionType,
          `${description} (أمر عن بعد ${commandId})`,
          JSON.stringify({ ...(details || {}), commandId })
        ]
      )
  }
}

const same = (field, a, b) =>
  NUMERIC.has(field)
    ? Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.00005
    : String(a ?? '') === String(b ?? '')

/** Field edit with base values: apply fields unchanged on the PC since the owner's base. */
async function editFields(db, ctx, payload, allowed, label) {
  const barcode = String(payload.barcode || '')
  const fields = payload.fields || {}
  const base = payload.base || {}
  const names = Object.keys(fields)
  if (!names.length) throw new Rejected('لا توجد حقول للتعديل.')
  const bad = names.find((n) => !allowed.includes(n))
  if (bad) throw new Rejected(`الحقل ${bad} لا يمكن تعديله عن بعد.`)
  const missingBase = names.find((n) => !(n in base))
  if (missingBase) throw new Rejected(`القيمة الأصلية للحقل ${missingBase} مفقودة.`)
  const p = (await db.query('SELECT * FROM products WHERE barcode = $1 FOR UPDATE', [barcode]))
    .rows[0]
  if (!p) throw new Rejected(`الصنف (${barcode}) غير مسجل على جهاز المتجر.`)
  const apply = {}
  const conflicts = []
  for (const n of names) {
    if (NUMERIC.has(n) && !(Number.isFinite(Number(fields[n])) && Number(fields[n]) >= 0))
      throw new Rejected(`قيمة غير صالحة للحقل ${n}.`)
    if (same(n, p[n], base[n])) apply[n] = NUMERIC.has(n) ? Number(fields[n]) : fields[n]
    else conflicts.push({ field: n, base: base[n], local: p[n], remote: fields[n] })
  }
  const applied = Object.keys(apply)
  if (!applied.length) return { status: 'rejected', detail: { reason: 'conflict', conflicts } }
  const sets = applied.map((n, i) => `"${n}" = $${i + 2}`).join(', ')
  await db.query(`UPDATE products SET ${sets} WHERE barcode = $1`, [
    barcode,
    ...applied.map((n) => apply[n])
  ])
  await ctx.audit(
    db,
    'product_update',
    `${label} للصنف "${p.name}": ${applied.map((n) => `${n}: ${p[n]} → ${apply[n]}`).join('، ')}${conflicts.length ? ` – لم يُطبق (تعارض): ${conflicts.map((c) => c.field).join('، ')}` : ''}`
  )
  return {
    status: conflicts.length ? 'partially_applied' : 'applied',
    detail: { applied, conflicts }
  }
}

const HANDLERS = {
  // Supplier invoice with received items; paid (if at all) by the owner outside the drawer.
  async supplier_invoice(db, ctx, p) {
    const items = Array.isArray(p.items) ? p.items : []
    const total =
      p.total_amount ??
      Math.round(items.reduce((a, i) => a + Number(i.qty) * Number(i.unitCost), 0) * 100) / 100
    if (!(total > 0)) throw new Rejected('قيمة الفاتورة يجب أن تكون أكبر من صفر.')
    const paid = Number(p.paid_amount) || 0
    if (paid < 0 || paid > total) throw new Rejected('المبلغ المدفوع غير صالح.')
    const r = await finance.recordPurchase(
      db,
      ctx,
      {
        supplierId: p.supplierId,
        invoice_ref: p.invoice_ref || '',
        total_amount: total,
        paid_amount: paid,
        payment_type: paid >= total ? 'نقدي (خارج الدرج)' : 'آجل',
        notes: [p.notes, 'مسجلة عن بعد من المالك'].filter(Boolean).join(' – '),
        items
      },
      { drawer: false }
    )
    return {
      status: 'applied',
      detail: { purchaseId: r.purchaseId, receivedItems: r.receivedItems }
    }
  },

  // Stock received without a supplier invoice (base units, at a unit cost).
  async stock_receipt(db, ctx, p) {
    const items = Array.isArray(p.items) ? p.items : []
    if (!items.length) throw new Rejected('لا توجد أصناف في الاستلام.')
    const movements = []
    for (const i of [...items].sort((a, b) => (a.barcode < b.barcode ? -1 : 1))) {
      const qty = Number(i.qty)
      const cost = Number(i.unitCost)
      if (!(qty > 0) || !(cost >= 0)) throw new Rejected(`كمية أو تكلفة غير صالحة (${i.barcode}).`)
      const mv = await receiveStock(db, ctx, {
        barcode: String(i.barcode),
        qty,
        unitCost: round4(cost),
        refType: 'remote_receipt',
        refId: null,
        reason: p.reason || 'استلام بضاعة مسجل عن بعد من المالك'
      })
      movements.push(mv.id)
    }
    await ctx.audit(db, 'stock_receipt', `استلام ${items.length} صنف عن بعد`)
    return { status: 'applied', detail: { movements } }
  },

  product_edit: (db, ctx, p) => editFields(db, ctx, p, PRODUCT_FIELDS, 'تعديل بيانات'),
  price_edit: (db, ctx, p) => editFields(db, ctx, p, PRICE_FIELDS, 'تعديل أسعار')
}

const TYPES = Object.keys(HANDLERS)

/**
 * Apply one command exactly once. Returns { status, detail, duplicate }.
 * `hooks.afterEffects(db)` is for failure-injection tests (throw = crash before commit).
 */
async function applyCommand(pool, cmd, { hooks = {} } = {}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const claimed = await client.query(
      `INSERT INTO applied_commands (command_id, type, status) VALUES ($1, $2, 'applied')
       ON CONFLICT (command_id) DO NOTHING RETURNING command_id`,
      [cmd.id, String(cmd.type)]
    )
    if (!claimed.rows.length) {
      await client.query('ROLLBACK')
      const prev = (
        await pool.query('SELECT status, detail FROM applied_commands WHERE command_id = $1', [
          cmd.id
        ])
      ).rows[0]
      return { ...prev, duplicate: true }
    }
    const ctx = ownerContext(cmd.id)
    let outcome
    await client.query('SAVEPOINT command_effects')
    try {
      const handler = HANDLERS[cmd.type]
      if (!handler) throw new Rejected(`نوع أمر غير معروف: ${cmd.type}`)
      outcome = await handler(client, ctx, cmd.payload || {})
    } catch (e) {
      // Business refusal: undo the command's own writes, keep the claim, record why.
      if (!(e instanceof Rejected) && !(e instanceof ServiceError && e.status < 500)) throw e
      await client.query('ROLLBACK TO SAVEPOINT command_effects')
      outcome = { status: 'rejected', detail: { reason: e.message } }
    }
    if (hooks.afterEffects) await hooks.afterEffects(client, cmd)
    await client.query(
      'UPDATE applied_commands SET status = $2, detail = $3 WHERE command_id = $1',
      [cmd.id, outcome.status, JSON.stringify(outcome.detail || {})]
    )
    if (outcome.status === 'rejected')
      await ctx.audit(client, 'remote_command', `رفض أمر عن بعد (${cmd.type})`, outcome.detail)
    await client.query('COMMIT')
    return { ...outcome, duplicate: false }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

module.exports = { applyCommand, TYPES, OWNER }
