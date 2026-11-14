'use strict'
// Checking and writing the rows of the store's Excel template (1.4.0; written in bulk since 1.6.3).
//
// checkRows() checks every row – required fields, prices, the measurement kind and its decimals,
// duplicate barcodes and phone numbers in the file and in the database – and returns the problems,
// the counts and the cleaned rows. writeRows() writes cleaned rows through the same rules as the
// screens: products with stock 0 and an 'opening' stock movement (the ledger stays exact),
// categories created by name, customers and suppliers with their opening balance and a ledger line
// "رصيد افتتاحي". A product without a barcode gets an internal code (HM000001…). Existing records
// are never changed: a barcode or phone number already in the store is a problem, not an update.
//
// Both run in the caller's transaction. writeRows inserts many rows per statement (BATCH_ROWS):
// the row triggers – the stock ledger, change capture for the cloud, customer codes – run for every
// row exactly as for one-row inserts. Before each batch it calls `step(stage, done)`, which may
// throw to stop (a cancelled job): the caller's transaction then undoes everything.
//
// Template version 2 (D-067): a product row may carry one package (name, units per package, its
// barcode, selling and purchase prices; an empty selling price is automatic, D-096), checked by the
// same rules as the units window (whole factor for counted products, its own selling price, unique
// barcode).
const path = require('path')
const { pathToFileURL } = require('url')
const { checkStockValue, validateFactor } = require('../inventory/units')

// Rows per INSERT. Measured with 5,000 products (.docs/IMPORT_JOBS.md): 100 → 250 → 500 rows per
// batch change the time by under 10%; 250 keeps each statement's parameters small.
const BATCH_ROWS = 250

const shared = {}
async function lib(name) {
  if (!shared[name])
    shared[name] = await import(
      pathToFileURL(path.join(__dirname, '..', '..', 'shared', `${name}.mjs`)).href
    )
  return shared[name]
}

const WEIGHT_WORDS = ['كجم', 'كيلو', 'كيلوجرام', 'كيلو جرام', 'كغ', 'kg', 'kilo', 'وزن', 'بالوزن']
const VOLUME_WORDS = ['لتر', 'ليتر', 'l', 'liter', 'litre', 'حجم', 'بالحجم']
const COUNT_WORDS = ['عدد', 'بالعدد', 'قطعه', 'قطعة', 'count']

const SHEET = { products: 'الأصناف', customers: 'العملاء', suppliers: 'الموردون' }

/**
 * Check the rows. Returns { errors: [{ sheet, row, message, field?, value? }], summary, clean }.
 * Nothing is written.
 */
async function checkRows(db, body) {
  const { looseText } = await lib('storeImport')
  const { normalizePhones } = await lib('phone')
  const { normalizeAddresses } = await lib('address')
  const products = body.products || []
  const customers = body.customers || []
  const suppliers = body.suppliers || []

  const errors = []
  const fail = (sheet, row, message, field) =>
    errors.push(field ? { sheet, row, message, field } : { sheet, row, message })
  const text = (v, max) =>
    String(v ?? '')
      .trim()
      .slice(0, max)
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

  // ── Measurement kinds: by name, unit or key; built-in words; empty = from the unit.
  const kinds = (await db.query('SELECT key, name, unit, decimals, is_active FROM measure_kinds'))
    .rows
  const words = (list) => list.map(looseText)
  const [countWords, weightWords, volumeWords] = [
    words(COUNT_WORDS),
    words(WEIGHT_WORDS),
    words(VOLUME_WORDS)
  ]
  const kindOf = (raw, unit) => {
    const t = looseText(raw)
    if (t) {
      const k = kinds.find((x) => [x.key, looseText(x.name), looseText(x.unit)].includes(t))
      if (k) return k
      if (countWords.includes(t)) return kinds.find((x) => x.key === 'count')
      if (weightWords.includes(t)) return kinds.find((x) => x.key === 'weight')
      if (volumeWords.includes(t)) return kinds.find((x) => x.key === 'volume')
      return null
    }
    const u = looseText(unit)
    if (weightWords.includes(u)) return kinds.find((x) => x.key === 'weight')
    if (volumeWords.includes(u)) return kinds.find((x) => x.key === 'volume')
    return kinds.find((x) => x.key === 'count')
  }

  // ── Products
  const P = SHEET.products
  const codes = new Map()
  const cleanProducts = []
  for (const p of products) {
    const name = text(p.name, 200)
    const barcode = text(p.barcode, 64)
    if (!name) fail(P, p.row, 'اسم الصنف مطلوب.', 'name')
    const retail = num(p.retail_price)
    if (retail === null || !(retail >= 0))
      fail(P, p.row, 'سعر البيع مطلوب ولا يكون بالسالب.', 'retail_price')
    for (const [k, label] of [
      ['cost_price', 'سعر الشراء'],
      ['reorder_limit', 'حد الطلب']
    ])
      if (num(p[k]) !== null && !(num(p[k]) >= 0)) fail(P, p.row, `${label} لا يكون بالسالب.`, k)
    if (barcode) {
      if (/\s/.test(barcode)) fail(P, p.row, `الباركود (${barcode}) به مسافات.`, 'barcode')
      if (codes.has(barcode))
        fail(
          P,
          p.row,
          `الباركود (${barcode}) مكرر في الملف (الصف ${codes.get(barcode)}).`,
          'barcode'
        )
      else codes.set(barcode, p.row)
    }
    const kind = kindOf(p.unit_kind, p.unit)
    if (!kind) fail(P, p.row, `طريقة القياس "${text(p.unit_kind, 40)}" غير معروفة.`, 'unit_kind')
    else if (!kind.is_active) fail(P, p.row, `طريقة القياس "${kind.name}" موقوفة.`, 'unit_kind')
    const stock = num(p.stock_qty)
    if (kind && stock !== null) {
      try {
        checkStockValue({ key: kind.key, decimals: Number(kind.decimals) }, stock)
      } catch (e) {
        fail(P, p.row, `الكمية (${stock}): ${e.message}`, 'stock_qty')
      }
    }
    // The package, all fields optional together (version 2).
    const packName = text(p.pack_name, 40)
    const packBarcode = text(p.pack_barcode, 64)
    const packAny =
      packName ||
      packBarcode ||
      [p.pack_factor, p.pack_price, p.pack_cost].some((v) => num(v) !== null)
    let pack = null
    if (packAny) {
      if (!packName) fail(P, p.row, 'اكتب اسم العبوة (أو امسح بيانات العبوة).', 'pack_name')
      else if (looseText(packName) === looseText(p.unit))
        fail(P, p.row, `اسم العبوة "${packName}" هو نفس وحدة الصنف.`, 'pack_name')
      let factor = null
      if (num(p.pack_factor) === null) fail(P, p.row, 'عدد الوحدات في العبوة مطلوب.', 'pack_factor')
      else if (kind) {
        try {
          factor = validateFactor(
            { key: kind.key, decimals: Number(kind.decimals) },
            num(p.pack_factor)
          )
          if (factor === 1) {
            fail(P, p.row, 'عدد الوحدات في العبوة يجب أن يكون أكبر من 1.', 'pack_factor')
            factor = null
          }
        } catch (e) {
          fail(P, p.row, e.message, 'pack_factor')
        }
      }
      // Empty = automatic: the piece's selling price × the factor (D-096).
      const price = num(p.pack_price)
      for (const [k, label] of [
        ['pack_price', 'سعر بيع العبوة'],
        ['pack_cost', 'سعر شراء العبوة']
      ])
        if (num(p[k]) !== null && !(num(p[k]) >= 0)) fail(P, p.row, `${label} لا يكون بالسالب.`, k)
      if (packBarcode) {
        if (/\s/.test(packBarcode))
          fail(P, p.row, `باركود العبوة (${packBarcode}) به مسافات.`, 'pack_barcode')
        else if (packBarcode === barcode)
          fail(P, p.row, 'باركود العبوة هو نفس باركود الصنف.', 'pack_barcode')
        else if (codes.has(packBarcode))
          fail(
            P,
            p.row,
            `الباركود (${packBarcode}) مكرر في الملف (الصف ${codes.get(packBarcode)}).`,
            'pack_barcode'
          )
        else codes.set(packBarcode, p.row)
      }
      pack = { name: packName, factor, barcode: packBarcode, price, cost: num(p.pack_cost) }
    }
    cleanProducts.push({
      row: p.row,
      barcode,
      name,
      pack,
      retail: retail ?? 0,
      cost: num(p.cost_price) ?? 0,
      stock: stock ?? 0,
      unit: text(p.unit, 40),
      kind: kind ? kind.key : 'count',
      category: text(p.category, 60),
      reorder: num(p.reorder_limit) ?? 0
    })
  }
  // One query for every barcode of the file (never one per row).
  if (codes.size) {
    const taken = await db.query(
      `SELECT barcode FROM products WHERE barcode = ANY($1::text[])
       UNION SELECT barcode FROM product_barcodes WHERE barcode = ANY($1::text[])`,
      [[...codes.keys()]]
    )
    for (const r of taken.rows)
      fail(P, codes.get(r.barcode), `الباركود (${r.barcode}) مسجل بالفعل في البرنامج.`, 'barcode')
  }

  // ── Customers
  const C = SHEET.customers
  const phonesSeen = new Map()
  const cleanCustomers = []
  for (const c of customers) {
    const name = text(c.name, 120)
    if (!name) fail(C, c.row, 'اسم العميل مطلوب.', 'name')
    const { phones, error } = normalizePhones([c.phone, c.phone2])
    if (error) fail(C, c.row, error, 'phone')
    for (const ph of phones) {
      if (phonesSeen.has(ph))
        fail(C, c.row, `الهاتف ${ph} مكرر في الملف (الصف ${phonesSeen.get(ph)}).`, 'phone')
      else phonesSeen.set(ph, c.row)
    }
    const address = text(c.address, 300)
    let addresses = []
    if (address) {
      const a = normalizeAddresses([{ label: 'other', address, isDefault: true }])
      if (a.error) fail(C, c.row, a.error, 'address')
      else addresses = a.addresses
    }
    const balance = num(c.balance) ?? 0
    if (!Number.isFinite(balance)) fail(C, c.row, 'المبلغ المستحق ليس رقماً.', 'balance')
    cleanCustomers.push({ row: c.row, name, phones, addresses, balance })
  }
  if (phonesSeen.size) {
    const taken = await db.query(
      `SELECT p FROM unnest($1::text[]) p
        WHERE EXISTS (SELECT 1 FROM clients
                       WHERE regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = p
                          OR regexp_replace(COALESCE(phone2, ''), '[^0-9+]', '', 'g') = p)`,
      [[...phonesSeen.keys()]]
    )
    for (const r of taken.rows)
      fail(C, phonesSeen.get(r.p), `الهاتف ${r.p} مسجل لعميل آخر بالفعل في البرنامج.`, 'phone')
  }

  // ── Suppliers
  const S = SHEET.suppliers
  const cleanSuppliers = []
  for (const s of suppliers) {
    const name = text(s.name, 120)
    if (!name) fail(S, s.row, 'اسم المورد مطلوب.', 'name')
    const balance = num(s.balance) ?? 0
    if (!Number.isFinite(balance)) fail(S, s.row, 'المبلغ المستحق ليس رقماً.', 'balance')
    cleanSuppliers.push({
      row: s.row,
      name,
      phone: text(s.phone, 40),
      address: text(s.address, 300),
      contact: text(s.contact_person, 120),
      balance
    })
  }

  const summary = {
    products: cleanProducts.length,
    withoutBarcode: cleanProducts.filter((p) => !p.barcode).length,
    packages: cleanProducts.filter((p) => p.pack).length,
    stockLines: cleanProducts.filter((p) => p.stock).length,
    newCategories: [
      ...new Set(
        cleanProducts
          .map((p) => p.category)
          .filter(Boolean)
          .map(looseText)
      )
    ].length,
    customers: cleanCustomers.length,
    customerDebt: Math.round(cleanCustomers.reduce((a, c) => a + c.balance, 0) * 100) / 100,
    suppliers: cleanSuppliers.length,
    supplierDebt: Math.round(cleanSuppliers.reduce((a, s) => a + s.balance, 0) * 100) / 100
  }
  errors.sort((a, b) => a.sheet.localeCompare(b.sheet) || a.row - b.row)
  return {
    errors,
    summary,
    clean: { products: cleanProducts, customers: cleanCustomers, suppliers: cleanSuppliers }
  }
}

function chunks(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * Write checked rows (checkRows(...).clean, without errors) in the caller's transaction.
 * `step(stage, done)` is called before each batch with the rows written so far (all sheets).
 */
async function writeRows(db, ctx, clean, { step = async () => {}, batch = BATCH_ROWS } = {}) {
  const { looseText } = await lib('storeImport')
  const { products, customers, suppliers } = clean
  let done = 0

  // ── Categories: the existing ones by name, the new ones in one statement, in file order.
  const cats = new Map(
    (await db.query('SELECT id, name FROM categories')).rows.map((c) => [looseText(c.name), c])
  )
  const fresh = []
  for (const p of products) {
    const key = p.category && looseText(p.category)
    if (key && !cats.has(key) && !fresh.some((f) => f.key === key))
      fresh.push({ key, name: p.category })
  }
  if (fresh.length) {
    const made = await db.query(
      `INSERT INTO categories (name, sort_order)
       SELECT n, o + (SELECT COALESCE(max(sort_order), 0) FROM categories)
         FROM unnest($1::text[]) WITH ORDINALITY AS x(n, o) ORDER BY o
       RETURNING id, name`,
      [fresh.map((f) => f.name)]
    )
    for (const c of made.rows) cats.set(looseText(c.name), c)
  }
  const categoryOf = (name) => (name ? cats.get(looseText(name)) : null) || { id: null, name: '' }

  // ── Internal codes for products without a barcode: the next free HM numbers.
  if (products.some((p) => !p.barcode)) {
    const used = new Set(
      (
        await db.query(
          `SELECT barcode FROM products WHERE barcode ~ '^HM[0-9]{6}$'
           UNION SELECT barcode FROM product_barcodes WHERE barcode ~ '^HM[0-9]{6}$'`
        )
      ).rows.map((r) => r.barcode)
    )
    // After the highest internal code of a product, as before; a code taken anywhere (another
    // product's, a package's, or one written in the file) is skipped.
    let next = Number(
      (
        await db.query(
          `SELECT COALESCE(max(substring(barcode FROM 3)::int), 0) AS n FROM products WHERE barcode ~ '^HM[0-9]{6}$'`
        )
      ).rows[0].n
    )
    for (const p of products) {
      if (p.barcode) used.add(p.barcode)
      if (p.pack?.barcode) used.add(p.pack.barcode)
    }
    for (const p of products) {
      if (p.barcode) continue
      let code
      do code = `HM${String(++next).padStart(6, '0')}`
      while (used.has(code))
      used.add(code)
      p.code = code
    }
  }
  const codeOf = (p) => p.barcode || p.code

  // ── Products, their package and its barcode, their opening stock: batch by batch.
  for (const part of chunks(products, batch)) {
    await step('products', done)
    const cat = part.map((p) => categoryOf(p.category))
    await db.query(
      `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, reorder_limit, unit, unit_kind, category_id, category, is_active)
       SELECT b, n, c, r, 0, o, u, k, ci, cn, true
         FROM unnest($1::text[], $2::text[], $3::numeric[], $4::numeric[], $5::numeric[], $6::text[], $7::text[], $8::int[], $9::text[])
           AS x(b, n, c, r, o, u, k, ci, cn)`,
      [
        part.map(codeOf),
        part.map((p) => p.name),
        part.map((p) => p.cost),
        part.map((p) => p.retail),
        part.map((p) => p.reorder),
        part.map((p) => p.unit),
        part.map((p) => p.kind),
        cat.map((c) => c.id),
        cat.map((c) => c.name)
      ]
    )
    const packed = part.filter((p) => p.pack)
    if (packed.length) {
      const units = await db.query(
        `INSERT INTO product_units (product_barcode, name, factor, retail_price, retail_auto, sellable, purchasable, purchase_cost)
         SELECT b, n, f, r, r IS NULL, true, true, c
           FROM unnest($1::text[], $2::text[], $3::numeric[], $4::numeric[], $5::numeric[]) AS x(b, n, f, r, c)
         RETURNING id, product_barcode`,
        [
          packed.map(codeOf),
          packed.map((p) => p.pack.name),
          packed.map((p) => p.pack.factor),
          packed.map((p) => p.pack.price),
          packed.map((p) => p.pack.cost)
        ]
      )
      const unitOf = new Map(units.rows.map((u) => [u.product_barcode, u.id]))
      const coded = packed.filter((p) => p.pack.barcode)
      if (coded.length)
        await db.query(
          `INSERT INTO product_barcodes (barcode, product_barcode, unit_id)
           SELECT * FROM unnest($1::text[], $2::text[], $3::int[])`,
          [
            coded.map((p) => p.pack.barcode),
            coded.map(codeOf),
            coded.map((p) => unitOf.get(codeOf(p)))
          ]
        )
    }
    const stocked = part.filter((p) => p.stock)
    if (stocked.length)
      await db.query(
        `INSERT INTO stock_movements (product_barcode, qty, kind, unit_cost, balance_after, ref_type, reason, user_id)
         SELECT b, q, 'opening', c, 0, 'import', 'رصيد أول من ملف الاستيراد', $4::int
           FROM unnest($1::text[], $2::numeric[], $3::numeric[]) AS x(b, q, c)`,
        [
          stocked.map(codeOf),
          stocked.map((p) => p.stock),
          stocked.map((p) => p.cost || null),
          ctx?.user?.id ?? null
        ]
      )
    done += part.length
  }

  // ── Customers and suppliers: one at a time (each needs its own number for its address and
  // ledger line; the customer-code trigger takes the next code in order).
  const OPENING = 'رصيد افتتاحي (استيراد)'
  for (const [i, c] of customers.entries()) {
    if (i % batch === 0) await step('customers', done)
    const r = await db.query(
      `INSERT INTO clients (name, phone, phone2, address, debt_balance, points, created_at)
       VALUES ($1, $2, $3, $4, $5, 0, LOCALTIMESTAMP(0)) RETURNING id`,
      [c.name, c.phones[0] || null, c.phones[1] || null, c.addresses[0]?.address || '', c.balance]
    )
    const id = r.rows[0].id
    for (const a of c.addresses)
      await db.query(
        'INSERT INTO client_addresses (client_id, label, address, details, is_default) VALUES ($1, $2, $3, $4, $5)',
        [id, a.label, a.address, a.details, a.isDefault]
      )
    if (c.balance)
      await db.query(
        `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES ($1, 'opening', $2, $3, LOCALTIMESTAMP(0))`,
        [id, c.balance, OPENING]
      )
    done += 1
  }
  for (const [i, s] of suppliers.entries()) {
    if (i % batch === 0) await step('suppliers', done)
    const r = await db.query(
      `INSERT INTO suppliers (name, phone, address, contact_person, debt_balance, created_at)
       VALUES ($1, $2, $3, $4, $5, LOCALTIMESTAMP(0)) RETURNING id`,
      [s.name, s.phone, s.address, s.contact, s.balance]
    )
    if (s.balance)
      await db.query(
        `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES ($1, 'opening', $2, $3, LOCALTIMESTAMP(0))`,
        [r.rows[0].id, s.balance, OPENING]
      )
    done += 1
  }
  await step('finishing', done)
  return done
}

module.exports = { checkRows, writeRows, BATCH_ROWS, SHEET }
