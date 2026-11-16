// The shop's connection on the internet screens (D-114): the state and the last contact come from
// the cloud's own clock, never from the page's; the time is shown in the store's time zone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  connectivityNow,
  sinceText,
  contactTime,
  connectivityText
} from '../../src/renderer/src/lib/connectivity.js'

const answer = (ageMs, extra = {}) => ({
  connectivity: 'connected',
  serverTime: '2026-11-16T20:45:30.000Z',
  lastContactAt: new Date(Date.parse('2026-11-16T20:45:30.000Z') - ageMs).toISOString(),
  healthyMs: 25000,
  offlineMs: 40000,
  timeZone: 'Africa/Cairo',
  ...extra
})

test('the state follows the age of the last contact on the cloud’s clock', () => {
  const at = 1_000_000
  assert.deepEqual(connectivityNow(answer(4000), at, at), { state: 'connected', ageMs: 4000 })
  // Time passes on the page with no new answer: the age counts on, connected becomes delayed,
  // then offline – never a stale "connected".
  assert.equal(connectivityNow(answer(4000), at, at + 22000).state, 'delayed')
  assert.equal(connectivityNow(answer(4000), at, at + 37000).state, 'offline')
  assert.equal(connectivityNow(answer(30000), at, at).state, 'delayed')
})

test('the page’s own clock never enters: a page three hours wrong reads the same', () => {
  const a = answer(18000)
  const wrong = Date.parse('2026-11-16T17:45:30.000Z') // the page thinks it is 3 hours earlier
  const r = connectivityNow(a, wrong, wrong + 2000)
  assert.deepEqual(r, { state: 'connected', ageMs: 20000 })
})

test('the cloud saying offline wins over a recent contact (the shop’s request closed)', () => {
  assert.equal(connectivityNow(answer(2000, { connectivity: 'offline' }), 0, 0).state, 'offline')
})

test('never in contact, and not paired: their own states, never "connected"', () => {
  assert.equal(connectivityNow(answer(0, { lastContactAt: null }), 0, 0).state, 'unknown')
  assert.equal(connectivityNow({ connectivity: 'unpaired' }, 0, 0).state, 'unpaired')
  assert.equal(connectivityNow(null, 0, 0).state, 'unpaired')
  assert.equal(connectivityText({ state: 'unknown' }, {}), 'لم يتصل المحل بالسحابة بعد.')
})

test('ages in Arabic with the right forms', () => {
  assert.equal(sinceText(400), 'الآن')
  assert.equal(sinceText(1000), 'منذ ثانية')
  assert.equal(sinceText(2000), 'منذ ثانيتين')
  assert.equal(sinceText(4000), 'منذ 4 ثوانٍ')
  assert.equal(sinceText(18000), 'منذ 18 ثانية')
  assert.equal(sinceText(120000), 'منذ دقيقتين')
  assert.equal(sinceText(5 * 60000), 'منذ 5 دقائق')
  assert.equal(sinceText(3 * 3600000), 'منذ 3 ساعات')
  assert.equal(sinceText(26 * 3600000), 'منذ يوم')
})

test('the last contact is shown in the store’s time zone, whatever the page’s', () => {
  // 20:45:12 UTC is 22:45:12 in Cairo (no daylight saving in November).
  const iso = '2026-11-16T20:45:12.000Z'
  const now = Date.parse('2026-11-16T21:00:00.000Z')
  const cairo = contactTime(iso, 'Africa/Cairo', now)
  assert.match(
    cairo.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)),
    /10:45:12/
  )
  assert.match(cairo, /م/)
  // Another day: its date as well.
  const earlier = contactTime('2026-11-14T08:00:00.000Z', 'Africa/Cairo', now)
  assert.ok(earlier.length > cairo.length)
  const text = connectivityText({ state: 'offline', ageMs: 60000 }, answer(60000))
  assert.match(text, /^المحل غير متصل — آخر تواصل ناجح: /)
  assert.equal(
    connectivityText({ state: 'connected', ageMs: 4000 }, answer(4000)),
    'متصل الآن — آخر تواصل منذ 4 ثوانٍ'
  )
  assert.equal(
    connectivityText({ state: 'delayed', ageMs: 18000 }, answer(18000)),
    'الاتصال متأخر — آخر تواصل منذ 18 ثانية'
  )
})
