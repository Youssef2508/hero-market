import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { BrandMark, Wordmark } from '../brand/BrandMark'
import { ThemeToggle } from '../ui'
import { visibleGroups } from './navigation'

export default function Sidebar({
  currentUser,
  activeId,
  onNavigate,
  compact,
  onToggleCompact,
  version
}) {
  const groups = visibleGroups(currentUser)

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
        {groups.map((group) => (
          <div className="nav-group" key={group.id}>
            {compact ? (
              <div className="nav-group-sep" aria-hidden="true" />
            ) : (
              <div className="nav-group-label">{group.label}</div>
            )}
            <ul>
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
                      <Icon size={19} strokeWidth={isActive ? 2.25 : 1.9} aria-hidden="true" />
                      {!compact && <span className="nav-item-label">{item.label}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
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
