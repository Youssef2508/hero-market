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

/**
 * The owner's outage (owner, 2026-11-11): the shop PC is off, the owner opens a shift from the
 * phone and does a working day in it. `call(op, body)` is the owner's way in; request ids are fixed
 * so two runs record the same.
 */
async function outageDay(twin, call) {
  const shift = await call('shifts.open', { startingCash: 200 })
  const sale = await call('pos.checkout', {
    clientRef: 'outage-sale-0001',
    shiftId: shift.id,
    paymentType: 'نقدي',
    items: [
      { barcode: 'RICE', qty: 4 },
      { barcode: 'SUGAR', qty: 2 }
    ]
  })
  await call('pos.checkout', {
    clientRef: 'outage-sale-0002',
    shiftId: shift.id,
    paymentType: 'آجل',
    client: { id: twin.clientId, name: 'أم أحمد', phone: '01012345678', address: '' },
    items: [{ barcode: 'SUGAR', qty: 1 }]
  })
  const line = (await call('sales.detail', { saleId: sale.saleId })).items.find(
    (i) => i.product_barcode === 'RICE'
  )
  await call('sales.returnItem', { saleItemId: line.id, quantity: 1, reason: 'تالف' })
  await call('suppliers.addPurchase', {
    supplierId: twin.supplierId,
    invoice_ref: 'OUT-1',
    total_amount: 260,
    paid_amount: 60,
    currentShiftId: shift.id,
    clientRef: 'outage-purchase-0001',
    items: [{ barcode: 'SUGAR', qty: 10, unitCost: 26 }]
  })
  await call('suppliers.repay', {
    supplierId: twin.supplierId,
    amount: 40,
    currentShiftId: shift.id,
    destination: 'shift',
    clientRef: 'outage-supplier-pay-1'
  })
  await call('expenses.create', {
    amount: 15,
    category: 'نظافة',
    currentShiftId: shift.id,
    destination: 'shift',
    clientRef: 'outage-expense-0001'
  })
  await call('clients.repay', {
    clientId: twin.clientId,
    amount: 50,
    currentShiftId: shift.id,
    destination: 'shift',
    clientRef: 'outage-collect-0001'
  })
  const live = await call('shifts.liveSummary', { shiftId: shift.id })
  await call('shifts.close', {
    shiftId: shift.id,
    actualCash: live.drawer.expected,
    clientRef: 'outage-close-0001'
  })
  return { shift, expected: live.drawer.expected }
}

/** Business figures that do not depend on record numbers. */
const business = async (pool) => ({
  stock: await q(
    pool,
    'SELECT barcode, stock_qty::float8 AS s, cost_price::float8 AS c FROM products ORDER BY barcode'
  ),
  supplier: await num(pool, 'SELECT debt_balance FROM suppliers ORDER BY id LIMIT 1'),
  customer: await num(pool, "SELECT debt_balance FROM clients WHERE name = 'أم أحمد'"),
  treasury: await q(
    pool,
    'SELECT kind, method, sum(amount)::float8 AS a FROM treasury_ledger GROUP BY 1, 2 ORDER BY 1, 2'
  ),
  drawer: await q(
    pool,
    'SELECT kind, type, sum(amount)::float8 AS a, count(*)::int AS n FROM safe_ledger GROUP BY 1, 2 ORDER BY 1, 2'
  ),
  sales: await q(
    pool,
    'SELECT payment_type, count(*)::int AS n, sum(total_amount)::float8 AS t FROM sales GROUP BY 1 ORDER BY 1'
  ),
  returns: await num(pool, 'SELECT COALESCE(sum(refund), 0) FROM sale_returns'),
  closes: await q(
    pool,
    "SELECT expected - 'at' AS expected, actual, variance FROM shift_closings ORDER BY closed_at"
  ),
  shifts: await q(
    pool,
    'SELECT status, initial_cash::float8, expected_end_cash::float8, actual_end_cash::float8 FROM shifts ORDER BY start_time, id'
  ),
  movements: await q(
    pool,
    'SELECT product_barcode, kind, sum(qty)::float8 AS q FROM stock_movements GROUP BY 1, 2 ORDER BY 1, 2'
  ),
  purchases: await q(
    pool,
    'SELECT invoice_ref, total_amount::float8, paid_amount::float8, paid_from FROM supplier_purchases ORDER BY invoice_ref'
  )
})

test('the shop PC is off: a whole day from the phone in its own shift, then the PC returns – the same business as if done at the shop', async (t) => {
  if (!requireDb(t)) return
  const desk = await makeTwin({ link: false })
  const net = await makeTwin()
  try {
    const a = await outageDay(desk, async (op, body) =>
      ok(await desk.shop.call(op, body, desk.owner), op)
    )
    const owner = await net.signIn('8642')
    await cut(net)
    const b = await outageDay(net, async (op, body) =>
      ok(await net.cloud.call(op, body, owner), op)
    )
    assert.ok(b.shift.id >= FLOOR, 'the phone’s shift is numbered from the cloud’s book')
    assert.equal(b.expected, a.expected)
    // Nothing reached the shop while the PC was off.
    assert.equal(await num(net.shop.pool, 'SELECT count(*) FROM shifts WHERE id >= $1', [FLOOR]), 0)

    await rejoin(net)
    assert.deepEqual(await copyDifferences(net), [])
    assert.deepEqual(await business(net.shop.pool), await business(desk.shop.pool))
    assert.deepEqual(await business(net.cloud.pool), await business(desk.shop.pool))
    // The phone's shift is in the shop, closed, with its saved close.
    const s = await one(net.shop.pool, 'SELECT status FROM shifts WHERE id = $1', [b.shift.id])
    assert.equal(s.status, 'closed')
    assert.equal(
      await num(net.shop.pool, 'SELECT count(*) FROM shift_closings WHERE shift_id = $1', [
        b.shift.id
      ]),
      1
    )
    const listed = await q(net.shop.pool, "SELECT kind FROM sync_attention WHERE status = 'open'")
    assert.deepEqual(listed, [], 'a day done on one side only needs no one’s attention')
  } finally {
    await desk.close()
    await net.close()
  }
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

test('apart, the same things on both sides: both kept, the totals added, and each case listed for a person', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const cOwner = await twin.signIn('8642')
    // A cash sale of one bag of sugar, at the shop, before the cut.
    const sale = ok(
      await twin.shop.call(
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
    const line = await one(twin.shop.pool, 'SELECT id FROM sale_items WHERE sale_id = $1', [
      sale.saleId
    ])
    // Only one bag of rice left on both sides.
    const left = await num(twin.shop.pool, "SELECT stock_qty FROM products WHERE barcode = 'RICE'")
    ok(
      await twin.shop.call(
        'inventory.count',
        { barcode: 'RICE', counted: 1, seen: left, reason: 'جرد' },
        twin.owner
      ),
      'count'
    )
    await twin.agent.runOnce()
    assert.deepEqual(await copyDifferences(twin), [])

    await cut(twin)
    // The same bag returned on both sides; the last bag of rice sold on both; a shift opened on both.
    ok(
      await twin.cloud.call(
        'sales.returnItem',
        { saleItemId: line.id, quantity: 1, reason: 'تالف' },
        cOwner
      ),
      'cloud return'
    )
    ok(
      await twin.shop.call(
        'sales.returnItem',
        { saleItemId: line.id, quantity: 1, reason: 'تالف' },
        twin.owner
      ),
      'shop return'
    )
    ok(await twin.cloud.call('shifts.open', { startingCash: 0 }, cOwner), 'cloud shift')
    ok(await twin.shop.call('shifts.open', { startingCash: 0 }, twin.owner), 'shop shift')
    const cShift = (
      await one(twin.cloud.pool, "SELECT id FROM shifts WHERE status = 'open' AND user_id = 1")
    ).id
    const sShift = (
      await one(twin.shop.pool, "SELECT id FROM shifts WHERE status = 'open' AND user_id = 1")
    ).id
    ok(
      await twin.cloud.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: cShift,
          paymentType: 'نقدي',
          items: [{ barcode: 'RICE', qty: 1 }]
        },
        cOwner
      ),
      'cloud rice'
    )
    ok(
      await twin.shop.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: sShift,
          paymentType: 'نقدي',
          items: [{ barcode: 'RICE', qty: 1 }]
        },
        twin.owner
      ),
      'shop rice'
    )

    await rejoin(twin)
    assert.deepEqual(await copyDifferences(twin), [])
    // Both returns are kept, and the line now shows two bags back of one sold.
    assert.equal(
      await num(twin.shop.pool, 'SELECT count(*) FROM sale_returns WHERE sale_item_id = $1', [
        line.id
      ]),
      2
    )
    assert.equal(
      await num(twin.shop.pool, 'SELECT returned_qty FROM sale_items WHERE id = $1', [line.id]),
      2
    )
    assert.equal(
      await num(twin.shop.pool, "SELECT stock_qty FROM products WHERE barcode = 'RICE'"),
      -1
    )
    assert.equal(
      await num(
        twin.shop.pool,
        "SELECT count(*) FROM shifts WHERE status = 'open' AND user_id = 1"
      ),
      2
    )
    const kinds = (
      await q(
        twin.shop.pool,
        "SELECT kind, row_key FROM sync_attention WHERE status = 'open' ORDER BY kind"
      )
    ).map((r) => `${r.kind}:${r.row_key}`)
    assert.deepEqual(kinds, [
      'returned_twice:' + line.id,
      'stock_negative:RICE',
      'two_open_shifts:1'
    ])
    // Settled from the phone while connected: recorded in the shop, shown on both sides.
    twin.agent.startLink({ timeoutMs: 300 })
    for (let i = 0; i < 100 && !(await twin.cloud.app.cloudLink.shopUp()); i++) await sleep(50)
    const open = ok(await twin.cloud.call('attention.list', {}, cOwner))
    const neg = open.find((i) => i.kind === 'stock_negative')
    ok(
      await twin.cloud.call('attention.resolve', { id: neg.id, note: 'جرد الأرز وتصحيحه' }, cOwner)
    )
    assert.equal(
      (await one(twin.shop.pool, 'SELECT status FROM sync_attention WHERE id = $1', [neg.id]))
        .status,
      'resolved'
    )
    assert.equal(ok(await twin.cloud.call('attention.count', {}, cOwner)).open, 2)
    twin.agent.stopLink()
    await sleep(400)
    // The cloud shows the same list.
    assert.deepEqual(
      (
        await q(
          twin.cloud.pool,
          "SELECT kind, row_key FROM sync_attention WHERE status = 'open' ORDER BY kind"
        )
      ).map((r) => `${r.kind}:${r.row_key}`),
      kinds.filter((k) => !k.startsWith('stock_negative')),
      'the settled item is settled on the cloud too'
    )
  } finally {
    await twin.close()
  }
})

test('never twice from the cloud: a lost acknowledgement and a failure half way through a batch', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const cOwner = await twin.signIn('8642')
    await cut(twin)
    for (const amount of [11, 12, 13])
      ok(
        await twin.cloud.call(
          'expenses.create',
          { amount, category: 'عام', destination: 'treasury', clientRef: crypto.randomUUID() },
          cOwner
        )
      )
    twin.transport.down = false
    const shopExpenses = () =>
      num(twin.shop.pool, 'SELECT count(*) FROM expenses WHERE id >= $1', [FLOOR])
    // The shop fails half way through the batch: nothing of it stays, nothing is marked received.
    await twin.shop.pool
      .query(`CREATE FUNCTION hm_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.amount = 12 THEN RAISE EXCEPTION 'power cut (test)'; END IF; RETURN NEW; END $$`)
    await twin.shop.pool.query(
      'CREATE TRIGGER hm_test_fail BEFORE INSERT ON expenses FOR EACH ROW EXECUTE FUNCTION hm_test_fail()'
    )
    await twin.agent.fetchCloud()
    // The row failed on its own and was listed, the rest of the batch stands: undo that and retry
    // the way it would really happen – a crash takes the whole transaction.
    await twin.shop.pool.query('DROP TRIGGER hm_test_fail ON expenses')
    await twin.shop.pool.query('DROP FUNCTION hm_test_fail()')
    const failed = await q(
      twin.shop.pool,
      "SELECT kind FROM sync_attention WHERE kind = 'not_applied'"
    )
    assert.equal(failed.length, 1, 'a row that cannot be stored is listed, never dropped silently')
    assert.equal(await shopExpenses(), 2)

    // A real crash: the transaction never commits. Nothing is applied and nothing is marked.
    const realFetch = twin.transport.inner.fetch.bind(twin.transport.inner)
    const before = await num(twin.shop.pool, 'SELECT count(*) FROM sync_received')
    const sabotage = twin.agent.pool
    const origConnect = sabotage.connect.bind(sabotage)
    let armed = true
    sabotage.connect = async () => {
      const c = await origConnect()
      if (!armed) return c
      const query = c.query.bind(c)
      c.query = (...args) => {
        if (armed && /INSERT INTO sync_received/.test(String(args[0]))) {
          armed = false
          return Promise.reject(new Error('process killed (test)'))
        }
        return query(...args)
      }
      return c
    }
    // A new change from the cloud, so there is something to receive.
    twin.transport.down = true
    await cut(twin)
    ok(
      await twin.cloud.call(
        'expenses.create',
        { amount: 14, category: 'عام', destination: 'treasury', clientRef: crypto.randomUUID() },
        cOwner
      )
    )
    twin.transport.down = false
    await assert.rejects(() => twin.agent.fetchCloud(), /process killed/)
    sabotage.connect = origConnect
    assert.equal(await num(twin.shop.pool, 'SELECT count(*) FROM sync_received'), before)
    assert.equal(await shopExpenses(), 2, 'nothing of the failed batch was applied')

    // The acknowledgement is lost: the cloud sends the same changes again; they are applied once.
    twin.transport.inner.fetch = realFetch
    const realAck = twin.transport.ack
    twin.transport.ack = async () => {
      throw new Error('answer lost (test)')
    }
    await assert.rejects(() => twin.agent.fetchCloud(), /answer lost/)
    twin.transport.ack = realAck
    await twin.agent.fetchCloud()
    await twin.agent.fetchCloud()
    assert.equal(
      await shopExpenses(),
      3,
      'each of the cloud’s expenses once (one listed as not stored)'
    )
    assert.equal(await num(twin.shop.pool, 'SELECT count(*) FROM expenses WHERE amount = 14'), 1)
  } finally {
    await twin.close()
  }
})

test('the purchase price after a purchase on each side: the newer purchase’s price, on both sides', async (t) => {
  if (!requireDb(t)) return
  for (const newer of ['shop', 'cloud']) {
    const twin = await makeTwin()
    try {
      const cOwner = await twin.signIn('8642')
      await cut(twin)
      const buy = (side, cost) =>
        (side === 'shop' ? twin.shop.call : twin.cloud.call)(
          'suppliers.addPurchase',
          {
            supplierId: twin.supplierId,
            invoice_ref: `${side}-${cost}`,
            total_amount: cost * 10,
            paid_amount: 0,
            clientRef: crypto.randomUUID(),
            items: [{ barcode: 'SUGAR', qty: 10, unitCost: cost }]
          },
          side === 'shop' ? twin.owner : cOwner
        )
      const older = newer === 'shop' ? 'cloud' : 'shop'
      ok(await buy(older, 26), 'older purchase')
      await sleep(1200) // the purchases' own times differ
      ok(await buy(newer, 28), 'newer purchase')
      await rejoin(twin)
      for (const pool of [twin.shop.pool, twin.cloud.pool])
        assert.equal(
          await num(pool, "SELECT cost_price FROM products WHERE barcode = 'SUGAR'"),
          28,
          `newer on the ${newer} side`
        )
      // Both invoices keep their own prices.
      assert.deepEqual(
        (
          await q(
            twin.shop.pool,
            "SELECT invoice_ref FROM supplier_purchases WHERE invoice_ref LIKE '%-2_' ORDER BY 1"
          )
        ).map((r) => r.invoice_ref),
        [`cloud-${newer === 'cloud' ? 28 : 26}`, `shop-${newer === 'shop' ? 28 : 26}`]
      )
      assert.deepEqual(await copyDifferences(twin), [])
    } finally {
      await twin.close()
    }
  }
})
