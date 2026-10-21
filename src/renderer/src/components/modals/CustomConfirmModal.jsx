import { CircleHelp, TriangleAlert } from 'lucide-react'

const isDestructive = (text = '') =>
  /حذف|إلغاء|إرجاع|لا يمكن التراجع|نهائياً|إعادة الضبط/.test(text)

const CustomConfirmModal = ({ customConfirm, closeCustomConfirm }) => {
  if (!customConfirm) return null
  const destructive = isDestructive(`${customConfirm.title} ${customConfirm.message}`)
  const Icon = destructive ? TriangleAlert : CircleHelp

  return (
    <div className="modal-overlay" style={{ zIndex: 100001 }}>
      <div
        className={`modal-content dialog-alert tone-${destructive ? 'danger' : 'info'}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        style={{ width: 440 }}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Icon size={24} />
          </span>
          <h2 id="confirm-title">{customConfirm.title}</h2>
        </div>
        <p id="confirm-message" className="dialog-message">
          {customConfirm.message}
        </p>
        <div className="modal-footer">
          <button
            data-modal-close
            type="button"
            className="btn btn-secondary btn-lg"
            onClick={() => closeCustomConfirm(false)}
            autoFocus={destructive}
          >
            إلغاء
          </button>
          <button
            type="button"
            className={`btn btn-lg ${destructive ? 'btn-danger' : 'btn-primary'}`}
            style={{ flex: 1 }}
            onClick={() => closeCustomConfirm(true)}
            autoFocus={!destructive}
          >
            تأكيد
            {!destructive && <span className="kbd">Enter</span>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CustomConfirmModal
