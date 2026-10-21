// ─────────────────────────────────────────────────────────────
// Single source of truth for navigation.
// Every destination maps onto the original App state values
// (currentView: 'pos' | 'tills' | 'admin', adminTab: …) because useBarcode
// routes scanner input by those values. `onEnter` reproduces the data loads
// the original management menu cards triggered (see AdminDashboard history).
// `permission` lists the permissions that grant access (any of them). The defaults of the built-in
// roles reproduce the original UI exactly (cashier: selling + tills; manager: everything but users).
// The service enforces the same permissions on every operation; this only hides what is unusable.
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
  HandCoins,
  Clock,
  UserCog,
  ScrollText,
  DatabaseBackup,
  FileSpreadsheet,
  FolderTree,
  Cloud,
  ShieldCheck,
  BadgePercent,
  Settings,
  Archive
} from 'lucide-react'

export const NAV_GROUPS = [
  {
    id: 'sell',
    label: 'البيع',
    items: [
      {
        id: 'pos',
        permission: ['pos.sell'],
        label: 'شاشة الكاشير',
        icon: ScanBarcode,
        view: 'pos'
      },
      {
        id: 'tills',
        permission: ['tills.operate'],
        label: 'الأدراج والتحويلات',
        icon: Wallet,
        view: 'tills'
      }
    ]
  },
  {
    id: 'overview',
    label: 'نظرة عامة',
    items: [
      {
        id: 'menu',
        permission: ['reports.view'],
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
    items: [
      {
        id: 'stats',
        permission: ['reports.view'],
        label: 'الأداء والأرباح',
        icon: ChartColumn,
        view: 'admin',
        tab: 'stats',
        description: 'الإيرادات والأرباح والملخص المالي للفترة.',
        onEnter: (c) => c.fetchAnalytics()
      },
      {
        id: 'advanced-stats',
        permission: ['reports.view'],
        label: 'التقارير المتقدمة',
        icon: ChartLine,
        view: 'admin',
        tab: 'advanced-stats',
        description: 'تقارير بفترة مخصصة: ذروة المبيعات، الورديات، أفضل المنتجات.'
      },
      {
        id: 'cashier-performance',
        permission: ['reports.view'],
        label: 'تقييم الكاشيرات',
        icon: Award,
        view: 'admin',
        tab: 'cashier-performance',
        description: 'ترتيب وتقييم أداء كل كاشير مع ملف تفصيلي.'
      },
      {
        id: 'bestsellers',
        permission: ['reports.view'],
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
    items: [
      {
        id: 'inventory',
        permission: ['products.view'],
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
        id: 'categories',
        permission: ['categories.manage'],
        label: 'التصنيفات',
        icon: FolderTree,
        view: 'admin',
        tab: 'categories',
        description: 'تصنيفات الأصناف وترتيبها كما تظهر للكاشير عند التصفح.'
      },
      {
        id: 'reordering',
        permission: ['inventory.reorder'],
        label: 'مساعد الطلبيات',
        icon: ClipboardList,
        view: 'admin',
        tab: 'reordering',
        description: 'أصناف قاربت على النفاد لإنشاء طلبيات شراء.'
      },
      {
        id: 'damaged',
        permission: ['inventory.damaged'],
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
    items: [
      {
        id: 'sales',
        permission: ['sales.view'],
        label: 'الفواتير والمرتجعات',
        icon: ReceiptText,
        view: 'admin',
        tab: 'sales',
        description: 'البحث في الفواتير وإجراء المرتجعات وإعادة الطباعة.',
        onEnter: (c) => c.fetchSalesHistory()
      },
      {
        id: 'clients',
        permission: ['customers.view', 'customers.manage'],
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
        permission: ['suppliers.view', 'suppliers.manage'],
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
        id: 'expenses',
        permission: ['expenses.manage'],
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
    items: [
      {
        id: 'shifts',
        permission: ['shifts.view_all'],
        label: 'الورديات',
        icon: Clock,
        view: 'admin',
        tab: 'shifts',
        description: 'الورديات المغلقة والعجز والزيادة.',
        onEnter: (c) => c.fetchShiftsHistory()
      },
      {
        id: 'users',
        permission: ['users.manage'],
        label: 'المستخدمون',
        icon: UserCog,
        view: 'admin',
        tab: 'users',
        description: 'حسابات الكاشيرات والمشرفين وصلاحياتهم.',
        onEnter: (c) => c.fetchUsersList()
      },
      {
        id: 'roles',
        permission: ['roles.manage'],
        label: 'الأدوار والصلاحيات',
        icon: ShieldCheck,
        view: 'admin',
        tab: 'roles',
        description: 'إنشاء الأدوار وتحديد صلاحيات كل دور.'
      },
      {
        id: 'discounts',
        permission: ['discounts.manage'],
        label: 'الخصومات',
        icon: BadgePercent,
        view: 'admin',
        tab: 'discounts',
        description: 'خصومات الأصناف والفاتورة التي تُطبَّق تلقائياً عند البيع.'
      },
      {
        id: 'settings',
        permission: ['settings.manage'],
        label: 'إعدادات المتجر',
        icon: Settings,
        view: 'admin',
        tab: 'settings',
        description: 'بيانات المتجر والطابعة والجرد الدوري.'
      },
      {
        id: 'receipts',
        permission: ['settings.manage'],
        label: 'تصميم الفاتورة',
        icon: ReceiptText,
        view: 'admin',
        tab: 'receipts',
        description: 'قوالب الفاتورة الحرارية و A4 مع معاينة مباشرة.'
      },
      {
        id: 'logs',
        permission: ['logs.view'],
        label: 'سجل العمليات',
        icon: ScrollText,
        view: 'admin',
        tab: 'logs',
        description: 'كل العمليات الإدارية وأنشطة الكاشيرات بالتوقيت.'
      },
      {
        id: 'backup',
        permission: ['backup.manage'],
        label: 'النسخ الاحتياطي',
        icon: DatabaseBackup,
        view: 'admin',
        tab: 'backup',
        description: 'حفظ واستعادة قاعدة البيانات بأمان.'
      },
      {
        id: 'import',
        // The service requires products, customers and suppliers management together.
        permission: ['products.manage'],
        label: 'استيراد البيانات',
        icon: FileSpreadsheet,
        view: 'admin',
        tab: 'import',
        description: 'استيراد الأصناف والعملاء والموردين من ملف Excel (قالب HeroMarket).'
      },
      {
        // Read-only archive of the cheques kept from before cheques were removed (D-060).
        id: 'checks',
        permission: ['checks.archive'],
        label: 'أرشيف الشيكات',
        icon: Archive,
        view: 'admin',
        tab: 'checks',
        description: 'الشيكات القديمة للعرض فقط؛ الشيكات متوقفة.',
        onEnter: (c) => c.fetchChecksList()
      },
      {
        id: 'sync',
        permission: ['sync.manage'],
        label: 'المزامنة السحابية',
        icon: Cloud,
        view: 'admin',
        tab: 'sync',
        description: 'ربط المتجر بحساب المالك في السحابة، حالة المزامنة، والاسترجاع.'
      }
    ]
  }
]

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g })))

const allowed = (item, user) =>
  !!user &&
  Array.isArray(user.permissions) &&
  (!item.permission || item.permission.some((p) => user.permissions.includes(p)))

/** Navigation groups visible to the given user. */
export function visibleGroups(user) {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => allowed(i, user)) })).filter(
    (g) => g.items.length > 0
  )
}

/** Whether the user can open at least one management screen. */
export function canAccessAdmin(user) {
  return ALL_NAV_ITEMS.some((i) => i.view === 'admin' && allowed(i, user))
}

/** Whether the user may open this admin tab (used to guard the admin router). */
export function canOpenTab(user, tab) {
  const item = ALL_NAV_ITEMS.find((i) => i.view === 'admin' && i.tab === tab)
  return !!item && allowed(item, user)
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
