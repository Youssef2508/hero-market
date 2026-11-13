'use strict'
// Defects found by the pre-production audit (.docs/PRE_PRODUCTION_AUDIT_REPORT.md), each with the
// test that failed before its fix.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { Writable } = require('stream')
const { requireDb, freshDatabase, startService } = require('./helpers')

let db, svc
const logged = []

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  // A real logger, writing to memory: what the service records as its own failures.
  const stream = new Writable({
    write(chunk, _enc, done) {
      logged.push(JSON.parse(chunk))
      done()
    }
  })
  svc = await startService(db.url, { logger: { level: 'info', stream } })
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

const raw = (payload, headers = {}) =>
  svc.app.inject({
    method: 'POST',
    url: '/api/auth.login',
    payload,
    headers: { 'content-type': 'application/json', ...headers }
  })

test('AUD-03: a malformed or oversized request is the caller’s error (4xx), never “unexpected server error”', async (t) => {
  if (!requireDb(t)) return
  logged.length = 0

  const badJson = await raw('{"username":')
  assert.equal(badJson.statusCode, 400, badJson.body)
  assert.equal(JSON.parse(badJson.body).error.code, 'bad_request')

  const tooBig = await raw(JSON.stringify({ username: 'x'.repeat(3 * 1024 * 1024) }))
  assert.equal(tooBig.statusCode, 413, tooBig.body)
  assert.equal(JSON.parse(tooBig.body).error.code, 'payload_too_large')

  const badType = await raw('x', { 'content-type': 'application/xml' })
  assert.equal(badType.statusCode, 415, badType.body)

  // The answers say nothing about the inside, and none of it is logged as a failure of the service.
  for (const r of [badJson, tooBig, badType]) assert.doesNotMatch(r.body, /node_modules|at |stack/i)
  assert.deepEqual(
    logged.filter((l) => l.msg === 'unhandled error'),
    [],
    'client errors must not be logged as unhandled'
  )
})

// ── Randomized business sequences (property test) ───────────────────────────────
// A seeded random mix of cash, credit and part-paid sales, returns (including impossible ones),
// customer repayments and expenses. After every step the invariants that make the books trustworthy
// must hold, computed in plain SQL independently of the application code:
//   stock = the sum of its movements; a customer's balance = credit sales − payments;
//   nothing returned beyond what was sold; refused operations leave no trace at all.
const { createUser, login, seedProducts } = require('./helpers')

function prng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

async function invariants(pool) {
  const q = async (sql) => (await pool.query(sql)).rows
  const problems = []
  for (const r of await q(
    `SELECT p.barcode, p.stock_qty::numeric s, COALESCE(sum(m.qty), 0)::numeric m
       FROM products p LEFT JOIN stock_movements m ON m.product_barcode = p.barcode
      GROUP BY p.barcode, p.stock_qty HAVING p.stock_qty::numeric <> COALESCE(sum(m.qty), 0)::numeric`
  ))
    problems.push(`stock ${r.barcode}: ${r.s} vs movements ${r.m}`)
  for (const r of await q(
    `SELECT c.id, c.debt_balance::numeric b,
            COALESCE(sum(CASE l.type WHEN 'sale' THEN l.amount WHEN 'payment' THEN -l.amount END), 0)::numeric l
       FROM clients c LEFT JOIN client_ledger l ON l.client_id = c.id
      GROUP BY c.id, c.debt_balance
     HAVING round(c.debt_balance::numeric, 2) <> round(COALESCE(sum(CASE l.type WHEN 'sale' THEN l.amount WHEN 'payment' THEN -l.amount END), 0)::numeric, 2)`
  ))
    problems.push(`client ${r.id}: balance ${r.b} vs ledger ${r.l}`)
  for (const r of await q(
    `SELECT i.id, i.quantity, i.returned_qty, COALESCE((SELECT sum(quantity) FROM sale_returns x WHERE x.sale_item_id = i.id), 0) ret
       FROM sale_items i
      WHERE i.returned_qty > i.quantity
         OR i.returned_qty <> COALESCE((SELECT sum(quantity) FROM sale_returns x WHERE x.sale_item_id = i.id), 0)`
  ))
    problems.push(
      `sale item ${r.id}: sold ${r.quantity}, returned ${r.returned_qty}, return rows ${r.ret}`
    )
  // A balance below zero is allowed: paying more than is owed is recorded as the customer's credit
  // (the screen asks first) – it is covered by the ledger equality above.
  return problems
}

async function footprint(pool) {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM sales) s, (SELECT count(*) FROM sale_items) i, (SELECT count(*) FROM sale_returns) r,
            (SELECT count(*) FROM client_ledger) cl, (SELECT count(*) FROM treasury_ledger) t,
            (SELECT count(*) FROM stock_movements) m, (SELECT count(*) FROM expenses) e,
            (SELECT COALESCE(sum(debt_balance), 0) FROM clients) d, (SELECT sum(stock_qty) FROM products) q`
  )
  return JSON.stringify(rows[0])
}

for (const seed of [11, 4242, 90210]) {
  test(`AUD-05: randomized business sequence (seed ${seed}) keeps stock, balances and returns consistent`, async (t) => {
    if (!requireDb(t)) return
    const pdb = await freshDatabase()
    const s = await startService(pdb.url)
    try {
      const rnd = prng(seed)
      const pick = (a) => a[Math.floor(rnd() * a.length)]
      await createUser(s, {
        username: `owner${seed}`,
        pin: `${seed}1`.slice(0, 6),
        roleKey: 'super_admin'
      })
      const owner = await login(s, `${seed}1`.slice(0, 6))
      await seedProducts(
        s,
        `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, category, reorder_limit)
         SELECT 'R' || g, 'صنف ' || g, 3 + g * 0.25, 5 + g * 0.35, 200, 'قطعة', 'عام', 5 FROM generate_series(1, 8) g`
      )
      const shift = (await s.call('shifts.open', { startingCash: 300 }, owner)).body
      const clients = []
      for (let i = 0; i < 3; i++) {
        const name = `عميل عشوائي ${seed}-${i}`
        const phone = `0109${seed}${i}`.slice(0, 11).padEnd(11, '0')
        const r = await s.call('clients.create', { name, phone }, owner)
        assert.equal(r.status, 200, JSON.stringify(r.body))
        clients.push({ id: r.body.id ?? r.body.client?.id, name, phone })
      }
      const items = []
      let refused = 0
      const reasons = new Map()
      for (let step = 0; step < 120; step++) {
        const action = rnd()
        const before = await footprint(s.pool)
        let r
        if (action < 0.5) {
          const type = pick(['نقدي', 'آجل', 'دفع جزئي', 'فيزا'])
          // One line per product (a product twice in one invoice is refused, by design).
          const byCode = new Map()
          for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--)
            byCode.set(`R${1 + Math.floor(rnd() * 8)}`, 1 + Math.floor(rnd() * 4))
          const lines = [...byCode].map(([barcode, qty]) => ({ barcode, qty }))
          const client = type === 'آجل' || type === 'دفع جزئي' || rnd() < 0.3 ? pick(clients) : null
          r = await s.call(
            'pos.checkout',
            {
              clientRef: `rnd-${seed}-${step}`,
              shiftId: shift.id,
              paymentType: type,
              items: lines,
              ...(type === 'دفع جزئي' ? { paidAmount: Math.round(rnd() * 20 * 100) / 100 } : {}),
              ...(client
                ? { client: { id: client.id, name: client.name, phone: client.phone, address: '' } }
                : {})
            },
            owner
          )
          if (r.status === 200) {
            const ids = (
              await s.pool.query('SELECT id, quantity FROM sale_items WHERE sale_id = $1', [
                r.body.saleId ?? r.body.id
              ])
            ).rows
            items.push(...ids)
          }
        } else if (action < 0.75 && items.length) {
          const it = pick(items)
          // Sometimes more than was sold: must be refused without any trace.
          const qty = rnd() < 0.25 ? Number(it.quantity) + 1 : 1
          r = await s.call(
            'sales.returnItem',
            { saleItemId: it.id, quantity: qty, currentShiftId: shift.id, reason: 'اختبار' },
            owner
          )
        } else if (action < 0.9) {
          const c = pick(clients)
          const amt = Math.round((1 + rnd() * 40) * 100) / 100
          r = await s.call(
            'clients.repay',
            {
              clientId: c.id,
              amount: amt,
              currentShiftId: shift.id,
              clientRef: `rnd-pay-${seed}-${step}`
            },
            owner
          )
        } else {
          r = await s.call(
            'expenses.create',
            {
              amount: Math.round((1 + rnd() * 15) * 100) / 100,
              currentShiftId: shift.id,
              clientRef: `rnd-exp-${seed}-${step}`,
              destination: 'shift'
            },
            owner
          )
        }
        assert.ok(r.status < 500, `step ${step}: server error ${JSON.stringify(r.body)}`)
        if (r.status !== 200) {
          refused += 1
          const why = `${r.status} ${r.body?.error?.message || ''}`.slice(0, 90)
          reasons.set(why, (reasons.get(why) || 0) + 1)
          assert.equal(
            await footprint(s.pool),
            before,
            `step ${step}: a refused operation left a trace (${JSON.stringify(r.body)})`
          )
        }
        const problems = await invariants(s.pool)
        assert.deepEqual(problems, [], `seed ${seed}, step ${step}`)
      }
      t.diagnostic(
        `seed ${seed}: 120 steps, ${refused} refused, ${items.length} sale lines; refusals: ${JSON.stringify([...reasons])}`
      )
    } finally {
      await s.close()
      await pdb.dispose()
    }
  })
}
