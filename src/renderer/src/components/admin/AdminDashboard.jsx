import {
  Banknote,
  ChartColumn,
  ClipboardList,
  Package,
  ReceiptText,
  TriangleAlert,
  Users,
  Landmark,
  Clock
} from 'lucide-react'
import { StatCard } from '../ui'
import { visibleGroups } from '../shell/navigation'
import { formatMoney } from '../../lib/utils'
import StatsTab from './StatsTab'
import InventoryTab from './InventoryTab'
import ShiftsTab from './ShiftsTab'
import SalesTab from './SalesTab'
import ClientsTab from './ClientsTab'
import SuppliersTab from './SuppliersTab'
import ChecksTab from './ChecksTab'
import UsersTab from './UsersTab'
import ExpensesTab from './ExpensesTab'
import BestSellersTab from './BestSellersTab'
import BackupTab from './BackupTab'
import ReorderingTab from './ReorderingTab'
import DamagedGoodsTab from './DamagedGoodsTab'
import AdvancedStatsTab from './AdvancedStatsTab'
import CashierPerformanceTab from './CashierPerformanceTab'
import LogsTab from './LogsTab'
import TillsManagerTab from './TillsManagerTab'

function Overview({
  currentUser,
  currentShift,
  periodicAnalytics,
  dbStats,
  checksDueToday,
  onNavigate
}) {
  const groups = visibleGroups(currentUser).filter((g) => g.id !== 'overview')
  const find = (id) => groups.flatMap((g) => g.items).find((i) => i.id === id)
  const go = (id) => {
    const item = find(id)
    if (item) onNavigate(item)
  }
  const pa = periodicAnalytics || {}
  const dueChecks = checksDueToday?.length || 0
  const today = new Date().toLocaleDateString('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })

  return (
    <>
      <section className="overview-hero">
        <div>
          <h1>مرحباً، {currentUser?.username}</h1>
          <p>{today}</p>
        </div>
        <div className="overview-hero-meta">
          <span className="hero-chip">
            <Clock size={15} aria-hidden="true" />
            {currentShift?.id ? `الوردية #${currentShift.id} مفتوحة` : 'لا توجد وردية مفتوحة'}
          </span>
          {dbStats?.lowStock > 0 && (
            <button type="button" className="hero-chip is-alert" onClick={() => go('reordering')}>
              <TriangleAlert size={15} aria-hidden="true" />
              {dbStats.lowStock} صنف تحت حد الطلب
            </button>
          )}
          {dueChecks > 0 && (
            <button type="button" className="hero-chip is-alert" onClick={() => go('checks')}>
              <Landmark size={15} aria-hidden="true" />
              {dueChecks} شيك مستحق اليوم
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="kpi-title">
        <h2 id="kpi-title" className="overview-section-title">
          <ChartColumn size={16} aria-hidden="true" />
          ملخص آخر 7 أيام
        </h2>
        <div className="stat-grid">
          <StatCard
            icon={Banknote}
            tone="accent"
            label="إجمالي المبيعات"
            value={`${formatMoney(pa.totalSales)} ج.م`}
            onClick={() => go('stats')}
          />
          <StatCard
            icon={ChartColumn}
            tone={pa.netProfit < 0 ? 'danger' : 'success'}
            label="صافي الربح"
            value={`${formatMoney(pa.netProfit)} ج.م`}
            meta="بعد خصم المصروفات والتوالف"
            onClick={() => go('stats')}
          />
          <StatCard
            icon={ReceiptText}
            tone="info"
            label="عدد الفواتير"
            value={pa.invoiceCount || 0}
            onClick={() => go('sales')}
          />
          <StatCard
            icon={Users}
            tone="warning"
            label="ديون العملاء المستحقة"
            value={`${formatMoney(pa.outstandingDebt)} ج.م`}
            onClick={() => go('clients')}
          />
          <StatCard
            icon={Package}
            tone="neutral"
            label="الأصناف المسجلة"
            value={dbStats?.totalItems || 0}
            onClick={() => go('inventory')}
          />
          <StatCard
            icon={ClipboardList}
            tone={dbStats?.lowStock > 0 ? 'danger' : 'success'}
            label="نواقص المخزون"
            value={dbStats?.lowStock || 0}
            onClick={() => go('reordering')}
          />
        </div>
      </section>

      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`grp-${group.id}`}>
          <h2 id={`grp-${group.id}`} className="overview-section-title">
            {group.label}
          </h2>
          <div className="shortcut-grid">
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  className="shortcut-card"
                  onClick={() => onNavigate(item)}
                >
                  <span className="shortcut-card-icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <span>
                    <span className="shortcut-card-title">{item.label}</span>
                    {item.description && (
                      <span className="shortcut-card-desc">{item.description}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}

/**
 * Management area router. Navigation lives in the sidebar (components/shell);
 * this component renders the screen for the current `adminTab`.
 * Tabs receive the admin controller props they already expected.
 */
export default function AdminDashboard(props) {
  const { adminTab, currentUser } = props

  return (
    <div className={`admin-container admin-${adminTab}`}>
      {adminTab === 'menu' && <Overview {...props} />}
      {adminTab === 'stats' && <StatsTab {...props} />}
      {adminTab === 'inventory' && <InventoryTab {...props} />}
      {adminTab === 'shifts' && (
        <ShiftsTab shiftsHistory={props.shiftsHistory} shiftAudits={props.shiftAudits} />
      )}
      {adminTab === 'sales' && <SalesTab {...props} />}
      {adminTab === 'suppliers' && <SuppliersTab {...props} />}
      {adminTab === 'checks' && <ChecksTab {...props} />}
      {adminTab === 'expenses' && <ExpensesTab {...props} />}
      {adminTab === 'bestsellers' && <BestSellersTab {...props} />}
      {adminTab === 'users' && currentUser && currentUser.role === 'admin' && (
        <UsersTab {...props} />
      )}
      {adminTab === 'clients' && <ClientsTab {...props} />}
      {adminTab === 'backup' && <BackupTab />}
      {adminTab === 'reordering' && <ReorderingTab />}
      {adminTab === 'advanced-stats' && <AdvancedStatsTab />}
      {adminTab === 'cashier-performance' && <CashierPerformanceTab />}
      {adminTab === 'damaged' && <DamagedGoodsTab {...props} />}
      {adminTab === 'logs' && <LogsTab />}
      {adminTab === 'tills' && (
        <TillsManagerTab
          currentUser={props.currentUser}
          currentShift={props.currentShift}
          triggerCustomAlert={props.triggerCustomAlert}
          triggerCustomConfirm={props.triggerCustomConfirm}
        />
      )}
    </div>
  )
}
