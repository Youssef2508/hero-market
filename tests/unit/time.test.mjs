import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  to12h,
  formatClock,
  formatHour,
  splitStamp,
  formatStamp,
  ltrText
} from '../../src/renderer/src/lib/time.js'

test('12-hour clock: midnight, morning, noon, afternoon, last minute of the day', () => {
  assert.equal(to12h(0, 0), '12:00 AM') // midnight
  assert.equal(to12h(0, 5), '12:05 AM')
  assert.equal(to12h(9, 20), '09:20 AM')
  assert.equal(to12h(11, 59), '11:59 AM')
  assert.equal(to12h(12, 0), '12:00 PM') // noon
  assert.equal(to12h(12, 30), '12:30 PM')
  assert.equal(to12h(15, 45), '03:45 PM')
  assert.equal(to12h(23, 59), '11:59 PM')
  assert.equal(to12h(15, 45, 7), '03:45:07 PM')
})

test('formatClock uses the local time of a Date', () => {
  assert.equal(formatClock(new Date(2026, 9, 15, 0, 0, 0)), '12:00 AM')
  assert.equal(formatClock(new Date(2026, 9, 15, 9, 20, 0)), '09:20 AM')
  assert.equal(formatClock(new Date(2026, 9, 15, 12, 0, 0)), '12:00 PM')
  assert.equal(formatClock(new Date(2026, 9, 15, 15, 45, 30)), '03:45 PM')
  assert.equal(formatClock(new Date(2026, 9, 15, 15, 45, 30), { seconds: true }), '03:45:30 PM')
})

test('hour labels for charts', () => {
  assert.deepEqual([0, 1, 11, 12, 13, 23].map(formatHour), [
    '12 AM',
    '1 AM',
    '11 AM',
    '12 PM',
    '1 PM',
    '11 PM'
  ])
})

test('stored timestamps keep their date; only the display of the time changes', () => {
  assert.deepEqual(splitStamp('2026-10-15 00:00:00'), { date: '2026-10-15', time: '12:00 AM' })
  assert.deepEqual(splitStamp('2026-10-15 12:00:00'), { date: '2026-10-15', time: '12:00 PM' })
  assert.deepEqual(splitStamp('2026-10-15T15:45'), { date: '2026-10-15', time: '03:45 PM' })
  // 23:59 stays on its own date (no date shift): date boundaries are unchanged.
  assert.equal(formatStamp('2026-10-15 23:59:59'), '2026-10-15 11:59 PM')
  assert.equal(formatStamp('2026-10-15 23:59:59', { seconds: true }), '2026-10-15 11:59:59 PM')
  assert.equal(formatStamp('2026-10-16 00:00:01'), '2026-10-16 12:00 AM')
  // Dates without a time and unknown text are shown as they are.
  assert.equal(formatStamp('2026-11-01'), '2026-11-01')
  assert.equal(formatStamp(''), '')
})

test('plain-text times carry a left-to-right mark so RTL receipts keep "03:45 PM" in order', () => {
  assert.equal(ltrText('03:45 PM'), '‎03:45 PM')
  assert.equal(ltrText(''), '')
})
