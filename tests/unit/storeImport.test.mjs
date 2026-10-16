// Reading the store-data workbook (1.4.0): the template round-trips, and filled sheets become rows.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import writeExcelFile from 'write-excel-file/node'
import readExcelFile from 'read-excel-file/node'
import {
  SHEETS,
  templateSheets,
  readWorkbook,
  cellNumber,
  cellText
} from '../../src/shared/storeImport.mjs'

const roundTrip = async (sheets) => readExcelFile(await writeExcelFile(sheets).toBuffer())

test('the template has the three sheets with their headers and reads back empty', async () => {
  const sheets = await roundTrip(templateSheets({ rows: 20 }))
  assert.deepEqual(
    sheets.map((s) => s.sheet),
    ['تعليمات', 'الأصناف', 'العملاء', 'الموردون']
  )
  const r = readWorkbook(sheets)
  assert.deepEqual(r.found, ['الأصناف', 'العملاء', 'الموردون'])
  assert.equal(r.products.length + r.customers.length + r.suppliers.length, 0)
  assert.deepEqual(r.errors, [])
})

test('a filled workbook becomes rows; headers may be in any order, with extra columns', async () => {
  const products = [
    ['ملاحظة', 'اسم الصنف *', 'الباركود', 'سعر البيع', 'الكمية الحالية', 'الوحدة', 'التصنيف'],
    ['', 'زبادي', '0012345', '٧٫٥', '48', 'علبة', 'ألبان'],
    ['', 'جبنة رومي', null, '240 ج.م', 12.5, 'كيلو', 'ألبان'],
    [],
    ['', 'سكر', 6221234567890, '1,250', null, 'كيس', '']
  ]
  const customers = [
    ['اسم العميل', 'الهاتف', 'المبلغ المستحق على العميل'],
    ['محمد', '01001234567', '350'],
    ['منى', 1012345678, '-20']
  ]
  const sheets = await roundTrip([
    { sheet: 'الأصناف', data: products },
    { sheet: 'العملاء', data: customers }
  ])
  const r = readWorkbook(sheets)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(
    r.products.map((p) => [p.row, p.name, p.barcode, p.retail_price, p.stock_qty, p.category]),
    [
      [2, 'زبادي', '0012345', 7.5, 48, 'ألبان'],
      [3, 'جبنة رومي', '', 240, 12.5, 'ألبان'],
      [5, 'سكر', '6221234567890', 1250, null, '']
    ]
  )
  assert.deepEqual(
    r.customers.map((c) => [c.name, c.phone, c.balance]),
    [
      ['محمد', '01001234567', 350],
      ['منى', '1012345678', -20]
    ]
  )
  assert.equal(r.suppliers.length, 0)
})

test('problems are reported with their sheet and row', async () => {
  const sheets = await roundTrip([
    {
      sheet: 'الأصناف',
      data: [
        ['اسم الصنف', 'سعر البيع', 'سعر الشراء'],
        ['', '5', ''],
        ['شاي', 'خمسة', ''],
        ['قهوة', '30', '-2']
      ]
    },
    { sheet: 'أخرى', data: [['عنوان'], ['x']] }
  ])
  const r = readWorkbook(sheets)
  assert.deepEqual(
    r.errors.map((e) => [e.sheet, e.row, e.message]),
    [
      ['الأصناف', 2, '"اسم الصنف" مطلوب.'],
      ['الأصناف', 3, '"سعر البيع" ليس رقماً (خمسة).'],
      ['الأصناف', 4, '"سعر الشراء" لا يكون بالسالب.']
    ]
  )
  assert.match(readWorkbook([{ sheet: 'x', data: [['a']] }]).errors[0].message, /قالب HeroMarket/)
})

test('cells: Arabic digits, separators and currency; whole numbers as text without exponent', () => {
  assert.deepEqual(cellNumber('١٢٫٥'), { value: 12.5 })
  assert.deepEqual(cellNumber('1,250.75 ج.م'), { value: 1250.75 })
  assert.deepEqual(cellNumber(''), { value: null })
  assert.equal(cellNumber('abc').error, true)
  assert.equal(cellText(6221234567890), '6221234567890')
  assert.equal(cellText('٠١٠٠'), '0100')
  assert.ok(SHEETS.products.columns.some((c) => c.key === 'unit_kind'))
})
