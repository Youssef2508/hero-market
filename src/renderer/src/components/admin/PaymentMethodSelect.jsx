// How a payment was made (owner, 2026-10-21, D-064): cash, Visa, wallet or InstaPay. Shared by the
// customer collection, supplier payment, expense and preliminary supplier invoice forms.
const METHODS = [
  ['cash', 'نقدي'],
  ['visa', 'فيزا'],
  ['wallet', 'محفظة'],
  ['instapay', 'انستا باي']
]

export default function PaymentMethodSelect({ value, onChange, label = 'طريقة الدفع' }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {METHODS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}
