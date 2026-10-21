import { useEffect } from 'react'

export function useKeyboardShortcuts({
  isLocked,
  customAlert,
  closeCustomAlert,
  handleLock,
  handleCheckout,
  searchInputRef,
  qtyInputRefs,
  triggerClearCart,
  cart,
  triggerDeleteItem
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // If custom alert modal is open, let Enter/Escape dismiss it
      if (customAlert) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          closeCustomAlert()
        }
        return
      }

      if (isLocked) return

      // Shift + Lock screen (Ctrl + Alt + L)
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        handleLock()
        return
      }

      switch (e.key) {
        case 'F1':
          e.preventDefault()
          handleCheckout()
          break
        case 'F2':
          e.preventDefault()
          searchInputRef.current?.focus()
          break
        case 'F3':
          e.preventDefault()
          if (qtyInputRefs.current && qtyInputRefs.current[0]) {
            qtyInputRefs.current[0].focus()
            qtyInputRefs.current[0].select()
          }
          break
        case 'F4':
          e.preventDefault()
          if (cart && cart.length > 0 && triggerDeleteItem) {
            const lastItem = cart[cart.length - 1]
            triggerDeleteItem(lastItem.barcode)
          }
          break
        case 'Escape':
          // Esc belongs to an open window (its own cancel), never to "clear the invoice" behind
          // it; on the till it asks before clearing (POS-01).
          if (document.querySelector('.modal-overlay')) break
          e.preventDefault()
          triggerClearCart()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isLocked,
    customAlert,
    closeCustomAlert,
    handleLock,
    handleCheckout,
    searchInputRef,
    qtyInputRefs,
    triggerClearCart,
    cart,
    triggerDeleteItem
  ])
}
