import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import LinkStatus from './LinkStatus'
import { activeItem, ALL_NAV_ITEMS, visibleGroups } from './navigation'

const SIDEBAR_KEY = 'heromarket.sidebar' // 'expanded' | 'compact' | absent = automatic
const AUTO_COMPACT_BELOW = 1200
// Below this width the shell is a phone's: the menu slides in and the main areas sit in a bar at
// the bottom, within reach of a thumb (Phase 2 milestone 2). Same screens, same menu, same order.
const PHONE_BELOW = 760
// The areas a phone user reaches in one tap, when their permissions show them. Everything else is
// one more tap away in the full menu («المزيد»).
const PHONE_BAR = ['pos', 'shifts', 'suppliers', 'inventory']
// One word under each icon: the full names do not fit five across a phone.
const PHONE_LABEL = {
  pos: 'البيع',
  shifts: 'الورديات',
  suppliers: 'الموردون',
  inventory: 'الأصناف'
}

function readSidebarPref() {
  try {
    const v = window.localStorage.getItem(SIDEBAR_KEY)
    return v === 'expanded' || v === 'compact' ? v : null
  } catch {
    return null
  }
}

function useWindowWidth() {
  const [w, setW] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return w
}

export default function AppShell({
  currentUser,
  currentView,
  adminTab,
  onNavigate,
  currentShift,
  onOpenShift,
  onCloseShift,
  onLock,
  onChangePassword,
  version,
  children
}) {
  const width = useWindowWidth()
  const phone = width < PHONE_BELOW
  const [pref, setPref] = useState(readSidebarPref)
  const [menuOpen, setMenuOpen] = useState(false)
  const compact = phone ? false : pref ? pref === 'compact' : width < AUTO_COMPACT_BELOW

  const toggleCompact = () => {
    const next = compact ? 'expanded' : 'compact'
    setPref(next)
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next)
    } catch {
      /* ignore */
    }
  }

  const item = activeItem(currentView, adminTab)
  const go = (target) => {
    setMenuOpen(false)
    onNavigate(target)
  }
  const allowed = phone ? visibleGroups(currentUser).flatMap((g) => g.items) : []
  const bar = PHONE_BAR.map((id) => allowed.find((i) => i.id === id)).filter(Boolean)

  return (
    <div
      className={`app-shell ${compact ? 'sidebar-compact' : ''} ${phone ? 'is-phone' : ''} ${menuOpen ? 'menu-open' : ''}`}
      data-view={currentView}
    >
      {phone && menuOpen && (
        <button
          type="button"
          className="phone-menu-backdrop"
          aria-label="إغلاق القائمة"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <Sidebar
        currentUser={currentUser}
        activeId={item?.id}
        onNavigate={go}
        compact={compact}
        onToggleCompact={phone ? () => setMenuOpen(false) : toggleCompact}
        version={version}
      />
      <div className="app-main">
        <Topbar
          title={item?.label || 'هيرو ماركت'}
          groupLabel={item?.group?.label}
          icon={item?.icon}
          currentUser={currentUser}
          currentShift={currentShift}
          onOpenShift={onOpenShift}
          onCloseShift={onCloseShift}
          onLock={onLock}
          onChangePassword={onChangePassword}
          onOpenPaymentRequests={() => {
            const page = ALL_NAV_ITEMS.find((i) => i.id === 'supplier-payments')
            if (page) onNavigate(page)
          }}
        />
        <LinkStatus />
        <main className="app-content" id="main-content">
          {children}
        </main>
        {phone && (
          <nav className="phone-bar" aria-label="الأقسام الرئيسية">
            {bar.map((i) => {
              const Icon = i.icon
              return (
                <button
                  key={i.id}
                  type="button"
                  className={`phone-bar-item ${item?.id === i.id ? 'is-active' : ''}`}
                  aria-current={item?.id === i.id ? 'page' : undefined}
                  onClick={() => go(i)}
                >
                  {Icon && <Icon size={22} aria-hidden="true" />}
                  <span>{PHONE_LABEL[i.id] || i.label}</span>
                </button>
              )
            })}
            <button
              type="button"
              className={`phone-bar-item ${menuOpen ? 'is-active' : ''}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? (
                <X size={22} aria-hidden="true" />
              ) : (
                <Menu size={22} aria-hidden="true" />
              )}
              <span>المزيد</span>
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}
