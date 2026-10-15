import { useState } from 'react'
import { api } from '../lib/api'

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
      // Same period rule (shifts started since the start of the day N days ago), computed by the service.
      const res = await api('reports.bestSellers', {
        period: periodDays[period] ? period : 'weekly'
      })
      setBsTopSellers(res.top || [])
      setBsSlowMovers(res.slow || [])
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
