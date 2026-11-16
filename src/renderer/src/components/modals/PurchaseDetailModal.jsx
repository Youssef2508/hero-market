import { useCallback, useEffect, useState } from 'react'
import { History, PencilLine, ReceiptText } from 'lucide-react'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { Timestamp } from '../ui'
import PurchaseRevisionModal from './PurchaseRevisionModal'

/**
 * A recorded supplier invoice with its lines, returns and corrections (owner, 1.5.2, D-088; 1.8.0,
 * D-112). Everyone who sees suppliers can open it. With «تعديل بيانات فاتورة شراء مسجلة» its reference
 * and notes can be corrected: they change no stock, cost or balance. With «تصحيح أصناف وكميات وأسعار
 * فاتورة شراء مسجلة» its lines and amounts are corrected to what was delivered: a revision, previewed
 * first, that moves stock and the supplier's balance by correction records and keeps the history.
 */
export default function PurchaseDetailModal({
  purchase,
  canManage,
  canEdit,
  canRevise,
  onClose,
  onSaved,
  onReturn,
  onPrint,
  triggerCustomAlert
}) {
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [revisions, setRevisions] = useState([])
  const [revising, setRevising] = useState(false)

  const load = useCallback(() => {
    let stop = false
    api('suppliers.purchaseDetail', { purchaseId: purchase.id })
      .then((d) => {
        if (stop) return
        setDetail(d)
        setForm({ invoiceRef: d.purchase.invoice_ref || '', notes: d.purchase.notes || '' })
      })
      .catch((err) => triggerCustomAlert?.('تعذّر تحميل الفاتورة: ' + err.message))
    api('suppliers.purchaseRevisions', { purchaseId: purchase.id })
      .then((r) => !stop && setRevisions(r))
      .catch(() => {})
    return () => {
      stop = true
    }
  }, [purchase.id, triggerCustomAlert])
  useEffect(() => load(), [load])

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
              {revisions.length > 0 && (
                <>
                  <h3 className="till-section-title">
                    <History size={15} aria-hidden="true" /> تصحيحات هذه الفاتورة
                  </h3>
                  <ul className="bullet-list">
                    {revisions.map((r) => (
                      <li key={r.revision}>
                        المراجعة {r.revision} · <Timestamp value={r.createdAt} />
                        {r.createdByName && ` · ${r.createdByName}`} · الصافي{' '}
                        {formatMoney(r.oldTotal)} ← {formatMoney(r.newTotal)} ج.م
                        {r.delta !== 0 &&
                          ` (${r.delta > 0 ? '+' : ''}${formatMoney(r.delta)} على حساب المورد)`}
                        {r.stockChanges.length > 0 &&
                          ` · المخزون: ${r.stockChanges.map((c) => `${c.name} ${c.change > 0 ? '+' : ''}${c.change}`).join('، ')}`}
                        {r.reason && ` · ${r.reason}`}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {canEdit ? (
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
                    {canRevise
                      ? 'لتصحيح الأصناف أو الكميات أو الأسعار بما استُلم فعلاً استخدم «تصحيح الأصناف والمبالغ».'
                      : 'الكميات والأسعار يصححها من لديه صلاحية «تصحيح أصناف وكميات وأسعار فاتورة شراء مسجلة»، أو تُصحَّح بمرتجع مشتريات.'}
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
          {canRevise && detail && (
            <button type="button" className="btn btn-secondary" onClick={() => setRevising(true)}>
              <PencilLine size={15} aria-hidden="true" />
              تصحيح الأصناف والمبالغ
            </button>
          )}
          {canManage && detail?.items.length > 0 && onReturn && (
            <button type="button" className="btn btn-secondary" onClick={() => onReturn(purchase)}>
              مرتجع مشتريات
            </button>
          )}
          {canEdit && (
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
      {revising && detail && (
        <PurchaseRevisionModal
          detail={detail}
          onClose={() => setRevising(false)}
          onSaved={() => {
            load()
            onSaved?.()
          }}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}
    </div>
  )
}
