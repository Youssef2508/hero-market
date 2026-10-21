import { lazy, Suspense } from 'react'
import {
  Banknote,
  ChartColumn,
  ClipboardList,
  Package,
  ReceiptText,
  TriangleAlert,
  Users,
  Clock,
  ShieldAlert
} from 'lucide-react'
import { StatCard, EmptyState } from '../ui'
import { visibleGroups } from '../shell/navigation'
import { formatMoney } from '../../lib/utils'
import { canOpenTab } from '../shell/navigation'

// Back-office screens load on first use, so the cashier screen starts without them (G-19).
const StatsTab = lazy(() => import('./StatsTab'))
const InventoryTab = lazy(() => import('./InventoryTab'))
const ShiftsTab = lazy(() => import('./ShiftsTab'))
const SalesTab = lazy(() => import('./SalesTab'))
const ClientsTab = lazy(() => import('./ClientsTab'))
const SuppliersTab = lazy(() => import('./SuppliersTab'))
const ChecksTab = lazy(() => import('./ChecksTab'))
const TreasuryTab = lazy(() => import('./TreasuryTab'))
const UsersTab = lazy(() => import('./UsersTab'))
const ExpensesTab = lazy(() => import('./ExpensesTab'))
const BestSellersTab = lazy(() => import('./BestSellersTab'))
const BackupTab = lazy(() => import('./BackupTab'))
const ImportTab = lazy(() => import('./ImportTab'))
const ReorderingTab = lazy(() => import('./ReorderingTab'))
const DamagedGoodsTab = lazy(() => import('./DamagedGoodsTab'))
const AdvancedStatsTab = lazy(() => import('./AdvancedStatsTab'))
const CashierPerformanceTab = lazy(() => import('./CashierPerformanceTab'))
const LogsTab = lazy(() => import('./LogsTab'))
const RolesTab = lazy(() => import('./RolesTab'))
const SettingsTab = lazy(() => import('./SettingsTab'))
const ReceiptDesignerTab = lazy(() => import('./ReceiptDesignerTab'))
const TillsManagerTab = lazy(() => import('./TillsManagerTab'))
const DiscountsTab = lazy(() => import('./DiscountsTab'))
const SyncTab = lazy(() => import('./SyncTab'))
const CategoriesTab = lazy(() => import('./CategoriesTab'))

function Overview({ currentUser, currentShift, periodicAnalytics, dbStats, onNavigate }) {
  const groups = visibleGroups(currentUser).filter((g) => g.id !== 'overview')
  const find = (id) => groups.flatMap((g) => g.items).find((i) => i.id === id)
  const go = (id) => {
    const item = find(id)
    if (item) onNavigate(item)
  }
  const pa = periodicAnalytics || {}
  const today = new Date().toLocaleDateString('ar-EG-u-nu-latn', {
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

  // Each tab requires its permission (same list as the sidebar); the service enforces it again.
  if (adminTab !== 'tills' && !canOpenTab(currentUser, adminTab)) {
    return (
      <div className="admin-container">
        <EmptyState
          icon={ShieldAlert}
          title="لا تملك صلاحية فتح هذا القسم"
          text="اطلب من مدير النظام تعديل صلاحيات دورك."
        />
      </div>
    )
  }

  return (
    <div className={`admin-container admin-${adminTab}`}>
      <Suspense
        fallback={
          <div className="loading-state" role="status">
            <span className="spinner" aria-hidden="true" />
            جاري التحميل...
          </div>
        }
      >
        {adminTab === 'menu' && <Overview {...props} />}
        {adminTab === 'stats' && <StatsTab {...props} />}
        {adminTab === 'inventory' && <InventoryTab {...props} />}
        {adminTab === 'shifts' && (
          <ShiftsTab
            currentUser={currentUser}
            currentShift={props.currentShift}
            onOpenShift={props.onOpenShift}
            triggerCustomAlert={props.triggerCustomAlert}
          />
        )}
        {adminTab === 'sales' && <SalesTab {...props} />}
        {adminTab === 'suppliers' && <SuppliersTab {...props} />}
        {adminTab === 'checks' && <ChecksTab {...props} />}
        {adminTab === 'treasury' && (
          <TreasuryTab
            currentUser={currentUser}
            triggerCustomAlert={props.triggerCustomAlert}
            triggerCustomConfirm={props.triggerCustomConfirm}
          />
        )}
        {adminTab === 'expenses' && <ExpensesTab {...props} />}
        {adminTab === 'bestsellers' && <BestSellersTab {...props} />}
        {adminTab === 'users' && <UsersTab {...props} />}
        {adminTab === 'roles' && (
          <RolesTab
            currentUser={currentUser}
            triggerCustomAlert={props.triggerCustomAlert}
            triggerCustomConfirm={props.triggerCustomConfirm}
          />
        )}
        {adminTab === 'settings' && (
          <SettingsTab
            triggerCustomAlert={props.triggerCustomAlert}
            onSettingsChanged={props.onSettingsChanged}
          />
        )}
        {adminTab === 'receipts' && (
          <ReceiptDesignerTab
            triggerCustomAlert={props.triggerCustomAlert}
            triggerCustomConfirm={props.triggerCustomConfirm}
          />
        )}
        {adminTab === 'discounts' && <DiscountsTab triggerCustomAlert={props.triggerCustomAlert} />}
        {adminTab === 'clients' && <ClientsTab {...props} />}
        {adminTab === 'backup' && <BackupTab />}
        {adminTab === 'import' && <ImportTab triggerCustomAlert={props.triggerCustomAlert} />}
        {adminTab === 'categories' && (
          <CategoriesTab
            triggerCustomAlert={props.triggerCustomAlert}
            triggerCustomConfirm={props.triggerCustomConfirm}
          />
        )}
        {adminTab === 'sync' && (
          <SyncTab
            triggerCustomAlert={props.triggerCustomAlert}
            triggerCustomConfirm={props.triggerCustomConfirm}
          />
        )}
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
      </Suspense>
    </div>
  )
}
