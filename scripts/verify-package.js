// Checks a packaged app.asar: everything the app needs at run time is inside, and nothing that
// must never ship (local databases, credentials, backups, tests, development material) is.
//
//   node scripts/verify-package.js dist/win-unpacked/resources/app.asar
'use strict'
const { listPackage } = require('@electron/asar')

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/verify-package.js <app.asar>')
  process.exit(2)
}
const entries = listPackage(file, { isPack: false }).map((p) => p.replace(/\\/g, '/'))
const has = (p) => entries.includes(p)

const REQUIRED = [
  '/package.json',
  '/out/main/index.js',
  '/out/preload/index.js',
  '/out/renderer/index.html',
  '/src/server/app.js',
  '/src/server/cli.js',
  '/src/server/db/migrations/0001_legacy_schema.sql',
  '/src/server/db/legacy-import.js',
  '/src/shared/receipt.mjs',
  '/node_modules/pg/package.json',
  '/node_modules/fastify/package.json'
]
const FORBIDDEN = [
  [/^\/\.pgdata(\/|$)/, 'development PostgreSQL data or credentials'],
  [/^\/\.migration-backups(\/|$)/, 'migration backups (real data)'],
  [/\.(db|db-wal|db-shm|db-journal)$/, 'database file'],
  [/(^|\/)\.env(\.|$)/, 'environment file'],
  [/^\/(tests|scripts|\.docs|docs|scratch|pdf|\.github)\//, 'development material'],
  [/^\/node_modules\/(embedded-postgres|@embedded-postgres)\//, 'development PostgreSQL package']
]

const problems = []
for (const p of REQUIRED) if (!has(p)) problems.push(`missing: ${p}`)
for (const e of entries)
  for (const [re, what] of FORBIDDEN) if (re.test(e)) problems.push(`must not ship (${what}): ${e}`)

console.log(`${file}: ${entries.length} entries`)
if (problems.length) {
  for (const p of problems.slice(0, 50)) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log('  ✓ required files present, no local data or development material')
