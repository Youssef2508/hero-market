import { useState } from 'react'
import { api, newClientRef } from '../lib/api'
import { formPhones, phoneFormError } from '../lib/phoneForm'
import { formAddresses, addressFormError } from '../lib/addressForm'
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
  const EMPTY_CLIENT = { name: '', phone: '', phone2: '', hasPhone2: false, addresses: [] }
  // A save in progress: a second click (or Enter) does not create the customer twice.
  const [savingClient, setSavingClient] = useState(false)
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
    if (savingClient) return
    const { name } = newClientForm
    if (!name || !name.trim()) {
      triggerCustomAlert('يرجى إدخال اسم العميل!')
      return
    }
    const formError = phoneFormError(newClientForm) || addressFormError(newClientForm)
    if (formError) {
      triggerCustomAlert(formError)
      return
    }
    setSavingClient(true)
    try {
      await api('clients.create', {
        name: name.trim(),
        phones: formPhones(newClientForm),
        addresses: formAddresses(newClientForm)
      })
      triggerCustomAlert('تمت إضافة العميل بنجاح!')
      setNewClientForm(EMPTY_CLIENT)
      setShowAddClientModal(false)
      await fetchClientsList()
      await fetchClientStats()
    } catch (err) {
      triggerCustomAlert(err.status === 409 ? err.message : 'فشل إضافة العميل: ' + err.message)
    } finally {
      setSavingClient(false)
    }
  }

  const handleEditClient = async (e) => {
    if (e) e.preventDefault()
    if (savingClient) return
    const { id, name } = editClientForm
    if (!name || !name.trim()) {
      triggerCustomAlert('يرجى إدخال اسم العميل!')
      return
    }
    const formError = phoneFormError(editClientForm) || addressFormError(editClientForm)
    if (formError) {
      triggerCustomAlert(formError)
      return
    }
    setSavingClient(true)
    try {
      const updated = await api('clients.update', {
        id,
        name: name.trim(),
        phones: formPhones(editClientForm),
        addresses: formAddresses(editClientForm)
      })
      triggerCustomAlert('تم تحديث بيانات العميل!')
      setShowEditClientModal(false)
      await fetchClientsList()
      await fetchClientStats()
      if (selectedAdminClient && selectedAdminClient.id === id) setSelectedAdminClient(updated)
    } catch (err) {
      triggerCustomAlert(err.status === 409 ? err.message : 'فشل تحديث العميل: ' + err.message)
    } finally {
      setSavingClient(false)
    }
  }

  // destination: 'shift' or 'treasury' (owner feedback CUST-02), chosen on the form.
  const handleRepayment = async (destination, method = 'cash') => {
    const amount = parseFloat(repaymentAmount) || 0
    if (amount <= 0) return
    if (!selectedAdminClient) return
    if (selectedAdminClient.debt_balance <= 0) {
      triggerCustomAlert('العميل ليس لديه مديونية مستحقة!')
      return
    }
    // One request id for this payment: a retry never records it twice.
    const clientRef = newClientRef()
    const saveRepayment = async () => {
      try {
        const updated = await api('clients.repay', {
          clientId: selectedAdminClient.id,
          amount,
          destination,
          method,
          currentShiftId: destination === 'shift' && currentShift ? currentShift.id : null,
          clientRef
        })
        triggerCustomAlert(
          destination === 'treasury'
            ? 'تم تسجيل السداد في الخزنة.'
            : 'تم تسجيل السداد في درج الوردية.'
        )
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
