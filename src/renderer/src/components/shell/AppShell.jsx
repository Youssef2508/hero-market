import { useEffect, useState } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { activeItem } from './navigation'

const SIDEBAR_KEY = 'heromarket.sidebar' // 'expanded' | 'compact' | absent = automatic
const AUTO_COMPACT_BELOW = 1200

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
  onAudit,
  onLock,
  onChangePassword,
  version,
  children
}) {
  const width = useWindowWidth()
  const [pref, setPref] = useState(readSidebarPref)
  const compact = pref ? pref === 'compact' : width < AUTO_COMPACT_BELOW

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

  return (
    <div className={`app-shell ${compact ? 'sidebar-compact' : ''}`} data-view={currentView}>
      <Sidebar
        currentUser={currentUser}
        activeId={item?.id}
        onNavigate={onNavigate}
        compact={compact}
        onToggleCompact={toggleCompact}
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
          onAudit={onAudit}
          onLock={onLock}
          onChangePassword={onChangePassword}
        />
        <main className="app-content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  )
}
