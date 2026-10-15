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
    label: 'أرصدة مكن وكاش المحافظ والإغلاق المتقدم',
    description: 'إدخال أرصدة بداية مكن والمحافظ وإغلاق الوردية متعدد الأدراج'
  },
  {
    key: 'shifts.view_all',
    module: 'shifts',
    label: 'سجل الورديات',
    description: 'عرض جميع الورديات وجرد الأدراج'
  },
  {
    key: 'tills.operate',
    module: 'tills',
    label: 'حركات الأدراج والتحويلات',
    description: 'تسجيل حركات مكن والمحافظ والخزنة'
  },
  {
    key: 'tills.manage',
    module: 'tills',
    label: 'حذف وطباعة حركات الأدراج',
    description: 'حذف حركات مكن والمحافظ وطباعة تقارير الجرد'
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
    key: 'checks.manage',
    module: 'finance',
    label: 'الشيكات',
    description: 'تسجيل الشيكات وتحديث حالتها'
  },
  {
    key: 'expenses.manage',
    module: 'finance',
    label: 'المصروفات',
    description: 'تسجيل وحذف المصروفات'
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
      'discounts.manage'
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
      'sales.return_request'
    ]
  },
  {
    key: 'inventory',
    name: 'أمين مخزن / مشتريات',
    description: 'الأصناف والمخزون والتوالف والطلبيات والموردين.',
    permissions: [
      'products.view',
      'products.manage',
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
