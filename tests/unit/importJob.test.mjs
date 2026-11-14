// The import screen's reading of a job (1.6.3): real progress only, a safe error report, and a
// failure to ask never taken for the import's failure.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  progressOf,
  safeCell,
  errorReportRows,
  pollDelay,
  isTransient,
  duration
} from '../../src/renderer/src/lib/importJob.js'
import { SHEETS } from '../../src/shared/storeImport.mjs'

test('progress comes from the job; no estimate until there is something to estimate from', () => {
  const job = { status: 'processing', totalRows: 5000, processedRows: 0 }
  assert.deepEqual(progressOf(job, 1), { percent: 0, remaining: null })
  assert.deepEqual(progressOf({ ...job, processedRows: 2450 }, 2), { percent: 49, remaining: null })
  assert.deepEqual(progressOf({ ...job, processedRows: 2500 }, 10), { percent: 50, remaining: 10 })
  assert.deepEqual(progressOf({ ...job, status: 'completed', processedRows: 5000 }, 20), {
    percent: 100,
    remaining: 0
  })
  // Ended without saving: the bar shows how far it got, no time left is promised.
  assert.equal(progressOf({ ...job, status: 'failed', processedRows: 300 }, 30).remaining, null)
  assert.equal(duration(75), '1 د 15 ث')
})

test('the error report: every problem with its sheet, row, column header; formulas made text', () => {
  const rows = errorReportRows(
    [
      {
        sheet: 'الأصناف',
        row: 12,
        field: 'retail_price',
        message: 'سعر البيع مطلوب ولا يكون بالسالب.'
      },
      { sheet: 'الأصناف', row: 13, field: 'name', message: '=HYPERLINK("http://x","y")' },
      { sheet: 'العملاء', row: 4, field: 'phone', message: '+201000' }
    ],
    SHEETS
  )
  assert.equal(rows.length, 4)
  assert.deepEqual(
    rows[1].map((c) => c.value),
    ['الأصناف', 12, 'سعر البيع', 'سعر البيع مطلوب ولا يكون بالسالب.']
  )
  assert.equal(rows[2][3].value, '\'=HYPERLINK("http://x","y")')
  assert.equal(rows[3][3].value, "'+201000")
  for (const v of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx']) assert.ok(safeCell(v).startsWith("'"))
  assert.equal(safeCell('صنف عادي'), 'صنف عادي')
})

test('asking again: longer waits after failures, never stopping; which failures are temporary', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 9].map((n) => pollDelay(n)),
    [1000, 2000, 4000, 8000, 15000, 15000]
  )
  assert.ok(isTransient({ status: 503, code: 'server_unreachable' }))
  assert.ok(isTransient({ status: 504, code: 'pending_confirmation' }))
  assert.ok(isTransient({ status: 0 }))
  assert.ok(!isTransient({ status: 404, code: 'not_found' }))
  assert.ok(!isTransient({ status: 403, code: 'forbidden' }))
})
