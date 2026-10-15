import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { createScannerState, endScan, recordScannerKey } from './scannerTiming'

/**
 * Custom hook to handle global barcode scanner keyboard events.
 * Distinguishes high-speed hardware scanning from normal manual typing (see scannerTiming.js).
 * Automatically handles focus redirection and character buffering.
 */
export function useBarcode({
  isLocked,
  currentView,
  openShiftModal,
  closeShiftModal,
  supervisorModal,
  showAddModal,
  adminTab,
  customAlert,
  customConfirm,
  barcodeInputRef,
  adminSearchInputRef,
  addProductBarcodeRef,
  setBarcodeInput,
  setAdminSearch,
  setNewProduct
}) {
  const scannerStateRef = useRef(createScannerState())

  // Auto-focus barcode scanner on POS view
  useEffect(() => {
    if (
      !isLocked &&
      currentView === 'pos' &&
      !openShiftModal &&
      !closeShiftModal &&
      !supervisorModal &&
      !customAlert &&
      !customConfirm
    ) {
      barcodeInputRef.current?.focus()
    }
  }, [
    isLocked,
    currentView,
    openShiftModal,
    closeShiftModal,
    supervisorModal,
    customAlert,
    customConfirm
  ])

  // Global scanner active focus recovery & overwrite
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Scanners finish with Enter (or Tab): the next fast pair starts a new scan
      if (e.key === 'Enter' || e.key === 'Tab') endScan(scannerStateRef.current)

      // Ignore if screen is locked or shift modals/alerts are open
      if (
        isLocked ||
        openShiftModal ||
        closeShiftModal ||
        supervisorModal ||
        customAlert ||
        customConfirm
      ) {
        return
      }

      // Ignore standard shortcut triggers or modifiers
      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) {
        return
      }

      // Event time (from the OS input event), not handler time: a busy renderer must not make a
      // scanner look like manual typing
      const { isScanner, startsScan, replacesField, prevChar } = recordScannerKey(
        scannerStateRef.current,
        e.key,
        e.timeStamp || performance.now()
      )

      // Determine correct barcode input based on current view/modals
      let targetInput = null
      if (showAddModal) {
        targetInput = addProductBarcodeRef.current
      } else if (currentView === 'pos') {
        targetInput = barcodeInputRef.current
      } else if (currentView === 'admin' && adminTab === 'inventory') {
        targetInput = adminSearchInputRef.current
      }

      if (!targetInput) return

      const updateTargetValue = (val) => {
        flushSync(() => {
          if (targetInput === barcodeInputRef.current) {
            setBarcodeInput(val)
          } else if (targetInput === adminSearchInputRef.current) {
            setAdminSearch(val)
          } else if (targetInput === addProductBarcodeRef.current) {
            setNewProduct((prev) => ({ ...prev, barcode: val }))
          }
        })
        targetInput.value = val
        targetInput.setSelectionRange(val.length, val.length)
      }

      if (isScanner) {
        // Case A: Scanner typing, but target input is NOT focused
        if (document.activeElement !== targetInput) {
          const prevActive = document.activeElement
          targetInput.focus()

          if (!startsScan) {
            // We are already scanning. Just restore focus and put cursor at the end.
            targetInput.setSelectionRange(targetInput.value.length, targetInput.value.length)
          } else {
            // New scan starting. Focus and overwrite.
            // If previously active element was an input, remove the scanner's first character from it
            if (
              prevActive &&
              (prevActive.tagName === 'INPUT' || prevActive.tagName === 'TEXTAREA')
            ) {
              const charToRemove = prevChar
              const cleanField = () => {
                const val = prevActive.value
                if (val && val.length > 0) {
                  const prototype =
                    prevActive.tagName === 'TEXTAREA'
                      ? window.HTMLTextAreaElement.prototype
                      : window.HTMLInputElement.prototype
                  const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
                  let newVal = val
                  if (charToRemove && val.endsWith(charToRemove)) {
                    newVal = val.substring(0, val.length - charToRemove.length)
                  } else {
                    newVal = val.substring(0, val.length - 1)
                  }

                  if (nativeSetter) {
                    nativeSetter.call(prevActive, newVal)
                  } else {
                    prevActive.value = newVal
                  }

                  const inputEvent = new Event('input', { bubbles: true })
                  prevActive.dispatchEvent(inputEvent)
                }
              }
              cleanField()
              setTimeout(cleanField, 10)
            }

            // Set the first two characters
            updateTargetValue(prevChar + e.key)
          }

          e.preventDefault()
          e.stopPropagation()
          return
        }

        // Case B: Scanner typing and target input is already focused, but this is a NEW scan
        // after Enter or a pause: replace leftover text. Digits typed in the same run are kept.
        if (replacesField) {
          updateTargetValue(prevChar + e.key)

          e.preventDefault()
          e.stopPropagation()
          return
        }
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [
    isLocked,
    currentView,
    openShiftModal,
    closeShiftModal,
    supervisorModal,
    showAddModal,
    adminTab,
    customAlert,
    customConfirm
  ])

  // Scale labels are resolved by the service (pos.resolve) from the store settings.
  return {}
}
