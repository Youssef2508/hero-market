import { useState } from 'react'
import { ReceiptText, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import ProductPicker from './ProductPicker'

const lineTotal = (l) => Math.round((Number(l.qty) || 0) * (Number(l.unitCost) || 0) * 100) / 100

// Purchase invoice. Item lines are received into stock at their cost (moving average, K-38);
// with lines, the invoice total is their sum. Without lines it records the amount only, as before.
const AddPurchaseModal = ({
  showAddPurchaseModal,
  setShowAddPurchaseModal,
  selectedSupplier,
  newPurchaseForm,
  setNewPurchaseForm,
  handleAddPurchase
}) => {
  const [lookupError, setLookupError] = useState('')
  if (!showAddPurchaseModal || !selectedSupplier) return null

  const items = newPurchaseForm.items || []
  const setItems = (fn) => setNewPurchaseForm((p) => ({ ...p, items: fn(p.items || []) }))
  const itemsTotal = Math.round(items.reduce((a, l) => a + lineTotal(l), 0) * 100) / 100

  // `picked` is a product row from the list; a scanned or typed barcode is looked up.
  const addLine = async (barcode, picked = null) => {
    if (!barcode) return false
    setLookupError('')
    if (items.some((l) => l.barcode === barcode)) {
      setLookupError('الصنف مضاف بالفعل؛ عدّل الكمية في سطره.')
      return false
    }
    try {
      const p = picked || (await api('products.get', { barcode }))
      if (!p) {
        setLookupError(`الصنف (${barcode}) غير مسجل.`)
        return false
      }
      // Purchasable packaging (carton, box…): quantity and cost are entered in the chosen unit.
      const extra = await api('productUnits.get', { barcode: p.barcode })
        .then((r) => r.units.filter((u) => u.purchasable))
        .catch(() => [])
      const baseCost = p.cost_price !== undefined ? Number(p.cost_price) : null
      setItems((list) => [
        ...list,
        {
          barcode: p.barcode,
          name: p.name,
          unit: p.unit || '',
          units: [
            { id: null, name: p.unit || 'الوحدة الأساسية', factor: 1 },
            ...extra.map((u) => ({ id: u.id, name: u.name, factor: Number(u.factor) }))
          ],
          unitId: null,
          baseCost,
          qty: '',
          unitCost: baseCost !== null ? String(baseCost) : ''
        }
      ])
      return true
    } catch (err) {
      setLookupError(err.message)
      return false
    }
  }

  const update = (i, patch) =>
    setItems((list) => list.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <div className="modal-overlay">
      <div
        className="modal-content modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-purchase-title"
        style={{ width: items.length ? 640 : 480 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <ReceiptText size={22} />
          </span>
          <h2 id="add-purchase-title">فاتورة شراء جديدة</h2>
          <p>المورد: {selectedSupplier.name}</p>
        </div>
        <form
          onSubmit={handleAddPurchase}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div className="form-group">
            <label>رقم الفاتورة (مرجع)</label>
            <input
              className="form-input"
              value={newPurchaseForm.invoice_ref}
              onChange={(e) => setNewPurchaseForm((p) => ({ ...p, invoice_ref: e.target.value }))}
              placeholder="رقم الفاتورة اختياري"
            />
          </div>

          <section className="till-section">
            <h3 className="till-section-title">الأصناف المستلمة (تُضاف إلى المخزون)</h3>
            <ProductPicker
              added={items.map((l) => l.barcode)}
              onPick={addLine}
              onType={() => setLookupError('')}
            />
            {lookupError && (
              <p className="text-danger" role="alert">
                {lookupError}
              </p>
            )}
            {items.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الصنف</th>
                    <th>الكمية</th>
                    <th>تكلفة الوحدة</th>
                    <th>الإجمالي</th>
                    <th aria-label="حذف" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((l, i) => (
                    <tr key={l.barcode}>
                      <td>
                        {l.name}
                        <div className="cell-muted num">{l.barcode}</div>
                      </td>
                      <td>
                        <input
                          type="number"
                          className="form-input num"
                          min="0.001"
                          step="0.001"
                          required
                          value={l.qty}
                          onChange={(e) => update(i, { qty: e.target.value })}
                          aria-label={`كمية ${l.name}`}
                          style={{ width: 90 }}
                        />
                        {l.units && l.units.length > 1 ? (
                          <select
                            className="form-input"
                            value={l.unitId ?? ''}
                            onChange={(e) => {
                              const id = e.target.value === '' ? null : Number(e.target.value)
                              const u = l.units.find((x) => (x.id ?? null) === id)
                              update(i, {
                                unitId: id,
                                unitCost:
                                  l.baseCost !== null
                                    ? String(Math.round(l.baseCost * u.factor * 10000) / 10000)
                                    : l.unitCost
                              })
                            }}
                            aria-label={`وحدة شراء ${l.name}`}
                            style={{ width: 120, marginTop: 4 }}
                          >
                            {l.units.map((u) => (
                              <option key={u.id ?? 'base'} value={u.id ?? ''}>
                                {u.name}
                                {u.id ? ` (${u.factor})` : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          l.unit && <span className="cell-muted"> {l.unit}</span>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          className="form-input num"
                          min="0"
                          step="0.0001"
                          required
                          value={l.unitCost}
                          onChange={(e) => update(i, { unitCost: e.target.value })}
                          aria-label={`تكلفة وحدة ${l.name}`}
                          style={{ width: 100 }}
                        />
                      </td>
                      <td className="num">{formatMoney(lineTotal(l))}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setItems((list) => list.filter((_, j) => j !== i))}
                          aria-label={`حذف ${l.name}`}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="form-group">
            <label>إجمالي قيمة الفاتورة (ج.م) *</label>
            {items.length > 0 ? (
              <output className="form-input num" aria-live="polite">
                {formatMoney(itemsTotal)}
              </output>
            ) : (
              <input
                type="number"
                className="form-input"
                required
                min="0.01"
                step="0.01"
                value={newPurchaseForm.total_amount}
                onChange={(e) =>
                  setNewPurchaseForm((p) => ({ ...p, total_amount: e.target.value }))
                }
                placeholder="0.00"
              />
            )}
          </div>
          <div className="form-group">
            <label>المبلغ المدفوع نقداً الآن (ج.م)</label>
            <input
              type="number"
              className="form-input"
              min="0"
              step="0.01"
              value={newPurchaseForm.paid_amount}
              onChange={(e) => setNewPurchaseForm((p) => ({ ...p, paid_amount: e.target.value }))}
              placeholder="0.00"
            />
          </div>
          <div className="form-group">
            <label>نوع الدفع</label>
            <select
              className="form-input"
              value={newPurchaseForm.payment_type}
              onChange={(e) => setNewPurchaseForm((p) => ({ ...p, payment_type: e.target.value }))}
            >
              <option value="آجل">آجل</option>
              <option value="نقدي">نقدي كامل</option>
              <option value="شيك">شيك</option>
            </select>
          </div>
          <div className="form-group">
            <label>ملاحظات</label>
            <input
              className="form-input"
              value={newPurchaseForm.notes}
              onChange={(e) => setNewPurchaseForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="ملاحظات اختيارية"
            />
          </div>
          <div className="modal-footer">
            <button
              data-modal-close
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAddPurchaseModal(false)}
            >
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
              {items.length ? 'تسجيل الفاتورة واستلام الأصناف' : 'تسجيل الفاتورة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddPurchaseModal
