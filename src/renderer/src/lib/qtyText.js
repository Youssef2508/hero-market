// Quantity typed in a cart line (POS-01): Arabic digits and a comma or Arabic decimal separator
// are accepted. Returns { value: normalised text } for a quantity above zero, { zero: true } for 0,
// and { value: null } for anything incomplete or invalid ("", ".", "0.", "1.2.3", "abc").
export function qtyFromText(text) {
  const t = String(text ?? '')
    .trim()
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/[,٫]/, '.')
  if (!/^\d*\.?\d+$/.test(t)) return { value: null, zero: false }
  return Number(t) > 0 ? { value: t, zero: false } : { value: null, zero: true }
}
