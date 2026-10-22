import { formatMoney } from '../../lib/utils'
import { balanceLabel } from '../../lib/supplierBalance'

export function BalanceText({ value }) {
  const v = Number(value) || 0
  return (
    <>
      <span className="money">{formatMoney(Math.abs(v))} ج.م</span>{' '}
      <span className="cell-muted">{balanceLabel(v)}</span>
    </>
  )
}

/**
 * The opening balance as an amount and its direction. `value` is a signed number or '' (none);
 * `onChange` receives the signed number, or '' when the amount is empty.
 */
export function OpeningBalanceField({ value, onChange, name = 'opening-dir' }) {
  const n = value === '' || value === null || value === undefined ? '' : Number(value)
  const amount = n === '' ? '' : String(Math.abs(n))
  const owed = n === '' || n >= 0 ? 'to' : 'from'
  const emit = (a, dir) => onChange(a === '' ? '' : (dir === 'from' ? -1 : 1) * Number(a))
  return (
    <fieldset className="field">
      <legend className="field-label">الرصيد الافتتاحي (قبل البرنامج، اختياري)</legend>
      <input
        type="number"
        className="input num"
        min="0"
        step="0.01"
        value={amount}
        onChange={(e) => emit(e.target.value, owed)}
        placeholder="0.00"
        aria-label="مبلغ الرصيد الافتتاحي"
      />
      <label className="check-row">
        <input
          type="radio"
          name={name}
          checked={owed === 'to'}
          onChange={() => emit(amount, 'to')}
        />
        مستحق للمورد (علينا)
      </label>
      <label className="check-row">
        <input
          type="radio"
          name={name}
          checked={owed === 'from'}
          onChange={() => emit(amount, 'from')}
        />
        مستحق على المورد (لنا)
      </label>
      <p className="field-hint">
        يُسجَّل كسطر «رصيد افتتاحي» في حساب المورد، وليس فاتورة شراء ولا يغيّر المخزون أو الخزنة.
      </p>
    </fieldset>
  )
}
