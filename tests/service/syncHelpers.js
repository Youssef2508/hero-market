'use strict'
// Harness for the synchronisation proof suite (stage 4 phase 4): a store PC (service + database)
// and a local test cloud (its own database), connected through a transport that can fail on
// purpose. Nothing here reaches the internet.
const crypto = require('crypto')
const { freshDatabase, startService, createUser, login, seedProducts } = require('./helpers')
const { createCloudService, registerStore, createCommand } = require('../../src/server/cloud/app')
const { InProcessTransport, TransportError } = require('../../src/server/sync/transport')
const { SyncAgent } = require('../../src/server/sync/agent')

/**
 * Wraps the real transport. Each switch affects push batches only (commands and checks pass):
 *   offline      – nothing reaches the cloud;
 *   loseResponse – the cloud commits, the answer is lost (the PC must re-send);
 *   duplicate    – every batch is delivered twice;
 *   hold         – batches are kept and delivered later by deliverHeld() (delay / reorder).
 * `offlineAll` fails every call, including commands and checks.
 * `afterPush` runs once right after the cloud committed a batch (e.g. kill the PC's connections).
 */
class FaultyTransport {
  constructor(inner) {
    this.inner = inner
    this.offline = false
    this.offlineAll = false
    this.loseResponse = 0 // number of next batches whose answer is lost
    this.duplicate = false
    this.hold = false
    this.held = []
    this.pushes = 0
    this.afterPush = null
  }
  guard() {
    if (this.offlineAll) throw new TransportError('offline (test)')
  }
  async newEpoch() {
    this.guard()
    return this.inner.newEpoch()
  }
  async pullCommands(limit) {
    this.guard()
    return this.inner.pullCommands(limit)
  }
  async checksums() {
    this.guard()
    return this.inner.checksums()
  }
  async push(batch) {
    this.guard()
    this.pushes += 1
    if (this.offline) throw new TransportError('offline (test)')
    if (this.hold) {
      this.held.push(JSON.parse(JSON.stringify(batch)))
      throw new TransportError('delayed (test)')
    }
    if (this.loseResponse > 0) {
      this.loseResponse -= 1
      await this.inner.push(batch)
      throw new TransportError('answer lost after the cloud committed (test)')
    }
    const r = await this.inner.push(batch)
    if (this.duplicate) await this.inner.push(batch)
    if (this.afterPush) {
      const f = this.afterPush
      this.afterPush = null
      await f()
    }
    return r
  }
  /** Deliver held batches straight to the cloud, newest first by default (out of order). */
  async deliverHeld({ newestFirst = true } = {}) {
    const list = newestFirst ? [...this.held].reverse() : [...this.held]
    this.held = []
    for (const b of list) await this.inner.push(b)
    return list.length
  }
}

const ok = (r) => {
  if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}

/** A store PC with an owner, a cashier, products, a customer, a supplier and an open shift. */
async function makeSite({ cloudHooks } = {}) {
  const pcDb = await freshDatabase()
  const cloudDb = await freshDatabase()
  const pc = await startService(pcDb.url)
  const cloud = await createCloudService({
    databaseUrl: cloudDb.url,
    logger: false,
    hooks: cloudHooks
  })
  await cloud.prepare()
  await cloud.app.ready()

  await createUser(pc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(pc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  await seedProducts(
    pc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit, category, reorder_limit) VALUES
     ('CAN', 'كانز', 8, 10, 9, 1, 'علبة', 'مشروبات', 5),
     ('RICE', 'أرز', 20, 25, 24, 100, 'كيس', 'بقالة', 10),
     ('SUGAR', 'سكر', 25, 30, 29, 50, 'كيس', 'بقالة', 10)`
  )
  const owner = await login(pc, '8642')
  const cashier = await login(pc, '5173')
  const supplier = ok(await pc.call('suppliers.create', { name: 'مورد المشروبات' }, owner))
  const shift = ok(await pc.call('shifts.open', { startingCash: 500 }, cashier))
  const ownerShift = ok(await pc.call('shifts.open', { startingCash: 0 }, owner))

  const storeId = (await pc.pool.query('SELECT store_id FROM sync_state')).rows[0].store_id
  const { token } = await registerStore(cloud.pool, { storeId, name: 'هيرو ماركت' })
  const transport = new FaultyTransport(new InProcessTransport({ app: cloud.app, storeId, token }))
  const agent = new SyncAgent({ pool: pc.pool, transport, batchSize: 50 })

  const site = {
    pc,
    pcUrl: pcDb.url,
    cloud,
    owner,
    cashier,
    shift,
    ownerShift,
    supplierId: supplier.id,
    storeId,
    token,
    transport,
    agent,
    newAgent: (opts = {}) => new SyncAgent({ pool: pc.pool, transport, batchSize: 50, ...opts }),
    command: (type, payload, id) => createCommand(cloud.pool, storeId, { id, type, payload }),
    sell: (items, paymentType = 'نقدي', extra = {}) =>
      pc.call(
        'pos.checkout',
        {
          clientRef: crypto.randomUUID(),
          shiftId: shift.id,
          paymentType,
          items,
          ...extra
        },
        cashier
      ),
    async close() {
      await pc.close()
      await cloud.app.close()
      await pcDb.dispose()
      await cloudDb.dispose()
    }
  }
  return site
}

/** Every synchronised row as the PC would send it, per table: Map(pk → canonical JSON text). */
async function pcRows(pool) {
  const tables = (await pool.query('SELECT table_name, key_column FROM sync_tables')).rows
  const out = {}
  for (const t of tables) {
    const { rows } = await pool.query(
      `SELECT to_jsonb(x)->>$2 AS pk, hm_sync_row($1, to_jsonb(x))::text AS r FROM "${t.table_name}" x`,
      [t.table_name, t.key_column]
    )
    out[t.table_name] = new Map(rows.map((r) => [r.pk, r.r]))
  }
  return out
}

/** Live rows the cloud holds for the store, per table. */
async function cloudRows(pool, storeId) {
  const { rows } = await pool.query(
    'SELECT table_name, pk, row_data::text AS r FROM cloud_rows WHERE store_id = $1 AND NOT deleted',
    [storeId]
  )
  const out = {}
  for (const r of rows) (out[r.table_name] ||= new Map()).set(r.pk, r.r)
  return out
}

/**
 * Convergence oracle: the cloud holds exactly the PC's rows – same tables, same keys, identical
 * content – and nothing else. Returns a list of differences (empty when converged).
 */
async function differences(site) {
  const a = await pcRows(site.pc.pool)
  const b = await cloudRows(site.cloud.pool, site.storeId)
  const diffs = []
  for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const pa = a[t] || new Map()
    const pb = b[t] || new Map()
    for (const [k, v] of pa) {
      if (!pb.has(k)) diffs.push(`${t}/${k}: missing in cloud`)
      else if (pb.get(k) !== v) diffs.push(`${t}/${k}: content differs`)
    }
    for (const k of pb.keys()) if (!pa.has(k)) diffs.push(`${t}/${k}: only in cloud`)
  }
  return diffs
}

/** Business figures that must match a fault-free replay of the same operations. */
async function figures(pool) {
  const q = async (sql) => (await pool.query(sql)).rows
  return {
    products: await q(
      'SELECT barcode, stock_qty::text, cost_price::text, retail_price::text, name FROM products ORDER BY barcode'
    ),
    movements: await q(
      'SELECT product_barcode, kind, qty::text, count(*)::int AS n FROM stock_movements GROUP BY 1, 2, 3 ORDER BY 1, 2, 3'
    ),
    sales: await q(
      'SELECT payment_type, count(*)::int AS n, sum(total_amount)::text AS total FROM sales GROUP BY 1 ORDER BY 1'
    ),
    clients: await q('SELECT name, debt_balance::text FROM clients ORDER BY name'),
    suppliers: await q('SELECT name, debt_balance::text FROM suppliers ORDER BY name'),
    purchases: await q(
      'SELECT invoice_ref, total_amount::text, paid_amount::text, remaining::text FROM supplier_purchases ORDER BY invoice_ref'
    ),
    drawer: await q(
      'SELECT type, count(*)::int AS n, sum(amount)::text AS total FROM safe_ledger GROUP BY 1 ORDER BY 1'
    ),
    commands: await q('SELECT command_id::text, status FROM applied_commands ORDER BY 1')
  }
}

/** Run agent cycles until the cloud matches the PC (or give up). */
async function syncUntilConverged(site, agent = site.agent, maxCycles = 6) {
  let last
  for (let i = 0; i < maxCycles; i++) {
    last = await agent.runOnce()
    if (last.check && last.check.ok) return last
  }
  throw new Error(`not converged: ${JSON.stringify(last?.check)}`)
}

module.exports = {
  FaultyTransport,
  makeSite,
  differences,
  figures,
  pcRows,
  cloudRows,
  syncUntilConverged,
  ok
}
