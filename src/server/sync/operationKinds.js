'use strict'
// What each service operation is, for the cloud way in (Phase 2, D-101). One business, one set of
// accounts: the cloud never has its own rule for an operation. This table only says where an
// operation started from the internet is carried out, and how work done on both sides while they
// were apart is brought together (PHASE2_ARCHITECTURE.md §3, §6).
//
//   read    – shows data; answered from the cloud's copy
//   add     – a new fact (sale, return, payment, purchase, movement, shift): both sides' are kept
//   merge   – master data: merged field by field; the shop's value wins a same-field conflict
//   state   – changes the state of an existing record (close, approve, cancel, complete, reverse)
//   linked  – needs the two sides connected (barcode change, deleting a record, reset)
//   device  – belongs to the device or the side it runs on (session, reservation, backup, link)
//
// Every operation not listed is a read. tests/service/operationKinds.test.js fails when an
// operation that changes data is missing here, so a new operation cannot be forgotten.
const KINDS = {
  'auth.setup': 'device',
  'auth.login': 'device',
  'auth.setPassword': 'merge',
  'auth.recover': 'merge',
  'auth.logout': 'device',
  'auth.changePassword': 'merge',
  'auth.newRecoveryCode': 'merge',
  'shifts.open': 'add',
  'shifts.audit': 'add',
  'shifts.auditNote': 'merge',
  'shifts.close': 'state',
  'pos.checkout': 'add',
  'products.create': 'merge',
  'products.update': 'merge',
  'products.changeBarcode': 'linked',
  'products.delete': 'linked',
  'inventory.count': 'add',
  'productUnits.save': 'merge',
  'sales.returnItem': 'add',
  'sales.returnEntire': 'add',
  'sales.changePaymentMethod': 'state',
  'clients.create': 'merge',
  'clients.update': 'merge',
  'clients.delete': 'merge',
  'clients.repay': 'add',
  'suppliers.create': 'merge',
  'suppliers.update': 'merge',
  'suppliers.setOpening': 'add',
  'suppliers.addPurchase': 'add',
  'suppliers.repay': 'add',
  'suppliers.delete': 'linked',
  'suppliers.updatePurchase': 'merge',
  'suppliers.returnPurchase': 'add',
  'expenses.create': 'add',
  'expenses.delete': 'state',
  'expenseCategories.save': 'merge',
  'damaged.create': 'add',
  'damaged.delete': 'state',
  'momkn.add': 'add',
  'momkn.delete': 'state',
  'mobileMoney.add': 'add',
  'mobileMoney.delete': 'state',
  'treasury.record': 'add',
  'treasury.reverse': 'state',
  'supplierInvoices.createPending': 'add',
  'supplierInvoices.cancel': 'state',
  'supplierInvoices.convert': 'state',
  'supplierInvoices.reserve': 'device',
  'supplierInvoices.release': 'device',
  'supplierPayments.create': 'add',
  'supplierPayments.approve': 'state',
  'supplierPayments.reject': 'state',
  'supplierPayments.cancel': 'state',
  'supplierPayments.reserve': 'device',
  'supplierPayments.release': 'device',
  'users.create': 'merge',
  'users.update': 'merge',
  'users.delete': 'linked',
  'roles.create': 'merge',
  'roles.update': 'merge',
  'roles.delete': 'linked',
  'system.reset': 'linked',
  'settings.update': 'merge',
  'receipts.save': 'merge',
  'receipts.activate': 'merge',
  'receipts.restoreDefault': 'merge',
  'receipts.delete': 'merge',
  'backup.export': 'device',
  'backup.restore': 'device',
  'discounts.save': 'merge',
  'discounts.setActive': 'merge',
  'sync.configure': 'device',
  'sync.pair': 'device',
  'sync.unlink': 'device',
  'sync.runNow': 'device',
  'sync.recover': 'device',
  'sync.skipRecovery': 'device',
  'categories.save': 'merge',
  'categories.setActive': 'merge',
  'categories.delete': 'merge',
  'categories.assign': 'merge',
  'measureKinds.save': 'merge',
  'measureKinds.setActive': 'merge',
  'measureKinds.delete': 'merge',
  'storeImport.apply': 'merge'
}

// Where the cloud carries out an operation started from the internet:
//   local   – on the cloud itself (reads, and the session of the person signing in);
//   shop    – in the shop's database, by the operation's own handler, as the same user;
//   refused – only on the shop PC.
const CLOUD_LOCAL = new Set(['auth.login', 'auth.logout'])
const CLOUD_REFUSED = {
  // The cloud starts from the shop's users: nobody can claim it from the internet.
  'auth.setup': 'يتم إعداد النظام على جهاز المتجر فقط.',
  // Choosing a first password signs the user in on the side it runs on; from the internet this
  // comes with the session work of the security milestone.
  'auth.setPassword': 'اختر كلمة المرور أول مرة من جهاز المتجر، ثم سجّل الدخول من هنا.',
  'auth.recover': 'استعادة كلمة مرور مدير النظام تتم على جهاز المتجر.',
  'system.reset': 'إعادة ضبط البيانات تتم على جهاز المتجر فقط، بعد إلغاء الربط بالسحابة.',
  'backup.export': 'النسخ الاحتياطي لبيانات المتجر يتم على جهاز المتجر.',
  'backup.restore': 'استعادة النسخة الاحتياطية تتم على جهاز المتجر.',
  'sync.configure': 'إعدادات الربط تُضبط على جهاز المتجر.',
  'sync.pair': 'إعدادات الربط تُضبط على جهاز المتجر.',
  'sync.unlink': 'إعدادات الربط تُضبط على جهاز المتجر.',
  'sync.runNow': 'إعدادات الربط تُضبط على جهاز المتجر.',
  'sync.recover': 'إعدادات الربط تُضبط على جهاز المتجر.',
  'sync.skipRecovery': 'إعدادات الربط تُضبط على جهاز المتجر.'
}
// Operations whose data holds a password: carried to the shop but never written to the cloud's
// operation record, on either side.
const SECRET_BODY = new Set(['auth.changePassword', 'auth.newRecoveryCode'])
// Answer fields that are shown once to the person and never stored.
const SECRET_RESULT = ['temporaryPassword', 'recoveryCode', 'token', 'password']

const kindOf = (name) => KINDS[name] || 'read'

function cloudRoute(name) {
  if (CLOUD_REFUSED[name]) return 'refused'
  if (kindOf(name) === 'read' || CLOUD_LOCAL.has(name)) return 'local'
  return 'shop'
}

/** A copy of an operation's answer without the fields that are shown only once. */
function withoutSecrets(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(withoutSecrets)
  const out = {}
  for (const [k, v] of Object.entries(value))
    out[k] = SECRET_RESULT.includes(k) ? '[shown once]' : withoutSecrets(v)
  return out
}

module.exports = {
  KINDS,
  CLOUD_REFUSED,
  SECRET_BODY,
  kindOf,
  cloudRoute,
  withoutSecrets
}
