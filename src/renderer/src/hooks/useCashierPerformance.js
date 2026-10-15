import { useState } from 'react'
import { executeQuery } from '../lib/db'

function pad(n) {
  return String(n).padStart(2, '0')
}
function getNowStr(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function calcScore({ profitMargin, avgInvoice, returnRate, avgAbsCashDiff }) {
  const profitPts = Math.min(40, (profitMargin / 15) * 40)
  const invoicePts = Math.min(20, (avgInvoice / 80) * 20)
  const returnPts = Math.max(0, 20 - returnRate * 2)
  const cashPts = Math.max(0, 20 - avgAbsCashDiff / 5)
  return Math.round(Math.min(100, Math.max(0, profitPts + invoicePts + returnPts + cashPts)))
}

function gradeFromScore(score) {
  if (score >= 80) return { label: 'ممتاز', color: '#10b981', emoji: '🥇' }
  if (score >= 60) return { label: 'جيد جداً', color: '#3b82f6', emoji: '🥈' }
  if (score >= 40) return { label: 'جيد', color: '#f59e0b', emoji: '🥉' }
  return { label: 'يحتاج تحسين', color: '#ef4444', emoji: '⚠️' }
}

export function useCashierPerformance() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Default: show ALL data
  const [fromDate, setFromDate] = useState('2020-01-01T00:00')
  const [toDate, setToDate] = useState(getNowStr(new Date()).slice(0, 16))

  const [cashiers, setCashiers] = useState([])
  const [selectedCashier, setSelectedCashier] = useState(null)
  const [drilldown, setDrilldown] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [comparisonKey, setComparisonKey] = useState('totalSales')

  const setQuickFilter = (type) => {
    const now = new Date()
    const endStr = getNowStr(now).slice(0, 16)
    let startStr
    if (type === 'today') {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      startStr = getNowStr(d).slice(0, 16)
    } else if (type === 'yesterday') {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      d.setHours(0, 0, 0, 0)
      const e = new Date()
      e.setHours(0, 0, 0, 0)
      setFromDate(getNowStr(d).slice(0, 16))
      setToDate(getNowStr(e).slice(0, 16))
      return
    } else if (type === '3days') {
      const d = new Date()
      d.setDate(d.getDate() - 3)
      d.setHours(0, 0, 0, 0)
      startStr = getNowStr(d).slice(0, 16)
    } else if (type === 'week') {
      const d = new Date()
      d.setDate(d.getDate() - 7)
      d.setHours(0, 0, 0, 0)
      startStr = getNowStr(d).slice(0, 16)
    } else if (type === 'month') {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      d.setHours(0, 0, 0, 0)
      startStr = getNowStr(d).slice(0, 16)
    } else {
      startStr = '2020-01-01T00:00'
    }
    setFromDate(startStr)
    setToDate(endStr)
  }

  const runAnalysis = async () => {
    setLoading(true)
    setError(null)
    setSelectedCashier(null)
    setDrilldown(null)
    try {
      const from = fromDate.replace('T', ' ') + ':00'
      const to = toDate.replace('T', ' ') + ':59'

      // 1. Shifts in range
      const shiftsInRange = await executeQuery(
        `SELECT s.id as shift_id, s.user_id, s.difference, s.start_time, s.end_time,
                s.initial_cash, s.actual_end_cash, s.expected_end_cash, u.username
         FROM shifts s JOIN users u ON s.user_id = u.id
         WHERE s.start_time >= '${from}' AND s.start_time <= '${to}'
         ORDER BY s.id ASC`
      )

      if (!shiftsInRange || shiftsInRange.length === 0) {
        setCashiers([])
        setAlerts([])
        return
      }

      const idsStr = shiftsInRange.map((s) => s.shift_id).join(',')
      const shiftCond = `WHERE shift_id IN (${idsStr})`
      const joinCond = `WHERE s.shift_id IN (${idsStr})`

      // 2. Sales per shift
      const salesRows = await executeQuery(
        `SELECT shift_id,
           COUNT(*) as invoices,
           SUM(total_amount) as sales,
           AVG(total_amount) as avg_invoice,
           MAX(total_amount) as max_invoice,
           SUM(CASE WHEN payment_type='آجل' THEN total_amount ELSE 0 END) as debt_sales
         FROM sales ${shiftCond} GROUP BY shift_id`
      )

      // 3. Profit per shift — LEFT JOIN products for cost_price fallback (safe: won't hang on deleted products)
      const profitRows = await executeQuery(
        `SELECT s.shift_id,
           SUM(si.total_price - ((si.quantity - COALESCE(si.returned_qty,0)) * COALESCE(NULLIF(si.cost_price,0), COALESCE(p.cost_price,0)))) as profit,
           SUM(COALESCE(si.returned_qty, 0)) as returned_qty,
           SUM(CASE WHEN COALESCE(si.returned_qty,0) > 0 THEN 1 ELSE 0 END) as return_count
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         LEFT JOIN products p ON si.product_barcode = p.barcode
         ${joinCond} GROUP BY s.shift_id`
      )

      // 4. Expenses per shift
      const expRows = await executeQuery(
        `SELECT shift_id, SUM(amount) as expenses FROM expenses ${shiftCond} GROUP BY shift_id`
      )

      // Build lookup maps
      const salesMap = {}
      salesRows.forEach((r) => {
        salesMap[r.shift_id] = r
      })
      const profitMap = {}
      profitRows.forEach((r) => {
        profitMap[r.shift_id] = r
      })
      const expMap = {}
      expRows.forEach((r) => {
        expMap[r.shift_id] = r
      })

      // Group by user
      const byUser = {}
      shiftsInRange.forEach((sh) => {
        if (!byUser[sh.user_id])
          byUser[sh.user_id] = { username: sh.username, user_id: sh.user_id, shifts: [] }
        byUser[sh.user_id].shifts.push(sh)
      })

      // Aggregate per user
      const cashierList = Object.values(byUser).map((u) => {
        let totalSales = 0,
          totalInvoices = 0,
          totalDebt = 0,
          totalProfit = 0,
          totalReturned = 0,
          totalReturnCount = 0,
          totalExpenses = 0,
          maxInvoice = 0,
          totalCashDiff = 0,
          closedShifts = 0

        u.shifts.forEach((sh) => {
          const sr = salesMap[sh.shift_id] || {}
          const pr = profitMap[sh.shift_id] || {}
          const er = expMap[sh.shift_id] || {}
          totalSales += Number(sr.sales || 0)
          totalInvoices += Number(sr.invoices || 0)
          totalDebt += Number(sr.debt_sales || 0)
          totalProfit += Number(pr.profit || 0)
          totalReturned += Number(pr.returned_qty || 0)
          totalReturnCount += Number(pr.return_count || 0)
          totalExpenses += Number(er.expenses || 0)
          if (Number(sr.max_invoice || 0) > maxInvoice) maxInvoice = Number(sr.max_invoice || 0)
          if (sh.difference !== null && sh.difference !== undefined) {
            totalCashDiff += Number(sh.difference)
            closedShifts++
          }
        })

        const avgInvoice = totalInvoices > 0 ? totalSales / totalInvoices : 0
        const profitMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0
        const returnRate = totalInvoices > 0 ? (totalReturnCount / totalInvoices) * 100 : 0
        const avgAbsCashDiff = closedShifts > 0 ? Math.abs(totalCashDiff) / closedShifts : 0
        const debtPct = totalSales > 0 ? (totalDebt / totalSales) * 100 : 0
        const score = calcScore({ profitMargin, avgInvoice, returnRate, avgAbsCashDiff })
        const grade = gradeFromScore(score)

        return {
          user_id: u.user_id,
          username: u.username,
          shiftCount: u.shifts.length,
          closedShifts,
          totalSales,
          totalInvoices,
          totalDebt,
          totalProfit,
          totalExpenses,
          totalReturned,
          totalReturnCount,
          maxInvoice,
          totalCashDiff,
          avgInvoice,
          profitMargin,
          returnRate,
          avgAbsCashDiff,
          debtPct,
          score,
          grade,
          avgSalesPerShift: u.shifts.length > 0 ? totalSales / u.shifts.length : 0
        }
      })

      cashierList.sort((a, b) => b.score - a.score)
      setCashiers(cashierList)

      // Smart alerts
      const newAlerts = []
      if (cashierList.length > 0)
        newAlerts.push({
          type: 'success',
          msg: `أفضل كاشير في الفترة: ${cashierList[0].username} بدرجة ${cashierList[0].score}/100`
        })
      cashierList.forEach((c) => {
        if (c.returnRate > 10)
          newAlerts.push({
            type: 'danger',
            msg: `${c.username}: معدل المرتجعات مرتفع (${c.returnRate?.toFixed(1)}%)`
          })
        if (c.avgAbsCashDiff > 50)
          newAlerts.push({
            type: 'danger',
            msg: `${c.username}: متوسط عجز الخزينة عالٍ (${c.avgAbsCashDiff?.toFixed(2)} ج.م)`
          })
        if (c.debtPct > 30)
          newAlerts.push({
            type: 'warning',
            msg: `${c.username}: نسبة المبيعات الآجل مرتفعة (${c.debtPct?.toFixed(1)}%)`
          })
      })
      setAlerts(newAlerts)
    } catch (e) {
      console.error('useCashierPerformance runAnalysis error:', e)
      setError('حدث خطأ أثناء جلب البيانات. حاول مرة أخرى.')
    } finally {
      setLoading(false)
    }
  }

  const loadDrilldown = async (cashier) => {
    setLoading(true)
    setError(null)
    try {
      const from = fromDate.replace('T', ' ') + ':00'
      const to = toDate.replace('T', ' ') + ':59'

      const shiftsOfUser = await executeQuery(
        `SELECT id as shift_id, start_time, end_time, difference, status
         FROM shifts
         WHERE user_id = ${cashier.user_id}
           AND start_time >= '${from}' AND start_time <= '${to}'
         ORDER BY id ASC`
      )

      if (!shiftsOfUser || shiftsOfUser.length === 0) {
        setDrilldown({ shifts: [], daily: [], topProducts: [], peakHours: [], payment: [] })
        return
      }

      const ids = shiftsOfUser.map((s) => s.shift_id).join(',')
      const sCond = `WHERE shift_id IN (${ids})`
      const jCond = `WHERE s.shift_id IN (${ids})`

      const shiftSales = await executeQuery(
        `SELECT shift_id, COUNT(*) as invoices, SUM(total_amount) as sales FROM sales ${sCond} GROUP BY shift_id`
      )
      const shiftProfit = await executeQuery(
        `SELECT s.shift_id,
           SUM(si.total_price - ((si.quantity - COALESCE(si.returned_qty,0)) * COALESCE(NULLIF(si.cost_price,0), COALESCE(p.cost_price,0)))) as profit
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         LEFT JOIN products p ON si.product_barcode = p.barcode
         ${jCond} GROUP BY s.shift_id`
      )

      const ssMap = {}
      shiftSales.forEach((r) => {
        ssMap[r.shift_id] = r
      })
      const spMap = {}
      shiftProfit.forEach((r) => {
        spMap[r.shift_id] = r
      })

      const shiftsDetail = shiftsOfUser.map((sh) => ({
        ...sh,
        invoices: ssMap[sh.shift_id]?.invoices || 0,
        sales: ssMap[sh.shift_id]?.sales || 0,
        profit: spMap[sh.shift_id]?.profit || 0,
        duration:
          sh.start_time && sh.end_time
            ? ((new Date(sh.end_time) - new Date(sh.start_time)) / 3600000).toFixed(1)
            : null
      }))

      const daily = await executeQuery(
        `SELECT DATE(timestamp) as day, SUM(total_amount) as sales, COUNT(*) as invoices
         FROM sales ${sCond} GROUP BY day ORDER BY day ASC`
      )

      const topProducts = await executeQuery(
        `SELECT si.product_name,
           SUM(si.quantity - COALESCE(si.returned_qty,0)) as qty,
           SUM(si.total_price) as revenue
         FROM sale_items si JOIN sales s ON si.sale_id = s.id ${jCond}
         GROUP BY si.product_barcode ORDER BY qty DESC LIMIT 5`
      )

      const peakHours = await executeQuery(
        `SELECT CAST(strftime('%H', timestamp) AS INTEGER) as hour,
           COUNT(*) as invoices, SUM(total_amount) as sales
         FROM sales ${sCond} GROUP BY hour ORDER BY hour ASC`
      )

      const payment = await executeQuery(
        `SELECT payment_type, COUNT(*) as count, SUM(total_amount) as total
         FROM sales ${sCond} GROUP BY payment_type`
      )

      setDrilldown({ shifts: shiftsDetail, daily, topProducts, peakHours, payment })
    } catch (e) {
      console.error('loadDrilldown error:', e)
      setError('حدث خطأ أثناء جلب تفاصيل الكاشير.')
      setDrilldown({ shifts: [], daily: [], topProducts: [], peakHours: [], payment: [] })
    } finally {
      setLoading(false)
    }
  }

  return {
    loading,
    error,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    setQuickFilter,
    runAnalysis,
    cashiers,
    alerts,
    comparisonKey,
    setComparisonKey,
    selectedCashier,
    setSelectedCashier,
    drilldown,
    loadDrilldown
  }
}
