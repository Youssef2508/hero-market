import { useState, useEffect } from 'react'
import { RefreshCw, ScrollText } from 'lucide-react'
import { getSystemLogs } from '../../lib/dao/logs.dao'
import { api } from '../../lib/api'
import { EmptyState } from '../ui'

// action_type values written by the service audit log (src/server).
const ACTIONS = {
  user_create: { label: 'إنشاء موظف', tone: 'badge-info' },
  user_update: { label: 'تعديل موظف', tone: 'badge-info' },
  user_delete: { label: 'حذف موظف', tone: 'badge-danger' },
  shift_open: { label: 'فتح وردية', tone: 'badge-success' },
  shift_close: { label: 'إغلاق وردية', tone: 'badge-warning' },
  system_reset: { label: 'تهيئة النظام', tone: 'badge-danger' },
  database_backup: { label: 'نسخة احتياطية', tone: 'badge-purple' },
  checkout_sale: { label: 'فاتورة بيع', tone: 'badge-accent' }
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
                {u.username}
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
                      <td className="num nowrap cell-muted">{log.timestamp}</td>
                      <td className="cell-strong">{log.username || 'النظام'}</td>
                      <td>
                        <span className={`badge ${a.tone}`}>{a.label}</span>
                      </td>
                      <td className="text-2">{log.description}</td>
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
