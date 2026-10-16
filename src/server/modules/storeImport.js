'use strict'
// Import of the store's starting data from the owner's Excel template (1.4.0).
//
// The screen reads the workbook (src/shared/storeImport.mjs) and sends its rows here. Every row
// is checked again – required fields, prices, the measurement kind and its decimals, duplicate
// barcodes and phone numbers in the file and in the database – and nothing is written unless all
// rows are valid. Then everything is written in one transaction, through the same rules as the
// screens: products with stock 0 and an 'opening' stock movement (the ledger stays exact),
// categories created by name, customers and suppliers with their opening balance and a ledger
// line "رصيد افتتاحي". A product without a barcode gets an internal code (HM000001…), found by
// name or category at the till. Existing records are never changed: a barcode or phone number
// already in the store is reported, not overwritten.
const path = require('path')
const { pathToFileURL } = require('url')
const { badRequest } = require('../errors')
const { postMovement } = require('../inventory/stock')
const { checkStockValue } = require('../inventory/units')

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

const rowSchema = { type: 'object', properties: { row: { type: 'integer' } } }
const list = (max) => ({ type: 'array', maxItems: max, items: rowSchema })

module.exports = function storeImportModule(app) {
  app.operation({
    name: 'storeImport.apply',
    permission: ['products.manage', 'customers.manage', 'suppliers.manage'],
    bodyLimit: 64 * 1024 * 1024,
    schema: {
      type: 'object',
      properties: {
        products: list(20000),
        customers: list(20000),
        suppliers: list(2000),
        // true: check only, write nothing (the screen's preview).
        dryRun: { type: 'boolean' }
      }
    },
    handler: async (ctx, body) => {
      const { looseText } = await lib('storeImport')
      const { normalizePhones } = await lib('phone')
      const { normalizeAddresses } = await lib('address')
      const products = body.products || []
      const customers = body.customers || []
      const suppliers = body.suppliers || []
      if (!products.length && !customers.length && !suppliers.length)
        throw badRequest('لا توجد صفوف للاستيراد.')

      return ctx.tx(async (db) => {
        const errors = []
        const fail = (sheet, row, message) => errors.push({ sheet, row, message })
        const text = (v, max) =>
          String(v ?? '')
            .trim()
            .slice(0, max)
        const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

        // ── Measurement kinds: by name, unit or key; built-in words; empty = from the unit.
        const kinds = (
          await db.query('SELECT key, name, unit, decimals, is_active FROM measure_kinds')
        ).rows
        const kindOf = (raw, unit) => {
          const t = looseText(raw)
          if (t) {
            const k = kinds.find((x) => [x.key, looseText(x.name), looseText(x.unit)].includes(t))
            if (k) return k
            if (COUNT_WORDS.map(looseText).includes(t)) return kinds.find((x) => x.key === 'count')
            if (WEIGHT_WORDS.map(looseText).includes(t))
              return kinds.find((x) => x.key === 'weight')
            if (VOLUME_WORDS.map(looseText).includes(t))
              return kinds.find((x) => x.key === 'volume')
            return null
          }
          const u = looseText(unit)
          if (WEIGHT_WORDS.map(looseText).includes(u)) return kinds.find((x) => x.key === 'weight')
          if (VOLUME_WORDS.map(looseText).includes(u)) return kinds.find((x) => x.key === 'volume')
          return kinds.find((x) => x.key === 'count')
        }

        // ── Products
        const P = 'الأصناف'
        const codes = new Map()
        const cleanProducts = []
        for (const p of products) {
          const name = text(p.name, 200)
          const barcode = text(p.barcode, 64)
          if (!name) fail(P, p.row, 'اسم الصنف مطلوب.')
          const retail = num(p.retail_price)
          if (retail === null || !(retail >= 0)) fail(P, p.row, 'سعر البيع مطلوب ولا يكون بالسالب.')
          for (const [k, label] of [
            ['cost_price', 'سعر الشراء'],
            ['wholesale_price', 'سعر الجملة'],
            ['reorder_limit', 'حد الطلب']
          ])
            if (num(p[k]) !== null && !(num(p[k]) >= 0)) fail(P, p.row, `${label} لا يكون بالسالب.`)
          if (barcode) {
            if (/\s/.test(barcode)) fail(P, p.row, `الباركود (${barcode}) به مسافات.`)
            if (codes.has(barcode))
              fail(P, p.row, `الباركود (${barcode}) مكرر في الملف (الصف ${codes.get(barcode)}).`)
            else codes.set(barcode, p.row)
          }
          const kind = kindOf(p.unit_kind, p.unit)
          if (!kind) fail(P, p.row, `طريقة القياس "${text(p.unit_kind, 40)}" غير معروفة.`)
          else if (!kind.is_active) fail(P, p.row, `طريقة القياس "${kind.name}" موقوفة.`)
          const stock = num(p.stock_qty)
          if (kind && stock !== null) {
            try {
              checkStockValue({ key: kind.key, decimals: Number(kind.decimals) }, stock)
            } catch (e) {
              fail(P, p.row, `الكمية (${stock}): ${e.message}`)
            }
          }
          cleanProducts.push({
            row: p.row,
            barcode,
            name,
            retail: retail ?? 0,
            cost: num(p.cost_price) ?? 0,
            wholesale: num(p.wholesale_price) ?? 0,
            stock: stock ?? 0,
            unit: text(p.unit, 40),
            kind: kind ? kind.key : 'count',
            category: text(p.category, 60),
            reorder: num(p.reorder_limit) ?? 0
          })
        }
        if (codes.size) {
          const taken = await db.query(
            `SELECT barcode FROM products WHERE barcode = ANY($1::text[])
             UNION SELECT barcode FROM product_barcodes WHERE barcode = ANY($1::text[])`,
            [[...codes.keys()]]
          )
          for (const r of taken.rows)
            fail(P, codes.get(r.barcode), `الباركود (${r.barcode}) مسجل بالفعل في البرنامج.`)
        }

        // ── Customers
        const C = 'العملاء'
        const phonesSeen = new Map()
        const cleanCustomers = []
        for (const c of customers) {
          const name = text(c.name, 120)
          if (!name) fail(C, c.row, 'اسم العميل مطلوب.')
          const { phones, error } = normalizePhones([c.phone, c.phone2])
          if (error) fail(C, c.row, error)
          for (const ph of phones) {
            if (phonesSeen.has(ph))
              fail(C, c.row, `الهاتف ${ph} مكرر في الملف (الصف ${phonesSeen.get(ph)}).`)
            else phonesSeen.set(ph, c.row)
          }
          const address = text(c.address, 300)
          let addresses = []
          if (address) {
            const a = normalizeAddresses([{ label: 'other', address, isDefault: true }])
            if (a.error) fail(C, c.row, a.error)
            else addresses = a.addresses
          }
          const balance = num(c.balance) ?? 0
          if (!Number.isFinite(balance)) fail(C, c.row, 'المبلغ المستحق ليس رقماً.')
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
            fail(C, phonesSeen.get(r.p), `الهاتف ${r.p} مسجل لعميل آخر بالفعل في البرنامج.`)
        }

        // ── Suppliers
        const S = 'الموردون'
        const cleanSuppliers = []
        for (const s of suppliers) {
          const name = text(s.name, 120)
          if (!name) fail(S, s.row, 'اسم المورد مطلوب.')
          const balance = num(s.balance) ?? 0
          if (!Number.isFinite(balance)) fail(S, s.row, 'المبلغ المستحق ليس رقماً.')
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
        if (errors.length || body.dryRun)
          return { ok: !errors.length, errors, summary, written: false }

        // ── Write (one transaction; any failure undoes everything).
        const cats = new Map(
          (await db.query('SELECT id, name FROM categories')).rows.map((c) => [
            looseText(c.name),
            c
          ])
        )
        let order = Number(
          (await db.query('SELECT COALESCE(max(sort_order), 0) AS n FROM categories')).rows[0].n
        )
        const categoryFor = async (name) => {
          if (!name) return { id: null, name: '' }
          const key = looseText(name)
          if (!cats.has(key)) {
            const r = await db.query(
              'INSERT INTO categories (name, sort_order) VALUES ($1, $2) RETURNING id, name',
              [name, ++order]
            )
            cats.set(key, r.rows[0])
          }
          return cats.get(key)
        }
        let next = Number(
          (
            await db.query(
              `SELECT COALESCE(max(substring(barcode FROM 3)::int), 0) AS n FROM products WHERE barcode ~ '^HM[0-9]{6}$'`
            )
          ).rows[0].n
        )
        const internalCode = async () => {
          for (;;) {
            const code = `HM${String(++next).padStart(6, '0')}`
            const used = await db.query(
              'SELECT 1 FROM products WHERE barcode = $1 UNION SELECT 1 FROM product_barcodes WHERE barcode = $1',
              [code]
            )
            if (!used.rowCount) return code
          }
        }
        for (const p of cleanProducts) {
          const barcode = p.barcode || (await internalCode())
          const cat = await categoryFor(p.category)
          await db.query(
            `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, reorder_limit, unit, unit_kind, category_id, category, is_active)
             VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, true)`,
            [
              barcode,
              p.name,
              p.cost,
              p.retail,
              p.wholesale,
              p.reorder,
              p.unit,
              p.kind,
              cat.id,
              cat.name
            ]
          )
          if (p.stock)
            await postMovement(db, ctx, {
              barcode,
              qty: p.stock,
              kind: 'opening',
              unitCost: p.cost || null,
              refType: 'import',
              reason: 'رصيد أول من ملف الاستيراد'
            })
        }
        const OPENING = 'رصيد افتتاحي (استيراد)'
        for (const c of cleanCustomers) {
          const r = await db.query(
            `INSERT INTO clients (name, phone, phone2, address, debt_balance, points, created_at)
             VALUES ($1, $2, $3, $4, $5, 0, LOCALTIMESTAMP(0)) RETURNING id`,
            [
              c.name,
              c.phones[0] || null,
              c.phones[1] || null,
              c.addresses[0]?.address || '',
              c.balance
            ]
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
        }
        for (const s of cleanSuppliers) {
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
        }
        await ctx.audit(
          db,
          'store_import',
          `استيراد بيانات المتجر: ${summary.products} صنف، ${summary.customers} عميل، ${summary.suppliers} مورد`,
          summary
        )
        return { ok: true, errors: [], summary, written: true }
      })
    }
  })
}
