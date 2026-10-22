'use strict'
// Measurement kinds the owner adds (1.4.0, migration 0014): a name, the unit and the decimals a
// quantity may have. Every place that counts stock follows the kind's decimals; built-in kinds are
// unchanged; a kind in use cannot lose decimals or be deleted; backups keep the kinds.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

let db, svc, owner, cashier, shiftId, metre
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const refused = (r, status = 400) => {
  assert.equal(r.status, status, JSON.stringify(r.body))
  return r.body.error.message
}
const stock = async (barcode) =>
  Number(
    (await svc.pool.query('SELECT stock_qty FROM products WHERE barcode = $1', [barcode])).rows[0]
      .stock_qty
  )
const sell = (items) =>
  svc.call(
    'pos.checkout',
    { clientRef: crypto.randomUUID(), shiftId, paymentType: 'نقدي', items },
    cashier
  )

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  cashier = await login(svc, '5173')
  shiftId = ok(await svc.call('shifts.open', { startingCash: 0 }, cashier)).id
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('the three built-in kinds are there and cannot be changed', async (t) => {
  if (!requireDb(t)) return
  const { kinds } = ok(await svc.call('measureKinds.list', {}, cashier))
  assert.deepEqual(
    kinds.map((k) => [k.key, k.decimals, k.isSystem]),
    [
      ['count', 0, true],
      ['weight', 3, true],
      ['volume', 3, true]
    ]
  )
  refused(
    await svc.call('measureKinds.save', { key: 'count', name: 'x', unit: 'y', decimals: 2 }, owner)
  )
  refused(await svc.call('measureKinds.setActive', { key: 'weight', isActive: false }, owner))
  refused(await svc.call('measureKinds.delete', { key: 'volume' }, owner))
  // Only users who manage products may add kinds.
  refused(
    await svc.call('measureKinds.save', { name: 'بالمتر', unit: 'متر', decimals: 2 }, cashier),
    403
  )
})

test('the owner adds "بالمتر" with 2 decimals; products follow it everywhere', async (t) => {
  if (!requireDb(t)) return
  const r = ok(
    await svc.call('measureKinds.save', { name: 'بالمتر', unit: 'متر', decimals: 2 }, owner)
  )
  metre = r.key
  assert.match(metre, /^custom_\d+$/)
  refused(
    await svc.call('measureKinds.save', { name: ' بالمتر ', unit: 'م', decimals: 1 }, owner),
    409
  )

  // Opening stock: 2 decimals at most.
  refused(
    await svc.call(
      'products.create',
      {
        barcode: 'M1',
        name: 'قماش',
        retail_price: 40,
        unit: 'متر',
        unit_kind: metre,
        stock_qty: 10.555
      },
      owner
    )
  )
  ok(
    await svc.call(
      'products.create',
      {
        barcode: 'M1',
        name: 'قماش',
        retail_price: 40,
        unit: 'متر',
        unit_kind: metre,
        stock_qty: 10.5
      },
      owner
    )
  )
  assert.equal(await stock('M1'), 10.5)

  // Sale: 1.25 m is fine, 1.255 m is not.
  assert.match(refused(await sell([{ barcode: 'M1', qty: 1.255 }])), /خانتين عشريتين/)
  const sale = ok(await sell([{ barcode: 'M1', qty: 1.25 }]))
  assert.equal(await stock('M1'), 9.25)
  assert.equal(Number(sale.total ?? sale.totalAmount ?? 50), 50)

  // Purchase received in metres.
  const supplier = ok(await svc.call('suppliers.create', { name: 'مورد قماش' }, owner))
  ok(
    await svc.call(
      'suppliers.addPurchase',
      {
        supplierId: supplier.id,
        total_amount: 22.5,
        paid_amount: 0,
        payment_type: 'آجل',
        items: [{ barcode: 'M1', qty: 0.75, unitCost: 30 }]
      },
      owner
    )
  )
  assert.equal(await stock('M1'), 10)

  // A packaging unit (a roll of 25.5 m) needs a factor with at most 2 decimals.
  refused(
    await svc.call(
      'productUnits.save',
      { barcode: 'M1', units: [{ name: 'لفة', factor: 25.555 }] },
      owner
    )
  )
  ok(
    await svc.call(
      'productUnits.save',
      { barcode: 'M1', units: [{ name: 'لفة', factor: 25.5, retail_price: 100 }] },
      owner
    )
  )

  // Return 0.25 m of the sale.
  const line = (
    await svc.pool.query('SELECT id FROM sale_items WHERE product_barcode = $1', ['M1'])
  ).rows[0]
  ok(await svc.call('sales.returnItem', { saleItemId: line.id, quantity: 0.25 }, owner))
  assert.equal(await stock('M1'), 10.25)
})

test('a kind in use keeps its decimals or more, and is stopped rather than deleted', async (t) => {
  if (!requireDb(t)) return
  assert.equal(
    refused(
      await svc.call(
        'measureKinds.save',
        { key: metre, name: 'بالمتر', unit: 'متر', decimals: 1 },
        owner
      ),
      409
    ).includes('يمكن زيادتها فقط'),
    true
  )
  ok(
    await svc.call(
      'measureKinds.save',
      { key: metre, name: 'بالمتر', unit: 'م', decimals: 3 },
      owner
    )
  )
  refused(await svc.call('measureKinds.delete', { key: metre }, owner), 409)

  // Stopped: not offered for new products; the product that has it keeps it and still sells.
  ok(await svc.call('measureKinds.setActive', { key: metre, isActive: false }, owner))
  assert.match(
    refused(
      await svc.call(
        'products.create',
        { barcode: 'M2', name: 'شريط', retail_price: 5, unit_kind: metre },
        owner
      )
    ),
    /موقوفة/
  )
  ok(
    await svc.call(
      'products.update',
      { barcode: 'M1', name: 'قماش قطن', retail_price: 40, unit: 'متر', unit_kind: metre },
      owner
    )
  )
  ok(await sell([{ barcode: 'M1', qty: 0.125 }]))
  ok(await svc.call('measureKinds.setActive', { key: metre, isActive: true }, owner))

  // Switching the product to whole pieces needs whole stock (10.125 m is not).
  assert.match(
    refused(
      await svc.call(
        'products.update',
        { barcode: 'M1', name: 'قماش قطن', retail_price: 40, unit: 'متر', unit_kind: 'count' },
        owner
      )
    ),
    /عدداً صحيحاً/
  )
})

test('an unused kind can be deleted; unknown kinds are refused', async (t) => {
  if (!requireDb(t)) return
  const { key } = ok(
    await svc.call('measureKinds.save', { name: 'بالدستة', unit: 'دستة', decimals: 0 }, owner)
  )
  ok(
    await svc.call(
      'products.create',
      { barcode: 'D1', name: 'بيض', retail_price: 60, unit_kind: key },
      owner
    )
  )
  // Whole numbers only, like count.
  refused(await sell([{ barcode: 'D1', qty: 1.5 }]))
  ok(await sell([{ barcode: 'D1', qty: 2 }]))
  ok(
    await svc.call(
      'products.update',
      { barcode: 'D1', name: 'بيض', retail_price: 60, unit_kind: 'count' },
      owner
    )
  )
  ok(await svc.call('measureKinds.delete', { key }, owner))
  refused(
    await svc.call(
      'products.create',
      { barcode: 'X1', name: 'س', retail_price: 1, unit_kind: key },
      owner
    )
  )
})

test('backups keep the kinds; a restore brings them back with their products', async (t) => {
  if (!requireDb(t)) return
  const backup = ok(await svc.call('backup.export', {}, owner))
  assert.ok(backup.tables.measure_kinds.rows.length >= 4)
  ok(await svc.call('measureKinds.save', { name: 'بالقدم', unit: 'قدم', decimals: 1 }, owner))
  ok(await svc.call('backup.restore', { backup, confirm: 'RESTORE' }, owner))
  const again = await login(svc, '8642')
  const { kinds } = ok(await svc.call('measureKinds.list', {}, again))
  assert.ok(kinds.some((k) => k.key === metre && k.decimals === 3))
  assert.ok(!kinds.some((k) => k.name === 'بالقدم'))
  const p = (await svc.pool.query("SELECT unit_kind FROM products WHERE barcode = 'M1'")).rows[0]
  assert.equal(p.unit_kind, metre)
})
