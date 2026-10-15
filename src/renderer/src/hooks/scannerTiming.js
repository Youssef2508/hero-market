// Keystroke timing for barcode scanners (K-19).
// A scanner types each character within a few milliseconds of the previous one. Two things used to
// cut long barcodes (6223001876366 arrived as "76366" or "63"):
//  - a renderer stall of more than 100 ms in the middle of a scan was taken as the start of a new
//    scan, and the field was replaced by the last two characters;
//  - keys were timed when the handler ran (Date.now()), so a busy renderer made a scanner look like
//    manual typing until its backlog cleared, and the first fast pair replaced the digits before it.
// Keys are now timed by the input event's own timestamp, a scan ends only on Enter/Tab or a real
// pause, and the field is replaced only when the scan began after such a boundary.
export const SCANNER_MAX_GAP_MS = 35
export const SCAN_RESTART_GAP_MS = 1000

export function createScannerState() {
  return {
    lastKeyTime: -Infinity,
    lastKeyChar: '',
    lastKeyStartedRun: true,
    boundary: true,
    isScanningActive: false
  }
}

/** Enter/Tab: the scanner finished; the next key starts a new run. */
export function endScan(state) {
  state.isScanningActive = false
  state.boundary = true
}

/**
 * Records one printable key, timed by the event (KeyboardEvent.timeStamp).
 * @returns {{ isScanner: boolean, startsScan: boolean, replacesField: boolean, prevChar: string }}
 *   isScanner: the key followed the previous one at scanner speed.
 *   startsScan: first scanner-speed pair of a scan; prevChar may have gone into another field.
 *   replacesField: the scan began after Enter/Tab or a pause, so whatever the focused field held
 *   before prevChar is leftover text and the field becomes prevChar + key. When false, the field's
 *   text was typed in the same run as the scan and is kept.
 */
export function recordScannerKey(state, key, now) {
  const diff = now - state.lastKeyTime
  const prevChar = state.lastKeyChar
  const prevStartedRun = state.lastKeyStartedRun
  const startsRun = state.boundary || diff > SCAN_RESTART_GAP_MS
  state.lastKeyTime = now
  state.lastKeyChar = key
  state.lastKeyStartedRun = startsRun
  state.boundary = false
  const isScanner = diff <= SCANNER_MAX_GAP_MS
  if (!isScanner) {
    if (startsRun) state.isScanningActive = false
    return { isScanner, startsScan: false, replacesField: false, prevChar }
  }
  const startsScan = !state.isScanningActive
  state.isScanningActive = true
  return { isScanner, startsScan, replacesField: startsScan && prevStartedRun, prevChar }
}
