import { useState } from 'react'
import { ChevronDown, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { BrandMark, Wordmark } from '../brand/BrandMark'
import { ThemeToggle } from '../ui'
import { visibleGroups } from './navigation'

// Groups folded by the user, per terminal (1.5.2, D-095). The group of the open screen is always
// shown, so the current page is never hidden; a folded group is one click or Enter away.
const FOLDED_KEY = 'heromarket.navFolded'
function readFolded() {
  try {
    const v = JSON.parse(window.localStorage.getItem(FOLDED_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export default function Sidebar({
  currentUser,
  activeId,
  onNavigate,
  compact,
  onToggleCompact,
  version
}) {
  const groups = visibleGroups(currentUser)
  const [folded, setFolded] = useState(readFolded)
  const toggle = (id) => {
    const next = folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id]
    setFolded(next)
    try {
      window.localStorage.setItem(FOLDED_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  return (
    <aside className={`sidebar ${compact ? 'is-compact' : ''}`} aria-label="التنقل الرئيسي">
      <div className="sidebar-brand">
        <BrandMark size={compact ? 36 : 38} />
        {!compact && (
          <div className="sidebar-brand-text">
            <Wordmark />
            <span className="sidebar-brand-sub">هيرو ماركت</span>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        {groups.map((group) => {
          const holdsActive = group.items.some((i) => i.id === activeId)
          // The compact rail has no labels: every icon stays visible.
          const open = compact || holdsActive || !folded.includes(group.id)
          return (
            <div className="nav-group" key={group.id}>
              {compact ? (
                <div className="nav-group-sep" aria-hidden="true" />
              ) : (
                <button
                  type="button"
                  className="nav-group-toggle"
                  aria-expanded={open}
                  aria-controls={`nav-group-${group.id}`}
                  disabled={holdsActive}
                  title={
                    holdsActive ? 'مجموعة الصفحة المفتوحة' : open ? 'طي المجموعة' : 'إظهار المجموعة'
                  }
                  onClick={() => toggle(group.id)}
                >
                  <span>{group.label}</span>
                  {!holdsActive && (
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className={`nav-group-chevron ${open ? '' : 'is-folded'}`}
                    />
                  )}
                </button>
              )}
              {open && (
                <ul id={`nav-group-${group.id}`}>
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const isActive = item.id === activeId
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`nav-item ${isActive ? 'is-active' : ''}`}
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => onNavigate(item)}
                          title={compact ? item.label : undefined}
                          aria-label={compact ? item.label : undefined}
                        >
                          <Icon size={18} strokeWidth={isActive ? 2.25 : 1.9} aria-hidden="true" />
                          {!compact && <span className="nav-item-label">{item.label}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <ThemeToggle compact={compact} className="sidebar-theme" />
        <button
          type="button"
          className="sidebar-collapse"
          onClick={onToggleCompact}
          aria-label={compact ? 'توسيع القائمة' : 'تصغير القائمة'}
          title={compact ? 'توسيع القائمة' : 'تصغير القائمة'}
        >
          {compact ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
          {!compact && <span>تصغير القائمة</span>}
        </button>
        {!compact && version && <div className="sidebar-version">الإصدار {version}</div>}
      </div>
    </aside>
  )
}
