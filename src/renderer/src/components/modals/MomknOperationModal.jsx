import { useState, useEffect } from 'react'
import { Smartphone, CircleAlert } from 'lucide-react'

const MomknOperationModal = ({ isOpen, onClose, onSubmit }) => {
  const [operationType, setOperationType] = useState('payment') // 'payment', 'refund', 'recharge'
  const [description, setDescription] = useState('')
  const [digitalAmount, setDigitalAmount] = useState('')
  const [cashAmount, setCashAmount] = useState('')
  const [commission, setCommission] = useState('0')
  const [notes, setNotes] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (isOpen) {
      setOperationType('payment')
      setDescription('')
      setDigitalAmount('')
      setCashAmount('')
      setCommission('0')
      setNotes('')
      setErrorMsg('')
    }
  }, [isOpen])

  // Handlers for bidirectional auto-calculation
  const handleDigitalChange = (val) => {
    setDigitalAmount(val)
    const dig = parseFloat(val) || 0
    if (operationType === 'payment') {
      const com = parseFloat(commission) || 0
      setCashAmount(val ? (dig + com)?.toFixed(2) : '')
    } else {
      setCashAmount(val)
      setCommission('0')
    }
  }

  const handleCashChange = (val) => {
    setCashAmount(val)
    const cash = parseFloat(val) || 0
    const dig = parseFloat(digitalAmount) || 0
    if (operationType === 'payment' && dig > 0 && cash >= dig) {
      setCommission((cash - dig)?.toFixed(2))
    }
  }

  const handleCommissionChange = (val) => {
    setCommission(val)
    const com = parseFloat(val) || 0
    const dig = parseFloat(digitalAmount) || 0
    if (operationType === 'payment') {
      setCashAmount((dig + com)?.toFixed(2))
    }
  }

  const handleTypeChange = (type) => {
    setOperationType(type)
    const dig = parseFloat(digitalAmount) || 0
    if (type === 'payment') {
      const com = parseFloat(commission) || 0
      setCashAmount(digitalAmount ? (dig + com)?.toFixed(2) : '')
    } else {
      setCashAmount(digitalAmount)
      setCommission('0')
    }
  }

  if (!isOpen) return null

  const handleFormSubmit = (e) => {
    e.preventDefault()

    const digVal = parseFloat(digitalAmount) || 0
    const cashVal = parseFloat(cashAmount) || 0
    const comVal = parseFloat(commission) || 0

    if (digVal <= 0) {
      setErrorMsg('الرجاء إدخال مبلغ صحيح أكبر من الصفر!')
      return
    }

    let digitalImpact = 0
    let cashImpact = 0

    if (operationType === 'payment') {
      digitalImpact = -digVal // machine balance decreases
      cashImpact = cashVal // cash drawer increases
    } else if (operationType === 'refund') {
      digitalImpact = digVal // machine balance refunded/increases
      cashImpact = -cashVal // cash drawer refunded/decreases
    } else if (operationType === 'recharge') {
      digitalImpact = digVal // machine balance increases
      cashImpact = -cashVal // cash drawer decreases (paid cash)
    }

    onSubmit({
      operationType,
      description:
        description ||
        (operationType === 'payment'
          ? 'دفع خدمة ممكن'
          : operationType === 'recharge'
            ? 'شحن رصيد المكنة كاش'
            : 'استرداد عملية'),
      digitalImpact,
      cashImpact,
      commission: comVal,
      notes
    })
  }

  return (
    <div className="modal-overlay">
      <div
        className="modal-content modal-auto-scroll"
        role="dialog"
        aria-modal="true"
        style={{ width: 480 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Smartphone size={22} />
          </span>
          <h2>تسجيل حركة مكنة ممكن</h2>
          <p>أدخل بيانات العملية لتعديل أرصدة الدرج الرقمية والنقدية</p>
        </div>
        <form
          onSubmit={handleFormSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          <div className="form-group">
            <label>نوع العملية *</label>
            <select
              className="form-input"
              value={operationType}
              onChange={(e) => handleTypeChange(e.target.value)}
            >
              <option value="payment">دفع فاتورة / شحن لزبون (خروج رصيد ودخول كاش)</option>
              <option value="recharge">شحن رصيد الماكينة من مندوب (دخول رصيد وخروج كاش)</option>
              <option value="refund">استرداد عملية ملغاة (دخول رصيد وخروج كاش للزبون)</option>
            </select>
          </div>

          <div className="form-group">
            <label>وصف العملية</label>
            <input
              type="text"
              className="form-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثال: فاتورة كهرباء، شحن فودافون"
            />
          </div>

          {/* 1. Digital Amount */}
          <div className="form-group">
            <label>المبلغ المخصوم/المضاف للمكنة (رصيد ديجيتال) *</label>
            <input
              type="number"
              step="0.01"
              className="form-input"
              value={digitalAmount}
              onChange={(e) => handleDigitalChange(e.target.value)}
              required
              placeholder="مثال: 25"
            />
          </div>

          {/* 2. Cash Amount (Actual Cash Received/Paid) */}
          <div className="form-group">
            <label>المبلغ الفعلي المتأثر به الدرج كاش (الفلوس الورق) *</label>
            <input
              type="number"
              step="0.01"
              className="form-input"
              value={cashAmount}
              onChange={(e) => handleCashChange(e.target.value)}
              required
              placeholder="مثال: 33"
            />
            <small
              style={{
                color: 'var(--text-3)',
                fontSize: '0.8rem',
                marginTop: '4px',
                display: 'block'
              }}
            >
              {operationType === 'payment' &&
                'المبلغ الكلي المستلم يدوياً من الزبون ويوضع في الدرج (شامل العمولة)'}
              {operationType === 'recharge' && 'المبلغ المدفوع كاش للمندوب من الدرج'}
              {operationType === 'refund' && 'المبلغ المرتجع كاش للزبون من الدرج'}
            </small>
          </div>

          {/* 3. Commission (Automatically Computed) */}
          {operationType === 'payment' && (
            <div className="form-group">
              <label>عمولة المحل الكاش (تُحسب تلقائياً وتضاف للدرج) *</label>
              <input
                type="number"
                step="0.01"
                className="form-input"
                value={commission}
                onChange={(e) => handleCommissionChange(e.target.value)}
                required
                placeholder="0.00"
                data-computed="true"
              />
              <small
                style={{
                  color: 'var(--success-text)',
                  fontSize: '0.8rem',
                  marginTop: '4px',
                  display: 'block',
                  fontWeight: '600'
                }}
              >
                العمولة المحسوبة = الكاش المستلم ({cashAmount || 0}) - رصيد المكنة المخصوم (
                {digitalAmount || 0}) = {commission} ج.م
              </small>
            </div>
          )}

          <div className="form-group">
            <label>ملاحظات إضافية</label>
            <textarea
              className="form-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أي تفاصيل أخرى..."
              rows={2}
            />
          </div>

          {errorMsg && (
            <div className="notice notice-danger" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
              حفظ الحركة
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default MomknOperationModal
