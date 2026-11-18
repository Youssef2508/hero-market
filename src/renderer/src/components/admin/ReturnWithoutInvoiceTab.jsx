import { useEffect, useRef, useState } from 'react'
import { PackageOpen, ScanBarcode, Trash2, Undo2, Search } from 'lucide-react'
import { api, can, newClientRef } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { kindInfo } from '../../lib/measureKinds'
import { qtyFromText } from '../../lib/qtyText'
import { EmptyState } from '../ui'

const money = (n) => formatMoney(n)

/** Why a typed quantity does not suit a line (its kind and unit), or ''. */
function qtyProblem(line, text) {
  const { value } = qtyFromText(text)
  if (value === null) return 'اكتب كمية صحيحة أكبر من صفر.'
  const q = Number(value)
  const decimals = kindInfo(line.kind).decimals
  const base = q * (Number(line.factor) || 1)
  const fits = (n, d) => Math.abs(n * 10 ** d - Math.round(n * 10 ** d)) < 1e-6
  if (!fits(q, 3)) return 'الكمية تقبل ثلاث خانات عشرية على الأكثر.'
  if (!fits(base, decimals))
    return decimals === 0
      ? `«${line.name}» يباع بالعدد: اكتب عدداً صحيحاً.`
      : `الكمية تقبل ${decimals} خانات عشرية على الأكثر.`
  return ''
}

/**
 * «مرتجع بدون فاتورة» (owner, 1.9.0, D-116): a trusted customer brings goods back without the
 * receipt. Like the till in reverse, and from the keyboard alone: scan or type each product, its
 * quantity (Enter goes back to the product field), the customer if known, the reason, then confirm.
 * Each line is priced at the product's selling price now; the refund is paid in cash from the
 * cashier's own open shift and the goods go back into stock (sales.returnWithoutInvoice).
 */
export default function ReturnWithoutInvoiceTab({
  currentUser,
  currentShift,
  onOpenShift,
  triggerCustomConfirm
}) {
  const [lines, setLines] = useState([])
  const [code, setCode] = useState('')
  const [matches, setMatches] = useState([])
  const [active, setActive] = useState(-1)
  const [client, setClient] = useState(null)
  const [clientText, setClientText] = useState('')
  const [clients, setClients] = useState([])
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [recent, setRecent] = useState(null)
  const codeRef = useRef(null)
  const qtyRefs = useRef({})
  // One request id per return, kept across retries of the same one (a lost reply, a second press).
  const ref = useRef(newClientRef())
  const focusQty = useRef(null)

  const loadRecent = () =>
    api('sales.returnsWithoutInvoice', {})
      .then(setRecent)
      .catch(() => setRecent(null))
  useEffect(() => {
    codeRef.current?.focus()
    loadRecent()
  }, [])

  // The quantity of the line just added: selected, ready to type over.
  useEffect(() => {
    const key = focusQty.current
    if (!key) return
    focusQty.current = null
    const el = qtyRefs.current[key]
    if (el) {
      el.focus()
      el.select()
    }
  })

  const total =
    Math.round(lines.reduce((a, l) => a + l.price * (Number(l.qty) || 0), 0) * 100) / 100

  const addResolved = (r) => {
    const key = `${r.product.barcode}|${r.unit.id ?? ''}`
    const decimals = kindInfo(r.product.unit_kind || 'count').decimals
    setLines((prev) => {
      const at = prev.find((l) => l.key === key)
      if (at) {
        const qty = String(Math.round((Number(at.qty) + Number(r.qty ?? 1)) * 1000) / 1000)
        return prev.map((l) => (l.key === key ? { ...l, qty } : l))
      }
      return [
        ...prev,
        {
          key,
          barcode: r.product.barcode,
          name: r.product.name,
          unitId: r.unit.id ?? null,
          unitName: r.unit.name || r.product.unit || '',
          factor: Number(r.unit.factor) || 1,
          kind: r.product.unit_kind || 'count',
          price: Number(r.unit.price) || 0,
          // A scale label carries the weight; a product sold by weight otherwise waits for it.
          qty: r.qty != null ? String(r.qty) : decimals > 0 && !r.unit.id ? '' : '1'
        }
      ]
    })
    focusQty.current = key
    setCode('')
    setMatches([])
    setActive(-1)
    setError('')
  }

  const lookUp = async () => {
    const text = code.trim()
    if (!text) return
    try {
      const r = await api('pos.resolve', { code: text })
      if (r) return addResolved(r)
      const found = await api('pos.searchProducts', { term: text })
      if (found.length === 1)
        return addResolved(await api('pos.resolve', { code: found[0].barcode }))
      if (found.length > 1) {
        setMatches(found)
        setActive(0)
        return
      }
      setError(`لا يوجد صنف بالكود أو الاسم «${text}».`)
    } catch (e) {
      setError(e.message)
    }
  }

  const pick = async (p) => {
    try {
      addResolved(await api('pos.resolve', { code: p.barcode }))
    } catch (e) {
      setError(e.message)
    }
  }

  const onCodeKey = (e) => {
    if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setActive((i) =>
        e.key === 'ArrowDown' ? Math.min(matches.length - 1, i + 1) : Math.max(0, i - 1)
      )
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (matches.length && active >= 0) pick(matches[active])
      else lookUp()
    } else if (e.key === 'Escape' && (code || matches.length)) {
      e.preventDefault()
      setCode('')
      setMatches([])
    }
  }

  const searchClients = async (text) => {
    setClientText(text)
    setClient(null)
    if (!text.trim()) return setClients([])
    try {
      setClients(await api('pos.searchClients', { term: text }))
    } catch {
      setClients([])
    }
  }

  const problems = lines.map((l) => qtyProblem(l, l.qty)).filter(Boolean)
  const ready = lines.length > 0 && !problems.length && total > 0

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      const doc = await api('sales.returnWithoutInvoice', {
        clientRef: ref.current,
        lines: lines.map((l) => ({
          barcode: l.barcode,
          unitId: l.unitId,
          quantity: Number(qtyFromText(l.qty).value)
        })),
        clientId: client?.id ?? null,
        reason: reason.trim(),
        currentShiftId: currentShift?.id ?? null
      })
      setDone(doc)
      setLines([])
      setClient(null)
      setClientText('')
      setReason('')
      ref.current = newClientRef()
      loadRecent()
      setTimeout(() => codeRef.current?.focus(), 0)
    } catch (e) {
      // Not saved: the same request id is kept, so pressing again never pays twice.
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const confirm = () => {
    if (!ready) {
      setError(!lines.length ? 'أضف صنفاً واحداً على الأقل.' : problems[0] || 'قيمة المرتجع صفر.')
      return
    }
    triggerCustomConfirm(
      `صرف ${money(total)} ج.م نقداً من درج ورديتك للعميل${client ? ` ${client.name}` : ''}، وإرجاع ${lines.length} صنف إلى المخزون؟`,
      submit,
      null,
      'تأكيد المرتجع بدون فاتورة'
    )
  }

  if (!currentShift?.id)
    return (
      <section className="card">
        <EmptyState
          icon={Undo2}
          title="افتح ورديتك أولاً"
          text="قيمة المرتجع بدون فاتورة تُصرف نقداً من درج ورديتك المفتوحة."
        />
        <div className="card-body">
          <button type="button" className="btn btn-primary" onClick={onOpenShift}>
            فتح وردية
          </button>
        </div>
      </section>
    )

  return (
    <div className="return-no-invoice">
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Undo2 size={18} aria-hidden="true" />
            مرتجع بدون فاتورة
          </h2>
          <span className="text-muted">
            لعميل موثوق بدون فاتورة البيع. يُحسب بسعر البيع الحالي.
          </span>
        </div>
        <div className="card-body">
          <label className="field">
            <span className="field-label">
              الصنف: امسح الباركود أو اكتب الكود أو الاسم ثم Enter
            </span>
            <div className="search-field">
              <ScanBarcode size={16} aria-hidden="true" />
              <input
                ref={codeRef}
                className="input"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value)
                  setError('')
                }}
                onKeyDown={onCodeKey}
                role="combobox"
                aria-expanded={matches.length > 0}
                aria-controls="rni-matches"
                aria-activedescendant={active >= 0 ? `rni-match-${active}` : undefined}
                aria-label="الصنف المرتجع: باركود أو اسم"
                autoComplete="off"
                data-testid="rni-code"
              />
            </div>
          </label>
          {matches.length > 0 && (
            <ul className="dropdown-list" id="rni-matches" role="listbox">
              {matches.map((m, i) => (
                <li
                  key={m.barcode}
                  id={`rni-match-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`dropdown-item ${i === active ? 'is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(m)}
                >
                  <span>{m.name}</span>
                  <span className="mono">{m.barcode}</span>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {lines.length === 0 ? (
            <EmptyState icon={PackageOpen} title="لا أصناف بعد" text="امسح أول صنف يعيده العميل." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>سعر البيع الحالي</th>
                  <th>الكمية</th>
                  <th>القيمة</th>
                  <th>
                    <span className="visually-hidden">حذف</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const why = qtyProblem(l, l.qty)
                  return (
                    <tr key={l.key}>
                      <td>
                        {l.name}
                        {l.unitId ? ` (${l.unitName})` : ''}
                        <span className="line-code mono"> {l.barcode}</span>
                      </td>
                      <td className="money">{money(l.price)}</td>
                      <td>
                        <input
                          ref={(el) => (qtyRefs.current[l.key] = el)}
                          className="input num rni-qty"
                          inputMode="decimal"
                          value={l.qty}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x))
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return
                            e.preventDefault()
                            if (qtyProblem(l, l.qty)) return e.target.select()
                            codeRef.current?.focus()
                          }}
                          aria-label={`كمية ${l.name} (${l.unitName || kindInfo(l.kind).unit || ''})`}
                          aria-invalid={!!why}
                        />
                        <span className="line-unit">{l.unitName}</span>
                        {why && (
                          <span className="qty-error" role="alert">
                            {why}
                          </span>
                        )}
                      </td>
                      <td className="money">
                        {money(l.price * (Number(qtyFromText(l.qty).value) || 0))}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                          aria-label={`حذف ${l.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-body form-grid">
          <label className="field">
            <span className="field-label">العميل (اختياري)</span>
            <div className="search-field">
              <Search size={15} aria-hidden="true" />
              <input
                className="input"
                value={clientText}
                onChange={(e) => searchClients(e.target.value)}
                aria-label="العميل: الاسم أو الهاتف"
                autoComplete="off"
              />
            </div>
          </label>
          {clients.length > 0 && !client && (
            <ul className="dropdown-list" role="listbox" aria-label="العملاء المطابقون">
              {clients.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => {
                      setClient(c)
                      setClientText(c.name)
                      setClients([])
                    }}
                  >
                    {c.name} {c.phone ? `– ${c.phone}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="field">
            <span className="field-label">السبب (اختياري)</span>
            <input
              className="input"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثلاً: عميل معروف، الصنف سليم في عبوته"
              aria-label="سبب المرتجع"
            />
          </label>
          <div className="rni-total" aria-live="polite">
            <span>قيمة المرتجع (تُصرف نقداً)</span>
            <strong className="money">{money(total)} ج.م</strong>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={confirm}
            disabled={busy}
            data-testid="rni-confirm"
          >
            صرف {money(total)} ج.م وإتمام المرتجع
          </button>
        </div>
      </section>

      {done && (
        <section className="card" role="status">
          <div className="card-body">
            <strong>
              تم المرتجع بدون فاتورة #{done.id}: صُرف {money(done.total)} ج.م ورجعت{' '}
              {done.items.length} أصناف إلى المخزون.
            </strong>
          </div>
        </section>
      )}

      {recent &&
        (can(currentUser, 'sales.return_without_invoice') ||
          can(currentUser, 'sales.view_all')) && (
          <section className="card">
            <div className="card-header">
              <h3 className="card-title">آخر المرتجعات بدون فاتورة</h3>
            </div>
            <div className="card-body">
              {recent.rows.length === 0 ? (
                <p className="text-muted">لا يوجد بعد.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>الوقت</th>
                      <th>المستخدم</th>
                      <th>العميل</th>
                      <th>الأصناف</th>
                      <th>القيمة</th>
                      <th>السبب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="num">{r.id}</td>
                        <td className="num">
                          {new Date(r.createdAt).toLocaleString('ar-EG', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                            hour12: true
                          })}
                        </td>
                        <td>{r.username}</td>
                        <td>{r.clientName || '—'}</td>
                        <td className="num">{r.lines}</td>
                        <td className="money">{money(r.total)}</td>
                        <td>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        )}
    </div>
  )
}
