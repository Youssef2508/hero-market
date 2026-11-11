'use strict'
// One business, two ways in (Phase 2 milestone 1, D-101), while the shop is reachable:
//   - the cloud shows the shop's real state: the same open shift and figures, the same invoices,
//     balances and stock, row for row, without anyone refreshing;
//   - an operation started from the internet is a real operation in the shop's own database, by
//     the same handler, on the same shift, drawer, treasury and balances as from the desktop;
//   - the same users and permissions decide what may be done, and a separate permission decides
//     who may come in from the internet at all;
//   - a retry, a duplicate delivery or a lost answer never carries an operation out twice, and the
//     cloud never carries one out by itself while its outcome in the shop is unknown.
// Every assertion is on the persisted records of the two databases, not on what a screen shows.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, login, passwordFor } = require('./helpers')
const { makeTwin, records, copyDifferences, inStep, ok } = require('./cloudHelpers')

const q = async (pool, sql, p) => (await pool.query(sql, p)).rows
const one = async (pool, sql, p) => (await q(pool, sql, p))[0]
const n = async (pool, sql, p) => Number((await one(pool, sql, p)).n)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const opId = () => ({ 'x-heromarket-operation-id': crypto.randomUUID() })

test('the cloud shows the shop as it is: the same open shift, figures, balances and stock', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    assert.deepEqual(await copyDifferences(twin), [], 'the copy equals the shop, row for row')
    const owner = await twin.signIn('8642')
    const same = async (op, body) => {
      const a = ok(await twin.shop.call(op, body, twin.owner), `shop ${op}`)
      const b = ok(await twin.cloud.call(op, body, owner), `cloud ${op}`)
      assert.deepEqual(b, a, `${op} answers the same from both ways in`)
      return a
    }
    const before = await same('shifts.liveSummary', { shiftId: twin.shift.id })
    await same('shifts.openList', {})
    await same('shifts.details', { shiftId: twin.shift.id })
    await same('suppliers.list', {})
    await same('clients.list', {})
    await same('treasury.summary', {})
    await same('inventory.valuation', {})

    // The cashier sells at the desktop: the owner's phone shows it without asking again.
    const seq = ok(await twin.cloud.call('link.state', {}, owner)).seq
    const watching = twin.cloud.call('link.watch', { after: seq, timeoutMs: 5000 }, owner)
    const sale = ok(
      await twin.shop.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: twin.shift.id,
          paymentType: 'نقدي',
          items: [{ barcode: 'RICE', qty: 2 }]
        },
        twin.cashier
      )
    )
    await twin.agent.kick()
    const state = ok(await watching)
    assert.ok(state.seq > seq, 'the screen is told something changed')
    assert.equal(state.reachable, true)
    assert.deepEqual(await inStep(twin), [])
    const after = await same('shifts.liveSummary', { shiftId: twin.shift.id })
    assert.equal(after.drawer.expected, before.drawer.expected + 50, 'the 50 is in the same drawer')
    await same('sales.detail', { saleId: sale.saleId })
    await same('shifts.details', { shiftId: twin.shift.id })
    const st = ok(await twin.cloud.call('link.state', {}, owner))
    assert.deepEqual([st.reachable, st.freshness, st.pendingChanges], [true, 'live', 0])
    assert.ok(st.lastSyncedAt)
  } finally {
    await twin.close()
  }
})

test('a supplier invoice from the internet is a real invoice in the shop, and a new price is the till’s price', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const owner = await twin.signIn('8642')
    const stock0 = (
      await one(twin.shop.pool, "SELECT stock_qty FROM products WHERE barcode = 'SUGAR'")
    ).stock_qty
    const debt0 = (
      await one(twin.shop.pool, 'SELECT debt_balance FROM suppliers WHERE id = $1', [
        twin.supplierId
      ])
    ).debt_balance
    const treasury0 = Number(
      (await one(twin.shop.pool, 'SELECT COALESCE(SUM(amount), 0) AS b FROM treasury_ledger')).b
    )

    const answer = ok(
      await twin.cloud.call(
        'suppliers.addPurchase',
        {
          supplierId: twin.supplierId,
          invoice_ref: 'INV-77',
          total_amount: 250,
          paid_amount: 50,
          clientRef: crypto.randomUUID(),
          items: [{ barcode: 'SUGAR', qty: 10, unitCost: 25 }]
        },
        owner,
        opId()
      )
    )
    // In the shop's own database: the invoice, its stock, the payable, the payment's source.
    const p = await one(twin.shop.pool, 'SELECT * FROM supplier_purchases WHERE id = $1', [
      answer.purchaseId
    ])
    assert.deepEqual(
      [p.invoice_ref, p.total_amount, p.paid_amount, p.remaining, p.paid_from, p.shift_id],
      ['INV-77', 250, 50, 200, 'treasury', null],
      'an administrator with no open shift pays from the treasury: the desktop rule (D-089)'
    )
    assert.equal(
      (await one(twin.shop.pool, "SELECT stock_qty FROM products WHERE barcode = 'SUGAR'"))
        .stock_qty,
      stock0 + 10
    )
    assert.equal(
      (
        await one(twin.shop.pool, 'SELECT debt_balance FROM suppliers WHERE id = $1', [
          twin.supplierId
        ])
      ).debt_balance,
      debt0 + 200
    )
    assert.equal(
      Number(
        (await one(twin.shop.pool, 'SELECT COALESCE(SUM(amount), 0) AS b FROM treasury_ledger')).b
      ),
      treasury0 - 50
    )
    // Recorded once, as carried out for this user.
    const done = await q(
      twin.shop.pool,
      'SELECT operation, username, status FROM remote_operations'
    )
    assert.deepEqual(done, [
      { operation: 'suppliers.addPurchase', username: 'owner', status: 'applied' }
    ])
    // The answer came after the rows: the cloud's copy already holds the invoice.
    assert.deepEqual(await copyDifferences(twin), [], 'the copy is in step when the answer arrives')
    const seen = ok(
      await twin.cloud.call('suppliers.purchaseDetail', { purchaseId: answer.purchaseId }, owner)
    )
    assert.deepEqual(
      seen,
      ok(
        await twin.shop.call(
          'suppliers.purchaseDetail',
          { purchaseId: answer.purchaseId },
          twin.owner
        )
      )
    )

    // A price changed from the phone is the price the desktop till sells at.
    const rice = await one(twin.shop.pool, "SELECT * FROM products WHERE barcode = 'RICE'")
    ok(
      await twin.cloud.call(
        'products.update',
        {
          barcode: 'RICE',
          name: rice.name,
          cost_price: rice.cost_price,
          retail_price: 27,
          reorder_limit: rice.reorder_limit,
          unit: rice.unit
        },
        owner,
        opId()
      )
    )
    const sale = ok(
      await twin.shop.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: twin.shift.id,
          paymentType: 'نقدي',
          items: [{ barcode: 'RICE', qty: 1 }]
        },
        twin.cashier
      )
    )
    assert.equal(
      (await one(twin.shop.pool, 'SELECT total_amount FROM sales WHERE id = $1', [sale.saleId]))
        .total_amount,
      27
    )
  } finally {
    await twin.close()
  }
})

/**
 * A working day through one way in. `call(op, body, who)` is the desktop or the internet; the
 * request ids are fixed so both runs record identical rows.
 */
async function day(twin, call) {
  const steps = {}
  // The owner, no open shift: a supplier invoice part-paid, a supplier payment, a customer
  // collection and an expense. By the existing rules these are the treasury's.
  steps.purchase = await call(
    'suppliers.addPurchase',
    {
      supplierId: twin.supplierId,
      invoice_ref: 'D-1',
      total_amount: 300,
      paid_amount: 100,
      clientRef: 'day-purchase-0001',
      items: [{ barcode: 'SUGAR', qty: 12, unitCost: 25 }]
    },
    'owner'
  )
  steps.repay = await call(
    'suppliers.repay',
    { supplierId: twin.supplierId, amount: 60, clientRef: 'day-supplier-pay-1' },
    'owner'
  )
  steps.collect = await call(
    'clients.repay',
    { clientId: twin.clientId, amount: 40, destination: 'treasury', clientRef: 'day-collect-0001' },
    'owner'
  )
  steps.expense = await call(
    'expenses.create',
    { amount: 15, category: 'نظافة', destination: 'treasury', clientRef: 'day-expense-0001' },
    'owner'
  )
  steps.deposit = await call(
    'treasury.record',
    { kind: 'deposit', amount: 500, clientRef: 'day-deposit-0001' },
    'owner'
  )
  // The cashier, in their open shift: a cash sale and a card sale.
  steps.sale = await call(
    'pos.checkout',
    {
      clientRef: 'day-sale-cash-0001',
      shiftId: twin.shift.id,
      paymentType: 'نقدي',
      items: [
        { barcode: 'RICE', qty: 3 },
        { barcode: 'SUGAR', qty: 1 }
      ]
    },
    'cashier'
  )
  steps.card = await call(
    'pos.checkout',
    {
      clientRef: 'day-sale-card-0001',
      shiftId: twin.shift.id,
      paymentType: 'فيزا',
      items: [{ barcode: 'RICE', qty: 1 }]
    },
    'cashier'
  )
  // The owner returns one bag of the cash sale: no shift of their own, so the refund leaves the
  // sale's own open shift (the existing rule).
  const item = await one(
    twin.shop.pool,
    "SELECT id FROM sale_items WHERE sale_id = $1 AND product_barcode = 'RICE'",
    [steps.sale.saleId]
  )
  steps.ret = await call(
    'sales.returnItem',
    { saleItemId: item.id, quantity: 1, reason: 'تالف' },
    'owner'
  )
  // A price edit, a new customer, then the cashier closes the shift and the owner opens one.
  steps.price = await call(
    'products.update',
    {
      barcode: 'SUGAR',
      name: 'سكر',
      cost_price: 25,
      retail_price: 32,
      reorder_limit: 10,
      unit: 'كيس'
    },
    'owner'
  )
  steps.client = await call('clients.create', { name: 'أبو علي', phone: '01111111111' }, 'owner')
  const live = (await twin.shop.call('shifts.liveSummary', { shiftId: twin.shift.id }, twin.owner))
    .body
  steps.close = await call(
    'shifts.close',
    {
      shiftId: twin.shift.id,
      actualCash: live.drawer.expected,
      actual: { visa: 25 },
      clientRef: 'day-close-0001'
    },
    'cashier'
  )
  steps.open = await call('shifts.open', { startingCash: 200 }, 'owner')
  return steps
}

test('the same day through the desktop and through the internet leaves the same records in the shop', async (t) => {
  if (!requireDb(t)) return
  const desk = await makeTwin({ link: false })
  const net = await makeTwin()
  try {
    const tokens = { owner: await net.signIn('8642'), cashier: await net.signIn('5173') }
    const a = await day(desk, async (op, body, who) =>
      ok(await desk.shop.call(op, body, desk[who]), op)
    )
    const b = await day(net, async (op, body, who) =>
      ok(await net.cloud.call(op, body, tokens[who], opId()), op)
    )
    assert.deepEqual(Object.keys(b), Object.keys(a))

    const A = await records(desk.shop.pool)
    const B = await records(net.shop.pool)
    for (const table of Object.keys(A))
      assert.deepEqual(B[table], A[table], `${table}: the same records from either way in`)

    // What that means for the accounts, read from the shop that was worked through the internet.
    const money = async (pool) => ({
      treasury: Number((await one(pool, 'SELECT SUM(amount) AS b FROM treasury_ledger')).b),
      drawer: await q(
        pool,
        'SELECT shift_id, type, kind, method, amount::float8 AS amount FROM safe_ledger ORDER BY id'
      ),
      supplier: (await one(pool, 'SELECT debt_balance FROM suppliers ORDER BY id LIMIT 1'))
        .debt_balance,
      customer: (await one(pool, "SELECT debt_balance FROM clients WHERE name = 'أم أحمد'"))
        .debt_balance,
      stock: await q(
        pool,
        'SELECT barcode, stock_qty, cost_price, retail_price FROM products ORDER BY barcode'
      ),
      shifts: await q(
        pool,
        'SELECT id, user_id, status, initial_cash, expected_end_cash, actual_end_cash, difference FROM shifts ORDER BY id'
      )
    })
    assert.deepEqual(await money(net.shop.pool), await money(desk.shop.pool))
    // 12 operations came through the internet; each was carried out once, in the shop.
    assert.equal(
      await n(
        net.shop.pool,
        "SELECT count(*) AS n FROM remote_operations WHERE status = 'applied'"
      ),
      12
    )
    assert.equal(await n(desk.shop.pool, 'SELECT count(*) AS n FROM remote_operations'), 0)
    // And the cloud's copy is that shop, row for row.
    assert.deepEqual(await inStep(net), [])
  } finally {
    await desk.close()
    await net.close()
  }
})

test('the same users and permissions on both ways in; the internet needs its own permission', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    // Signing in: the same username and password; no plain password ever reached the cloud.
    const users = await q(
      twin.cloud.pool,
      'SELECT username, password_scrypt FROM users ORDER BY id'
    )
    assert.deepEqual(
      users.map((u) => u.username),
      ['owner', 'cashier', 'second']
    )
    for (const u of users) assert.match(u.password_scrypt, /^scrypt\$/)
    const owner = await twin.signIn('8642')
    const cashier = await twin.signIn('5173')
    // A cashier whose role lacks «الدخول عبر الإنترنت» signs in at the shop, not from outside.
    await login(twin.shop, '6205')
    const outside = await twin.cloud.call('auth.login', {
      username: 'second',
      password: passwordFor('6205')
    })
    assert.deepEqual([outside.status, outside.body.error.code], [403, 'forbidden'])
    assert.equal(
      await n(
        twin.cloud.pool,
        "SELECT count(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'second' AND s.revoked_at IS NULL"
      ),
      0
    )
    // The permission opens the door and nothing else: the cashier is refused the same operations.
    for (const [op, body] of [
      ['suppliers.repay', { supplierId: twin.supplierId, amount: 5 }],
      ['treasury.summary', {}],
      ['users.list', {}],
      ['shifts.list', {}]
    ]) {
      const a = await twin.shop.call(op, body, twin.cashier)
      const b = await twin.cloud.call(op, body, cashier)
      assert.deepEqual([b.status, b.body.error.code], [a.status, a.body.error.code], op)
      assert.equal(b.status, 403)
    }
    assert.equal(
      await n(twin.shop.pool, 'SELECT count(*) AS n FROM remote_operations'),
      0,
      'refused before reaching the shop'
    )
    // The shop decides with its own current roles: a permission taken away there is refused there
    // even if the cloud has not heard yet.
    const realPush = twin.transport.push
    twin.transport.push = async () => ({ acked: [] })
    await twin.shop.pool.query(
      "DELETE FROM role_permissions WHERE permission = 'suppliers.pending' AND role_id = (SELECT role_id FROM users WHERE username = 'cashier')"
    )
    const refused = await twin.cloud.call(
      'supplierInvoices.createPending',
      {
        supplierId: twin.supplierId,
        total: 50,
        paymentMode: 'credit',
        currentShiftId: twin.shift.id,
        clientRef: crypto.randomUUID()
      },
      cashier,
      opId()
    )
    assert.equal(refused.status, 403)
    assert.equal(await n(twin.shop.pool, 'SELECT count(*) AS n FROM supplier_pending_invoices'), 0)
    assert.deepEqual(await q(twin.shop.pool, 'SELECT status, http_status FROM remote_operations'), [
      { status: 'refused', http_status: 403 }
    ])
    twin.transport.push = realPush
    // What only the shop PC does stays there; nobody can claim the cloud from outside.
    for (const op of ['backup.export', 'system.reset'])
      assert.equal((await twin.cloud.call(op, {}, owner)).body.error.code, 'shop_only')
    assert.equal(
      (await twin.cloud.call('auth.setup', { username: 'intruder', password: 'Intruder-pass-1' }))
        .body.error.code,
      'shop_only'
    )
    // A disabled account is out on both sides once the shop's change arrives.
    await twin.shop.pool.query("UPDATE users SET is_active = false WHERE username = 'cashier'")
    assert.deepEqual(await inStep(twin), [])
    assert.equal((await twin.cloud.call('auth.me', {}, cashier)).status, 401)
    assert.equal((await twin.cloud.call('auth.me', {}, owner)).status, 200)
  } finally {
    await twin.close()
  }
})

test('never twice: duplicate delivery, a lost answer, a retry, and the shop unreachable', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const owner = await twin.signIn('8642')
    const expenses = () => n(twin.shop.pool, 'SELECT count(*) AS n FROM expenses')
    const treasury = async () =>
      Number(
        (await one(twin.shop.pool, 'SELECT COALESCE(SUM(amount), 0) AS b FROM treasury_ledger')).b
      )
    const t0 = await treasury()
    const expense = (amount, headers) =>
      twin.cloud.call(
        'expenses.create',
        { amount, category: 'عام', destination: 'treasury' },
        owner,
        headers
      )

    // Delivered to the shop twice in the same turn: carried out once.
    twin.transport.duplicateOps = true
    ok(await expense(10, opId()))
    twin.transport.duplicateOps = false
    assert.equal(await expenses(), 1)
    assert.equal(await treasury(), t0 - 10)

    // The shop carried it out and the answer was lost: the user is told it awaits confirmation,
    // the cloud does not do it by itself, and the outcome is established from the shop's record.
    const id = crypto.randomUUID()
    twin.transport.loseResults = 1
    const lost = await expense(20, { 'x-heromarket-operation-id': id })
    assert.equal(lost.status === 200 || lost.body.error.code === 'pending_confirmation', true)
    for (let i = 0; i < 100; i++) {
      const o = ok(await twin.cloud.call('link.operation', { operationId: id }, owner))
      if (!o.waiting) break
      await sleep(50)
    }
    const settled = ok(await twin.cloud.call('link.operation', { operationId: id }, owner))
    assert.equal(settled.status, 'applied')
    assert.equal(await expenses(), 2, 'once in the shop')
    assert.equal(await treasury(), t0 - 30)
    // The same attempt sent again (the phone retried): its one answer, no third expense.
    const again = ok(await expense(20, { 'x-heromarket-operation-id': id }))
    assert.equal(again.id, settled.result.id)
    assert.equal(await expenses(), 2)

    // The shop goes away. Known before the operation starts: refused at once, nothing queued,
    // nothing changed anywhere; reading still works and says how old the figures are.
    twin.transport.down = true
    await sleep(1900)
    const cut = await expense(30, opId())
    assert.deepEqual([cut.status, cut.body.error.code], [503, 'shop_unreachable'])
    assert.equal(await expenses(), 2)
    assert.equal(
      await n(
        twin.cloud.pool,
        "SELECT count(*) AS n FROM cloud_operations WHERE status IN ('queued', 'sent')"
      ),
      0
    )
    const st = ok(await twin.cloud.call('link.state', {}, owner))
    assert.deepEqual([st.reachable, st.freshness], [false, 'unavailable'])
    assert.ok(st.lastSyncedAt, 'the screens can say "as of"')
    ok(await twin.cloud.call('suppliers.list', {}, owner))

    // Back again: reachable, and work continues.
    twin.transport.down = false
    for (let i = 0; i < 200 && !twin.cloud.app.cloudLink.reachable(); i++) await sleep(50)
    ok(await expense(5, opId()))
    assert.equal(await expenses(), 3)
    assert.deepEqual(await inStep(twin), [])
    // Every expense is the shop's; the cloud holds them only as its copy.
    assert.equal(
      await n(
        twin.shop.pool,
        "SELECT count(*) AS n FROM remote_operations WHERE operation = 'expenses.create'"
      ),
      3
    )
  } finally {
    await twin.close()
  }
})
