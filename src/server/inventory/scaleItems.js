'use strict'
// Scale items keep their own codes (owner, 1.9.0, D-117).
//
// A product marked «صنف ميزان» (products.scale_item) is found from a scale label by its own code:
// the label's item-code digits, read with the store's settings (settings.scale_labels), are
// matched to the code without its leading zeros. Code 1 is found by the label 2000001 001257 and
// by typing 1; it never has to be registered as 2000001. The stored code is never changed:
// leading zeros are dropped only for this comparison (products.scale_key).
//
// A label must name exactly one product, so whatever could make two products answer the same
// label is refused before it is saved (D-117):
//   - two scale items with the same key (1 and 01 and 001; 001 and 0001);
//   - a scale item, and another product registered the older way under the same label's digits
//     (2000001, or the item-code digits 00001), which a label also finds;
//   - a scale item, and another product whose own barcode IS such a label (a 13-digit code with a
//     configured prefix and a valid check digit).
// Checked on every change that can alter it: marking or unmarking, a changed code, an extra
// barcode, an import, and the scale settings themselves. The service is the authority (the shop,
// D-111) and holds one lock for all of them; the database keeps one key per product as a last guard.
const { badRequest, conflict } = require('../errors')
const { DEFAULT_SCALE, parseScaleLabel, kindRule } = require('./units')

const LOCK = "SELECT pg_advisory_xact_lock(hashtext('hm-scale-identifiers'))"

/** The comparison key of a code: digits without leading zeros ("0" for zeros only); else null. */
function scaleKeyOf(code) {
  const c = String(code ?? '').trim()
  if (!/^\d+$/.test(c)) return null
  return c.replace(/^0+/, '') || '0'
}

/** The store's scale settings (the program's defaults when none are saved or they are unreadable). */
async function scaleConfig(db) {
  const row = (await db.query("SELECT value FROM settings WHERE key = 'scale_labels'")).rows[0]
  if (!row) return DEFAULT_SCALE
  try {
    return JSON.parse(row.value)
  } catch {
    return DEFAULT_SCALE
  }
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The texts a label of this key reaches under these settings, per prefix: the label's digits up to
 * the end of the item code (F, e.g. 2000001), the item-code digits (S, e.g. 00001) and the digits
 * after the prefix (A). Returned as regular expressions, because digits between the prefix and the
 * item code (if a setting puts any there) can be anything. A prefix that contradicts the code
 * (default settings: the code's first digit is the prefix's last) gives nothing for that prefix.
 */
function labelPatterns(cfg, key) {
  const s = cfg || DEFAULT_SCALE
  if (key === null || key.length > s.codeLength) return []
  const S = key.padStart(s.codeLength, '0')
  const out = []
  for (const p of Object.keys(s.prefixes || {})) {
    const len = s.codeStart + s.codeLength
    const digits = new Array(len).fill(null)
    let ok = true
    for (let i = 0; i < p.length && i < len; i++) digits[i] = p[i]
    for (let i = 0; i < s.codeLength; i++) {
      const at = s.codeStart + i
      if (digits[at] !== null && digits[at] !== S[i]) ok = false
      digits[at] = S[i]
    }
    if (!ok || p.length > len) continue
    const re = digits.map((d) => (d === null ? '\\d' : esc(d))).join('')
    out.push({
      prefix: p,
      S,
      full: `^${re}$`,
      afterPrefix: `^${digits
        .slice(p.length)
        .map((d) => (d === null ? '\\d' : esc(d)))
        .join('')}$`
    })
  }
  return out
}

/** A product as a conflict is reported: its code and name. */
const named = (r) => ({ barcode: r.barcode, name: r.name })

/**
 * What a label of `key` would reach besides `self`: other scale items with the key, products
 * registered the older way under its digits, and other products' barcodes that are such labels.
 * Each entry: { barcode, name, why }.
 */
async function conflictsForKey(db, cfg, key, self, { marking = false } = {}) {
  const found = []
  const seen = new Set()
  const add = (r, why) => {
    const k = `${r.barcode}|${why}`
    if (r.barcode === self || seen.has(k)) return
    seen.add(k)
    found.push({ ...named(r), why })
  }
  for (const r of (
    await db.query(
      'SELECT barcode, name FROM products WHERE scale_key = $1 AND barcode <> $2 ORDER BY barcode',
      [key, self ?? '']
    )
  ).rows)
    add(r, 'scale_key')
  for (const p of labelPatterns(cfg, key)) {
    const { rows } = await db.query(
      `SELECT barcode, name FROM products
        WHERE barcode <> $4 AND (barcode = $1 OR barcode ~ $2 OR barcode ~ $3 OR barcode = $5)
        ORDER BY barcode`,
      // Only when marking: a product whose code IS the key answers its labels today, and a mark
      // would take them from it. Afterwards the mark is the answer, so the audit does not ask it.
      [p.S, p.full, p.afterPrefix, self ?? '', marking ? key : null]
    )
    for (const r of rows) add(r, 'label_code')
  }
  // Barcodes that are themselves labels of these settings (13 digits with a configured prefix and a
  // valid check digit) naming this key: a scan of one must not stand for two products.
  const s = cfg || DEFAULT_SCALE
  const prefixes = Object.keys(s.prefixes || {})
  if (s.enabled !== false && prefixes.length) {
    const { rows } = await db.query(
      `SELECT barcode, name, barcode AS code FROM products WHERE length(barcode) = $1 AND barcode ~ '^[0-9]+$'
       UNION ALL
       SELECT p.barcode, p.name, b.barcode AS code FROM product_barcodes b JOIN products p ON p.barcode = b.product_barcode
        WHERE length(b.barcode) = $1 AND b.barcode ~ '^[0-9]+$'`,
      [s.length]
    )
    for (const r of rows) {
      const label = parseScaleLabel({ ...s, enabled: true }, r.code)
      if (label && !label.error && scaleKeyOf(label.code) === key) add(r, 'label_barcode')
    }
  }
  return found
}

const WHY = {
  scale_key: 'لأن الكودين يصبحان نفس كود الميزان بعد حذف الأصفار من البداية',
  label_code:
    'لأن ملصقات هذا الكود تقرأ ذلك الصنف الآن (كوده هو أرقام الملصق أو نفس الكود بدون أصفار)، فتفعيل الميزان سيغيّر الصنف الذي يقرؤه الملصق',
  label_barcode: 'لأن باركوده ملصق ميزان يقرأ نفس كود الصنف'
}

/** The owner's message for the first conflict (all of them are in details). */
function conflictMessage(product, list) {
  const c = list[0]
  return (
    `لا يمكن تفعيل صنف الميزان للصنف «${product.name}» (${product.barcode}) لأن كود الميزان الناتج يتعارض مع صنف آخر. ` +
    `الصنف المتعارض: ${c.name} — الكود: ${c.barcode}، ${WHY[c.why]}. ` +
    'غيّر كود أحد الصنفين أو عطّل خاصية الميزان للصنف الآخر.' +
    (list.length > 1 ? ` (و${list.length - 1} تعارض آخر)` : '')
  )
}

/** Why a code cannot be a scale item under these settings, or null. */
function unfit(cfg, barcode) {
  const s = cfg || DEFAULT_SCALE
  const key = scaleKeyOf(barcode)
  if (key === null)
    return `كود الصنف (${barcode}) يحتوي على حروف أو رموز؛ صنف الميزان يحتاج كوداً من أرقام فقط.`
  if (key.length > s.codeLength)
    return `كود الصنف (${barcode}) أطول من خانة كود الصنف في ملصق الميزان (${s.codeLength} أرقام).`
  if (!labelPatterns(s, key).length)
    return `لا يمكن أن يحمل ملصق الميزان بالإعدادات الحالية الكود ${barcode}: راجع بادئات الميزان ومواضع الكود.`
  return null
}

/**
 * Mark or unmark a product as a scale item, in the caller's transaction. Refuses (409, with every
 * conflict in details.conflicts) anything a label could not tell apart.
 */
async function setScaleItem(db, product, enabled) {
  await db.query(LOCK)
  if (!enabled) {
    await db.query('UPDATE products SET scale_item = false, scale_key = NULL WHERE barcode = $1', [
      product.barcode
    ])
    return { scaleItem: false, scaleKey: null }
  }
  const cfg = await scaleConfig(db)
  const why = unfit(cfg, product.barcode)
  if (why) throw badRequest(why, { code: 'scale_unfit' })
  // A weight label on a product counted in whole pieces would be a weight read as pieces.
  const prefixKinds = new Set(Object.values(cfg.prefixes || {}))
  if (!prefixKinds.has('price') && (await kindRule(db, product.unit_kind)).decimals === 0)
    throw badRequest(
      `الصنف «${product.name}» يباع بالعدد، وملصقات الميزان في الإعدادات تحمل وزناً فقط. غيّر طريقة قياسه إلى "بالوزن" أولاً.`,
      { code: 'scale_kind' }
    )
  const key = scaleKeyOf(product.barcode)
  const list = await conflictsForKey(db, cfg, key, product.barcode, { marking: true })
  if (list.length)
    throw conflict(conflictMessage(product, list), { code: 'scale_conflict', conflicts: list })
  await db.query('UPDATE products SET scale_item = true, scale_key = $2 WHERE barcode = $1', [
    product.barcode,
    key
  ])
  return { scaleItem: true, scaleKey: key }
}

/**
 * A barcode about to be given to `owner` (a new product, a changed code, an extra barcode): refused
 * when a label of some scale item would then reach two products. Call inside the transaction.
 */
async function checkBarcode(db, code, owner) {
  const text = String(code ?? '').trim()
  if (!/^\d+$/.test(text)) return
  const hasScale = (await db.query('SELECT 1 FROM products WHERE scale_item LIMIT 1')).rowCount
  if (!hasScale) return
  await db.query(LOCK)
  const cfg = await scaleConfig(db)
  const keys = new Set()
  const s = cfg || DEFAULT_SCALE
  // The code as a whole label, as the item-code digits, as the label's digits up to the code, or
  // as those digits after the prefix: which scale key would each make it answer?
  const label = parseScaleLabel({ ...s, enabled: true }, text)
  if (label && !label.error) keys.add(scaleKeyOf(label.code))
  if (text.length === s.codeLength) keys.add(scaleKeyOf(text))
  for (const p of Object.keys(s.prefixes || {})) {
    for (const full of [text, p + text]) {
      if (full.length === s.codeStart + s.codeLength && full.startsWith(p))
        keys.add(scaleKeyOf(full.substr(s.codeStart, s.codeLength)))
    }
  }
  keys.delete(null)
  if (!keys.size) return
  const { rows } = await db.query(
    'SELECT barcode, name, scale_key FROM products WHERE scale_item AND scale_key = ANY($1::text[]) AND barcode <> $2',
    [[...keys], owner ?? '']
  )
  // Only a real overlap counts: the scale item's own label texts must include this code.
  for (const r of rows) {
    const probe = labelPatterns(cfg, r.scale_key).some(
      (p) => text === p.S || new RegExp(p.full).test(text) || new RegExp(p.afterPrefix).test(text)
    )
    const asLabel = label && !label.error && scaleKeyOf(label.code) === r.scale_key
    if (probe || asLabel)
      throw conflict(
        `لا يمكن استخدام الكود ${text}: ملصقات الميزان للصنف «${r.name}» (${r.barcode}) تقرأ نفس الكود، فلن يعرف البرنامج أي الصنفين المقصود. اختر كوداً آخر أو عطّل خاصية الميزان لذلك الصنف.`,
        { code: 'scale_conflict', conflicts: [named(r)] }
      )
  }
}

/** A scale item's code changed (products.changeBarcode): its key follows, and is checked again. */
async function rekey(db, barcode) {
  const p = (
    await db.query('SELECT barcode, name, unit_kind, scale_item FROM products WHERE barcode = $1', [
      barcode
    ])
  ).rows[0]
  if (!p || !p.scale_item) return
  // Unmark first so the product does not conflict with its own old key, then mark again.
  await db.query('UPDATE products SET scale_item = false, scale_key = NULL WHERE barcode = $1', [
    barcode
  ])
  await setScaleItem(db, p, true)
}

/**
 * Every scale item checked against these settings (a settings change, or the owner's audit):
 * codes that no longer fit and every conflict. Nothing is changed.
 */
async function audit(db, cfg) {
  const items = (
    await db.query(
      'SELECT barcode, name, unit_kind, scale_key FROM products WHERE scale_item ORDER BY barcode'
    )
  ).rows
  const problems = []
  for (const p of items) {
    const why = unfit(cfg, p.barcode)
    if (why) {
      problems.push({ ...named(p), message: why })
      continue
    }
    const list = await conflictsForKey(db, cfg, scaleKeyOf(p.barcode), p.barcode)
    for (const c of list)
      problems.push({
        ...named(p),
        with: named(c),
        why: c.why,
        message: `«${p.name}» (${p.barcode}) و«${c.name}» (${c.barcode}): ${WHY[c.why]}.`
      })
  }
  return { items: items.length, problems }
}

/** A changed scale setting is refused while it would make any label ambiguous (D-117). */
async function checkSettings(db, cfg) {
  await db.query(LOCK)
  const { problems } = await audit(db, cfg)
  if (problems.length)
    throw conflict(
      `لا يمكن حفظ إعدادات الميزان: ${problems[0].message} ` +
        (problems.length > 1 ? `(و${problems.length - 1} مشكلة أخرى) ` : '') +
        'عدّل الأكواد أو عطّل خاصية الميزان لأحد الصنفين ثم احفظ الإعدادات.',
      { code: 'scale_conflict', problems }
    )
}

/**
 * The product a decoded label names (pos.resolve), or null when none (D-117).
 *   1. A product marked «صنف ميزان» with the label's key – the owner's explicit choice; unique.
 *   2. Otherwise exactly as before 1.9.0, for products nobody marked: the first product whose code is
 *      one of the label's spellings, in this order – the label's digits up to the item code
 *      (2000001), the item-code digits (00001), the digits after the prefix, then the same two
 *      without leading zeros (1). Never a guess: a fixed order of exact codes, unchanged since 1.5.2.
 * Marking a product (setScaleItem) is refused while it would change what step 2 gives for any label
 * (conflictsForKey), so a mark can never take a label away from the product it named before.
 */
async function productForLabel(db, scale) {
  const key = scaleKeyOf(scale.code)
  const item = (await db.query('SELECT * FROM products WHERE scale_item AND scale_key = $1', [key]))
    .rows[0]
  if (item) return item
  return (await db.query(OLD_ORDER_SQL, [olderSpellings(scale)])).rows[0] || null
}

/** The spellings a label was looked up by before 1.9.0, in their order (pos.resolve, 1.5.2). */
function olderSpellings(scale) {
  const afterPrefix = scale.fullCode.slice(scale.prefix.length)
  return [
    ...new Set(
      [
        scale.fullCode,
        scale.code,
        afterPrefix,
        scale.code.replace(/^0+/, ''),
        afterPrefix.replace(/^0+/, '')
      ].filter(Boolean)
    )
  ]
}
const OLD_ORDER_SQL =
  'SELECT * FROM products WHERE barcode = ANY($1::text[]) ORDER BY array_position($1::text[], barcode) LIMIT 1'

module.exports = {
  LOCK,
  scaleKeyOf,
  scaleConfig,
  labelPatterns,
  conflictsForKey,
  setScaleItem,
  checkBarcode,
  rekey,
  audit,
  checkSettings,
  productForLabel,
  unfit
}
