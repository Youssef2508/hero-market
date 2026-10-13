'use strict'
// Errors returned to terminals. Messages are Arabic because they are shown to staff as-is.

class ServiceError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const badRequest = (msg, details) => new ServiceError(400, 'bad_request', msg, details)
const unauthorized = (msg = 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى.') =>
  new ServiceError(401, 'unauthorized', msg)
const forbidden = (msg = 'ليس لديك صلاحية لتنفيذ هذا الإجراء.') =>
  new ServiceError(403, 'forbidden', msg)
const notFound = (msg = 'العنصر المطلوب غير موجود.') => new ServiceError(404, 'not_found', msg)
const conflict = (msg, details) => new ServiceError(409, 'conflict', msg, details)
const tooMany = (msg) => new ServiceError(429, 'too_many_attempts', msg)

// PostgreSQL error → message staff can act on. Same wording the renderer used for SQLite errors.
const UNIQUE_MESSAGES = {
  clients_phone_key: 'خطأ: رقم هاتف العميل هذا مسجل بالفعل لعميل آخر.',
  products_pkey: 'خطأ: هذا الباركود مسجل بالفعل لصنف آخر.',
  users_username_key: 'خطأ: اسم المستخدم هذا مسجل بالفعل.',
  users_pin_lookup_key: 'رمز المرور هذا مستخدم لحساب آخر، اختر رمزاً مختلفاً.',
  roles_name_key: 'يوجد دور بنفس الاسم بالفعل.',
  receipt_templates_name_key: 'يوجد قالب فاتورة بنفس الاسم بالفعل.'
}

function fromDatabaseError(err) {
  if (err instanceof ServiceError) return err
  switch (err.code) {
    case 'P0001': // RAISE EXCEPTION from a business trigger – message is already Arabic
      return conflict(err.message)
    case '23505':
      return conflict(
        UNIQUE_MESSAGES[err.constraint] || 'خطأ: هذه القيمة مسجلة بالفعل ولا يمكن تكرارها.'
      )
    case '23503':
      return conflict('لا يمكن تنفيذ العملية لأن هذا العنصر مرتبط بسجلات أخرى.')
    case '23502':
    case '22P02':
    case '22003':
      return badRequest('بيانات غير صالحة.')
    case 'ECONNREFUSED':
    case '57P01':
    case '57P03':
      return new ServiceError(
        503,
        'database_unavailable',
        'تعذر الاتصال بقاعدة البيانات. تحقق من تشغيل الخادم ثم حاول مرة أخرى.'
      )
    default:
      return null
  }
}

module.exports = {
  ServiceError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooMany,
  fromDatabaseError
}
