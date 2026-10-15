/* eslint-disable no-console */
// Runs every SQL-level simulation suite in its own process and fails the run if any
// suite exits non-zero, prints a failure marker, or never prints its success banner.
//
//   node tests/run-all.js          use TEST_SOURCE_DB / the installed DB when available
//   node tests/run-all.js --fresh  always bootstrap a fresh database (what CI does)
const { spawnSync } = require('child_process')
const path = require('path')

const SUITES = [
  ['simulate_flows.js', 'ALL INTEGRATION TEST SIMULATIONS PASSED SUCCESSFULLY'],
  ['simulate_all_28_flows.js', 'ALL 28 INTEGRATION FLOWS TESTED AND VERIFIED SUCCESSFULLY'],
  ['simulate_edge_cases.js', 'ALL EDGE CASES SIMULATED AND VERIFIED SUCCESSFULLY'],
  ['simulate_advanced_edge_cases.js', 'ALL ADVANCED EDGE CASES TESTED AND VERIFIED SUCCESSFULLY']
]

const env = { ...process.env }
if (process.argv.includes('--fresh')) env.TEST_FRESH_DB = '1'

let failed = 0
for (const [file, banner] of SUITES) {
  const started = Date.now()
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], { env, encoding: 'utf8' })
  const out = `${res.stdout || ''}\n${res.stderr || ''}`
  const problems = []
  if (res.status !== 0) problems.push(`exit code ${res.status}`)
  if (out.includes('❌')) problems.push('failure marker (❌) printed')
  if (/Error: FAILED/.test(out)) problems.push('FAILED assertion printed')
  if (!out.includes(banner)) problems.push('success banner missing')
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  if (problems.length) {
    failed++
    console.log(`✗ ${file} (${secs}s): ${problems.join('; ')}`)
    console.log(out.split('\n').slice(-40).join('\n'))
  } else {
    console.log(`✓ ${file} (${secs}s)`)
  }
}

console.log(
  failed ? `\n${failed} of ${SUITES.length} suites failed` : `\nAll ${SUITES.length} suites passed`
)
process.exit(failed ? 1 : 0)
