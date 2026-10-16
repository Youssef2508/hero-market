import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2 } from 'lucide-react'
import { kindLabel, useMeasureKinds } from '../../lib/measureKinds'
import MeasureKindsModal from './MeasureKindsModal'

// "طريقة القياس" in the product forms: active kinds (and the product's own kind even if stopped),
// with a button to add or manage kinds (1.4.0).
export default function KindSelect({ id, value, onChange }) {
  const kinds = useMeasureKinds()
  const [managing, setManaging] = useState(false)
  const current = value || 'count'
  const options = kinds.filter((k) => k.isActive !== false || k.key === current)
  return (
    <>
      <div className="row kind-select">
        <select
          id={id}
          className="form-input"
          value={current}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((k) => (
            <option key={k.key} value={k.key}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setManaging(true)}
          title="إضافة أو تعديل طرق القياس"
        >
          <Settings2 size={16} aria-hidden="true" />
          طرق القياس
        </button>
      </div>
      {managing &&
        // Outside the product window, so its scrolling and animation never move this one.
        // React passes events up to the product form even through a portal: stop them here.
        createPortal(
          <div
            onSubmit={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <MeasureKindsModal
              onClose={() => setManaging(false)}
              onCreated={(key) => {
                onChange(key)
                setManaging(false)
              }}
            />
          </div>,
          document.body
        )}
    </>
  )
}
