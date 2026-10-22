import { useState } from 'react'
import { Search, Printer, ArrowLeftRight, CircleAlert } from 'lucide-react'
import { api } from '../../lib/api'
import { normalizeDigits } from '../../lib/utils'
import { formatStamp } from '../../lib/time'
import { ReturnPanel } from '../modals/ReturnRequestModal'
import ChangePaymentModal from './ChangePaymentModal'

// One invoice by its number for one action (1.5.1, D-082): «المرتجعات», «إعادة طباعة فاتورة»,
// «تغيير طريقة الدفع». Each screen needs only its own permission, not «عرض الفواتير»: the invoice is
// found by its number (typed, or entered by a scanner) among every cashier's invoices, closed shifts included,
// and the screen shows only what the action needs. The service checks the permission again for
// the lookup and for the action; finding an invoice allows nothing by itself.
const TITLES = {
  reprint: {
    title: 'إعادة طباعة فاتورة',
    hint: 'اكتب رقم الفاتورة المطبوع على الإيصال (أو أدخله بالماسح)، ثم اطبع نسخة منها.',
    icon: Printer
  },
  payment: {
    title: 'تغيير طريقة الدفع',
    hint: 'اكتب رقم الفاتورة المطبوع على الإيصال (أو أدخله بالماسح)، ثم اختر طريقة الدفع الصحيحة.',
    icon: ArrowLeftRight
  }
}
const money = (n) => (Number(n) || 0).toFixed(2)

export default function InvoiceActionTab({
  action,
  currentUser,
  currentShift,
  handleReprintSale,
  triggerCustomAlert
}) {
  // Returns: the till's return panel, as a page (same rules: reason and approval, or direct).
  if (action === 'return')
    return <ReturnPanel currentUser={currentUser} currentShift={currentShift} />
  return (
    <LookupAction
      key={action}
      action={action}
      handleReprintSale={handleReprintSale}
      triggerCustomAlert={triggerCustomAlert}
    />
  )
}

function LookupAction({ action, handleReprintSale, triggerCustomAlert }) {
  const { title, hint, icon: Icon } = TITLES[action]
  const [invoice, setInvoice] = useState('')
  const [sale, setSale] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [changing, setChanging] = useState(false)

  const find = async (e) => {
    e?.preventDefault()
    const id = Number(normalizeDigits(invoice).replace(/[^0-9]/g, ''))
    if (!id) return
    setBusy(true)
    setError('')
    try {
      const r = await api('sales.lookup', { saleId: id, action })
      setSale(r.sale)
    } catch (err) {
      setSale(null)
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card invoice-action-page" aria-labelledby="invoice-action-title">
      <div className="card-body stack">
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Icon size={22} />
          </span>
          <h2 id="invoice-action-title">{title}</h2>
          <p>{hint}</p>
        </div>
        <form className="return-lookup" onSubmit={find}>
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
        {sale && (
          <>
            <p className="return-sale">
              فاتورة <strong className="num">#{sale.id}</strong> – {formatStamp(sale.timestamp)} –{' '}
              {sale.payment_type} – <strong className="num">{money(sale.total_amount)}</strong> ج.م
            </p>
            {action === 'reprint' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleReprintSale(sale.id)}
              >
                <Printer size={16} aria-hidden="true" />
                طباعة نسخة
              </button>
            )}
            {action === 'payment' &&
              (sale.has_return ? (
                <p className="field-hint">
                  الفاتورة عليها مرتجع: صُرف بطريقة الدفع الأصلية، فلا يمكن تغييرها.
                </p>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => setChanging(true)}>
                  <ArrowLeftRight size={16} aria-hidden="true" />
                  تغيير طريقة الدفع
                </button>
              ))}
          </>
        )}
      </div>
      {changing && sale && (
        <ChangePaymentModal
          sale={{ ...sale, shiftOpen: sale.shift_open }}
          onClose={() => setChanging(false)}
          onDone={async () => {
            setChanging(false)
            await find()
          }}
          triggerCustomAlert={triggerCustomAlert}
        />
      )}
    </section>
  )
}
