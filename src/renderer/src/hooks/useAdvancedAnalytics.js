import { useState } from 'react'
import { api } from '../lib/api'

function getNowStr(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function useAdvancedAnalytics() {
  const [loading, setLoading] = useState(false)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = getNowStr(today)
  const nowStr = getNowStr(new Date())

  const [fromDate, setFromDate] = useState(todayStr.slice(0, 16))
  const [toDate, setToDate] = useState(nowStr.slice(0, 16))

  const [summary, setSummary] = useState(null)
  const [shiftRows, setShiftRows] = useState([])
  const [peakHours, setPeakHours] = useState([])
  const [dailyTrend, setDailyTrend] = useState([])
  const [topProducts, setTopProducts] = useState([])
  const [paymentBreakdown, setPaymentBreakdown] = useState([])

  // Quick ranges (ANALYTICS-01): calendar days in local time, today included – "3 أيام" is today
  // and the 2 days before; "أمس" is yesterday 00:00–23:59. A quick range runs the analysis at once,
  // so the figures always match the dates shown.
  const setQuickFilter = (type) => {
    const dayStart = (back) => {
      const d = new Date()
      d.setDate(d.getDate() - back)
      d.setHours(0, 0, 0, 0)
      return getNowStr(d).slice(0, 16)
    }
    const now = getNowStr(new Date()).slice(0, 16)
    const DAYS = { today: 1, '3days': 3, week: 7, month: 30 }
    let from
    let to = now
    if (type === 'yesterday') {
      from = dayStart(1)
      to = from.slice(0, 11) + '23:59'
    } else if (DAYS[type]) from = dayStart(DAYS[type] - 1)
    else from = '2000-01-01T00:00'
    setFromDate(from)
    setToDate(to)
    runAnalysis({ from, to })
  }

  // `range` ({ from, to } as 'YYYY-MM-DDTHH:mm') is passed by the quick ranges, because the date
  // fields only update on the next render.
  const runAnalysis = async (range) => {
    setLoading(true)
    try {
      const pick = range && range.from ? range : { from: fromDate, to: toDate }
      const from = pick.from.replace('T', ' ') + ':00'
      const to = pick.to.replace('T', ' ') + ':59'

      const report = await api('reports.advanced', { from, to })
      const shiftsInRange = report.shifts || []

      const shiftIds = shiftsInRange.map((s) => s.id)

      if (shiftIds.length === 0) {
        setSummary({
          totalSales: 0,
          invoiceCount: 0,
          avgInvoice: 0,
          netProfit: 0,
          profitMargin: 0,
          totalExpenses: 0,
          totalReturns: 0,
          cashSales: 0,
          debtSales: 0,
          netCashFlow: 0,
          maxInvoice: 0,
          returnCount: 0,
          damagedCost: 0
        })
        setShiftRows([])
        setPeakHours([])
        setDailyTrend([])
        setTopProducts([])
        setPaymentBreakdown([])
        setLoading(false)
        return
      }

      const salesSumRes = [report.salesSum]
      const totalSales = salesSumRes[0]?.total || 0
      const invoiceCount = salesSumRes[0]?.count || 0
      const avgInvoice = salesSumRes[0]?.avg_amount || 0
      const maxInvoice = salesSumRes[0]?.max_amount || 0
      const debtSales = salesSumRes[0]?.debt || 0
      const cashSales = salesSumRes[0]?.cash || 0

      const profitRes = [report.profit]
      const netProfitRaw = profitRes[0]?.profit || 0

      const damagedRes = [report.damaged]
      const damagedCost = damagedRes[0]?.total_cost || 0
      const netProfit = netProfitRaw - damagedCost

      const expRes = [report.expenses]
      const totalExpenses = expRes[0]?.total || 0

      const returnsRes = [report.returns]
      const totalReturns = returnsRes[0]?.returns_total || 0
      const returnCount = returnsRes[0]?.returns_count || 0

      const safeRes = [report.safe]
      const safeInflows = safeRes[0]?.inflows || 0
      const safeOutflows = safeRes[0]?.outflows || 0
      const netCashFlow = cashSales + safeInflows - safeOutflows - totalExpenses
      const profitMargin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0

      setSummary({
        totalSales,
        invoiceCount,
        avgInvoice,
        netProfit,
        profitMargin,
        totalExpenses,
        totalReturns,
        cashSales,
        debtSales,
        netCashFlow,
        maxInvoice,
        returnCount,
        damagedCost
      })

      const perShiftSales = report.perShiftSales || []
      const perShiftProfit = report.perShiftProfit || []
      const perShiftExpenses = report.perShiftExpenses || []

      const salesByShift = {}
      perShiftSales.forEach((r) => {
        salesByShift[r.shift_id] = r
      })
      const profitByShift = {}
      perShiftProfit.forEach((r) => {
        profitByShift[r.shift_id] = r.profit || 0
      })
      const expensesByShift = {}
      perShiftExpenses.forEach((r) => {
        expensesByShift[r.shift_id] = r.expenses || 0
      })

      const rows = shiftsInRange.map((sh) => {
        const sales = salesByShift[sh.id]?.sales || 0
        const invoices = salesByShift[sh.id]?.invoices || 0
        const debt = salesByShift[sh.id]?.debt || 0
        const profit = profitByShift[sh.id] || 0
        const expenses = expensesByShift[sh.id] || 0
        let durationHrs = null
        if (sh.start_time && sh.end_time) {
          const s = new Date(sh.start_time),
            e = new Date(sh.end_time)
          durationHrs = ((e - s) / 3600000).toFixed(1)
        }
        const margin = sales > 0 ? (profit / sales) * 100 : 0
        const stars = margin >= 15 ? 3 : margin >= 8 ? 2 : 1
        return { ...sh, sales, invoices, debt, profit, expenses, durationHrs, stars }
      })
      setShiftRows(rows)

      const hourlyRes = report.hourly || []
      setPeakHours(hourlyRes)

      const dailyRes = report.daily || []
      setDailyTrend(dailyRes)

      const topRes = report.top || []
      setTopProducts(topRes)

      const payRes = report.payments || []
      setPaymentBreakdown(payRes)
    } catch (e) {
      console.error('useAdvancedAnalytics error:', e)
    } finally {
      setLoading(false)
    }
  }

  return {
    loading,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    setQuickFilter,
    runAnalysis,
    summary,
    shiftRows,
    peakHours,
    dailyTrend,
    topProducts,
    paymentBreakdown
  }
}
