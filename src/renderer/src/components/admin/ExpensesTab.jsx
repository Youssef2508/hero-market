import { useMemo, useState } from 'react'
import { HandCoins, Plus, Trash2, NotebookPen, Tags, Pencil } from 'lucide-react'
import { EmptyState, SortableTh, Timestamp } from '../ui'
import { formatMoney } from '../../lib/utils'
import { can } from '../../lib/api'
import PaymentMethodSelect from './PaymentMethodSelect'

/**
 * Expense categories (owner feedback EXP-02): add, rename, stop. A renamed category keeps its old
 * name on the expenses recorded before; a stopped one stays on its expenses but is not offered.
 */
function CategoriesManager({ categories, onSave, onClose }) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null)
  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <div
        className="modal-content modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-cats-title"
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Tags size={22} />
          </span>
          <h2 id="expense-cats-title">تصنيفات المصروفات</h2>
          <p>إيقاف التصنيف لا يحذفه: تبقى المصروفات القديمة باسمها.</p>
        </div>
        <div className="modal-body">
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await onSave({ name })) setName('')
            }}
          >
            <input
              className="input"
              placeholder="تصنيف جديد"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              aria-label="اسم التصنيف الجديد"
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>
              <Plus size={15} aria-hidden="true" />
              إضافة
            </button>
          </form>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>التصنيف</th>
                  <th className="num">المصروفات</th>
                  <th>الحالة</th>
                  <th>
                    <span className="visually-hidden">إجراءات</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {editing?.id === c.id ? (
                        <input
                          className="input"
                          value={editing.name}
                          maxLength={60}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          aria-label="الاسم الجديد"
                          autoFocus
                        />
                      ) : (
                        c.name
                      )}
                    </td>
                    <td className="num">{c.uses}</td>
                    <td>
                      <span className={`badge ${c.is_active ? 'badge-success' : 'badge-warning'}`}>
                        {c.is_active ? 'مفعّل' : 'موقوف'}
                      </span>
                    </td>
                    <td>
                      <div className="cell-actions">
                        {editing?.id === c.id ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={async () => {
                              if (await onSave({ id: c.id, name: editing.name })) setEditing(null)
                            }}
                          >
                            حفظ
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`تعديل ${c.name}`}
                            onClick={() => setEditing({ id: c.id, name: c.name })}
                          >
                            <Pencil size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => onSave({ id: c.id, name: c.name, isActive: !c.is_active })}
                        >
                          {c.is_active ? 'إيقاف' : 'تفعيل'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-footer">
          <button data-modal-close type="button" className="btn btn-secondary" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Operating expenses. Data and mutations come from useExpensesManager.
 */
export default function ExpensesTab({
  currentUser,
  currentShift,
  expenseCategories = [],
  saveExpenseCategory,
  expensesList = [],
  showAddExpenseModal,
  setShowAddExpenseModal,
  newExpenseForm,
  setNewExpenseForm,
  handleAddExpense,
  handleDeleteExpense
}) {
  const [catsOpen, setCatsOpen] = useState(false)
  const canTreasury = can(currentUser, 'treasury.manage')
  const hasShift = !!(currentShift && currentShift.status === 'open')
  // Where the expense is paid from (EXP-03): chosen when both are possible, never guessed.
  const fixedDestination = canTreasury ? (hasShift ? null : 'treasury') : 'shift'
  const activeCategories = expenseCategories.filter((c) => c.is_active)
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
            <span className="money fw-bold text-danger">{formatMoney(total)} ج.م</span>
            {can(currentUser, 'expenses.view_all')
              ? ' · كل المصروفات'
              : ' · المصروفات التي سجّلتها أنت فقط'}
          </div>
        </div>
        {can(currentUser, 'expenses.categories') && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setCatsOpen(true)}
          >
            <Tags size={16} aria-hidden="true" />
            التصنيفات
          </button>
        )}
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
                <SortableTh field="destination" label="من" {...sortProps} />
                <SortableTh field="created_by_name" label="سجّله" {...sortProps} />
                <th>
                  <span className="visually-hidden">العمليات</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedExpenses.length === 0 ? (
                <tr>
                  <td colSpan="8" className="table-empty">
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
                    <td className="cell-muted">
                      <span className="ltr-id">{idx + 1}</span>
                    </td>
                    <td className="nowrap cell-muted">
                      <Timestamp value={exp.timestamp} />
                    </td>
                    <td>
                      <span className="badge badge-warning">{exp.category}</span>
                    </td>
                    <td className="num money-strong text-danger">−{formatMoney(exp.amount)}</td>
                    <td>{exp.description}</td>
                    <td>
                      {exp.destination === 'treasury' ? 'الخزنة' : `الوردية #${exp.shift_id}`}
                    </td>
                    <td className="cell-muted">{exp.created_by_name || '—'}</td>
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

      {catsOpen && (
        <CategoriesManager
          categories={expenseCategories}
          onSave={saveExpenseCategory}
          onClose={() => setCatsOpen(false)}
        />
      )}

      {showAddExpenseModal && (
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <form
            data-enter-step
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="expense-title"
            onSubmit={(e) =>
              handleAddExpense(e, fixedDestination ? { destination: fixedDestination } : {})
            }
          >
            <div className="modal-header">
              <span className="modal-icon" aria-hidden="true">
                <NotebookPen size={22} />
              </span>
              <h2 id="expense-title">تسجيل مصروف جديد</h2>
              <p>
                {fixedDestination === 'treasury'
                  ? 'لا توجد وردية مفتوحة: يُخصم المصروف من الخزنة مباشرة.'
                  : fixedDestination === 'shift'
                    ? 'يُخصم المصروف من درج الوردية الحالية.'
                    : 'اختر من أين يُدفع المصروف.'}
              </p>
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
                  required
                  value={newExpenseForm.categoryId}
                  onChange={(e) =>
                    setNewExpenseForm({ ...newExpenseForm, categoryId: e.target.value })
                  }
                >
                  <option value="">اختر التصنيف</option>
                  {activeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <PaymentMethodSelect
                value={newExpenseForm.method || 'cash'}
                onChange={(v) => setNewExpenseForm({ ...newExpenseForm, method: v })}
              />
              {fixedDestination === null && (
                <fieldset className="field">
                  <legend className="field-label">يُدفع من *</legend>
                  <div className="row">
                    {[
                      ['shift', `درج الوردية الحالية #${currentShift?.id}`],
                      ['treasury', 'الخزنة']
                    ].map(([v, label]) => (
                      <label className="check-row" key={v}>
                        <input
                          type="radio"
                          name="expense-destination"
                          value={v}
                          required
                          checked={newExpenseForm.destination === v}
                          onChange={() => setNewExpenseForm({ ...newExpenseForm, destination: v })}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <label className="field">
                <span className="field-label">البيان والوصف (اختياري)</span>
                <textarea
                  className="input"
                  placeholder="تفاصيل المصروف إن وجدت..."
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
