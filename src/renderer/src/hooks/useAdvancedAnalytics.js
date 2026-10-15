import { useState } from 'react'
import { executeQuery } from '../lib/db'

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

  const setQuickFilter = (type) => {
    const now = new Date()
    const end = getNowStr(now)
    let start

    if (type === 'today') {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      start = getNowStr(d)
      setFromDate(start.slice(0, 16))
      setToDate(end.slice(0, 16))
    } else if (type === 'yesterday') {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      d.setHours(0, 0, 0, 0)
      const e = new Date()
      e.setHours(0, 0, 0, 0)
      setFromDate(getNowStr(d).slice(0, 16))
      setToDate(getNowStr(e).slice(0, 16))
    } else if (type === '3days') {
      const d = new Date()
      d.setDate(d.getDate() - 3)
      d.setHours(0, 0, 0, 0)
      start = getNowStr(d)
      setFromDate(start.slice(0, 16))
      setToDate(end.slice(0, 16))
    } else if (type === 'week') {
      const d = new Date()
      d.setDate(d.getDate() - 7)
      d.setHours(0, 0, 0, 0)
      start = getNowStr(d)
      setFromDate(start.slice(0, 16))
      setToDate(end.slice(0, 16))
    } else if (type === 'month') {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      d.setHours(0, 0, 0, 0)
      start = getNowStr(d)
      setFromDate(start.slice(0, 16))
      setToDate(end.slice(0, 16))
    } else {
      setFromDate('2020-01-01T00:00')
      setToDate(end.slice(0, 16))
    }
  }

  const runAnalysis = async () => {
    setLoading(true)
    try {
      const from = fromDate.replace('T', ' ') + ':00'
      const to = toDate.replace('T', ' ') + ':59'

      const shiftsInRange = await executeQuery(`
        SELECT s.id, s.start_time, s.end_time, s.initial_cash, s.expected_end_cash,
               s.actual_end_cash, s.difference, s.status, u.username
        FROM shifts s
        JOIN users u ON s.user_id = u.id
        WHERE s.start_time >= '${from}' AND s.start_time <= '${to}'
        ORDER BY s.id ASC;
      `)

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

      const idsStr = shiftIds.join(',')
      const shiftCond = `WHERE shift_id IN (${idsStr})`
      const salesShiftCond = `WHERE s.shift_id IN (${idsStr})`

      const salesSumRes = await executeQuery(`
        SELECT SUM(total_amount) as total, COUNT(*) as count, AVG(total_amount) as avg_amount,
               MAX(total_amount) as max_amount,
               SUM(CASE WHEN payment_type = 'آجل' THEN total_amount ELSE 0 END) as debt,
               SUM(CASE WHEN payment_type != 'آجل' THEN total_amount ELSE 0 END) as cash
        FROM sales ${shiftCond};
      `)
      const totalSales = salesSumRes[0]?.total || 0
      const invoiceCount = salesSumRes[0]?.count || 0
      const avgInvoice = salesSumRes[0]?.avg_amount || 0
      const maxInvoice = salesSumRes[0]?.max_amount || 0
      const debtSales = salesSumRes[0]?.debt || 0
      const cashSales = salesSumRes[0]?.cash || 0

      const profitRes = await executeQuery(`
        SELECT SUM(si.total_price - ((si.quantity - si.returned_qty) * COALESCE(NULLIF(si.cost_price, 0), p.cost_price))) as profit
        FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_barcode = p.barcode
        ${salesShiftCond};
      `)
      const netProfitRaw = profitRes[0]?.profit || 0

      const damagedRes = await executeQuery(
        `SELECT SUM(quantity * cost_price) as total_cost FROM damaged_goods ${shiftCond};`
      )
      const damagedCost = damagedRes[0]?.total_cost || 0
      const netProfit = netProfitRaw - damagedCost

      const expRes = await executeQuery(`SELECT SUM(amount) as total FROM expenses ${shiftCond};`)
      const totalExpenses = expRes[0]?.total || 0

      const returnsRes = await executeQuery(`
        SELECT SUM(CASE WHEN type='outflow' AND description LIKE 'مرتجع%' THEN amount ELSE 0 END) as returns_total,
               COUNT(CASE WHEN type='outflow' AND description LIKE 'مرتجع%' THEN 1 END) as returns_count
        FROM safe_ledger ${shiftCond};
      `)
      const totalReturns = returnsRes[0]?.returns_total || 0
      const returnCount = returnsRes[0]?.returns_count || 0

      const safeRes = await executeQuery(`
        SELECT SUM(CASE WHEN type='inflow' THEN amount ELSE 0 END) as inflows,
               SUM(CASE WHEN type='outflow' THEN amount ELSE 0 END) as outflows
        FROM safe_ledger ${shiftCond};
      `)
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

      const perShiftSales = await executeQuery(`
        SELECT shift_id, SUM(total_amount) as sales, COUNT(*) as invoices,
               SUM(CASE WHEN payment_type='آجل' THEN total_amount ELSE 0 END) as debt
        FROM sales ${shiftCond} GROUP BY shift_id;
      `)
      const perShiftProfit = await executeQuery(`
        SELECT s.shift_id,
               SUM(si.total_price - ((si.quantity - si.returned_qty) * COALESCE(NULLIF(si.cost_price, 0), p.cost_price))) as profit
        FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_barcode = p.barcode
        ${salesShiftCond} GROUP BY s.shift_id;
      `)
      const perShiftExpenses = await executeQuery(
        `SELECT shift_id, SUM(amount) as expenses FROM expenses ${shiftCond} GROUP BY shift_id;`
      )

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

      const hourlyRes = await executeQuery(`
        SELECT CAST(strftime('%H', timestamp) AS INTEGER) as hour, COUNT(*) as invoice_count,
               SUM(total_amount) as total_sales, AVG(total_amount) as avg_sale
        FROM sales ${shiftCond} GROUP BY hour ORDER BY hour ASC;
      `)
      setPeakHours(hourlyRes)

      const dailyRes = await executeQuery(`
        SELECT DATE(timestamp) as day, COUNT(*) as invoice_count, SUM(total_amount) as total_sales
        FROM sales ${shiftCond} GROUP BY day ORDER BY day ASC;
      `)
      setDailyTrend(dailyRes)

      const topRes = await executeQuery(`
        -- D-009: sale_items has no product_name column; take the name from products (already joined).
        SELECT si.product_barcode, p.name AS product_name,
               SUM(si.quantity - si.returned_qty) as qty_sold,
               SUM(si.total_price) as revenue,
               SUM(si.total_price - ((si.quantity - si.returned_qty) * COALESCE(NULLIF(si.cost_price, 0), p.cost_price))) as profit
        FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_barcode = p.barcode
        ${salesShiftCond} GROUP BY si.product_barcode ORDER BY qty_sold DESC LIMIT 10;
      `)
      setTopProducts(topRes)

      const payRes = await executeQuery(`
        SELECT payment_type, COUNT(*) as count, SUM(total_amount) as total
        FROM sales ${shiftCond} GROUP BY payment_type;
      `)
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
