'use strict'
// The cloud working while the shop cannot be reached, and the two coming together (Phase 2
// milestone 3, D-103). Two disposable databases, the real service on each, a link the test cuts.
// Every scenario ends with the same two checks: the shop and the cloud hold identical records, row
// for row, and the money and stock are what both sides' work adds up to – nothing lost, nothing
// counted twice, the shop's value kept where both changed the same field, and that case listed.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb } = require('./helpers')
const { makeTwin, copyDifferences, ok } = require('./cloudHelpers')

const q = async (pool, sql, p) => (await pool.query(sql, p)).rows
const one = async (pool, sql, p) => (await q(pool, sql, p))[0]
const num = async (pool, sql, p) => Number(Object.values(await one(pool, sql, p))[0])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const FLOOR = 1000000000

/** Cut the link and wait until the cloud knows the shop is unreachable. */
async function cut(twin) {
  twin.transport.down = true
  for (let i = 0; i < 100 && (await twin.cloud.app.cloudLink.shopUp()); i++) await sleep(50)
  assert.equal(await twin.cloud.app.cloudLink.shopUp(), false)
}

/** Restore the link and synchronise both ways until the two are the same. */
async function rejoin(twin) {
  twin.transport.down = false
  let last
  for (let i = 0; i < 8; i++) {
    last = await twin.agent.runOnce()
    if (last.check?.ok && !(await copyDifferences(twin)).length) return last
  }
  throw new Error(
    `not together: ${JSON.stringify(last?.check)} ${(await copyDifferences(twin)).slice(0, 5)}`
  )
}

const figures = async (pool) => ({
  rice: await num(pool, "SELECT stock_qty FROM products WHERE barcode = 'RICE'"),
  sugar: await one(
    pool,
    "SELECT retail_price::float8 AS price, stock_qty::float8 AS stock FROM products WHERE barcode = 'SUGAR'"
  ),
  supplier: await num(pool, 'SELECT debt_balance FROM suppliers ORDER BY id LIMIT 1'),
  customer: await num(pool, "SELECT debt_balance FROM clients WHERE name = 'أم أحمد'"),
  treasury: await num(pool, 'SELECT COALESCE(SUM(amount), 0) FROM treasury_ledger'),
  sales: await num(pool, 'SELECT count(*) FROM sales'),
  drawer: await q(
    pool,
    'SELECT shift_id, kind, sum(amount)::float8 AS amount FROM safe_ledger GROUP BY 1, 2 ORDER BY 1, 2'
  ),
  movements: await num(pool, 'SELECT count(*) FROM stock_movements')
})

test('apart: both sides work, then come together – identical records, both sides’ work added, the shop’s value where both changed a field', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const cOwner = await twin.signIn('8642')
    const cCashier = await twin.signIn('5173')
    const shop = (op, body, who = twin.owner) => twin.shop.call(op, body, who)
    const cloud = (op, body, who = cOwner) => twin.cloud.call(op, body, who)
    const before = await figures(twin.shop.pool)

    await cut(twin)

    // From the phones, with the shop unreachable: the same operations, the same accounts.
    const cSale = ok(
      await cloud(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: twin.shift.id,
          paymentType: 'نقدي',
          items: [{ barcode: 'RICE', qty: 2 }]
        },
        cCashier
      ),
      'cloud sale'
    )
    ok(
      await cloud('expenses.create', {
        amount: 20,
        category: 'نظافة',
        destination: 'treasury',
        clientRef: crypto.randomUUID()
      }),
      'cloud expense'
    )
    ok(
      await cloud('suppliers.repay', {
        supplierId: twin.supplierId,
        amount: 100,
        destination: 'treasury',
        clientRef: crypto.randomUUID()
      }),
      'cloud supplier payment'
    )
    ok(
      await cloud('clients.repay', {
        clientId: twin.clientId,
        amount: 30,
        destination: 'treasury',
        clientRef: crypto.randomUUID()
      }),
      'cloud collection'
    )
    const sugar = await one(twin.cloud.pool, "SELECT * FROM products WHERE barcode = 'SUGAR'")
    ok(
      await cloud('products.update', {
        barcode: 'SUGAR',
        name: sugar.name,
        cost_price: sugar.cost_price,
        retail_price: 33,
        reorder_limit: sugar.reorder_limit,
        unit: sugar.unit
      }),
      'cloud price'
    )
    const cClient = ok(
      await cloud('clients.create', { name: 'عميل من الهاتف', phone: '01099999999' }),
      'cloud customer'
    )
    // Nothing reached the shop.
    assert.equal(await num(twin.shop.pool, 'SELECT count(*) FROM sales WHERE id >= $1', [FLOOR]), 0)
    // The cloud's own numbers come from its own book.
    assert.ok(cSale.saleId >= FLOOR, `cloud sale number ${cSale.saleId}`)
    assert.ok(cClient.id >= FLOOR)

    // At the shop, at the same time.
    const sSale = ok(
      await shop(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: twin.shift.id,
          paymentType: 'نقدي',
          items: [{ barcode: 'RICE', qty: 3 }]
        },
        twin.cashier
      ),
      'shop sale'
    )
    assert.ok(sSale.saleId < FLOOR)
    ok(
      await shop('suppliers.repay', {
        supplierId: twin.supplierId,
        amount: 50,
        destination: 'treasury',
        clientRef: crypto.randomUUID()
      }),
      'shop supplier payment'
    )
    const sugarShop = await one(twin.shop.pool, "SELECT * FROM products WHERE barcode = 'SUGAR'")
    ok(
      await shop('products.update', {
        barcode: 'SUGAR',
        name: sugarShop.name,
        cost_price: sugarShop.cost_price,
        retail_price: 31,
        reorder_limit: sugarShop.reorder_limit,
        unit: sugarShop.unit
      }),
      'shop price'
    )

    await rejoin(twin)

    // Row for row the same.
    assert.deepEqual(await copyDifferences(twin), [])
    const a = await figures(twin.shop.pool)
    const b = await figures(twin.cloud.pool)
    assert.deepEqual(b, a, 'the cloud shows exactly the shop')
    // Both sides' work, added once each.
    assert.equal(a.rice, before.rice - 2 - 3)
    assert.equal(a.supplier, before.supplier - 100 - 50)
    assert.equal(a.customer, before.customer - 30)
    assert.equal(a.treasury, before.treasury - 20 - 100 + 30 - 50)
    assert.equal(a.sales, before.sales + 2)
    assert.equal(a.movements, before.movements + 2)
    // Both sales are in the same open shift: its expected cash counts both.
    const live = ok(await shop('shifts.liveSummary', { shiftId: twin.shift.id }))
    const liveCloud = ok(await cloud('shifts.liveSummary', { shiftId: twin.shift.id }))
    assert.deepEqual(liveCloud, live)
    assert.equal(
      live.drawer.expected,
      500 + 5 * 25,
      'opening 500 + two cash sales of RICE (2 and 3 bags at 25)'
    )
    // The same field changed on both sides: the shop's 31 stands everywhere, and it is listed.
    assert.equal(a.sugar.price, 31)
    const items = await q(
      twin.shop.pool,
      "SELECT kind, table_name, row_key, detail FROM sync_attention WHERE status = 'open'"
    )
    const clash = items.find(
      (i) => i.kind === 'conflict' && i.table_name === 'products' && i.row_key === 'SUGAR'
    )
    assert.ok(clash, JSON.stringify(items))
    assert.deepEqual(
      clash.detail.columns.map((c) => [c.column, Number(c.base), Number(c.shop), Number(c.cloud)]),
      [['retail_price', 30, 31, 33]]
    )
    // Nothing was skipped: every record of both sides was stored.
    assert.deepEqual(
      items.filter((i) => ['not_applied', 'delete_kept'].includes(i.kind)),
      []
    )
    // The list reached the cloud too, so it can be seen from the phone.
    assert.equal(
      await num(twin.cloud.pool, "SELECT count(*) FROM sync_attention WHERE status = 'open'"),
      items.length
    )
    // The customer made on the phone is in the shop, with its own number.
    assert.equal(
      await num(twin.shop.pool, 'SELECT count(*) FROM clients WHERE id = $1', [cClient.id]),
      1
    )

    // Synchronising again changes nothing: nothing was applied twice.
    await twin.agent.runOnce()
    await twin.agent.runOnce()
    assert.deepEqual(await figures(twin.shop.pool), a)
    assert.deepEqual(await copyDifferences(twin), [])
    // The shop's own counters stayed in its book: its next sale has an ordinary number.
    const next = ok(
      await shop(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: twin.shift.id,
          paymentType: 'نقدي',
          items: [{ barcode: 'SUGAR', qty: 1 }]
        },
        twin.cashier
      )
    )
    assert.ok(next.saleId < FLOOR && next.saleId > sSale.saleId, `next shop sale ${next.saleId}`)
  } finally {
    await twin.close()
  }
})
