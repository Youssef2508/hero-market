import { fixedDestination } from '../../lib/destination'

/** The choice, shown only when both destinations are possible. */
export default function PaymentDestination({ currentUser, currentShift, value, onChange, name }) {
  if (fixedDestination(currentUser, currentShift) !== null) return null
  return (
    <fieldset className="field">
      <legend className="field-label">يُسجَّل في *</legend>
      <div className="row">
        {[
          ['shift', `درج الوردية #${currentShift?.id}`],
          ['treasury', 'الخزنة']
        ].map(([v, label]) => (
          <label className="check-row" key={v}>
            <input
              type="radio"
              name={name}
              value={v}
              required
              checked={value === v}
              onChange={() => onChange(v)}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
