// Owner's laptop, 2026-10-16 (INSTALL-01, AUDIT A-22): the database preparation failed in
// setup.log, yet the program opened the connection settings. An installed shop whose own database
// cannot open must get the store-problem screen with a retry, whatever the reason.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installedStoreProblem, failureCode } from '../../src/main/storeCheck.js'
import { startupPhaseFor } from '../../src/renderer/src/lib/startupPhase.js'

const VERSION = '1.5.0'
const prepared = { mode: 'local', local: { service: 'HeroMarketDB', setupVersion: VERSION } }

// What backend.status() reports for an installed PC after a failed start with this config.
function installedStatus(cfg, err) {
  const problem = installedStoreProblem(cfg, VERSION)
  const error = problem || err
  return {
    ready: !error,
    installedStore: (cfg?.mode || 'local') === 'local',
    errorCode: error ? failureCode(error, { cfg, installed: true }) : null
  }
}

test('a failed preparation (no config written, as on the laptop) shows the store problem', () => {
  // readConfig() returns { mode: 'local' } when heromarket.json is missing.
  const st = installedStatus({ mode: 'local' })
  assert.equal(st.errorCode, 'store_not_prepared')
  assert.equal(startupPhaseFor(st), 'store_problem')
})

test('a preparation that stopped before recording this version shows the store problem', () => {
  const cfg = { mode: 'local', local: { service: 'HeroMarketDB', setupVersion: '0' } }
  assert.equal(installedStatus(cfg).errorCode, 'setup_incomplete')
  assert.equal(startupPhaseFor(installedStatus(cfg)), 'store_problem')
})

test('data from a newer version is its own store problem, never "setup incomplete"', () => {
  const cfg = { mode: 'local', local: { service: 'HeroMarketDB', setupVersion: '1.6.0' } }
  assert.equal(installedStatus(cfg).errorCode, 'database_newer')
  assert.equal(startupPhaseFor(installedStatus(cfg)), 'store_problem')
})

test('a damaged settings file on an installed PC is a store problem, not the connection screen', () => {
  // readConfig() returns null when the file and its .bak copy are both unreadable.
  const st = installedStatus(null)
  assert.equal(st.errorCode, 'config_damaged')
  assert.equal(startupPhaseFor(st), 'store_problem')
})

test('a prepared store whose database service fails to start shows the store problem', () => {
  // ensureLocalDatabase may throw with or without a code (e.g. the service did not answer).
  assert.equal(startupPhaseFor(installedStatus(prepared, new Error('timeout'))), 'store_problem')
  const coded = Object.assign(new Error('x'), { code: 'service_not_running' })
  assert.equal(installedStatus(prepared, coded).errorCode, 'service_not_running')
})

test('a prepared store of this version passes the checks and opens', () => {
  assert.equal(installedStoreProblem(prepared, VERSION), null)
  assert.equal(startupPhaseFor({ ready: true, installedStore: true }), null)
})

test('the connection settings stay for PCs that are not an installed local store', () => {
  // Development or a client/standalone PC with nothing configured yet.
  assert.equal(startupPhaseFor({ ready: false, installedStore: false, errorCode: null }), 'connect')
  // A client PC whose server is unreachable: choosing another server is the remedy.
  assert.equal(
    failureCode(new Error('ECONNREFUSED'), { cfg: { mode: 'client' }, installed: true }),
    null
  )
  assert.equal(installedStoreProblem({ mode: 'client', serverUrl: 'https://x' }, VERSION), null)
  // The renderer could not even ask (no status): connection settings, as before.
  assert.equal(startupPhaseFor(undefined), 'connect')
})
