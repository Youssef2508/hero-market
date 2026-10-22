import { Scale, Plus, Trash2 } from 'lucide-react'

const parse = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const POSITIONS = [
  ['length', 'طول الملصق (رقم)'],
  ['codeStart', 'بداية كود الصنف'],
  ['codeLength', 'طول كود الصنف'],
  ['valueStart', 'بداية الوزن/السعر'],
  ['valueLength', 'طول الوزن/السعر'],
  ['weightDivisor', 'قسمة الوزن (1000 = جرام → كجم)'],
  ['priceDivisor', 'قسمة السعر (100 = قرش → جنيه)']
]

// Scale labels printed by the store's scale: which prefixes carry a weight or a price, and where the
// product code and value sit in the barcode. The service validates and applies them (pos.resolve).
export default function ScaleLabelsSection({ value, onChange }) {
  const cfg = parse(value)
  if (!cfg) return null
  const set = (patch) => onChange(JSON.stringify({ ...cfg, ...patch }))
  const prefixes = Object.entries(cfg.prefixes || {})
  const setPrefixes = (list) =>
    set({ prefixes: Object.fromEntries(list.filter(([p]) => p !== '').map(([p, k]) => [p, k])) })

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">
          <Scale size={18} aria-hidden="true" />
          ملصقات ميزان الباركود (اختياري)
        </h2>
      </div>
      <details className="card-body">
        <summary>
          غير مطلوب عند الوزن على ميزان عادي وإدخال الوزن يدوياً (الوضع الافتراضي). فعّله فقط إذا
          اشتريت ميزاناً يطبع ملصقات باركود.
        </summary>
        <label className="check-row">
          <input
            type="checkbox"
            checked={cfg.enabled !== false}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          <span>قراءة ملصقات الميزان (الوزن أو السعر داخل الباركود)</span>
        </label>
        <table className="data-table" style={{ maxWidth: 420 }}>
          <thead>
            <tr>
              <th>بادئة الباركود</th>
              <th>تحتوي على</th>
              <th aria-label="حذف" />
            </tr>
          </thead>
          <tbody>
            {prefixes.map(([p, kind], i) => (
              <tr key={i}>
                <td>
                  <input
                    className="input num ltr"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={3}
                    value={p}
                    onChange={(e) =>
                      setPrefixes(
                        prefixes.map((x, j) =>
                          j === i ? [e.target.value.replace(/\D/g, ''), x[1]] : x
                        )
                      )
                    }
                    aria-label="بادئة الباركود"
                    style={{ width: 70 }}
                  />
                </td>
                <td>
                  <select
                    className="input"
                    value={kind}
                    onChange={(e) =>
                      setPrefixes(prefixes.map((x, j) => (j === i ? [x[0], e.target.value] : x)))
                    }
                    aria-label={`نوع البادئة ${p}`}
                  >
                    <option value="weight">الوزن</option>
                    <option value="price">السعر</option>
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => setPrefixes(prefixes.filter((_, j) => j !== i))}
                    aria-label={`حذف البادئة ${p}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            const free = ['23', '24', '26', '27', '28', '29'].find((x) => !cfg.prefixes?.[x])
            if (free) setPrefixes([...prefixes, [free, 'weight']])
          }}
        >
          <Plus size={15} aria-hidden="true" />
          إضافة بادئة
        </button>
        <label className="field" style={{ maxWidth: 420 }}>
          <span className="field-label">رقم التحقق (آخر رقم في الملصق)</span>
          <select
            className="input"
            value={cfg.checkDigit ?? (cfg.length === 13 ? 'ean13' : 'none')}
            onChange={(e) => set({ checkDigit: e.target.value })}
          >
            <option value="ean13">EAN-13 (الموازين العادية: يُرفض الملصق إذا كان خاطئاً)</option>
            <option value="none">لا يوجد رقم تحقق</option>
          </select>
          <span className="field-hint">
            مثال: الملصق 2000001001257 = بادئة 20، كود الصنف 00001 (يُسجَّل الصنف بالكود 2000001 أو
            00001)، الوزن 00125 جرام = 0.125 كجم، و7 رقم التحقق.
          </span>
        </label>
        <details>
          <summary>مواضع الكود والقيمة داخل الملصق</summary>
          <div className="form-grid">
            {POSITIONS.map(([k, label]) => (
              <label className="field" key={k}>
                <span className="field-label">{label}</span>
                <input
                  className="input num"
                  type="number"
                  min="0"
                  value={cfg[k]}
                  onChange={(e) => set({ [k]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
        </details>
      </details>
    </section>
  )
}
