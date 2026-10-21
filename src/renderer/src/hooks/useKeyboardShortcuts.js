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

      // Owner, 2026-10-21 (D-065): F1 confirms and prints, F2 confirms without printing, F7 opens
      // the product search. None of them acts behind an open window (its own keys come first).
      const windowOpen = !!document.querySelector('.modal-overlay')
      switch (e.key) {
        case 'F1':
          e.preventDefault()
          if (!windowOpen) handleCheckout()
          break
        case 'F2':
          e.preventDefault()
          if (!windowOpen) handleCheckout(null, { print: false })
          break
        case 'F7':
          e.preventDefault()
          if (!windowOpen) {
            searchInputRef.current?.focus()
            searchInputRef.current?.select?.()
          }
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
          // A field that used Esc itself (the product search clears and goes back to the barcode
          // field) keeps it (D-065).
          if (document.querySelector('.modal-overlay') || e.defaultPrevented) break
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
