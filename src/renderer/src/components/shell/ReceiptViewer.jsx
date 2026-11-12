import { useEffect, useRef, useState } from 'react'
import { Printer, Share2, ReceiptText } from 'lucide-react'

/**
 * What the shop would print, on the phone (lib/webReceipt.js): receipts, invoices, shift and closing
 * reports, purchase invoices, the shortages list – shown as the paper would look, to print or save
 * as PDF with the phone's print dialog, or to share as text. Only the browser build opens it.
 */
export default function ReceiptViewer() {
  const [receipt, setReceipt] = useState(null)
  const [note, setNote] = useState('')
  const frame = useRef(null)
  useEffect(() => {
    const open = (e) => {
      setNote('')
      setReceipt(e.detail)
    }
    window.addEventListener('heromarket:receipt', open)
    return () => window.removeEventListener('heromarket:receipt', open)
  }, [])
  if (!receipt) return null
  const print = () => frame.current?.contentWindow?.print()
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: receipt.title, text: receipt.text })
      else {
        await navigator.clipboard.writeText(receipt.text)
        setNote('تم نسخ نص الفاتورة؛ الصقه في المحادثة.')
      }
    } catch {
      /* the person closed the share sheet */
    }
  }
  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <div
        className="modal-content modal-wide modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="web-receipt-title"
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <ReceiptText size={24} />
          </span>
          <h2 id="web-receipt-title">{receipt.title}</h2>
          <p>
            كما يطبعه جهاز المتجر. محفوظ في النظام، ويمكن طباعته على طابعة الإيصالات في أي وقت من
            جهاز المتجر{receipt.reprint ? ` (${receipt.reprint})` : ''}. من هنا: طباعة أو حفظ PDF،
            أو مشاركة.
          </p>
        </div>
        <div className="modal-body">
          <iframe
            ref={frame}
            title={receipt.title}
            srcDoc={receipt.html}
            style={{
              width: '100%',
              height: '60vh',
              border: '1px solid var(--border)',
              background: '#fff'
            }}
          />
          {note && <p className="notice notice-success">{note}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={print}>
            <Printer size={16} aria-hidden="true" />
            طباعة أو حفظ PDF
          </button>
          <button type="button" className="btn btn-secondary" onClick={share}>
            <Share2 size={16} aria-hidden="true" />
            مشاركة
          </button>
          <button
            data-modal-close
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => setReceipt(null)}
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}
