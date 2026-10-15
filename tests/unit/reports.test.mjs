import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildShiftReportLines,
  buildMomknReportLines,
  buildWalletsReportLines
} from '../../src/shared/reportLines.mjs'

const store = { name: 'هيرو ماركت', branch: 'الفرع الرئيسي' }
const shift = { id: 12, username: 'cashier1', initial_cash: 200, start_time: '2026-10-14 08:00:00' }

test('shift-close report prints the closing figures, not an empty sale receipt (K-32)', () => {
  const lines = buildShiftReportLines(
    {
      shift,
      cashSales: 1500,
      inflow: 50,
      outflow: 120.5,
      expected: 1629.5,
      actual: 1600,
      difference: -29.5,
      momkn: {
        startBalance: 1000,
        expectedDigitalBalance: 700,
        totalCashImpact: 300,
        totalCommission: 6
      },
      wallets: { expectedVfcashDigitalBalance: 400, totalCashImpact: 100, totalCommission: 2 }
    },
    { store, paper: '80mm', printedAt: '14/10/2026, 22:05:00' }
  )
  assert.equal(lines[0], '[C]هيرو ماركت')
  assert.ok(lines.includes('[C][BIG]تقرير تقفيل الوردية'))
  assert.ok(lines.includes('[C]الوردية #12'))
  assert.ok(lines.includes('الكاشير|cashier1'))
  assert.ok(lines.includes('العهدة الافتتاحية|200.00 ج.م'))
  assert.ok(lines.includes('مبيعات نقدية|1500.00 ج.م'))
  assert.ok(lines.includes('[B]المتوقع في الدرج|1629.50 ج.م'))
  assert.ok(lines.includes('[B]الفرق (عجز)|-29.50 ج.م'))
  assert.ok(lines.includes('الرصيد المتوقع|700.00 ج.م'))
  assert.ok(lines.includes('فودافون كاش المتوقع|400.00 ج.م'))
  assert.ok(!lines.some((l) => l.includes('فاتورة بيع')), 'not a sale receipt')
  assert.ok(lines.includes('-'.repeat(48)))
})

test('till reports carry their summaries; values cannot inject printer syntax', () => {
  const m = buildMomknReportLines(
    {
      shift: { id: 3, username: '[LOGO]x|y' },
      transactions: [{}, {}],
      summary: {
        startBalance: 1000,
        expectedDigitalBalance: 800,
        startCash: 50,
        totalCashImpact: 200,
        expectedCash: 250,
        totalCommission: 4
      }
    },
    { store, paper: '58mm' }
  )
  assert.ok(m.includes('[B]الرصيد المتوقع|800.00 ج.م'))
  assert.ok(m.includes('[B]كاش الماكينة المتوقع|250.00 ج.م'))
  assert.ok(m.includes('عدد العمليات|2'))
  assert.ok(m.includes('الكاشير|x y'), 'tags and column separators stripped')
  assert.ok(m.includes('-'.repeat(32)), '58 mm width')
  const w = buildWalletsReportLines(
    { shift, transactions: [], summary: { expectedVfcashDigitalBalance: 0, expectedCash: 90 } },
    { store }
  )
  assert.ok(w.includes('[C][BIG]تقرير المحافظ والتحويلات'))
  assert.ok(w.includes('[B]كاش المحافظ المتوقع|90.00 ج.م'))
})
