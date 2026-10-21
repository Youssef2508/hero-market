// Shared presentation primitives. Styling lives in styles/components.css and
// styles/screens.css; these components only standardise markup.
import { useLayoutEffect, useRef, useState } from 'react'
import { Moon, Sun, Inbox } from 'lucide-react'
import { useTheme } from '../../theme/ThemeProvider'
import { formatStamp } from '../../lib/time'

export function PageHeader({ icon: Icon, title, description, actions, children }) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        {Icon && (
          <span className="page-header-icon" aria-hidden="true">
            <Icon size={22} />
          </span>
        )}
        <div className="page-header-text">
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-description">{description}</p>}
        </div>
      </div>
      {(actions || children) && <div className="page-header-actions">{actions || children}</div>}
    </header>
  )
}

// An amount and its currency never wrap apart ("16,825.00 ج.م").
const NBSP = String.fromCharCode(160)
const keepCurrency = (text) =>
  typeof text === 'string' ? text.replace(/ (ج\.م)/g, `${NBSP}$1`) : text

const FIT_STEPS = ['', ' is-long', ' is-longer', ' is-longest']

// A long amount (a month of sales: 1,250,000.00 ج.م) is shown smaller until it fits the card,
// never cut off (D-065); measured, so it holds at any window width.
function useFitText(ref, value, off) {
  const [step, setStep] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || off) return
    const measure = () => {
      let i = 0
      el.className = 'stat-value'
      while (i < FIT_STEPS.length - 1 && el.scrollWidth > el.clientWidth + 1) {
        i++
        el.className = 'stat-value' + FIT_STEPS[i]
      }
      setStep(i)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [ref, value, off])
  return FIT_STEPS[step]
}

export function StatCard({
  icon: Icon,
  label,
  value,
  meta,
  tone = 'accent',
  onClick,
  textValue = false
}) {
  const Tag = onClick ? 'button' : 'div'
  const valueRef = useRef(null)
  const fitSize = useFitText(valueRef, value, textValue)
  return (
    <Tag
      className={`stat-card tone-${tone}${onClick ? ' is-clickable' : ''}${textValue ? ' is-text' : ''}`}
      onClick={onClick}
    >
      {Icon && (
        <span className="stat-icon" aria-hidden="true">
          <Icon size={22} />
        </span>
      )}
      <span className="stat-info">
        <span className="stat-label">{label}</span>
        <span
          ref={valueRef}
          className={`stat-value${fitSize}`}
          title={typeof value === 'string' ? value : undefined}
        >
          {value}
        </span>
        {meta && <span className="stat-meta">{keepCurrency(meta)}</span>}
      </span>
    </Tag>
  )
}

export function EmptyState({ icon: Icon = Inbox, title, text, children }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        <Icon size={26} />
      </span>
      {title && <div className="empty-state-title">{title}</div>}
      {text && <div className="empty-state-text">{text}</div>}
      {children}
    </div>
  )
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>
}

export function Section({
  title,
  icon: Icon,
  actions,
  children,
  className = '',
  bodyClassName = ''
}) {
  return (
    <section className={`card section ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          <h2 className="card-title">
            {Icon && <Icon size={18} aria-hidden="true" />}
            {title}
          </h2>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${bodyClassName}`}>{children}</div>
    </section>
  )
}

export function ThemeToggle({ compact = false, className = '' }) {
  const { resolvedTheme, toggleTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const label = isDark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'
  return (
    <button
      type="button"
      className={`theme-toggle ${compact ? 'is-compact' : ''} ${className}`}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {isDark ? <Sun size={18} /> : <Moon size={18} />}
      </span>
      {!compact && (
        <span className="theme-toggle-label">{isDark ? 'الوضع الفاتح' : 'الوضع الداكن'}</span>
      )}
    </button>
  )
}

export function SortableTh({ field, label, sortField, sortAsc, onSort, className = '' }) {
  const active = sortField === field
  return (
    <th
      className={`sortable ${active ? 'is-sorted' : ''} ${className}`}
      onClick={() => onSort(field)}
      aria-sort={active ? (sortAsc ? 'ascending' : 'descending') : 'none'}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSort(field)
        }
      }}
    >
      <span className="th-sort">
        {label}
        <span className="sort-indicator" aria-hidden="true">
          {active ? (sortAsc ? '▲' : '▼') : ''}
        </span>
      </span>
    </th>
  )
}

export function Pagination({ page, total, perPage, shown, noun = 'سجل', onPrev, onNext }) {
  const pages = Math.max(1, Math.ceil((total || 0) / perPage))
  return (
    <div className="pagination-controls">
      <div className="pagination-info">
        عرض <strong className="num">{shown}</strong> من أصل <strong className="num">{total}</strong>{' '}
        {noun}
      </div>
      <div className="pagination-buttons">
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          disabled={page <= 1}
          onClick={onPrev}
        >
          السابق
        </button>
        <span className="pagination-page num">
          صفحة {page} من {pages}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          disabled={page >= pages}
          onClick={onNext}
        >
          التالي
        </button>
      </div>
    </div>
  )
}

/**
 * A stored local date-time ('YYYY-MM-DD HH:MM:SS') shown with a 12-hour time ("2026-10-15 03:45 PM"),
 * kept left-to-right inside RTL text; the exact stored value is in the tooltip.
 */
export function Timestamp({ value }) {
  return (
    <bdi dir="ltr" className="ts" title={value || undefined}>
      {value ? formatStamp(value) : '—'}
    </bdi>
  )
}

/**
 * A message mixing Arabic and Latin (template names, usernames, paper sizes): quoted names and
 * parenthesised codes are isolated so the sentence keeps its reading order in RTL.
 */
export function BidiText({ text }) {
  const parts = String(text ?? '').split(/("[^"]*"|\([^)]*\))/)
  return parts.map((p, i) => (i % 2 ? <bdi key={i}>{p}</bdi> : p))
}
