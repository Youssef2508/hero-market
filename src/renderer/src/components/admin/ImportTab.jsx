import { useCallback, useEffect, useState } from 'react'
import {
  FileSpreadsheet,
  Download,
  Upload,
  CircleCheck,
  CircleAlert,
  WifiOff,
  History
} from 'lucide-react'
import readExcelFile from 'read-excel-file/browser'
import writeExcelFile from 'write-excel-file/browser'
import { api, can, newClientRef } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import {
  STATUS_LABELS,
  STAGE_LABELS,
  isOpen,
  progressOf,
  duration,
  errorReportRows,
  pollDelay,
  isTransient
} from '../../lib/importJob'
import {
  readWorkbook,
  templateSheets,
  exportSheets,
  SHEETS
} from '../../../../shared/storeImport.mjs'

const SHOWN_ERRORS = 300
// Larger than any real store file (5,000 products ≈ 250 KB): refused before it is read.
const MAX_FILE_BYTES = 20 * 1024 * 1024

// Import of the store's data from the HeroMarket Excel template (1.4.0): products with stock and
// categories, customers and suppliers with their balances. The file is read here and checked by
// the service (storeImport.apply, dryRun). The import itself is a job on the server (1.6.3,
// D-108): it goes on if this page is closed, reloaded or loses its connection, and the screen
// follows it from the server's own figures (imports.get), finding it again when opened.
/**
 * Export in the template's own layout (DATA-01, D-067): the file is built here from the service's
 * snapshot, then read back with the import reader and compared before it is saved – a file that
 * would not import again is never offered as a success.
 */
function ExportSection({ triggerCustomAlert }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const run = async () => {
    setBusy(true)
    setResult(null)
    try {
      const data = await api('storeExport.data')
      const note = `صُدّر في ${data.createdAt}. يمكن مراجعته وتعديله ثم استيراده في متجر جديد.`
      const blob = await writeExcelFile(exportSheets(data, { note })).toBlob()
      const back = readWorkbook(await readExcelFile(blob))
      const counts = ['products', 'customers', 'suppliers'].map((k) => [
        k,
        data[k].length,
        back[k].length
      ])
      const wrong = counts.filter(([, a, b]) => a !== b)
      if (back.errors.length || wrong.length)
        throw new Error(
          back.errors[0]?.message ||
            `عدد الصفوف في الملف لا يطابق البيانات (${wrong.map(([k, a, b]) => `${k}: ${a}≠${b}`).join('، ')}).`
        )
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `HeroMarket-data-${data.createdAt.slice(0, 10)}.xlsx`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
      setResult({ ok: true, data })
    } catch (err) {
      setResult({ ok: false, message: err.message })
      triggerCustomAlert?.(`لم يتم التصدير (لم يُحفظ أي ملف): ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  const d = result?.data
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">
          <Download size={18} aria-hidden="true" />
          تصدير البيانات بقالب الاستيراد
        </h2>
      </div>
      <div className="card-body stack">
        <p>
          ملف Excel بنفس أوراق القالب وأعمدته: الأصناف (مع الكمية الحالية والتكلفة والعبوة)، العملاء
          والموردون (مع المستحق الحالي). يُفحص الملف بقراءته مرة أخرى قبل حفظه.
        </p>
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={run} disabled={busy}>
            <Download size={16} aria-hidden="true" />
            {busy ? 'جارٍ التصدير…' : 'تصدير البيانات'}
          </button>
        </div>
        {d && (
          <div role="status" className="stack">
            <p>
              <CircleCheck size={16} aria-hidden="true" /> تم التصدير والتحقق:{' '}
              <span className="num">{d.products.length}</span> صنف،{' '}
              <span className="num">{d.customers.length}</span> عميل،{' '}
              <span className="num">{d.suppliers.length}</span> مورد.
            </p>
            {(d.left.inactive_products > 0 ||
              d.left.products_with_more_packages > 0 ||
              d.left.extra_barcodes > 0) && (
              <p className="field-hint">
                لم يُصدَّر (تحفظه النسخة الاحتياطية):
                {d.left.inactive_products > 0 && ` ${d.left.inactive_products} صنف موقوف؛`}
                {d.left.products_with_more_packages > 0 &&
                  ` العبوات الإضافية لـ ${d.left.products_with_more_packages} صنف (تُصدَّر العبوة الأكبر فقط)؛`}
                {d.left.extra_barcodes > 0 &&
                  ` ${d.left.extra_barcodes} باركود إضافي للوحدة الأساسية.`}
              </p>
            )}
          </div>
        )}
        {result && !result.ok && (
          <p className="text-danger" role="alert">
            لم يتم التصدير: {result.message}
          </p>
        )}
        <p className="field-hint">
          لا يُصدَّر سجل المبيعات والمشتريات والورديات والخزنة ولا المستخدمون أو كلمات المرور أو
          الإعدادات: هذه في النسخة الاحتياطية فقط.
        </p>
      </div>
    </section>
  )
}

/** The problems as a workbook the owner can open, fix from and keep. */
async function downloadErrors(errors, name) {
  const blob = await writeExcelFile([
    {
      sheet: 'الأخطاء',
      data: errorReportRows(errors, SHEETS),
      columns: [{ width: 14 }, { width: 18 }, { width: 22 }, { width: 80 }],
      rightToLeft: true
    }
  ]).toBlob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `أخطاء-${(name || 'الاستيراد').replace(/\.xlsx$/i, '')}.xlsx`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

function ErrorTable({ errors }) {
  return (
    <div className="table-wrap import-errors">
      <table className="table">
        <thead>
          <tr>
            <th>الورقة</th>
            <th>الصف</th>
            <th>المشكلة</th>
          </tr>
        </thead>
        <tbody>
          {errors.slice(0, SHOWN_ERRORS).map((e, i) => (
            <tr key={i}>
              <td>{e.sheet}</td>
              <td className="num">{e.row || ''}</td>
              <td>{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {errors.length > SHOWN_ERRORS && (
        <p className="text-muted">
          يظهر أول {SHOWN_ERRORS} خطأ فقط. نزّل تقرير الأخطاء لتراها كلها.
        </p>
      )}
    </div>
  )
}

function ErrorReportButton({ errors, name, triggerCustomAlert }) {
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() =>
        downloadErrors(errors, name).catch((e) =>
          triggerCustomAlert(`تعذر إنشاء تقرير الأخطاء: ${e.message}`)
        )
      }
    >
      <Download size={16} aria-hidden="true" /> تنزيل تقرير الأخطاء
    </button>
  )
}

/** The job followed now: its real progress while it runs, its outcome when it ends. */
function JobCard({ job, contact, errors, onCancel, onClose, triggerCustomAlert }) {
  const [now, setNow] = useState(() => Date.now())
  const open = isOpen(job)
  // The time on screen moves every second between two answers of the server.
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [open])
  const since = job.at ? Math.max(0, Math.floor((now - job.at) / 1000)) : 0
  const elapsed = open ? (job.elapsedSeconds || 0) + since : job.elapsedSeconds
  const { percent, remaining } = progressOf(job, elapsed)
  const tone =
    job.status === 'completed' ? 'tone-success' : job.status === 'failed' ? 'tone-danger' : ''
  const shown = job.status === 'completed' ? job.totalRows : job.processedRows || 0
  const s = job.summary
  return (
    <section className={`card ${tone}`} aria-live="polite">
      <div className="card-header">
        <h2 className="card-title">
          {job.status === 'completed' ? (
            <CircleCheck size={18} aria-hidden="true" />
          ) : job.status === 'failed' ? (
            <CircleAlert size={18} aria-hidden="true" />
          ) : (
            <FileSpreadsheet size={18} aria-hidden="true" />
          )}
          {job.filename || 'ملف Excel'} – {STATUS_LABELS[job.status] || job.status}
        </h2>
      </div>
      <div className="card-body stack">
        {contact && (
          <p className="import-contact" role="status">
            <WifiOff size={16} aria-hidden="true" /> {contact}
          </p>
        )}
        <div
          className="import-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="تقدم الاستيراد"
        >
          <span style={{ inlineSize: `${percent}%` }} />
        </div>
        <dl className="kv">
          <dt>الصفوف</dt>
          <dd className="num">
            {shown} / {job.totalRows} ({percent}%)
          </dd>
          <dt>المرحلة</dt>
          <dd>{STAGE_LABELS[job.stage] || job.stage}</dd>
          <dt>المحفوظ</dt>
          <dd className="num">{job.successfulRows}</dd>
          <dt>صفوف بها أخطاء</dt>
          <dd className="num">{job.failedRows}</dd>
          <dt>صفوف تم تخطيها</dt>
          <dd className="num">{job.skippedRows}</dd>
          <dt>الوقت</dt>
          <dd className="num">
            {duration(elapsed)}
            {open && remaining ? ` – المتبقي تقريباً ${duration(remaining)}` : ''}
          </dd>
        </dl>
        {open && (
          <p className="field-hint">
            يُحفظ الملف كله معاً في النهاية: حتى ينتهي لا يظهر شيء منه في الأصناف. يمكنك إغلاق هذه
            الصفحة أو تحديثها؛ يستمر الاستيراد في الخادم وتظهر حالته هنا عند العودة.
            {job.quietSeconds > 60 && window.api?.isWeb
              ? ' لم يصل تحديث من جهاز المتجر منذ أكثر من دقيقة: ربما انقطع اتصاله، ويكمل الاستيراد عند عودته.'
              : ''}
          </p>
        )}
        {job.status === 'completed' && s && (
          <p>
            <CircleCheck size={16} aria-hidden="true" /> تم الاستيراد:{' '}
            <span className="num">{s.products}</span> صنف،{' '}
            <span className="num">{s.customers}</span> عميل،{' '}
            <span className="num">{s.suppliers}</span> مورد. راجع الأصناف والعملاء ثم ابدأ البيع.
          </p>
        )}
        {job.status === 'cancelled' && <p>أُلغي الاستيراد ولم يُحفظ منه شيء.</p>}
        {job.status === 'failed' && <p className="text-danger">{job.errorMessage}</p>}
        {errors && errors.length > 0 && <ErrorTable errors={errors} />}
        <div className="row row-wrap">
          {open && !job.cancelRequested && (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              إلغاء الاستيراد
            </button>
          )}
          {open && job.cancelRequested && <span className="text-muted">جارٍ الإلغاء…</span>}
          {errors && errors.length > 0 && (
            <ErrorReportButton
              errors={errors}
              name={job.filename}
              triggerCustomAlert={triggerCustomAlert}
            />
          )}
          {!open && (
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              إغلاق
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function HistoryCard({ jobs, onShow }) {
  if (!jobs.length) return null
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">
          <History size={18} aria-hidden="true" /> آخر عمليات الاستيراد
        </h2>
      </div>
      <div className="card-body">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الملف</th>
                <th>الوقت</th>
                <th>الحالة</th>
                <th>الصفوف</th>
                <th>المحفوظ</th>
                <th>بها أخطاء</th>
                <th>المدة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.filename || '—'}</td>
                  <td className="num">{j.createdAt}</td>
                  <td>{STATUS_LABELS[j.status] || j.status}</td>
                  <td className="num">{j.totalRows}</td>
                  <td className="num">{j.successfulRows}</td>
                  <td className="num">{j.failedRows}</td>
                  <td className="num">{isOpen(j) ? '' : duration(j.elapsedSeconds)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onShow(j)}
                    >
                      عرض
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export default function ImportTab({ triggerCustomAlert, triggerCustomConfirm, currentUser }) {
  const canImport = can(currentUser, 'data.import')
  const canExport = can(currentUser, 'data.export')
  const [file, setFile] = useState(null)
  const [rows, setRows] = useState(null)
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState('')
  // The job followed now, the problems of a job that ended with them, and why the server could not
  // be asked about it the last time (null when it answered).
  const [job, setJob] = useState(null)
  const [jobErrors, setJobErrors] = useState(null)
  const [contact, setContact] = useState(null)
  // A start whose answer was lost: sent again with the same id until answered (never two jobs).
  const [pending, setPending] = useState(null)
  const [history, setHistory] = useState([])

  // `at`: when the server's figures arrived, for the time shown between two answers.
  const follow = (j) => setJob(j ? { ...j, at: Date.now() } : null)

  const loadHistory = useCallback(async () => {
    try {
      const r = await api('imports.list', { limit: 20 })
      setHistory(r.jobs)
      return r.jobs
    } catch {
      return null
    }
  }, [])

  // Opening the screen (after a reload, from another device…): an import still running is
  // followed again.
  useEffect(() => {
    if (!canImport) return
    loadHistory().then((jobs) => {
      const open = jobs && jobs.find(isOpen)
      if (open) follow(open)
    })
  }, [canImport, loadHistory])

  const loadErrors = async (j) => {
    if (!j.errorsCount) return
    try {
      setJobErrors((await api('imports.get', { id: j.id, withErrors: true })).errors)
    } catch (e) {
      // The job's summary is shown; the list can be opened again from the history.
      setContact(e.message)
    }
  }

  // Follow an open job until it ends. A failure to ask is never taken for the import's failure:
  // the server keeps working, so the screen asks again, waiting longer each time.
  const jobId = job?.id
  const jobOpen = isOpen(job)
  useEffect(() => {
    if (!jobId || !jobOpen) return
    let stopped = false
    let failures = 0
    let timer
    const ask = async () => {
      try {
        const j = await api('imports.get', { id: jobId })
        if (stopped) return
        failures = 0
        setContact(null)
        follow(j)
        if (!isOpen(j)) {
          loadHistory()
          if (j.status === 'completed') {
            setRows(null)
            setFile(null)
            setCheck(null)
          }
          loadErrors(j)
          return
        }
      } catch (e) {
        if (stopped) return
        if (!isTransient(e)) {
          setContact(e.message)
          return
        }
        failures += 1
        setContact(
          'تعذر الاتصال بالخادم الآن. الاستيراد مستمر هناك ولم يتوقف؛ نحاول مرة أخرى تلقائياً.'
        )
      }
      timer = setTimeout(ask, pollDelay(failures))
    }
    // The first answer soon: a small file is often done within a second.
    timer = setTimeout(ask, 300)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, jobOpen])

  const started = (j) => {
    setPending(null)
    setContact(null)
    setJobErrors(null)
    setCheck(null)
    follow(j)
    loadHistory()
  }

  const startJob = async (body) => {
    setBusy('apply')
    try {
      started(await api('imports.start', body))
    } catch (e) {
      if (e.code === 'already_imported')
        triggerCustomConfirm(
          `${e.message} الأصناف التي لها باركود موجودة بالفعل وستظهر كأخطاء، والأصناف بدون باركود ستُضاف مرة ثانية. هل تريد استيراده مرة أخرى؟`,
          () => startJob({ ...body, allowRepeat: true }),
          null,
          'ملف مستورد من قبل'
        )
      else if (e.code === 'import_running') {
        triggerCustomAlert(e.message)
        const jobs = await loadHistory()
        const open = jobs && jobs.find(isOpen)
        if (open) follow(open)
      } else if (isTransient(e))
        // The answer was lost on the way: the job may well have started.
        setPending(body)
      else triggerCustomAlert(`لم يبدأ الاستيراد: ${e.message}`)
    } finally {
      setBusy('')
    }
  }

  // A lost answer: the same start (same id) again, waiting longer each time; the server answers
  // with the job if it was made the first time.
  useEffect(() => {
    if (!pending) return
    let stopped = false
    let failures = 0
    let timer
    const again = async () => {
      try {
        const j = await api('imports.start', pending)
        if (!stopped) started(j)
        return
      } catch (e) {
        if (stopped) return
        if (!isTransient(e)) {
          setPending(null)
          triggerCustomAlert(`لم يبدأ الاستيراد: ${e.message}`)
          return
        }
        failures += 1
      }
      timer = setTimeout(again, pollDelay(failures))
    }
    timer = setTimeout(again, pollDelay(0))
    return () => {
      stopped = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  const downloadTemplate = async () => {
    setBusy('template')
    try {
      const blob = await writeExcelFile(templateSheets()).toBlob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'HeroMarket-data-template.xlsx'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    } catch (e) {
      triggerCustomAlert(`تعذر إنشاء القالب: ${e.message}`)
    } finally {
      setBusy('')
    }
  }

  const choose = async (e) => {
    const f = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!f) return
    setFile(f)
    setRows(null)
    setCheck(null)
    setJobErrors(null)
    if (!isOpen(job)) setJob(null)
    if (f.size > MAX_FILE_BYTES) {
      setCheck({
        ok: false,
        errors: [
          { sheet: '', row: 0, message: 'الملف أكبر من 20 ميجابايت: هذا ليس ملف قالب HeroMarket.' }
        ],
        summary: null
      })
      return
    }
    setBusy('read')
    try {
      const sheets = await readExcelFile(f)
      const parsed = readWorkbook(sheets)
      setRows(parsed)
      const any = parsed.products.length + parsed.customers.length + parsed.suppliers.length
      if (!any) {
        setCheck({ ok: false, errors: parsed.errors, summary: null })
        return
      }
      // The service checks the rows too (duplicates, existing records, kinds): show every problem
      // at once. A row with a reading problem keeps only that message.
      const server = await api('storeImport.apply', {
        products: parsed.products,
        customers: parsed.customers,
        suppliers: parsed.suppliers,
        dryRun: true
      })
      const seen = new Set(parsed.errors.map((e) => `${e.sheet}|${e.row}`))
      const errors = [
        ...parsed.errors,
        ...server.errors.filter((e) => !seen.has(`${e.sheet}|${e.row}`))
      ].sort((x, y) => x.sheet.localeCompare(y.sheet) || x.row - y.row)
      setCheck({ ok: !errors.length, errors, summary: server.summary })
    } catch (err) {
      setCheck({
        ok: false,
        errors: [{ sheet: '', row: 0, message: `تعذرت قراءة الملف: ${err.message}` }],
        summary: null
      })
    } finally {
      setBusy('')
    }
  }

  const apply = () =>
    startJob({
      id: newClientRef(),
      filename: file?.name || '',
      products: rows.products,
      customers: rows.customers,
      suppliers: rows.suppliers
    })

  const cancel = () =>
    triggerCustomConfirm(
      'إلغاء الاستيراد؟ لن يُحفظ أي شيء من هذا الملف.',
      async () => {
        try {
          follow(await api('imports.cancel', { id: job.id }))
        } catch (e) {
          triggerCustomAlert(e.message)
        }
      },
      null,
      'إلغاء الاستيراد'
    )

  const showJob = (j) => {
    setJobErrors(null)
    setContact(null)
    follow(j)
    if (!isOpen(j)) loadErrors(j)
  }

  const running = isOpen(job) || !!pending
  const s = check?.summary
  return (
    <div className="stack">
      {canExport && <ExportSection triggerCustomAlert={triggerCustomAlert} />}
      {canImport && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">
              <FileSpreadsheet size={18} aria-hidden="true" />
              استيراد بيانات المتجر من Excel
            </h2>
          </div>
          <div className="card-body stack">
            <ol className="import-steps">
              <li>
                نزّل القالب وأرسله لصاحب المحل ليملأ أوراقه: <strong>الأصناف</strong>،{' '}
                <strong>العملاء</strong>، <strong>الموردون</strong>.
              </li>
              <li>اختر الملف بعد ملئه. يُفحص كل صف قبل أي تغيير.</li>
              <li>
                إذا لم توجد أخطاء اضغط «استيراد». لا يُستورد شيء إذا كان في الملف أي خطأ. يكمل
                الاستيراد في الخادم حتى لو أُغلقت الصفحة.
              </li>
            </ol>
            <div className="row row-wrap">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={downloadTemplate}
                disabled={Boolean(busy)}
              >
                <Download size={16} aria-hidden="true" />
                تنزيل القالب
              </button>
              <label className={`btn btn-primary${busy || running ? ' is-disabled' : ''}`}>
                <Upload size={16} aria-hidden="true" />
                اختيار ملف Excel
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  hidden
                  onChange={choose}
                  disabled={Boolean(busy) || running}
                />
              </label>
              {file && <span className="text-muted">{file.name}</span>}
            </div>
            <p className="field-hint">
              الأصناف الموجودة بنفس الباركود والعملاء بنفس رقم الهاتف لا تُعدَّل؛ تظهر كأخطاء لتقرر
              ماذا تفعل بها. الصنف بدون باركود يأخذ كوداً داخلياً (HM000001…) ويُباع بالبحث بالاسم.
            </p>
          </div>
        </section>
      )}

      {busy === 'read' && <div className="loading-block">جارٍ قراءة الملف وفحصه…</div>}

      {pending && (
        <section className="card" role="status">
          <div className="card-body">
            <p className="import-contact">
              <WifiOff size={16} aria-hidden="true" /> لم يصل رد الخادم بعد إرسال الملف. ربما بدأ
              الاستيراد بالفعل؛ نتحقق تلقائياً، ولن يُستورد الملف مرتين.
            </p>
          </div>
        </section>
      )}

      {job && (
        <JobCard
          job={job}
          contact={contact}
          errors={jobErrors}
          onCancel={cancel}
          onClose={() => {
            setJob(null)
            setJobErrors(null)
            setContact(null)
          }}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}

      {check && !running && (
        <section className={`card ${check.ok ? 'tone-success' : 'tone-danger'}`} aria-live="polite">
          <div className="card-header">
            <h2 className="card-title">
              {check.ok ? (
                <CircleCheck size={18} aria-hidden="true" />
              ) : (
                <CircleAlert size={18} aria-hidden="true" />
              )}
              {check.ok ? 'الملف سليم وجاهز للاستيراد' : `في الملف ${check.errors.length} خطأ`}
            </h2>
          </div>
          <div className="card-body stack">
            {s && (
              <dl className="kv">
                <dt>الأصناف</dt>
                <dd className="num">
                  {s.products}
                  {s.withoutBarcode ? ` (منها ${s.withoutBarcode} بدون باركود)` : ''}
                </dd>
                <dt>أصناف بعبوة</dt>
                <dd className="num">{s.packages ?? 0}</dd>
                <dt>تصنيفات في الملف</dt>
                <dd className="num">{s.newCategories}</dd>
                <dt>العملاء</dt>
                <dd className="num">
                  {s.customers} — مستحق عليهم {formatMoney(s.customerDebt)} ج.م
                </dd>
                <dt>الموردون</dt>
                <dd className="num">
                  {s.suppliers} — مستحق لهم {formatMoney(s.supplierDebt)} ج.م
                </dd>
              </dl>
            )}
            {check.errors.length > 0 && <ErrorTable errors={check.errors} />}
            <div className="row row-wrap">
              {check.ok && (
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={apply}
                  disabled={Boolean(busy)}
                >
                  {busy === 'apply' ? 'جارٍ إرسال الملف…' : 'استيراد'}
                </button>
              )}
              {check.errors.length > 0 && (
                <ErrorReportButton
                  errors={check.errors}
                  name={file?.name}
                  triggerCustomAlert={triggerCustomAlert}
                />
              )}
            </div>
          </div>
        </section>
      )}

      {canImport && <HistoryCard jobs={history} onShow={showJob} />}
    </div>
  )
}
