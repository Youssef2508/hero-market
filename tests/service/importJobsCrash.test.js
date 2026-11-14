'use strict'
// Import jobs survive a crash (1.6.3, D-108): the process carrying a job out is killed outright in
// the middle – no close, no clean-up – and the next service to start finishes the job, each record
// once. Also: a job whose records were saved just before a stop is only marked, never written again.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const path = require('path')
const { spawn } = require('child_process')
const { requireDb, freshDatabase, startService, createUser, login } = require('./helpers')

const num = async (pool, sql, p) => Number(Object.values((await pool.query(sql, p)).rows[0])[0])

function products(n, prefix) {
  return Array.from({ length: n }, (_, i) => ({
    row: i + 2,
    barcode: `${prefix}${String(i).padStart(6, '0')}`,
    name: `صنف ${prefix}${i}`,
    retail_price: 7,
    stock_qty: 2,
    unit: 'قطعة'
  }))
}

async function finished(svc, token, id) {
  for (let i = 0; i < 600; i++) {
    const r = await svc.call('imports.get', { id }, token)
    if (!['queued', 'processing'].includes(r.body.status)) return r.body
    await new Promise((res) => setTimeout(res, 50))
  }
  throw new Error('not finished')
}

test('killed in the middle of a job: the next start finishes it, every record once', async (t) => {
  if (!requireDb(t)) return
  const db = await freshDatabase()
  let svc = await startService(db.url, { importJobs: false })
  try {
    await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
    const owner = await login(svc, '8642')
    const id = crypto.randomUUID()
    const rows = products(2000, 'CRASH')
    assert.equal((await svc.call('imports.start', { id, products: rows }, owner)).status, 200)

    // Another process takes the job; it is killed once it has written 1,000 rows.
    const child = spawn(
      process.execPath,
      [path.join(__dirname, '..', 'fixtures', 'import-child.js'), db.url],
      {
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    const killedAt = await new Promise((resolve, reject) => {
      let out = ''
      child.stdout.on('data', (d) => {
        out += d
        const m = out.match(/step products (\d+)\n/g)
        const last = m && Number(m[m.length - 1].match(/\d+/)[0])
        if (last >= 1000) {
          child.kill('SIGKILL')
          resolve(last)
        }
      })
      child.on('exit', (code) => reject(new Error(`child ended (${code}) before the kill: ${err}`)))
    }).catch((e) => {
      child.kill('SIGKILL')
      throw e
    })
    await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)))
    assert.ok(killedAt >= 1000)

    // Its transaction died with it: nothing kept, the job still open.
    for (let i = 0; i < 100; i++) {
      // PostgreSQL notices the dead connection and undoes its transaction.
      const open = await num(
        svc.pool,
        "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = $1",
        [0x484d494d]
      )
      if (!open) break
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.equal(
      await num(svc.pool, "SELECT count(*) FROM products WHERE name LIKE 'صنف CRASH%'"),
      0
    )
    assert.equal(
      await num(svc.pool, 'SELECT count(*) FROM import_jobs WHERE id = $1 AND status = $2', [
        id,
        'processing'
      ]),
      1
    )

    // The next start of a service finds it and finishes it.
    await svc.close()
    svc = await startService(db.url, { importPollMs: 100 })
    const done = await finished(svc, await login(svc, '8642'), id)
    assert.equal(done.status, 'completed', JSON.stringify(done))
    assert.equal(done.successfulRows, 2000)
    // Started again at least once (a loaded PC may need one more try); never written twice: below.
    assert.ok(done.attempts >= 2, `attempts ${done.attempts}`)
    assert.equal(
      await num(svc.pool, "SELECT count(*) FROM products WHERE name LIKE 'صنف CRASH%'"),
      2000
    )
    assert.equal(
      await num(
        svc.pool,
        "SELECT count(DISTINCT product_barcode) FROM stock_movements WHERE product_barcode LIKE 'CRASH%'"
      ),
      2000
    )
    assert.equal(
      await num(
        svc.pool,
        "SELECT count(*) FROM stock_movements WHERE product_barcode LIKE 'CRASH%'"
      ),
      2000
    )
    assert.equal(await num(svc.pool, 'SELECT count(*) FROM import_job_data'), 0)
  } finally {
    await svc.close()
    await db.dispose()
  }
})

test('saved just before a stop: the next runner marks it completed and writes nothing again', async (t) => {
  if (!requireDb(t)) return
  const db = await freshDatabase()
  const svc = await startService(db.url, { importJobs: false })
  try {
    await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
    const owner = await login(svc, '8642')
    const id = crypto.randomUUID()
    // The state a stop between the job's commit and the marking of its row leaves.
    await svc.pool.query(
      `INSERT INTO import_jobs (id, user_id, username, content_hash, status, stage, total_rows, attempts)
       VALUES ($1, 1, 'owner', 'x', 'processing', 'finishing', 3, 1)`,
      [id]
    )
    await svc.pool.query(
      `INSERT INTO import_job_data (job_id, rows, committed) VALUES ($1, $2, '{"products": 3}')`,
      [id, JSON.stringify({ products: products(3, 'SAVED') })]
    )
    const before = await num(svc.pool, 'SELECT count(*) FROM products')
    svc.app.importRunner.start()
    await finished(svc, owner, id)
    const done = (await svc.call('imports.get', { id }, owner)).body
    assert.equal(done.status, 'completed')
    assert.equal(done.successfulRows, 3)
    assert.equal(
      await num(svc.pool, 'SELECT count(*) FROM products'),
      before,
      'nothing written again'
    )
    assert.equal(await num(svc.pool, 'SELECT count(*) FROM import_job_data'), 0)
  } finally {
    await svc.close()
    await db.dispose()
  }
})

test('a backup restored while an import waits: the import is cancelled and never written', async (t) => {
  if (!requireDb(t)) return
  const db = await freshDatabase()
  const svc = await startService(db.url, { importJobs: false, importPollMs: 100 })
  try {
    await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
    const owner = await login(svc, '8642')
    const backup = JSON.parse(JSON.stringify((await svc.call('backup.export', {}, owner)).body))
    const id = crypto.randomUUID()
    const started = await svc.call('imports.start', { id, products: products(50, 'OLD') }, owner)
    assert.equal(started.status, 200)
    const restored = await svc.call('backup.restore', { backup, confirm: 'RESTORE' }, owner)
    assert.equal(restored.status, 200, JSON.stringify(restored.body))
    const job = (
      await svc.pool.query('SELECT status, error_code FROM import_jobs WHERE id = $1', [id])
    ).rows[0]
    assert.deepEqual(job, { status: 'cancelled', error_code: 'restored' })
    assert.equal(await num(svc.pool, 'SELECT count(*) FROM import_job_data'), 0)
    // The runner starts afterwards: nothing of the old file reaches the restored store.
    svc.app.importRunner.start()
    await svc.app.importRunner.kick()
    assert.equal(await num(svc.pool, "SELECT count(*) FROM products WHERE barcode LIKE 'OLD%'"), 0)
  } finally {
    await svc.close()
    await db.dispose()
  }
})

test('a job cancelled at the moment it is claimed stays cancelled, and later imports start', async (t) => {
  if (!requireDb(t)) return
  const db = await freshDatabase()
  const svc = await startService(db.url, { importJobs: false })
  try {
    await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
    const owner = await login(svc, '8642')
    const id = crypto.randomUUID()
    assert.equal(
      (await svc.call('imports.start', { id, products: products(5, 'RACEC') }, owner)).status,
      200
    )
    // The cancel holds the job's row while the runner looks for work: it is skipped, not revived.
    const c = await svc.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SELECT 1 FROM import_jobs WHERE id = $1 FOR UPDATE', [id])
      const runner = await svc.pool.connect()
      try {
        assert.equal(await svc.app.importRunner.claim(runner), null)
      } finally {
        runner.release()
      }
      await c.query('DELETE FROM import_job_data WHERE job_id = $1', [id])
      await c.query("UPDATE import_jobs SET status = 'cancelled' WHERE id = $1", [id])
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    svc.app.importRunner.start()
    await svc.app.importRunner.kick()
    assert.equal(
      (await svc.pool.query('SELECT status FROM import_jobs WHERE id = $1', [id])).rows[0].status,
      'cancelled'
    )
    const next = await svc.call(
      'imports.start',
      { id: crypto.randomUUID(), products: products(5, 'AFTER') },
      owner
    )
    assert.equal(next.status, 200, 'nothing left open blocks the next import')
  } finally {
    await svc.close()
    await db.dispose()
  }
})
