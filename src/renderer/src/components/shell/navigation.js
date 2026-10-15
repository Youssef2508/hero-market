// ─────────────────────────────────────────────────────────────
// Single source of truth for navigation.
// Every destination maps onto the original App state values
// (currentView: 'pos' | 'tills' | 'admin', adminTab: …) because useBarcode
// routes scanner input by those values. `onEnter` reproduces the data loads
// the original management menu cards triggered (see AdminDashboard history).
// Permissions mirror the original UI exactly.
// ─────────────────────────────────────────────────────────────
import {
  ScanBarcode,
  Wallet,
  LayoutDashboard,
  ChartColumn,
  ChartLine,
  Award,
  Trophy,
  Package,
  ClipboardList,
  PackageX,
  ReceiptText,
  Users,
  Truck,
  Landmark,
  HandCoins,
  Clock,
  UserCog,
  ScrollText,
  DatabaseBackup
} from 'lucide-react'

const MANAGERS = ['admin', 'manager']

export const NAV_GROUPS = [
  {
    id: 'sell',
    label: 'البيع',
    items: [
      { id: 'pos', label: 'شاشة الكاشير', icon: ScanBarcode, view: 'pos' },
      { id: 'tills', label: 'الأدراج والتحويلات', icon: Wallet, view: 'tills' }
    ]
  },
  {
    id: 'overview',
    label: 'نظرة عامة',
    roles: MANAGERS,
    items: [
      {
        id: 'menu',
        label: 'لوحة الإدارة',
        icon: LayoutDashboard,
        view: 'admin',
        tab: 'menu',
        description: 'ملخص سريع والوصول لكل الأقسام.',
        onEnter: (c) => c.fetchAdminData()
      }
    ]
  },
  {
    id: 'reports',
    label: 'التقارير',
    roles: MANAGERS,
    items: [
      {
        id: 'stats',
        label: 'الأداء والأرباح',
        icon: ChartColumn,
        view: 'admin',
        tab: 'stats',
        description: 'الإيرادات والأرباح والملخص المالي للفترة.',
        onEnter: (c) => c.fetchAnalytics()
      },
      {
        id: 'advanced-stats',
        label: 'التقارير المتقدمة',
        icon: ChartLine,
        view: 'admin',
        tab: 'advanced-stats',
        description: 'تقارير بفترة مخصصة: ذروة المبيعات، الورديات، أفضل المنتجات.'
      },
      {
        id: 'cashier-performance',
        label: 'تقييم الكاشيرات',
        icon: Award,
        view: 'admin',
        tab: 'cashier-performance',
        description: 'ترتيب وتقييم أداء كل كاشير مع ملف تفصيلي.'
      },
      {
        id: 'bestsellers',
        label: 'تقرير المنتجات',
        icon: Trophy,
        view: 'admin',
        tab: 'bestsellers',
        description: 'الأصناف الأكثر مبيعاً والأصناف الراكدة.',
        onEnter: (c) => c.fetchBestSellers(c.bsPeriod)
      }
    ]
  },
  {
    id: 'stock',
    label: 'المخزون',
    roles: MANAGERS,
    items: [
      {
        id: 'inventory',
        label: 'الأصناف والمخزن',
        icon: Package,
        view: 'admin',
        tab: 'inventory',
        description: 'الأسعار والكميات وحد الطلب لكل صنف.',
        onEnter: (c) => {
          c.setAdminSearch('')
          c.fetchInventoryPage(1, '')
        }
      },
      {
        id: 'reordering',
        label: 'مساعد الطلبيات',
        icon: ClipboardList,
        view: 'admin',
        tab: 'reordering',
        description: 'أصناف قاربت على النفاد لإنشاء طلبيات شراء.'
      },
      {
        id: 'damaged',
        label: 'التوالف والهوالك',
        icon: PackageX,
        view: 'admin',
        tab: 'damaged',
        description: 'تسجيل البضائع التالفة وخصمها من المخزون.',
        onEnter: (c) => c.fetchDamagedGoods()
      }
    ]
  },
  {
    id: 'accounts',
    label: 'الحسابات',
    roles: MANAGERS,
    items: [
      {
        id: 'sales',
        label: 'الفواتير والمرتجعات',
        icon: ReceiptText,
        view: 'admin',
        tab: 'sales',
        description: 'البحث في الفواتير وإجراء المرتجعات وإعادة الطباعة.',
        onEnter: (c) => c.fetchSalesHistory()
      },
      {
        id: 'clients',
        label: 'العملاء والحسابات',
        icon: Users,
        view: 'admin',
        tab: 'clients',
        description: 'حسابات الآجل وسداد الديون ونقاط الولاء.',
        onEnter: (c) => {
          c.fetchClientsList()
          c.fetchClientStats()
          c.setSelectedAdminClient(null)
        }
      },
      {
        id: 'suppliers',
        label: 'الموردون والمشتريات',
        icon: Truck,
        view: 'admin',
        tab: 'suppliers',
        description: 'فواتير الشراء وحسابات ديون الموردين.',
        onEnter: (c) => {
          c.fetchSuppliersList()
          c.setSelectedSupplier(null)
        }
      },
      {
        id: 'checks',
        label: 'الشيكات',
        icon: Landmark,
        view: 'admin',
        tab: 'checks',
        description: 'الشيكات الصادرة والواردة وتواريخ الاستحقاق.',
        onEnter: (c) => {
          c.fetchChecksList()
          c.fetchChecksDueToday()
        }
      },
      {
        id: 'expenses',
        label: 'المصروفات',
        icon: HandCoins,
        view: 'admin',
        tab: 'expenses',
        description: 'المصروفات اليومية والتشغيلية وتصنيفها.',
        onEnter: (c) => c.fetchExpensesList()
      }
    ]
  },
  {
    id: 'admin',
    label: 'الإدارة',
    roles: MANAGERS,
    items: [
      {
        id: 'shifts',
        label: 'سجل الورديات',
        icon: Clock,
        view: 'admin',
        tab: 'shifts',
        description: 'الورديات المغلقة والعجز والزيادة وجرد الدرج.',
        onEnter: (c) => c.fetchShiftsHistory()
      },
      {
        id: 'users',
        label: 'المستخدمون',
        icon: UserCog,
        view: 'admin',
        tab: 'users',
        roles: ['admin'],
        description: 'حسابات الكاشيرات والمشرفين وصلاحياتهم.',
        onEnter: (c) => c.fetchUsersList()
      },
      {
        id: 'logs',
        label: 'سجل العمليات',
        icon: ScrollText,
        view: 'admin',
        tab: 'logs',
        description: 'كل العمليات الإدارية وأنشطة الكاشيرات بالتوقيت.'
      },
      {
        id: 'backup',
        label: 'النسخ الاحتياطي',
        icon: DatabaseBackup,
        view: 'admin',
        tab: 'backup',
        description: 'حفظ واستعادة قاعدة البيانات بأمان.'
      }
    ]
  }
]

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g })))

const allowed = (roles, user) => !roles || (user && roles.includes(user.role))

/** Navigation groups visible to the given user (same rules as the original UI). */
export function visibleGroups(user) {
  return NAV_GROUPS.filter((g) => allowed(g.roles, user))
    .map((g) => ({ ...g, items: g.items.filter((i) => allowed(i.roles, user)) }))
    .filter((g) => g.items.length > 0)
}

/** The nav item matching the current App state. */
export function activeItem(currentView, adminTab) {
  if (currentView === 'admin') {
    // The legacy admin "tills" tab renders the same screen as the top-level tills view.
    if (adminTab === 'tills') return ALL_NAV_ITEMS.find((i) => i.id === 'tills')
    return ALL_NAV_ITEMS.find((i) => i.view === 'admin' && i.tab === adminTab)
  }
  return ALL_NAV_ITEMS.find((i) => i.view === currentView)
}
