// What the cashier is told when a receipt cannot be printed (1.4.0 release checks, no printer
// connected). The sale itself is already saved before printing starts; this only explains why the
// paper did not come out. Technical details go to the log. (No Electron imports: tests use it.)

export const PRINT_TIMEOUT_MS = 20000

/**
 * @param {Error & {killed?: boolean, signal?: string}} err  execFile error (null when the script ran)
 * @param {string} output  stdout + stderr of the print script
 * @param {string} printerName  configured printer ('' = Windows' default printer)
 */
export function printFailureReason(err, output = '', printerName = '') {
  const name = String(printerName || '').trim()
  const text = `${err?.message || ''}\n${output || ''}`
  if (err && (err.killed || err.signal === 'SIGTERM' || /ETIMEDOUT|timed out/i.test(text))) {
    return name
      ? `لم تستجب الطابعة "${name}" خلال ${PRINT_TIMEOUT_MS / 1000} ثانية.`
      : `لم تستجب الطابعة الافتراضية لـ Windows خلال ${PRINT_TIMEOUT_MS / 1000} ثانية (قد تكون طابعة PDF تنتظر اسم ملف). اختر طابعة الإيصالات في الإعدادات.`
  }
  if (/NEEDS_FILE_NAME/.test(text)) {
    return `الطابعة "${name || 'الافتراضية'}" تطلب اسم ملف (طابعة PDF وليست طابعة إيصالات). اختر طابعة الإيصالات في الإعدادات.`
  }
  if (
    /INVALID_PRINTER|InvalidPrinterException|not valid|no printers? (are )?installed/i.test(text)
  ) {
    return name
      ? `الطابعة "${name}" غير موجودة على هذا الجهاز أو غير متصلة.`
      : 'لا توجد طابعة افتراضية صالحة على هذا الجهاز.'
  }
  return 'تعذر إرسال الفاتورة إلى الطابعة.'
}
