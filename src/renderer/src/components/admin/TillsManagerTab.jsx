import { useState, useEffect, useCallback } from 'react'
import {
  Store,
  Smartphone,
  Wallet,
  Info,
  Coins,
  ReceiptText,
  HandCoins,
  Truck,
  NotebookPen,
  ArrowLeftRight,
  Banknote,
  Percent,
  ScrollText,
  Printer,
  Plus,
  Trash2,
  Zap,
  Landmark
} from 'lucide-react'
import { StatCard } from '../ui'
import { api, can } from '../../lib/api'
import { getFriendlyErrorMessage } from '../../lib/utils'
import { useMomknTill } from '../../hooks/useMomknTill'
import { useMobileMoneyTill } from '../../hooks/useMobileMoneyTill'
import MomknOperationModal from '../modals/MomknOperationModal'
import MobileMoneyOperationModal from '../modals/MobileMoneyOperationModal'

// Helper for ultra-safe currency formatting
const formatVal = (val, dec = 2) => {
  const num = parseFloat(val)
  return isNaN(num) ? (0).toFixed(dec) : num?.toFixed(dec)
}

const TillsManagerTab = ({
  currentUser,
  currentShift,
  triggerCustomAlert,
  triggerCustomConfirm
}) => {
  const [activeSubTab, setActiveSubTab] = useState('supermarket') // 'supermarket', 'momkn', 'mobile_money'
  const [mainDrawerSummary, setMainDrawerSummary] = useState({
    initialCash: 0,
    expectedCash: 0,
    cashSales: 0,
    inflows: 0,
    expenses: 0,
    supplierPayments: 0,
    returns: 0
  })

  // True once the drawer summary for the current shift has loaded (avoids showing misleading zeros).
  const [drawerReady, setDrawerReady] = useState(false)

  // Printing and deleting till movements: same permission the service checks.
  const isAdmin = can(currentUser, 'tills.manage')

  // Initialize hooks
  const momkn = useMomknTill({ currentShift, triggerCustomAlert, triggerCustomConfirm })
  const mobileMoney = useMobileMoneyTill({ currentShift, triggerCustomAlert, triggerCustomConfirm })

  // 1. Fetch Main Supermarket Drawer Summary
  const fetchMainDrawerData = useCallback(async () => {
    if (!currentShift) return
    const shiftId = currentShift.id
    const initialCash = currentShift.initial_cash || 0

    try {
      // Same sums as before (sale value = original − discount, returns/suppliers/expenses split by ledger text).
      const r = await api('tills.drawerSummary', { shiftId })
      const allSalesTotal = r.allSalesTotal || 0
      const cashSalesTotal = r.cashSalesTotal || 0
      const debtSalesTotal = r.debtSalesTotal || 0
      const digitalSalesTotal = r.digitalSalesTotal || 0
      const repayTotal = r.repayTotal || 0
      const returnsTotal = r.returnsTotal || 0
      const supplierTotal = r.supplierTotal || 0
      const expensesTotal = r.expensesTotal || 0

      const expected =
        initialCash +
        allSalesTotal -
        debtSalesTotal -
        digitalSalesTotal +
        repayTotal -
        returnsTotal -
        supplierTotal -
        expensesTotal

      setDrawerReady(true)
      setMainDrawerSummary({
        initialCash,
        expectedCash: expected,
        allSales: allSalesTotal,
        cashSales: cashSalesTotal,
        debtSales: debtSalesTotal,
        digitalSales: digitalSalesTotal,
        inflows: repayTotal,
        returns: returnsTotal,
        supplierPayments: supplierTotal,
        expenses: expensesTotal
      })
    } catch (err) {
      console.error('fetchMainDrawerData error:', err)
    }
  }, [currentShift])

  // Fetch all data on mount or shift change
  useEffect(() => {
    if (currentShift) {
      fetchMainDrawerData()
      momkn.fetchMomknData()
      mobileMoney.fetchMobileMoneyData()
    }
  }, [currentShift, fetchMainDrawerData])

  // Print Handlers (Admin Only)
  const handlePrintMomknReport = () => {
    if (!isAdmin) {
      triggerCustomAlert('طباعة التقارير مخصصة للمدير فقط!')
      return
    }
    if (!window.api?.printer?.printReport) {
      triggerCustomAlert('طابعة الفواتير غير متصلة أو غير معرفة!')
      return
    }

    window.api.printer
      .printReport('momkn', {
        shift: { ...currentShift, username: currentUser.username },
        transactions: momkn.transactions,
        summary: momkn.summary
      })
      .then(() => triggerCustomAlert('تم إرسال تقرير ممكن للطابعة بنجاح.'))
      .catch((e) => triggerCustomAlert('فشل الطباعة: ' + getFriendlyErrorMessage(e)))
  }

  const handlePrintMobileMoneyReport = () => {
    if (!isAdmin) {
      triggerCustomAlert('طباعة التقارير مخصصة للمدير فقط!')
      return
    }
    if (!window.api?.printer?.printReport) {
      triggerCustomAlert('طابعة الفواتير غير متصلة أو غير معرفة!')
      return
    }

    window.api.printer
      .printReport('wallets', {
        shift: { ...currentShift, username: currentUser.username },
        transactions: mobileMoney.rawTransactions, // rawTransactions bypasses platformFilter
        summary: mobileMoney.summary
      })
      .then(() => triggerCustomAlert('تم إرسال تقرير المحافظ للطابعة بنجاح.'))
      .catch((e) => triggerCustomAlert('فشل الطباعة: ' + getFriendlyErrorMessage(e)))
  }

  // A + or − only on non-zero amounts ("-0.00" reads like an error).
  const sign = (v, s) => (Math.abs(Number(v) || 0) >= 0.005 ? s : '')
  const signedMoney = (v) => `${(v || 0) >= 0 ? '+' : ''}${formatVal(v)}`
  const toneOfSigned = (v) => ((v || 0) >= 0 ? 'text-success' : 'text-danger')
  const SUBTABS = [
    { id: 'supermarket', label: 'درج السوبر ماركت', icon: Store },
    { id: 'momkn', label: 'ماكينة ممكن', icon: Smartphone },
    { id: 'mobile_money', label: 'المحافظ والتحويلات', icon: Wallet }
  ]
  const PLATFORMS = [
    { id: 'all', label: 'الكل' },
    { id: 'vodafone_cash', label: 'فودافون كاش' },
    { id: 'instapay', label: 'انستاباي' },
    { id: 'bank_transfer', label: 'تحويل بنكي' }
  ]
  const PLATFORM_LABEL = {
    vodafone_cash: 'فودافون كاش',
    instapay: 'انستاباي',
    bank_transfer: 'تحويل بنكي'
  }

  return (
    <>
      <div className="segmented segmented-lg" role="tablist" aria-label="الأدراج">
        {SUBTABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeSubTab === t.id}
              className={activeSubTab === t.id ? 'active' : ''}
              onClick={() => setActiveSubTab(t.id)}
            >
              <Icon size={16} aria-hidden="true" />
              {t.label}
            </button>
          )
        })}
      </div>

      {!currentShift && (
        <div className="notice notice-warning">
          <Info size={18} aria-hidden="true" />
          <span>لا توجد وردية مفتوحة حالياً؛ تظهر أرقام الأدراج بعد فتح وردية.</span>
        </div>
      )}

      {currentShift &&
        ((activeSubTab === 'supermarket' && !drawerReady) ||
          (activeSubTab === 'momkn' && momkn.loading && !momkn.summary) ||
          (activeSubTab === 'mobile_money' && mobileMoney.loading && !mobileMoney.summary)) && (
          <div className="loading-state">
            <span className="spinner" aria-hidden="true" />
            جاري حساب أرصدة الدرج...
          </div>
        )}

      {/* ── Supermarket drawer ── */}
      {activeSubTab === 'supermarket' && (drawerReady || !currentShift) && (
        <>
          <div className="stat-grid stat-grid-3">
            <StatCard
              icon={Coins}
              tone="neutral"
              label="العهدة الافتتاحية (كاش)"
              value={`${formatVal(mainDrawerSummary.initialCash)} ج.م`}
            />
            <StatCard
              icon={ReceiptText}
              tone="success"
              label="إجمالي مبيعات الفواتير"
              value={`${sign(mainDrawerSummary.allSales, '+')}${formatVal(mainDrawerSummary.allSales)} ج.م`}
            />
            {(mainDrawerSummary.debtSales > 0 || mainDrawerSummary.digitalSales > 0) && (
              <StatCard
                icon={Smartphone}
                tone="warning"
                label="آجل وتحويلات (لم تدخل الدرج)"
                value={`${sign(mainDrawerSummary.debtSales + mainDrawerSummary.digitalSales, '-')}${formatVal(mainDrawerSummary.debtSales + mainDrawerSummary.digitalSales)} ج.م`}
              />
            )}
            <StatCard
              icon={HandCoins}
              tone="success"
              label="سداد ديون عملاء (داخل)"
              value={`${sign(mainDrawerSummary.inflows, '+')}${formatVal(mainDrawerSummary.inflows)} ج.م`}
            />
            <StatCard
              icon={Truck}
              tone="danger"
              label="مدفوعات موردين (خارج)"
              value={`${sign(mainDrawerSummary.supplierPayments, '-')}${formatVal(mainDrawerSummary.supplierPayments)} ج.م`}
            />
            <StatCard
              icon={NotebookPen}
              tone="danger"
              label="مصروفات ونثريات (خارج)"
              value={`${sign(mainDrawerSummary.expenses, '-')}${formatVal(mainDrawerSummary.expenses)} ج.م`}
            />
          </div>
          <div className="balance-banner is-clear drawer-expected">
            <span>صافي الكاش المتوقع في الدرج حالياً</span>
            <strong className="money">{formatVal(mainDrawerSummary.expectedCash)} ج.م</strong>
          </div>
          <div className="notice notice-info">
            <Info size={18} aria-hidden="true" />
            <span>
              تُحتسب مبيعات الكاش والمدفوعات تلقائياً من مبيعات الوردية النشطة وسجل حركة الخزنة.
            </span>
          </div>
        </>
      )}

      {/* ── Momkn till ── */}
      {activeSubTab === 'momkn' && (
        <>
          <div className="stat-grid stat-grid-3">
            <StatCard
              icon={Smartphone}
              tone="neutral"
              label="رصيد ماكينة ممكن الافتتاحي"
              value={`${formatVal(momkn.summary?.startBalance)} ج.م`}
            />
            <StatCard
              icon={Smartphone}
              tone="info"
              label="رصيد الماكينة المتوقع حالياً"
              value={`${formatVal(momkn.summary?.expectedDigitalBalance)} ج.م`}
              meta="بداية الوردية + التأثير الرقمي"
            />
            <StatCard
              icon={Coins}
              tone="neutral"
              label="كاش فكة درج الماكينة الافتتاحي"
              value={`${formatVal(momkn.summary?.startCash)} ج.م`}
            />
            <StatCard
              icon={ArrowLeftRight}
              tone={(momkn.summary?.totalCashImpact || 0) >= 0 ? 'success' : 'danger'}
              label="تأثير العمليات على كاش الدرج"
              value={`${signedMoney(momkn.summary?.totalCashImpact)} ج.م`}
            />
            <StatCard
              icon={Banknote}
              tone="success"
              label="صافي الكاش المتوقع بالدرج"
              value={`${formatVal(momkn.summary?.expectedCash)} ج.م`}
              meta="الفكة + تأثير العمليات"
            />
            <StatCard
              icon={Percent}
              tone="info"
              label="صافي عمولات ممكن للوردية"
              value={`${formatVal(momkn.summary?.totalCommission)} ج.م`}
            />
          </div>

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">
                <ScrollText size={18} aria-hidden="true" />
                حركات ماكينة ممكن
              </h2>
              <div className="row">
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handlePrintMomknReport}
                  >
                    <Printer size={15} aria-hidden="true" />
                    طباعة تقرير الجرد
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => momkn.setModalOpen(true)}
                >
                  <Plus size={16} aria-hidden="true" />
                  تسجيل حركة
                </button>
              </div>
            </div>
            <div className="card-body">
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>التوقيت</th>
                      <th>نوع العملية</th>
                      <th>الوصف</th>
                      <th className="num">الرصيد الرقمي</th>
                      <th className="num">الكاش المتأثر</th>
                      <th className="num">العمولة</th>
                      <th>ملاحظات</th>
                      {isAdmin && (
                        <th>
                          <span className="visually-hidden">إجراءات</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {!momkn.transactions || momkn.transactions.length === 0 ? (
                      <tr>
                        <td colSpan={isAdmin ? 8 : 7} className="table-empty">
                          لا توجد عمليات مسجلة لماكينة ممكن في هذه الوردية بعد.
                        </td>
                      </tr>
                    ) : (
                      momkn.transactions.map((t) => (
                        <tr key={t.id}>
                          <td className="num nowrap cell-muted">
                            {t.timestamp ? t.timestamp.split(' ')[1] || t.timestamp : '—'}
                          </td>
                          <td>
                            <span
                              className={`badge ${t.operation_type === 'payment' ? 'badge-info' : t.operation_type === 'recharge' ? 'badge-success' : 'badge-danger'}`}
                            >
                              {t.operation_type === 'payment' && 'دفع لعميل'}
                              {t.operation_type === 'recharge' && 'شحن الماكينة'}
                              {t.operation_type === 'refund' && 'مرتجع عملية'}
                            </span>
                          </td>
                          <td className="cell-strong">{t.description}</td>
                          <td className={`num money-strong ${toneOfSigned(t.digital_impact)}`}>
                            {signedMoney(t.digital_impact)}
                          </td>
                          <td className={`num money-strong ${toneOfSigned(t.cash_impact)}`}>
                            {signedMoney(t.cash_impact)}
                          </td>
                          <td className="num text-info">{formatVal(t.commission)}</td>
                          <td className="cell-muted">{t.notes || '—'}</td>
                          {isAdmin && (
                            <td>
                              <div className="cell-actions">
                                <button
                                  type="button"
                                  className="icon-btn danger"
                                  onClick={() => momkn.handleDeleteTransaction(t.id)}
                                  aria-label="حذف الحركة"
                                  title="حذف"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}

      {/* ── Wallets & transfers till ── */}
      {activeSubTab === 'mobile_money' && (
        <>
          <div className="stat-grid">
            <StatCard
              icon={Coins}
              tone="neutral"
              label="كاش درج فودافون الافتتاحي"
              value={`${formatVal(mobileMoney.summary?.startCash)} ج.م`}
            />
            <StatCard
              icon={Banknote}
              tone="success"
              label="صافي الكاش المتوقع بالدرج"
              value={`${formatVal(mobileMoney.summary?.expectedCash)} ج.م`}
            />
            <StatCard
              icon={Smartphone}
              tone="neutral"
              label="رصيد فودافون الافتتاحي"
              value={`${formatVal(mobileMoney.summary?.startBalance)} ج.م`}
            />
            <StatCard
              icon={Smartphone}
              tone="success"
              label="رصيد فودافون كاش المتوقع"
              value={`${formatVal(mobileMoney.summary?.expectedVfcashDigitalBalance)} ج.م`}
            />
            <StatCard
              icon={Zap}
              tone="info"
              label="متحصلات انستاباي (رقمي)"
              value={`${formatVal(mobileMoney.summary?.expectedInstapayDigitalBalance)} ج.م`}
            />
            <StatCard
              icon={Landmark}
              tone="info"
              label="متحصلات تحويل بنكي (رقمي)"
              value={`${formatVal(mobileMoney.summary?.expectedBankDigitalBalance)} ج.م`}
            />
            <StatCard
              icon={ArrowLeftRight}
              tone={(mobileMoney.summary?.totalCashImpact || 0) >= 0 ? 'success' : 'danger'}
              label="التأثير الصافي على الكاش"
              value={`${signedMoney(mobileMoney.summary?.totalCashImpact)} ج.م`}
            />
            <StatCard
              icon={Percent}
              tone="info"
              label="صافي عمولات المحافظ"
              value={`${formatVal(mobileMoney.summary?.totalCommission)} ج.م`}
            />
          </div>

          <section className="card">
            <div className="card-header toolbar">
              <h2 className="card-title">
                <ScrollText size={18} aria-hidden="true" />
                حركات المحافظ والتحويلات
              </h2>
              <div className="segmented" role="group" aria-label="تصفية حسب المنصة">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={mobileMoney.platformFilter === p.id ? 'active' : ''}
                    aria-pressed={mobileMoney.platformFilter === p.id}
                    onClick={() => mobileMoney.setPlatformFilter(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="spacer" />
              {isAdmin && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handlePrintMobileMoneyReport}
                >
                  <Printer size={15} aria-hidden="true" />
                  طباعة تقرير الجرد
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => mobileMoney.setModalOpen(true)}
              >
                <Plus size={16} aria-hidden="true" />
                تسجيل حركة محفظة
              </button>
            </div>
            <div className="card-body">
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>التوقيت</th>
                      <th>المنصة</th>
                      <th>نوع العملية</th>
                      <th className="num">الرصيد الرقمي</th>
                      <th className="num">الكاش المتأثر</th>
                      <th className="num">العمولة</th>
                      <th>المستلم / الهاتف</th>
                      <th>ملاحظات</th>
                      {isAdmin && (
                        <th>
                          <span className="visually-hidden">إجراءات</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {!mobileMoney.transactions || mobileMoney.transactions.length === 0 ? (
                      <tr>
                        <td colSpan={isAdmin ? 9 : 8} className="table-empty">
                          لا توجد عمليات تطابق الفلتر المختار لهذه الوردية.
                        </td>
                      </tr>
                    ) : (
                      mobileMoney.transactions.map((t) => (
                        <tr key={t.id}>
                          <td className="num nowrap cell-muted">
                            {t.timestamp ? t.timestamp.split(' ')[1] || t.timestamp : '—'}
                          </td>
                          <td className="cell-strong nowrap">
                            {PLATFORM_LABEL[t.platform] || t.platform}
                          </td>
                          <td>
                            <span
                              className={`badge ${t.operation_type === 'withdraw_from_client' ? 'badge-success' : 'badge-danger'}`}
                            >
                              {t.operation_type === 'withdraw_from_client'
                                ? 'سحب من زبون (سائل)'
                                : 'إيداع لزبون (رصيد)'}
                            </span>
                          </td>
                          <td className={`num money-strong ${toneOfSigned(t.digital_impact)}`}>
                            {signedMoney(t.digital_impact)}
                          </td>
                          <td className={`num money-strong ${toneOfSigned(t.cash_impact)}`}>
                            {signedMoney(t.cash_impact)}
                          </td>
                          <td className="num text-info">{formatVal(t.commission)}</td>
                          <td>
                            {t.recipient_name ? `${t.recipient_name} · ` : ''}
                            <span className="num" dir="ltr">
                              {t.phone_or_account || '—'}
                            </span>
                          </td>
                          <td className="cell-muted">{t.notes || '—'}</td>
                          {isAdmin && (
                            <td>
                              <div className="cell-actions">
                                <button
                                  type="button"
                                  className="icon-btn danger"
                                  onClick={() => mobileMoney.handleDeleteTransaction(t.id)}
                                  aria-label="حذف الحركة"
                                  title="حذف"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}

      <MomknOperationModal
        isOpen={momkn.modalOpen}
        onClose={() => momkn.setModalOpen(false)}
        onSubmit={momkn.handleAddTransaction}
      />
      <MobileMoneyOperationModal
        isOpen={mobileMoney.modalOpen}
        onClose={() => mobileMoney.setModalOpen(false)}
        onSubmit={mobileMoney.handleAddTransaction}
      />
    </>
  )
}

export default TillsManagerTab
