// Lightweight CSS charts (no chart library). Colours come from --chart-* tokens.
import { formatMoney } from '../../lib/utils'
import { CHART_COLORS } from './chartColors'

const short = (val) =>
  typeof val === 'number' && Math.abs(val) > 1000 ? `${(val / 1000).toFixed(1)}k` : formatMoney(val)

/** Vertical bars sized against a fixed-height track so percentages always resolve. */
export function VBarChart({
  data,
  valueKey,
  labelKey,
  colors = CHART_COLORS,
  wide = false,
  formatValue = short
}) {
  if (!data || data.length === 0) return <div className="chart-empty">لا توجد بيانات</div>
  const max = Math.max(...data.map((d) => Math.abs(d[valueKey] || 0)), 0)
  return (
    <div
      className={`vbar-chart ${wide ? 'is-wide' : ''}`}
      role="img"
      aria-label="رسم بياني بالأعمدة"
    >
      {data.map((d, i) => {
        const val = d[valueKey] || 0
        const pct = max > 0 ? (Math.abs(val) / max) * 100 : 0
        return (
          <div key={i} className="vbar">
            <span className="vbar-value num" title={formatMoney(val)}>
              {formatValue(val)}
            </span>
            <div className="vbar-track">
              <div
                className="vbar-fill"
                style={{ height: `${Math.max(pct, 2)}%`, background: colors[i % colors.length] }}
              />
            </div>
            <span className="vbar-label num" title={String(d[labelKey])}>
              {d[labelKey]}
            </span>
          </div>
        )
      })}
    </div>
  )
}
