import { useState } from 'react'
import { FileSpreadsheet, Download, Upload, CircleCheck, CircleAlert } from 'lucide-react'
import readExcelFile from 'read-excel-file/browser'
import writeExcelFile from 'write-excel-file/browser'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { readWorkbook, templateSheets } from '../../../../shared/storeImport.mjs'

const SHOWN_ERRORS = 300

// Import of the store's data from the HeroMarket Excel template (1.4.0): products with stock and
// categories, customers and suppliers with their balances. The file is read here; the service
// checks every row and writes nothing unless all rows are valid (storeImport.apply).
export default function ImportTab({ triggerCustomAlert }) {
  const [file, setFile] = useState(null)
  const [rows, setRows] = useState(null)
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState(null)

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
    setDone(null)
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

  const apply = async () => {
    setBusy('apply')
    try {
      const r = await api('storeImport.apply', {
        products: rows.products,
        customers: rows.customers,
        suppliers: rows.suppliers
      })
      if (r.ok) {
        setDone(r.summary)
        setCheck(null)
        setRows(null)
        setFile(null)
      } else setCheck(r)
    } catch (err) {
      triggerCustomAlert(`لم يتم الاستيراد: ${err.message}`)
    } finally {
      setBusy('')
    }
  }

  const s = check?.summary
  return (
    <div className="stack">
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
            <li>إذا لم توجد أخطاء اضغط «استيراد». لا يُستورد شيء إذا كان في الملف أي خطأ.</li>
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
            <label className={`btn btn-primary${busy ? ' is-disabled' : ''}`}>
              <Upload size={16} aria-hidden="true" />
              اختيار ملف Excel
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={choose}
                disabled={Boolean(busy)}
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

      {busy === 'read' && <div className="loading-block">جارٍ قراءة الملف وفحصه…</div>}

      {check && (
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
            {check.errors.length > 0 && (
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
                    {check.errors.slice(0, SHOWN_ERRORS).map((e, i) => (
                      <tr key={i}>
                        <td>{e.sheet}</td>
                        <td className="num">{e.row || ''}</td>
                        <td>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {check.errors.length > SHOWN_ERRORS && (
                  <p className="text-muted">
                    يظهر أول {SHOWN_ERRORS} خطأ فقط. صححها واختر الملف مرة أخرى.
                  </p>
                )}
              </div>
            )}
            {check.ok && (
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={apply}
                  disabled={Boolean(busy)}
                >
                  {busy === 'apply' ? 'جارٍ الاستيراد…' : 'استيراد'}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {done && (
        <section className="card tone-success" role="status">
          <div className="card-body">
            <p>
              <CircleCheck size={16} aria-hidden="true" /> تم الاستيراد:{' '}
              <span className="num">{done.products}</span> صنف،{' '}
              <span className="num">{done.customers}</span> عميل،{' '}
              <span className="num">{done.suppliers}</span> مورد. راجع الأصناف والعملاء ثم ابدأ
              البيع.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
