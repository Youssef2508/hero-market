'use strict'
// Returns without an invoice (1.9.0, D-116): only with sales.return_without_invoice; the goods back
// into stock, the refund out of the cashier's open drawer (expected cash, close report), at today's
// selling price kept on the return; one request = one return, also when retried, made offline and
// sent later, or delivered twice to the cloud.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb } = require('./helpers')
const { makeTwin, copyDifferences, ok } = require('./cloudHelpers')

let twin, shop, cloud, owner, cashier
const q = async (sql, p) => (await shop.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const num = async (sql, p) => Number(Object.values(await one(sql, p))[0])
const ref = () => `nr-${crypto.randomUUID()}`
const stock = (b) => num('SELECT stock_qty FROM products WHERE barcode = $1', [b])
let shiftId

before(async (t) => {
  if (!requireDb(t)) return
  twin = await makeTwin()
  ;({ shop, cloud, owner, cashier } = twin)
  await shop.pool.query(
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, unit_kind, category)
     VALUES ('CHEESE', 'جبنة رومي', 300, 400, 0, 'كيلو', 'weight', 'ألبان')`
  )
  // The owner opens his own shift (the drawer the refund leaves).
  shiftId = ok(await shop.call('shifts.open', { startingCash: 1000 }, owner)).id
})

after(async () => {
  await twin?.close()
})

const create = (body, who = owner) =>
  shop.call(
    'sales.returnWithoutInvoice',
    { clientRef: ref(), reason: 'عميل معروف بدون فاتورة', ...body },
    who
  )

test('a cashier without the permission is refused, and nothing is written', async (t) => {
  if (!requireDb(t)) return
  const r = await create({ lines: [{ barcode: 'RICE', quantity: 1 }] }, cashier)
  assert.equal(r.status, 403)
  assert.equal(await num('SELECT count(*) FROM customer_returns'), 0)
  // Not granted to the cashier role by default; the administrator roles have it.
  const roles = await q(
    `SELECT r.key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
      WHERE rp.permission = 'sales.return_without_invoice' AND r.key IS NOT NULL ORDER BY r.key`
  )
  assert.deepEqual(
    roles.map((r) => r.key),
    ['store_admin', 'super_admin']
  )
})

test('two products back: stock up, cash out of the owner drawer, at today selling price', async (t) => {
  if (!requireDb(t)) return
  const rice0 = await stock('RICE')
  const cheese0 = await stock('CHEESE')
  const expected0 = ok(await shop.call('shifts.auditPreview', { shiftId }, owner))
  const doc = ok(
    await create({
      lines: [
        { barcode: 'RICE', quantity: 2 },
        { barcode: 'CHEESE', quantity: 0.25 },
        { barcode: 'RICE', quantity: 1 } // the same product again: one line of 3
      ],
      clientId: twin.clientId
    })
  )
  assert.equal(doc.total, 3 * 25 + 0.25 * 400)
  assert.equal(doc.items.length, 2)
  assert.equal(doc.clientName, 'أم أحمد')
  assert.equal(doc.shiftId, shiftId)
  assert.equal(await stock('RICE'), rice0 + 3)
  assert.equal(await stock('CHEESE'), cheese0 + 0.25)
  // Each line's own stock movement, marked as this return.
  const moves = await q(
    "SELECT product_barcode, qty::float8 AS qty, kind, ref_type, ref_id FROM stock_movements WHERE ref_type = 'customer_return' ORDER BY id"
  )
  assert.deepEqual(
    moves.map((m) => [m.product_barcode, m.qty, m.kind, m.ref_id]),
    [
      ['RICE', 3, 'customer_return', doc.id],
      ['CHEESE', 0.25, 'customer_return', doc.id]
    ]
  )
  // The drawer: one cash refund movement of the shift, and the expected cash is lower by it.
  const cash = await q(
    'SELECT type, amount::float8 AS amount, method, kind, ref_type, description FROM safe_ledger WHERE id = $1',
    [doc.ledgerId]
  )
  assert.equal(cash.length, 1)
  assert.deepEqual(
    { ...cash[0], description: undefined },
    {
      type: 'outflow',
      amount: 175,
      method: 'cash',
      kind: 'refund',
      ref_type: 'customer_return',
      description: undefined
    }
  )
  assert.match(cash[0].description, /^مرتجع بدون فاتورة #/)
  const expected1 = ok(await shop.call('shifts.auditPreview', { shiftId }, owner))
  assert.equal(expected1.expected, expected0.expected - 175)
  // The price is kept on the return: a later price change does not change it.
  await shop.pool.query("UPDATE products SET retail_price = 30 WHERE barcode = 'RICE'")
  const again = ok(await shop.call('sales.returnWithoutInvoiceDetail', { id: doc.id }, owner))
  assert.equal(again.items.find((i) => i.barcode === 'RICE').unitPrice, 25)
  await shop.pool.query("UPDATE products SET retail_price = 25 WHERE barcode = 'RICE'")
})

test('the same request again returns the same return: one refund, one set of movements', async (t) => {
  if (!requireDb(t)) return
  const clientRef = ref()
  const body = { clientRef, reason: 'إعادة إرسال', lines: [{ barcode: 'SUGAR', quantity: 2 }] }
  const first = ok(await shop.call('sales.returnWithoutInvoice', body, owner))
  const second = ok(await shop.call('sales.returnWithoutInvoice', body, owner))
  assert.equal(second.id, first.id)
  assert.equal(second.duplicate, true)
  assert.equal(
    await num('SELECT count(*) FROM customer_returns WHERE client_ref = $1', [clientRef]),
    1
  )
  assert.equal(
    await num(
      "SELECT count(*) FROM safe_ledger WHERE ref_type = 'customer_return' AND ref_id = $1",
      [first.id]
    ),
    1
  )
  assert.equal(
    await num(
      "SELECT count(*) FROM stock_movements WHERE ref_type = 'customer_return' AND ref_id = $1",
      [first.id]
    ),
    1
  )
  // Two at the same moment (a double press): still one.
  const ref2 = ref()
  const both = await Promise.all([
    shop.call('sales.returnWithoutInvoice', { ...body, clientRef: ref2 }, owner),
    shop.call('sales.returnWithoutInvoice', { ...body, clientRef: ref2 }, owner)
  ])
  assert.ok(both.some((r) => r.status === 200))
  assert.equal(await num('SELECT count(*) FROM customer_returns WHERE client_ref = $1', [ref2]), 1)
})

test('invalid returns are refused whole: quantity, product, price, no open shift', async (t) => {
  if (!requireDb(t)) return
  const before = await num('SELECT count(*) FROM customer_returns')
  const rice = await stock('RICE')
  // Half a sack of a product counted in sacks.
  assert.equal((await create({ lines: [{ barcode: 'RICE', quantity: 1.5 }] })).status, 400)
  // More than three decimals of a kilogram.
  assert.equal((await create({ lines: [{ barcode: 'CHEESE', quantity: 0.0005 }] })).status, 400)
  assert.equal((await create({ lines: [{ barcode: 'NOPE', quantity: 1 }] })).status, 404)
  assert.equal((await create({ lines: [] })).status, 400)
  assert.equal((await create({ lines: [{ barcode: 'RICE', quantity: -1 }] })).status, 400)
  // A valid line with an invalid one: nothing at all.
  assert.equal(
    (
      await create({
        lines: [
          { barcode: 'RICE', quantity: 1 },
          { barcode: 'NOPE', quantity: 1 }
        ]
      })
    ).status,
    404
  )
  // A product without a selling price.
  await shop.pool.query(
    "INSERT INTO products (barcode, name, retail_price, stock_qty, unit) VALUES ('FREE', 'هدية', 0, 0, 'قطعة')"
  )
  assert.equal((await create({ lines: [{ barcode: 'FREE', quantity: 1 }] })).status, 400)
  assert.equal(await num('SELECT count(*) FROM customer_returns'), before)
  assert.equal(await stock('RICE'), rice)
  // Granted to a user with no open shift: refused, the refund needs a drawer.
  await shop.pool.query(
    `INSERT INTO role_permissions (role_id, permission)
     SELECT role_id, 'sales.return_without_invoice' FROM users WHERE username = 'second'`
  )
  const { login } = require('./helpers')
  const second = await login(shop, '6205')
  const r = await create({ lines: [{ barcode: 'RICE', quantity: 1 }] }, second)
  assert.equal(r.status, 409)
  assert.equal(r.body.error.code, 'shift_required')
})

test('the close report counts it: returns list, total and the expected cash', async (t) => {
  if (!requireDb(t)) return
  const { report } = ok(await shop.call('shifts.details', { shiftId }, owner))
  const plain = report.returns.lines.filter((l) => l.kind === 'no_invoice')
  assert.ok(plain.length >= 2, JSON.stringify(report.returns))
  assert.ok(plain.every((l) => l.saleId === null && l.kindLabel === 'مرتجع بدون فاتورة'))
  const refunded = await num(
    'SELECT COALESCE(SUM(total), 0) FROM customer_returns WHERE shift_id = $1',
    [shiftId]
  )
  assert.ok(report.returns.total >= refunded)
  assert.equal(report.cash.refunds, refunded)
  // The list of returns without an invoice.
  const page = ok(await shop.call('sales.returnsWithoutInvoice', {}, owner))
  assert.equal(page.total, await num('SELECT count(*) FROM customer_returns'))
})

test('made while the shop is offline, sent later and delivered twice: the cloud holds each once', async (t) => {
  if (!requireDb(t)) return
  twin.transport.down = true
  const doc = ok(await create({ lines: [{ barcode: 'SUGAR', quantity: 1 }] }))
  // Not in the cloud while offline.
  assert.equal(
    (
      await cloud.pool.query('SELECT count(*)::int AS n FROM customer_returns WHERE id = $1', [
        doc.id
      ])
    ).rows[0].n,
    0
  )
  twin.transport.down = false
  await twin.sync()
  assert.deepEqual(await copyDifferences(twin), [])
  const c = async (sql) => (await cloud.pool.query(sql, [doc.id])).rows[0].n
  assert.equal(await c('SELECT count(*)::int AS n FROM customer_returns WHERE id = $1'), 1)
  assert.equal(
    await c('SELECT count(*)::int AS n FROM customer_return_items WHERE return_id = $1'),
    1
  )
  assert.equal(
    await c(
      "SELECT count(*)::int AS n FROM safe_ledger WHERE ref_type = 'customer_return' AND ref_id = $1"
    ),
    1
  )
  assert.equal(
    await c(
      "SELECT count(*)::int AS n FROM stock_movements WHERE ref_type = 'customer_return' AND ref_id = $1"
    ),
    1
  )
  // Everything sent again (a reply lost on the way): still once.
  await shop.pool.query("SELECT hm_sync_snapshot('customer_returns')")
  await shop.pool.query("SELECT hm_sync_snapshot('customer_return_items')")
  await twin.sync()
  assert.equal(await c('SELECT count(*)::int AS n FROM customer_returns WHERE id = $1'), 1)
  assert.equal(
    await c('SELECT count(*)::int AS n FROM customer_return_items WHERE return_id = $1'),
    1
  )
  assert.deepEqual(await copyDifferences(twin), [])
})

test('the reason is optional: none, or only spaces, is kept as no reason', async (t) => {
  if (!requireDb(t)) return
  for (const reason of [undefined, '   ']) {
    const r = await create({ lines: [{ barcode: 'RICE', quantity: 1 }], reason })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.reason, null)
    assert.equal(
      (await q('SELECT reason FROM customer_returns WHERE id = $1', [r.body.id]))[0].reason,
      null
    )
  }
})
