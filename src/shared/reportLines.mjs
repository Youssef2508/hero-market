// Thermal reports (shift close, Momkn machine, wallets) in the print_receipt.ps1 line language.
// They used to be HTML sent through the sale-receipt converter, which printed an empty sale receipt
// instead of the report (K-32). Every value is sanitised: no printer tags, columns or line breaks.

const LEADING_TAGS = /^(\s*\[(C|R|L|B|N|BIG|SMALL|BOX|LOGO)\])+/i
const text = (v, max = 48) =>
  String(v ?? '')
    .replace(/[<>]/g, '')
    .replace(/[|~\r\n]/g, ' ')
    .replace(LEADING_TAGS, '')
    .trim()
    .slice(0, max)
const money = (v) => `${(Number(v) || 0).toFixed(2)} ج.م`

function frame(title, { store = {}, paper = '80mm', shift = {}, printedAt } = {}) {
  const sep = '-'.repeat(paper === '58mm' ? 32 : 48)
  const head = []
  if (store.name) head.push(`[C]${text(store.name)}`)
  if (store.branch) head.push(`[C]${text(store.branch)}`)
  head.push(`[C][BIG]${title}`, `[C]الوردية #${text(shift.id ?? '—', 12)}`, sep)
  if (shift.username) head.push(`الكاشير|${text(shift.username, 30)}`)
  // Date-times are wider than the value column: one full line each.
  if (shift.start_time) head.push(`[R]بداية الوردية: ${text(shift.start_time, 30)}`)
  if (shift.end_time) head.push(`[R]نهاية الوردية: ${text(shift.end_time, 30)}`)
  const tail = [sep]
  if (printedAt) tail.push(`[C][N]طُبع في ${text(printedAt, 30)}`)
  tail.push('[C][N]HeroMarket POS', '', '')
  return { head, sep, tail }
}

/** Shift-close report: the figures shifts.close returned (legacy formula), plus till summaries. */
export function buildShiftReportLines(r, opts = {}) {
  const { head, sep, tail } = frame('تقرير تقفيل الوردية', { ...opts, shift: r.shift })
  const diff = Number(r.difference) || 0
  const verdict = Math.abs(diff) < 0.005 ? 'مطابق' : diff < 0 ? 'عجز' : 'زيادة'
  const lines = [
    ...head,
    sep,
    `العهدة الافتتاحية|${money(r.shift?.initial_cash)}`,
    `مبيعات نقدية|${money(r.cashSales)}`,
    `مقبوضات أخرى بالدرج|${money(r.inflow)}`,
    `مدفوعات من الدرج|${money(r.outflow)}`,
    sep,
    `[B]المتوقع في الدرج|${money(r.expected)}`,
    `الفعلي في الدرج|${money(r.actual)}`,
    `[B]الفرق (${verdict})|${money(diff)}`
  ]
  if (r.momkn) {
    lines.push(
      sep,
      '[C]ماكينة ممكن',
      `الرصيد الافتتاحي|${money(r.momkn.startBalance)}`,
      `الرصيد المتوقع|${money(r.momkn.expectedDigitalBalance)}`,
      `الأثر النقدي|${money(r.momkn.totalCashImpact)}`,
      `العمولة|${money(r.momkn.totalCommission)}`
    )
  }
  if (r.wallets) {
    lines.push(
      sep,
      '[C]المحافظ والتحويلات',
      `فودافون كاش المتوقع|${money(r.wallets.expectedVfcashDigitalBalance)}`,
      `انستاباي|${money(r.wallets.expectedInstapayDigitalBalance)}`,
      `تحويلات بنكية|${money(r.wallets.expectedBankDigitalBalance)}`,
      `الأثر النقدي|${money(r.wallets.totalCashImpact)}`,
      `العمولة|${money(r.wallets.totalCommission)}`
    )
  }
  return [...lines, ...tail]
}

/** Momkn machine report for a shift (summary from momkn.list). */
export function buildMomknReportLines(r, opts = {}) {
  const { head, sep, tail } = frame('تقرير ماكينة ممكن', { ...opts, shift: r.shift })
  const s = r.summary || {}
  return [
    ...head,
    sep,
    `الرصيد الافتتاحي|${money(s.startBalance)}`,
    `[B]الرصيد المتوقع|${money(s.expectedDigitalBalance)}`,
    `كاش الماكينة الافتتاحي|${money(s.startCash)}`,
    `الأثر النقدي|${money(s.totalCashImpact)}`,
    `[B]كاش الماكينة المتوقع|${money(s.expectedCash)}`,
    `العمولة|${money(s.totalCommission)}`,
    `عدد العمليات|${(r.transactions || []).length}`,
    ...tail
  ]
}

/** Wallets and transfers report for a shift (summary from mobileMoney.list). */
export function buildWalletsReportLines(r, opts = {}) {
  const { head, sep, tail } = frame('تقرير المحافظ والتحويلات', { ...opts, shift: r.shift })
  const s = r.summary || {}
  return [
    ...head,
    sep,
    `رصيد فودافون الافتتاحي|${money(s.startBalance)}`,
    `[B]فودافون كاش المتوقع|${money(s.expectedVfcashDigitalBalance)}`,
    `انستاباي|${money(s.expectedInstapayDigitalBalance)}`,
    `تحويلات بنكية|${money(s.expectedBankDigitalBalance)}`,
    `الأثر النقدي|${money(s.totalCashImpact)}`,
    `[B]كاش المحافظ المتوقع|${money(s.expectedCash)}`,
    `العمولة|${money(s.totalCommission)}`,
    `عدد العمليات|${(r.transactions || []).length}`,
    ...tail
  ]
}

export const REPORTS = {
  shift: buildShiftReportLines,
  momkn: buildMomknReportLines,
  wallets: buildWalletsReportLines
}
