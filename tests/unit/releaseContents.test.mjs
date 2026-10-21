// Test data never reaches a release or a real-data migration (owner feedback, DATA-02). QA rows live
// only in disposable development databases (.pgdata); these checks keep that true for the files a
// build packages and for the migrations that run on the shop's database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const migrations = path.join(root, 'src', 'server', 'db', 'migrations')
// Tables holding the shop's own records: a migration may only fill them from existing rows.
const BUSINESS = [
  'products',
  'sales',
  'sale_items',
  'customers',
  'client_addresses',
  'suppliers',
  'users',
  'shifts',
  'expenses',
  'safe_ledger',
  'stock_movements',
  'purchase_invoices',
  'returns',
  'checks_register'
]
// What a QA run creates: QAYOG, QAUNC…, "QA زبادي", "صنف … QA".
const QA_MARK = /\bQA[A-Z0-9]{2,}\b|['"]QA\s|\sQA['"]/

test('the packaged files exclude development databases, data and test material', () => {
  const yml = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
  const excluded = [...yml.matchAll(/'!\{([^}]*)\}\/\*\*'/g)].flatMap((m) => m[1].split(','))
  for (const dir of ['.pgdata', '.migration-backups', '.docs', 'tests', 'scripts', 'scratch']) {
    assert.ok(excluded.includes(dir), `${dir} is excluded from the package`)
  }
  assert.ok(
    yml.includes(`'!**/*.{db,db-wal,db-shm,db-journal,log}'`),
    'database and log files are excluded'
  )
  assert.ok(yml.includes(`'!{.env,.env.*,`), '.env files are excluded')
})

test('migrations add no rows to the shop tables except from rows already there', () => {
  for (const f of fs.readdirSync(migrations).filter((n) => n.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(migrations, f), 'utf8').replace(/--.*$/gm, '')
    for (const m of sql.matchAll(/INSERT\s+INTO\s+(\w+)([^;]*);/gi)) {
      if (!BUSINESS.includes(m[1].toLowerCase())) continue
      assert.match(m[2], /\bSELECT\b/i, `${f}: INSERT INTO ${m[1]} must copy existing rows`)
      assert.doesNotMatch(m[2], /\bVALUES\b/i, `${f}: INSERT INTO ${m[1]} with literal rows`)
    }
  }
})

test('no QA record names appear in migrations, the service code or the shared code', () => {
  const dirs = [migrations, path.join(root, 'src', 'server'), path.join(root, 'src', 'shared')]
  const walk = (d) =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
  for (const file of dirs.flatMap(walk).filter((f) => /\.(sql|js|mjs)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(text, QA_MARK, path.relative(root, file))
  }
})
