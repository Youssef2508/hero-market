import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  needsSnapshot,
  pendingVersions,
  snapshotDataDir,
  verifySnapshot,
  pruneSnapshots
} from '../../src/main/upgradeSnapshot.js'
import { copyTree } from '../../src/main/pgPaths.js'

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), n))

test('a snapshot is needed only for an existing database with pending migrations', () => {
  const all = ['0001', '0002', '0003']
  assert.equal(needsSnapshot([], all), false, 'new database: nothing to protect')
  assert.equal(needsSnapshot(all, all), false, 'up to date')
  assert.equal(needsSnapshot(['0001'], all), true)
  assert.deepEqual(pendingVersions(['0001'], all), ['0002', '0003'])
})

test('snapshot copies every file and empty folder, verifies hashes, detects tampering, keeps 3', () => {
  const base = tmp('hm-snap-')
  const data = path.join(base, 'pgdata')
  try {
    fs.mkdirSync(path.join(data, 'base', '1'), { recursive: true })
    fs.mkdirSync(path.join(data, 'pg_tblspc'), { recursive: true }) // empty but required
    fs.writeFileSync(path.join(data, 'PG_VERSION'), '17\n')
    fs.writeFileSync(path.join(data, 'base', '1', '1259'), Buffer.alloc(8192, 7))
    fs.writeFileSync(path.join(data, 'postmaster.pid'), 'stale') // never copied
    const backups = path.join(base, 'backups')
    const snap = snapshotDataDir(data, backups, 'db-0004-to-0006', new Date('2026-10-15T10:00:00Z'))
    assert.ok(fs.existsSync(path.join(snap, 'pgdata', 'pg_tblspc')))
    assert.ok(!fs.existsSync(path.join(snap, 'pgdata', 'postmaster.pid')))
    assert.deepEqual(verifySnapshot(snap), { ok: true, files: 2 })
    fs.writeFileSync(path.join(snap, 'pgdata', 'base', '1', '1259'), 'changed')
    assert.equal(verifySnapshot(snap).ok, false)
    for (const h of [11, 12, 13])
      snapshotDataDir(data, backups, 'x', new Date(`2026-10-15T${h}:00:00Z`))
    const removed = pruneSnapshots(backups)
    assert.equal(removed.length, 1)
    assert.equal(fs.readdirSync(backups).length, 3)
    assert.throws(() => snapshotDataDir(path.join(base, 'nope'), backups, 'x'))
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

test('Windows: PostgreSQL starts on a snapshot of a real cluster and the data is there', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('uses the bundled Windows PostgreSQL binaries')
    return
  }
  const native = path.join(
    path.dirname(createRequire(import.meta.url).resolve('@embedded-postgres/windows-x64')),
    '..',
    'native'
  )
  const base = tmp('hm-snapreal-')
  const bin = (n) => path.join(base, 'pgsql', 'bin', `${n}.exe`)
  const data = path.join(base, 'pgdata')
  const run = (tool, args) => spawnSync(bin(tool), args, { encoding: 'utf8', windowsHide: true })
  // pg_ctl start leaves the server holding inherited pipes: start it with no stdio attached.
  const start = (args) =>
    spawnSync(bin('pg_ctl'), ['start', ...args], { stdio: 'ignore', windowsHide: true })
  try {
    copyTree(native, path.join(base, 'pgsql'))
    assert.equal(
      run('initdb', ['-D', data, '-U', 'hm', '--auth=trust', '-E', 'UTF8', '--locale=C']).status,
      0
    )
    const port = await freePort()
    assert.equal(
      start([
        '-D',
        data,
        '-w',
        '-o',
        `-p ${port} -c listen_addresses=127.0.0.1`,
        '-l',
        path.join(base, 'a.log')
      ]).status,
      0
    )
    const pg = createRequire(import.meta.url)('pg')
    let c = new pg.Client({ host: '127.0.0.1', port, user: 'hm', database: 'postgres' })
    await c.connect()
    await c.query("CREATE TABLE store (k text); INSERT INTO store VALUES ('sale-42')")
    await c.end()
    assert.equal(run('pg_ctl', ['stop', '-D', data, '-m', 'fast', '-w']).status, 0)
    const snap = snapshotDataDir(data, path.join(base, 'backups'), 'real')
    assert.equal(verifySnapshot(snap).ok, true)
    const port2 = await freePort()
    const copy = path.join(snap, 'pgdata')
    assert.equal(
      start([
        '-D',
        copy,
        '-w',
        '-o',
        `-p ${port2} -c listen_addresses=127.0.0.1`,
        '-l',
        path.join(base, 'b.log')
      ]).status,
      0
    )
    try {
      c = new pg.Client({ host: '127.0.0.1', port: port2, user: 'hm', database: 'postgres' })
      await c.connect()
      const { rows } = await c.query('SELECT k FROM store')
      await c.end()
      assert.deepEqual(rows, [{ k: 'sale-42' }])
    } finally {
      run('pg_ctl', ['stop', '-D', copy, '-m', 'fast', '-w'])
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
