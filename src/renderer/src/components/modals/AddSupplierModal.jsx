import { Truck } from 'lucide-react'
import { can } from '../../lib/api'
import { OpeningBalanceField } from '../admin/SupplierBalance'

const AddSupplierModal = ({
  showAddSupplierModal,
  setShowAddSupplierModal,
  newSupplierForm,
  setNewSupplierForm,
  handleAddSupplier,
  currentUser
}) => {
  if (!showAddSupplierModal) return null

  return (
    <div className="modal-overlay">
      <div className="modal-content" role="dialog" aria-modal="true" style={{ width: 440 }}>
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Truck size={22} />
          </span>
          <h2>إضافة مورد جديد</h2>
        </div>
        <form
          onSubmit={handleAddSupplier}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div className="form-group">
            <label>اسم المورد *</label>
            <input
              className="form-input"
              required
              value={newSupplierForm.name}
              onChange={(e) => setNewSupplierForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="اسم المورد"
            />
          </div>
          <div className="form-group">
            <label>رقم الهاتف</label>
            <input
              className="form-input"
              value={newSupplierForm.phone}
              onChange={(e) => setNewSupplierForm((p) => ({ ...p, phone: e.target.value }))}
              placeholder="01xxxxxxxxx"
            />
          </div>
          <div className="form-group">
            <label>العنوان</label>
            <input
              className="form-input"
              value={newSupplierForm.address}
              onChange={(e) => setNewSupplierForm((p) => ({ ...p, address: e.target.value }))}
              placeholder="عنوان المورد"
            />
          </div>
          <div className="form-group">
            <label>اسم المندوب</label>
            <input
              className="form-input"
              value={newSupplierForm.contact_person}
              onChange={(e) =>
                setNewSupplierForm((p) => ({ ...p, contact_person: e.target.value }))
              }
              placeholder="اسم المسؤول"
            />
          </div>
          {can(currentUser, 'suppliers.opening') && (
            <OpeningBalanceField
              value={newSupplierForm.opening ?? ''}
              onChange={(v) => setNewSupplierForm((p) => ({ ...p, opening: v }))}
              name="new-supplier-opening"
            />
          )}
          <div className="modal-footer">
            <button
              data-modal-close
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAddSupplierModal(false)}
            >
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
              إضافة المورد
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddSupplierModal
