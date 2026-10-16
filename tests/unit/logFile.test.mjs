// Regression tests for "A JavaScript error occurred in the main process: EPERM … logs\app.log" seen on
// the owner's laptop (1.4.0 release checks): the program's log must never stop the program.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openLogFile } from '../../src/main/logFile.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hm-log-'))

test('an unusable shared log falls back to the user log and the program keeps running', () => {
  const base = tmp()
  try {
    // The shared log cannot be opened (here: a folder where the file should be, as reliable on
    // every platform as a file the user may not write).
    const shared = path.join(base, 'shared', 'app.log')
    fs.mkdirSync(shared, { recursive: true })
    const user = path.join(base, 'user', 'logs', 'app.log')
    const log = openLogFile([shared, user])
    assert.equal(log.path, user)
    log.write('line 1\n')
    log.write('line 2\n')
    assert.equal(fs.readFileSync(user, 'utf8'), 'line 1\nline 2\n')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('when no log can be opened, nothing throws and writes are ignored', () => {
  const base = tmp()
  try {
    const a = path.join(base, 'a')
    const b = path.join(base, 'b')
    fs.mkdirSync(a)
    fs.mkdirSync(b)
    const log = openLogFile([a, b, null])
    assert.equal(log.path, null)
    assert.doesNotThrow(() => log.write('ignored\n'))
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('a log older than a day starts afresh; a recent one is appended to', () => {
  const base = tmp()
  try {
    const file = path.join(base, 'app.log')
    fs.writeFileSync(file, 'old\n')
    const recent = openLogFile([file], { now: () => fs.statSync(file).mtimeMs + 1000 })
    recent.write('new\n')
    assert.equal(fs.readFileSync(file, 'utf8'), 'old\nnew\n')
    const later = openLogFile([file], {
      now: () => fs.statSync(file).mtimeMs + 2 * 24 * 3600 * 1000
    })
    later.write('after\n')
    const text = fs.readFileSync(file, 'utf8')
    assert.match(text, /^\[LOG ENGINE\] .*reset/)
    assert.ok(text.endsWith('after\n') && !text.includes('old\n'), text)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
