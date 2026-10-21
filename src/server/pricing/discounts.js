'use strict'
// Automatic discounts (owner decision 2026-10-15). Trusted pricing: the cart's lines come from the
// catalogue, the rules from the database; nothing the till sends can change the result.
//
// Rules of evaluation (decision record D-044):
//  1. Each line's gross = quantity × unit price, rounded to 0.01.
//  2. Product rules: a percentage of the line, or an amount per base unit (capped at the line).
//     When several product rules match a line, only the largest discount applies (no stacking).
//  3. Cart rules: the threshold is compared with the total AFTER product discounts; a rule
//     applies when that total is at least its threshold (EGP 500 exactly qualifies for a 500 tier).
//     Only the best qualifying cart rule applies (tiers do not stack). Percentages apply to the
//     total after product discounts; a fixed amount is capped at that total.
//  4. Ties: the larger discount wins; on equal amounts, the older rule (lower id).
//  5. The cart discount is spread over the lines in proportion to their net amounts, in whole
//     piastres with the largest-remainder method, so the shares add up exactly.
//  6. A manual fixed amount (D-057, permission pos.manual_discount) applies LAST, to the total
//     after rules 1–5, capped at it; it is spread like the cart discount over what is left of each
//     line and kept in the same line share (cart_discount), so line nets, returns and profit need
//     no separate formula. It never changes prices or stock.
const { badRequest } = require('../errors')

const cents = (n) => Math.round((Number(n) + Number.EPSILON) * 100)
const fromCents = (c) => c / 100

/** Discount in piastres that one rule gives a line (product rules). */
function productDiscountCents(rule, line) {
  const gross = cents(line.gross)
  const raw =
    rule.value_type === 'percent'
      ? cents((line.gross * Number(rule.value)) / 100)
      : cents(Number(rule.value) * line.baseQty)
  return Math.max(0, Math.min(gross, raw))
}

/** Discount in piastres that one cart rule gives an eligible total (in piastres). */
function cartDiscountCents(rule, eligibleCents) {
  if (eligibleCents < cents(rule.min_total)) return 0
  const raw =
    rule.value_type === 'percent'
      ? cents((fromCents(eligibleCents) * Number(rule.value)) / 100)
      : cents(rule.value)
  return Math.max(0, Math.min(eligibleCents, raw))
}

const better = (a, b) => (a.cents !== b.cents ? a.cents > b.cents : a.rule.id < b.rule.id)

/** Largest-remainder split of `totalCents` over `weights` (piastres); the parts add up exactly. */
function allocate(totalCents, weights) {
  const sum = weights.reduce((s, w) => s + w, 0)
  const out = weights.map(() => 0)
  if (totalCents <= 0 || sum <= 0) return out
  const exact = weights.map((w) => (totalCents * w) / sum)
  exact.forEach((x, i) => (out[i] = Math.floor(x)))
  let left = totalCents - out.reduce((s, x) => s + x, 0)
  const order = exact
    .map((x, i) => [x - Math.floor(x), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++
  return out
}

/**
 * Price a cart. `lines`: [{ key, barcode, gross, baseQty }]; `rules`: active discount_rules rows.
 * Returns per-line { lineDiscount, cartDiscount, net, productRule } and the totals.
 */
function priceCart(lines, rules, { manualAmount = 0 } = {}) {
  const productRules = rules.filter((r) => r.scope === 'product')
  const cartRules = rules.filter((r) => r.scope === 'cart')
  const priced = lines.map((line) => {
    let best = null
    for (const rule of productRules.filter((r) => r.product_barcode === line.barcode)) {
      const c = productDiscountCents(rule, line)
      if (c > 0 && (!best || better({ cents: c, rule }, best))) best = { cents: c, rule }
    }
    const grossC = cents(line.gross)
    return {
      ...line,
      grossCents: grossC,
      lineCents: best ? best.cents : 0,
      productRule: best ? best.rule : null
    }
  })
  const eligible = priced.reduce((s, l) => s + l.grossCents - l.lineCents, 0)
  let cart = null
  for (const rule of cartRules) {
    const c = cartDiscountCents(rule, eligible)
    if (c > 0 && (!cart || better({ cents: c, rule }, cart))) cart = { cents: c, rule }
  }
  // Largest-remainder allocation of the cart discount over the lines' net amounts.
  const shares = allocate(
    cart && eligible > 0 ? cart.cents : 0,
    priced.map((l) => l.grossCents - l.lineCents)
  )
  // Manual fixed amount (D-057): after every rule, on what is left of each line.
  const leftC = priced.map((l, i) => l.grossCents - l.lineCents - shares[i])
  const afterRulesC = leftC.reduce((s, x) => s + x, 0)
  const manualC = cents(manualAmount)
  if (manualC < 0) throw badRequest('قيمة الخصم اليدوي غير صالحة.')
  if (manualC > afterRulesC)
    throw badRequest(
      `الخصم اليدوي (${fromCents(manualC).toFixed(2)} ج.م) أكبر من إجمالي الفاتورة بعد الخصومات (${fromCents(afterRulesC).toFixed(2)} ج.م).`
    )
  const manualShares = allocate(manualC, leftC)
  const out = priced.map((l, i) => ({
    key: l.key,
    barcode: l.barcode,
    gross: fromCents(l.grossCents),
    lineDiscount: fromCents(l.lineCents),
    // Invoice-level share: the cart rule's plus the manual amount's (kept together on the line).
    cartDiscount: fromCents(shares[i] + manualShares[i]),
    manualDiscount: fromCents(manualShares[i]),
    net: fromCents(l.grossCents - l.lineCents - shares[i] - manualShares[i]),
    productRule: l.productRule ? { id: l.productRule.id, name: l.productRule.name } : null
  }))
  const subTotalC = priced.reduce((s, l) => s + l.grossCents, 0)
  const productC = priced.reduce((s, l) => s + l.lineCents, 0)
  const cartC = cart ? cart.cents : 0
  // One entry per rule that discounted this sale (for the receipt and sale_discounts).
  const applied = []
  for (const l of priced.filter((x) => x.productRule)) {
    const e = applied.find((a) => a.rule.id === l.productRule.id)
    if (e) e.cents += l.lineCents
    else applied.push({ rule: l.productRule, cents: l.lineCents })
  }
  if (cart) applied.push({ rule: cart.rule, cents: cart.cents })
  const appliedOut = applied.map((a) => ({
    ruleId: a.rule.id,
    name: a.rule.name,
    scope: a.rule.scope,
    valueType: a.rule.value_type,
    value: Number(a.rule.value),
    amount: fromCents(a.cents)
  }))
  if (manualC > 0)
    appliedOut.push({
      ruleId: null,
      name: 'خصم يدوي',
      scope: 'manual',
      valueType: 'amount',
      value: fromCents(manualC),
      amount: fromCents(manualC)
    })
  return {
    lines: out,
    subTotal: fromCents(subTotalC),
    productDiscount: fromCents(productC),
    cartDiscount: fromCents(cartC),
    manualDiscount: fromCents(manualC),
    // Total of all discounts (rules + manual), as sales.discount keeps it.
    discount: fromCents(productC + cartC + manualC),
    afterRules: fromCents(afterRulesC),
    afterDiscount: fromCents(afterRulesC - manualC),
    applied: appliedOut
  }
}

/** Rules in force now for these products, plus all cart rules in force. */
async function activeRules(db, barcodes) {
  const { rows } = await db.query(
    `SELECT id, name, scope, product_barcode, value_type, value, min_total
       FROM discount_rules
      WHERE is_active
        AND (starts_at IS NULL OR starts_at <= LOCALTIMESTAMP(0))
        AND (ends_at IS NULL OR ends_at > LOCALTIMESTAMP(0))
        AND (scope = 'cart' OR product_barcode = ANY($1::text[]))
      ORDER BY id`,
    [barcodes]
  )
  return rows
}

/** Validate a rule as submitted by the administrator. Returns the normalised fields. */
function validateRule(r) {
  const name = String(r.name || '').trim()
  if (!name) throw badRequest('اسم الخصم مطلوب.')
  if (!['product', 'cart'].includes(r.scope)) throw badRequest('نوع الخصم غير صالح.')
  if (!['percent', 'amount'].includes(r.valueType)) throw badRequest('طريقة الخصم غير صالحة.')
  const value = Number(r.value)
  if (!(value > 0)) throw badRequest('قيمة الخصم يجب أن تكون أكبر من صفر.')
  if (r.valueType === 'percent' && value > 100) throw badRequest('النسبة لا تزيد عن 100%.')
  if (cents(value) / 100 !== value && r.valueType === 'amount')
    throw badRequest('المبلغ يقبل قرشين على الأكثر.')
  const minTotal = r.scope === 'cart' ? Number(r.minTotal || 0) : 0
  if (!(minTotal >= 0)) throw badRequest('حد الإجمالي غير صالح.')
  if (r.scope === 'product' && !r.productBarcode) throw badRequest('اختر الصنف المخفض.')
  const ts = (v) => (v ? String(v).replace('T', ' ').slice(0, 19) : null)
  const startsAt = ts(r.startsAt)
  const endsAt = ts(r.endsAt)
  if (startsAt && endsAt && endsAt <= startsAt)
    throw badRequest('تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية.')
  return {
    name,
    scope: r.scope,
    productBarcode: r.scope === 'product' ? r.productBarcode : null,
    valueType: r.valueType,
    value,
    minTotal,
    startsAt,
    endsAt
  }
}

module.exports = { priceCart, activeRules, validateRule, cents }
