// The arrow keys between controls (D-118): the control chosen is the nearest one in that direction on
// the screen – the same row (or column) first – whatever the order of the page's code. Rectangles
// here are laid out as the till shows them, right to left.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pick } from '../../src/renderer/src/lib/spatialNav.js'

const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height
})
const item = (name, ...r) => ({ el: name, r: rect(...r) })

// The till's payment methods, right to left: نقدي, فيزا, محفظة, انستا باي on the first row; آجل and
// دفع جزئي on the second; the paid amount below them.
const cash = item('نقدي', 296, 210, 78, 44)
const visa = item('فيزا', 210, 210, 78, 44)
const wallet = item('محفظة', 124, 210, 78, 44)
const insta = item('انستا باي', 38, 210, 78, 44)
const credit = item('آجل', 210, 262, 164, 44)
const partial = item('دفع جزئي', 38, 262, 164, 44)
const paid = item('المدفوع', 212, 344, 162, 40)
const PAY = [cash, visa, wallet, insta, credit, partial, paid]

test('← and → move along the same row, the nearest first (right to left: ← is the next method)', () => {
  assert.equal(pick(cash.r, PAY, 'left'), 'فيزا')
  assert.equal(pick(visa.r, PAY, 'left'), 'محفظة')
  assert.equal(pick(wallet.r, PAY, 'left'), 'انستا باي')
  assert.equal(pick(insta.r, PAY, 'right'), 'محفظة')
  // Nothing further left on the row and nothing overlapping it to the left: nothing.
  assert.equal(pick(insta.r, PAY, 'left'), null)
})

test('↓ and ↑ go to the row below or above, the control under it first', () => {
  assert.equal(pick(visa.r, PAY, 'down'), 'آجل')
  assert.equal(pick(insta.r, PAY, 'down'), 'دفع جزئي')
  assert.equal(pick(credit.r, PAY, 'down'), 'المدفوع')
  // «دفع جزئي» is under two methods at the same distance: the first in reading order (right to left).
  assert.equal(pick(partial.r, PAY, 'up'), 'محفظة')
  assert.equal(pick(cash.r, PAY, 'up'), null)
})

test('the order of the list does not matter, only the places on the screen', () => {
  const shuffled = [paid, partial, insta, credit, visa, wallet, cash]
  assert.equal(pick(cash.r, shuffled, 'left'), 'فيزا')
  assert.equal(pick(visa.r, shuffled, 'down'), 'آجل')
})

test('from the product field: ← to the payment panel on its left, ↓ to the first cart line', () => {
  const search = item('الصنف', 420, 100, 680, 48)
  const qty1 = item('كمية 1', 560, 300, 64, 32)
  const qty2 = item('كمية 2', 560, 350, 64, 32)
  const panelTop = item('نقدي', 296, 110, 78, 44)
  const sidebar = item('شاشة الكاشير', 1140, 120, 200, 40)
  const all = [qty1, qty2, panelTop, sidebar]
  assert.equal(pick(search.r, all, 'left'), 'نقدي')
  assert.equal(pick(search.r, all, 'down'), 'كمية 1')
  assert.equal(pick(qty1.r, all, 'down'), 'كمية 2')
  assert.equal(pick(qty2.r, all, 'up'), 'كمية 1')
  // → from the product field: the sidebar, on the right in Arabic.
  assert.equal(pick(search.r, all, 'right'), 'شاشة الكاشير')
})

test('with nothing on the same row, the nearest control in that direction is chosen', () => {
  const from = rect(500, 100, 100, 40)
  const far = item('بعيد', 100, 100, 50, 40) // same row, far left
  const nearBelowLeft = item('قريب', 380, 160, 60, 40) // not on the row
  // The same row wins even when farther.
  assert.equal(pick(from, [far, nearBelowLeft], 'left'), 'بعيد')
  // Without it, the nearest to the left.
  assert.equal(pick(from, [nearBelowLeft], 'left'), 'قريب')
})

test('a control far below and a little to the right is not to the right (45°): the sidebar is', () => {
  // The settings page: a checkbox near the bottom, another one 194 px lower and 17 px further right,
  // the sidebar's last item 60 px higher and 85 px to the right.
  const from = rect(1032, 712, 16, 16)
  const lower = item('خانة أسفل', 1049, 907, 16, 16)
  const sidebar = item('تصغير القائمة', 1133, 640, 200, 40)
  assert.equal(pick(from, [lower, sidebar], 'right'), 'تصغير القائمة')
  // And ↓ still finds the lower one.
  assert.equal(pick(from, [lower, sidebar], 'down'), 'خانة أسفل')
})

test('outside the 45° only when asked (the move to another area): a top-bar button far to the side', () => {
  const field = rect(412, 72, 680, 56)
  const topbarButton = item('فتح وردية', 162, 36, 104, 36)
  assert.equal(pick(field, [topbarButton], 'up'), null)
  assert.equal(pick(field, [topbarButton], 'up', { cone: false }), 'فتح وردية')
})
