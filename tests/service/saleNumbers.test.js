'use strict'
// Invoice numbers from the two number books (D-103, D-105): the cloud's invoices start at
// 1,000,000,001 and are shown and typed as W-1, W-2, …; the shop's keep their numbers. Searching
// for one never finds the other.
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

const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}

test('the invoice list finds W-numbers and shop numbers apart', async (t) => {
  if (!requireDb(t)) return
  const db = await freshDatabase()
  const svc = await startService(db.url)
  try {
    await createUser(svc, { username: 'owner', pin: '2468', roleKey: 'super_admin' })
    const owner = await login(svc, '2468')
    await seedProducts(
      svc,
      "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('P1', 'صنف', 5, 10, 100, 'قطعة')"
    )
    const shift = (await svc.call('shifts.open', { startingCash: 100 }, owner)).body
    const sell = async () => {
      const r = await svc.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: shift.shiftId ?? shift.id,
          paymentType: 'نقدي',
          items: [{ barcode: 'P1', qty: 1 }]
        },
        owner
      )
      assert.equal(r.status, 200, JSON.stringify(r.body))
      return r.body.saleId
    }
    const shop1 = await sell()
    // The cloud's number book, as on the cloud's copy (migration 0033): its first invoice.
    await svc.pool.query("SELECT setval(pg_get_serial_sequence('sales', 'id'), 1000000000, true)")
    const web1 = await sell()
    assert.deepEqual([shop1, web1], [1, 1000000001])
    // A number search also matches dates and times; a moment without the digit 1 leaves only the
    // number rule to decide.
    await svc.pool.query("UPDATE sales SET timestamp = '2026-02-03 02:03:04'")

    const found = async (search) =>
      ok(await svc.call('sales.page', { search }, owner))
        .rows.map((r) => Number(r.id))
        .sort()
    assert.deepEqual(await found('W-1'), [web1])
    assert.deepEqual(await found('w1'), [web1])
    assert.deepEqual(await found('1'), [shop1], "the shop number 1 is not the cloud's first")
    assert.deepEqual(await found('#1'), [shop1])
    assert.deepEqual(await found('1000000001'), [web1])
    assert.deepEqual(await found('W-2'), [])
  } finally {
    await svc.close()
    await db.dispose()
  }
})
