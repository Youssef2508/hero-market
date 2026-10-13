import { Landmark, Plus, Trash2, CircleCheck, CalendarClock } from 'lucide-react'
import { EmptyState } from '../ui'
import { formatMoney } from '../../lib/utils'

/**
 * Cheque register. Data and mutations come from useChecksManager.
 */
export default function ChecksTab({
  checksDueToday,
  setNewCheckForm,
  setShowAddCheckModal,
  checksList,
  handleMarkCheckPaid,
  handleDeleteCheck
}) {
  const today = new Date().toISOString().split('T')[0]

  return (
    <>
      {checksDueToday.length > 0 && (
        <div className="notice notice-danger" role="alert">
          <CalendarClock size={20} aria-hidden="true" />
          <div>
            <strong>يوجد {checksDueToday.length} شيك مستحق اليوم</strong>
            <div>
              {checksDueToday
                .map((c) => `${c.party_name} (${formatMoney(c.amount)} ج.م)`)
                .join(' ، ')}
            </div>
          </div>
        </div>
      )}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Landmark size={18} aria-hidden="true" />
            سجل الشيكات وأوراق الدفع
          </h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setNewCheckForm({
                check_type: 'مورد',
                check_number: '',
                bank_name: '',
                party_name: '',
                issue_date: '',
                due_date: '',
                amount: '',
                notes: ''
              })
              setShowAddCheckModal(true)
            }}
          >
            <Plus size={16} aria-hidden="true" />
            إضافة شيك
          </button>
        </div>
        <div className="card-body">
          {checksList.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="لا توجد شيكات مسجلة"
              text="سجّل الشيكات الصادرة والواردة لمتابعة تواريخ استحقاقها."
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>النوع</th>
                    <th>رقم الشيك</th>
                    <th>البنك</th>
                    <th>الجهة</th>
                    <th>الإصدار</th>
                    <th>الاستحقاق</th>
                    <th className="num">المبلغ</th>
                    <th>الحالة</th>
                    <th>
                      <span className="visually-hidden">إجراءات</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {checksList.map((c) => {
                    const overdue = c.status === 'غير مسدد' && c.due_date <= today
                    return (
                      <tr key={c.id} className={overdue ? 'is-alert-row' : ''}>
                        <td>
                          <span
                            className={`badge ${c.check_type === 'مورد' ? 'badge-info' : 'badge-warning'}`}
                          >
                            {c.check_type}
                          </span>
                        </td>
                        <td className="num">{c.check_number || '—'}</td>
                        <td>{c.bank_name || '—'}</td>
                        <td className="cell-strong">{c.party_name}</td>
                        <td className="num nowrap cell-muted">{c.issue_date || '—'}</td>
                        <td className={`num nowrap ${overdue ? 'text-danger fw-bold' : ''}`}>
                          {c.due_date}
                        </td>
                        <td className="num money-strong">{formatMoney(c.amount)}</td>
                        <td>
                          <span
                            className={`badge ${c.status === 'مسدد' ? 'badge-success' : 'badge-danger'}`}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td>
                          <div className="cell-actions">
                            {c.status === 'غير مسدد' && (
                              <button
                                type="button"
                                className="btn btn-sm btn-accent-soft"
                                onClick={() => handleMarkCheckPaid(c.id)}
                              >
                                <CircleCheck size={15} aria-hidden="true" />
                                سداد
                              </button>
                            )}
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => handleDeleteCheck(c.id)}
                              aria-label="حذف الشيك"
                              title="حذف"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
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
    </>
  )
}
