import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { businessView, compareViews } = createRequire(import.meta.url)(
  '../../scripts/golive-check.js'
)

const store = () => ({
  products: [
    { barcode: '00515', stock_qty: 12, retail_price: 13, cost_price: 11 },
    { barcode: '6223001876366', stock_qty: '111', retail_price: '13.5', cost_price: '11' }
  ],
  clients: [{ id: 1, debt_balance: 40.25 }],
  suppliers: [{ id: 3, debt_balance: '0' }],
  sales: [
    { id: 1, timestamp: '2026-10-01 09:15:00', total_amount: 26, payment_type: 'cash' },
    { id: 2, timestamp: '2026-10-01 10:00:00', total_amount: '13.5', payment_type: 'cash' },
    { id: 3, timestamp: '2026-10-02T08:00:00', total_amount: 50, payment_type: 'credit' }
  ]
})

test('golive: SQLite numbers and PostgreSQL numeric text give the same view', () => {
  const legacy = store()
  const pg = store()
  pg.products[0] = { barcode: '00515', stock_qty: '12', retail_price: '13.00', cost_price: '11' }
  pg.clients[0].debt_balance = '40.25'
  pg.sales[2].timestamp = '2026-10-02 08:00:00'
  assert.deepEqual(compareViews(businessView(legacy), businessView(pg)), [])
  const v = businessView(legacy)
  assert.deepEqual(v.salesByDay['2026-10-01 cash'], { count: 2, total: 39.5 })
  assert.equal(v.totals.stockUnits, 123)
})

test('golive: stock, balance, sales and missing-row differences are all reported', () => {
  const a = businessView(store())
  const changed = store()
  changed.products[1].stock_qty = 110
  changed.clients[0].debt_balance = 40
  changed.sales.pop()
  changed.suppliers = []
  const diffs = compareViews(a, businessView(changed))
  for (const expected of [
    'products 6223001876366',
    'clients 1',
    'suppliers 3',
    'salesByDay 2026-10-02 credit',
    'total sales',
    'total stockUnits'
  ])
    assert.ok(
      diffs.some((d) => d.startsWith(expected)),
      `missing ${expected} in ${diffs.join(' | ')}`
    )
})
