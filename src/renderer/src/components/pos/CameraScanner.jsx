import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'

/**
 * Reading a barcode with the phone's camera (Phase 2 milestone 2). The code read is handed to the
 * till exactly as a scanner's would be (`onCode`), so the same lookup, units and scale labels apply.
 * Uses the browser's own barcode reader (BarcodeDetector): Chrome and Edge on Android have it;
 * Safari on iPhone does not, and there the button is not shown – type the code or use a Bluetooth
 * scanner, which works as a keyboard (lib/cameraScan.js decides whether the button is shown).
 */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']

export default function CameraScanner({ onCode }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const video = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    let stream = null
    let timer = null
    let stopped = false
    const start = async () => {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats()
        const detector = new window.BarcodeDetector({
          formats: FORMATS.filter((f) => supported.includes(f))
        })
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        })
        if (stopped) return
        video.current.srcObject = stream
        // Not awaited: some phones start the picture only after the first frame; reading starts now.
        video.current.play().catch(() => {})
        const look = async () => {
          if (stopped) return
          try {
            const found = await detector.detect(video.current)
            const code = found.find((f) => f.rawValue)?.rawValue
            if (code) {
              if (navigator.vibrate) navigator.vibrate(60)
              setOpen(false)
              onCode(code.trim())
              return
            }
          } catch {
            /* the frame was not ready: try the next one */
          }
          timer = setTimeout(look, 180)
        }
        look()
      } catch (e) {
        setError(
          e?.name === 'NotAllowedError'
            ? 'لم يُسمح باستخدام الكاميرا. اسمح بها من إعدادات المتصفح ثم حاول مرة أخرى.'
            : 'تعذر تشغيل الكاميرا على هذا الجهاز. اكتب الباركود بدلاً من ذلك.'
        )
      }
    }
    start()
    return () => {
      stopped = true
      clearTimeout(timer)
      if (stream) for (const t of stream.getTracks()) t.stop()
    }
  }, [open, onCode])

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary camera-scan-btn"
        onClick={() => {
          setError('')
          setOpen(true)
        }}
        aria-label="مسح الباركود بالكاميرا"
      >
        <Camera size={20} aria-hidden="true" />
        <span>الكاميرا</span>
      </button>
      {open && (
        <div className="modal-overlay camera-scan" role="presentation">
          <div className="modal-content" role="dialog" aria-modal="true" aria-label="مسح بالكاميرا">
            <div className="modal-header">
              <h2>وجّه الكاميرا إلى الباركود</h2>
            </div>
            <div className="modal-body">
              {error ? (
                <p className="field-error" role="alert">
                  {error}
                </p>
              ) : (
                <video ref={video} className="camera-scan-video" playsInline muted />
              )}
            </div>
            <div className="modal-footer">
              <button
                data-modal-close
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpen(false)}
              >
                <X size={18} aria-hidden="true" />
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
