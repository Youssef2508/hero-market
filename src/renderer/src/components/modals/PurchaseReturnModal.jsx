import { useEffect, useState } from 'react'
import { PackageMinus } from 'lucide-react'
import { api, newClientRef } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import PaymentMethodSelect from '../admin/PaymentMethodSelect'
import PaymentDestination from '../admin/PaymentDestination'
import { fixedDestination } from '../../lib/destination'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * Return goods of a recorded purchase to its supplier (owner, 2026-10-22, D-066), in parts. Stock
 * leaves at the cost it was bought at; the supplier is credited the lines' value × net ÷ gross (an
 * invoice discount is never credited twice). Money is recorded only if the supplier gives it back
 * now, by its method; otherwise the supplier owes it. One request id: a retry does nothing twice.
 */
export default function PurchaseReturnModal({
  purchase,
  currentUser,
  currentShift,
  onClose,
  onDone,
  triggerCustomAlert
}) {
  const [detail, setDetail] = useState(null)
  const [qty, setQty] = useState({})
  const [refunded, setRefunded] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [clientRef] = useState(newClientRef)
  const [busy, setBusy] = useState(false)
  const fixed = fixedDestination(currentUser, currentShift)

  useEffect(() => {
    api('suppliers.purchaseDetail', { purchaseId: purchase.id })
      .then(setDetail)
      .catch((err) => triggerCustomAlert?.('تعذّر تحميل الفاتورة: ' + err.message))
  }, [purchase.id, triggerCustomAlert])

  const p = detail?.purchase
  const ratio = p && p.gross > 0 ? p.total_amount / p.gross : 1
  const picked = (detail?.items || [])
    .map((l) => ({ ...l, q: parseFloat(qty[l.id]) || 0 }))
    .filter((l) => l.q > 0)
  const value = r2(picked.reduce((a, l) => a + r2(l.q * l.unit_cost), 0))
  const credit = r2(value * ratio)
  const over = picked.find((l) => l.q > l.qty - l.returned + 1e-9)

  const save = async (e) => {
    e.preventDefault()
    if (!picked.length || over || !refunded) return
    setBusy(true)
    try {
      const refund = refunded === 'yes' ? r2(amount) : 0
      const dest = refund > 0 ? fixed || destination : undefined
      const res = await api('suppliers.returnPurchase', {
        purchaseId: purchase.id,
        items: picked.map((l) => ({ purchaseItemId: l.id, qty: l.q })),
        refundAmount: refund,
        method,
        destination: dest,
        currentShiftId: dest === 'shift' && currentShift ? currentShift.id : null,
        reason: reason || null,
        clientRef
      })
      onDone?.(res.supplier)
      onClose()
      triggerCustomAlert?.(
        `تم تسجيل المرتجع #${res.returnId}: خُصم ${formatMoney(res.credit)} ج.م من مستحق المورد${res.refund ? `، واستُلم ${formatMoney(res.refund)} ج.م` : ''}.`
      )
    } catch (err) {
      triggerCustomAlert?.('تعذّر تسجيل المرتجع: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <form
        data-enter-step
        className="modal-content modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-return-title"
        onSubmit={save}
        style={{ width: 720 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <PackageMinus size={22} />
          </span>
          <h2 id="purchase-return-title">
            مرتجع مشتريات – فاتورة #{purchase.invoice_ref || purchase.id}
          </h2>
          {p && (
            <p>
              {p.supplier_name} · الأصناف {formatMoney(p.gross)} ج.م
              {p.discount > 0 &&
                ` · خصم ${formatMoney(p.discount)} · الصافي ${formatMoney(p.total_amount)}`}{' '}
              ج.م
            </p>
          )}
        </div>
        <div className="modal-body">
          {!detail ? (
            <div className="loading-state">جاري التحميل...</div>
          ) : !detail.items.length ? (
            <p className="cell-muted">
              هذه الفاتورة سُجّلت بالمبلغ فقط دون أصناف، فلا يوجد ما يُرتجع للمخزن.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>الصنف</th>
                    <th className="num">المشترى</th>
                    <th className="num">أُرجع</th>
                    <th className="num">سعر الوحدة</th>
                    <th>كمية المرتجع</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((l) => {
                    const left = Math.round((l.qty - l.returned) * 1000) / 1000
                    return (
                      <tr key={l.id}>
                        <td>
                          {l.name}
                          <div className="cell-muted">
                            <span className="ltr-id">{l.barcode}</span>
                          </div>
                        </td>
                        <td className="num">
                          {l.qty} {l.unit_name || ''}
                        </td>
                        <td className="num">{l.returned}</td>
                        <td className="num">{formatMoney(l.unit_cost)}</td>
                        <td>
                          <input
                            type="number"
                            className="input num"
                            min="0"
                            max={left}
                            step="any"
                            disabled={left <= 0}
                            value={qty[l.id] ?? ''}
                            onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))}
                            aria-label={`كمية مرتجع ${l.name}`}
                            placeholder={left > 0 ? `حتى ${left}` : 'أُرجع كله'}
                            style={{ width: 110 }}
                          />
                          {l.unit_factor > 1 && parseFloat(qty[l.id]) > 0 && (
                            <div className="cell-muted">
                              = {Math.round(parseFloat(qty[l.id]) * l.unit_factor * 1000) / 1000}{' '}
                              {l.base_unit || ''} من المخزن
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {over && (
            <p className="text-danger">
              كمية «{over.name}» أكبر من المتبقي في الفاتورة ({over.qty - over.returned}).
            </p>
          )}
          {value > 0 && (
            <dl className="kv">
              <dt>قيمة الأصناف المرتجعة</dt>
              <dd className="num">{formatMoney(value)} ج.م</dd>
              {ratio < 1 && (
                <>
                  <dt>بعد خصم الفاتورة</dt>
                  <dd className="num">{formatMoney(credit)} ج.م</dd>
                </>
              )}
              <dt>يُخصم من مستحق المورد</dt>
              <dd className="num money-strong">{formatMoney(credit)} ج.م</dd>
            </dl>
          )}
          {value > 0 && (
            <fieldset className="field">
              <legend className="field-label">هل استلمت من المورد مبلغاً الآن؟ *</legend>
              <label className="check-row">
                <input
                  type="radio"
                  name="return-refund"
                  required
                  checked={refunded === 'no'}
                  onChange={() => setRefunded('no')}
                />
                لا، يُخصم من حساب المورد فقط
              </label>
              <label className="check-row">
                <input
                  type="radio"
                  name="return-refund"
                  required
                  checked={refunded === 'yes'}
                  onChange={() => {
                    setRefunded('yes')
                    if (!amount) setAmount(String(credit))
                  }}
                />
                نعم، استلمت مبلغاً
              </label>
            </fieldset>
          )}
          {refunded === 'yes' && value > 0 && (
            <>
              <label className="field">
                <span className="field-label">المبلغ المستلم (حتى {formatMoney(credit)}) *</span>
                <input
                  type="number"
                  className="input num"
                  min="0.01"
                  max={credit}
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <PaymentMethodSelect value={method} onChange={setMethod} label="استُلم بـ" />
              <PaymentDestination
                currentUser={currentUser}
                currentShift={currentShift}
                value={destination}
                onChange={setDestination}
                name="return-destination"
              />
            </>
          )}
          <label className="field">
            <span className="field-label">ملاحظة (اختياري)</span>
            <input
              className="input"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
        <div className="modal-footer">
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            رجوع
          </button>
          <button
            type="submit"
            className="btn btn-danger"
            style={{ flex: 1 }}
            disabled={busy || !picked.length || !!over || !refunded}
          >
            تسجيل المرتجع
          </button>
        </div>
      </form>
    </div>
  )
}
