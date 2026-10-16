import { useMemo, useState } from 'react'
import { HandCoins, Plus, Trash2, NotebookPen } from 'lucide-react'
import { EmptyState, SortableTh, Timestamp } from '../ui'
import { formatMoney } from '../../lib/utils'

// Category values are stored in expenses.category – keep them unchanged.
const CATEGORIES = [
  { value: 'عام', label: 'عام / نثرية' },
  { value: 'صيانة', label: 'صيانة وإصلاحات' },
  { value: 'إيجار', label: 'إيجار' },
  { value: 'كهرباء', label: 'كهرباء ومياه' },
  { value: 'أجور', label: 'أجور ورواتب' },
  { value: 'بضائع', label: 'بضائع ومشتريات' },
  { value: 'توصيل', label: 'خدمات توصيل' }
]

/**
 * Operating expenses. Data and mutations come from useExpensesManager.
 */
export default function ExpensesTab({
  expensesList = [],
  showAddExpenseModal,
  setShowAddExpenseModal,
  newExpenseForm,
  setNewExpenseForm,
  handleAddExpense,
  handleDeleteExpense
}) {
  const [sortField, setSortField] = useState('timestamp')
  const [sortAsc, setSortAsc] = useState(false)

  const onSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(true)
    }
  }

  const sortedExpenses = useMemo(() => {
    return [...expensesList].sort((a, b) => {
      let valA = a[sortField]
      let valB = b[sortField]
      if (typeof valA === 'string') {
        return sortAsc ? valA.localeCompare(valB, 'ar') : valB.localeCompare(valA, 'ar')
      }
      valA = valA || 0
      valB = valB || 0
      return sortAsc ? valA - valB : valB - valA
    })
  }, [expensesList, sortField, sortAsc])

  const total = expensesList.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const sortProps = { sortField, sortAsc, onSort }

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">
            <HandCoins size={18} aria-hidden="true" />
            سجل المصروفات اليومية والتشغيلية
          </h2>
          <div className="card-subtitle">
            الإجمالي المسجل:{' '}
            <span className="money fw-bold text-danger">{formatMoney(total)} ج.م</span> · تُخصم
            تلقائياً من خزنة الوردية
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setShowAddExpenseModal(true)}
        >
          <Plus size={16} aria-hidden="true" />
          تسجيل مصروف
        </button>
      </div>

      <div className="card-body">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 56 }}>#</th>
                <SortableTh field="timestamp" label="التاريخ والوقت" {...sortProps} />
                <SortableTh field="category" label="التصنيف" {...sortProps} />
                <SortableTh field="amount" label="المبلغ" className="num" {...sortProps} />
                <SortableTh field="description" label="البيان" {...sortProps} />
                <th>
                  <span className="visually-hidden">العمليات</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedExpenses.length === 0 ? (
                <tr>
                  <td colSpan="6" className="table-empty">
                    <EmptyState
                      icon={HandCoins}
                      title="لا توجد مصروفات"
                      text="لا توجد مصاريف مسجلة حتى الآن."
                    />
                  </td>
                </tr>
              ) : (
                sortedExpenses.map((exp, idx) => (
                  <tr key={exp.id}>
                    <td className="num cell-muted">{idx + 1}</td>
                    <td className="nowrap cell-muted">
                      <Timestamp value={exp.timestamp} />
                    </td>
                    <td>
                      <span className="badge badge-warning">{exp.category}</span>
                    </td>
                    <td className="num money-strong text-danger">−{formatMoney(exp.amount)}</td>
                    <td>{exp.description}</td>
                    <td>
                      <div className="cell-actions">
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => handleDeleteExpense(exp)}
                          aria-label="حذف المصروف"
                          title="حذف (يعكس الحركة في الخزنة)"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddExpenseModal && (
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <form
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="expense-title"
            onSubmit={handleAddExpense}
          >
            <div className="modal-header">
              <span className="modal-icon" aria-hidden="true">
                <NotebookPen size={22} />
              </span>
              <h2 id="expense-title">تسجيل مصروف جديد</h2>
              <p>يُسجَّل المصروف ويُخصم من خزنة الوردية الحالية.</p>
            </div>
            <div className="modal-body">
              <label className="field">
                <span className="field-label">المبلغ (ج.م) *</span>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="0.00"
                  className="input input-lg input-money"
                  value={newExpenseForm.amount}
                  onChange={(e) => setNewExpenseForm({ ...newExpenseForm, amount: e.target.value })}
                  autoFocus
                />
              </label>
              <label className="field">
                <span className="field-label">التصنيف *</span>
                <select
                  className="input"
                  value={newExpenseForm.category}
                  onChange={(e) =>
                    setNewExpenseForm({ ...newExpenseForm, category: e.target.value })
                  }
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">البيان والوصف *</span>
                <textarea
                  required
                  className="input"
                  placeholder="اكتب تفاصيل المصروف هنا..."
                  rows="3"
                  value={newExpenseForm.description}
                  onChange={(e) =>
                    setNewExpenseForm({ ...newExpenseForm, description: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="modal-footer">
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                حفظ المصروف
              </button>
              <button
                data-modal-close
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowAddExpenseModal(false)}
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
