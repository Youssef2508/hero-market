import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

/**
 * Custom hook to handle global barcode scanner keyboard events.
 * Distinguishes high-speed hardware scanning from normal manual typing (diff <= 35ms).
 * Automatically handles focus redirection and character buffering.
 */
export function useBarcode({
  isLocked,
  currentView,
  openShiftModal,
  closeShiftModal,
  managerApprovalModal,
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
  const scannerStateRef = useRef({
    lastKeyTime: 0,
    lastKeyChar: '',
    isScanningActive: false
  })

  // Auto-focus barcode scanner on POS view
  useEffect(() => {
    if (
      !isLocked &&
      currentView === 'pos' &&
      !openShiftModal &&
      !closeShiftModal &&
      !managerApprovalModal &&
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
    managerApprovalModal,
    customAlert,
    customConfirm
  ])

  // Global scanner active focus recovery & overwrite
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Ignore if screen is locked or shift modals/alerts are open
      if (
        isLocked ||
        openShiftModal ||
        closeShiftModal ||
        managerApprovalModal ||
        customAlert ||
        customConfirm
      ) {
        return
      }

      // Ignore standard shortcut triggers or modifiers
      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) {
        return
      }

      const currentTime = Date.now()
      const state = scannerStateRef.current
      const diff = currentTime - state.lastKeyTime
      state.lastKeyTime = currentTime
      const prevChar = state.lastKeyChar
      state.lastKeyChar = e.key

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

      // Barcode scanner typed characters very quickly (diff <= 35ms)
      const isScanner = diff <= 35

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

          if (state.isScanningActive) {
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
            state.isScanningActive = true
          }

          e.preventDefault()
          e.stopPropagation()
          return
        }

        // Case B: Scanner typing and target input is already focused, but this is a NEW scan
        if (!state.isScanningActive) {
          state.isScanningActive = true
          updateTargetValue(prevChar + e.key)

          e.preventDefault()
          e.stopPropagation()
          return
        }
      } else {
        // Slow keypress (human typing). Reset scanning active flag if diff is large (e.g. > 100ms)
        if (diff > 100) {
          state.isScanningActive = false
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
    managerApprovalModal,
    showAddModal,
    adminTab,
    customAlert,
    customConfirm
  ])

  /**
   * Parse weighted scale barcode (e.g. prefixes 20, 21, 22, 25 + product code + weight/price + checksum).
   * Weight Format (20, 21, 25): 2X + CCCCC (5 chars code) + WWWWW (5 chars weight in grams / 1000) + C.
   * Price Format (22): 22 + CCCCC (5 chars code) + PPPPP (5 chars price in EGP / 100) + C.
   *
   * @param {string} rawBarcode
   * @returns {object} { isWeighted: boolean, isPriceEmbedded: boolean, barcode: string, qty?: number, totalPrice?: number }
   */
  const parseScaleBarcode = (rawBarcode) => {
    const clean = rawBarcode.trim()
    const scalePrefixes = ['20', '21', '22', '25']
    const hasScalePrefix =
      clean.length === 13 && scalePrefixes.some((prefix) => clean.startsWith(prefix))

    if (hasScalePrefix) {
      const prefix = clean.substring(0, 2)
      const productCode = clean.substring(2, 7)
      const valueRaw = parseFloat(clean.substring(7, 12)) || 0

      if (prefix === '22') {
        const totalPrice = valueRaw / 100.0
        return {
          isWeighted: true,
          isPriceEmbedded: true,
          barcode: productCode,
          totalPrice: totalPrice,
          qty: 1
        }
      } else {
        const weightVal = valueRaw / 1000.0
        return {
          isWeighted: true,
          isPriceEmbedded: false,
          barcode: productCode,
          qty: weightVal
        }
      }
    }
    return { isWeighted: false, barcode: clean }
  }

  return { parseScaleBarcode }
}
