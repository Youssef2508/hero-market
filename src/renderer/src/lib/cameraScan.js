/** Can this page read barcodes with the camera? The browser's own reader, from the internet only. */
export function cameraScanAvailable() {
  return (
    typeof window !== 'undefined' &&
    !!window.api?.isWeb &&
    'BarcodeDetector' in window &&
    !!navigator.mediaDevices?.getUserMedia
  )
}
