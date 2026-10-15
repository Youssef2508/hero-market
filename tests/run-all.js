// Test entry point (see .docs/TESTING_AND_KNOWN_ISSUES.md §1).
//
//   npm test              unit + service/integration suites (service suites need PostgreSQL)
//   npm run test:unit     unit suites only (no database)
//   npm run test:service  service/integration suites only
//
// PostgreSQL comes from HEROMARKET_TEST_DATABASE_URL (CI service container, Docker) or, locally, from the
// development cluster started with `npm run pg:dev`. If neither is available the run FAILS – service
// suites are never skipped silently.
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const only = process.argv[2] // 'unit' | 'service' | undefined
const list = (dir, re) =>
  fs
    .readdirSync(path.join(__dirname, dir))
    .filter((f) => re.test(f))
    .sort()
    .map((f) => path.join(__dirname, dir, f))

const files = []
if (only !== 'service') files.push(...list('unit', /\.test\.m?js$/))
const env = { ...process.env }
if (only !== 'unit') {
  if (!env.HEROMARKET_TEST_DATABASE_URL) {
    const creds = path.join(__dirname, '..', '.pgdata', 'credentials.json')
    if (fs.existsSync(creds))
      env.HEROMARKET_TEST_DATABASE_URL = require('../scripts/pg-dev').url('postgres')
  }
  if (!env.HEROMARKET_TEST_DATABASE_URL) {
    console.error(
      'Service tests need PostgreSQL: set HEROMARKET_TEST_DATABASE_URL, or run `npm run pg:dev` in another terminal.\n' +
        'Use `npm run test:unit` to run only the database-free suites.'
    )
    process.exit(1)
  }
  files.push(...list('service', /\.test\.js$/))
}

const res = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  env,
  stdio: 'inherit'
})
process.exit(res.status ?? 1)
