'use strict'
// Property-based check of the money and stock rules (QA campaign 1.8.0). A random but reproducible
// sequence (fixed seeds) of the store's real operations – sales of every kind, customer returns,
// purchases, purchase returns and corrections, supplier payments and payment requests, preliminary
// invoices, customer payments, expenses, damaged goods – each through the service as a user would.
// After every 25 operations the invariants must hold:
//   * every product's stock equals the sum of its movements (the stock ledger);
//   * every supplier's balance equals its account read as a statement (purchases, opening and
//     adjustments add; payments subtract; returns are entered negative; refunds add);
//   * every customer's balance equals its account read the same way;
//   * every sale's total equals its lines less their discounts.
// A failing seed is printed with the operations that led to it, so it can be replayed exactly.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts
} = require('./helpers')
const { verifyLedger } = require('../../src/server/inventory/stock')

/** A small seeded random generator (mulberry32): the same seed gives the same sequence. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function invariants(pool) {
  const q = async (sql) => (await pool.query(sql)).rows
  const problems = []
  for (const p of await verifyLedger(pool)) problems.push(`stock ${JSON.stringify(p)}`)
  for (const s of await q(`
      SELECT s.id, s.name, s.debt_balance::numeric AS balance,
             COALESCE(SUM(CASE WHEN l.type = 'payment' THEN -l.amount ELSE l.amount END), 0) AS statement
        FROM suppliers s LEFT JOIN supplier_ledger l ON l.supplier_id = s.id
       GROUP BY s.id HAVING abs(s.debt_balance - COALESCE(SUM(CASE WHEN l.type = 'payment' THEN -l.amount ELSE l.amount END), 0)) > 0.005`))
    problems.push(`supplier ${s.name}: balance ${s.balance} vs statement ${s.statement}`)
  for (const c of await q(`
      SELECT c.id, c.name, c.debt_balance::numeric AS balance,
             COALESCE(SUM(CASE WHEN l.type = 'payment' THEN -l.amount ELSE l.amount END), 0) AS statement
        FROM clients c LEFT JOIN client_ledger l ON l.client_id = c.id
       GROUP BY c.id HAVING abs(c.debt_balance - COALESCE(SUM(CASE WHEN l.type = 'payment' THEN -l.amount ELSE l.amount END), 0)) > 0.005`))
    problems.push(`customer ${c.name}: balance ${c.balance} vs statement ${c.statement}`)
  for (const s of await q(`
      SELECT s.id, s.total_amount, SUM(i.total_price - i.line_discount - i.cart_discount) - COALESCE(s.manual_discount, 0) AS lines
        FROM sales s JOIN sale_items i ON i.sale_id = s.id
       GROUP BY s.id HAVING abs(s.total_amount - (SUM(i.total_price - i.line_discount - i.cart_discount) - COALESCE(s.manual_discount, 0))) > 0.005`))
    problems.push(`sale #${s.id}: total ${s.total_amount} vs lines ${s.lines}`)
  return problems
}

async function run(seed, steps) {
  const db = await freshDatabase()
  const svc = await startService(db.url)
  const log = []
  try {
    await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
    await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
    const barcodes = ['1', '01', '001', 'P4', 'P5', 'P6']
    await seedProducts(
      svc,
      `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES
       ${barcodes.map((b, i) => `('${b}', 'صنف ${b}', ${3 + i}, ${10 + 2 * i}, 60, 'قطعة')`).join(', ')}`
    )
    const owner = await login(svc, '8642')
    const cashier = await login(svc, '5173')
    const shift = (await svc.call('shifts.open', { startingCash: 2000 }, cashier)).body
    const ownerShift = (await svc.call('shifts.open', { startingCash: 2000 }, owner)).body
    const suppliers = []
    for (const n of ['أ', 'ب'])
      suppliers.push((await svc.call('suppliers.create', { name: `مورد ${n}` }, owner)).body.id)
    const r = rng(seed)
    const pick = (xs) => xs[Math.floor(r() * xs.length)]
    const qty = () => 1 + Math.floor(r() * 4)
    const price = () => Math.round((5 + r() * 40) * 100) / 100
    const state = { sales: [], purchases: [], requests: [], pending: [], clients: [] }
    const ref = () => crypto.randomUUID()
    const OPS = {
      async cashSale() {
        const items = [{ barcode: pick(barcodes), qty: qty() }]
        const res = await svc.call(
          'pos.checkout',
          { clientRef: ref(), shiftId: shift.id, paymentType: 'نقدي', items },
          cashier
        )
        if (res.status === 200) state.sales.push(res.body.saleId)
        return res
      },
      async creditSale() {
        const existing = state.clients.length && r() < 0.6 ? pick(state.clients) : null
        const client = existing
          ? { id: existing, name: '', phone: '', address: '' }
          : {
              id: null,
              name: `عميل ${Math.floor(r() * 1e6)}`,
              phone: `010${String(Math.floor(r() * 1e8)).padStart(8, '0')}`,
              address: ''
            }
        const res = await svc.call(
          'pos.checkout',
          {
            clientRef: ref(),
            shiftId: shift.id,
            paymentType: 'آجل',
            items: [{ barcode: pick(barcodes), qty: qty() }],
            client
          },
          cashier
        )
        if (res.status === 200) {
          state.sales.push(res.body.saleId)
          if (res.body.clientId && !state.clients.includes(res.body.clientId))
            state.clients.push(res.body.clientId)
        }
        return res
      },
      async customerReturn() {
        if (!state.sales.length) return null
        const d = await svc.call('sales.detail', { saleId: pick(state.sales) }, owner)
        const line = d.body?.items?.find((i) => Number(i.quantity) > Number(i.returned_qty || 0))
        if (!line) return null
        return svc.call(
          'sales.returnItem',
          { saleItemId: line.id, quantity: 1, reason: 'اختبار' },
          owner
        )
      },
      async customerPayment() {
        if (!state.clients.length) return null
        return svc.call(
          'clients.repay',
          {
            clientId: pick(state.clients),
            amount: Math.round(r() * 30 * 100) / 100 + 1,
            currentShiftId: ownerShift.id,
            destination: 'shift',
            clientRef: ref()
          },
          owner
        )
      },
      async purchase() {
        const items = [{ barcode: pick(barcodes), qty: qty() * 3, unitCost: price() }]
        const total = Math.round(items[0].qty * items[0].unitCost * 100) / 100
        const paid = r() < 0.3 ? total : r() < 0.5 ? Math.round(total * r() * 100) / 100 : 0
        const res = await svc.call(
          'suppliers.addPurchase',
          {
            supplierId: pick(suppliers),
            invoice_ref: `R-${log.length}`,
            total_amount: total,
            paid_amount: paid,
            payment_type: 'آجل',
            currentShiftId: ownerShift.id,
            clientRef: ref(),
            items
          },
          owner
        )
        if (res.status === 200) state.purchases.push(res.body.purchaseId)
        return res
      },
      async purchaseReturn() {
        if (!state.purchases.length) return null
        const d = (
          await svc.call('suppliers.purchaseDetail', { purchaseId: pick(state.purchases) }, owner)
        ).body
        const line = d?.items?.find((i) => i.qty - i.returned >= 1)
        if (!line) return null
        return svc.call(
          'suppliers.returnPurchase',
          {
            purchaseId: d.purchase.id,
            items: [{ purchaseItemId: line.id, qty: 1 }],
            refundAmount: r() < 0.3 ? 1 : 0,
            destination: 'shift',
            currentShiftId: ownerShift.id,
            clientRef: ref()
          },
          owner
        )
      },
      async correction() {
        if (!state.purchases.length) return null
        const d = (
          await svc.call('suppliers.purchaseDetail', { purchaseId: pick(state.purchases) }, owner)
        ).body
        if (!d?.items?.length) return null
        const items = d.items.map((i) => ({
          itemId: i.id,
          barcode: i.barcode,
          unitId: i.unit_id ?? null,
          qty: Math.max(i.returned || 0, i.qty + (r() < 0.5 ? 1 : -1)) || i.qty,
          unitCost: Math.max(0.5, Math.round((i.unit_cost + (r() - 0.5) * 4) * 100) / 100)
        }))
        if (r() < 0.3)
          items.push({
            barcode: pick(barcodes.filter((b) => !items.some((i) => i.barcode === b))),
            qty: qty(),
            unitCost: price()
          })
        return svc.call(
          'suppliers.revisePurchase',
          {
            purchaseId: d.purchase.id,
            expectedRevision: d.purchase.revision,
            items: items.filter((i) => i.barcode),
            clientRef: ref()
          },
          owner
        )
      },
      async repay() {
        return svc.call(
          'suppliers.repay',
          {
            supplierId: pick(suppliers),
            amount: Math.round(r() * 50 * 100) / 100 + 1,
            currentShiftId: ownerShift.id,
            destination: 'shift',
            clientRef: ref()
          },
          owner
        )
      },
      async request() {
        const res = await svc.call(
          'supplierPayments.create',
          {
            supplierId: pick(suppliers),
            amount: Math.round(r() * 20 * 100) / 100 + 1,
            currentShiftId: ownerShift.id,
            clientRef: ref()
          },
          owner
        )
        if (res.status === 200) state.requests.push(res.body.request.id)
        return res
      },
      async decide() {
        if (!state.requests.length) return null
        const id = state.requests.splice(Math.floor(r() * state.requests.length), 1)[0]
        return r() < 0.5
          ? svc.call('supplierPayments.approve', { requestId: id }, owner)
          : svc.call('supplierPayments.reject', { requestId: id, note: 'اختبار' }, owner)
      },
      async preliminary() {
        const total = price() * 4
        const mode = pick(['cash', 'credit', 'partial'])
        const res = await svc.call(
          'supplierInvoices.createPending',
          {
            supplierId: pick(suppliers),
            total,
            paymentMode: mode,
            paid: mode === 'partial' ? Math.round((total / 3) * 100) / 100 : null,
            currentShiftId: ownerShift.id,
            clientRef: ref()
          },
          owner
        )
        if (res.status === 200) state.pending.push(res.body.invoice)
        return res
      },
      async completeOrCancel() {
        if (!state.pending.length) return null
        const inv = state.pending.splice(Math.floor(r() * state.pending.length), 1)[0]
        if (r() < 0.6)
          return svc.call(
            'supplierInvoices.convert',
            {
              invoiceId: inv.id,
              items: [{ barcode: pick(barcodes), qty: qty() * 2, unitCost: price() }],
              clientRef: ref()
            },
            owner
          )
        return svc.call(
          'supplierInvoices.cancel',
          {
            invoiceId: inv.id,
            refund: r() < 0.5 ? 'returned' : 'none',
            destination: 'shift',
            currentShiftId: ownerShift.id,
            clientRef: ref()
          },
          owner
        )
      },
      async pendingEdit() {
        if (!state.pending.length) return null
        const inv = pick(state.pending)
        return svc.call(
          'supplierInvoices.updatePending',
          { invoiceId: inv.id, total: Math.max(Number(inv.paid) + 1, price() * 5) },
          owner
        )
      },
      async expense() {
        return svc.call(
          'expenses.create',
          {
            amount: Math.round(r() * 20 * 100) / 100 + 1,
            category: 'نظافة',
            currentShiftId: ownerShift.id,
            destination: 'shift',
            clientRef: ref()
          },
          owner
        )
      },
      async damaged() {
        return svc.call(
          'damaged.create',
          { barcode: pick(barcodes), quantity: 1, reason: 'تالف' },
          owner
        )
      }
    }
    const names = Object.keys(OPS)
    const failures = []
    for (let i = 1; i <= steps; i++) {
      const op = pick(names)
      const res = await OPS[op]()
      log.push(`${op}:${res ? res.status : '-'}`)
      if (res && res.status >= 500) failures.push(`step ${i} ${op}: ${JSON.stringify(res.body)}`)
      if (i % 25 === 0 || i === steps) {
        const problems = await invariants(svc.pool)
        if (problems.length) {
          failures.push(`after step ${i}: ${problems.slice(0, 6).join(' | ')}`)
          break
        }
      }
    }
    return { failures, log }
  } finally {
    await svc.close()
    await db.dispose()
  }
}

for (const seed of [1, 7, 42, 2026, 31337]) {
  test(`money and stock invariants hold through 200 random operations (seed ${seed})`, async (t) => {
    if (!requireDb(t)) return
    const { failures, log } = await run(seed, 200)
    assert.deepEqual(failures, [], `seed ${seed}; operations: ${log.join(' ')}`)
    // Most operations were accepted (the sequence exercised the rules, not only their refusals).
    const accepted = log.filter((l) => l.endsWith(':200')).length
    assert.ok(accepted > 120, `${accepted} accepted of ${log.length}`)
  })
}
