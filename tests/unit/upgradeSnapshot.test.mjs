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
  copyAndVerify,
  verifySnapshot,
  pruneSnapshots,
  pickRestoreCopy
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

test('snapshot copies every file and empty folder, verifies hashes, detects tampering, keeps 3', async () => {
  const base = tmp('hm-snap-')
  const data = path.join(base, 'pgdata')
  try {
    fs.mkdirSync(path.join(data, 'base', '1'), { recursive: true })
    fs.mkdirSync(path.join(data, 'pg_tblspc'), { recursive: true }) // empty but required
    fs.writeFileSync(path.join(data, 'PG_VERSION'), '17\n')
    fs.writeFileSync(path.join(data, 'base', '1', '1259'), Buffer.alloc(8192, 7))
    fs.writeFileSync(path.join(data, 'postmaster.pid'), 'stale') // never copied
    const backups = path.join(base, 'backups')
    const snap = await snapshotDataDir(
      data,
      backups,
      'db-0004-to-0006',
      new Date('2026-10-15T10:00:00Z')
    )
    assert.ok(fs.existsSync(path.join(snap, 'pgdata', 'pg_tblspc')))
    assert.ok(!fs.existsSync(path.join(snap, 'pgdata', 'postmaster.pid')))
    assert.deepEqual(verifySnapshot(snap), { ok: true, files: 2 })
    fs.writeFileSync(path.join(snap, 'pgdata', 'base', '1', '1259'), 'changed')
    assert.equal(verifySnapshot(snap).ok, false)
    for (const h of [11, 12, 13])
      await snapshotDataDir(data, backups, 'x', new Date(`2026-10-15T${h}:00:00Z`))
    const removed = pruneSnapshots(backups)
    assert.equal(removed.length, 1)
    assert.equal(fs.readdirSync(backups).length, 3)
    await assert.rejects(() => snapshotDataDir(path.join(base, 'nope'), backups, 'x'))
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('the copy of the data before an update survives later installer runs (1.5.0 Sandbox R7)', () => {
  const backups = tmp('hm-prune-')
  try {
    // The Sandbox sequence: 1.4.0 → 1.5.0 (copy of 1.4.0 data), then four more runs over 1.5.0
    // data (Case A, a failing update, Case A again, an older installer refused).
    const runs = [
      ['2026-10-22T14-10-12-630Z-app-1.5.0', '1.4.0'],
      ['2026-10-22T14-13-53-358Z-app-1.5.0', '1.5.0'],
      ['2026-10-22T14-16-56-431Z-app-1.5.1-test.1', '1.5.0'],
      ['2026-10-22T14-20-23-518Z-app-1.5.0', '1.5.0'],
      ['2026-10-22T14-23-57-360Z-app-1.4.0', '1.5.0']
    ]
    const versionOf = (n) =>
      JSON.parse(fs.readFileSync(path.join(backups, n, 'update.json'), 'utf8')).fromVersion
    for (const [name, fromVersion] of runs) {
      fs.mkdirSync(path.join(backups, name))
      fs.writeFileSync(path.join(backups, name, 'manifest.json'), '{}')
      fs.writeFileSync(path.join(backups, name, 'update.json'), JSON.stringify({ fromVersion }))
      pruneSnapshots(backups, 3, versionOf)
    }
    const left = fs.readdirSync(backups).sort()
    assert.deepEqual(left, [runs[0][0], runs[2][0], runs[3][0], runs[4][0]])
    assert.equal(versionOf(left[0]), '1.4.0', 'the only copy of the 1.4.0 data is kept')
    // Only the newest copy of each data version is kept beyond the newest three, for 3 versions.
    for (const [i, v] of ['1.1.0', '1.2.0', '1.3.0'].entries()) {
      const name = `2026-10-0${i + 1}T00-00-00-000Z-old`
      fs.mkdirSync(path.join(backups, name))
      fs.writeFileSync(path.join(backups, name, 'manifest.json'), '{}')
      fs.writeFileSync(path.join(backups, name, 'update.json'), JSON.stringify({ fromVersion: v }))
    }
    const removed = pruneSnapshots(backups, 3, versionOf)
    assert.deepEqual(removed.sort(), [
      '2026-10-01T00-00-00-000Z-old',
      '2026-10-02T00-00-00-000Z-old'
    ])
  } finally {
    fs.rmSync(backups, { recursive: true, force: true })
  }
})

test('restore picks a copy by name, by data version, or the installed version by default', () => {
  const data = { a: '1.4.0', b: '1.5.0', c: '1.4.0', d: '1.5.0' }
  const names = Object.keys(data)
  const versionOf = (n) => data[n]
  assert.equal(pickRestoreCopy(names, versionOf, undefined, '1.5.0'), 'd')
  assert.equal(
    pickRestoreCopy(names, versionOf, '1.4.0', '1.5.0'),
    'c',
    'newest copy of 1.4.0 data'
  )
  assert.equal(pickRestoreCopy(names, versionOf, 'a', '1.5.0'), 'a', 'by folder name')
  assert.equal(pickRestoreCopy(names, versionOf, '1.3.0', '1.5.0'), null)
  assert.equal(pickRestoreCopy(names, versionOf, undefined, '1.6.0'), null)
})

test('copying a store never freezes the app: the event loop keeps running during the copy', async () => {
  const base = tmp('hm-copy-')
  const data = path.join(base, 'pgdata')
  try {
    fs.mkdirSync(path.join(data, 'base', '1'), { recursive: true })
    fs.writeFileSync(path.join(data, 'PG_VERSION'), '17\n')
    // 400 files of 256 KB (100 MB): long enough that a blocking copy would stall for seconds.
    const block = Buffer.alloc(256 * 1024, 3)
    for (let i = 0; i < 400; i++)
      fs.writeFileSync(path.join(data, 'base', '1', String(16000 + i)), block)
    let longest = 0
    let last = Date.now()
    const ticker = setInterval(() => {
      const now = Date.now()
      longest = Math.max(longest, now - last)
      last = now
    }, 10)
    const started = Date.now()
    const out = await copyAndVerify(data, path.join(base, 'copy'))
    const took = Date.now() - started
    clearInterval(ticker)
    assert.equal(Object.keys(out.files).length, 401)
    assert.ok(
      longest < Math.max(500, took / 4),
      `the main process stalled for ${longest} ms during a ${took} ms copy`
    )
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
    const snap = await snapshotDataDir(data, path.join(base, 'backups'), 'real')
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
