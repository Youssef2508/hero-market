// A supplier balance in words, never a bare minus sign (SUP-03, D-070): + the store owes the
// supplier, − the supplier owes the store.
export function balanceLabel(n) {
  const v = Number(n) || 0
  if (Math.abs(v) < 0.005) return 'لا يوجد رصيد'
  return v > 0 ? 'مستحق للمورد (علينا)' : 'مستحق على المورد (لنا)'
}
