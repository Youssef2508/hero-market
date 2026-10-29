import { useEffect, useRef, useState } from 'react'
import { BellRing, ChevronDown, KeyRound, Lock, LogOut, PlayCircle } from 'lucide-react'
import { Kbd } from '../ui'
import { formatClock } from '../../lib/time'
import { api, can } from '../../lib/api'
import { formatMoney } from '../../lib/utils'

const ROLE_LABELS = { admin: 'مدير النظام', manager: 'مشرف', cashier: 'كاشير' }

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(t)
  }, [])
  return now
}

// The administrator's notice (owner, 1.5.2, D-090): supplier debt payments handed from a drawer and
// waiting for approval, and rejected ones waiting for their settlement. Checked every 30 seconds.
function PaymentRequestsNotice({ currentUser, onOpen }) {
  const allowed = can(currentUser, 'suppliers.payment_approve')
  const [n, setN] = useState(null)
  useEffect(() => {
    if (!allowed) return undefined
    let stop = false
    const load = () =>
      api('supplierPayments.pendingCount')
        .then((r) => !stop && setN(r))
        .catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [allowed])
  if (!allowed || !n || n.pending + n.disputed === 0) return null
  const label = [
    n.pending > 0 &&
      `${n.pending} طلب سداد مورد بانتظار الاعتماد (${formatMoney(n.pendingAmount)} ج.م)`,
    n.disputed > 0 && `${n.disputed} مرفوض بانتظار التسوية`
  ]
    .filter(Boolean)
    .join('، ')
  return (
    <button
      type="button"
      className="btn btn-warning-soft btn-sm"
      onClick={onOpen}
      title={label}
      aria-label={label}
    >
      <BellRing size={16} aria-hidden="true" />
      <span className="num">{n.pending + n.disputed}</span>
      <span className="hide-sm">طلبات سداد</span>
    </button>
  )
}

function UserMenu({ currentUser, onChangePassword, onLock }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const name = currentUser?.username || '—'
  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden="true">
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="user-menu-text">
          <span className="user-menu-name">{name}</span>
          <span className="user-menu-role">
            {currentUser?.roleName || ROLE_LABELS[currentUser?.role] || currentUser?.role}
          </span>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="dropdown-menu user-menu-dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            className="dropdown-item"
            onClick={() => {
              setOpen(false)
              onChangePassword()
            }}
          >
            <KeyRound size={17} aria-hidden="true" />
            تغيير كلمة المرور
          </button>
          <div className="dropdown-sep" />
          <button
            type="button"
            role="menuitem"
            className="dropdown-item"
            onClick={() => {
              setOpen(false)
              onLock()
            }}
          >
            <Lock size={17} aria-hidden="true" />
            <span className="spacer">قفل الشاشة / تسجيل الخروج</span>
            <Kbd>Ctrl+Alt+L</Kbd>
          </button>
        </div>
      )}
    </div>
  )
}

export default function Topbar({
  title,
  groupLabel,
  icon: Icon,
  currentUser,
  currentShift,
  onOpenShift,
  onCloseShift,
  onLock,
  onChangePassword,
  onOpenPaymentRequests
}) {
  const now = useClock()
  const hasShift = !!(currentShift && currentShift.id)
  // Shift controls only for roles that work shifts (the service enforces shifts.operate too).
  const canShift = !!currentUser?.permissions?.includes('shifts.operate')

  return (
    <header className="topbar">
      <div className="topbar-title">
        {Icon && (
          <span className="topbar-icon" aria-hidden="true">
            <Icon size={20} />
          </span>
        )}
        <div className="topbar-title-text">
          {groupLabel && <span className="topbar-crumb">{groupLabel}</span>}
          <h1>{title}</h1>
        </div>
      </div>

      <div className="topbar-actions">
        <div
          className="topbar-clock num"
          title={now.toLocaleDateString('ar-EG', { dateStyle: 'full' })}
        >
          <span>{now.toLocaleDateString('en-GB')}</span>
          <strong>
            {/* Left-to-right, or the RTL layout shows "AM 04:52" */}
            <bdi dir="ltr">{formatClock(now)}</bdi>
          </strong>
        </div>

        {!canShift ? null : hasShift ? (
          <>
            <span className="shift-chip is-open" title="الوردية الحالية مفتوحة">
              <span className="dot" aria-hidden="true" />
              وردية <span className="num">#{currentShift.id}</span>
            </span>
            <button
              type="button"
              className="btn btn-warning-soft btn-sm"
              onClick={onCloseShift}
              aria-label="إغلاق الوردية"
              title="إغلاق الوردية"
            >
              <LogOut size={16} aria-hidden="true" />
              <span className="hide-sm">إغلاق الوردية</span>
            </button>
          </>
        ) : (
          <>
            <span className="shift-chip is-closed">
              <span className="dot" aria-hidden="true" />
              لا توجد وردية مفتوحة
            </span>
            <button type="button" className="btn btn-primary btn-sm" onClick={onOpenShift}>
              <PlayCircle size={16} aria-hidden="true" />
              فتح وردية
            </button>
          </>
        )}

        <PaymentRequestsNotice currentUser={currentUser} onOpen={onOpenPaymentRequests} />
        <UserMenu currentUser={currentUser} onChangePassword={onChangePassword} onLock={onLock} />
      </div>
    </header>
  )
}
