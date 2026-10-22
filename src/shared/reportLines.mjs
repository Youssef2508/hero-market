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

// A reprint says so (POS-02, D-077), like a reprinted sale receipt.
const COPY = '[C][B]*** نسخة معاد طباعتها ***'

function frame(title, { store = {}, paper = '80mm', shift = {}, printedAt, copy = false } = {}) {
  const sep = '-'.repeat(paper === '58mm' ? 32 : 48)
  const head = []
  if (store.name) head.push(`[C]${text(store.name)}`)
  if (store.branch) head.push(`[C]${text(store.branch)}`)
  head.push(`[C][BIG]${title}`)
  if (copy) head.push(COPY)
  head.push(`[C]الوردية #${text(shift.id ?? '—', 12)}`, sep)
  if (shift.username) head.push(`الكاشير|${text(shift.username, 30)}`)
  // Date-times are wider than the value column: one full line each.
  if (shift.start_time) head.push(`[R]بداية الوردية: ${text(shift.start_time, 30)}`)
  if (shift.end_time) head.push(`[R]نهاية الوردية: ${text(shift.end_time, 30)}`)
  const tail = [sep]
  if (printedAt) tail.push(`[C][N]طُبع في ${text(printedAt, 30)}`)
  tail.push('[C][N]HeroMarket POS', '', '')
  return { head, sep, tail }
}

const METHODS = ['cash', 'visa', 'wallet', 'instapay']
const METHOD_LABELS = { cash: 'نقدي', visa: 'فيزا', wallet: 'محفظة', instapay: 'انستا باي' }
const verdictOf = (v) => {
  const n = Number(v) || 0
  if (Math.abs(n) < 0.005) return 'مطابق'
  return n < 0 ? `عجز ${Math.abs(n).toFixed(2)}` : `زيادة ${n.toFixed(2)}`
}

/**
 * Close report (owner feedback SHIFT-02) from the saved close snapshot (shift_closings.report):
 * every figure was persisted when the close was confirmed, so a reprint prints the same report.
 */
export function buildCloseReportLines(rep, opts = {}) {
  const shift = {
    id: rep.shiftId,
    username: rep.cashier,
    start_time: rep.openedAt,
    end_time: rep.closedAt
  }
  // An open shift (owner's live print) has no counted amounts yet.
  const title = rep.actual ? 'تقرير تقفيل الوردية' : 'تقرير الوردية (مفتوحة)'
  const { head, sep, tail } = frame(title, { ...opts, shift })
  const lines = [...head, sep, '[C]المبيعات حسب طريقة الدفع']
  for (const m of METHODS) lines.push(`${METHOD_LABELS[m]}|${money(rep.salesByMethod?.[m])}`)
  if (Number(rep.onAccountSales) > 0) lines.push(`آجل ودفع جزئي|${money(rep.onAccountSales)}`)
  lines.push(
    `[B]إجمالي المبيعات|${money(rep.totalSales)}`,
    `عدد الفواتير|${Number(rep.invoiceCount) || 0}`,
    sep,
    '[C]الدرج النقدي',
    `العهدة الافتتاحية|${money(rep.openingFloat)}`,
    `مبيعات نقدية|${money(rep.cash?.sales)}`,
    `مقبوضات نقدية أخرى|${money(rep.cash?.inflow)}`,
    `مصروفات نقدية|${money(rep.cash?.expenses)}`,
    `مرتجعات نقدية|${money(rep.cash?.refunds)}`
  )
  if (Number(rep.cash?.supplier) > 0) lines.push(`مدفوعات موردين|${money(rep.cash.supplier)}`)
  if (rep.actual) {
    for (const m of METHODS) {
      lines.push(
        sep,
        `[C]${METHOD_LABELS[m]}`,
        `المتوقع|${money(rep.expected?.[m])}`,
        `الفعلي|${money(rep.actual?.[m])}`,
        `[B]الفرق|${text(verdictOf(rep.variance?.[m]), 24)}`
      )
    }
    // Totals of the four methods (D-064).
    const expectedTotal =
      rep.expectedTotal ?? METHODS.reduce((a, m) => a + (Number(rep.expected?.[m]) || 0), 0)
    lines.push(
      sep,
      '[C]الإجمالي',
      `المتوقع|${money(expectedTotal)}`,
      `الفعلي|${money(rep.actualTotal ?? rep.netTotal)}`,
      `[B]الفرق|${text(verdictOf(rep.varianceTotal ?? (rep.netTotal || 0) - expectedTotal), 24)}`
    )
    lines.push(sep, `[B]صافي الوردية (الفعلي)|${money(rep.netTotal)}`)
  } else {
    lines.push(
      sep,
      ...METHODS.map((m) => `المتوقع ${METHOD_LABELS[m]}|${money(rep.expected?.[m])}`)
    )
  }
  // What the money was (D-064): credit, collections and supplier payments are not sales.
  const cat = []
  if (rep.creditSales?.count > 0)
    cat.push(`مبيعات آجل (${rep.creditSales.count})|${money(rep.creditSales.total)}`)
  if (rep.partialSales?.count > 0)
    cat.push(
      `مبيعات دفع جزئي (${rep.partialSales.count})|${money(rep.partialSales.total)}`,
      `  مدفوع منها|${money(rep.partialSales.paidNow)}`,
      `  متبقي على العملاء|${money(rep.partialSales.unpaid)}`
    )
  if (Number(rep.collections) > 0) cat.push(`تحصيلات ديون عملاء|${money(rep.collections)}`)
  if (Number(rep.supplierPayments?.withInvoices) > 0)
    cat.push(`مدفوعات فواتير موردين|${money(rep.supplierPayments.withInvoices)}`)
  if (Number(rep.supplierPayments?.settlements) > 0)
    cat.push(`سداد مديونيات موردين|${money(rep.supplierPayments.settlements)}`)
  if (cat.length) lines.push(sep, '[C]حركات أخرى (ليست مبيعات)', ...cat)
  if (rep.treasuryTransfers)
    lines.push(
      sep,
      '[C]المحوَّل إلى الخزنة',
      ...METHODS.map((m) => `${METHOD_LABELS[m]}|${money(rep.treasuryTransfers[m])}`)
    )
  const ex = rep.expenses
  if (ex && ex.count > 0) {
    lines.push(sep, '[C]المصروفات', `العدد|${ex.count}`, `[B]الإجمالي|${money(ex.total)}`)
    for (const e of ex.lines || [])
      lines.push(
        `${text(e.category, 20)}${e.description ? ` – ${text(e.description, 18)}` : ''}|${money(e.amount)}`
      )
  }
  const rt = rep.returns
  if (rt && rt.count > 0) {
    lines.push(sep, '[C]المرتجعات', `العدد|${rt.count}`, `[B]الإجمالي|${money(rt.total)}`)
    for (const r of rt.lines || []) lines.push(`فاتورة #${text(r.saleId, 12)}|${money(r.refund)}`)
  }
  const md = rep.manualDiscounts
  if (md && md.count > 0) {
    lines.push(
      sep,
      '[C]الخصومات اليدوية',
      `عدد الفواتير|${md.count}`,
      `[B]إجمالي الخصم اليدوي|${money(md.total)}`
    )
    for (const m of md.invoices || [])
      lines.push(
        `فاتورة #${text(m.saleId, 12)}${m.username ? ` (${text(m.username, 20)})` : ''}|${money(m.amount)}`
      )
  }
  if (rep.acknowledgedBy) lines.push(sep, `اعتمد الفرق|${text(rep.acknowledgedBy, 30)}`)
  if (rep.note) lines.push(`[R]ملاحظات: ${text(rep.note, 120)}`)
  return [...lines, ...tail]
}

/**
 * Shift-close report. With the saved snapshot (1.5.0, r.report) it is the full close report;
 * a close from before 1.5.0 prints the figures shifts.close returned (legacy formula). Till
 * summaries are added to either.
 */
export function buildShiftReportLines(r, opts = {}) {
  if (r.report) {
    const lines = buildCloseReportLines(r.report, opts)
    const extra = tillLines(r, '-'.repeat(opts.paper === '58mm' ? 32 : 48))
    if (!extra.length) return lines
    const end = lines.length - frame('', opts).tail.length
    return [...lines.slice(0, end), ...extra, ...lines.slice(end)]
  }
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
  // Manual invoice discounts (D-057): total, count and each affected invoice.
  const md = r.manualDiscounts
  if (md && md.count > 0) {
    lines.push(
      sep,
      '[C]الخصومات اليدوية',
      `عدد الفواتير|${md.count}`,
      `[B]إجمالي الخصم اليدوي|${money(md.total)}`,
      ...md.invoices.map(
        (m) =>
          `فاتورة #${text(m.saleId, 12)}${m.username ? ` (${text(m.username, 20)})` : ''}|${money(m.amount)}`
      )
    )
  }
  return [...lines, ...tillLines(r, sep), ...tail]
}

/** Momkn machine and wallet service sections of a shift report (multi-till close). */
function tillLines(r, sep) {
  const lines = []
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
  return lines
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

/**
 * A recorded supplier invoice (POS-02, D-077), from its saved purchase (suppliers.purchaseDetail):
 * lines, gross, invoice discount, net, paid, still owed and returns. Printing it never records
 * anything; it is always a copy of what was saved.
 */
export function buildPurchaseLines(d, opts = {}) {
  const p = d.purchase || {}
  const sep = '-'.repeat(opts.paper === '58mm' ? 32 : 48)
  const store = opts.store || {}
  const lines = []
  if (store.name) lines.push(`[C]${text(store.name)}`)
  if (store.branch) lines.push(`[C]${text(store.branch)}`)
  lines.push(
    '[C][BIG]فاتورة شراء',
    COPY,
    `[C]رقم ${text(p.invoice_ref || p.id, 30)}`,
    sep,
    `المورد|${text(p.supplier_name, 30)}`,
    `[R]التاريخ: ${text(p.timestamp, 30)}`,
    sep
  )
  for (const l of d.items || []) {
    lines.push(`[R]${text(l.name, 40)}`)
    lines.push(
      `${Number(l.qty)} ${text(l.unit_name || '', 12)} × ${(Number(l.unit_cost) || 0).toFixed(2)}|${money(l.line_total)}`
    )
    if (Number(l.returned) > 0) lines.push(`[R][N]  أُرجع منها ${Number(l.returned)}`)
  }
  const gross = Number(p.gross ?? p.total_amount) || 0
  lines.push(sep, `إجمالي الأصناف|${money(gross)}`)
  if (Number(p.discount) > 0) lines.push(`خصم الفاتورة|${money(p.discount)}`)
  lines.push(
    `[B]صافي الفاتورة|${money(p.total_amount)}`,
    `المدفوع عند الشراء|${money(p.paid_amount)}`,
    `المتبقي عند الشراء|${money(p.remaining)}`
  )
  const returns = d.returns || []
  if (returns.length) {
    const credit = returns.reduce((a, r) => a + (Number(r.credit_value) || 0), 0)
    lines.push(sep, `مرتجعات (${returns.length})|${money(credit)}`)
  }
  lines.push(sep)
  if (opts.printedAt) lines.push(`[C][N]طُبع في ${text(opts.printedAt, 30)}`)
  lines.push('[C][N]HeroMarket POS', '', '')
  return lines
}

export const REPORTS = {
  shift: buildShiftReportLines,
  // A saved close printed again carries the copy mark (copy: true).
  close: (r, opts) => buildCloseReportLines(r.report || r, { ...opts, copy: !!r.copy }),
  purchase: buildPurchaseLines,
  momkn: buildMomknReportLines,
  wallets: buildWalletsReportLines
}
