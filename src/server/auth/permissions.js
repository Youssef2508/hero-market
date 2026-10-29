'use strict'
// Permission catalogue: the single source of truth for what can be granted to a role.
// Keys are "<module>.<action>". Each existing UI gate maps to one of these (see .docs/SECURITY_AND_RELEASE.md §2).

const PERMISSIONS = [
  // Selling
  {
    key: 'pos.sell',
    module: 'pos',
    label: 'البيع على شاشة الكاشير',
    description: 'فتح شاشة الكاشير وإتمام عمليات البيع النقدي والمحافظ'
  },
  {
    key: 'pos.credit',
    module: 'pos',
    label: 'البيع الآجل والدفع الجزئي',
    description: 'إتمام بيع آجل أو دفع جزئي على حساب عميل'
  },
  {
    // Owner decision 2026-10-21 (D-057): a fixed EGP amount off the current invoice, with a reason.
    // Not given to cashiers by default; the owner assigns it to roles.
    key: 'pos.manual_discount',
    module: 'pos',
    label: 'خصم يدوي على الفاتورة',
    description: 'خصم مبلغ ثابت من إجمالي فاتورة البيع الحالية مع ذكر السبب'
  },
  {
    key: 'pos.approve',
    module: 'pos',
    label: 'اعتماد عمليات الكاشير',
    description: 'الموافقة باسم المستخدم وكلمة المرور على مرتجعات الكاشير'
  },
  // Shifts and tills
  {
    key: 'shifts.operate',
    module: 'shifts',
    label: 'فتح وإغلاق الوردية الخاصة',
    description: 'فتح الوردية وإغلاقها وجرد الدرج الدوري'
  },
  {
    key: 'shifts.multi_till',
    module: 'shifts',
    // Momkn and wallet-service tills are not used by the store (owner, 2026-10-21, D-063).
    label: 'أرصدة مكن والمحافظ (غير مستخدمة)',
    description: 'لا تمنح أي شاشة؛ تبقى لصحة الأدوار المحفوظة',
    // Not shown in the roles screen (owner, 2026-10-22, D-078); the key stays valid.
    hidden: true
  },
  {
    key: 'shifts.view_all',
    module: 'shifts',
    label: 'الورديات',
    description: 'عرض جميع الورديات وجرد الأدراج'
  },
  {
    // Blind close (owner feedback PAY-01): without it, expected amounts stay hidden until the close
    // is confirmed; the service refuses them, the screens only follow.
    key: 'shifts.view_expected',
    module: 'shifts',
    label: 'عرض المبالغ المتوقعة قبل الإغلاق',
    description: 'رؤية المتوقع في الدرج وكل طريقة دفع أثناء الوردية وقبل تأكيد الإغلاق'
  },
  {
    key: 'tills.operate',
    module: 'tills',
    label: 'الأدراج والتحويلات',
    description: 'صفحة الدرج وطرق الدفع للوردية الحالية (المبالغ لمن يملك عرض المتوقع فقط)'
  },
  {
    key: 'tills.manage',
    module: 'tills',
    label: 'حركات مكن والمحافظ (غير مستخدمة)',
    description: 'لا تمنح أي شاشة؛ تبقى لصحة الأدوار المحفوظة',
    hidden: true
  },
  // Sales back office
  {
    key: 'sales.view',
    module: 'sales',
    label: 'عرض الفواتير',
    description: 'سجل الفواتير وتفاصيلها: فواتير الوردية المفتوحة للمستخدم فقط'
  },
  {
    // Which invoices may be browsed, not what may be done with them (D-081). The actions reach any
    // invoice by its number with their own permission (D-082).
    key: 'sales.view_all',
    module: 'sales',
    label: 'كل الفواتير',
    description:
      'تصفح فواتير كل الكاشيرات والورديات، المفتوحة والمغلقة. بدونها تعرض شاشة الفواتير فواتير وردية المستخدم المفتوحة فقط'
  },
  {
    key: 'sales.reprint',
    module: 'sales',
    label: 'إعادة طباعة الفواتير',
    description: 'طباعة نسخة من فاتورة سابقة'
  },
  {
    key: 'sales.return',
    module: 'sales',
    label: 'المرتجعات',
    description: 'إرجاع صنف أو فاتورة كاملة'
  },
  {
    key: 'sales.return_request',
    module: 'sales',
    label: 'طلب مرتجع بموافقة المشرف',
    description: 'فتح الفاتورة برقمها وتنفيذ مرتجع بعد موافقة المشرف وكتابة السبب'
  },
  {
    key: 'sales.change_payment',
    module: 'sales',
    label: 'تغيير طريقة دفع فاتورة',
    description: 'تصحيح طريقة الدفع لفاتورة في وردية مفتوحة مع ذكر السبب'
  },
  // Catalogue and stock
  {
    key: 'products.view',
    module: 'products',
    label: 'عرض الأصناف والمخزون',
    description: 'قائمة الأصناف والكميات'
  },
  {
    key: 'products.manage',
    module: 'products',
    label: 'إدارة الأصناف',
    description: 'إضافة وتعديل وحذف الأصناف والأسعار'
  },
  {
    key: 'products.view_cost',
    module: 'products',
    label: 'عرض سعر التكلفة والربح',
    description: 'رؤية التكلفة وهوامش الربح'
  },
  {
    key: 'inventory.damaged',
    module: 'inventory',
    label: 'التوالف والهوالك',
    description: 'تسجيل وحذف التوالف'
  },
  {
    key: 'categories.manage',
    module: 'products',
    label: 'إدارة تصنيفات الأصناف',
    description: 'إنشاء وتعديل وترتيب وإيقاف التصنيفات وتوزيع الأصناف عليها'
  },
  {
    key: 'discounts.manage',
    module: 'products',
    label: 'إدارة الخصومات',
    description: 'إنشاء وتعديل وتفعيل قواعد الخصم التي تُطبَّق تلقائياً عند البيع'
  },
  {
    key: 'inventory.adjust',
    module: 'inventory',
    label: 'جرد وتسوية المخزون',
    description: 'تسجيل الجرد الفعلي وتسويات الكميات مع سبب إلزامي'
  },
  {
    key: 'inventory.reorder',
    module: 'inventory',
    label: 'مساعد الطلبيات',
    description: 'تقارير النواقص واقتراح الطلبيات'
  },
  // Parties
  {
    key: 'customers.view',
    module: 'customers',
    label: 'عرض العملاء',
    description: 'قائمة العملاء وكشوف الحساب'
  },
  {
    key: 'customers.manage',
    module: 'customers',
    label: 'إدارة العملاء',
    description: 'إضافة وتعديل وحذف العملاء'
  },
  {
    // A code typed by hand instead of the automatic one, and changing a customer's code (D-086).
    key: 'customers.code',
    module: 'customers',
    label: 'تحديد كود العميل يدوياً',
    description:
      'كتابة كود العميل بدلاً من الكود التلقائي عند الإضافة، وتغيير كود عميل موجود. بدونها يأخذ العميل الكود التلقائي'
  },
  {
    key: 'customers.payments',
    module: 'customers',
    label: 'تحصيل مديونيات العملاء',
    description: 'تسجيل سداد من عميل'
  },
  {
    key: 'suppliers.view',
    module: 'suppliers',
    label: 'عرض الموردين',
    description: 'قائمة الموردين وكشوف الحساب'
  },
  {
    key: 'suppliers.manage',
    module: 'suppliers',
    label: 'إدارة الموردين والمشتريات',
    description: 'إضافة الموردين وفواتير الشراء والسداد'
  },
  {
    // SUP-03 (D-070): what was owed between the store and a supplier before HeroMarket. Money:
    // administrators by default; the owner grants it to other roles.
    key: 'suppliers.opening',
    module: 'suppliers',
    label: 'الرصيد الافتتاحي للموردين',
    description: 'تسجيل أو تصحيح ما كان مستحقاً للمورد أو عليه قبل بدء العمل بالبرنامج'
  },
  {
    // Preliminary supplier invoice at the till (D-064): total and payment, no lines, no stock.
    key: 'suppliers.pending',
    module: 'suppliers',
    label: 'فاتورة مورد مبدئية',
    description: 'تسجيل فاتورة مورد بإجماليها والمدفوع منها بدون أصناف (تُكمل لاحقاً من الإدارة)'
  },
  {
    // Correcting a recorded purchase's reference and notes (owner, 1.5.2, D-088, D-094). On an
    // upgrade it is granted only to roles that already manage purchases (`requires`).
    key: 'suppliers.purchase_edit',
    module: 'suppliers',
    label: 'تعديل بيانات فاتورة شراء مسجلة',
    description:
      'تصحيح رقم فاتورة الشراء وملاحظاتها بعد تسجيلها (يُسجَّل في سجل الأحداث). الكميات والأسعار تُصحَّح بمرتجع مشتريات وفاتورة جديدة',
    requires: 'suppliers.manage'
  },
  {
    // Supplier debt-payment requests (owner, 1.5.2, D-090): cash from the drawer, the balance after
    // an administrator approves.
    key: 'suppliers.payment_request',
    module: 'suppliers',
    label: 'طلب سداد دين مورد من الدرج',
    description:
      'دفع مبلغ من درج الوردية لمورد عن دين سابق. يخرج المبلغ من الدرج فوراً، ولا يُخصم من حساب المورد إلا بعد اعتماد المدير'
  },
  {
    key: 'suppliers.payment_approve',
    module: 'suppliers',
    label: 'اعتماد طلبات سداد الموردين',
    description:
      'اعتماد أو رفض طلبات سداد الموردين المدفوعة من الأدراج، وتسوية الطلب المرفوض بعد دفعه (استرداد أو احتساب أو خسارة)'
  },
  {
    key: 'checks.manage',
    module: 'finance',
    // Cheque processing is removed (owner, 2026-10-21, D-060): this key grants nothing any more and
    // stays only so stored roles remain valid. The old records are kept in checks_register.
    label: 'الشيكات (متوقفة)',
    description: 'لم تعد تمنح أي صلاحية؛ تسجيل الشيكات وسدادها وحذفها متوقف'
  },
  {
    key: 'checks.archive',
    module: 'finance',
    label: 'أرشيف الشيكات (عرض فقط)',
    description: 'عرض الشيكات القديمة المسجلة قبل إيقاف الشيكات، بدون تعديل أو حذف'
  },
  {
    key: 'expenses.manage',
    module: 'finance',
    label: 'المصروفات',
    description: 'تسجيل مصروفاته وعرضها وحذفها'
  },
  {
    key: 'expenses.view_all',
    module: 'finance',
    label: 'كل المصروفات',
    description: 'عرض وحذف مصروفات كل المستخدمين ومصروفات الخزنة'
  },
  {
    key: 'expenses.categories',
    module: 'finance',
    label: 'تصنيفات المصروفات',
    description: 'إضافة تصنيفات المصروفات وتعديلها وإيقافها'
  },
  {
    key: 'treasury.view',
    module: 'finance',
    label: 'عرض الخزنة',
    description: 'رصيد الخزنة وحركاتها'
  },
  {
    key: 'treasury.manage',
    module: 'finance',
    label: 'حركات الخزنة',
    description: 'إيداع وسحب وتسوية، ومصروفات وتحصيلات وسداد من الخزنة مباشرة بدون وردية'
  },
  // Reports and administration
  {
    key: 'reports.view',
    module: 'reports',
    label: 'التقارير والإحصاءات',
    description: 'لوحة الإدارة والأداء والتقارير المتقدمة وتقييم الكاشيرات'
  },
  { key: 'logs.view', module: 'admin', label: 'سجل الأحداث', description: 'عرض سجل النظام' },
  {
    key: 'backup.manage',
    module: 'admin',
    label: 'النسخ الاحتياطي والاستعادة',
    description: 'إنشاء نسخة احتياطية واستعادتها'
  },
  {
    // PROD-02 / DASH-01 (D-071): stock value at cost and at selling price, and what suppliers
    // and customers are owed – owner money figures, granted per role by an administrator.
    key: 'reports.valuation',
    module: 'reports',
    label: 'قيمة المخزون والأرصدة',
    description: 'قيمة المخزون بسعر الشراء وبسعر البيع، والمستحق للموردين وعلى العملاء'
  },
  {
    // Separate from export (ROLE-01, D-067): importing writes new products, customers, suppliers
    // and opening balances; it never changes existing records or history.
    key: 'data.import',
    module: 'admin',
    label: 'استيراد البيانات',
    description: 'استيراد الأصناف والعملاء والموردين من ملف Excel (قالب HeroMarket)'
  },
  {
    // Reading only (DATA-01, D-067); separate from import.
    key: 'data.export',
    module: 'admin',
    label: 'تصدير البيانات',
    description: 'تصدير الأصناف والعملاء والموردين في ملف Excel بقالب الاستيراد نفسه'
  },
  {
    key: 'users.manage',
    module: 'admin',
    label: 'إدارة المستخدمين',
    description: 'إضافة وتعديل وتعطيل الحسابات وتعيين الأدوار'
  },
  {
    key: 'roles.manage',
    module: 'admin',
    label: 'إدارة الأدوار والصلاحيات',
    description: 'إنشاء الأدوار وتعديل صلاحياتها'
  },
  {
    key: 'settings.manage',
    module: 'admin',
    label: 'إعدادات المتجر',
    description: 'بيانات المتجر والفواتير والطابعة'
  },
  {
    key: 'system.reset',
    module: 'admin',
    label: 'إعادة ضبط بيانات التشغيل',
    description: 'مسح بيانات التشغيل (إجراء خطير)'
  },
  {
    key: 'sync.manage',
    module: 'admin',
    label: 'المزامنة السحابية',
    description: 'ربط المتجر بالسحابة، حالة المزامنة، والاسترجاع بعد استعادة نسخة احتياطية'
  }
]

const KEYS = new Set(PERMISSIONS.map((p) => p.key))
const ALL = PERMISSIONS.map((p) => p.key)

const MANAGEMENT = ALL.filter(
  (k) =>
    ![
      'users.manage',
      'roles.manage',
      'system.reset',
      'shifts.multi_till',
      'tills.manage',
      // Bulk data in and out: administrators by default; the owner assigns them (D-067).
      'data.import',
      'data.export',
      'suppliers.opening',
      'reports.valuation',
      // Discounts are the administrator's alone (owner, 2026-10-15).
      'discounts.manage',
      // Manual invoice discount: administrators by default; the owner assigns it (D-057).
      'pos.manual_discount',
      // Customer codes by hand: administrators by default (D-086).
      'customers.code',
      // Supplier debt-payment requests and their approval: administrators by default; the owner
      // grants the request to a cashier (D-090).
      'suppliers.payment_request',
      'suppliers.payment_approve',
      // The cheque archive is for administrators only (owner, 2026-10-21, D-060).
      'checks.archive',
      // Every cashier's invoices: administrators by default; supervisors see their own shift's (D-081).
      'sales.view_all',
      // Owner-only money (owner feedback phase D, D-062): expected amounts before the close, every
      // user's expenses, the treasury and payment method corrections.
      'shifts.view_expected',
      'expenses.view_all',
      'treasury.view',
      'treasury.manage',
      'sales.change_payment',
      // The cloud link and recovery are the administrator's alone (stage 4 phase 4).
      'sync.manage'
    ].includes(k)
)

// Built-in roles. Existing users map: admin → super_admin, manager → manager, cashier → cashier.
const SYSTEM_ROLES = [
  {
    key: 'super_admin',
    name: 'مدير النظام',
    description:
      'كل الصلاحيات. لا يمكن تعديل صلاحياته أو حذفه، ويجب أن يبقى حساب نشط واحد على الأقل بهذا الدور.',
    protected: true,
    permissions: ALL
  },
  {
    key: 'store_admin',
    name: 'مدير المتجر',
    description: 'كل صلاحيات التشغيل والإدارة عدا إعادة ضبط النظام.',
    permissions: ALL.filter((k) => k !== 'system.reset')
  },
  {
    key: 'manager',
    name: 'مشرف',
    description:
      'شاشات الإدارة والتقارير بدون إدارة المستخدمين والأدوار (نفس صلاحيات المشرف قبل التحديث).',
    permissions: MANAGEMENT
  },
  {
    key: 'cashier',
    name: 'كاشير',
    description: 'البيع وإدارة ورديته وحركات الأدراج.',
    permissions: [
      'pos.sell',
      'pos.credit',
      'shifts.operate',
      'tills.operate',
      'sales.return_request',
      'suppliers.pending'
    ]
  },
  {
    key: 'inventory',
    name: 'أمين مخزن / مشتريات',
    description: 'الأصناف والمخزون والتوالف والطلبيات والموردين.',
    permissions: [
      'products.view',
      'products.manage',
      'categories.manage',
      'products.view_cost',
      'inventory.damaged',
      'inventory.adjust',
      'inventory.reorder',
      'suppliers.view',
      'suppliers.manage',
      'suppliers.purchase_edit'
    ]
  },
  {
    key: 'auditor',
    name: 'مراجع (قراءة فقط)',
    description: 'عرض التقارير والسجلات والبيانات دون أي تعديل.',
    permissions: [
      'sales.view',
      // A read-only reviewer has no shift: the invoices to review are everyone's (D-081). It cannot
      // reprint, return or change an invoice.
      'sales.view_all',
      'products.view',
      'products.view_cost',
      'customers.view',
      'suppliers.view',
      'shifts.view_all',
      'reports.view',
      'logs.view'
    ]
  }
]

// Legacy users.role text → built-in role key.
const LEGACY_ROLE_MAP = { admin: 'super_admin', manager: 'manager', cashier: 'cashier' }
// Built-in role key → legacy role text the renderer still understands for labels.
const ROLE_TO_LEGACY = {
  super_admin: 'admin',
  store_admin: 'admin',
  manager: 'manager',
  cashier: 'cashier'
}

module.exports = { PERMISSIONS, KEYS, ALL, SYSTEM_ROLES, LEGACY_ROLE_MAP, ROLE_TO_LEGACY }
