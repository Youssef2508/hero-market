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
  Copy,
  AlignRight,
  AlignCenter,
  AlignLeft,
  AlignJustify,
  Bold,
  ALargeSmall,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Type,
  SeparatorHorizontal
} from 'lucide-react'
import { EmptyState } from '../ui'
import { api } from '../../lib/api'
import {
  buildReceiptLines,
  buildReceiptHtml,
  normalizeTemplate,
  defaultTemplate,
  newBlock,
  alignsFor,
  sizesFor,
  SAMPLE_RECEIPT,
  DEFAULT_LABELS,
  PAPERS,
  SEPARATORS,
  ZONES,
  BLOCK_TYPES,
  ALIGN_LABELS,
  SIZE_LABELS,
  OPTION_LABELS
} from '../../../../shared/receipt.mjs'

const NBSP = String.fromCharCode(160)
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
const ALIGN_ICONS = {
  right: AlignRight,
  center: AlignCenter,
  left: AlignLeft,
  spread: AlignJustify
}

const TAG_RE = /^\[(C|R|L|B|N|BIG|SMALL|BOX|LOGO)\]/

/** Splits the leading printer tags off a line, exactly as print_receipt.ps1 does. */
function parseLine(raw) {
  let line = raw
  const tags = new Set()
  let m
  while ((m = TAG_RE.exec(line))) {
    tags.add(m[1])
    line = line.slice(m[0].length)
  }
  return { tags, line }
}

/** Renders the printer line language as print_receipt.ps1 lays it out (alignment, weight, size, box, columns, logo). */
function ThermalPreview({ lines, paper, fontSize, logo }) {
  return (
    <div
      className={`paper paper-${paper}`}
      style={{ fontSize: `${fontSize + 3}px` }}
      aria-label="معاينة الفاتورة"
    >
      {lines.map((raw, i) => {
        const { tags, line } = parseLine(raw)
        const align = tags.has('C') ? 'center' : tags.has('L') ? 'left' : 'right'
        const big = tags.has('BIG')
        if (tags.has('LOGO')) {
          const size = tags.has('SMALL') ? 'small' : big ? 'large' : 'medium'
          return (
            <div key={i} className={`pl-logo pl-${align}`}>
              <img className={`pl-logo-${size}`} src={logo} alt="" />
            </div>
          )
        }
        if (tags.has('BOX')) {
          const boxAlign = tags.has('R') ? 'right' : tags.has('L') ? 'left' : 'center'
          return (
            <div
              key={i}
              className={`pl-box pl-${boxAlign} ${tags.has('N') ? 'is-regular' : ''} ${big ? 'is-big' : ''}`}
            >
              {line.split('~').map((t, j) => (
                <div key={j}>{t.trim()}</div>
              ))}
            </div>
          )
        }
        const bold = (tags.has('C') && !tags.has('N')) || tags.has('B')
        const weight = `${bold ? 'is-bold' : ''} ${big ? 'is-big' : ''}`
        if (line.includes('|')) {
          const parts = line.split('|')
          if (parts.length === 4) {
            return (
              <div key={i} className={`pl-row4 ${weight}`}>
                <span>{parts[0]}</span>
                <span>{parts[1]}</span>
                <span>{parts[2]}</span>
                <span>{parts[3]}</span>
              </div>
            )
          }
          return (
            <div key={i} className={`pl-row2 ${weight}`}>
              <span>{parts[0]}</span>
              <span>{parts[1]}</span>
            </div>
          )
        }
        if (/^[-=._]+$/.test(line))
          return (
            <div key={i} className="pl-sep">
              {line}
            </div>
          )
        return (
          <div key={i} className={`pl-line pl-${align} ${weight}`}>
            {line || NBSP}
          </div>
        )
      })}
    </div>
  )
}

/** One element of the receipt: where it goes, how it is aligned, and how it looks. */
function BlockRow({
  block,
  first,
  last,
  onChange,
  onMove,
  onZone,
  onRemove,
  onDragStart,
  onDragEnd,
  onDrop
}) {
  const meta = BLOCK_TYPES[block.type]
  const aligns = alignsFor(block.type)
  const sizes = sizesFor(block.type)
  const [over, setOver] = useState(false)
  const title = block.type === 'text' ? 'نص حر' : meta.label
  return (
    <li
      className={`blk ${block.visible ? '' : 'is-hidden'} ${over ? 'is-drop' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        onDrop(e.dataTransfer.getData('text/plain'), block.id)
      }}
    >
      <div className="blk-main">
        <span
          className="blk-grip"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', block.id)
            const row = e.currentTarget.closest('.blk')
            if (row) e.dataTransfer.setDragImage(row, 24, 16)
            onDragStart(block.id)
          }}
          onDragEnd={onDragEnd}
          title="اسحب لتغيير المكان"
          aria-hidden="true"
        >
          <GripVertical size={16} />
        </span>
        <label className="blk-visible" title={meta.required ? 'عنصر أساسي لا يمكن إخفاؤه' : ''}>
          <input
            type="checkbox"
            checked={block.visible}
            disabled={meta.required}
            onChange={(e) => onChange({ visible: e.target.checked })}
            aria-label={`إظهار ${title}`}
          />
          {block.type === 'text' ? null : <span className="blk-name">{title}</span>}
        </label>
        {block.type === 'text' && (
          <input
            className="input input-sm blk-text"
            value={block.text}
            maxLength={80}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="اكتب النص…"
            aria-label="نص حر"
          />
        )}
        {block.type === 'separator' && <span className="blk-name blk-muted">{meta.label}</span>}
        <span className="blk-actions">
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            onClick={() => onMove(-1)}
            disabled={first}
            aria-label={`نقل ${title} لأعلى`}
            title="لأعلى"
          >
            <ArrowUp size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            onClick={() => onMove(1)}
            disabled={last}
            aria-label={`نقل ${title} لأسفل`}
            title="لأسفل"
          >
            <ArrowDown size={14} aria-hidden="true" />
          </button>
          {meta.max && (
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              onClick={onRemove}
              aria-label={`حذف ${title}`}
              title="حذف"
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
      <div className="blk-controls">
        <select
          className="input input-sm blk-zone"
          value={block.zone}
          onChange={(e) => onZone(e.target.value)}
          aria-label={`مكان ${title}`}
        >
          {Object.entries(ZONES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {aligns.length > 0 && (
          <span className="seg" role="radiogroup" aria-label={`محاذاة ${title}`}>
            {aligns.map((a) => {
              const Icon = ALIGN_ICONS[a]
              return (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={block.align === a}
                  className={block.align === a ? 'is-on' : ''}
                  onClick={() => onChange({ align: a })}
                  title={ALIGN_LABELS[a]}
                  aria-label={ALIGN_LABELS[a]}
                >
                  <Icon size={14} aria-hidden="true" />
                </button>
              )
            })}
          </span>
        )}
        {'bold' in block && (
          <button
            type="button"
            className={`icon-btn icon-btn-sm ${block.bold ? 'is-on' : ''}`}
            aria-pressed={block.bold}
            onClick={() => onChange({ bold: !block.bold })}
            title="خط عريض"
            aria-label={`خط عريض: ${title}`}
          >
            <Bold size={14} aria-hidden="true" />
          </button>
        )}
        {sizes.length === 2 && (
          <button
            type="button"
            className={`icon-btn icon-btn-sm ${block.size === 'large' ? 'is-on' : ''}`}
            aria-pressed={block.size === 'large'}
            onClick={() => onChange({ size: block.size === 'large' ? 'normal' : 'large' })}
            title="خط كبير"
            aria-label={`خط كبير: ${title}`}
          >
            <ALargeSmall size={14} aria-hidden="true" />
          </button>
        )}
        {sizes.length === 3 && (
          <select
            className="input input-sm blk-size"
            value={block.size}
            onChange={(e) => onChange({ size: e.target.value })}
            aria-label={`حجم ${title}`}
          >
            {sizes.map((s) => (
              <option key={s} value={s}>
                {SIZE_LABELS[s]}
              </option>
            ))}
          </select>
        )}
        {Object.keys(meta.options || {}).map((k) => (
          <label key={k} className="check-row blk-option">
            <input
              type="checkbox"
              checked={!!block[k]}
              onChange={(e) => onChange({ [k]: e.target.checked })}
            />
            <span>{OPTION_LABELS[k]}</span>
          </label>
        ))}
      </div>
    </li>
  )
}

export default function ReceiptDesignerTab({ triggerCustomAlert, triggerCustomConfirm }) {
  const [templates, setTemplates] = useState([])
  const [store, setStore] = useState({})
  const [logo, setLogo] = useState('')
  const [draft, setDraft] = useState(null) // { id, name, config }
  const [savedJson, setSavedJson] = useState('')
  const [dragId, setDragId] = useState(null)
  const [dropZone, setDropZone] = useState(null)

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
        ? buildReceiptHtml(tpl, SAMPLE_RECEIPT, store, { logoDataUrl: logo || 'favicon.png' })
        : '',
    [tpl, store, logo]
  )
  const dirty =
    draft && JSON.stringify(normalizeTemplate(draft.config).value) + draft.name !== savedJson
  const activeByPaper = Object.fromEntries(
    templates.filter((t) => t.is_active).map((t) => [t.paper, t.id])
  )

  const update = (fn) => setDraft((d) => ({ ...d, config: fn(normalizeTemplate(d.config).value) }))
  const setBlocks = (fn) => update((c) => ({ ...c, blocks: fn([...c.blocks]) }))

  const changeBlock = (id, patch) =>
    setBlocks((bl) => bl.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  // Up/down inside a zone; past the first/last element the block moves into the neighbouring zone.
  const moveBlock = (id, dir) =>
    setBlocks((bl) => {
      const i = bl.findIndex((b) => b.id === id)
      const j = i + dir
      if (j < 0 || j >= bl.length) return bl
      if (bl[j].zone === bl[i].zone) [bl[i], bl[j]] = [bl[j], bl[i]]
      else {
        // Into the next zone in reading order, even when that zone is empty.
        const order = Object.keys(ZONES)
        bl[i] = { ...bl[i], zone: order[order.indexOf(bl[i].zone) + dir] }
      }
      return bl
    })
  const toZone = (id, zone) =>
    setBlocks((bl) => {
      const i = bl.findIndex((b) => b.id === id)
      const [b] = bl.splice(i, 1)
      return [...bl, { ...b, zone }]
    })
  // The dragged id travels in the drag data (state is only a fallback for older drag sources).
  const dropBefore = (draggedId, targetId) => {
    const id = draggedId || dragId
    setDragId(null)
    setDropZone(null)
    if (!id || id === targetId) return
    setBlocks((bl) => {
      const from = bl.findIndex((b) => b.id === id)
      if (from < 0) return bl
      const [b] = bl.splice(from, 1)
      const to = bl.findIndex((x) => x.id === targetId)
      bl.splice(to, 0, { ...b, zone: bl[to].zone })
      return bl
    })
  }
  const addBlock = (type, zone) =>
    setBlocks((bl) => [
      ...bl,
      newBlock(
        type,
        zone,
        bl.map((b) => b.id)
      )
    ])
  const removeBlock = (id) => setBlocks((bl) => bl.filter((b) => b.id !== id))

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

  const count = (type) => tpl.blocks.filter((b) => b.type === type).length

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
            text="اختر قالباً أو أنشئ قالباً جديداً لمقاس 58 أو 80 مم أو A4. ضع أي عنصر في أعلى الفاتورة أو وسطها أو أسفلها، يميناً أو وسطاً أو يساراً. المعاينة تعرض نفس الأسطر التي تُرسل للطابعة."
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
                  <span className="field-label">شكل الخطوط الفاصلة</span>
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

              <p className="field-hint">
                اسحب أي عنصر بالمقبض أو استخدم الأسهم لنقله، واختر مكانه (أعلى / وسط / أسفل)
                ومحاذاته (يمين / وسط / يسار). العناصر غير المحددة لا تُطبع.
              </p>

              {Object.entries(ZONES).map(([zone, zoneTitle]) => {
                const zoneBlocks = tpl.blocks.filter((b) => b.zone === zone)
                return (
                  <section
                    key={zone}
                    className={`zone ${dropZone === zone ? 'is-drop' : ''}`}
                    aria-label={zoneTitle}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDropZone(zone)
                    }}
                    onDragLeave={() => setDropZone(null)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDropZone(null)
                      const id = e.dataTransfer.getData('text/plain') || dragId
                      if (id && tpl.blocks.some((b) => b.id === id)) toZone(id, zone)
                      setDragId(null)
                    }}
                  >
                    <header className="zone-head">
                      <h3>{zoneTitle}</h3>
                      <span className="row">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => addBlock('text', zone)}
                          disabled={count('text') >= BLOCK_TYPES.text.max}
                        >
                          <Type size={13} aria-hidden="true" />
                          نص
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => addBlock('separator', zone)}
                          disabled={count('separator') >= BLOCK_TYPES.separator.max}
                        >
                          <SeparatorHorizontal size={13} aria-hidden="true" />
                          فاصل
                        </button>
                      </span>
                    </header>
                    {zoneBlocks.length === 0 ? (
                      <p className="zone-empty">اسحب عنصراً إلى هنا أو أضف نصاً.</p>
                    ) : (
                      <ul className="zone-list">
                        {zoneBlocks.map((b) => {
                          const index = tpl.blocks.indexOf(b)
                          return (
                            <BlockRow
                              key={b.id}
                              block={b}
                              first={index === 0}
                              last={index === tpl.blocks.length - 1}
                              onChange={(patch) => changeBlock(b.id, patch)}
                              onMove={(dir) => moveBlock(b.id, dir)}
                              onZone={(z) => toZone(b.id, z)}
                              onRemove={() => removeBlock(b.id)}
                              onDragStart={setDragId}
                              onDragEnd={() => {
                                setDragId(null)
                                setDropZone(null)
                              }}
                              onDrop={dropBefore}
                            />
                          )
                        })}
                      </ul>
                    )}
                  </section>
                )
              })}

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
                  logo={logo || 'favicon.png'}
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
