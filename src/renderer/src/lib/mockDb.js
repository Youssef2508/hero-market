// ─────────────────────────────────────────────────────────────
// Browser Mock Database
// Used ONLY when window.api (Electron IPC bridge) is unavailable,
// i.e. during browser-based development previews.
// This file is NOT imported in production Electron builds.
// ─────────────────────────────────────────────────────────────

export const mockProducts = [
  {
    barcode: '6223001876366',
    name: 'زبادي المراعي كامل الدسم',
    retail_price: 13.0,
    stock_qty: 120,
    reorder_limit: 20,
    unit: 'علبة'
  },
  {
    barcode: '6223000660515',
    name: 'لوبيا الضحى 500جم',
    retail_price: 112.7,
    stock_qty: 45,
    reorder_limit: 10,
    unit: 'كيس'
  },
  {
    barcode: '6223000660508',
    name: 'فاصوليا الضحى 500جم',
    retail_price: 103.5,
    stock_qty: 3,
    reorder_limit: 5,
    unit: 'كيس'
  },
  {
    barcode: '6223000661512',
    name: 'كمون الضحى علبة',
    retail_price: 24.15,
    stock_qty: 12,
    reorder_limit: 5,
    unit: 'علبة'
  },
  {
    barcode: '00515',
    name: 'جبنة رومي قديم فرط',
    retail_price: 240.0,
    stock_qty: 35,
    reorder_limit: 5,
    unit: 'كجم'
  },
  {
    barcode: '00516',
    name: 'حلاوة طحينية رشيدي فرط',
    retail_price: 180.0,
    stock_qty: 20,
    reorder_limit: 5,
    unit: 'كجم'
  },
  {
    barcode: '6223000661505',
    name: 'فلفل أسود ناعم الضحى',
    retail_price: 25.3,
    stock_qty: 18,
    reorder_limit: 5,
    unit: 'علبة'
  },
  {
    barcode: '6624000301000',
    name: 'نشا ايزي فودز كيس',
    retail_price: 1.72,
    stock_qty: 80,
    reorder_limit: 15,
    unit: 'كيس'
  },
  {
    barcode: '6223001360568',
    name: 'ميرندا برتقال 2 لتر',
    retail_price: 23.0,
    stock_qty: 5,
    reorder_limit: 10,
    unit: 'زجاجة'
  }
]

export let mockShifts = []
export let mockSales = []

export async function mockDbExecute(sqlQuery) {
  const normalized = sqlQuery.trim().replace(/\s+/g, ' ')

  if (normalized.includes('SELECT count(*) as count FROM products;')) return [{ count: 9517 }]

  if (normalized.includes('WHERE stock_qty <= reorder_limit'))
    return [{ count: mockProducts.filter((p) => p.stock_qty <= p.reorder_limit).length }]

  if (normalized.includes('SELECT s.*, u.username FROM shifts s')) {
    const open = mockShifts.find((s) => s.status === 'open')
    return open ? [{ ...open, username: open.user_id === 1 ? 'admin' : 'cashier1' }] : []
  }

  if (normalized.includes("SELECT * FROM shifts WHERE status = 'open'"))
    return mockShifts.filter((s) => s.status === 'open')

  if (normalized.includes('SELECT * FROM users WHERE password_hash =')) {
    const match = normalized.match(/password_hash = '([^']+)'/)
    const pin = match ? match[1] : ''
    if (pin === '1111')
      return [{ id: 2, username: 'cashier1', password_hash: '1111', role: 'cashier' }]
    if (pin === '1234') return [{ id: 1, username: 'admin', password_hash: '1234', role: 'admin' }]
    if (pin === '9999')
      return [{ id: 3, username: 'manager', password_hash: '9999', role: 'manager' }]
    return []
  }

  if (normalized.includes('SELECT * FROM products WHERE barcode =')) {
    const match = normalized.match(/barcode = '([^']+)'/)
    const barcode = match ? match[1] : ''
    const prod = mockProducts.find(
      (p) => p.barcode === barcode || p.barcode === barcode.replace(/^0+/, '')
    )
    return prod ? [prod] : []
  }

  if (
    normalized.includes('SELECT * FROM products WHERE name LIKE') ||
    normalized.includes("LIKE '%")
  ) {
    const match = normalized.match(/LIKE '%([^']+)%'/)
    const q = match ? match[1].toLowerCase() : ''
    return mockProducts.filter((p) => p.name.includes(q) || p.barcode.includes(q))
  }

  if (normalized.includes('INSERT INTO shifts')) {
    const m = normalized.match(/VALUES \(([^,]+), '([^']*)', ([^,]+)/)
    if (m) {
      mockShifts.push({
        id: mockShifts.length + 1,
        user_id: parseInt(m[1]),
        start_time: m[2],
        initial_cash: parseFloat(m[3]),
        status: 'open'
      })
    }
    return []
  }

  if (normalized.includes('UPDATE shifts SET end_time =')) {
    const open = mockShifts.find((s) => s.status === 'open')
    if (open) open.status = 'closed'
    return []
  }

  if (normalized.includes('BEGIN TRANSACTION;')) {
    const updates = normalized.match(
      /UPDATE products SET stock_qty = stock_qty - ([0-9.]+) WHERE barcode = '([^']+)'/g
    )
    if (updates) {
      updates.forEach((u) => {
        const m = u.match(/stock_qty - ([0-9.]+) WHERE barcode = '([^']+)'/)
        const prod =
          m && mockProducts.find((p) => p.barcode === m[2] || p.barcode === m[2].replace(/^0+/, ''))
        if (prod) prod.stock_qty -= parseFloat(m[1])
      })
    }
    return []
  }

  return []
}
