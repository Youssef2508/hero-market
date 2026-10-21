// Close report (owner feedback SHIFT-02): printed from the saved close snapshot, with every field
// the specification lists; the same snapshot prints the same lines every time (reprint).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCloseReportLines,
  buildShiftReportLines,
  REPORTS
} from '../../src/shared/reportLines.mjs'

const report = {
  shiftId: 8,
  cashier: 'cashier1',
  openedAt: '2026-10-21 08:00:00',
  closedAt: '2026-10-21 20:00:00',
  openingFloat: 200,
  invoiceCount: 4,
  totalSales: 95,
  onAccountSales: 0,
  salesByMethod: { cash: 35, visa: 25, wallet: 10, instapay: 25 },
  cash: { sales: 35, inflow: 40, expenses: 15, refunds: 10, supplier: 0 },
  expenses: { count: 1, total: 15, lines: [{ category: 'عام', description: '', amount: 15 }] },
  returns: {
    count: 2,
    total: 35,
    lines: [
      { saleId: 3, refund: 25 },
      { saleId: 2, refund: 10 }
    ]
  },
  manualDiscounts: { count: 1, total: 2, invoices: [{ saleId: 4, amount: 2, username: 'owner' }] },
  expected: { cash: 250, visa: 10, wallet: 0, instapay: 35 },
  actual: { cash: 240, visa: 10, wallet: 5, instapay: 35 },
  variance: { cash: -10, visa: 0, wallet: 5, instapay: 0 },
  netTotal: 290,
  acknowledgedBy: 'manager',
  note: 'فكة'
}
const opts = { store: { name: 'سوبر ماركت تجربة' }, paper: '80mm', printedAt: '21/10/2026, 20:01' }

test('the close report prints every SHIFT-02 field from the snapshot', () => {
  const text = buildCloseReportLines(report, opts).join('\n')
  for (const s of [
    'الوردية #8',
    'cashier1',
    'بداية الوردية: 2026-10-21 08:00:00',
    'نهاية الوردية: 2026-10-21 20:00:00',
    'طُبع في',
    'فيزا|25.00 ج.م',
    'محفظة|10.00 ج.م',
    'انستا باي|25.00 ج.م',
    'إجمالي المبيعات|95.00 ج.م',
    'عدد الفواتير|4',
    'العهدة الافتتاحية|200.00 ج.م',
    'مصروفات نقدية|15.00 ج.م',
    'مرتجعات نقدية|10.00 ج.م',
    'فاتورة #3|25.00 ج.م',
    'إجمالي الخصم اليدوي|2.00 ج.م',
    'الفرق|عجز 10.00',
    'الفرق|زيادة 5.00',
    'صافي الوردية (الفعلي)|290.00 ج.م',
    'اعتمد الفرق|manager',
    'ملاحظات: فكة'
  ])
    assert.ok(text.includes(s), s)
})

test('a reprint of the same snapshot prints the same lines; the shift report uses it', () => {
  const a = buildCloseReportLines(report, opts)
  assert.deepEqual(REPORTS.close({ report }, opts), a)
  assert.deepEqual(buildShiftReportLines({ report }, opts), a)
  // Till sections (multi-till close) are added before the footer.
  const withTills = buildShiftReportLines({ report, momkn: { startBalance: 1 } }, opts)
  assert.ok(withTills.join('\n').includes('ماكينة ممكن'))
  assert.equal(withTills.at(-1), a.at(-1))
})

test('values cannot inject printer tags or columns', () => {
  const bad = { ...report, cashier: '[BIG]x|y', note: '[C]a|b' }
  const text = buildCloseReportLines(bad, opts).join('\n')
  assert.ok(!text.includes('[BIG]x'))
  assert.ok(text.includes('ملاحظات: a b'))
})

test('the close report prints the totals of the four methods and what the money was (D-064)', () => {
  const rep = {
    ...report,
    expectedTotal: 295,
    actualTotal: 290,
    varianceTotal: -5,
    creditSales: { count: 2, total: 80 },
    partialSales: { count: 1, total: 30, paidNow: 10, unpaid: 20 },
    collections: 35,
    supplierPayments: { withInvoices: 400, settlements: 200 },
    treasuryTransfers: { cash: 240, visa: 10, wallet: 5, instapay: 35 }
  }
  const text = buildCloseReportLines(rep, opts).join('\n')
  for (const s of [
    '[C]الإجمالي',
    'المتوقع|295.00 ج.م',
    'الفعلي|290.00 ج.م',
    'الفرق|عجز 5.00',
    'مبيعات آجل (2)|80.00 ج.م',
    'مدفوع منها|10.00 ج.م',
    'متبقي على العملاء|20.00 ج.م',
    'تحصيلات ديون عملاء|35.00 ج.م',
    'مدفوعات فواتير موردين|400.00 ج.م',
    'سداد مديونيات موردين|200.00 ج.م',
    '[C]المحوَّل إلى الخزنة',
    'انستا باي|35.00 ج.م'
  ])
    assert.ok(text.includes(s), s)
})
