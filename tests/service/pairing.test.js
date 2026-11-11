'use strict'
// Pairing a shop installation with its cloud (D-102): a one-time code made on the server, a secret
// made by the PC and never shown, and a replacement PC that takes over without the store's data
// being touched or reset.
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
const { InProcessTransport } = require('../../src/server/sync/transport')
const { newPairingCode, fingerprint } = require('../../src/server/cloud/pairing')

const ok = (r, what = '') => {
  assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`)
  return r.body
}
const n = async (pool, sql, p) => Number((await pool.query(sql, p)).rows[0].n)

/** A shop PC that reaches the given cloud in-process, as it would over HTTPS. */
async function shopPc(cloud, pin, username) {
  const db = await freshDatabase()
  const pc = await startService(db.url, {
    pairRequest: async (body) => {
      const res = await cloud.app.inject({ method: 'POST', url: '/api/link.pair', payload: body })
      return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }
    },
    syncTransport: (st) =>
      new InProcessTransport({ app: cloud.app, storeId: st.store_id, token: st.device_token })
  })
  await createUser(pc, { username, pin, roleKey: 'super_admin' })
  return { pc, db, owner: await login(pc, pin) }
}

const syncNow = async (pc, owner) => {
  let last
  for (let i = 0; i < 6; i++) {
    last = ok(await pc.call('sync.runNow', {}, owner)).result
    if (last.check && last.check.ok) return last
  }
  throw new Error(`not in step: ${JSON.stringify(last)}`)
}

test('pairing: one code, one use, 15 minutes; the secret is the PC’s own; a replacement PC takes over safely', async (t) => {
  if (!requireDb(t)) return
  const cloudDb = await freshDatabase()
  const cloud = await startService(cloudDb.url, { role: 'cloud' })
  const a = await shopPc(cloud, '8642', 'owner')
  let b
  try {
    await seedProducts(
      a.pc,
      "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('RICE', 'أرز', 20, 25, 100, 'كيس')"
    )
    const url = 'http://127.0.0.1:9'
    // Nothing is linked, and a wrong code links nothing.
    assert.equal(await n(cloud.pool, 'SELECT count(*) AS n FROM cloud_stores'), 0)
    const first = await newPairingCode(cloud.pool, { name: 'هيرو ماركت' })
    assert.match(first.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    const wrong = await a.pc.call('sync.pair', { cloudUrl: url, code: 'AAAA-BBBB-CCCC' }, a.owner)
    assert.deepEqual([wrong.status, wrong.body.error.code], [403, 'pairing_refused'])
    assert.equal(await n(cloud.pool, 'SELECT count(*) AS n FROM cloud_stores'), 0)
    assert.equal(ok(await a.pc.call('sync.status', {}, a.owner)).linked, false)

    // The right code, typed as people type (lower case, spaces): linked, with what was linked shown.
    const storeId = (await a.pc.pool.query('SELECT store_id FROM sync_state')).rows[0].store_id
    const paired = ok(
      await a.pc.call(
        'sync.pair',
        { cloudUrl: url, code: first.code.toLowerCase().replace(/-/g, ' ') },
        a.owner
      )
    )
    assert.deepEqual(paired.paired, {
      name: 'هيرو ماركت',
      fingerprint: fingerprint(storeId),
      replaced: false
    })
    assert.equal(paired.linked, true)
    // The secret was made on the PC: it is in no answer, and the cloud holds only its hash.
    const secret = (await a.pc.pool.query('SELECT device_token FROM sync_state')).rows[0]
      .device_token
    assert.ok(secret.length >= 40)
    assert.ok(!JSON.stringify(paired).includes(secret))
    const held = (await cloud.pool.query('SELECT token_hash FROM cloud_stores')).rows[0].token_hash
    assert.equal(held, crypto.createHash('sha256').update(secret).digest('hex'))
    assert.equal(
      await n(cloud.pool, 'SELECT count(*) AS n FROM cloud_pairing_codes WHERE code_hash = $1', [
        first.code
      ]),
      0,
      'the code itself is not stored'
    )
    // The same code again: refused. An expired code: refused.
    const again = await a.pc.call('sync.pair', { cloudUrl: url, code: first.code }, a.owner)
    assert.equal(again.status, 403)
    const late = await newPairingCode(cloud.pool)
    await cloud.pool.query(
      "UPDATE cloud_pairing_codes SET expires_at = now() - interval '1 second' WHERE used_at IS NULL"
    )
    assert.equal(
      (await a.pc.call('sync.pair', { cloudUrl: url, code: late.code }, a.owner)).status,
      403
    )
    // Only an administrator pairs.
    await createUser(a.pc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
    assert.equal(
      (await a.pc.call('sync.pair', { cloudUrl: url, code: late.code }, await login(a.pc, '5173')))
        .status,
      403
    )

    // The shop works and synchronises with its own secret.
    const shift = ok(await a.pc.call('shifts.open', { startingCash: 100 }, a.owner))
    ok(
      await a.pc.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: shift.id,
          paymentType: 'نقدي',
          items: [{ barcode: 'RICE', qty: 3 }]
        },
        a.owner
      )
    )
    await syncNow(a.pc, a.owner)
    const held0 = {
      sales: await n(cloud.pool, 'SELECT count(*) AS n FROM sales'),
      users: await n(cloud.pool, 'SELECT count(*) AS n FROM users'),
      stock: await n(cloud.pool, "SELECT stock_qty AS n FROM products WHERE barcode = 'RICE'")
    }
    assert.deepEqual(held0, { sales: 1, users: 2, stock: 97 })

    // Repeated wrong codes cancel the code that is open.
    const open = await newPairingCode(cloud.pool)
    b = await shopPc(cloud, '7777', 'newpc')
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await b.pc.call('sync.pair', { cloudUrl: url, code: `ZZZZ-ZZZZ-ZZZ${i}` }, b.owner))
          .status,
        403
      )
    assert.equal(
      (await b.pc.call('sync.pair', { cloudUrl: url, code: open.code }, b.owner)).status,
      403,
      'cancelled by the wrong attempts'
    )

    // A replacement onto a PC that has business of its own is refused, and the code stays usable.
    const second = await newPairingCode(cloud.pool)
    const busyPc = await shopPc(cloud, '4444', 'busy')
    try {
      await seedProducts(
        busyPc.pc,
        "INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit) VALUES ('X', 'صنف', 1, 2, 5, 'قطعة')"
      )
      ok(await busyPc.pc.call('shifts.open', { startingCash: 0 }, busyPc.owner))
      const notFresh = await busyPc.pc.call(
        'sync.pair',
        { cloudUrl: url, code: second.code },
        busyPc.owner
      )
      assert.deepEqual([notFresh.status, notFresh.body.error.code], [502, 'not_fresh'])
      assert.equal(ok(await busyPc.pc.call('sync.status', {}, busyPc.owner)).linked, false)
    } finally {
      await busyPc.pc.close()
      await busyPc.db.dispose()
    }

    // A replacement PC: a new code. It continues the same store; the old PC is refused; the
    // cloud's records are exactly what they were; nothing is sent until the new PC has them.
    const took = ok(await b.pc.call('sync.pair', { cloudUrl: url, code: second.code }, b.owner))
    assert.deepEqual(took.paired, {
      name: 'هيرو ماركت',
      fingerprint: fingerprint(storeId),
      replaced: true
    })
    assert.equal(took.storeId, storeId)
    assert.equal(took.recoveryPending, true, 'work pauses until the store’s records are here')
    assert.deepEqual(
      {
        sales: await n(cloud.pool, 'SELECT count(*) AS n FROM sales'),
        users: await n(cloud.pool, 'SELECT count(*) AS n FROM users'),
        stock: await n(cloud.pool, "SELECT stock_qty AS n FROM products WHERE barcode = 'RICE'")
      },
      held0,
      'pairing a new device changed nothing in the store’s data'
    )
    const refused = await a.pc.call('sync.runNow', {}, a.owner)
    assert.equal(refused.status, 502, 'the previous PC can no longer reach the cloud')
    assert.equal(await n(cloud.pool, 'SELECT count(*) AS n FROM sales'), 1)
    // The new PC receives the store, then carries on; the cloud still holds the same business.
    const rec = ok(await b.pc.call('sync.recover', {}, b.owner))
    assert.equal(rec.recovery.recovered, true)
    assert.equal(await n(b.pc.pool, 'SELECT count(*) AS n FROM sales'), 1)
    assert.equal(
      await n(b.pc.pool, "SELECT stock_qty AS n FROM products WHERE barcode = 'RICE'"),
      97
    )
    // The new PC has the store's accounts, not its own first-run one; everyone signs in again.
    assert.deepEqual(
      (await b.pc.pool.query('SELECT username FROM users ORDER BY id')).rows.map((r) => r.username),
      ['owner', 'cashier']
    )
    assert.equal((await b.pc.call('auth.me', {}, b.owner)).status, 401)
    const storeOwner = await login(b.pc, '8642')
    b.owner = storeOwner
    await syncNow(b.pc, b.owner)
    assert.deepEqual(
      {
        sales: await n(cloud.pool, 'SELECT count(*) AS n FROM sales'),
        stock: await n(cloud.pool, "SELECT stock_qty AS n FROM products WHERE barcode = 'RICE'")
      },
      { sales: 1, stock: 97 }
    )
  } finally {
    await a.pc.close()
    if (b) {
      await b.pc.close()
      await b.db.dispose()
    }
    await cloud.close()
    await a.db.dispose()
    await cloudDb.dispose()
  }
})
