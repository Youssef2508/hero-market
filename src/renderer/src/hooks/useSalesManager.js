import { useState } from 'react'
import { api } from '../lib/api'
import { refundText } from '../lib/refundText'

export function useSalesManager({
  currentShift,
  fetchAdminData,
  triggerCustomAlert,
  triggerCustomConfirm
}) {
  const [salesHistory, setSalesHistory] = useState([])
  const [salesSearch, setSalesSearch] = useState('')
  const [selectedSale, setSelectedSale] = useState(null)
  const [selectedSaleItems, setSelectedSaleItems] = useState([])
  const [salesSortField, setSalesSortField] = useState('id')
  const [salesSortAsc, setSalesSortAsc] = useState(false)
  const [salesPage, setSalesPage] = useState(1)
  const [salesTotalCount, setSalesTotalCount] = useState(0)
  const itemsPerPage = 12

  const fetchSalesHistory = async (search = '', sortField = null, sortAsc = null, page = 1) => {
    try {
      const activeSortField = sortField !== null ? sortField : salesSortField
      const activeSortAsc = sortAsc !== null ? sortAsc : salesSortAsc
      if (sortField !== null) setSalesSortField(sortField)
      if (sortAsc !== null) setSalesSortAsc(sortAsc)

      const res = await api('sales.page', {
        search: search || '',
        sortField: activeSortField,
        sortAsc: activeSortAsc,
        page
      })
      setSalesTotalCount(res.total || 0)
      setSalesHistory(res.rows || [])
      setSalesPage(page)
    } catch (e) {
      console.error('Failed to fetch sales history:', e)
    }
  }

  const selectSaleForDetail = async (sale) => {
    try {
      const { items, discounts, corrections, shiftOpen } = await api('sales.detail', {
        saleId: sale.id
      })
      // Discounts of the invoice, incl. a manual one with who and why (D-057); payment method
      // changes and whether its shift is still open (PAY-02).
      setSelectedSale({
        ...sale,
        discounts: discounts || [],
        corrections: corrections || [],
        shiftOpen: !!shiftOpen
      })
      setSelectedSaleItems(items || [])
    } catch (e) {
      console.error('Failed to load sale details:', e)
    }
  }

  const handleReturnItem = async (saleItem, returnQty) => {
    const qtyToReturn = parseFloat(returnQty) || 0
    const alreadyReturned = saleItem.returned_qty || 0
    const maxReturnable = saleItem.quantity - alreadyReturned

    if (qtyToReturn <= 0 || qtyToReturn > maxReturnable) {
      triggerCustomAlert(
        `الرجاء إدخال كمية مرتجع صحيحة (أكبر من 0 ولا تزيد عن المتبقي: ${maxReturnable}).`
      )
      return
    }

    triggerCustomConfirm(
      `هل أنت متأكد من رغبتك في إرجاع كمية ${qtyToReturn} من الصنف "${saleItem.name || saleItem.product_barcode}"؟`,
      async () => {
        try {
          const res = await api('sales.returnItem', {
            saleItemId: saleItem.id,
            quantity: qtyToReturn,
            currentShiftId: currentShift && currentShift.id ? currentShift.id : null
          })
          triggerCustomAlert(`${refundText(res)} تم تحديث المخزن.`)
          if (fetchAdminData) await fetchAdminData()
          // Reload details to show updated item returned status
          if (res.sale) {
            setSelectedSale(res.sale)
            setSelectedSaleItems(res.items || [])
          }
        } catch (e) {
          triggerCustomAlert('فشلت عملية الإرجاع: ' + e.message)
        }
      }
    )
  }

  const handleReturnEntireSale = async (saleId) => {
    triggerCustomConfirm(
      'هل أنت متأكد من رغبتك في إلغاء وإرجاع الفاتورة بالكامل؟ سيتم إعادة جميع الكميات إلى المخزن وتصفير قيمتها المتبقية.',
      async () => {
        try {
          const res = await api('sales.returnEntire', {
            saleId,
            currentShiftId: currentShift && currentShift.id ? currentShift.id : null
          })
          triggerCustomAlert(`${refundText(res)} أُعيدت كل الأصناف للمخزن.`)
          if (fetchAdminData) await fetchAdminData()
          if (res.sale) {
            setSelectedSale(res.sale)
            setSelectedSaleItems(res.items || [])
          }
        } catch (e) {
          triggerCustomAlert('فشل إرجاع الفاتورة بالكامل: ' + e.message)
        }
      }
    )
  }

  return {
    salesHistory,
    setSalesHistory,
    salesSearch,
    setSalesSearch,
    selectedSale,
    setSelectedSale,
    selectedSaleItems,
    setSelectedSaleItems,
    salesSortField,
    salesSortAsc,
    fetchSalesHistory,
    selectSaleForDetail,
    handleReturnItem,
    handleReturnEntireSale,
    salesPage,
    salesTotalCount,
    itemsPerPage
  }
}
