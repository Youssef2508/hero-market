import { useState } from 'react'
import { api } from '../lib/api'
import { formPhones, phoneFormError } from '../lib/phoneForm'
import { parseLocaleDateString } from '../lib/utils'

export function useClientsManager({
  currentShift,
  fetchStats,
  triggerCustomAlert,
  triggerCustomConfirm
}) {
  const [clientsList, setClientsList] = useState([])
  const [clientsSearch, setClientsSearch] = useState('')
  const [selectedAdminClient, setSelectedAdminClient] = useState(null)
  const [adminClientPurchases, setAdminClientPurchases] = useState([])
  const [adminClientLedger, setAdminClientLedger] = useState([])
  const [repaymentAmount, setRepaymentAmount] = useState('')
  const [showAddClientModal, setShowAddClientModal] = useState(false)
  const [showEditClientModal, setShowEditClientModal] = useState(false)
  const EMPTY_CLIENT = { name: '', phone: '', phone2: '', hasPhone2: false, address: '' }
  const [newClientForm, setNewClientForm] = useState(EMPTY_CLIENT)
  const [editClientForm, setEditClientForm] = useState({ id: '', ...EMPTY_CLIENT })
  const [bestCustomerOfMonth, setBestCustomerOfMonth] = useState(null)
  const [highestPointsCustomer, setHighestPointsCustomer] = useState(null)
  const [monthlyClientsReport, setMonthlyClientsReport] = useState([])
  const [clientTopProducts, setClientTopProducts] = useState([])
  const [clientStats, setClientStats] = useState(null)

  // Raw unfiltered client data for periodic in-memory calculations
  const [rawPurchases, setRawPurchases] = useState([])
  const [rawLedger, setRawLedger] = useState([])
  const [rawSaleItems, setRawSaleItems] = useState([])
  const [clientPeriodFilter, setClientPeriodFilter] = useState('all')

  const filterByPeriod = (itemTimestamp, period) => {
    if (period === 'all') return true
    if (!itemTimestamp) return false
    const itemDate = parseLocaleDateString(itemTimestamp)
    if (!itemDate) return false
    const now = new Date()
    const diffTime = Math.abs(now - itemDate)
    if (period === 'daily') {
      return diffTime <= 24 * 60 * 60 * 1000
    }
    if (period === 'weekly') {
      return diffTime <= 7 * 24 * 60 * 60 * 1000
    }
    if (period === 'monthly') {
      return diffTime <= 30 * 24 * 60 * 60 * 1000
    }
    return true
  }

  const applyFilter = (filterVal, pList, lList, itemsList) => {
    const filteredPurchases = (pList || []).filter((p) => filterByPeriod(p.timestamp, filterVal))
    const filteredLedger = (lList || []).filter((l) => filterByPeriod(l.timestamp, filterVal))

    setAdminClientPurchases(filteredPurchases)
    setAdminClientLedger(filteredLedger)

    const totalOrders = filteredPurchases.length
    const totalSpent = filteredPurchases.reduce((acc, p) => acc + p.total_amount, 0)
    const avgSpent = totalOrders > 0 ? totalSpent / totalOrders : 0

    let lastPurchase = 'لا يوجد'
    if (filteredPurchases.length > 0) {
      const sorted = [...filteredPurchases].sort((a, b) => {
        const db = parseLocaleDateString(b.timestamp) || new Date(0)
        const da = parseLocaleDateString(a.timestamp) || new Date(0)
        return db - da
      })
      lastPurchase = sorted[0].timestamp
    }

    setClientStats({
      total_orders: totalOrders,
      total_spent: totalSpent,
      avg_spent: avgSpent,
      last_purchase: lastPurchase
    })

    const filteredItems = (itemsList || []).filter((item) =>
      filterByPeriod(item.timestamp, filterVal)
    )
    const topMap = {}
    filteredItems.forEach((item) => {
      const barcode = item.product_barcode
      if (!topMap[barcode]) {
        topMap[barcode] = { name: item.name, total_qty: 0, total_spent: 0 }
      }
      topMap[barcode].total_qty += item.quantity
      topMap[barcode].total_spent += item.total_price
    })
    const aggregatedTopProducts = Object.values(topMap)
      .sort((a, b) => b.total_qty - a.total_qty)
      .slice(0, 5)

    setClientTopProducts(aggregatedTopProducts)
  }

  const changeClientPeriodFilter = (filterVal) => {
    setClientPeriodFilter(filterVal)
    applyFilter(filterVal, rawPurchases, rawLedger, rawSaleItems)
  }

  const fetchClientsList = async (search = '') => {
    try {
      setClientsList((await api('clients.list', { search: search || '' })) || [])
    } catch (e) {
      console.error('Failed to fetch clients list:', e)
    }
  }

  // Highest points + this month's ranking (same rules as before, computed by the service).
  const fetchClientStats = async () => {
    try {
      const res = await api('clients.stats')
      setHighestPointsCustomer(res.highestPointsCustomer || null)
      setMonthlyClientsReport(res.monthlyClientsReport || [])
      setBestCustomerOfMonth(res.bestCustomerOfMonth || null)
    } catch (e) {
      console.error('Failed to calculate client stats:', e)
    }
  }

  const selectAdminClientForProfile = async (client) => {
    try {
      setSelectedAdminClient(client)
      const res = await api('clients.profile', { clientId: client.id })
      // Report rows carry only id/name/phone; the profile always holds the full row.
      if (res.client) setSelectedAdminClient(res.client)
      const purchases = res.purchases || []
      const ledger = res.ledger || []
      const saleItems = res.saleItems || []
      setRawPurchases(purchases)
      setRawLedger(ledger)
      setRawSaleItems(saleItems)
      setClientPeriodFilter('all')
      applyFilter('all', purchases, ledger, saleItems)
    } catch (e) {
      console.error('Failed to load client profile:', e)
    }
  }

  const handleAddClient = async (e) => {
    if (e) e.preventDefault()
    const { name, address } = newClientForm
    if (!name) {
      triggerCustomAlert('يرجى إدخال اسم العميل!')
      return
    }
    const phoneError = phoneFormError(newClientForm)
    if (phoneError) {
      triggerCustomAlert(phoneError)
      return
    }
    try {
      await api('clients.create', {
        name,
        phones: formPhones(newClientForm),
        address: address || ''
      })
      triggerCustomAlert('تمت إضافة العميل بنجاح!')
      setNewClientForm(EMPTY_CLIENT)
      setShowAddClientModal(false)
      await fetchClientsList()
      await fetchClientStats()
    } catch (err) {
      triggerCustomAlert(err.status === 409 ? err.message : 'فشل إضافة العميل: ' + err.message)
    }
  }

  const handleEditClient = async (e) => {
    if (e) e.preventDefault()
    const { id, name, address } = editClientForm
    if (!name) {
      triggerCustomAlert('يرجى إدخال اسم العميل!')
      return
    }
    const phoneError = phoneFormError(editClientForm)
    if (phoneError) {
      triggerCustomAlert(phoneError)
      return
    }
    try {
      const updated = await api('clients.update', {
        id,
        name,
        phones: formPhones(editClientForm),
        address: address || ''
      })
      triggerCustomAlert('تم تحديث بيانات العميل!')
      setShowEditClientModal(false)
      await fetchClientsList()
      await fetchClientStats()
      if (selectedAdminClient && selectedAdminClient.id === id) setSelectedAdminClient(updated)
    } catch (err) {
      triggerCustomAlert(err.status === 409 ? err.message : 'فشل تحديث العميل: ' + err.message)
    }
  }

  const handleRepayment = async () => {
    const amount = parseFloat(repaymentAmount) || 0
    if (amount <= 0) return
    if (!selectedAdminClient) return
    if (selectedAdminClient.debt_balance <= 0) {
      triggerCustomAlert('العميل ليس لديه مديونية مستحقة!')
      return
    }
    const saveRepayment = async () => {
      try {
        const updated = await api('clients.repay', {
          clientId: selectedAdminClient.id,
          amount,
          currentShiftId: currentShift ? currentShift.id : null
        })
        triggerCustomAlert('تم تسجيل عملية السداد وتحديث الخزينة بنجاح!')
        setRepaymentAmount('')
        if (updated) await selectAdminClientForProfile(updated)
        await fetchClientsList()
        await fetchClientStats()
        if (fetchStats) await fetchStats() // refresh safe balance
      } catch (err) {
        triggerCustomAlert('فشلت عملية السداد: ' + err.message)
      }
    }
    if (amount > selectedAdminClient.debt_balance) {
      triggerCustomConfirm(
        'المبلغ المدفوع أكبر من المديونية المستحقة. هل تريد المتابعة لتسجيل رصيد دائن؟',
        saveRepayment
      )
    } else {
      await saveRepayment()
    }
  }

  const handleDeleteClient = async (client) => {
    if (client.debt_balance !== 0) {
      triggerCustomAlert('لا يمكن حذف عميل لديه رصيد مالي (دائن أو مدين)!')
      return
    }
    triggerCustomConfirm(
      `هل أنت متأكد من حذف العميل "${client.name}" نهائياً من النظام؟`,
      async () => {
        try {
          await api('clients.delete', { clientId: client.id })
          triggerCustomAlert('تم حذف العميل بنجاح!')
          setSelectedAdminClient(null)
          await fetchClientsList()
          await fetchClientStats()
        } catch (err) {
          triggerCustomAlert(err.status === 409 ? err.message : 'فشل حذف العميل: ' + err.message)
        }
      }
    )
  }

  return {
    clientsList,
    setClientsList,
    clientsSearch,
    setClientsSearch,
    selectedAdminClient,
    setSelectedAdminClient,
    adminClientPurchases,
    adminClientLedger,
    repaymentAmount,
    setRepaymentAmount,
    showAddClientModal,
    setShowAddClientModal,
    showEditClientModal,
    setShowEditClientModal,
    newClientForm,
    setNewClientForm,
    editClientForm,
    setEditClientForm,
    bestCustomerOfMonth,
    highestPointsCustomer,
    monthlyClientsReport,
    clientTopProducts,
    clientStats,
    clientPeriodFilter,
    changeClientPeriodFilter,
    fetchClientsList,
    fetchClientStats,
    selectAdminClientForProfile,
    handleAddClient,
    handleEditClient,
    handleRepayment,
    handleDeleteClient
  }
}
