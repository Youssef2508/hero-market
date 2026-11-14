'use strict'
// Harness for the "one business, two ways in" suite (Phase 2 milestone 1, D-101): a shop PC (the
// real service on its own disposable database) and the cloud (the same service with role 'cloud'
// on another disposable database), joined by the shop's sync agent through a transport the test
// can cut. Nothing here reaches the internet.
const { freshDatabase, startService, createUser, login, seedProducts } = require('./helpers')
const { registerStore } = require('../../src/server/cloud/app')
const { InProcessTransport, TransportError } = require('../../src/server/sync/transport')
const { SyncAgent } = require('../../src/server/sync/agent')
const { executeRemote } = require('../../src/server/sync/remoteOps')

const ok = (r, what = '') => {
  if (r.status !== 200) throw new Error(`${what} ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}

/** The real link, with switches: `down` fails every call; `loseResults` drops the next answers. */
class CuttableTransport {
  constructor(inner) {
    this.inner = inner
    this.down = false
    this.loseResults = 0
    this.duplicateOps = false
    for (const m of [
      'newEpoch',
      'push',
      'pullCommands',
      'checksums',
      'recoverRows',
      'fetch',
      'ack'
    ])
      this[m] = (...a) => {
        if (this.down) throw new TransportError('offline (test)')
        return this.inner[m](...a)
      }
  }
  /** What the cloud said about itself on its last answer (versions, architecture §14.1). */
  get peer() {
    return this.inner.peer
  }
  async wait(body) {
    if (this.down) throw new TransportError('offline (test)')
    const r = await this.inner.wait(body)
    // Every operation delivered twice in the same turn.
    return this.duplicateOps ? { ...r, ops: [...r.ops, ...r.ops] } : r
  }
  async results(body) {
    if (this.down) throw new TransportError('offline (test)')
    if (this.loseResults > 0) {
      this.loseResults -= 1
      throw new TransportError('answer lost (test)')
    }
    return this.inner.results(body)
  }
}

/**
 * A shop with an owner, a cashier (allowed in from the internet), products, a supplier, a customer
 * who owes 100, and the cashier's open shift; its cloud; and the link between them.
 */
async function makeTwin({ link = true, cloudOptions = {}, shopOptions = {} } = {}) {
  const shopDb = await freshDatabase()
  const cloudDb = await freshDatabase()
  const holder = {}
  const shop = await startService(shopDb.url, {
    syncTransport: () => holder.transport,
    ...shopOptions
  })
  const cloud = await startService(cloudDb.url, {
    role: 'cloud',
    linkGraceMs: 1500,
    forwardTimeoutMs: 3000,
    ...cloudOptions
  })

  await createUser(shop, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(shop, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await createUser(shop, { username: 'second', pin: '6205', roleKey: 'cashier' })
  // The owner lets this cashier's role in from the internet: a copy of «كاشير» plus that one key.
  await shop.pool.query(
    "INSERT INTO roles (key, name, description) VALUES (NULL, 'كاشير من الإنترنت', 'كاشير مسموح له بالدخول عبر الإنترنت')"
  )
  await shop.pool.query(
    `INSERT INTO role_permissions (role_id, permission)
     SELECT (SELECT id FROM roles WHERE name = 'كاشير من الإنترنت'), permission
       FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = 'cashier'
     UNION SELECT (SELECT id FROM roles WHERE name = 'كاشير من الإنترنت'), 'internet.access'`
  )
  await shop.pool.query(
    "UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'كاشير من الإنترنت') WHERE username = 'cashier'"
  )
  await seedProducts(
    shop,
    `INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, unit, category, reorder_limit) VALUES
     ('RICE', 'أرز', 20, 25, 100, 'كيس', 'بقالة', 10),
     ('SUGAR', 'سكر', 25, 30, 50, 'كيس', 'بقالة', 10)`
  )
  const owner = await login(shop, '8642')
  const cashier = await login(shop, '5173')
  const supplier = ok(await shop.call('suppliers.create', { name: 'مورد البقالة' }, owner))
  ok(
    await shop.call(
      'suppliers.addPurchase',
      { supplierId: supplier.id, total_amount: 400, paid_amount: 0, payment_type: 'آجل' },
      owner
    )
  )
  const shift = ok(await shop.call('shifts.open', { startingCash: 500 }, cashier))
  const credit = ok(
    await shop.call(
      'pos.checkout',
      {
        clientRef: 'setup-credit-sale-0001',
        shiftId: shift.id,
        paymentType: 'آجل',
        items: [{ barcode: 'RICE', qty: 4 }],
        client: { id: null, name: 'أم أحمد', phone: '01012345678', address: '' }
      },
      cashier
    )
  )

  const storeId = (await shop.pool.query('SELECT store_id FROM sync_state')).rows[0].store_id
  const { token } = await registerStore(cloud.pool, { storeId, name: 'هيرو ماركت' })
  const transport = new CuttableTransport(
    new InProcessTransport({ app: cloud.app, storeId, token })
  )
  holder.transport = transport
  const agent = new SyncAgent({
    pool: shop.pool,
    transport,
    batchSize: 200,
    execute: (op) => executeRemote(shop.app, op)
  })

  const twin = {
    shop,
    cloud,
    agent,
    transport,
    storeId,
    owner,
    cashier,
    shift,
    supplierId: supplier.id,
    clientId: credit.clientId,
    /** Send everything the shop has until the cloud holds the same. */
    async sync() {
      let last
      for (let i = 0; i < 6; i++) {
        last = await agent.runOnce()
        if (last.check && last.check.ok) return last
      }
      throw new Error(`not in step: ${JSON.stringify(last?.check)}`)
    },
    /** Sign in on the cloud, as a browser would (the same username and password). */
    signIn: (code) => login(cloud, code),
    async close() {
      agent.stopLink()
      agent.stop()
      await agent.unlisten().catch(() => {})
      // A held link request ends with its short timeout before the services close.
      await new Promise((r) => setTimeout(r, 450))
      await shop.close()
      await cloud.close()
      await shopDb.dispose()
      await cloudDb.dispose()
    }
  }
  if (link) {
    await twin.sync()
    agent.startLink({ timeoutMs: 300 })
    // The cloud hears from the shop: reachable from now on.
    for (let i = 0; i < 50 && !cloud.app.cloudLink.reachable(); i++)
      await new Promise((r) => setTimeout(r, 20))
  }
  return twin
}

const TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/
/** A value with every date-and-time replaced, so two runs at different moments compare equal. */
function timeless(v) {
  if (typeof v === 'string') return TIME.test(v) ? '<time>' : v
  if (Array.isArray(v)) return v.map(timeless)
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, timeless(x)]))
  return v
}

/**
 * Every business record of a database, table by table in key order, without the moments they were
 * made and without the bookkeeping of the link itself. Two shops that did the same work hold the
 * same records.
 */
async function records(pool) {
  const tables = (
    await pool.query(
      "SELECT table_name, key_column FROM sync_tables WHERE table_name NOT IN ('remote_operations', 'applied_commands') ORDER BY 1"
    )
  ).rows
  const out = {}
  for (const t of tables) {
    const { rows } = await pool.query(
      `SELECT hm_sync_row($1, to_jsonb(x)) AS r FROM "${t.table_name}" x ORDER BY hm_sync_key($2, to_jsonb(x)) COLLATE "C"`,
      [t.table_name, t.key_column]
    )
    out[t.table_name] = rows.map((x) => {
      const r = timeless(x.r)
      // The audit line is the same; only its note that the operation came remotely differs.
      if (t.table_name === 'system_logs' && r.details) {
        try {
          const d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details
          delete d.remoteOperation
          r.details = Object.keys(d).length ? JSON.stringify(timeless(d)) : null
        } catch {
          /* free text */
        }
      }
      // Each user's password hash has its own random salt.
      if (t.table_name === 'users') delete r.password_scrypt
      return r
    })
  }
  return out
}

/** The same records, exactly as stored (times included): the cloud's copy against its shop. */
async function exactRecords(pool) {
  const tables = (await pool.query('SELECT table_name, key_column FROM sync_tables ORDER BY 1'))
    .rows
  const out = {}
  for (const t of tables) {
    const { rows } = await pool.query(
      `SELECT hm_sync_key($2, to_jsonb(x)) AS k, hm_sync_row($1, to_jsonb(x))::text AS r FROM "${t.table_name}" x`,
      [t.table_name, t.key_column]
    )
    out[t.table_name] = new Map(rows.map((x) => [x.k, x.r]))
  }
  return out
}

/** Differences between the cloud's copy and the shop, row for row (empty when identical). */
async function copyDifferences(twin) {
  const a = await exactRecords(twin.shop.pool)
  const b = await exactRecords(twin.cloud.pool)
  const diffs = []
  for (const t of Object.keys(a)) {
    for (const [k, v] of a[t]) {
      if (!b[t].has(k)) diffs.push(`${t}/${k}: missing in the cloud`)
      else if (b[t].get(k) !== v) diffs.push(`${t}/${k}: differs`)
    }
    for (const k of b[t].keys()) if (!a[t].has(k)) diffs.push(`${t}/${k}: only in the cloud`)
  }
  return diffs
}

/** Wait until the cloud's copy equals the shop (the agent pushes on its own in these tests). */
async function inStep(twin, ms = 4000) {
  const until = Date.now() + ms
  let diffs
  do {
    await twin.agent.runOnce({ check: false }).catch(() => {})
    diffs = await copyDifferences(twin)
    if (!diffs.length) return []
    await new Promise((r) => setTimeout(r, 50))
  } while (Date.now() < until)
  return diffs
}

module.exports = {
  makeTwin,
  CuttableTransport,
  records,
  copyDifferences,
  inStep,
  timeless,
  ok
}
