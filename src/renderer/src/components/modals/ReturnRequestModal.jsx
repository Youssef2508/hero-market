import { useState } from 'react'
import { Undo2, Search, CircleAlert, CircleCheck, Loader2 } from 'lucide-react'
import { api, can } from '../../lib/api'
import { normalizeDigits, playSound } from '../../lib/utils'
import { formatStamp } from '../../lib/time'
import { refundText } from '../../lib/refundText'
import PasswordInput from '../auth/PasswordInput'

/**
 * Return from the till (owner decision 2026-10-14): the cashier opens the invoice by its number,
 * chooses one line and a quantity (or the whole invoice) and writes the reason; a supervisor types
 * their username and password. Users who may return directly (sales.return) skip the supervisor.
 * One request = one return, checked and applied by the service in a single transaction.
 */
const ReturnRequestModal = (props) => {
  if (!props.open) return null
  return <ReturnDialog {...props} />
}

const money = (n) => (Number(n) || 0).toFixed(2)
const remainingOf = (item) =>
  Math.round((Number(item.quantity) - (Number(item.returned_qty) || 0)) * 1000) / 1000

function ReturnDialog({ onClose, currentUser, currentShift }) {
  const direct = can(currentUser, 'sales.return')
  const [invoice, setInvoice] = useState('')
  const [sale, setSale] = useState(null)
  const [items, setItems] = useState([])
  const [mode, setMode] = useState('item') // item | whole
  const [itemId, setItemId] = useState(null)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [supUser, setSupUser] = useState('')
  const [supPassword, setSupPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (e) => {
    e?.preventDefault()
    const id = Number(normalizeDigits(invoice).replace(/[^0-9]/g, ''))
    if (!id) return
    setBusy(true)
    setError('')
    setDone('')
    try {
      const r = await api('sales.detail', { saleId: id })
      setSale(r.sale)
      setItems(r.items || [])
      const first = (r.items || []).find((i) => remainingOf(i) > 0)
      setItemId(first ? first.id : null)
      setQty(first ? '1' : '')
    } catch (err) {
      setSale(null)
      setItems([])
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const item = items.find((i) => i.id === itemId)
  const qtyNum = Number(normalizeDigits(qty).replace(',', '.'))
  const qtyOk = mode === 'whole' || (item && qtyNum > 0 && qtyNum <= remainingOf(item) + 1e-9)
  const nothingLeft = sale && items.every((i) => remainingOf(i) <= 0)
  const ready =
    sale &&
    !nothingLeft &&
    qtyOk &&
    (direct || (reason.trim().length >= 3 && supUser.trim() && supPassword))

  const submit = async (decision) => {
    if (!ready) return
    setBusy(true)
    setError('')
    setDone('')
    const common = {
      currentShiftId: currentShift?.id ?? null,
      reason: reason.trim() || undefined,
      ...(direct ? {} : { approver: { username: supUser.trim(), password: supPassword, decision } })
    }
    try {
      const r =
        mode === 'whole'
          ? await api('sales.returnEntire', { saleId: sale.id, ...common })
          : await api('sales.returnItem', { saleItemId: item.id, quantity: qtyNum, ...common })
      playSound('success')
      setDone(refundText(r))
      setSale(r.sale)
      setItems(r.items || [])
      setSupPassword('')
      setReason('')
    } catch (err) {
      playSound('error')
      setError(err.message)
      setSupPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-title"
        style={{ width: 620 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Undo2 size={22} />
          </span>
          <h2 id="return-title">مرتجع</h2>
          <p>
            {direct
              ? 'افتح الفاتورة برقمها واختر الصنف أو الفاتورة كاملة.'
              : 'افتح الفاتورة برقمها، اختر الصنف واكتب السبب. يحتاج المرتجع إلى موافقة المشرف.'}
          </p>
        </div>

        <form className="return-lookup" onSubmit={load}>
          <label className="field field-inline">
            <span className="field-label">رقم الفاتورة</span>
            <input
              className="input num"
              inputMode="numeric"
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              autoFocus
              dir="ltr"
            />
          </label>
          <button type="submit" className="btn btn-secondary" disabled={busy || !invoice.trim()}>
            <Search size={16} aria-hidden="true" />
            عرض
          </button>
        </form>

        {error && (
          <div className="notice notice-danger" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {done && (
          <div className="notice notice-success" role="status">
            <CircleCheck size={16} aria-hidden="true" />
            <span>{done}</span>
          </div>
        )}

        {sale && (
          <div className="modal-body">
            <p className="return-sale">
              فاتورة <strong className="num">#{sale.id}</strong> – {formatStamp(sale.timestamp)} –{' '}
              {sale.payment_type} – المتبقي{' '}
              <strong className="num">{money(sale.total_amount)}</strong> ج.م
              {sale.client_name ? ` – ${sale.client_name}` : ''}
            </p>
            {nothingLeft ? (
              <p className="field-hint">تم إرجاع هذه الفاتورة بالكامل.</p>
            ) : (
              <>
                <div className="segmented" role="group" aria-label="نوع المرتجع">
                  <button
                    type="button"
                    aria-pressed={mode === 'item'}
                    onClick={() => setMode('item')}
                  >
                    صنف واحد
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'whole'}
                    onClick={() => setMode('whole')}
                  >
                    الفاتورة كاملة ({money(sale.total_amount)} ج.م)
                  </button>
                </div>
                {mode === 'item' && (
                  <div className="table-wrap return-items">
                    <table className="table">
                      <thead>
                        <tr>
                          <th aria-label="اختيار" />
                          <th>الصنف</th>
                          <th>المتبقي</th>
                          <th>السعر</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((i) => {
                          const left = remainingOf(i)
                          return (
                            <tr key={i.id} className={left <= 0 ? 'is-muted' : ''}>
                              <td>
                                <input
                                  type="radio"
                                  name="return-item"
                                  disabled={left <= 0}
                                  checked={itemId === i.id}
                                  onChange={() => {
                                    setItemId(i.id)
                                    setQty(String(Math.min(1, left)))
                                  }}
                                  aria-label={i.name || i.product_barcode}
                                />
                              </td>
                              <td>{i.name || i.product_barcode}</td>
                              <td className="num">
                                {left} {i.unit_name || ''}
                              </td>
                              <td className="num">{money(i.unit_price)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {mode === 'item' && item && (
                  <label className="field field-inline">
                    <span className="field-label">الكمية المرتجعة</span>
                    <input
                      className={`input num ${qtyOk ? '' : 'input-invalid'}`}
                      inputMode="decimal"
                      dir="ltr"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                    />
                    <span className="field-hint">
                      حتى {remainingOf(item)} {item.unit_name || ''}
                    </span>
                  </label>
                )}
                <label className="field">
                  <span className="field-label">سبب المرتجع{direct ? '' : ' *'}</span>
                  <textarea
                    className="input"
                    rows={2}
                    maxLength={300}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="مثال: عبوة تالفة، منتهي الصلاحية، العميل غيّر رأيه"
                  />
                </label>
                {!direct && (
                  <div className="form-grid">
                    <label className="field">
                      <span className="field-label">اسم المشرف</span>
                      <input
                        className="input"
                        value={supUser}
                        onChange={(e) => setSupUser(e.target.value)}
                        autoComplete="off"
                        maxLength={40}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">كلمة مرور المشرف</span>
                      <PasswordInput
                        className="input"
                        value={supPassword}
                        onChange={(e) => setSupPassword(e.target.value)}
                        maxLength={128}
                      />
                    </label>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            إغلاق
          </button>
          {sale && !nothingLeft && !direct && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => submit('refuse')}
              disabled={busy || !ready}
              title="يرفض المشرف المرتجع (يُسجَّل الرفض)"
            >
              رفض المشرف
            </button>
          )}
          {sale && !nothingLeft && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={() => submit('approve')}
              disabled={busy || !ready}
            >
              {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
              {direct ? 'تنفيذ المرتجع' : 'اعتماد المشرف وتنفيذ المرتجع'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ReturnRequestModal
