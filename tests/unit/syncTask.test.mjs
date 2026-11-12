// The background sync service's scheduled task (Phase 2 milestone 4, D-104): what Windows is told.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncTaskXml } from '../../src/main/syncTask.js'

const xml = syncTaskXml('C:\\Program Files\\HeroMarket-POS\\HeroMarket-POS.exe')

test('starts with Windows, before anyone signs in, as the system account', () => {
  assert.match(xml, /<BootTrigger>[\s\S]*<Enabled>true<\/Enabled>[\s\S]*<\/BootTrigger>/)
  assert.match(xml, /<UserId>S-1-5-18<\/UserId>/)
  assert.match(xml, /<StartWhenAvailable>true<\/StartWhenAvailable>/)
})

test('a five-minute watchdog, one copy at a time, restarted after a failure, never stopped for time', () => {
  assert.match(xml, /<Repetition>\s*<Interval>PT5M<\/Interval>/)
  assert.match(xml, /<StopAtDurationEnd>false<\/StopAtDurationEnd>/)
  assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/)
  assert.match(xml, /<RestartOnFailure>\s*<Interval>PT1M<\/Interval>\s*<Count>999<\/Count>/)
  assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/)
  assert.match(xml, /<DisallowStartIfOnBatteries>false<\/DisallowStartIfOnBatteries>/)
  assert.match(xml, /<StopIfGoingOnBatteries>false<\/StopIfGoingOnBatteries>/)
})

test('runs the installed program in its windowless sync mode', () => {
  assert.match(xml, /<Command>C:\\Program Files\\HeroMarket-POS\\HeroMarket-POS\.exe<\/Command>/)
  assert.match(xml, /<Arguments>--sync-service<\/Arguments>/)
  assert.equal(syncTaskXml('C:\\a&b<c>\\x.exe').includes('a&amp;b&lt;c&gt;'), true)
})
