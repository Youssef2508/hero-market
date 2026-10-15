import { useState } from 'react'
import { executeQuery } from '../lib/db'
import { escapeSql, parseLocaleDateString, getNowStr, getFriendlyErrorMessage } from '../lib/utils'

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
  const [newClientForm, setNewClientForm] = useState({ name: '', phone: '', address: '' })
  const [editClientForm, setEditClientForm] = useState({ id: '', name: '', phone: '', address: '' })
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
      const escaped = escapeSql(search)
      const query = escaped
        ? `SELECT * FROM clients WHERE name LIKE '%${escaped}%' OR phone LIKE '%${escaped}%' ORDER BY name ASC;`
        : `SELECT * FROM clients ORDER BY name ASC;`
      const res = await executeQuery(query)
      setClientsList(res || [])
    } catch (e) {
      console.error('Failed to fetch clients list:', e)
    }
  }

  const fetchClientStats = async () => {
    try {
      const pointsRes = await executeQuery(
        `SELECT * FROM clients WHERE points > 0 ORDER BY points DESC LIMIT 1;`
      )
      setHighestPointsCustomer(pointsRes?.[0] || null)

      const sales = await executeQuery(
        `SELECT s.total_amount, s.client_id, s.timestamp FROM sales s WHERE s.client_id IS NOT NULL;`
      )
      if (sales.length > 0) {
        const clientTotals = {}
        const currentMonth = new Date().getMonth() + 1
        const currentYear = new Date().getFullYear()

        sales.forEach((sale) => {
          const date = parseLocaleDateString(sale.timestamp)
          if (!date || date.getTime() === 0) return
          if (date.getMonth() + 1 === currentMonth && date.getFullYear() === currentYear) {
            const cid = sale.client_id
            clientTotals[cid] = (clientTotals[cid] || 0) + sale.total_amount
          }
        })

        // Ranks top-purchasing clients to build report
        const sortedClients = Object.keys(clientTotals)
          .map((cid) => ({
            client_id: parseInt(cid),
            totalSpent: clientTotals[cid]
          }))
          .sort((a, b) => b.totalSpent - a.totalSpent)

        let reportData = []
        const clientIds = sortedClients
          .map((c) => c.client_id)
          .filter((id) => Boolean(id) && !isNaN(id))
        if (clientIds.length > 0) {
          const detailsList = await executeQuery(
            `SELECT id, name, phone FROM clients WHERE id IN (${clientIds.join(',')});`
          )
          const validDetails = Array.isArray(detailsList)
            ? detailsList.filter((c) => c && c.id)
            : []
          const clientMap = Object.fromEntries(validDetails.map((c) => [c.id, c]))
          reportData = sortedClients.map((item) => {
            const detail = clientMap[item.client_id]
            return {
              id: item.client_id,
              name: detail?.name || 'عميل محذوف',
              phone: detail?.phone || '',
              totalSpent: item.totalSpent
            }
          })
        }
        setMonthlyClientsReport(reportData)

        // Best customer of the month
        if (reportData.length > 0) {
          setBestCustomerOfMonth({
            ...reportData[0],
            monthlySpent: reportData[0].totalSpent
          })
        } else {
          setBestCustomerOfMonth(null)
        }
      } else {
        setMonthlyClientsReport([])
        setBestCustomerOfMonth(null)
      }
    } catch (e) {
      console.error('Failed to calculate client stats:', e)
    }
  }

  const selectAdminClientForProfile = async (client) => {
    try {
      setSelectedAdminClient(client)
      // Report rows carry only id/name/phone; load the full row so edit/delete see every field.
      if (client && client.id && client.debt_balance === undefined) {
        const full = await executeQuery(
          `SELECT * FROM clients WHERE id = ${parseInt(client.id, 10)} LIMIT 1;`
        )
        if (Array.isArray(full) && full.length > 0) setSelectedAdminClient(full[0])
      }

      let purchases = []
      try {
        purchases = await executeQuery(`
          SELECT s.*, u.username, 
                 (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) as items_count 
          FROM sales s
          JOIN shifts sh ON s.shift_id = sh.id
          JOIN users u ON sh.user_id = u.id
          WHERE s.client_id = ${client.id}
          ORDER BY s.id DESC;
        `)
      } catch (err) {
        console.error('Failed to load client purchases:', err)
      }

      let ledger = []
      try {
        ledger = await executeQuery(`
          SELECT * FROM client_ledger 
          WHERE client_id = ${client.id} 
          ORDER BY id DESC;
        `)
      } catch (err) {
        console.error('Failed to load client ledger:', err)
      }

      let saleItems = []
      try {
        saleItems = await executeQuery(`
          SELECT si.quantity, si.total_price, si.product_barcode, p.name, s.timestamp, s.id as sale_id
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_barcode = p.barcode
          WHERE s.client_id = ${client.id};
        `)
      } catch (err) {
        console.error('Failed to load client sale items:', err)
      }

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
    const { name, phone, address } = newClientForm
    if (!name) {
      triggerCustomAlert('يرجى إدخال اسم العميل!')
      return
    }
    try {
      const nowStr = getNowStr()
      const cleanPhone = phone ? String(phone).replace(/\D/g, '').trim() : ''
      if (cleanPhone) {
        const dup = await executeQuery(
          `SELECT * FROM clients WHERE phone = '${escapeSql(cleanPhone)}' LIMIT 1;`
        )
        if (dup.length > 0) {
          triggerCustomAlert('رقم الهاتف هذا مسجل لعميل آخر بالفعل!')
          return
        }
      }
      await executeQuery(`
        INSERT INTO clients (name, phone, address, debt_balance, points, created_at)
        VALUES ('${escapeSql(name)}', '${escapeSql(phone)}', '${escapeSql(address)}', 0.0, 0, '${nowStr}');
      `)
      triggerCustomAlert('تمت إضافة العميل بنجاح!')
      setNewClientForm({ name: '', phone: '', address: '' })
      setShowAddClientModal(false)
      await fetchClientsList()
      await fetchClientStats()
    } catch (err) {
      triggerCustomAlert('فشل إضافة العميل: ' + getFriendlyErrorMessage(err))
    }
  }

  const handleEditClient = async (e) => {
    if (e) e.preventDefault()
    const { id, name, phone, address } = editClientForm
    if (!name) {
      triggerCustomAlert('يرجى إدخال اسم العميل!')
      return
    }
    try {
      const cleanPhone = phone ? String(phone).replace(/\D/g, '').trim() : ''
      if (cleanPhone) {
        const dup = await executeQuery(
          `SELECT * FROM clients WHERE phone = '${escapeSql(cleanPhone)}' AND id != ${id} LIMIT 1;`
        )
        if (dup.length > 0) {
          triggerCustomAlert('رقم الهاتف هذا مسجل لعميل آخر بالفعل!')
          return
        }
      }
      await executeQuery(`
        UPDATE clients 
        SET name = '${escapeSql(name)}', 
            phone = '${escapeSql(phone)}', 
            address = '${escapeSql(address)}'
        WHERE id = ${id};
      `)
      triggerCustomAlert('تم تحديث بيانات العميل!')
      setShowEditClientModal(false)
      await fetchClientsList()
      await fetchClientStats()
      if (selectedAdminClient && selectedAdminClient.id === id) {
        const updated = await executeQuery(`SELECT * FROM clients WHERE id = ${id} LIMIT 1;`)
        if (updated.length > 0) {
          setSelectedAdminClient(updated[0])
        }
      }
    } catch (err) {
      triggerCustomAlert('فشل تحديث العميل: ' + getFriendlyErrorMessage(err))
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
        const nowStr = getNowStr()
        const shiftId = currentShift ? currentShift.id : 'NULL'

        let sql = 'BEGIN TRANSACTION;\n'
        sql += `UPDATE clients SET debt_balance = debt_balance - ${amount} WHERE id = ${selectedAdminClient.id};\n`
        sql += `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES (${selectedAdminClient.id}, 'payment', ${amount}, 'سداد نقدي من العميل', '${nowStr}');\n`
        sql += `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (${shiftId}, 'inflow', ${amount}, 'سداد دين العميل: ${escapeSql(selectedAdminClient.name)}', '${nowStr}');\n`
        sql += 'COMMIT;\n'

        await executeQuery(sql)
        triggerCustomAlert('تم تسجيل عملية السداد وتحديث الخزينة بنجاح!')
        setRepaymentAmount('')

        const updated = await executeQuery(
          `SELECT * FROM clients WHERE id = ${selectedAdminClient.id} LIMIT 1;`
        )
        if (updated.length > 0) {
          await selectAdminClientForProfile(updated[0])
        }
        await fetchClientsList()
        await fetchClientStats()
        if (fetchStats) await fetchStats() // refresh safe balance
      } catch (err) {
        triggerCustomAlert('فشلت عملية السداد: ' + getFriendlyErrorMessage(err))
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
          await executeQuery(`DELETE FROM clients WHERE id = ${client.id};`)
          triggerCustomAlert('تم حذف العميل بنجاح!')
          setSelectedAdminClient(null)
          await fetchClientsList()
          await fetchClientStats()
        } catch (err) {
          if (err.message && err.message.includes('FOREIGN KEY')) {
            triggerCustomAlert(
              'لا يمكن حذف هذا العميل لأنه لديه معاملات أو فواتير سابقة مسجلة بالنظام.'
            )
          } else {
            triggerCustomAlert('فشل حذف العميل: ' + getFriendlyErrorMessage(err))
          }
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
