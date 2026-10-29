import { formatMoney } from '../../lib/utils'

// The shift's money, as the shift details page and the closing report both show it (owner,
// 2026-10-21, D-064): per payment method the expected amount, the amount the cashier counted and
// the difference, with the totals; then what the money was (sales, collections, supplier payments,
// credit) so a collection or a transfer is never read as a sale. Everything comes from the
// service's report (shifts.details / shifts.close), the same snapshot the receipt prints.
const METHODS = [
  ['cash', 'نقدي'],
  ['visa', 'فيزا'],
  ['wallet', 'محفظة'],
  ['instapay', 'انستا باي']
]
const m = (n) => `${formatMoney(n || 0)} ج.م`
const tone = (v) => (Math.abs(v || 0) < 0.005 ? '' : v < 0 ? 'text-danger' : 'text-success')
const verdict = (v) => {
  const n = Number(v) || 0
  if (Math.abs(n) < 0.005) return 'مطابق'
  return n < 0 ? `عجز ${formatMoney(-n)}` : `زيادة ${formatMoney(n)}`
}

/** Expected / actual / difference per method, with the totals. */
export function MethodReconciliation({ report: r, legacyActualCash }) {
  const closed = !!r.actual
  const actual = (k) =>
    closed ? r.actual[k] : k === 'cash' && legacyActualCash != null ? legacyActualCash : null
  const diff = (k) => (actual(k) == null ? null : (actual(k) || 0) - (r.expected?.[k] || 0))
  const expectedTotal = r.expectedTotal ?? METHODS.reduce((a, [k]) => a + (r.expected?.[k] || 0), 0)
  const actualTotal = closed ? (r.actualTotal ?? r.netTotal) : null
  const totalDiff = closed ? (r.varianceTotal ?? actualTotal - expectedTotal) : null
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>طريقة الدفع</th>
            <th className="num">المبيعات</th>
            <th className="num">المتوقع</th>
            <th className="num">الفعلي</th>
            <th>الفرق</th>
          </tr>
        </thead>
        <tbody>
          {METHODS.map(([k, label]) => (
            <tr key={k}>
              <td className="cell-strong">{label}</td>
              <td className="num">{m(r.salesByMethod?.[k])}</td>
              <td className="num">{m(r.expected?.[k])}</td>
              <td className="num">{actual(k) == null ? '—' : m(actual(k))}</td>
              <td className={tone(diff(k))}>{diff(k) == null ? '—' : verdict(diff(k))}</td>
            </tr>
          ))}
          <tr className="fw-bold">
            <td>الإجمالي</td>
            <td className="num">{m(r.totalSales)}</td>
            <td className="num">{m(expectedTotal)}</td>
            <td className="num">{actualTotal == null ? '—' : m(actualTotal)}</td>
            <td className={tone(totalDiff)}>{totalDiff == null ? '—' : verdict(totalDiff)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** What the money was: sales, credit, collections, supplier payments, transfers. */
export function MoneyCategories({ report: r }) {
  const rows = [
    ['إجمالي المبيعات', `${m(r.totalSales)} (${r.invoiceCount} فاتورة)`],
    r.creditSales?.count > 0 && [
      'مبيعات آجل',
      `${m(r.creditSales.total)} (${r.creditSales.count})`
    ],
    r.partialSales?.count > 0 && [
      'مبيعات دفع جزئي',
      `${m(r.partialSales.total)} – مدفوع ${m(r.partialSales.paidNow)}، متبقي ${m(r.partialSales.unpaid)}`
    ],
    r.collections > 0 && ['تحصيلات ديون عملاء (ليست مبيعات)', m(r.collections)],
    r.supplierPayments?.withInvoices > 0 && [
      'مدفوعات فواتير موردين',
      m(r.supplierPayments.withInvoices)
    ],
    r.supplierPayments?.settlements > 0 && [
      'سداد مديونيات موردين',
      m(r.supplierPayments.settlements)
    ],
    r.supplierPayments?.requests > 0 && [
      'طلبات سداد موردين من الدرج',
      `${m(r.supplierPayments.requests)}${r.supplierRequests?.pending?.count ? ` – بانتظار الاعتماد ${m(r.supplierRequests.pending.total)}` : ''}`
    ],
    r.supplierRefunds > 0 && ['مبالغ أعادها موردون', m(r.supplierRefunds)],
    r.supplierPayments?.reversed > 0 && [
      'عاد للدرج من طلبات سداد مرفوضة/ملغاة',
      m(r.supplierPayments.reversed)
    ],
    ['المصروفات', `${m(r.expenses?.total)} (${r.expenses?.count || 0})`],
    ['المرتجعات', `${m(r.returns?.total)} (${r.returns?.count || 0})`],
    r.manualDiscounts?.count > 0 && [
      'الخصومات اليدوية',
      `${m(r.manualDiscounts.total)} (${r.manualDiscounts.count})`
    ],
    ['العهدة الافتتاحية (نقدي)', m(r.openingFloat)]
  ].filter(Boolean)
  return (
    <>
      <dl className="kv">
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <MoneyEvents report={r} />
      <ShiftDetailLists report={r} />
      {r.treasuryTransfers && (
        <>
          <h3 className="till-section-title">
            المحوَّل إلى الخزنة عند الإغلاق (تحويل، ليس إيراداً)
          </h3>
          <dl className="kv">
            {METHODS.map(([k, label]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{label}</dt>
                <dd>{m(r.treasuryTransfers[k])}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </>
  )
}

const METHOD_LABEL = Object.fromEntries(METHODS)
const REF_LABELS = {
  client: 'عميل',
  sale: 'فاتورة',
  supplier: 'مورد',
  supplier_purchase: 'فاتورة شراء',
  supplier_pending_invoice: 'فاتورة مبدئية',
  supplier_purchase_return: 'مرتجع مشتريات',
  supplier_payment_request: 'طلب سداد',
  expense: 'مصروف'
}
const GROUPS = [
  ['collections', 'تحصيلات ديون العملاء'],
  ['supplierPayments', 'مدفوعات الموردين'],
  ['supplierRefunds', 'مبالغ أعادها موردون'],
  ['supplierReversals', 'عودة مبالغ طلبات سداد مرفوضة أو ملغاة'],
  ['other', 'حركات أخرى']
]
const timeOf = (at) => String(at ?? '').match(/\d{2}:\d{2}/)?.[0] || ''

/**
 * Every money event of the shift that is not a sale, one line each (D-091): when, with whom, how
 * and how much, who recorded it and its reference. Reports saved before 1.5.2 have no lines.
 */
export function MoneyEvents({ report: r }) {
  const groups = GROUPS.filter(([k]) => r.events?.[k]?.count > 0)
  if (!groups.length) return null
  return groups.map(([k, title]) => {
    const g = r.events[k]
    return (
      <section key={k} aria-label={title}>
        <h3 className="till-section-title">
          {title} ({g.count}) – {m(g.total)}
        </h3>
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>الوقت</th>
                <th>البيان</th>
                <th>الطريقة</th>
                <th className="num">المبلغ</th>
                <th>بواسطة</th>
                <th>المرجع</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((e) => (
                <tr key={e.id}>
                  <td className="num">
                    <bdi dir="ltr">{timeOf(e.at)}</bdi>
                  </td>
                  <td>
                    {e.party || e.description}
                    {e.requestStatusLabel && (
                      <div className="cell-muted">{e.requestStatusLabel}</div>
                    )}
                  </td>
                  <td>{METHOD_LABEL[e.method] || e.method}</td>
                  <td className="num">{m(e.amount)}</td>
                  <td>{e.username || '—'}</td>
                  <td>
                    {e.refType && e.refId != null ? (
                      <span>
                        {REF_LABELS[e.refType] || e.refType}{' '}
                        <span className="ltr-id">#{e.refId}</span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )
  })
}

const items = (list) =>
  (list || []).map((i) => `${i.name} × ${i.qty}${i.unit ? ` ${i.unit}` : ''}`).join('، ')

/** One titled table of a report list; nothing when the list is empty. */
function ListTable({ title, total, head, rows }) {
  if (!rows.length) return null
  return (
    <section aria-label={title}>
      <h3 className="till-section-title">
        {title} ({rows.length}){total !== undefined ? ` – ${m(total)}` : ''}
      </h3>
      <div className="table-wrap">
        <table className="table table-compact">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, i) => (
              <tr key={i}>
                {cells.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * The shift's itemized records (owner's review, 1.5.2, D-098): expenses, customer returns with
 * what was returned, credit and partial sales with what each customer still owes, supplier
 * invoices with their payment status, purchase returns and the shift's treasury entries. Reports
 * saved before 1.5.2 show only what they kept.
 */
export function ShiftDetailLists({ report: r }) {
  const si = r.supplierInvoices
  const t = (at) => <bdi dir="ltr">{timeOf(at)}</bdi>
  return (
    <>
      <ListTable
        title="المصروفات"
        total={r.expenses?.total}
        head={['الوقت', 'البيان', 'المبلغ', 'بواسطة', 'المرجع']}
        rows={(r.expenses?.lines || []).map((e) => [
          t(e.at),
          `${e.category || ''}${e.description ? ` – ${e.description}` : ''}`,
          m(e.amount),
          e.username || '—',
          `مصروف #${e.id}`
        ])}
      />
      <ListTable
        title="مرتجعات العملاء"
        total={r.returns?.total}
        head={['الوقت', 'الفاتورة', 'النوع', 'العميل', 'المرتجع', 'المبلغ', 'بواسطة']}
        rows={(r.returns?.lines || []).map((x) => [
          t(x.at),
          `#${x.saleId}`,
          x.kindLabel || '—',
          x.customer || '—',
          items(x.items) || '—',
          m(x.refund),
          x.username || '—'
        ])}
      />
      {[
        ['مبيعات آجل', r.creditSales],
        ['مبيعات دفع جزئي', r.partialSales]
      ].map(([title, g]) => (
        <ListTable
          key={title}
          title={title}
          total={g?.total}
          head={['الوقت', 'الفاتورة', 'العميل', 'الإجمالي', 'مدفوع الآن', 'المتبقي على العميل']}
          rows={(g?.lines || []).map((x) => [
            t(x.at),
            `#${x.saleId}`,
            x.customer,
            m(x.total),
            m(x.paidNow),
            m(x.unpaid)
          ])}
        />
      ))}
      {[
        ['فواتير شراء من الموردين', si?.purchases],
        ['فواتير موردين مبدئية', si?.preliminary]
      ].map(([title, g]) => (
        <ListTable
          key={title}
          title={title}
          total={g?.total}
          head={['الوقت', 'الفاتورة', 'المورد', 'الإجمالي', 'المدفوع', 'المتبقي', 'الحالة']}
          rows={(g?.lines || []).map((p) => [
            t(p.at),
            p.ref,
            p.supplier,
            m(p.total),
            m(p.paid),
            m(p.remaining),
            [p.status, p.stateLabel].filter(Boolean).join(' · ')
          ])}
        />
      ))}
      <ListTable
        title="مرتجعات للموردين"
        total={r.purchaseReturns?.refund}
        head={['الوقت', 'فاتورة الشراء', 'المورد', 'المرتجع', 'المستلم الآن', 'خُصم من المستحق']}
        rows={(r.purchaseReturns?.lines || []).map((x) => [
          t(x.at),
          x.ref,
          x.supplier,
          items(x.items),
          m(x.refund),
          m(x.credit)
        ])}
      />
      <ListTable
        title="حركات الخزنة الخاصة بالوردية"
        head={['الوقت', 'البيان', 'الطريقة', 'المبلغ']}
        rows={(r.treasuryEntries?.lines || []).map((e) => [
          t(e.at),
          e.label,
          METHOD_LABEL[e.method] || e.method,
          m(Math.abs(e.amount))
        ])}
      />
    </>
  )
}
