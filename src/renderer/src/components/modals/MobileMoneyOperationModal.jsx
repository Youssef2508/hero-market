import { useState, useEffect } from 'react'
import { Wallet, CircleAlert } from 'lucide-react'

const MobileMoneyOperationModal = ({ isOpen, onClose, onSubmit }) => {
  const [platform, setPlatform] = useState('vodafone_cash') // 'vodafone_cash', 'instapay', 'bank_transfer'
  const [operationType, setOperationType] = useState('withdraw_from_client') // 'withdraw_from_client', 'deposit_to_client'
  const [digitalAmount, setDigitalAmount] = useState('')
  const [commission, setCommission] = useState('0')
  const [cashAmount, setCashAmount] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [phoneOrAccount, setPhoneOrAccount] = useState('')
  const [notes, setNotes] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (isOpen) {
      setPlatform('vodafone_cash')
      setOperationType('withdraw_from_client')
      setDigitalAmount('')
      setCommission('0')
      setCashAmount('')
      setRecipientName('')
      setPhoneOrAccount('')
      setNotes('')
      setErrorMsg('')
    }
  }, [isOpen])

  // Automatically calculate cash impact based on inputs
  useEffect(() => {
    const dig = parseFloat(digitalAmount) || 0
    const com = parseFloat(commission) || 0

    if (operationType === 'deposit_to_client') {
      // Deposit: Client gives us cash = transfer amount + commission
      setCashAmount(String(dig + com))
    } else if (operationType === 'withdraw_from_client') {
      // Withdrawal: We give client cash = transfer amount - commission
      setCashAmount(String(Math.max(0, dig - com)))
    }
  }, [digitalAmount, commission, operationType])

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

    if (operationType === 'deposit_to_client') {
      digitalImpact = -digVal // digital wallet balance decreases
      cashImpact = cashVal // cash drawer increases (received cash)
    } else if (operationType === 'withdraw_from_client') {
      digitalImpact = digVal // digital wallet balance increases
      cashImpact = -cashVal // cash drawer decreases (paid cash)
    }

    onSubmit({
      platform,
      operationType,
      digitalImpact,
      cashImpact,
      commission: comVal,
      recipientName,
      phoneOrAccount,
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
            <Wallet size={22} />
          </span>
          <h2>تسجيل حركة محفظة / تحويل</h2>
          <p>سجل حركة سحب أو إيداع لربط الكاش والأرصدة الرقمية</p>
        </div>
        <form
          onSubmit={handleFormSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          <div className="form-group">
            <label>المنصة / الوسيلة *</label>
            <select
              className="form-input"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              <option value="vodafone_cash">فودافون كاش (Vodafone Cash)</option>
              <option value="instapay">انستا باي (Instapay)</option>
              <option value="bank_transfer">تحويل بنكي مباشر (Bank Transfer)</option>
            </select>
          </div>

          <div className="form-group">
            <label>نوع العملية *</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <label
                style={{
                  flex: 1,
                  padding: '10px',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  backgroundColor:
                    operationType === 'withdraw_from_client'
                      ? 'var(--success-soft)'
                      : 'var(--surface-raised)',
                  color: 'var(--text)'
                }}
              >
                <input
                  type="radio"
                  name="opType"
                  value="withdraw_from_client"
                  checked={operationType === 'withdraw_from_client'}
                  onChange={() => setOperationType('withdraw_from_client')}
                />
                سحب من الزبون (المحل بيستلم رصيد وبيطلع كاش)
              </label>
              <label
                style={{
                  flex: 1,
                  padding: '10px',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  backgroundColor:
                    operationType === 'deposit_to_client'
                      ? 'var(--success-soft)'
                      : 'var(--surface-raised)',
                  color: 'var(--text)'
                }}
              >
                <input
                  type="radio"
                  name="opType"
                  value="deposit_to_client"
                  checked={operationType === 'deposit_to_client'}
                  onChange={() => setOperationType('deposit_to_client')}
                />
                إيداع للزبون (المحل بيطلع رصيد وبيستلم كاش)
              </label>
            </div>
          </div>

          <div className="form-group">
            <label>مبلغ العملية الأساسي (الرصيد الرقمي) *</label>
            <input
              type="number"
              step="0.01"
              className="form-input"
              value={digitalAmount}
              onChange={(e) => setDigitalAmount(e.target.value)}
              required
              placeholder="0.00"
            />
          </div>

          <div className="form-group">
            <label>عمولة المعاملة *</label>
            <input
              type="number"
              step="0.01"
              className="form-input"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
              required
              placeholder="0.00"
            />
          </div>

          <div className="form-group">
            <label>المبلغ المتأثر به الدرج كاش (الفلوس الورق) *</label>
            <input
              type="number"
              className="form-input"
              value={cashAmount}
              readOnly
              data-computed="true"
              placeholder="0.00"
            />
            <small
              style={{
                color: 'var(--text-3)',
                fontSize: '0.8rem',
                marginTop: '4px',
                display: 'block'
              }}
            >
              {operationType === 'deposit_to_client' &&
                'المستلم كاش من الزبون = رصيد التحويل + العمولة'}
              {operationType === 'withdraw_from_client' &&
                'المسحوب كاش للزبون من الدرج = رصيد التحويل - العمولة'}
            </small>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>رقم الهاتف / الحساب</label>
              <input
                type="text"
                className="form-input"
                value={phoneOrAccount}
                onChange={(e) => setPhoneOrAccount(e.target.value)}
                placeholder="مثال: 01012345678"
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>اسم الزبون / المستلم</label>
              <input
                type="text"
                className="form-input"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="اسم العميل"
              />
            </div>
          </div>

          <div className="form-group">
            <label>ملاحظات إضافية</label>
            <textarea
              className="form-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: اسم المحول منه، تفاصيل التحويل..."
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

export default MobileMoneyOperationModal
