'use strict'
// Units and packaging (stage 4, phase 2).
//
// A product's base unit is what stock is counted in. Its kind decides valid quantities:
//   count  – whole base units (pieces, packets); a carton of 24 may be sold as 0.5 carton = 12;
//   weight – kilograms with 3 decimals (owner decision); volume – litres with 3 decimals;
//   kinds the owner adds (migration 0014) – their own number of decimals, 0 to 3.
// A kind is passed either as its key (the three built-in kinds) or as a rule { key, decimals }
// read with kindRule().
// Extra units convert with a factor (base units per unit). A line's price is the unit's own price,
// or the base price × factor. Line totals are rounded to 0.01 per line; there is no cash rounding.
const { badRequest } = require('../errors')

const KINDS = ['count', 'weight', 'volume']
// Decimals of the built-in kinds (fixed; the owner cannot change them).
const BUILTIN_DECIMALS = { count: 0, weight: 3, volume: 3 }
const EPS = 1e-9

const round = (n, d) => {
  const f = 10 ** d
  return Math.round((Number(n) + Number.EPSILON) * f) / f
}
const round2 = (n) => round(n, 2)
const round3 = (n) => round(n, 3)
const round4 = (n) => round(n, 4)

function isWhole(n) {
  return Math.abs(n - Math.round(n)) < EPS
}
function hasAtMost3Decimals(n) {
  return Math.abs(n - round3(n)) < EPS
}
function hasAtMostDecimals(n, d) {
  return Math.abs(n - round(n, d)) < EPS
}
const DECIMALS_TEXT = { 1: 'خانة عشرية واحدة', 2: 'خانتين عشريتين', 3: 'ثلاث خانات عشرية' }

/** { key, decimals } for a kind given as a rule or as a built-in key. */
function ruleOf(kind) {
  if (kind && typeof kind === 'object') return { key: kind.key, decimals: Number(kind.decimals) }
  const key = kind || 'count'
  if (!(key in BUILTIN_DECIMALS)) throw new Error(`measure kind "${key}" needs its rule (kindRule)`)
  return { key, decimals: BUILTIN_DECIMALS[key] }
}

/** The rule of a product's kind: built-in kinds directly, others from measure_kinds. */
async function kindRule(db, key) {
  const k = key || 'count'
  if (k in BUILTIN_DECIMALS) return { key: k, decimals: BUILTIN_DECIMALS[k] }
  const r = (await db.query('SELECT key, decimals FROM measure_kinds WHERE key = $1', [k])).rows[0]
  if (!r) throw badRequest('طريقة القياس غير معروفة.')
  return { key: r.key, decimals: Number(r.decimals) }
}

/** A stock value (target or opening) must fit the kind; negative values are allowed. */
function checkStockValue(kind, value) {
  const { decimals } = ruleOf(kind)
  const v = Number(value)
  if (!Number.isFinite(v)) throw badRequest('كمية غير صالحة.')
  if (decimals === 0 && !isWhole(v))
    throw badRequest('صنف يباع بالعدد: الكمية يجب أن تكون عدداً صحيحاً.')
  if (decimals > 0 && !hasAtMostDecimals(v, decimals))
    throw badRequest(`الكمية تقبل ${DECIMALS_TEXT[decimals]} على الأكثر.`)
}

/** Validate a unit factor for a product kind (count: whole numbers; others: their decimals). */
function validateFactor(kind, factor) {
  const { decimals } = ruleOf(kind)
  const f = Number(factor)
  if (!(f > 0)) throw badRequest('معامل التحويل يجب أن يكون أكبر من صفر.')
  if (decimals === 0 && !isWhole(f))
    throw badRequest(
      'معامل التحويل لصنف يباع بالعدد يجب أن يكون عدداً صحيحاً (مثلاً الكرتونة = 24).'
    )
  if (decimals > 0 && !hasAtMostDecimals(f, decimals))
    throw badRequest(`معامل التحويل يقبل ${DECIMALS_TEXT[decimals]} على الأكثر.`)
  return round(f, decimals)
}

/**
 * Quantity in a unit → base quantity, validated for the product kind.
 * Returns { qty, baseQty } (qty rounded to 3 decimals).
 */
function toBaseQty(kind, qty, factor, label = '') {
  const q = Number(qty)
  if (!(q > 0)) throw badRequest(`الكمية يجب أن تكون أكبر من صفر${label ? ` (${label})` : ''}.`)
  if (!hasAtMost3Decimals(q))
    throw badRequest(`الكمية تقبل ثلاث خانات عشرية على الأكثر${label ? ` (${label})` : ''}.`)
  const { key, decimals } = ruleOf(kind)
  const base = q * Number(factor)
  if (decimals === 0 && !isWhole(base))
    throw badRequest(
      `الكمية يجب أن تعادل عدداً صحيحاً من الوحدة الأساسية${label ? ` (${label})` : ''}.`
    )
  if (decimals > 0 && !hasAtMostDecimals(base, decimals))
    throw badRequest(
      key === 'weight' || key === 'volume'
        ? `الوزن أو الحجم يقبل ثلاث خانات عشرية على الأكثر${label ? ` (${label})` : ''}.`
        : `الكمية بالوحدة الأساسية تقبل ${DECIMALS_TEXT[decimals]} على الأكثر${label ? ` (${label})` : ''}.`
    )
  return { qty: round3(q), baseQty: round(base, decimals) }
}

/** The base unit of a product, in the same shape as a product_units row. */
function baseUnit(product) {
  return {
    id: null,
    name: product.unit || '',
    factor: 1,
    retail_price: Number(product.retail_price) || 0,
    wholesale_price: Number(product.wholesale_price) || 0,
    sellable: true,
    purchasable: true,
    is_active: true
  }
}

/** Selling price of one unit: its own price, or the base price × factor. */
function unitPrice(product, unit) {
  // The base unit keeps the product's exact price (line totals round per line, as before).
  if (unit.id === null) return Number(product.retail_price) || 0
  if (unit.retail_price !== null && unit.retail_price !== undefined)
    return round2(unit.retail_price)
  return round2((Number(product.retail_price) || 0) * Number(unit.factor))
}

/** Load a product's unit (null/undefined = base unit). Refuses inactive or foreign units. */
async function loadUnit(db, product, unitId, { purpose = 'sell' } = {}) {
  if (unitId === null || unitId === undefined) return baseUnit(product)
  const u = (
    await db.query('SELECT * FROM product_units WHERE id = $1 AND product_barcode = $2', [
      unitId,
      product.barcode
    ])
  ).rows[0]
  if (!u || !u.is_active) throw badRequest(`وحدة البيع غير موجودة للصنف "${product.name}".`)
  if (purpose === 'sell' && !u.sellable)
    throw badRequest(`الوحدة "${u.name}" غير مخصصة للبيع في الصنف "${product.name}".`)
  if (purpose === 'buy' && !u.purchasable)
    throw badRequest(`الوحدة "${u.name}" غير مخصصة للشراء في الصنف "${product.name}".`)
  return {
    ...u,
    factor: Number(u.factor),
    retail_price: u.retail_price === null ? null : Number(u.retail_price),
    wholesale_price: u.wholesale_price === null ? null : Number(u.wholesale_price)
  }
}

// ── Scale labels ─────────────────────────────────────────────
const DEFAULT_SCALE = {
  // Off by default: the store weighs on an ordinary scale and types the weight (owner, 2026-10-15).
  enabled: false,
  length: 13,
  codeStart: 2,
  codeLength: 5,
  valueStart: 7,
  valueLength: 5,
  prefixes: { 20: 'weight', 21: 'weight', 25: 'weight', 22: 'price' },
  weightDivisor: 1000,
  priceDivisor: 100
}

/** Validate scale-label settings (JSON text) and return the normalised JSON text. */
function normalizeScaleLabels(raw) {
  let v
  try {
    v = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    throw badRequest('إعدادات ملصقات الميزان غير صالحة.')
  }
  const int = (x, min, max, name) => {
    const n = Number(x)
    if (!Number.isInteger(n) || n < min || n > max)
      throw badRequest(`قيمة ${name} في ملصقات الميزان يجب أن تكون بين ${min} و ${max}.`)
    return n
  }
  const out = {
    enabled: v.enabled !== false,
    length: int(v.length, 8, 20, 'الطول'),
    codeStart: int(v.codeStart, 0, 18, 'بداية الكود'),
    codeLength: int(v.codeLength, 1, 10, 'طول الكود'),
    valueStart: int(v.valueStart, 0, 18, 'بداية القيمة'),
    valueLength: int(v.valueLength, 1, 10, 'طول القيمة'),
    weightDivisor: int(v.weightDivisor, 1, 100000, 'مقسوم الوزن'),
    priceDivisor: int(v.priceDivisor, 1, 100000, 'مقسوم السعر'),
    prefixes: {}
  }
  if (out.codeStart + out.codeLength > out.length || out.valueStart + out.valueLength > out.length)
    throw badRequest('مواضع الكود أو القيمة تتجاوز طول الملصق.')
  for (const [p, kind] of Object.entries(v.prefixes || {})) {
    if (!/^\d{1,3}$/.test(p)) throw badRequest(`بادئة غير صالحة: ${p}`)
    if (!['weight', 'price'].includes(kind)) throw badRequest(`نوع غير صالح للبادئة ${p}`)
    out.prefixes[p] = kind
  }
  return JSON.stringify(out)
}

/** Parse a scale label. Returns { code, kind: 'weight'|'price', value } or null. */
function parseScaleLabel(settings, raw) {
  const s = settings || DEFAULT_SCALE
  const code = String(raw || '').trim()
  if (!s.enabled || code.length !== s.length || !/^\d+$/.test(code)) return null
  const prefix = Object.keys(s.prefixes).find((p) => code.startsWith(p))
  if (!prefix) return null
  const kind = s.prefixes[prefix]
  const productCode = code.substr(s.codeStart, s.codeLength)
  const value =
    Number(code.substr(s.valueStart, s.valueLength)) /
    (kind === 'weight' ? s.weightDivisor : s.priceDivisor)
  if (!(value > 0)) return null
  return { code: productCode, kind, value }
}

module.exports = {
  KINDS,
  BUILTIN_DECIMALS,
  kindRule,
  checkStockValue,
  round2,
  round3,
  round4,
  validateFactor,
  toBaseQty,
  baseUnit,
  unitPrice,
  loadUnit,
  DEFAULT_SCALE,
  normalizeScaleLabels,
  parseScaleLabel
}
