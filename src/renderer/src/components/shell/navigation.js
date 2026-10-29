// ─────────────────────────────────────────────────────────────
// Single source of truth for navigation.
// Every destination maps onto the original App state values
// (currentView: 'pos' | 'admin', adminTab: …) because useBarcode
// routes scanner input by those values. `onEnter` reproduces the data loads
// the original management menu cards triggered (see AdminDashboard history).
// `permission` lists the permissions that grant access (any of them). The defaults of the built-in
// roles reproduce the original UI exactly (cashier: selling + tills; manager: everything but users).
// The service enforces the same permissions on every operation; this only hides what is unusable.
// ─────────────────────────────────────────────────────────────
import {
  ScanBarcode,
  LayoutDashboard,
  ChartLine,
  Award,
  Trophy,
  Boxes,
  ArrowLeftRight,
  Undo2,
  Printer,
  ArrowRightLeft,
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
  Archive,
  Landmark
} from 'lucide-react'

// The screens, each defined once (grouped here as they were added; NAV_LAYOUT orders them).
const DEFINED_GROUPS = [
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
      // «الأدراج والتحويلات» was removed (owner, 1.5.2, D-097): its live figures are in the open
      // shift's details («الورديات»), its supplier actions have their own screens below.
      {
        id: 'supplier-pending',
        permission: ['suppliers.pending'],
        label: 'فواتير الموردين المبدئية',
        icon: ReceiptText,
        view: 'admin',
        tab: 'supplier-pending',
        description: 'فاتورة مورد بإجماليها والمدفوع منها الآن؛ الأصناف تُكمل لاحقاً.'
      },
      {
        id: 'supplier-payments',
        permission: ['suppliers.payment_request', 'suppliers.payment_approve'],
        label: 'سداد ديون الموردين',
        icon: HandCoins,
        view: 'admin',
        tab: 'supplier-payments',
        description: 'سداد دين مورد من درج الوردية، واعتماد المدير للطلبات.'
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
    // Owner feedback TREAS-01: the treasury is a top-level section.
    id: 'treasury',
    label: 'الخزنة',
    items: [
      {
        id: 'treasury',
        permission: ['treasury.view'],
        label: 'الخزنة',
        icon: Landmark,
        view: 'admin',
        tab: 'treasury',
        description: 'رصيد الخزنة وحركاتها: الإيداع والسحب وتوريد الورديات والمصروفات والتحصيلات.'
      }
    ]
  },
  {
    id: 'reports',
    label: 'التقارير',
    items: [
      // «الأداء والأرباح» is merged into the dashboard's period statistics (owner, 2026-10-22, D-078).
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
      },
      {
        // PROD-02 (D-071): owner money figures, granted per role.
        id: 'stockvalue',
        permission: ['reports.valuation'],
        label: 'قيمة المخزون',
        icon: Boxes,
        view: 'admin',
        tab: 'stockvalue',
        description: 'قيمة المخزون بسعر الشراء وبسعر البيع، مع الأصناف بالسالب وبدون تكلفة.'
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
        // STOCK-01 (D-071): every movement, the same rows as each product's history.
        id: 'movements',
        permission: ['products.view'],
        label: 'حركات المخزون',
        icon: ArrowLeftRight,
        view: 'admin',
        tab: 'movements',
        description: 'كل حركات المخزون: شراء وبيع ومرتجع وجرد وهالك، بالصنف والنوع والتاريخ.'
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
        label: 'الفواتير',
        icon: ReceiptText,
        view: 'admin',
        tab: 'sales',
        description: 'البحث في الفواتير وإجراء المرتجعات وإعادة الطباعة.',
        onEnter: (c) => c.fetchSalesHistory()
      },
      // One invoice by its number for one action, without «عرض الفواتير» (1.5.1, D-082).
      {
        id: 'returns',
        permission: ['sales.return', 'sales.return_request'],
        label: 'المرتجعات',
        icon: Undo2,
        view: 'admin',
        tab: 'returns',
        description: 'مرتجع صنف أو فاتورة كاملة برقم الفاتورة، من أي وردية.'
      },
      {
        id: 'reprint',
        permission: ['sales.reprint'],
        label: 'إعادة طباعة فاتورة',
        icon: Printer,
        view: 'admin',
        tab: 'reprint',
        description: 'نسخة من فاتورة برقمها، من أي وردية.'
      },
      {
        id: 'payment-change',
        permission: ['sales.change_payment'],
        label: 'تغيير طريقة الدفع',
        icon: ArrowRightLeft,
        view: 'admin',
        tab: 'payment-change',
        description: 'تصحيح طريقة دفع فاتورة برقمها، من أي وردية.'
      },
      {
        id: 'clients',
        permission: ['customers.view', 'customers.manage'],
        label: 'العملاء',
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
        // Separate permissions for import and export (ROLE-01, D-067); the screen shows each part
        // to whoever holds it.
        permission: ['data.import', 'data.export'],
        label: 'استيراد وتصدير',
        icon: FileSpreadsheet,
        view: 'admin',
        tab: 'import',
        description: 'استيراد وتصدير الأصناف والعملاء والموردين بملف Excel (قالب HeroMarket).'
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

// The sidebar's groups (owner, 1.5.2, D-095): the day's selling together, then accounts, stock,
// reports, administration and the system's settings. Every screen appears exactly once; ids,
// routes and permissions are those of its definition above.
const NAV_LAYOUT = [
  {
    id: 'sell',
    label: 'البيع اليومي',
    items: ['pos', 'returns', 'reprint', 'payment-change']
  },
  {
    id: 'accounts',
    label: 'الحسابات',
    items: [
      'sales',
      'clients',
      'suppliers',
      'supplier-pending',
      'supplier-payments',
      'expenses',
      'treasury'
    ]
  },
  {
    id: 'stock',
    label: 'المخزون',
    items: ['inventory', 'movements', 'categories', 'reordering', 'damaged']
  },
  {
    id: 'reports',
    label: 'التقارير',
    items: ['menu', 'advanced-stats', 'cashier-performance', 'bestsellers', 'stockvalue']
  },
  { id: 'admin', label: 'الإدارة', items: ['shifts', 'users', 'roles', 'discounts'] },
  {
    id: 'system',
    label: 'النظام',
    items: ['settings', 'receipts', 'backup', 'import', 'sync', 'logs', 'checks']
  }
]

const DEFINED = new Map(DEFINED_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i]))
export const NAV_GROUPS = NAV_LAYOUT.map((g) => ({
  ...g,
  items: g.items.map((id) => DEFINED.get(id)).filter(Boolean)
}))
/** Screens defined but not placed, or placed twice (a unit test keeps this empty). */
export const LAYOUT_PROBLEMS = (() => {
  const placed = NAV_LAYOUT.flatMap((g) => g.items)
  return [
    ...[...DEFINED.keys()].filter((id) => !placed.includes(id)).map((id) => `not placed: ${id}`),
    ...placed.filter((id) => !DEFINED.has(id)).map((id) => `unknown: ${id}`),
    ...placed.filter((id, i) => placed.indexOf(id) !== i).map((id) => `twice: ${id}`)
  ]
})()

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
    return ALL_NAV_ITEMS.find((i) => i.view === 'admin' && i.tab === adminTab)
  }
  return ALL_NAV_ITEMS.find((i) => i.view === currentView)
}
