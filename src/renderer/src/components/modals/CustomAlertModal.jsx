import { CircleCheck, CircleAlert, TriangleAlert } from 'lucide-react'

// Callers only pass free text; infer a visual tone so success messages are not shown as errors.
function alertTone(title = '', message = '') {
  const t = `${title} ${message}`
  if (/فشل|خطأ|غير صحيح|مرفوض|لا يمكن|خاطئ/.test(t)) return 'danger'
  if (/نجاح|بنجاح|تم\s|تمت|تم$/.test(t)) return 'success'
  return 'warning'
}

const ICONS = { success: CircleCheck, danger: CircleAlert, warning: TriangleAlert }

const CustomAlertModal = ({ customAlert, closeCustomAlert }) => {
  if (!customAlert) return null
  const tone = alertTone(customAlert.title, customAlert.message)
  const Icon = ICONS[tone]

  return (
    <div className="modal-overlay" style={{ zIndex: 100005 }}>
      <div
        className={`modal-content dialog-alert tone-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-title"
        aria-describedby="alert-message"
        style={{ width: 420 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Icon size={24} />
          </span>
          <h2 id="alert-title">{customAlert.title}</h2>
        </div>
        <p id="alert-message" className="dialog-message">
          {customAlert.message}
        </p>
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={closeCustomAlert}
            autoFocus
          >
            حسناً
            <span className="kbd">Enter</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default CustomAlertModal
