// What the import screen shows about an import job (1.6.3, D-108). Everything shown comes from the
// job as the service reports it: no progress is invented here.

export const STATUS_LABELS = {
  queued: 'في الانتظار',
  processing: 'جارٍ الاستيراد',
  completed: 'تم',
  failed: 'لم يتم',
  cancelled: 'أُلغي'
}

export const STAGE_LABELS = {
  queued: 'في انتظار البدء',
  checking: 'فحص الصفوف',
  products: 'حفظ الأصناف',
  customers: 'حفظ العملاء',
  suppliers: 'حفظ الموردين',
  finishing: 'إنهاء الحفظ',
  retrying: 'إعادة المحاولة بعد خطأ مؤقت',
  interrupted: 'توقف الخادم – سيُستأنف تلقائياً',
  checked: 'تم الفحص',
  done: 'اكتمل',
  failed: 'توقف',
  cancelled: 'أُلغي'
}

export const isOpen = (job) => !!job && ['queued', 'processing'].includes(job.status)

/**
 * Percent of rows written in the running attempt, and the seconds left – only once there is enough
 * to estimate from (some rows written, a few seconds passed); null otherwise.
 */
export function progressOf(job, elapsedSeconds = job?.elapsedSeconds ?? 0) {
  if (!job || !job.totalRows) return { percent: 0, remaining: null }
  if (job.status === 'completed') return { percent: 100, remaining: 0 }
  const done = Math.min(job.processedRows || 0, job.totalRows)
  const percent = Math.floor((done / job.totalRows) * 100)
  if (!isOpen(job) || done < 50 || elapsedSeconds < 3) return { percent, remaining: null }
  const rate = done / elapsedSeconds
  return { percent, remaining: Math.max(1, Math.round((job.totalRows - done) / rate)) }
}

export function duration(seconds) {
  if (seconds === null || seconds === undefined) return ''
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} ث`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} د ${s % 60} ث`
  return `${Math.floor(m / 60)} س ${m % 60} د`
}

// A cell starting with one of these is a formula to a spreadsheet program: written as text.
const FORMULA_START = /^[=+\-@\t\r]/

/** A value made safe to put in a spreadsheet cell. */
export function safeCell(v) {
  const s = v === null || v === undefined ? '' : String(v)
  return FORMULA_START.test(s) ? `'${s}` : s
}

/**
 * The error report as write-excel-file sheet rows: one line per problem, with the sheet, the row
 * number in the owner's file, the column by its header and the problem.
 * @param {Array<{sheet: string, row: number, field?: string, message: string}>} errors
 * @param {Record<string, {name: string, columns: Array<{key: string, header: string}>}>} sheets
 */
export function errorReportRows(errors, sheets) {
  const headers = {}
  for (const s of Object.values(sheets))
    headers[s.name] = Object.fromEntries(s.columns.map((c) => [c.key, c.header]))
  const head = ['الورقة', 'رقم الصف في الملف', 'العمود', 'المشكلة'].map((value) => ({
    value,
    fontWeight: 'bold'
  }))
  return [
    head,
    ...errors.map((e) => [
      { value: safeCell(e.sheet), type: String },
      e.row ? { value: Number(e.row), type: Number } : { value: '', type: String },
      { value: safeCell(headers[e.sheet]?.[e.field] || e.field || ''), type: String },
      { value: safeCell(e.message), type: String }
    ])
  ]
}

/** How long to wait before asking again: longer after failures (up to 15 s), never giving up. */
export function pollDelay(failures, base = 1000) {
  return Math.min(base * 2 ** Math.min(failures, 4), 15000)
}

/** A failure to ask is not the job's failure: these answers mean "ask again later". */
export function isTransient(err) {
  const status = err?.status ?? 0
  return status === 0 || status >= 500 || err?.code === 'server_unreachable'
}
