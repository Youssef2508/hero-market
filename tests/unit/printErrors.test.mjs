// What the cashier is told when the receipt cannot be printed (1.4.0, no printer connected).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { printFailureReason, PRINT_TIMEOUT_MS } from '../../src/main/printErrors.js'

test('a printer that does not answer (time-out) is named, with the time waited', () => {
  const err = Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' })
  assert.match(printFailureReason(err, '', 'XP-80C'), /لم تستجب الطابعة "XP-80C" خلال 20 ثانية/)
  assert.equal(PRINT_TIMEOUT_MS, 20000)
  // No printer chosen: Windows' default printer (e.g. Microsoft Print to PDF waiting for a file name).
  assert.match(printFailureReason(err, '', ''), /الطابعة الافتراضية .* اختر طابعة الإيصالات/)
})

test('a printer that does not exist on this PC is reported as such', () => {
  const err = new Error('Command failed: powershell.exe …')
  const out =
    'Exception calling "Print": "Settings to access printer \'XP-80C\' are not valid."\n  + CategoryInfo : InvalidPrinterException'
  assert.equal(
    printFailureReason(err, out, 'XP-80C'),
    'الطابعة "XP-80C" غير موجودة على هذا الجهاز أو غير متصلة.'
  )
  assert.equal(printFailureReason(err, out, ''), 'لا توجد طابعة افتراضية صالحة على هذا الجهاز.')
})

test('anything else gets a plain sentence (details stay in the log), never a stack trace', () => {
  const reason = printFailureReason(new Error('spawn EACCES'), 'at line 12 char 4', 'XP-80C')
  assert.equal(reason, 'تعذر إرسال الفاتورة إلى الطابعة.')
  assert.doesNotMatch(reason, /powershell|EACCES|at line/)
})

test('the print script own answers: a missing printer, and a printer that asks for a file name', () => {
  const failed = Object.assign(new Error('Command failed'), { code: 2 })
  assert.equal(
    printFailureReason(failed, 'PRINT_FAILED: INVALID_PRINTER XP-80C', 'XP-80C'),
    'الطابعة "XP-80C" غير موجودة على هذا الجهاز أو غير متصلة.'
  )
  assert.match(
    printFailureReason(failed, 'PRINT_FAILED: NEEDS_FILE_NAME Microsoft Print to PDF', ''),
    /تطلب اسم ملف .* اختر طابعة الإيصالات/
  )
})
