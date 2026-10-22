// Automatic midnight backup (BACKUP-01, D-060): naming, the once-a-day rule, weekly copies,
// retention (14 daily + 8 weekly, never the last good copy), verification before anything is
// pruned, failure handling and the Task Scheduler definition.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  backupName,
  parseName,
  isoWeek,
  listCopies,
  plan,
  prunable,
  runBackup,
  readCopy,
  taskXml,
  closeTaskXml,
  retryUntil,
  KEEP
} from '../../src/main/backupJob.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hm-bk-'))
const fake = (n = 3) => ({
  format: 'heromarket-backup',
  version: 1,
  schema: ['0001', '0017'],
  tables: Object.fromEntries(
    ['products', 'sales', 'sale_items', 'shifts', 'stock_movements', 'users'].map((t) => [
      t,
      { columns: ['id'], rows: Array.from({ length: n }, (_, i) => [String(i + 1)]) }
    ])
  )
})
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min)
const run = (dir, now, extra = {}) =>
  runBackup({
    dir,
    now,
    schema: ['0001', '0017'],
    exportData: async () => fake(),
    statusFile: path.join(dir, 'status.json'),
    ...extra
  })

test('names show the kind, the local date and time; weeks are ISO weeks', () => {
  assert.equal(
    backupName('daily', at(2026, 10, 22, 0, 0)),
    'HeroMarket-daily-2026-10-22_0000.json.gz'
  )
  assert.deepEqual(parseName('HeroMarket-weekly-2026-10-22_0003.json.gz'), {
    kind: 'weekly',
    day: '2026-10-22',
    stamp: '20261022000300' // seconds included (00 for daily and weekly), D-074
  })
  assert.equal(parseName('notes.txt'), null)
  assert.equal(isoWeek(at(2026, 10, 22)), '2026-W43')
  assert.equal(isoWeek(at(2027, 1, 1)), '2026-W53')
})

test('one daily copy a day: a catch-up or a second trigger the same day does nothing', async () => {
  const dir = tmp()
  const first = await run(dir, at(2026, 10, 22, 0, 0))
  assert.equal(first.result, 'done', first.reason)
  assert.deepEqual(
    first.files.map((f) => f.file),
    ['HeroMarket-daily-2026-10-22_0000.json.gz', 'HeroMarket-weekly-2026-10-22_0000.json.gz']
  )
  const again = await run(dir, at(2026, 10, 22, 9, 15))
  assert.equal(again.result, 'skipped')
  // The next day: a daily copy, no second weekly copy in the same ISO week.
  const next = await run(dir, at(2026, 10, 23, 0, 0))
  assert.deepEqual(
    next.files.map((f) => f.file),
    ['HeroMarket-daily-2026-10-23_0000.json.gz']
  )
  // A missed midnight: the catch-up at 08:05 after the PC was off makes that day's copy once.
  const late = await run(dir, at(2026, 10, 25, 8, 5))
  assert.equal(late.result, 'done')
  assert.equal((await run(dir, at(2026, 10, 25, 8, 6))).result, 'skipped')
  // The copy reads back as the program's backup format.
  const back = readCopy(path.join(dir, 'HeroMarket-daily-2026-10-25_0805.json.gz'))
  assert.equal(back.format, 'heromarket-backup')
  assert.equal(back.tables.sales.rows.length, 3)
})

test('retention keeps 14 daily and 8 weekly copies; the newest copy is never removed', async () => {
  const dir = tmp()
  const start = at(2026, 1, 1)
  for (let i = 0; i < 70; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const r = await run(dir, d)
    assert.equal(r.result, 'done', r.reason)
  }
  const copies = listCopies(dir)
  const daily = copies.filter((c) => c.kind === 'daily')
  const weekly = copies.filter((c) => c.kind === 'weekly')
  assert.equal(daily.length, 14)
  assert.equal(weekly.length, 8)
  assert.equal(daily[0].day, '2026-03-11', 'the newest daily copy is kept')
  // The rule never empties a kind, whatever the setting.
  assert.equal(prunable(copies, { daily: 0, weekly: 0 }).length, copies.length - 2)
})

test('a failed copy changes nothing: no partial file, earlier copies kept, last good time kept', async () => {
  const dir = tmp()
  assert.equal((await run(dir, at(2026, 10, 22))).result, 'done')
  const before = fs
    .readdirSync(dir)
    .filter((f) => f !== 'status.json')
    .sort()
  const failed = await run(dir, at(2026, 10, 23), {
    exportData: async () => {
      throw new Error('connection refused')
    }
  })
  assert.equal(failed.result, 'failed')
  assert.match(failed.reason, /connection refused/)
  assert.deepEqual(
    fs
      .readdirSync(dir)
      .filter((f) => f !== 'status.json')
      .sort(),
    before
  )
  const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'))
  assert.equal(status.result, 'failed')
  assert.equal(status.lastGood, at(2026, 10, 22).toISOString())
  // A copy that does not verify (wrong schema) is never put in place and prunes nothing.
  const bad = await run(dir, at(2026, 10, 23), { schema: ['0001'] })
  assert.equal(bad.result, 'failed')
  assert.match(bad.reason, /did not verify/)
  assert.deepEqual(
    fs
      .readdirSync(dir)
      .filter((f) => f !== 'status.json')
      .sort(),
    before
  )
})

test('an existing file is never overwritten; a leftover partial file is removed', async () => {
  const dir = tmp()
  const name = 'HeroMarket-daily-2026-10-22_0000.json.gz'
  fs.writeFileSync(path.join(dir, name), 'not ours')
  fs.writeFileSync(path.join(dir, 'x.partial'), 'left over')
  const r = await run(dir, at(2026, 10, 22))
  assert.equal(r.result, 'failed')
  assert.match(r.reason, /never overwritten/)
  assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), 'not ours')
  assert.ok(!fs.existsSync(path.join(dir, 'x.partial')))
})

test('the scheduled task runs nightly at midnight as the system account and catches up once', () => {
  const xml = taskXml('C:\\Program Files\\HeroMarket-POS\\HeroMarket-POS.exe')
  assert.match(xml, /<StartBoundary>2026-01-01T00:00:00<\/StartBoundary>/)
  assert.match(xml, /<DaysInterval>1<\/DaysInterval>/)
  assert.match(xml, /<UserId>S-1-5-18<\/UserId>/)
  assert.match(xml, /<StartWhenAvailable>true<\/StartWhenAvailable>/)
  assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/)
  assert.match(xml, /<Arguments>--scheduled-backup<\/Arguments>/)
  assert.match(xml, /<Command>C:\\Program Files\\HeroMarket-POS\\HeroMarket-POS.exe<\/Command>/)
  assert.equal(plan([], at(2026, 10, 22)).daily, true)
})

// After a shift close (owner, 2026-10-22, D-074): a copy every time, verified the same way, without
// anyone being asked; it never stands in for the nightly daily or weekly copy.
test('after a close: a new verified copy every time, never a daily or weekly one', async () => {
  const dir = tmp()
  const night = await run(dir, at(2026, 10, 22, 0, 0))
  assert.equal(night.result, 'done')
  const first = await run(dir, at(2026, 10, 22, 15, 30, 5), { afterClose: true })
  const second = await run(dir, at(2026, 10, 22, 23, 10, 42), { afterClose: true })
  assert.deepEqual([first.result, second.result], ['done', 'done'])
  const kinds = listCopies(dir).map((c) => c.kind)
  assert.equal(kinds.filter((k) => k === 'close').length, 2)
  assert.equal(kinds.filter((k) => k === 'daily').length, 1, 'the nightly copy is untouched')
  assert.equal(first.files[0].file, 'HeroMarket-close-2026-10-22_153000.json.gz')
  assert.ok(fs.existsSync(path.join(dir, first.files[0].file + '.sha256')))
  assert.equal(readCopy(path.join(dir, second.files[0].file)).tables.sales.rows.length, 3)
  // The nightly run the same day still finds its daily copy: nothing more.
  assert.equal((await run(dir, at(2026, 10, 22, 23, 59))).result, 'skipped')
})

test('after-close copies keep the newest 20; daily and weekly copies are not affected', async () => {
  const dir = tmp()
  await run(dir, at(2026, 10, 1, 0, 0))
  for (let i = 0; i < 25; i++) await run(dir, at(2026, 10, 2, 8, i), { afterClose: true })
  const copies = listCopies(dir)
  assert.equal(copies.filter((c) => c.kind === 'close').length, KEEP.close)
  assert.equal(KEEP.close, 20)
  assert.equal(copies.filter((c) => c.kind === 'daily').length, 1)
  assert.equal(copies.filter((c) => c.kind === 'weekly').length, 1)
  // The oldest close copies went, the newest stayed.
  assert.ok(copies.some((c) => c.file === 'HeroMarket-close-2026-10-02_082400.json.gz'))
  assert.ok(!copies.some((c) => c.file === 'HeroMarket-close-2026-10-02_080000.json.gz'))
})

test('a shift closed just before midnight: the nightly run waits for its copy, then makes its own', async () => {
  const dir = tmp()
  // The after-close copy is still being written (its lock is held) when midnight comes.
  fs.writeFileSync(path.join(dir, '.backup.lock'), '1234')
  setTimeout(() => fs.rmSync(path.join(dir, '.backup.lock')), 300)
  const nightly = await run(dir, at(2026, 10, 23, 0, 0), { lockWaitMs: 5000 })
  assert.equal(nightly.result, 'done', 'not skipped: that day would have no daily copy')
  assert.deepEqual(
    listCopies(dir).map((c) => c.kind),
    ['daily', 'weekly']
  )
  // A run that never finishes within the wait: skipped, nothing written, the lock left alone.
  fs.writeFileSync(path.join(dir, '.backup.lock'), '1234')
  const close = await run(dir, at(2026, 10, 23, 0, 1), { afterClose: true, lockWaitMs: 200 })
  assert.equal(close.result, 'skipped')
  assert.equal(listCopies(dir).length, 2)
  assert.ok(fs.existsSync(path.join(dir, '.backup.lock')))
})

test('a catch-up right after the PC starts waits for the database instead of failing the day', async () => {
  let tries = 0
  const lines = []
  const dir = tmp()
  const status = await run(dir, at(2026, 10, 24, 7, 30), {
    // The database service is still starting: the first two attempts are refused.
    exportData: () =>
      retryUntil(
        async () => {
          if (++tries < 3) throw new Error('connect ECONNREFUSED 127.0.0.1:54330')
          return fake()
        },
        { timeoutMs: 2000, intervalMs: 20, log: (l) => lines.push(l) }
      )
  })
  assert.equal(status.result, 'done')
  assert.equal(tries, 3)
  assert.match(lines.join('\n'), /waiting for the database/)
  // A database that never comes: the run fails with the reason, and nothing is written.
  const down = await run(tmp(), at(2026, 10, 24, 7, 30), {
    exportData: () =>
      retryUntil(
        async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:54330')
        },
        { timeoutMs: 100, intervalMs: 20 }
      )
  })
  assert.equal(down.result, 'failed')
  assert.match(down.reason, /ECONNREFUSED/)
})

test('the after-close task: on demand only, the system account, Windows users may start it', () => {
  const x = closeTaskXml('C:/Program Files/HeroMarket/HeroMarket-POS.exe')
  assert.ok(!x.includes('<Triggers>'), 'no schedule')
  for (const part of [
    '<UserId>S-1-5-18</UserId>',
    '<SecurityDescriptor>D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;BU)</SecurityDescriptor>',
    '<Arguments>--scheduled-backup --after-close</Arguments>',
    '<StartWhenAvailable>false</StartWhenAvailable>',
    '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>'
  ])
    assert.ok(x.includes(part), part)
})
