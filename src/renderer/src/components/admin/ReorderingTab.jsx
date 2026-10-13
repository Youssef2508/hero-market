import { useState, useEffect } from 'react'
import { executeQuery } from '../../lib/db'
import {
  ShoppingCart,
  Banknote,
  Copy,
  Check,
  Search,
  RefreshCw,
  Printer,
  FileDown,
  CalendarDays,
  PackageCheck
} from 'lucide-react'
import { EmptyState, StatCard } from '../ui'
import { formatMoney, getNowStr } from '../../lib/utils'

export default function ReorderingTab() {
  const [loading, setLoading] = useState(false)
  const [products, setProducts] = useState([])
  const [salesMap, setSalesMap] = useState({})
  const [targetDays, setTargetDays] = useState(15) // Cover next 15 days
  const [searchQuery, setSearchQuery] = useState('')
  const [copied, setCopied] = useState(false)

  // Fetch products and compute sales velocity
  const calculateReordering = async () => {
    setLoading(true)
    try {
      // 1. Fetch all products
      const allProducts = await executeQuery(
        // D-009: products has no `price` column (the original query failed); the field is unused but kept as an alias.
        'SELECT barcode, name, stock_qty as stock, reorder_limit, unit, cost_price as cost, retail_price as price FROM products;'
      )

      // 2. Fetch shifts in the last 30 days
      const sinceDate = new Date()
      sinceDate.setDate(sinceDate.getDate() - 30)
      sinceDate.setHours(0, 0, 0, 0)

      const sinceStr = getNowStr(sinceDate)
      const matchingShifts = await executeQuery(
        `SELECT id FROM shifts WHERE start_time >= '${sinceStr}';`
      )
      const shiftIds = matchingShifts.map((sh) => sh.id)

      // 3. Fetch sales quantity for these shifts
      let salesData = []
      if (shiftIds.length > 0) {
        const query = `
          SELECT product_barcode, SUM(quantity) as total_qty
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.shift_id IN (${shiftIds.join(',')})
          GROUP BY product_barcode;
        `
        salesData = await executeQuery(query)
      }

      // Map sales
      const sMap = {}
      salesData.forEach((row) => {
        sMap[row.product_barcode] = row.total_qty || 0
      })

      setSalesMap(sMap)
      setProducts(allProducts)
    } catch (e) {
      console.error('Reordering calculator error:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    calculateReordering()
  }, [])

  // Process data based on targetDays
  const items = products
    .map((p) => {
      const sold30 = salesMap[p.barcode] || 0
      const dailyVelocity = sold30 / 30
      const neededForPeriod = dailyVelocity * targetDays

      let recommended = Math.ceil(neededForPeriod - p.stock)

      // Safety check: if product is below reorder limit, recommend ordering at least 2x limit
      if (p.stock <= p.reorder_limit) {
        const safetyAmt = p.reorder_limit > 0 ? p.reorder_limit * 2 : 5
        recommended = Math.max(recommended, safetyAmt)
      }

      recommended = Math.max(0, recommended)
      const estCost = recommended * (p.cost || 0)

      return {
        ...p,
        sold30,
        dailyVelocity,
        recommended,
        estCost
      }
    })
    .filter((item) => {
      // Only show items that have a recommended order quantity > 0
      if (item.recommended <= 0) return false
      if (searchQuery.trim() === '') return true
      return (
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.barcode.includes(searchQuery)
      )
    })

  // Aggregates
  const totalItemsToOrder = items.length
  const totalEstimatedCost = items.reduce((sum, item) => sum + item.estCost, 0)

  const handleCopyOrder = () => {
    if (items.length === 0) return
    let text = `طلبية شراء مقترحة - هيرو ماركت\n`
    text += `تاريخ الطلب: ${new Date().toLocaleDateString('ar-EG')}\n`
    text += `فترة التغطية المطلوبة: ${targetDays} يوم\n`
    text += `===================================\n`
    items.forEach((item, index) => {
      text += `${index + 1}. ${item.name} (${item.barcode})\n`
      text += `   - الكمية المقترحة: ${item.recommended} ${item.unit}\n`
      text += `   - المخزون الحالي: ${item.stock} ${item.unit}\n`
      text += `-----------------------------------\n`
    })
    text += `إجمالي الأصناف: ${totalItemsToOrder} صنف\n`
    text += `إجمالي التكلفة التقديرية: ${totalEstimatedCost?.toFixed(2)} ج.م\n`

    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExportPDF = async () => {
    if (items.length === 0) return
    try {
      const mappedItems = items.map((item) => ({
        name: item.name,
        stock_qty: item.stock,
        min_limit: item.reorder_limit
      }))
      await window.api.generateShortagesPdf(mappedItems)
    } catch (e) {
      console.error('PDF export error:', e)
    }
  }

  const handlePrintInstant = async () => {
    if (items.length === 0) return
    try {
      const mappedItems = items.map((item) => ({
        name: item.name,
        stock_qty: item.stock,
        min_limit: item.reorder_limit
      }))
      await window.api.printShortagesToPrinter(mappedItems)
    } catch (e) {
      console.error('Instant print error:', e)
    }
  }

  return (
    <>
      <div className="page-intro">
        <p>
          يحلل النظام حركة مبيعات كل صنف خلال آخر 30 يوماً ويقترح الكمية المطلوب شراؤها لتغطية
          الفترة التي تختارها.
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={calculateReordering}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} aria-hidden="true" />
          تحديث البيانات
        </button>
      </div>

      <div className="toolbar">
        <span className="field-label">فترة التغطية المطلوبة</span>
        <div className="segmented segmented-lg" role="group" aria-label="فترة التغطية">
          {[7, 15, 30, 45].map((days) => (
            <button
              key={days}
              type="button"
              className={targetDays === days ? 'active' : ''}
              aria-pressed={targetDays === days}
              onClick={() => setTargetDays(days)}
            >
              <CalendarDays size={15} aria-hidden="true" />
              {days} يوم
            </button>
          ))}
        </div>
      </div>

      <div className="stat-grid stat-grid-2">
        <StatCard
          icon={ShoppingCart}
          tone="warning"
          label="أصناف بحاجة للطلب"
          value={`${totalItemsToOrder} صنف`}
          meta="مخزونها الحالي لا يكفي فترة التغطية"
        />
        <StatCard
          icon={Banknote}
          tone="accent"
          label="التكلفة التقديرية للشراء"
          value={`${formatMoney(totalEstimatedCost)} ج.م`}
          meta="محسوبة على سعر التكلفة"
        />
      </div>

      <section className="card">
        <div className="card-header toolbar">
          <div className="search-field">
            <Search size={17} aria-hidden="true" />
            <input
              type="text"
              className="input"
              placeholder="ابحث عن صنف بالاسم أو الباركود"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="البحث في الطلبية المقترحة"
            />
          </div>
          <div className="spacer" />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handlePrintInstant}
            disabled={items.length === 0}
          >
            <Printer size={16} aria-hidden="true" />
            طباعة حرارية
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportPDF}
            disabled={items.length === 0}
          >
            <FileDown size={16} aria-hidden="true" />
            حفظ PDF
          </button>
          <button
            type="button"
            className={`btn ${copied ? 'btn-success' : 'btn-primary'}`}
            onClick={handleCopyOrder}
            disabled={items.length === 0}
          >
            {copied ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Copy size={16} aria-hidden="true" />
            )}
            {copied ? 'تم نسخ الطلبية' : 'نسخ الطلبية (واتساب)'}
          </button>
        </div>

        <div className="card-body">
          {items.length === 0 ? (
            loading ? (
              <div className="loading-state">
                <span className="spinner" aria-hidden="true" />
                جاري تحليل المبيعات...
              </div>
            ) : (
              <EmptyState
                icon={PackageCheck}
                title="لا توجد أصناف بحاجة للطلب"
                text="مخزونك يكفي فترة التغطية المحددة."
              />
            )
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>الصنف</th>
                    <th className="num">المخزون الحالي</th>
                    <th className="num">حد الطلب</th>
                    <th className="num">مبيعات 30 يوم</th>
                    <th className="num">الطلب المقترح</th>
                    <th className="num">سعر التكلفة</th>
                    <th className="num">التكلفة الكلية</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const isLow = row.stock <= row.reorder_limit
                    return (
                      <tr key={row.barcode}>
                        <td>
                          <span className="cell-strong">{row.name}</span>
                          <span className="cell-sub mono">{row.barcode}</span>
                        </td>
                        <td className="num nowrap">
                          <span className={isLow ? 'text-danger fw-bold' : ''}>
                            {row.stock} {row.unit}
                          </span>
                          {isLow && <span className="badge badge-danger ms-2">ناقص</span>}
                        </td>
                        <td className="num nowrap cell-muted">
                          {row.reorder_limit} {row.unit}
                        </td>
                        <td className="num">{row.sold30?.toFixed(1)}</td>
                        <td className="num nowrap">
                          <span className="badge badge-accent">
                            {row.recommended} {row.unit}
                          </span>
                        </td>
                        <td className="num">{formatMoney(row.cost || 0)}</td>
                        <td className="num money-strong">{formatMoney(row.estCost)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
