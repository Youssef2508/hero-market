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
    description:
      'الموافقة باسم المستخدم وكلمة المرور على مرتجعات الكاشير وفروق إغلاق الوردية التي تتجاوز 50 ج.م'
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
    description: 'لا تمنح أي شاشة؛ تبقى لصحة الأدوار المحفوظة'
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
    description: 'لا تمنح أي شاشة؛ تبقى لصحة الأدوار المحفوظة'
  },
  // Sales back office
  {
    key: 'sales.view',
    module: 'sales',
    label: 'عرض الفواتير',
    description: 'سجل الفواتير وتفاصيلها'
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
    // Preliminary supplier invoice at the till (D-064): total and payment, no lines, no stock.
    key: 'suppliers.pending',
    module: 'suppliers',
    label: 'فاتورة مورد مبدئية',
    description: 'تسجيل فاتورة مورد بإجماليها والمدفوع منها بدون أصناف (تُكمل لاحقاً من الإدارة)'
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
      // Discounts are the administrator's alone (owner, 2026-10-15).
      'discounts.manage',
      // Manual invoice discount: administrators by default; the owner assigns it (D-057).
      'pos.manual_discount',
      // The cheque archive is for administrators only (owner, 2026-10-21, D-060).
      'checks.archive',
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
      'suppliers.manage'
    ]
  },
  {
    key: 'auditor',
    name: 'مراجع (قراءة فقط)',
    description: 'عرض التقارير والسجلات والبيانات دون أي تعديل.',
    permissions: [
      'sales.view',
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
