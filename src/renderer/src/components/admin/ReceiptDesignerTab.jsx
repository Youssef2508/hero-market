import { useEffect, useMemo, useState } from 'react'
import {
  ReceiptText,
  Plus,
  Save,
  Printer,
  FileDown,
  CheckCircle2,
  RotateCcw,
  Trash2,
  Copy
} from 'lucide-react'
import { EmptyState } from '../ui'
import { api } from '../../lib/api'
import {
  buildReceiptLines,
  buildReceiptHtml,
  normalizeTemplate,
  defaultTemplate,
  SAMPLE_RECEIPT,
  DEFAULT_LABELS,
  PAPERS,
  SEPARATORS
} from '../../../../shared/receipt.mjs'

const TOGGLES = [
  ['header', 'showLogo', 'الشعار'],
  ['header', 'showStoreName', 'اسم المتجر'],
  ['header', 'showBranch', 'اسم الفرع'],
  ['header', 'showAddress', 'عنوان المتجر'],
  ['header', 'showPhone', 'هاتف المتجر'],
  ['header', 'showTitle', 'عنوان المستند'],
  ['info', 'showInvoiceNo', 'رقم الفاتورة'],
  ['info', 'showDate', 'التاريخ'],
  ['info', 'showTime', 'الوقت'],
  ['info', 'showCashier', 'الكاشير'],
  ['info', 'showPaymentType', 'طريقة الدفع'],
  ['info', 'showCustomer', 'العميل'],
  ['info', 'showCustomerPhone', 'هاتف العميل'],
  ['info', 'showCustomerAddress', 'عنوان العميل'],
  ['items', 'showUnitPrice', 'سعر الوحدة'],
  ['items', 'showBarcode', 'باركود الصنف'],
  ['totals', 'showItemCount', 'عدد الأصناف'],
  ['totals', 'showSubtotal', 'المجموع قبل الخصم'],
  ['totals', 'showDiscount', 'الخصم'],
  ['totals', 'showPaid', 'المدفوع'],
  ['totals', 'showChange', 'الباقي'],
  ['totals', 'boldTotal', 'إجمالي بخط عريض'],
  ['footer', 'showStoreName', 'اسم المتجر في التذييل']
]
const NBSP = String.fromCharCode(160)
const GROUP_TITLES = {
  header: 'رأس الفاتورة',
  info: 'بيانات العملية',
  items: 'الأصناف',
  totals: 'الإجماليات',
  footer: 'التذييل'
}
const LABEL_TITLES = {
  title: 'عنوان المستند',
  invoiceNo: 'رقم الفاتورة',
  date: 'التاريخ',
  time: 'الوقت',
  cashier: 'الكاشير',
  customer: 'العميل',
  phone: 'الهاتف',
  address: 'العنوان',
  item: 'عمود الصنف',
  qty: 'عمود الكمية',
  price: 'عمود السعر',
  lineTotal: 'عمود الإجمالي',
  subtotal: 'المجموع',
  total: 'الإجمالي',
  discount: 'الخصم',
  paid: 'المدفوع',
  change: 'الباقي',
  paymentType: 'طريقة الدفع',
  itemCount: 'عدد الأصناف',
  currency: 'العملة'
}

/** Renders the printer line language exactly as print_receipt.ps1 lays it out (alignment, box, columns, bold). */
function ThermalPreview({ lines, paper, fontSize, logo }) {
  return (
    <div
      className={`paper paper-${paper}`}
      style={{ fontSize: `${fontSize + 3}px` }}
      aria-label="معاينة الفاتورة"
    >
      {logo && <img className="paper-logo" src={logo} alt="" />}
      {lines.map((raw, i) => {
        let line = raw
        let bold = false
        if (line.startsWith('[B]')) {
          bold = true
          line = line.slice(3)
        }
        if (line.startsWith('[BOX]')) {
          return (
            <div key={i} className="pl-box">
              {line
                .slice(5)
                .split('~')
                .map((t, j) => (
                  <div key={j}>{t.trim()}</div>
                ))}
            </div>
          )
        }
        if (line.includes('|')) {
          const parts = line.split('|')
          if (parts.length === 4) {
            return (
              <div key={i} className="pl-row4">
                <span>{parts[0]}</span>
                <span>{parts[1]}</span>
                <span>{parts[2]}</span>
                <span>{parts[3]}</span>
              </div>
            )
          }
          return (
            <div key={i} className={`pl-row2 ${bold ? 'is-bold' : ''}`}>
              <span>{parts[0]}</span>
              <span>{parts[1]}</span>
            </div>
          )
        }
        if (line.startsWith('[C]'))
          return (
            <div key={i} className="pl-center">
              {line.slice(3)}
            </div>
          )
        if (line.startsWith('[L]'))
          return (
            <div key={i} className="pl-left">
              {line.slice(3)}
            </div>
          )
        if (line.startsWith('[R]')) line = line.slice(3)
        if (/^[-=._]+$/.test(line))
          return (
            <div key={i} className="pl-sep">
              {line}
            </div>
          )
        return (
          <div key={i} className="pl-right">
            {line || NBSP}
          </div>
        )
      })}
    </div>
  )
}

export default function ReceiptDesignerTab({ triggerCustomAlert, triggerCustomConfirm }) {
  const [templates, setTemplates] = useState([])
  const [store, setStore] = useState({})
  const [logo, setLogo] = useState('')
  const [draft, setDraft] = useState(null) // { id, name, config }
  const [savedJson, setSavedJson] = useState('')

  const load = async (selectId) => {
    try {
      const [list, pub] = await Promise.all([api('receipts.list'), api('settings.public')])
      setTemplates(list.templates)
      const s = pub.settings
      setStore({
        name: s.store_name,
        branch: s.branch_name,
        address: s.store_address,
        phone: s.store_phone
      })
      setLogo(s.store_logo || '')
      const pick = list.templates.find((t) => t.id === selectId)
      if (pick) {
        setDraft({ id: pick.id, name: pick.name, config: pick.config })
        setSavedJson(JSON.stringify(pick.config) + pick.name)
      }
    } catch (e) {
      triggerCustomAlert(e.message)
    }
  }
  useEffect(() => {
    load()
  }, [])

  const tpl = useMemo(() => (draft ? normalizeTemplate(draft.config).value : null), [draft])
  const lines = useMemo(
    () => (tpl && tpl.paper !== 'A4' ? buildReceiptLines(tpl, SAMPLE_RECEIPT, store) : []),
    [tpl, store]
  )
  const a4Html = useMemo(
    () =>
      tpl && tpl.paper === 'A4'
        ? buildReceiptHtml(tpl, SAMPLE_RECEIPT, store, { logoDataUrl: logo })
        : '',
    [tpl, store, logo]
  )
  const dirty = draft && JSON.stringify(draft.config) + draft.name !== savedJson
  const activeByPaper = Object.fromEntries(
    templates.filter((t) => t.is_active).map((t) => [t.paper, t.id])
  )

  const update = (fn) => setDraft((d) => ({ ...d, config: fn(normalizeTemplate(d.config).value) }))
  const setFlag = (group, key, v) => update((c) => ({ ...c, [group]: { ...c[group], [key]: v } }))

  const startNew = (paper) => {
    setDraft({ id: null, name: `قالب ${PAPERS[paper].label}`, config: defaultTemplate(paper) })
    setSavedJson('')
  }

  const save = async () => {
    const n = normalizeTemplate(draft.config)
    if (!n.ok) return triggerCustomAlert(n.errors.join('\n'))
    try {
      const row = await api('receipts.save', { id: draft.id, name: draft.name, config: n.value })
      await load(row.id)
      triggerCustomAlert('تم حفظ القالب.', 'تم الحفظ')
    } catch (e) {
      triggerCustomAlert(e.message)
    }
  }

  const activate = async () => {
    try {
      await api('receipts.activate', { id: draft.id })
      await load(draft.id)
      triggerCustomAlert(`أصبح هذا القالب المعتمد لورق ${PAPERS[tpl.paper].label}.`, 'تم الاعتماد')
    } catch (e) {
      triggerCustomAlert(e.message)
    }
  }

  const restoreDefault = (paper) =>
    triggerCustomConfirm(`العودة إلى القالب الافتراضي لورق ${PAPERS[paper].label}؟`, async () => {
      try {
        await api('receipts.restoreDefault', { paper })
        await load(draft?.id)
      } catch (e) {
        triggerCustomAlert(e.message)
      }
    })

  const remove = () =>
    triggerCustomConfirm(`حذف القالب "${draft.name}"؟`, async () => {
      try {
        await api('receipts.delete', { id: draft.id })
        setDraft(null)
        await load(null)
      } catch (e) {
        triggerCustomAlert(e.message)
      }
    })

  const testPrint = async () => {
    try {
      if (tpl.paper === 'A4') {
        const r = await window.api.printer.saleToPdf(SAMPLE_RECEIPT, tpl)
        if (r && r.success) triggerCustomAlert(`تم حفظ ملف PDF:\n${r.filePath}`, 'تم التصدير')
      } else {
        await window.api.printer.testTemplate(tpl, SAMPLE_RECEIPT)
        triggerCustomAlert('تم إرسال فاتورة تجريبية إلى الطابعة.', 'طباعة تجريبية')
      }
    } catch (e) {
      triggerCustomAlert(`فشلت الطباعة التجريبية: ${e.message}`)
    }
  }

  return (
    <div className="designer">
      <aside className="card designer-list">
        <div className="card-header">
          <h2 className="card-title">
            <ReceiptText size={18} aria-hidden="true" />
            القوالب
          </h2>
        </div>
        {Object.entries(PAPERS).map(([paper, info]) => (
          <div key={paper} className="designer-paper">
            <div className="designer-paper-head">
              <strong>{info.label}</strong>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => startNew(paper)}
                aria-label={`قالب جديد ${info.label}`}
              >
                <Plus size={14} aria-hidden="true" />
                جديد
              </button>
            </div>
            <ul>
              <li>
                <span
                  className={`designer-item is-static ${!activeByPaper[paper] ? 'is-active-template' : ''}`}
                >
                  الافتراضي{' '}
                  {!activeByPaper[paper] && <span className="badge badge-success">معتمد</span>}
                  {activeByPaper[paper] && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => restoreDefault(paper)}
                    >
                      <RotateCcw size={13} aria-hidden="true" />
                      اعتماد
                    </button>
                  )}
                </span>
              </li>
              {templates
                .filter((t) => t.paper === paper)
                .map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`designer-item ${draft?.id === t.id ? 'is-selected' : ''}`}
                      onClick={() => {
                        setDraft({ id: t.id, name: t.name, config: t.config })
                        setSavedJson(JSON.stringify(t.config) + t.name)
                      }}
                    >
                      {t.name} {t.is_active && <span className="badge badge-success">معتمد</span>}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </aside>

      {!draft ? (
        <section className="card designer-empty">
          <EmptyState
            icon={ReceiptText}
            title="صمّم فاتورتك"
            text="اختر قالباً أو أنشئ قالباً جديداً لمقاس 58 أو 80 مم أو A4. المعاينة تعرض نفس الأسطر التي تُرسل للطابعة."
          />
        </section>
      ) : (
        <>
          <section className="card designer-editor">
            <div className="card-header">
              <input
                className="input designer-name"
                value={draft.name}
                maxLength={60}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                aria-label="اسم القالب"
              />
              <div className="row">
                {draft.id && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setDraft({ ...draft, id: null, name: `${draft.name} (نسخة)` })}
                  >
                    <Copy size={15} aria-hidden="true" />
                    نسخ
                  </button>
                )}
                {draft.id && !templates.find((t) => t.id === draft.id)?.is_active && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={remove}>
                    <Trash2 size={15} aria-hidden="true" />
                    حذف
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={save}
                  disabled={!dirty}
                >
                  <Save size={15} aria-hidden="true" />
                  حفظ
                </button>
              </div>
            </div>
            <div className="card-body designer-form">
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">مقاس الورق</span>
                  <select
                    className="input"
                    value={tpl.paper}
                    onChange={(e) => update((c) => ({ ...c, paper: e.target.value }))}
                  >
                    {Object.entries(PAPERS).map(([k, p]) => (
                      <option key={k} value={k}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">
                    حجم الخط <span className="num">{tpl.style.fontSize}</span>
                  </span>
                  <input
                    type="range"
                    min="7"
                    max="11"
                    step="1"
                    value={tpl.style.fontSize}
                    onChange={(e) =>
                      update((c) => ({
                        ...c,
                        style: { ...c.style, fontSize: Number(e.target.value) }
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field-label">الفواصل</span>
                  <select
                    className="input"
                    value={tpl.style.separator}
                    onChange={(e) =>
                      update((c) => ({ ...c, style: { ...c.style, separator: e.target.value } }))
                    }
                  >
                    {Object.keys(SEPARATORS).map((k) => (
                      <option key={k} value={k}>
                        {
                          {
                            dashed: 'خط متقطع ----',
                            double: 'خط مزدوج ====',
                            dotted: 'نقاط ....',
                            none: 'بدون فواصل'
                          }[k]
                        }
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {Object.entries(GROUP_TITLES).map(([group, title]) => (
                <fieldset key={group} className="designer-group">
                  <legend>{title}</legend>
                  <div className="designer-toggles">
                    {TOGGLES.filter(([g]) => g === group).map(([g, key, label]) => (
                      <label key={key} className="check-row">
                        <input
                          type="checkbox"
                          checked={!!tpl[g][key]}
                          onChange={(e) => setFlag(g, key, e.target.checked)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  {group === 'header' && (
                    <label className="field">
                      <span className="field-label">أسطر إضافية في الرأس (حتى 3)</span>
                      <textarea
                        className="input"
                        rows={2}
                        value={(draft.config.header?.extraLines || []).join('\n')}
                        onChange={(e) =>
                          update((c) => ({
                            ...c,
                            header: {
                              ...c.header,
                              extraLines: e.target.value.split('\n').slice(0, 3)
                            }
                          }))
                        }
                        placeholder="مثال: الرقم الضريبي 123-456"
                      />
                    </label>
                  )}
                  {group === 'footer' && (
                    <label className="field">
                      <span className="field-label">نص التذييل (حتى 4 أسطر)</span>
                      <textarea
                        className="input"
                        rows={3}
                        value={(draft.config.footer?.lines || []).join('\n')}
                        onChange={(e) =>
                          update((c) => ({
                            ...c,
                            footer: { ...c.footer, lines: e.target.value.split('\n').slice(0, 4) }
                          }))
                        }
                      />
                    </label>
                  )}
                </fieldset>
              ))}

              <details className="designer-group">
                <summary>تسميات الحقول</summary>
                <div className="form-grid">
                  {Object.keys(DEFAULT_LABELS).map((k) => (
                    <label key={k} className="field">
                      <span className="field-label">{LABEL_TITLES[k] || k}</span>
                      <input
                        className="input"
                        maxLength={30}
                        value={tpl.labels[k]}
                        onChange={(e) =>
                          update((c) => ({ ...c, labels: { ...c.labels, [k]: e.target.value } }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
            </div>
          </section>

          <section className="card designer-preview">
            <div className="card-header">
              <h2 className="card-title">المعاينة</h2>
              <div className="row">
                {draft.id && activeByPaper[tpl.paper] !== draft.id && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={activate}
                    disabled={dirty}
                    title={dirty ? 'احفظ القالب أولاً' : ''}
                  >
                    <CheckCircle2 size={15} aria-hidden="true" />
                    اعتماد
                  </button>
                )}
                <button type="button" className="btn btn-secondary btn-sm" onClick={testPrint}>
                  {tpl.paper === 'A4' ? (
                    <FileDown size={15} aria-hidden="true" />
                  ) : (
                    <Printer size={15} aria-hidden="true" />
                  )}
                  {tpl.paper === 'A4' ? 'تصدير PDF تجريبي' : 'طباعة تجريبية'}
                </button>
              </div>
            </div>
            <div className="card-body designer-preview-body">
              {tpl.paper === 'A4' ? (
                <iframe className="a4-preview" title="معاينة A4" sandbox="" srcDoc={a4Html} />
              ) : (
                <ThermalPreview
                  lines={lines}
                  paper={tpl.paper}
                  fontSize={tpl.style.fontSize}
                  logo={tpl.header.showLogo ? logo || 'favicon.png' : ''}
                />
              )}
              <p className="field-hint">
                بيانات تجريبية. القالب لا يغيّر أسعار أو إجماليات الفاتورة؛ يغيّر شكلها فقط.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
