import { useEffect, useState } from 'react'
import { History, ClipboardCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { Timestamp } from '../ui'

const KIND_LABELS = {
  opening: 'رصيد افتتاحي',
  sale: 'بيع',
  return: 'مرتجع',
  purchase: 'استلام شراء',
  adjustment: 'تسوية يدوية',
  count: 'جرد',
  damaged: 'هالك',
  damaged_reversal: 'إلغاء هالك',
  purchase_return: 'مرتجع مشتريات'
}

const REF_LABELS = {
  sale: 'فاتورة بيع',
  sale_item: 'سطر فاتورة',
  purchase: 'فاتورة شراء',
  damaged: 'سجل هالك',
  product: 'شاشة الصنف'
}

const qty = (n) => {
  const v = Number(n)
  return `${v > 0 ? '+' : ''}${v.toLocaleString('en-US', { maximumFractionDigits: 3 })}`
}

// Movement history of one product, and a stock count measured against the stock shown when the
// count started (later sales are kept). The service checks inventory.adjust for the count.
export default function StockHistoryModal({ product, onClose, onChanged }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [base, setBase] = useState(product ? Number(product.stock_qty) || 0 : 0)
  const [counted, setCounted] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () =>
    api('inventory.movements', { barcode: product.barcode, limit: 200 })
      .then((r) => setRows(r))
      .catch((e) => setError(e.message))

  useEffect(() => {
    if (product) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product])

  if (!product) return null

  const submitCount = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const r = await api('inventory.count', {
        barcode: product.barcode,
        counted: parseFloat(counted),
        base,
        reason: reason.trim()
      })
      setBase(r.stock)
      setCounted('')
      setReason('')
      await load()
      if (onChanged) onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div
        className="modal-content modal-wide modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-history-title"
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <History size={22} />
          </span>
          <h2 id="stock-history-title">سجل حركة المخزون</h2>
          <p>
            {product.name} <span className="mono cell-muted">{product.barcode}</span>
          </p>
        </div>

        <div className="modal-body">
          <form className="till-section" onSubmit={submitCount}>
            <h3 className="till-section-title">
              <ClipboardCheck size={16} aria-hidden="true" />
              جرد فعلي
            </h3>
            <p className="cell-muted">
              الرصيد عند بدء الجرد: <strong className="num">{base}</strong> {product.unit}. يُسجَّل
              الفرق فقط، فلا تضيع المبيعات التي تتم أثناء الجرد.
            </p>
            <div className="row row-wrap">
              <input
                type="number"
                step="0.001"
                className="form-input num"
                required
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                placeholder="الكمية المعدودة"
                aria-label="الكمية المعدودة"
                style={{ width: 150 }}
              />
              <input
                className="form-input"
                required
                minLength={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="سبب الجرد أو التسوية (إلزامي)"
                aria-label="سبب الجرد"
                style={{ flex: 1, minWidth: 180 }}
              />
              <button type="submit" className="btn btn-primary" disabled={busy}>
                تسجيل الجرد
              </button>
            </div>
          </form>

          {error && (
            <p className="text-danger" role="alert">
              {error}
            </p>
          )}

          {rows === null ? (
            <div className="loading-state" role="status">
              <span className="spinner" />
              جاري التحميل...
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الحركة</th>
                  <th>الكمية</th>
                  <th>الرصيد بعدها</th>
                  <th>التكلفة</th>
                  <th>المستخدم</th>
                  <th>البيان</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="num nowrap cell-muted">
                      <Timestamp value={m.created_at} />
                    </td>
                    <td>{KIND_LABELS[m.kind] || m.kind}</td>
                    <td className={`num ${Number(m.qty) < 0 ? 'text-danger' : 'text-success'}`}>
                      {qty(m.qty)}
                    </td>
                    <td className={`num ${Number(m.balance_after) < 0 ? 'text-danger' : ''}`}>
                      {Number(m.balance_after).toLocaleString('en-US', {
                        maximumFractionDigits: 3
                      })}
                    </td>
                    <td className="num cell-muted">
                      {m.cost !== undefined ? formatMoney(m.cost) : '—'}
                    </td>
                    <td className="cell-muted">{m.username || '—'}</td>
                    <td className="cell-muted">
                      {m.reason ||
                        (m.ref_type
                          ? `${REF_LABELS[m.ref_type] || m.ref_type}${m.ref_id ? ` #${m.ref_id}` : ''}`
                          : '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="modal-footer">
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}
