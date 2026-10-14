import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { isToolSafePath, runnablePgsqlRoot, pgsqlStamp, copyTree } from '../../src/main/pgPaths.js'

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name))

test('tool-safe paths: ASCII only (Arabic user names are not)', () => {
  assert.ok(isToolSafePath('C:\\Program Files\\HeroMarket POS\\resources\\pgsql'))
  assert.ok(!isToolSafePath('C:\\Users\\محمد\\AppData\\Local\\Programs\\HeroMarket POS'))
  assert.ok(!isToolSafePath('C:\\Users\\José\\AppData'))
})

test('non-ASCII install: the tree is copied once to the ASCII cache; an interrupted copy is redone', () => {
  const base = tmp('hm-pg-')
  const src = path.join(base, 'محمد user', 'pgsql')
  fs.mkdirSync(path.join(src, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(src, 'bin', 'pg_ctl.exe'), 'x')
  const cacheRoot = path.join(base, 'cache')
  try {
    assert.equal(
      runnablePgsqlRoot(path.join(base, 'ascii'), { cacheRoot, stamp: '1' }),
      path.join(base, 'ascii')
    )
    const out = runnablePgsqlRoot(src, { cacheRoot, stamp: '1.3.0' })
    assert.ok(isToolSafePath(out))
    assert.equal(fs.readFileSync(path.join(out, 'bin', 'pg_ctl.exe'), 'utf8'), 'x')
    fs.writeFileSync(path.join(out, 'bin', 'pg_ctl.exe'), 'kept') // not copied again while complete
    assert.equal(runnablePgsqlRoot(src, { cacheRoot, stamp: '1.3.0' }), out)
    assert.equal(fs.readFileSync(path.join(out, 'bin', 'pg_ctl.exe'), 'utf8'), 'kept')
    fs.rmSync(path.join(out, '.complete')) // interrupted copy → redone
    runnablePgsqlRoot(src, { cacheRoot, stamp: '1.3.0' })
    assert.equal(fs.readFileSync(path.join(out, 'bin', 'pg_ctl.exe'), 'utf8'), 'x')
    assert.throws(() => runnablePgsqlRoot(src, { cacheRoot: path.join(base, 'كاش'), stamp: '1' }))
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('the copy is keyed by the server binary: new binaries under the same app version get a new copy', () => {
  const base = tmp('hm-pg-')
  const src = path.join(base, 'محمد user', 'pgsql')
  fs.mkdirSync(path.join(src, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(src, 'bin', 'postgres.exe'), 'postgres 17.6')
  const cacheRoot = path.join(base, 'cache')
  try {
    const first = runnablePgsqlRoot(src, { cacheRoot, stamp: pgsqlStamp(src, '1.3.0') })
    assert.equal(pgsqlStamp(src, '1.3.0'), pgsqlStamp(src, '1.3.0'))
    fs.writeFileSync(path.join(src, 'bin', 'postgres.exe'), 'postgres 17.10')
    const second = runnablePgsqlRoot(src, { cacheRoot, stamp: pgsqlStamp(src, '1.3.0') })
    assert.notEqual(second, first)
    assert.equal(
      fs.readFileSync(path.join(second, 'bin', 'postgres.exe'), 'utf8'),
      'postgres 17.10'
    )
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('Windows: the real initdb fails from an Arabic path and works from the ASCII copy (K-34)', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows ANSI code-page behaviour; other platforms pass paths as UTF-8')
    return
  }
  const native = path.join(
    path.dirname(createRequire(import.meta.url).resolve('@embedded-postgres/windows-x64')),
    '..',
    'native'
  )
  const base = tmp('hm-pgreal-')
  const src = path.join(base, 'محمد', 'pgsql')
  try {
    copyTree(native, src) // not fs.cpSync: Node 22 cannot copy into a non-ASCII path on Windows
    const pw = path.join(base, 'pw')
    fs.writeFileSync(pw, 'secret')
    const init = (root, dir) =>
      spawnSync(
        path.join(root, 'bin', 'initdb.exe'),
        ['-D', dir, '-U', 't', `--pwfile=${pw}`, '-E', 'UTF8', '--locale=C'],
        {
          encoding: 'utf8',
          windowsHide: true
        }
      )
    const broken = init(src, path.join(base, 'd1'))
    assert.notEqual(broken.status, 0, 'reproduces the defect from the non-ASCII path')
    const root = runnablePgsqlRoot(src, { cacheRoot: path.join(base, 'cache'), stamp: 'test' })
    const fixed = init(root, path.join(base, 'd2'))
    assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
    assert.ok(fs.existsSync(path.join(base, 'd2', 'PG_VERSION')))
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
