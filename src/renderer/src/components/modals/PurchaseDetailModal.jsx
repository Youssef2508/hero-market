import { useEffect, useState } from 'react'
import { ReceiptText } from 'lucide-react'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { Timestamp } from '../ui'

/**
 * A recorded supplier invoice with its lines and returns (owner, 1.5.2, D-088). Everyone who sees
 * suppliers can open it. With «إدارة الموردين» its reference number and notes can be corrected:
 * they change no stock, cost or balance. Quantities and prices of a recorded purchase are corrected
 * by a purchase return and a new invoice, so stock, the supplier's balance and the purchase price
 * stay explained by their records.
 */
export default function PurchaseDetailModal({
  purchase,
  canManage,
  onClose,
  onSaved,
  onReturn,
  onPrint,
  triggerCustomAlert
}) {
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stop = false
    api('suppliers.purchaseDetail', { purchaseId: purchase.id })
      .then((d) => {
        if (stop) return
        setDetail(d)
        setForm({ invoiceRef: d.purchase.invoice_ref || '', notes: d.purchase.notes || '' })
      })
      .catch((err) => triggerCustomAlert?.('تعذّر تحميل الفاتورة: ' + err.message))
    return () => {
      stop = true
    }
  }, [purchase.id, triggerCustomAlert])

  const p = detail?.purchase
  const changed =
    p &&
    form &&
    (form.invoiceRef.trim() !== (p.invoice_ref || '') || form.notes.trim() !== (p.notes || ''))

  const save = async (e) => {
    e.preventDefault()
    if (!changed) return
    setBusy(true)
    try {
      const res = await api('suppliers.updatePurchase', {
        purchaseId: purchase.id,
        invoiceRef: form.invoiceRef.trim(),
        notes: form.notes.trim()
      })
      setDetail((d) => ({ ...d, purchase: { ...d.purchase, ...res.purchase } }))
      setForm({ invoiceRef: res.purchase.invoice_ref || '', notes: res.purchase.notes || '' })
      onSaved?.()
      triggerCustomAlert?.('تم حفظ بيانات الفاتورة.')
    } catch (err) {
      triggerCustomAlert?.('تعذّر الحفظ: ' + err.message)
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
        aria-labelledby="purchase-detail-title"
        onSubmit={save}
        style={{ width: 'min(860px, calc(100vw - 32px))' }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <ReceiptText size={22} />
          </span>
          <h2 id="purchase-detail-title">
            فاتورة شراء <span className="ltr-id">{p?.invoice_ref || `#${purchase.id}`}</span>
          </h2>
          {p && (
            <p>
              {p.supplier_name} · <Timestamp value={p.timestamp} /> · {p.payment_type}
            </p>
          )}
        </div>
        <div className="modal-body">
          {!detail ? (
            <div className="loading-state">جاري التحميل...</div>
          ) : (
            <>
              <dl className="kv">
                <dt>إجمالي الأصناف</dt>
                <dd className="num">{formatMoney(p.gross)} ج.م</dd>
                {p.discount > 0 && (
                  <>
                    <dt>خصم الفاتورة</dt>
                    <dd className="num">{formatMoney(p.discount)} ج.م</dd>
                  </>
                )}
                <dt>الصافي</dt>
                <dd className="num money-strong">{formatMoney(p.total_amount)} ج.م</dd>
                <dt>المدفوع</dt>
                <dd className="num">{formatMoney(p.paid_amount)} ج.م</dd>
                <dt>المتبقي</dt>
                <dd className="num">{formatMoney(p.remaining)} ج.م</dd>
                {p.paid_from && (
                  <>
                    <dt>دُفع من</dt>
                    <dd>{p.paid_from === 'treasury' ? 'الخزنة' : 'درج الوردية'}</dd>
                  </>
                )}
              </dl>
              {!detail.items.length ? (
                <p className="cell-muted">هذه الفاتورة سُجّلت بالمبلغ فقط دون أصناف.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table table-compact">
                    <caption className="visually-hidden">أصناف الفاتورة</caption>
                    <thead>
                      <tr>
                        <th>الصنف</th>
                        <th className="num">الكمية</th>
                        <th className="num">سعر الوحدة</th>
                        <th className="num">الإجمالي</th>
                        <th className="num">أُرجع</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((l) => (
                        <tr key={l.id}>
                          <td>
                            {l.name || l.barcode}
                            <div className="cell-muted">
                              <span className="ltr-id">{l.barcode}</span>
                              {l.unit_factor > 1 && ` · ${l.unit_factor} ${l.base_unit || ''}`}
                            </div>
                          </td>
                          <td className="num">
                            {l.qty} {l.unit_name || ''}
                          </td>
                          <td className="num">{formatMoney(l.unit_cost)}</td>
                          <td className="num">{formatMoney(l.line_total)}</td>
                          <td className="num">{l.returned > 0 ? l.returned : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {detail.returns.length > 0 && (
                <>
                  <h3 className="till-section-title">مرتجعات هذه الفاتورة</h3>
                  <ul className="bullet-list">
                    {detail.returns.map((r) => (
                      <li key={r.id}>
                        #{r.id} · <Timestamp value={r.created_at} /> · خُصم{' '}
                        {formatMoney(r.credit_value)} ج.م
                        {r.refund_amount > 0 && ` · استُلم ${formatMoney(r.refund_amount)} ج.م`}
                        {r.created_by_name && ` · ${r.created_by_name}`}
                        {r.reason && ` · ${r.reason}`}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {canManage ? (
                <>
                  <label className="field">
                    <span className="field-label">رقم الفاتورة (مرجع)</span>
                    <input
                      className="input"
                      maxLength={80}
                      value={form.invoiceRef}
                      onChange={(e) => setForm((f) => ({ ...f, invoiceRef: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">ملاحظات</span>
                    <textarea
                      className="input"
                      rows={2}
                      maxLength={1000}
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    />
                  </label>
                  <p className="field-hint">
                    الكميات والأسعار لا تُعدَّل مباشرة لأنها غيّرت المخزون وحساب المورد وسعر الشراء.
                    للتصحيح: سجّل «مرتجع مشتريات» للكمية الخاطئة، ثم فاتورة جديدة بالصحيح.
                  </p>
                </>
              ) : (
                p.notes && <p className="cell-muted">ملاحظات: {p.notes}</p>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            رجوع
          </button>
          {onPrint && (
            <button type="button" className="btn btn-secondary" onClick={() => onPrint(purchase)}>
              طباعة
            </button>
          )}
          {canManage && detail?.items.length > 0 && onReturn && (
            <button type="button" className="btn btn-secondary" onClick={() => onReturn(purchase)}>
              مرتجع مشتريات
            </button>
          )}
          {canManage && (
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={busy || !changed}
            >
              حفظ التعديل
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
