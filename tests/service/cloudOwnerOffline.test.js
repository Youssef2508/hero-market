'use strict'
// The owner on the phone while the shop's PC is offline, and after it is back (owner's report of
// 2026-11-15, D-110, D-111). Every call goes the way a browser makes it: the session in a cookie
// that the answers may set, kept the way a browser keeps it.
//
//   * Approving and rejecting supplier payment requests: offline, back online, by the same user on
//     two phones, by two administrators, a lost answer, approval and rejection at the same moment.
//     Before 1.8.0 the reservation taken before deciding replaced the browser's session: the next
//     step was answered "signed out", so nothing could be decided from the phone while the shop
//     was offline (the proxy log: reserve 200, approve 401, 15 times).
//   * Changes only the shop can make (a barcode change, a deletion, a purchase correction) are kept
//     for it and carried out there once on its return, or withdrawn; a conflict found there is
//     reported, never lost. Other product edits are made from the phone at once, offline or not.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, passwordFor, createUser } = require('./helpers')
const { makeTwin, copyDifferences, inStep, ok } = require('./cloudHelpers')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const num = async (pool, sql, p) => Number(Object.values((await pool.query(sql, p)).rows[0])[0])

/** A browser: its cookie jar follows every Set-Cookie, as a phone's browser does. */
function browser(twin, username, code) {
  let cookie = null
  const post = async (op, body = {}, headers = {}) => {
    const r = await twin.cloud.app.inject({
      method: 'POST',
      url: `/api/${op}`,
      payload: body,
      headers: {
        'x-heromarket-web': '1',
        'x-heromarket-operation-id': headers.id || crypto.randomUUID(),
        ...(cookie ? { cookie } : {})
      }
    })
    const set = r.headers['set-cookie']
    if (set) {
      const c = String(Array.isArray(set) ? set[0] : set).split(';')[0]
      cookie = c.endsWith('=') ? null : c
    }
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null }
  }
  return {
    post,
    async signIn() {
      const r = await post('auth.login', { username, password: passwordFor(code) })
      assert.equal(r.status, 200, JSON.stringify(r.body))
      return r.body
    },
    get cookie() {
      return cookie
    }
  }
}

async function cut(twin) {
  twin.transport.down = true
  for (let i = 0; i < 100 && (await twin.cloud.app.cloudLink.shopUp()); i++) await sleep(50)
  assert.equal(await twin.cloud.app.cloudLink.shopUp(), false)
}
async function rejoin(twin) {
  twin.transport.down = false
  for (let i = 0; i < 12; i++) {
    const last = await twin.agent.runOnce()
    if (last.check?.ok && !(await copyDifferences(twin)).length) break
  }
  for (let i = 0; i < 100 && !(await twin.cloud.app.cloudLink.shopUp()); i++) await sleep(50)
}
/** Until the shop has carried out what was kept for it and both sides hold the same. */
async function settle(twin, done) {
  for (let i = 0; i < 100; i++) {
    await twin.agent.runOnce().catch(() => {})
    if ((await done()) && !(await copyDifferences(twin)).length) return
    await sleep(100)
  }
  throw new Error(`not settled: ${(await copyDifferences(twin)).slice(0, 5)}`)
}

const figures = async (pool, supplierId) => ({
  supplier: await num(pool, 'SELECT debt_balance FROM suppliers WHERE id = $1', [supplierId]),
  payments: await num(
    pool,
    "SELECT count(*) FROM supplier_ledger WHERE supplier_id = $1 AND type = 'payment'",
    [supplierId]
  ),
  reversals: await num(
    pool,
    "SELECT count(*) FROM safe_ledger WHERE kind = 'supplier_payment_reversal'"
  ),
  drawer: await num(pool, 'SELECT COALESCE(SUM(amount), 0) FROM safe_ledger')
})

test('approvals from the phone: the shop offline, back online, the session kept throughout', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const { shop, cloud } = twin
    const shift = ok(await shop.call('shifts.open', { startingCash: 500 }, twin.owner))
    await twin.sync()
    const phone = browser(twin, 'owner', '8642')
    await phone.signIn()
    const create = async (amount) =>
      ok(
        await phone.post('supplierPayments.create', {
          supplierId: twin.supplierId,
          amount,
          currentShiftId: shift.id,
          clientRef: crypto.randomUUID()
        })
      ).request.id
    const decide = async (id, how) => {
      const r = await phone.post('supplierPayments.reserve', { requestId: id })
      assert.equal(r.status, 200, `reserve: ${JSON.stringify(r.body)}`)
      // The reservation's token is in the answer; the browser's session cookie is unchanged.
      assert.match(r.body.token, /^[0-9a-f-]{36}$/)
      const d =
        how === 'approve'
          ? await phone.post('supplierPayments.approve', {
              requestId: id,
              reservationToken: r.body.token
            })
          : await phone.post('supplierPayments.reject', {
              requestId: id,
              note: 'المبلغ غير صحيح',
              reservationToken: r.body.token
            })
      assert.equal(d.status, 200, `${how}: ${JSON.stringify(d.body)}`)
      return d.body.request
    }
    const session = phone.cookie

    // Offline: two requests from the phone, one approved, one rejected – each at once.
    await cut(twin)
    const r1 = await create(60)
    const r2 = await create(40)
    const started = Date.now()
    assert.equal((await decide(r1, 'approve')).status, 'approved')
    assert.equal((await decide(r2, 'reject')).status, 'rejected')
    assert.ok(Date.now() - started < 3000, 'no waiting for the unreachable shop')
    assert.equal(phone.cookie, session, 'still the same session')
    assert.equal((await phone.post('auth.me')).status, 200)

    // Back online: both reach the shop once; the balance fell once, the 40 went back once.
    const before = await figures(shop.pool, twin.supplierId)
    await rejoin(twin)
    const shopFigures = await figures(shop.pool, twin.supplierId)
    assert.equal(shopFigures.supplier, before.supplier - 60)
    assert.equal(shopFigures.payments, before.payments + 1)
    assert.equal(shopFigures.reversals, 1)
    assert.deepEqual(await figures(cloud.pool, twin.supplierId), shopFigures)
    assert.deepEqual(await copyDifferences(twin), [])

    // Online: a request made at the shop, decided from the phone (carried out in the shop).
    const r3 = ok(
      await shop.call(
        'supplierPayments.create',
        {
          supplierId: twin.supplierId,
          amount: 25,
          currentShiftId: shift.id,
          clientRef: crypto.randomUUID()
        },
        twin.owner
      )
    ).request.id
    assert.deepEqual(await inStep(twin), [])
    assert.equal((await decide(r3, 'approve')).status, 'approved')
    const r4 = await create(15)
    assert.equal((await decide(r4, 'reject')).status, 'rejected')
    assert.equal(phone.cookie, session)
    const after = await figures(shop.pool, twin.supplierId)
    assert.equal(after.supplier, shopFigures.supplier - 25)
    assert.equal(after.reversals, 2)
    // Nothing waits for the shop and nothing is left reserved.
    assert.equal(
      await num(
        shop.pool,
        'SELECT count(*) FROM supplier_payment_requests WHERE reserved_by IS NOT NULL'
      ),
      0
    )
  } finally {
    await twin.close()
  }
})

test('the same request on two phones and by two administrators; a reservation left behind expires', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const { shop, cloud } = twin
    await createUser(shop, { username: 'manager2', pin: '7391', roleKey: 'store_admin' })
    const shift = ok(await shop.call('shifts.open', { startingCash: 500 }, twin.owner))
    await twin.sync()
    const a = browser(twin, 'owner', '8642')
    const b = browser(twin, 'owner', '8642')
    const other = browser(twin, 'manager2', '7391')
    await a.signIn()
    await b.signIn()
    await other.signIn()
    await cut(twin)
    const id = ok(
      await a.post('supplierPayments.create', {
        supplierId: twin.supplierId,
        amount: 70,
        currentShiftId: shift.id,
        clientRef: crypto.randomUUID()
      })
    ).request.id
    // The same user on two phones holds one reservation (the same token), never blocked by itself.
    const ra = ok(await a.post('supplierPayments.reserve', { requestId: id }))
    const rb = ok(await b.post('supplierPayments.reserve', { requestId: id }))
    assert.equal(ra.token, rb.token)
    // Another administrator is refused while it is held, with the holder's name.
    const busy = await other.post('supplierPayments.reserve', { requestId: id })
    assert.equal(busy.status, 409)
    assert.match(busy.body.error.message, /owner/)
    // Approved on one phone; the other phone's approval is the same outcome, once.
    const before = await num(cloud.pool, 'SELECT debt_balance FROM suppliers WHERE id = $1', [
      twin.supplierId
    ])
    assert.equal(
      ok(await a.post('supplierPayments.approve', { requestId: id, reservationToken: ra.token }))
        .request.status,
      'approved'
    )
    const dup = ok(
      await b.post('supplierPayments.approve', { requestId: id, reservationToken: rb.token })
    )
    assert.equal(dup.duplicate, true)
    assert.equal(
      await num(cloud.pool, 'SELECT debt_balance FROM suppliers WHERE id = $1', [twin.supplierId]),
      before - 70
    )

    // A phone that reserved and was closed (its connection gone): the reservation expires by
    // itself and another administrator takes over.
    const id2 = ok(
      await a.post('supplierPayments.create', {
        supplierId: twin.supplierId,
        amount: 30,
        currentShiftId: shift.id,
        clientRef: crypto.randomUUID()
      })
    ).request.id
    ok(await a.post('supplierPayments.reserve', { requestId: id2 }))
    assert.equal((await other.post('supplierPayments.reserve', { requestId: id2 })).status, 409)
    process.env.HEROMARKET_TEST_CLOCK_OFFSET_SECONDS = String(6 * 60)
    try {
      const taken = ok(await other.post('supplierPayments.reserve', { requestId: id2 }))
      const done = ok(
        await other.post('supplierPayments.reject', {
          requestId: id2,
          note: 'تم التحقق',
          reservationToken: taken.token
        })
      )
      assert.equal(done.request.status, 'rejected')
    } finally {
      delete process.env.HEROMARKET_TEST_CLOCK_OFFSET_SECONDS
    }
    await rejoin(twin)
    assert.deepEqual(await copyDifferences(twin), [])
  } finally {
    await twin.close()
  }
})

test('approval and rejection at the same moment, and the same approval twice: one outcome', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const { shop, cloud } = twin
    const shift = ok(await shop.call('shifts.open', { startingCash: 500 }, twin.owner))
    await twin.sync()
    const phone = browser(twin, 'owner', '8642')
    await phone.signIn()
    for (const online of [false, true]) {
      if (!online) await cut(twin)
      else await rejoin(twin)
      const id = ok(
        await phone.post('supplierPayments.create', {
          supplierId: twin.supplierId,
          amount: 20,
          currentShiftId: shift.id,
          clientRef: crypto.randomUUID()
        })
      ).request.id
      const pool = online ? shop.pool : cloud.pool
      const before = await figures(pool, twin.supplierId)
      const [x, y, z] = await Promise.all([
        phone.post('supplierPayments.approve', { requestId: id }),
        phone.post('supplierPayments.reject', { requestId: id, note: 'سباق' }),
        phone.post('supplierPayments.approve', { requestId: id })
      ])
      const status = (
        await pool.query('SELECT status FROM supplier_payment_requests WHERE id = $1', [id])
      ).rows[0].status
      assert.ok(['approved', 'rejected'].includes(status))
      const now = await figures(pool, twin.supplierId)
      if (status === 'approved') {
        assert.equal(now.supplier, before.supplier - 20)
        assert.equal(now.payments, before.payments + 1, 'paid once')
        assert.equal(now.reversals, before.reversals)
      } else {
        assert.equal(now.supplier, before.supplier)
        assert.equal(now.reversals, before.reversals + 1, 'reversed once')
      }
      // Every answer is the one outcome, or says it was already decided.
      for (const r of [x, y, z]) assert.ok([200, 409].includes(r.status), JSON.stringify(r.body))
    }
    await rejoin(twin)
    assert.deepEqual(await copyDifferences(twin), [])
  } finally {
    await twin.close()
  }
})

test('an approval whose answer is lost: the phone asks what happened – carried out once', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const { shop, cloud } = twin
    const shift = ok(await shop.call('shifts.open', { startingCash: 500 }, twin.owner))
    const id = ok(
      await shop.call(
        'supplierPayments.create',
        {
          supplierId: twin.supplierId,
          amount: 45,
          currentShiftId: shift.id,
          clientRef: crypto.randomUUID()
        },
        twin.owner
      )
    ).request.id
    await twin.sync()
    const phone = browser(twin, 'owner', '8642')
    await phone.signIn()
    const before = await figures(shop.pool, twin.supplierId)
    const opId = crypto.randomUUID()
    twin.transport.loseResults = 1
    const lost = await phone.post('supplierPayments.approve', { requestId: id }, { id: opId })
    // Either the answer arrived after all, or the phone is told to wait – never "failed".
    if (lost.status !== 200) {
      assert.equal(lost.status, 504)
      assert.equal(lost.body.error.code, 'pending_confirmation')
      assert.equal(lost.body.error.details.operationId, opId)
    }
    let o
    for (let i = 0; i < 100; i++) {
      o = ok(await phone.post('link.operation', { operationId: opId }))
      if (o.status === 'applied') break
      await sleep(50)
    }
    assert.equal(o.status, 'applied')
    assert.equal(o.result.request.status, 'approved')
    // Sent again with the same id: the same outcome; a new attempt: already decided. Once.
    ok(await phone.post('supplierPayments.approve', { requestId: id }, { id: opId }))
    assert.equal(
      ok(await phone.post('supplierPayments.approve', { requestId: id })).duplicate,
      true
    )
    const now = await figures(shop.pool, twin.supplierId)
    assert.equal(now.supplier, before.supplier - 45)
    assert.equal(now.payments, before.payments + 1)
    await twin.sync()
    assert.deepEqual(await figures(cloud.pool, twin.supplierId), now)
  } finally {
    await twin.close()
  }
})

test('the owner edits products from the phone with the shop offline: saved at once, merged on return', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const { shop, cloud } = twin
    const cat = ok(await shop.call('categories.save', { name: 'مشروبات' }, twin.owner))
    await twin.sync()
    const phone = browser(twin, 'owner', '8642')
    await phone.signIn()
    await cut(twin)
    const product = async (pool, b) =>
      (
        await pool.query(
          'SELECT name, retail_price::float8 AS price, cost_price::float8 AS cost, category_id, is_active, unit FROM products WHERE barcode = $1',
          [b]
        )
      ).rows[0]
    const rice = {
      ...(await product(cloud.pool, 'RICE')),
      stock: await num(cloud.pool, "SELECT stock_qty FROM products WHERE barcode = 'RICE'")
    }
    // Several fields in one change, and the product stopped from sale – all from the phone.
    ok(
      await phone.post('products.update', {
        barcode: 'RICE',
        name: 'أرز مصري',
        cost_price: 22,
        retail_price: 28,
        stock_qty: rice.stock,
        stock_base: rice.stock,
        reorder_limit: 10,
        unit: 'كيس',
        unit_kind: 'count',
        category_id: cat.id,
        is_active: false
      })
    )
    const phoneView = await product(cloud.pool, 'RICE')
    assert.deepEqual(phoneView, {
      name: 'أرز مصري',
      price: 28,
      cost: 22,
      category_id: cat.id,
      is_active: false,
      unit: 'كيس'
    })
    // Meanwhile at the shop: the same product's price (the same field) and its reorder limit.
    ok(
      await shop.call(
        'products.update',
        {
          barcode: 'RICE',
          name: rice.name,
          cost_price: rice.cost,
          retail_price: 27,
          stock_qty: rice.stock,
          stock_base: rice.stock,
          reorder_limit: 15,
          unit: 'كيس',
          unit_kind: 'count'
        },
        twin.owner
      )
    )
    await rejoin(twin)
    const merged = await product(shop.pool, 'RICE')
    // Different fields are both kept; the same field keeps the shop's value and is listed.
    assert.equal(merged.name, 'أرز مصري')
    assert.equal(merged.cost, 22)
    assert.equal(merged.category_id, cat.id)
    assert.equal(merged.is_active, false)
    assert.equal(merged.price, 27)
    assert.equal(
      await num(shop.pool, "SELECT reorder_limit FROM products WHERE barcode = 'RICE'"),
      15
    )
    const listed = await num(shop.pool, "SELECT count(*) FROM sync_attention WHERE status = 'open'")
    assert.ok(listed >= 1, 'the same-field change is listed for a person')
    assert.deepEqual(await product(cloud.pool, 'RICE'), merged)
    assert.deepEqual(await copyDifferences(twin), [])
  } finally {
    await twin.close()
  }
})

test('a barcode change and a deletion from the phone while the shop is offline: kept, then done once', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const { shop, cloud } = twin
    await twin.sync()
    const phone = browser(twin, 'owner', '8642')
    await phone.signIn()
    // A product only for this test, with no history, so it may be deleted.
    ok(
      await shop.call(
        'products.create',
        {
          barcode: 'TEMP1',
          name: 'صنف مؤقت',
          cost_price: 1,
          retail_price: 2,
          stock_qty: 0,
          unit: 'قطعة'
        },
        twin.owner
      )
    )
    ok(
      await shop.call(
        'products.create',
        {
          barcode: 'TEMP2',
          name: 'صنف مؤقت 2',
          cost_price: 1,
          retail_price: 2,
          stock_qty: 0,
          unit: 'قطعة'
        },
        twin.owner
      )
    )
    await twin.sync()
    await cut(twin)

    const change = await phone.post('products.changeBarcode', {
      barcode: 'SUGAR',
      newBarcode: '0099'
    })
    assert.equal(change.status, 202)
    assert.equal(change.body.pending, true)
    // Kept for the shop, not done here: the copy still has SUGAR, the screens say it waits.
    assert.equal(await num(cloud.pool, "SELECT count(*) FROM products WHERE barcode = 'SUGAR'"), 1)
    // The rest of the product is saved now, on its current barcode.
    const sugar = (await cloud.pool.query("SELECT * FROM products WHERE barcode = 'SUGAR'")).rows[0]
    ok(
      await phone.post('products.update', {
        barcode: 'SUGAR',
        name: 'سكر أبيض',
        cost_price: Number(sugar.cost_price),
        retail_price: 31,
        stock_qty: Number(sugar.stock_qty),
        reorder_limit: 10,
        unit: sugar.unit,
        unit_kind: sugar.unit_kind
      })
    )
    const del = await phone.post('products.delete', { barcode: 'TEMP1' })
    assert.equal(del.status, 202)
    const withdraw = await phone.post('products.delete', { barcode: 'TEMP2' })
    assert.equal(withdraw.status, 202)
    // The same attempt again (a retry): still one operation.
    const again = await phone.post(
      'products.changeBarcode',
      { barcode: 'SUGAR', newBarcode: '0099' },
      { id: change.body.operationId }
    )
    assert.equal(again.status, 202)
    // One withdrawn before the shop is back: it never reaches the shop.
    const w = ok(await phone.post('cloud.withdrawOperation', { id: withdraw.body.operationId }))
    assert.equal(w.status, 'withdrawn')
    const waiting = ok(await phone.post('cloud.operations'))
    assert.deepEqual(
      waiting.map((o) => [o.operation, o.status]).sort(),
      [
        ['products.changeBarcode', 'queued'],
        ['products.delete', 'queued'],
        ['products.delete', 'withdrawn']
      ].sort()
    )
    const state = ok(await phone.post('link.state'))
    assert.equal(state.deferredOperations, 2)

    // The shop returns: the phone's own changes first, then the kept operations, each once.
    twin.transport.down = false
    await settle(twin, async () => {
      const ops = ok(await phone.post('cloud.operations'))
      return ops.every((o) => !['queued', 'sent'].includes(o.status))
    })
    const ops = ok(await phone.post('cloud.operations'))
    assert.deepEqual(ops.map((o) => o.status).sort(), ['applied', 'applied', 'withdrawn'].sort())
    for (const pool of [shop.pool, cloud.pool]) {
      const p = (
        await pool.query(
          "SELECT name, retail_price::float8 AS price FROM products WHERE barcode = '0099'"
        )
      ).rows[0]
      assert.deepEqual(
        p,
        { name: 'سكر أبيض', price: 31 },
        'the new name and price, on the new barcode'
      )
      assert.equal(await num(pool, "SELECT count(*) FROM products WHERE barcode = 'SUGAR'"), 0)
      assert.equal(await num(pool, "SELECT count(*) FROM products WHERE barcode = 'TEMP1'"), 0)
      assert.equal(await num(pool, "SELECT count(*) FROM products WHERE barcode = 'TEMP2'"), 1)
    }
    // Its history followed it: the opening stock movement is the new barcode's.
    assert.ok(
      (await num(
        shop.pool,
        "SELECT count(*) FROM stock_movements WHERE product_barcode = '0099'"
      )) > 0
    )
    assert.deepEqual(await copyDifferences(twin), [])
  } finally {
    await twin.close()
  }
})

test('a kept barcode change that conflicts with the shop: refused there, reported, nothing lost', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const { shop, cloud } = twin
    await twin.sync()
    const phone = browser(twin, 'owner', '8642')
    await phone.signIn()
    await cut(twin)
    const change = await phone.post('products.changeBarcode', {
      barcode: 'RICE',
      newBarcode: '777'
    })
    assert.equal(change.status, 202)
    // Meanwhile at the shop another product gets that barcode.
    ok(
      await shop.call(
        'products.create',
        {
          barcode: '777',
          name: 'منتج الخصم',
          cost_price: 1,
          retail_price: 2,
          stock_qty: 0,
          unit: 'قطعة'
        },
        twin.owner
      )
    )
    twin.transport.down = false
    await settle(twin, async () => {
      const ops = ok(await phone.post('cloud.operations'))
      return ops.every((o) => !['queued', 'sent'].includes(o.status))
    })
    const [op] = ok(await phone.post('cloud.operations'))
    assert.equal(op.status, 'refused')
    assert.ok(op.error?.message, 'the reason is shown to the owner')
    for (const pool of [shop.pool, cloud.pool]) {
      assert.equal(await num(pool, "SELECT count(*) FROM products WHERE barcode = 'RICE'"), 1)
      assert.equal(
        (await pool.query("SELECT name FROM products WHERE barcode = '777'")).rows[0].name,
        'منتج الخصم'
      )
    }
    assert.deepEqual(await copyDifferences(twin), [])
  } finally {
    await twin.close()
  }
})

test('a purchase correction from the phone while the shop is offline: kept, then applied once', async (t) => {
  if (!requireDb(t)) return
  const twin = await makeTwin()
  try {
    const { shop, cloud } = twin
    const p = ok(
      await shop.call(
        'suppliers.addPurchase',
        {
          supplierId: twin.supplierId,
          invoice_ref: 'OFF-1',
          total_amount: 300,
          paid_amount: 0,
          payment_type: 'آجل',
          clientRef: crypto.randomUUID(),
          items: [{ barcode: 'SUGAR', qty: 10, unitCost: 30 }]
        },
        twin.owner
      )
    )
    await twin.sync()
    const phone = browser(twin, 'owner', '8642')
    await phone.signIn()
    await cut(twin)
    const detail = ok(await phone.post('suppliers.purchaseDetail', { purchaseId: p.purchaseId }))
    const body = {
      purchaseId: p.purchaseId,
      expectedRevision: 0,
      items: [{ itemId: detail.items[0].id, barcode: 'SUGAR', qty: 12, unitCost: 30 }],
      reason: 'وصل 12'
    }
    // The preview works from the copy, offline.
    const preview = ok(await phone.post('suppliers.previewRevision', body))
    assert.equal(preview.delta, 60)
    const saved = await phone.post('suppliers.revisePurchase', {
      ...body,
      clientRef: crypto.randomUUID()
    })
    assert.equal(saved.status, 202)
    const balance = (pool) =>
      num(pool, 'SELECT debt_balance FROM suppliers WHERE id = $1', [twin.supplierId])
    const b0 = await balance(shop.pool)
    twin.transport.down = false
    await settle(twin, async () => {
      const ops = ok(await phone.post('cloud.operations'))
      return ops.every((o) => !['queued', 'sent'].includes(o.status))
    })
    const [op] = ok(await phone.post('cloud.operations'))
    assert.equal(op.status, 'applied')
    assert.equal(await balance(shop.pool), b0 + 60)
    assert.equal(await balance(cloud.pool), b0 + 60)
    assert.equal(
      await num(shop.pool, 'SELECT revision FROM supplier_purchases WHERE id = $1', [p.purchaseId]),
      1
    )
    assert.deepEqual(await copyDifferences(twin), [])
  } finally {
    await twin.close()
  }
})
