/* eslint-disable no-console */
// Import a legacy SQLite database into PostgreSQL and verify parity.
//
//   node scripts/import-sqlite.js --sqlite <file.db> --database-url <postgres://…> [--dry-run]
//        [--backup-dir <dir>] [--report <report.json>]
//
// The database URL can also come from HEROMARKET_DATABASE_URL. The target is migrated first.
// Exit code 0 only when parity verification passes. See .docs/DATABASE_MIGRATION.md.
'use strict'
const fs = require('fs')
const path = require('path')
const { createPool } = require('../src/server/db/pool')
const { migrate } = require('../src/server/db/migrate')
const { importLegacy } = require('../src/server/db/legacy-import')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

async function main() {
  const sqlite = arg('sqlite')
  const url = arg('database-url', process.env.HEROMARKET_DATABASE_URL)
  if (!sqlite || !url) {
    console.error(
      'usage: node scripts/import-sqlite.js --sqlite <file.db> --database-url <url> [--dry-run] [--backup-dir dir] [--report file]'
    )
    process.exit(2)
  }
  const backupDir = arg('backup-dir', path.join(__dirname, '..', '.migration-backups'))
  const pool = createPool(url, { max: 2 })
  try {
    await migrate(pool, { logger: console })
    const report = await importLegacy(pool, sqlite, {
      backupDir,
      dryRun: process.argv.includes('--dry-run'),
      logger: console
    })
    const out = arg('report')
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2))
    console.log(`\nSource:   ${report.sourcePath}`)
    console.log(`SHA-256:  ${report.sourceSha256}`)
    console.log(`Mode:     ${report.mode}`)
    if (report.backups.length) console.log(`Backup:   ${report.backups.join(', ')}`)
    console.log('\nTable                       source  target  match')
    for (const [t, e] of Object.entries(report.parity.tables)) {
      console.log(
        `${t.padEnd(27)} ${String(e.sourceRows).padStart(6)}  ${String(e.targetRows).padStart(6)}  ${e.match ? 'yes' : 'NO'}`
      )
      for (const m of e.mismatches) console.log('   mismatch', JSON.stringify(m))
      for (const p of e.problems) console.log('   problem ', p)
    }
    const fkBad = Object.entries(report.foreignKeyViolations || {}).filter(([, n]) => n > 0)
    console.log(`\nForeign-key violations: ${fkBad.length ? JSON.stringify(fkBad) : 'none'}`)
    console.log(`Parity: ${report.parity.ok ? 'PASSED' : 'FAILED'}`)
    process.exitCode = report.parity.ok && !fkBad.length ? 0 : 1
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error('[import] FAILED:', e.message)
  process.exit(1)
})
