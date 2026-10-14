import { useState, useEffect } from 'react'
import { RefreshCw, ScrollText } from 'lucide-react'
import { getSystemLogs } from '../../lib/dao/logs.dao'
import { api } from '../../lib/api'
import { BidiText, EmptyState, Timestamp } from '../ui'

// action_type values written by the service audit log (src/server).
const ACTIONS = {
  checkout_sale: { label: 'فاتورة بيع', tone: 'badge-accent' },
  sale_return: { label: 'مرتجع', tone: 'badge-warning' },
  manager_approval: { label: 'اعتماد مشرف', tone: 'badge-info' },
  shift_open: { label: 'فتح وردية', tone: 'badge-success' },
  shift_close: { label: 'إغلاق وردية', tone: 'badge-warning' },
  till_delete: { label: 'حذف حركة درج', tone: 'badge-danger' },
  product_create: { label: 'إضافة صنف', tone: 'badge-info' },
  product_update: { label: 'تعديل صنف', tone: 'badge-info' },
  product_delete: { label: 'حذف صنف', tone: 'badge-danger' },
  damaged_create: { label: 'تسجيل توالف', tone: 'badge-warning' },
  damaged_delete: { label: 'حذف توالف', tone: 'badge-danger' },
  client_create: { label: 'إضافة عميل', tone: 'badge-info' },
  client_update: { label: 'تعديل عميل', tone: 'badge-info' },
  client_delete: { label: 'حذف عميل', tone: 'badge-danger' },
  client_payment: { label: 'تحصيل من عميل', tone: 'badge-success' },
  supplier_create: { label: 'إضافة مورد', tone: 'badge-info' },
  supplier_purchase: { label: 'فاتورة مشتريات', tone: 'badge-info' },
  supplier_payment: { label: 'سداد لمورد', tone: 'badge-warning' },
  supplier_delete: { label: 'حذف مورد', tone: 'badge-danger' },
  check_create: { label: 'تسجيل شيك', tone: 'badge-info' },
  check_paid: { label: 'سداد شيك', tone: 'badge-success' },
  check_delete: { label: 'حذف شيك', tone: 'badge-danger' },
  expense_create: { label: 'تسجيل مصروف', tone: 'badge-warning' },
  expense_delete: { label: 'حذف مصروف', tone: 'badge-danger' },
  user_create: { label: 'إنشاء موظف', tone: 'badge-info' },
  user_update: { label: 'تعديل موظف', tone: 'badge-info' },
  user_delete: { label: 'حذف موظف', tone: 'badge-danger' },
  role_create: { label: 'إنشاء دور', tone: 'badge-info' },
  role_update: { label: 'تعديل دور', tone: 'badge-info' },
  role_delete: { label: 'حذف دور', tone: 'badge-danger' },
  settings_update: { label: 'تعديل الإعدادات', tone: 'badge-purple' },
  receipt_template_save: { label: 'حفظ قالب فاتورة', tone: 'badge-purple' },
  receipt_template_activate: { label: 'اعتماد قالب فاتورة', tone: 'badge-purple' },
  receipt_template_delete: { label: 'حذف قالب فاتورة', tone: 'badge-danger' },
  database_backup: { label: 'نسخة احتياطية', tone: 'badge-purple' },
  database_restore: { label: 'استعادة نسخة احتياطية', tone: 'badge-danger' },
  system_reset: { label: 'تهيئة النظام', tone: 'badge-danger' }
}

export default function LogsTab() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [actionFilter, setActionFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [users, setUsers] = useState([])

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const data = await getSystemLogs(200, 0)
      setLogs(data || [])
    } catch (e) {
      console.error('Failed to load system logs:', e)
    } finally {
      setLoading(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const res = await api('logs.list', { limit: 1 })
      setUsers(res.usernames || [])
    } catch (e) {
      console.log(e)
    }
  }

  useEffect(() => {
    fetchLogs()
    fetchUsers()
  }, [])

  const filteredLogs = logs.filter((log) => {
    const matchesAction = actionFilter ? log.action_type === actionFilter : true
    const matchesUser = userFilter ? log.username === userFilter : true
    return matchesAction && matchesUser
  })

  return (
    <section className="card">
      <div className="card-header toolbar">
        <h2 className="card-title">
          <ScrollText size={18} aria-hidden="true" />
          سجل العمليات
        </h2>
        <div className="spacer" />
        <label className="field field-inline">
          <span className="field-label">نوع العملية</span>
          <select
            className="input"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="">كل العمليات</option>
            {Object.entries(ACTIONS).map(([value, a]) => (
              <option key={value} value={value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-inline">
          <span className="field-label">المسؤول</span>
          <select
            className="input"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          >
            <option value="">كل المسؤولين</option>
            {users.map((u) => (
              <option key={u.username} value={u.username}>
                {u.username === 'system' ? 'النظام' : u.username}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-secondary" onClick={fetchLogs} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} aria-hidden="true" />
          تحديث
        </button>
      </div>

      <div className="card-body">
        {loading && logs.length === 0 ? (
          <div className="loading-state">
            <span className="spinner" aria-hidden="true" />
            جاري تحميل سجل العمليات...
          </div>
        ) : filteredLogs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="لا توجد عمليات"
            text="لا توجد عمليات مسجلة تطابق التصفية."
          />
        ) : (
          <div className="table-wrap" style={{ maxHeight: 560 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>التاريخ والوقت</th>
                  <th>المسؤول</th>
                  <th>نوع العملية</th>
                  <th>التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const a = ACTIONS[log.action_type] || { label: log.action_type, tone: '' }
                  return (
                    <tr key={log.id}>
                      <td className="nowrap cell-muted">
                        <Timestamp value={log.timestamp} />
                      </td>
                      <td className="cell-strong">
                        {!log.username || log.username === 'system' ? 'النظام' : log.username}
                      </td>
                      <td>
                        <span className={`badge ${a.tone}`}>{a.label}</span>
                      </td>
                      <td className="text-2">
                        <BidiText text={log.description} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
