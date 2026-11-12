'use strict'
// The production rollout (D-106): the shop already runs an older HeroMarket with real business
// history. The new installer updates it in place (the database is migrated), then the owner pairs
// it with its cloud with a one-time code. Proven here on stores made by the released code itself
// (1.4.0, where the shop started, and 1.5.2, the last release): every original record keeps every
// value and its number; pairing sends the store to the empty cloud and never the other way; the
// cloud then holds exactly the same records; the store keeps its identity; nothing is doubled.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { requireDb, freshDatabase, startService } = require('./helpers')
const { copyDifferences, records } = require('./cloudHelpers')
const { loadOldStore } = require('./oldStore')
const { InProcessTransport } = require('../../src/server/sync/transport')
const { SyncAgent } = require('../../src/server/sync/agent')
const { executeRemote } = require('../../src/server/sync/remoteOps')
const { newPairingCode } = require('../../src/server/cloud/pairing')

// Bookkeeping, not business records: the change queue, the sessions, the link's own state (its
// store id is checked on its own), and the catalogue's change counter.
const BOOKKEEPING = new Set([
  'sync_outbox',
  'sync_row_versions',
  'sessions',
  'sync_state',
  'catalog_state'
])

/**
 * The intended changes, each named (anything else fails):
 *  - a password hash renewed at sign-in with stronger parameters (D-105) – the owner then signs in
 *    with the same password;
 *  - from 1.4.0, a product's purchase price becomes its latest purchase's price instead of the
 *    moving average (D-087, migration 0026, approved by the owner) – checked against the purchase.
 */
async function intended(pool, change, version) {
  const [where, field] = change.split(':')[0].split('.')
  const [table, key] = where.split('/')
  if (table === 'users' && field === 'password_scrypt') return true
  if (table === 'products' && field === 'cost_price' && version === '1.4.0') {
    const latest = await pool.query(
      `SELECT pi.unit_cost / COALESCE(NULLIF(pi.unit_factor, 0), 1) AS c FROM supplier_purchase_items pi
         JOIN supplier_purchases p ON p.id = pi.purchase_id
        WHERE pi.product_barcode = $1 ORDER BY p.timestamp DESC, pi.id DESC LIMIT 1`,
      [key]
    )
    const now = await pool.query('SELECT cost_price FROM products WHERE barcode = $1', [key])
    return Number(now.rows[0].cost_price) === Number(latest.rows[0].c)
  }
  return false
}
async function unintended(pool, store) {
  const out = []
  for (const c of await lostOrChanged(pool, store))
    if (!(await intended(pool, c, store.version))) out.push(c)
  return out
}

async function primaryKeys(pool) {
  const { rows } = await pool.query(
    `SELECT tc.table_name, array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position) AS cols
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
      GROUP BY tc.table_name`
  )
  return Object.fromEntries(rows.map((r) => [r.table_name, r.cols]))
}

/** Every original row, by its key, with every original value: what changed (empty when none). */
async function lostOrChanged(pool, store) {
  const keys = await primaryKeys(pool)
  const out = []
  for (const [t, rows] of Object.entries(store.tables)) {
    if (BOOKKEEPING.has(t)) continue
    const cols = keys[t]
    assert.ok(cols, `${t} has a primary key`)
    const now = new Map(
      (await pool.query(`SELECT to_jsonb(x) AS r FROM "${t}" x`)).rows.map((x) => [
        cols.map((c) => String(x.r[c])).join('|'),
        x.r
      ])
    )
    for (const old of rows) {
      const k = cols.map((c) => String(old[c])).join('|')
      const cur = now.get(k)
      if (!cur) {
        out.push(`${t}/${k}: missing`)
        continue
      }
      for (const [c, v] of Object.entries(old))
        if (JSON.stringify(cur[c]) !== JSON.stringify(v))
          out.push(`${t}/${k}.${c}: ${JSON.stringify(v)} → ${JSON.stringify(cur[c])}`)
    }
  }
  return out
}

/** The figures the owner looks at, from the database. */
async function figures(pool) {
  const one = async (sql) => (await pool.query(sql)).rows[0]
  return one(`SELECT
    (SELECT store_id FROM sync_state) AS store,
    (SELECT count(*) FROM sales)::int AS sales,
    (SELECT string_agg(id::text, ',' ORDER BY id) FROM sales) AS invoice_numbers,
    (SELECT sum(total_amount)::text FROM sales) AS sales_total,
    (SELECT count(*) FROM sale_items)::int AS sale_items,
    (SELECT count(*) FROM sale_returns)::int AS returns,
    (SELECT string_agg(id || ':' || status, ',' ORDER BY id) FROM shifts) AS shifts,
    (SELECT string_agg(id || ':' || debt_balance, ',' ORDER BY id) FROM clients) AS customer_balances,
    (SELECT string_agg(id || ':' || debt_balance, ',' ORDER BY id) FROM suppliers) AS supplier_balances,
    (SELECT string_agg(id || ':' || total_amount || '/' || COALESCE(remaining, 0), ',' ORDER BY id) FROM supplier_purchases) AS purchases,
    (SELECT string_agg(barcode || ':' || stock_qty, ',' ORDER BY barcode) FROM products) AS stock,
    (SELECT sum(amount)::text FROM expenses) AS expenses,
    (SELECT count(*) FROM stock_movements)::int AS movements`)
}

for (const fixture of ['store-1.4.0.json.gz', 'store-1.5.2.json.gz']) {
  test(`existing installation (${fixture.slice(6, 11)}): update in place, pair, first sync – every record kept, the cloud identical`, async (t) => {
    if (!requireDb(t)) return
    const shopDb = await freshDatabase()
    const cloudDb = await freshDatabase()
    let shop, cloud, agent
    try {
      // 1. The shop PC as the older version left it.
      const store = await loadOldStore(shopDb.url, fixture)
      const storeId = store.tables.sync_state[0].store_id
      assert.ok(store.tables.sales.length >= 40 && store.tables.shifts.length >= 10)

      // 2. The new installer: the database is migrated in place (the same step the installer runs
      //    after its verified copy); the service then starts on it.
      cloud = await startService(cloudDb.url, { role: 'cloud', linkGraceMs: 1500 })
      shop = await startService(shopDb.url, {
        pairRequest: async (body) => {
          const res = await cloud.app.inject({
            method: 'POST',
            url: '/api/link.pair',
            payload: body
          })
          return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }
        },
        syncTransport: (st) =>
          new InProcessTransport({ app: cloud.app, storeId: st.store_id, token: st.device_token })
      })
      assert.deepEqual(await unintended(shop.pool, store), [], 'every original record, as it was')
      const before = await figures(shop.pool)
      assert.equal(before.store, storeId, 'the store keeps its identity')

      // 3. The owner signs in on the shop PC with their usual password and pairs with the code made
      //    on the server.
      const login = await shop.call('auth.login', { username: 'owner', password: 'Old-Store-2026' })
      assert.equal(login.status, 200, JSON.stringify(login.body))
      const owner = login.body.token
      const { code } = await newPairingCode(cloud.pool, { name: '' })
      const paired = await shop.call('sync.pair', { cloudUrl: 'https://cloud.test', code }, owner)
      assert.equal(paired.status, 200, JSON.stringify(paired.body))
      assert.equal(paired.body.recoveryPending, false, 'the shop is the store: nothing to receive')

      // 4. The first synchronisation (the background service does this by itself).
      agent = new SyncAgent({
        pool: shop.pool,
        transport: async () => {
          const st = (await shop.pool.query('SELECT * FROM sync_state')).rows[0]
          return new InProcessTransport({
            app: cloud.app,
            storeId: st.store_id,
            token: st.device_token
          })
        },
        execute: (op) => executeRemote(shop.app, op)
      })
      let r
      for (let i = 0; i < 4; i++) {
        r = await agent.runOnce()
        if (r.check?.ok) break
      }
      assert.equal(r.check?.ok, true, JSON.stringify(r.check))

      // 5. The shop is untouched by pairing; the cloud holds exactly the same records.
      assert.deepEqual(await figures(shop.pool), before, 'pairing never overwrites the shop')
      assert.deepEqual(await unintended(shop.pool, store), [])
      assert.deepEqual(await copyDifferences({ shop, cloud }), [])
      const cloudFigures = await figures(cloud.pool)
      assert.deepEqual(
        { ...cloudFigures, store: before.store },
        before,
        'the cloud: the same figures'
      )
      assert.deepEqual(await records(cloud.pool), await records(shop.pool))

      // 6. The owner on the website sees the same store.
      const web = await cloud.call('auth.login', { username: 'owner', password: 'Old-Store-2026' })
      assert.equal(web.status, 200, JSON.stringify(web.body))
      const page = (svc, token) => svc.call('sales.page', {}, token)
      const [a, b] = [await page(shop, owner), await page(cloud, web.body.token)]
      assert.equal(a.status, 200)
      assert.deepEqual(b.body, a.body, 'the invoice list reads the same from the website')

      // 7. Synchronising again changes nothing; nothing was doubled.
      const again = await agent.runOnce()
      assert.equal(again.check?.ok, true)
      assert.deepEqual(await figures(shop.pool), before)
      assert.deepEqual(await copyDifferences({ shop, cloud }), [])
    } finally {
      agent?.stop()
      await shop?.close()
      await cloud?.close()
      await shopDb.dispose()
      await cloudDb.dispose()
    }
  })
}
