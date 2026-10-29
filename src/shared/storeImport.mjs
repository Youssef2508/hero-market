// Store data import from an Excel file (1.4.0): the template's columns and the reading of a
// filled-in workbook into rows. Shared by the import screen (reads the file) and the tests; the
// service checks every row again before writing anything (src/server/modules/storeImport.js).
//
// The owner fills one workbook with three sheets: الأصناف, العملاء, الموردون. Headers are matched
// by name (order does not matter, extra columns are ignored), so a sheet copied from another
// program works as long as the header row has these names.
//
// The export (DATA-01, D-067) writes the same sheets and headers, so an exported file can be
// reviewed, edited and imported again. Compatibility rule: a column is only ever added as
// optional; required columns are never added, renamed or removed without raising
// TEMPLATE_VERSION, and a file of a newer version than this program is refused. Files without a
// version (1.4.0 templates) are version 1 and import unchanged.
//
// Whenever a feature adds, removes or renames a product, customer or supplier field, check its
// place here (template, export and import validation in modules/storeImport.js) and in the
// round-trip test (tests/service/dataExport.test.js).

/** Version of the template; written in the instructions sheet of templates and exports. */
export const TEMPLATE_VERSION = 2
export const VERSION_LABEL = 'إصدار القالب'

export const SHEETS = {
  products: {
    name: 'الأصناف',
    columns: [
      {
        key: 'barcode',
        header: 'الباركود',
        hint: 'اختياري. اكتبه كما هو على العبوة. بدون باركود يُعطى الصنف كوداً داخلياً.'
      },
      { key: 'name', header: 'اسم الصنف', required: true, hint: 'مطلوب.' },
      {
        key: 'retail_price',
        header: 'سعر البيع',
        required: true,
        number: true,
        hint: 'مطلوب. سعر الوحدة للجمهور.'
      },
      { key: 'cost_price', header: 'سعر الشراء', number: true, hint: 'تكلفة الوحدة من المورد.' },
      {
        key: 'stock_qty',
        header: 'الكمية الحالية',
        number: true,
        signed: true,
        hint: 'الموجود الآن في المحل.'
      },
      { key: 'unit', header: 'الوحدة', hint: 'مثل: قطعة، علبة، كيلو، لتر.' },
      {
        key: 'unit_kind',
        header: 'طريقة القياس',
        hint: 'بالعدد أو بالوزن أو بالحجم (أو طريقة أضفتها). فارغ = حسب الوحدة.'
      },
      { key: 'category', header: 'التصنيف', hint: 'يُنشأ تلقائياً إذا لم يكن موجوداً.' },
      {
        key: 'reorder_limit',
        header: 'حد الطلب',
        number: true,
        hint: 'ينبّه عندما يقل المخزون عنه.'
      },
      // One package (carton, box…) of the product, all optional (INV-01, version 2). Stock stays
      // in the product's own unit; the package is sold and bought by its own barcode and price.
      {
        key: 'pack_name',
        header: 'اسم العبوة',
        hint: 'اختياري: كرتونة، علبة… اتركه فارغاً للصنف بلا عبوة.'
      },
      {
        key: 'pack_factor',
        header: 'عدد الوحدات في العبوة',
        number: true,
        hint: 'مطلوب مع اسم العبوة. عدد صحيح للأصناف بالعدد (مثلاً 10).'
      },
      { key: 'pack_barcode', header: 'باركود العبوة', hint: 'اختياري. باركود العبوة كاملة.' },
      {
        key: 'pack_price',
        header: 'سعر بيع العبوة',
        number: true,
        hint: 'سعر العبوة كاملة. فارغ = تلقائي: سعر بيع الوحدة × عدد الوحدات في العبوة.'
      },
      {
        key: 'pack_cost',
        header: 'سعر شراء العبوة',
        number: true,
        hint: 'اختياري: يظهر تلقائياً في فاتورة الشراء.'
      }
    ]
  },
  customers: {
    name: 'العملاء',
    columns: [
      { key: 'name', header: 'اسم العميل', required: true, hint: 'مطلوب.' },
      { key: 'phone', header: 'الهاتف', hint: 'رقم واحد في الخانة.' },
      { key: 'phone2', header: 'هاتف آخر' },
      { key: 'address', header: 'العنوان' },
      {
        key: 'balance',
        header: 'المبلغ المستحق على العميل',
        number: true,
        signed: true,
        hint: 'ما عليه للمحل (آجل). بالسالب إذا كان له رصيد.'
      }
    ]
  },
  suppliers: {
    name: 'الموردون',
    columns: [
      { key: 'name', header: 'اسم المورد', required: true, hint: 'مطلوب.' },
      { key: 'phone', header: 'الهاتف' },
      { key: 'address', header: 'العنوان' },
      { key: 'contact_person', header: 'اسم المسؤول' },
      {
        key: 'balance',
        header: 'المبلغ المستحق للمورد',
        number: true,
        signed: true,
        hint: 'ما على المحل للمورد (رصيد افتتاحي). بالسالب إذا كان المورد مديناً للمحل.'
      }
    ]
  }
}

export const LIMITS = { products: 20000, customers: 20000, suppliers: 2000 }

/** Arabic text compared loosely: alef/yaa/taa marbuta forms, tatweel, spaces, * and (…). */
export function looseText(s) {
  return String(s ?? '')
    .replace(/\(.*?\)/g, '')
    .replace(/[*:ـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const DIGITS = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '٫': '.',
  '٬': ','
}

/** A cell as a number: Arabic digits and thousands separators accepted; '' → null. */
export function cellNumber(v) {
  if (v === null || v === undefined || v === '') return { value: null }
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v } : { error: true }
  const s = String(v)
    .replace(/[٠-٩٫٬]/g, (c) => DIGITS[c])
    .replace(/[\s,]/g, '')
    .replace(/(ج\.?م|جنيه|egp)$/i, '')
  if (s === '') return { value: null }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { error: true }
  return { value: Number(s) }
}

/** A cell as text. Whole numbers are written without exponent or decimals (barcodes, phones). */
export function cellText(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) < 1e21) return BigInt(v).toString()
    return String(v)
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
    .replace(/[٠-٩]/g, (c) => DIGITS[c])
    .trim()
}

function findHeader(data, def) {
  const wanted = new Map(def.columns.map((c) => [looseText(c.header), c.key]))
  for (let r = 0; r < Math.min(data.length, 20); r++) {
    const map = {}
    ;(data[r] || []).forEach((cell, i) => {
      const key = wanted.get(looseText(cell))
      if (key && !(key in map)) map[key] = i
    })
    const required = def.columns.filter((c) => c.required).map((c) => c.key)
    if (required.every((k) => k in map)) return { row: r, map }
  }
  return null
}

/**
 * Workbook (as [{ sheet, data: rows of cells }]) → { products, customers, suppliers, errors }.
 * Each row keeps `row`, its line number in the sheet, for messages. Empty rows are skipped.
 */
export function readWorkbook(sheets) {
  const out = { products: [], customers: [], suppliers: [], errors: [], found: [], version: 1 }
  const byName = new Map((sheets || []).map((s) => [looseText(s.sheet), s.data || []]))
  for (const row of byName.get(looseText('تعليمات')) || []) {
    if (looseText(row?.[0]) !== looseText(VERSION_LABEL)) continue
    const v = cellNumber(row[1]).value
    if (v) out.version = v
    break
  }
  if (out.version > TEMPLATE_VERSION) {
    out.errors.push({
      sheet: 'تعليمات',
      row: 0,
      message: `الملف من إصدار أحدث للقالب (${out.version}) من هذا البرنامج (${TEMPLATE_VERSION}). حدّث البرنامج أولاً.`
    })
    return out
  }
  for (const [kind, def] of Object.entries(SHEETS)) {
    // The sheet with the expected name, or else any sheet whose header row fits.
    let data = byName.get(looseText(def.name))
    let header = data ? findHeader(data, def) : null
    if (!header)
      for (const s of sheets || []) {
        const h = findHeader(s.data || [], def)
        if (h) {
          data = s.data
          header = h
          break
        }
      }
    if (!header) {
      if (data)
        out.errors.push({
          sheet: def.name,
          row: 1,
          message: `لم أجد صف العناوين؛ يجب أن يحتوي على: ${def.columns
            .filter((c) => c.required)
            .map((c) => c.header)
            .join('، ')}.`
        })
      continue
    }
    out.found.push(def.name)
    for (let r = header.row + 1; r < data.length; r++) {
      const cells = data[r] || []
      const row = { row: r + 1 }
      const bad = new Set() // one message per cell
      let empty = true
      for (const c of def.columns) {
        const i = header.map[c.key]
        const raw = i === undefined ? null : cells[i]
        if (raw !== null && raw !== undefined && String(raw).trim() !== '') empty = false
        if (c.number) {
          const n = cellNumber(raw)
          if (n.error) {
            bad.add(c.key)
            out.errors.push({
              sheet: def.name,
              row: r + 1,
              message: `"${c.header}" ليس رقماً (${cellText(raw)}).`
            })
          } else if (n.value !== null && n.value < 0 && !c.signed)
            out.errors.push({
              sheet: def.name,
              row: r + 1,
              message: `"${c.header}" لا يكون بالسالب.`
            })
          row[c.key] = n.value ?? null
        } else row[c.key] = cellText(raw)
      }
      if (empty) continue
      for (const c of def.columns)
        if (c.required && !bad.has(c.key) && (row[c.key] === null || row[c.key] === ''))
          out.errors.push({ sheet: def.name, row: r + 1, message: `"${c.header}" مطلوب.` })
      out[kind].push(row)
    }
    if (out[kind].length > LIMITS[kind])
      out.errors.push({
        sheet: def.name,
        row: 1,
        message: `الحد الأقصى ${LIMITS[kind]} صف في المرة الواحدة.`
      })
  }
  if (!out.found.length)
    out.errors.push({
      sheet: '',
      row: 0,
      message: 'الملف لا يحتوي على أوراق الأصناف أو العملاء أو الموردين. استخدم قالب HeroMarket.'
    })
  return out
}

// Columns typed as text so Excel keeps leading zeros and long numbers (barcodes, phones).
const kindOf = (def) => Object.keys(SHEETS).find((k) => SHEETS[k] === def)

const TEXT_KEYS = new Set(['barcode', 'phone', 'phone2', 'pack_barcode'])

/**
 * The template workbook for write-excel-file: an instructions sheet, then one sheet per kind
 * with its header row and `rows` empty, pre-formatted rows.
 */
export function templateSheets({ rows = 500 } = {}) {
  return buildSheets(null, { rows })
}

/**
 * The export (DATA-01): the template's sheets filled with `data` ({ products, customers,
 * suppliers }, rows keyed like the columns). `note` is written in the instructions sheet.
 */
export function exportSheets(data, { note = '' } = {}) {
  return buildSheets(data, { note })
}

function buildSheets(data, { rows = 500, note = '' }) {
  const head = (text) => ({
    value: text,
    fontWeight: 'bold',
    backgroundColor: '#E3F1EA',
    align: 'center'
  })
  const sheets = []
  const help = [
    [
      {
        value: data ? 'بيانات HeroMarket (تصدير)' : 'قالب بيانات HeroMarket',
        fontWeight: 'bold',
        fontSize: 16
      }
    ],
    [VERSION_LABEL, TEMPLATE_VERSION],
    ...(note ? [[note]] : []),
    [''],
    ['املأ الأوراق: الأصناف، العملاء، الموردون. يمكن ترك أي ورقة فارغة.'],
    ['صف واحد لكل صنف أو عميل أو مورد. لا تغيّر أسماء الأعمدة في الصف الأول.'],
    ['الأعمدة المكتوب بجانبها * مطلوبة. الأرقام بدون "ج.م".'],
    ['الباركود والهاتف مكتوبة كنص، فلا تختفي الأصفار في أولها.'],
    ['بعد الانتهاء احفظ الملف (Excel ‎.xlsx) وأرسله.'],
    ['']
  ]
  for (const def of Object.values(SHEETS)) {
    help.push([{ value: `ورقة "${def.name}"`, fontWeight: 'bold' }])
    for (const c of def.columns) help.push([`${c.header}${c.required ? ' *' : ''}`, c.hint || ''])
    help.push([''])
  }
  help.push([{ value: 'أمثلة', fontWeight: 'bold' }])
  help.push([
    'الأصناف: 6221234567890 | زبادي كامل الدسم | 7.5 | 6 | 7 | 48 | علبة | بالعدد | ألبان | 10'
  ])
  help.push([
    'الأصناف (بالوزن): (بدون باركود) | جبنة رومي | 240 | 200 | | 12.5 | كيلو | بالوزن | ألبان'
  ])
  help.push(['العملاء: محمد أحمد | 01001234567 | | شارع النصر 12 | 350'])
  help.push(['الموردون: شركة الألبان المتحدة | 0223456789 | المنطقة الصناعية | أ. سامي | 1200'])
  help.push([
    'الأصناف (بعبوة): 6221234567890 | هوهوز | 10 | 8 | | 95 | قطعة | بالعدد | حلويات | 20 | علبة | 10 | 6221234567999 | 90 | | 80'
  ])
  sheets.push({
    sheet: 'تعليمات',
    data: help,
    columns: [{ width: 34 }, { width: 70 }],
    rightToLeft: true
  })
  for (const def of Object.values(SHEETS)) {
    const header = def.columns.map((c) => head(c.header + (c.required ? ' *' : '')))
    const empty = def.columns.map((c) =>
      TEXT_KEYS.has(c.key) ? { value: '', type: String, format: '@' } : null
    )
    const cell = (c, v) =>
      v === null || v === undefined || v === ''
        ? TEXT_KEYS.has(c.key)
          ? { value: '', type: String, format: '@' }
          : null
        : c.number
          ? { value: Number(v), type: Number }
          : { value: String(v), type: String, ...(TEXT_KEYS.has(c.key) ? { format: '@' } : {}) }
    const body = data
      ? (data[kindOf(def)] || []).map((r) => def.columns.map((c) => cell(c, r[c.key])))
      : Array.from({ length: rows }, () => empty)
    sheets.push({
      sheet: def.name,
      data: [header, ...body],
      columns: def.columns.map((c) => ({
        width: c.key === 'name' ? 34 : c.header.length > 14 ? 26 : 16
      })),
      stickyRowsCount: 1,
      rightToLeft: true
    })
  }
  return sheets
}
