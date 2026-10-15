// How a refund was paid (sales.returnItem / sales.returnEntire): cash from the drawer, back to the
// customer's account (what they still owed, or store balance they had spent), or both.
const money = (n) => (Number(n) || 0).toFixed(2)

export function refundText(r) {
  const total = r.netRefund ?? r.refund ?? 0
  const cash = Number(r.cashRefund ?? total) || 0
  const account = Number(r.toAccount ?? 0) || 0
  const parts = []
  if (cash > 0) parts.push(`${money(cash)} ج.م نقداً من الدرج`)
  if (account > 0) parts.push(`${money(account)} ج.م على حساب العميل`)
  return `تم المرتجع بقيمة ${money(total)} ج.م${parts.length ? `: ${parts.join(' و')}` : ''}.`
}
