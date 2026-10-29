// Purchase-form lines (AddPurchaseModal, useSuppliersManager).

// The line's unit (base or package) and its factor.
export const unitOf = (l) => (l.units || []).find((x) => (x.id ?? null) === (l.unitId ?? null))
// An empty purchase price keeps the product's price (D-087): the line counts at the current price
// per base unit × the unit's factor, exactly as the service prices it.
export const currentCost = (l) =>
  l.baseCost === null || l.baseCost === undefined
    ? 0
    : Math.round(l.baseCost * (unitOf(l)?.factor || 1) * 10000) / 10000
export const effectiveCost = (l) =>
  String(l.unitCost ?? '').trim() === '' ? currentCost(l) : Number(l.unitCost) || 0
