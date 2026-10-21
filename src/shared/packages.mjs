// Stock as complete packages and loose units (owner, 2026-10-21, D-065). The stock is one quantity
// in the base unit; packages are only a way to show it. Complete packages use floor: 95 pieces in
// boxes of 10 are 9 boxes and 5 pieces – a tenth box cannot be put together.

/** { packages, loose } for a non-negative stock; null when there is no package or no stock. */
export function packagesOf(stock, factor) {
  const q = Number(stock)
  const f = Number(factor)
  if (!(f > 1) || !(q > 0)) return null
  const packages = Math.floor(q / f + 1e-9)
  const loose = Math.round((q - packages * f) * 1000) / 1000
  return { packages, loose }
}

/** "9 علبة + 5 قطعة" (or "10 علبة" when nothing is loose). */
export function packagesText(stock, factor, packName, baseUnit) {
  const p = packagesOf(stock, factor)
  if (!p) return ''
  return p.loose > 0
    ? `${p.packages} ${packName} + ${p.loose} ${baseUnit || ''}`.trim()
    : `${p.packages} ${packName}`
}
