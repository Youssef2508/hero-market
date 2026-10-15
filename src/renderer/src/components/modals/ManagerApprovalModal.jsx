import { ShieldAlert } from 'lucide-react'

const ManagerApprovalModal = ({
  managerApprovalModal,
  managerPin,
  setManagerPin,
  setManagerApprovalModal,
  setPendingAction,
  handleManagerAuthSubmit
}) => {
  if (!managerApprovalModal) return null

  return (
    <div className="modal-overlay">
      <div
        className="modal-content tone-danger"
        role="dialog"
        aria-modal="true"
        style={{ width: 420 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <ShieldAlert size={24} />
          </span>
          <h2>صلاحيات المشرف مطلوبة!</h2>
          <p>يتطلب تعديل/حذف سلع الفاتورة موافقة المشرف المسؤول</p>
        </div>
        <form
          onSubmit={handleManagerAuthSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}
        >
          <div className="form-group">
            <label>أدخل الرمز السري للمشرف (PIN)</label>
            <input
              type="password"
              className="form-input"

              value={managerPin}
              onChange={(e) => setManagerPin(e.target.value)}
              autoFocus
              placeholder="••••"
            />
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1 }}
              onClick={() => {
                setManagerApprovalModal(false)
                setPendingAction(null)
              }}
            >
              إلغاء العملية
            </button>
            <button type="submit" className="btn btn-danger" style={{ flex: 1 }}>
              تأكيد الموافقة
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ManagerApprovalModal
