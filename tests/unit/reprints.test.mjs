// POS-02 (D-077): reprints from saved documents, marked as copies. A recorded supplier invoice prints
// its lines, gross, discount, net, paid, still owed and returns; a closing report printed again from
// its saved close carries the copy mark, the first print at the close does not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REPORTS, buildPurchaseLines } from '../../src/shared/reportLines.mjs'

const COPY = '[C][B]*** نسخة معاد طباعتها ***'

test('a supplier invoice prints from its saved purchase, as a copy', () => {
  const detail = {
    purchase: {
      id: 12,
      invoice_ref: 'INV-77',
      supplier_name: 'شركة الألبان',
      timestamp: '2026-10-22 09:30:00',
      gross: 100,
      discount: 10,
      total_amount: 90,
      paid_amount: 40,
      remaining: 50
    },
    items: [
      { name: 'زبادي', qty: 5, unit_name: 'كرتونة', unit_cost: 12, line_total: 60, returned: 1 },
      { name: 'جبنة', qty: 2, unit_name: 'كيلو', unit_cost: 20, line_total: 40, returned: 0 }
    ],
    returns: [{ credit_value: 10.8 }]
  }
  const lines = buildPurchaseLines(detail, { store: { name: 'هيرو ماركت' }, printedAt: 'now' })
  assert.ok(lines.includes(COPY), 'always a copy')
  for (const part of [
    '[C][BIG]فاتورة شراء',
    '[C]رقم INV-77',
    'المورد|شركة الألبان',
    '[R]زبادي',
    '5 كرتونة × 12.00|60.00 ج.م',
    '[R][N]  أُرجع منها 1',
    'إجمالي الأصناف|100.00 ج.م',
    'خصم الفاتورة|10.00 ج.م',
    '[B]صافي الفاتورة|90.00 ج.م',
    'المدفوع عند الشراء|40.00 ج.م',
    'المتبقي عند الشراء|50.00 ج.م',
    'مرتجعات (1)|10.80 ج.م'
  ])
    assert.ok(lines.includes(part), part)
  // Through the same entry the printer uses.
  assert.deepEqual(REPORTS.purchase(detail, { printedAt: 'now' }).slice(0, 3), [
    '[C][BIG]فاتورة شراء',
    COPY,
    '[C]رقم INV-77'
  ])
  // Without a discount or returns those lines are not printed.
  const plain = buildPurchaseLines({ purchase: { ...detail.purchase, discount: 0 }, items: [] })
  assert.ok(!plain.some((l) => l.startsWith('خصم الفاتورة') || l.startsWith('مرتجعات')))
})

test('a closing report printed again is marked as a copy; the first print is not', () => {
  const report = {
    shiftId: 9,
    cashier: 'cashier1',
    openedAt: '2026-10-22 08:00',
    closedAt: '2026-10-22 20:00',
    actual: { cash: 100, visa: 0, wallet: 0, instapay: 0 },
    expected: { cash: 100, visa: 0, wallet: 0, instapay: 0 },
    variance: { cash: 0, visa: 0, wallet: 0, instapay: 0 },
    salesByMethod: { cash: 100 }
  }
  assert.ok(!REPORTS.close({ report }, {}).includes(COPY))
  assert.ok(REPORTS.close({ report, copy: true }, {}).includes(COPY))
})
