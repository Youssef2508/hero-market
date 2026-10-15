import { useState } from 'react'
import { executeQuery } from '../lib/db'
import { getNowStr } from '../lib/utils'

/**
 * Hook to manage product best-sellers analytics.
 * Provides daily / weekly / monthly ranking of products
 * plus a "slow-movers" (stagnant stock) report.
 */
export function useBestSellersManager() {
  const [bsPeriod, setBsPeriod] = useState('weekly') // 'daily' | 'weekly' | 'monthly'
  const [bsTopSellers, setBsTopSellers] = useState([])
  const [bsSlowMovers, setBsSlowMovers] = useState([])
  const [bsLoading, setBsLoading] = useState(false)

  const periodDays = { daily: 1, weekly: 7, monthly: 30 }

  const fetchBestSellers = async (period = bsPeriod) => {
    setBsLoading(true)
    try {
      const days = periodDays[period] || 7
      const sinceDate = new Date()
      sinceDate.setDate(sinceDate.getDate() - days)
      sinceDate.setHours(0, 0, 0, 0) // start of the target day

      const sinceStr = getNowStr(sinceDate)
      const matchingShifts = await executeQuery(
        `SELECT id FROM shifts WHERE start_time >= '${sinceStr}';`
      )
      const matchingShiftIds = matchingShifts.map((sh) => sh.id)

      if (matchingShiftIds.length === 0) {
        // No sales recorded in the period
        setBsTopSellers([])

        // Slow movers are all products with stock > 0
        const slowRes = await executeQuery(`
          SELECT barcode, name, unit, retail_price AS price, cost_price AS cost, stock_qty AS stock, reorder_limit
          FROM products
          WHERE stock_qty > 0
          ORDER BY stock_qty DESC
          LIMIT 50;
        `)
        setBsSlowMovers(slowRes || [])
        return
      }

      const shiftIdsFilter = matchingShiftIds.join(',')

      // Top sellers: sum net quantities sold per product within active shift IDs
      const topRes = await executeQuery(`
        SELECT
          si.product_barcode        AS barcode,
          p.name                    AS name,
          p.unit                    AS unit,
          p.retail_price            AS price,
          p.cost_price              AS cost,
          p.stock_qty               AS stock,
          SUM(si.quantity - si.returned_qty)  AS total_qty_sold,
          SUM(si.total_price)       AS total_revenue,
          COUNT(DISTINCT CASE WHEN (si.quantity - si.returned_qty) > 0 THEN si.sale_id END) AS times_ordered
        FROM sale_items si
        JOIN sales    s  ON si.sale_id   = s.id
        JOIN products p  ON si.product_barcode = p.barcode
        WHERE s.shift_id IN (${shiftIdsFilter})
        GROUP BY si.product_barcode
        HAVING total_qty_sold > 0
        ORDER BY total_qty_sold DESC
        LIMIT 30;
      `)
      setBsTopSellers(topRes || [])

      // Slow movers: products with stock > 0 that had NO net sales in matching shifts
      const slowRes = await executeQuery(`
        SELECT
          p.barcode,
          p.name,
          p.unit,
          p.retail_price  AS price,
          p.cost_price    AS cost,
          p.stock_qty     AS stock,
          p.reorder_limit AS reorder_limit
        FROM products p
        WHERE p.stock_qty > 0
          AND p.barcode NOT IN (
            SELECT DISTINCT si.product_barcode
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE s.shift_id IN (${shiftIdsFilter})
              AND (si.quantity - si.returned_qty) > 0
          )
        ORDER BY p.stock_qty DESC
        LIMIT 50;
      `)
      setBsSlowMovers(slowRes || [])
    } catch (e) {
      console.error('fetchBestSellers error:', e)
    } finally {
      setBsLoading(false)
    }
  }

  return {
    bsPeriod,
    setBsPeriod,
    bsTopSellers,
    bsSlowMovers,
    bsLoading,
    fetchBestSellers
  }
}
