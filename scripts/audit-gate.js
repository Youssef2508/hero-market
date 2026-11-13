#!/usr/bin/env node
'use strict'
// Dependency security gate (pre-production audit, SEC-07). Fails when npm audit reports a high or
// critical advisory – in runtime or build dependencies – unless that advisory is listed in
// .github/audit-exceptions.json with a reason, the person who reviewed it and an expiry date. An
// expired exception fails like an unlisted advisory, so no exception outlives its review.
// Moderate and low advisories are reported only. The summary goes to GITHUB_STEP_SUMMARY when set.
//
//   node scripts/audit-gate.js
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const BLOCKING = new Set(['high', 'critical'])
const exceptionsFile = path.join(__dirname, '..', '.github', 'audit-exceptions.json')

function audit() {
  try {
    return execFileSync('npm', ['audit', '--json'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 64 * 1024 * 1024
    })
  } catch (e) {
    // npm audit exits 1 when it finds anything; its JSON is still on stdout.
    if (e.stdout) return e.stdout
    throw e
  }
}

/** Every advisory with its id (GHSA URL), severity and the packages it reaches. */
function advisories(report) {
  const found = new Map()
  for (const [pkg, v] of Object.entries(report.vulnerabilities || {})) {
    for (const via of v.via || []) {
      if (typeof via === 'string') continue
      const id = via.url || `${via.source}`
      const a = found.get(id) || {
        id,
        title: via.title,
        severity: via.severity,
        packages: new Set()
      }
      a.packages.add(pkg)
      found.set(id, a)
    }
  }
  return [...found.values()]
}

function main() {
  const report = JSON.parse(audit())
  if (report.error) throw new Error(`npm audit failed: ${JSON.stringify(report.error)}`)
  const exceptions = fs.existsSync(exceptionsFile)
    ? JSON.parse(fs.readFileSync(exceptionsFile, 'utf8')).exceptions || []
    : []
  const today = new Date().toISOString().slice(0, 10)
  const lines = []
  let failed = 0
  for (const a of advisories(report).sort((x, y) => x.id.localeCompare(y.id))) {
    const ex = exceptions.find((e) => e.advisory === a.id)
    let verdict = 'reported'
    if (BLOCKING.has(a.severity)) {
      if (!ex) verdict = 'BLOCKING'
      else if (!(ex.expires >= today)) verdict = `BLOCKING (exception expired ${ex.expires})`
      else verdict = `accepted until ${ex.expires} (${ex.reviewedBy}): ${ex.reason}`
      if (verdict.startsWith('BLOCKING')) failed += 1
    }
    lines.push(`- ${a.severity} ${a.id} – ${a.title} [${[...a.packages].join(', ')}]: ${verdict}`)
  }
  const counts = report.metadata?.vulnerabilities || {}
  const summary = [
    '### Dependency audit (all dependencies)',
    `critical ${counts.critical || 0}, high ${counts.high || 0}, moderate ${counts.moderate || 0}, low ${counts.low || 0}`,
    ...(lines.length ? lines : ['- no advisories']),
    failed
      ? `**${failed} blocking advisor${failed === 1 ? 'y' : 'ies'}**: upgrade, or record a reviewed, dated exception in .github/audit-exceptions.json.`
      : 'No blocking advisories.'
  ].join('\n')
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n')
  process.exit(failed ? 1 : 0)
}

main()
