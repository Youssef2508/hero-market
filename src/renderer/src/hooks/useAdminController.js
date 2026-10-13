import { useState } from 'react'
import { executeQuery } from '../lib/db'
import { getNowStr } from '../lib/utils'
import { useClientsManager } from './useClientsManager'
import { useSuppliersManager } from './useSuppliersManager'
import { useChecksManager } from './useChecksManager'
import { useUsersManager } from './useUsersManager'
import { useProductsManager } from './useProductsManager'
import { useSalesManager } from './useSalesManager'
import { useExpensesManager } from './useExpensesManager'
import { useBestSellersManager } from './useBestSellersManager'
import { useDamagedGoodsManager } from './useDamagedGoodsManager'

export function useAdminController({
  currentShift,
  currentUser,
  setToastMessage,
  triggerCustomAlert,
  triggerCustomConfirm
}) {
  // Shared states
  const [analytics, setAnalytics] = useState({ totalSales: 0, netProfit: 0 })
  const [statsPeriod, setStatsPeriod] = useState('weekly')
  const [periodicAnalytics, setPeriodicAnalytics] = useState({
    totalSales: 0,
    netProfit: 0,
    totalExpenses: 0,
    invoiceCount: 0,
    debtSales: 0,
    outstandingDebt: 0,
    netCashFlow: 0
  })
  const [shiftsHistory, setShiftsHistory] = useState([])
  const [dbStats, setDbStats] = useState({ totalItems: 0, lowStock: 0, lowStockItems: [] })

  // Atomic fetch helpers
  const fetchStats = async () => {
    try {
      const totalRes = await executeQuery('SELECT count(*) as count FROM products;')
      const lowRes = await executeQuery(
        'SELECT name, stock_qty, reorder_limit, unit FROM products WHERE stock_qty <= reorder_limit AND reorder_limit > 0;'
      )
      setDbStats({
        totalItems: totalRes[0]?.count || 0,
        lowStock: lowRes.length || 0,
        lowStockItems: lowRes || []
      })
    } catch (e) {
      console.error('fetchStats:', e)
    }
  }

  const fetchAnalytics = async (period = 'weekly') => {
    try {
      const periodDays = {
        daily: 1,
        weekly: 7,
        monthly: 30
      }

      let shiftIdsFilter = ''
      if (period !== 'all') {
        const days = periodDays[period] || 7
        const sinceDate = new Date()
        sinceDate.setDate(sinceDate.getDate() - days)
        sinceDate.setHours(0, 0, 0, 0)

        const sinceStr = getNowStr(sinceDate)
        const matchingShifts = await executeQuery(
          `SELECT id FROM shifts WHERE start_time >= '${sinceStr}';`
        )
        const ids = matchingShifts.map((sh) => sh.id)
        if (ids.length > 0) {
          shiftIdsFilter = ids.join(',')
        } else {
          // No shifts found in this period, set zero values
          setPeriodicAnalytics({
            totalSales: 0,
            netProfit: 0,
            totalExpenses: 0,
            invoiceCount: 0,
            debtSales: 0,
            outstandingDebt: 0,
            netCashFlow: 0
          })
          setAnalytics({ totalSales: 0, netProfit: 0 })
          return
        }
      }

      // Build SQL clauses
      const shiftConditionSales = shiftIdsFilter ? `WHERE shift_id IN (${shiftIdsFilter})` : ''
      const shiftConditionExpenses = shiftIdsFilter ? `WHERE shift_id IN (${shiftIdsFilter})` : ''
      const shiftConditionItems = shiftIdsFilter ? `WHERE s.shift_id IN (${shiftIdsFilter})` : ''

      // 1. Total Sales, count, debt
      const salesQuery = `
        SELECT 
          SUM(total_amount) as total, 
          COUNT(*) as count,
          SUM(CASE WHEN payment_type = 'آجل' THEN total_amount ELSE 0 END) as debt
        FROM sales
        ${shiftConditionSales};
      `
      const salesRes = await executeQuery(salesQuery)
      const totalSales = salesRes[0]?.total || 0
      const invoiceCount = salesRes[0]?.count || 0
      const debtSales = salesRes[0]?.debt || 0

      // 2. Net Profit from sales
      const profitQuery = `
        SELECT SUM(si.total_price - ((si.quantity - si.returned_qty) * COALESCE(NULLIF(si.cost_price, 0), p.cost_price))) as profit
        FROM sale_items si 
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_barcode = p.barcode
        ${shiftConditionItems};
      `
      const profitRes = await executeQuery(profitQuery)
      const netProfitSales = profitRes[0]?.profit || 0

      // 2.5 Deduct Damaged Goods Cost
      const damagedCondition = shiftIdsFilter ? `WHERE shift_id IN (${shiftIdsFilter})` : ''
      const damagedQuery = `
        SELECT SUM(quantity * cost_price) as total_damaged_cost
        FROM damaged_goods
        ${damagedCondition};
      `
      const damagedRes = await executeQuery(damagedQuery)
      const totalDamagedCost = damagedRes[0]?.total_damaged_cost || 0

      // 3. Expenses
      const expensesQuery = `
        SELECT SUM(amount) as total FROM expenses
        ${shiftConditionExpenses};
      `
      const expensesRes = await executeQuery(expensesQuery)
      const totalExpenses = expensesRes[0]?.total || 0

      // True Net Profit = Gross Profit from Sales - Damaged Goods Loss - Operating Expenses
      const netProfit = netProfitSales - totalDamagedCost - totalExpenses

      // 4. Safe Inflows and Outflows
      const safeCondition = shiftIdsFilter ? `WHERE shift_id IN (${shiftIdsFilter})` : ''
      const safeQuery = `
        SELECT 
          SUM(CASE WHEN type = 'inflow' THEN amount ELSE 0 END) as inflows,
          SUM(CASE WHEN type = 'outflow' THEN amount ELSE 0 END) as outflows
        FROM safe_ledger
        ${safeCondition};
      `
      const safeRes = await executeQuery(safeQuery)
      const safeInflows = safeRes[0]?.inflows || 0
      const safeOutflows = safeRes[0]?.outflows || 0

      // 5. Net Cash Flow (Total sales cash + inflows - outflows)
      const cashSales = totalSales - debtSales
      const netCashFlow = cashSales + safeInflows - safeOutflows

      // 5. Total outstanding customer debt (current snapshot)
      const outstandingRes = await executeQuery(`SELECT SUM(debt_balance) as total FROM clients;`)
      const outstandingDebt = outstandingRes[0]?.total || 0

      setPeriodicAnalytics({
        totalSales,
        netProfit,
        totalExpenses,
        invoiceCount,
        debtSales,
        outstandingDebt,
        netCashFlow
      })
      setAnalytics({ totalSales, netProfit })
    } catch (e) {
      console.error('fetchAnalytics:', e)
    }
  }

  const fetchShiftsHistory = async () => {
    try {
      const res = await executeQuery(`
        SELECT s.*, u.username FROM shifts s
        JOIN users u ON s.user_id = u.id
        WHERE s.status = 'closed' ORDER BY s.id DESC;
      `)
      setShiftsHistory(res)
    } catch (e) {
      console.error('fetchShiftsHistory:', e)
    }
  }

  const [shiftAudits, setShiftAudits] = useState([])

  const fetchShiftAudits = async () => {
    try {
      const res = await executeQuery(`
        SELECT a.*, u.username
        FROM shift_audits a
        JOIN shifts s ON a.shift_id = s.id
        JOIN users u ON s.user_id = u.id
        ORDER BY a.id DESC;
      `)
      setShiftAudits(res)
    } catch (e) {
      console.error('fetchShiftAudits:', e)
    }
  }

  // Sub-managers declared BEFORE fetchAdminData so it can call their methods.
  // Arrow-wrapper callbacks ( () => fetchAdminData() ) are safe because the
  // arrow is only *called* at runtime, never at declaration time — no TDZ.
  const productsManager = useProductsManager({
    fetchAdminData: () => fetchAdminData(),
    setToastMessage,
    triggerCustomAlert,
    triggerCustomConfirm
  })

  const salesManager = useSalesManager({
    currentShift,
    fetchAdminData: () => fetchAdminData(),
    triggerCustomAlert,
    triggerCustomConfirm
  })

  const clientsManager = useClientsManager({
    currentShift,
    fetchStats: () => fetchStats(),
    triggerCustomAlert,
    triggerCustomConfirm
  })

  const suppliersManager = useSuppliersManager({
    currentShift,
    triggerCustomAlert,
    triggerCustomConfirm
  })

  const checksManager = useChecksManager({
    triggerCustomAlert,
    triggerCustomConfirm
  })

  const usersManager = useUsersManager({
    currentUser,
    fetchStats: () => fetchStats(),
    fetchAdminData: () => fetchAdminData(),
    triggerCustomAlert,
    triggerCustomConfirm
  })

  const expensesManager = useExpensesManager({
    currentShift,
    fetchAdminData: () => fetchAdminData(),
    triggerCustomAlert,
    triggerCustomConfirm
  })

  const bestSellersManager = useBestSellersManager()

  const damagedGoodsManager = useDamagedGoodsManager({
    currentShift,
    fetchAdminData: () => fetchAdminData(),
    triggerCustomAlert,
    triggerCustomConfirm
  })

  // Declared after sub-managers — can safely call their methods
  const fetchAdminData = async () => {
    await fetchStats()
    await fetchShiftsHistory()
    await fetchShiftAudits()
    await productsManager.fetchInventoryPage(1, '')
    await fetchAnalytics()
    await salesManager.fetchSalesHistory()
    await bestSellersManager.fetchBestSellers(bestSellersManager.bsPeriod)
    await usersManager.fetchUsersList()
    await clientsManager.fetchClientsList()
    await clientsManager.fetchClientStats()
    await expensesManager.fetchExpensesList()
    await damagedGoodsManager.fetchDamagedGoods()
  }

  return {
    analytics,
    setAnalytics,
    statsPeriod,
    setStatsPeriod,
    periodicAnalytics,
    shiftsHistory,
    setShiftsHistory,
    shiftAudits,
    setShiftAudits,
    dbStats,
    setDbStats,
    fetchStats,
    fetchAnalytics,
    fetchShiftsHistory,
    fetchShiftAudits,
    fetchAdminData,

    // productsManager
    adminProducts: productsManager.adminProducts,
    setAdminProducts: productsManager.setAdminProducts,
    adminTotalCount: productsManager.adminTotalCount,
    setAdminTotalCount: productsManager.setAdminTotalCount,
    adminPage: productsManager.adminPage,
    setAdminPage: productsManager.setAdminPage,
    adminSearch: productsManager.adminSearch,
    setAdminSearch: productsManager.setAdminSearch,
    showAddModal: productsManager.showAddModal,
    setShowAddModal: productsManager.setShowAddModal,
    showEditModal: productsManager.showEditModal,
    setShowEditModal: productsManager.setShowEditModal,
    newProduct: productsManager.newProduct,
    setNewProduct: productsManager.setNewProduct,
    editProduct: productsManager.editProduct,
    setEditProduct: productsManager.setEditProduct,
    itemsPerPage: productsManager.itemsPerPage,
    productsSortField: productsManager.productsSortField,
    productsSortAsc: productsManager.productsSortAsc,
    fetchInventoryPage: productsManager.fetchInventoryPage,
    handleAddProduct: productsManager.handleAddProduct,
    handleEditProduct: productsManager.handleEditProduct,
    handleDeleteProduct: productsManager.handleDeleteProduct,

    // salesManager
    salesHistory: salesManager.salesHistory,
    setSalesHistory: salesManager.setSalesHistory,
    salesSearch: salesManager.salesSearch,
    setSalesSearch: salesManager.setSalesSearch,
    selectedSale: salesManager.selectedSale,
    setSelectedSale: salesManager.setSelectedSale,
    selectedSaleItems: salesManager.selectedSaleItems,
    setSelectedSaleItems: salesManager.setSelectedSaleItems,
    fetchSalesHistory: salesManager.fetchSalesHistory,
    salesSortField: salesManager.salesSortField,
    salesSortAsc: salesManager.salesSortAsc,
    selectSaleForDetail: salesManager.selectSaleForDetail,
    handleReturnItem: salesManager.handleReturnItem,
    handleReturnEntireSale: salesManager.handleReturnEntireSale,
    salesPage: salesManager.salesPage,
    salesTotalCount: salesManager.salesTotalCount,
    // itemsPerPage (12) is shared with productsManager above; both managers use the same page size.

    // clientsManager
    clientsList: clientsManager.clientsList,
    setClientsList: clientsManager.setClientsList,
    clientsSearch: clientsManager.clientsSearch,
    setClientsSearch: clientsManager.setClientsSearch,
    selectedAdminClient: clientsManager.selectedAdminClient,
    setSelectedAdminClient: clientsManager.setSelectedAdminClient,
    adminClientPurchases: clientsManager.adminClientPurchases,
    adminClientLedger: clientsManager.adminClientLedger,
    repaymentAmount: clientsManager.repaymentAmount,
    setRepaymentAmount: clientsManager.setRepaymentAmount,
    showAddClientModal: clientsManager.showAddClientModal,
    setShowAddClientModal: clientsManager.setShowAddClientModal,
    showEditClientModal: clientsManager.showEditClientModal,
    setShowEditClientModal: clientsManager.setShowEditClientModal,
    newClientForm: clientsManager.newClientForm,
    setNewClientForm: clientsManager.setNewClientForm,
    editClientForm: clientsManager.editClientForm,
    setEditClientForm: clientsManager.setEditClientForm,
    bestCustomerOfMonth: clientsManager.bestCustomerOfMonth,
    highestPointsCustomer: clientsManager.highestPointsCustomer,
    monthlyClientsReport: clientsManager.monthlyClientsReport,
    clientTopProducts: clientsManager.clientTopProducts,
    clientStats: clientsManager.clientStats,
    clientPeriodFilter: clientsManager.clientPeriodFilter,
    changeClientPeriodFilter: clientsManager.changeClientPeriodFilter,
    fetchClientsList: clientsManager.fetchClientsList,
    fetchClientStats: clientsManager.fetchClientStats,
    selectAdminClientForProfile: clientsManager.selectAdminClientForProfile,
    handleAddClient: clientsManager.handleAddClient,
    handleEditClient: clientsManager.handleEditClient,
    handleRepayment: clientsManager.handleRepayment,
    handleDeleteClient: clientsManager.handleDeleteClient,

    // suppliersManager
    suppliersList: suppliersManager.suppliersList,
    setSuppliersList: suppliersManager.setSuppliersList,
    suppliersSearch: suppliersManager.suppliersSearch,
    setSuppliersSearch: suppliersManager.setSuppliersSearch,
    selectedSupplier: suppliersManager.selectedSupplier,
    setSelectedSupplier: suppliersManager.setSelectedSupplier,
    supplierLedger: suppliersManager.supplierLedger,
    supplierPurchases: suppliersManager.supplierPurchases,
    showAddSupplierModal: suppliersManager.showAddSupplierModal,
    setShowAddSupplierModal: suppliersManager.setShowAddSupplierModal,
    showAddPurchaseModal: suppliersManager.showAddPurchaseModal,
    setShowAddPurchaseModal: suppliersManager.setShowAddPurchaseModal,
    newSupplierForm: suppliersManager.newSupplierForm,
    setNewSupplierForm: suppliersManager.setNewSupplierForm,
    newPurchaseForm: suppliersManager.newPurchaseForm,
    setNewPurchaseForm: suppliersManager.setNewPurchaseForm,
    supplierRepayAmount: suppliersManager.supplierRepayAmount,
    setSupplierRepayAmount: suppliersManager.setSupplierRepayAmount,
    fetchSuppliersList: suppliersManager.fetchSuppliersList,
    fetchSupplierProfile: suppliersManager.fetchSupplierProfile,
    handleAddSupplier: suppliersManager.handleAddSupplier,
    handleAddPurchase: suppliersManager.handleAddPurchase,
    handleSupplierRepay: suppliersManager.handleSupplierRepay,
    handleDeleteSupplier: suppliersManager.handleDeleteSupplier,

    // checksManager
    checksList: checksManager.checksList,
    setChecksList: checksManager.setChecksList,
    showAddCheckModal: checksManager.showAddCheckModal,
    setShowAddCheckModal: checksManager.setShowAddCheckModal,
    newCheckForm: checksManager.newCheckForm,
    setNewCheckForm: checksManager.setNewCheckForm,
    checksDueToday: checksManager.checksDueToday,
    setChecksDueToday: checksManager.setChecksDueToday,
    fetchChecksList: checksManager.fetchChecksList,
    fetchChecksDueToday: checksManager.fetchChecksDueToday,
    handleAddCheck: checksManager.handleAddCheck,
    handleMarkCheckPaid: checksManager.handleMarkCheckPaid,
    handleDeleteCheck: checksManager.handleDeleteCheck,

    // usersManager
    usersList: usersManager.usersList,
    setUsersList: usersManager.setUsersList,
    showAddUserModal: usersManager.showAddUserModal,
    setShowAddUserModal: usersManager.setShowAddUserModal,
    showEditUserModal: usersManager.showEditUserModal,
    setShowEditUserModal: usersManager.setShowEditUserModal,
    newUser: usersManager.newUser,
    setNewUser: usersManager.setNewUser,
    editUser: usersManager.editUser,
    setEditUser: usersManager.setEditUser,
    fetchUsersList: usersManager.fetchUsersList,
    handleDeleteUser: usersManager.handleDeleteUser,
    handleSystemReset: usersManager.handleSystemReset,
    handleAddUser: usersManager.handleAddUser,
    handleEditUser: usersManager.handleEditUser,

    // expensesManager
    expensesList: expensesManager.expensesList,
    setExpensesList: expensesManager.setExpensesList,
    showAddExpenseModal: expensesManager.showAddExpenseModal,
    setShowAddExpenseModal: expensesManager.setShowAddExpenseModal,
    newExpenseForm: expensesManager.newExpenseForm,
    setNewExpenseForm: expensesManager.setNewExpenseForm,
    fetchExpensesList: expensesManager.fetchExpensesList,
    handleAddExpense: expensesManager.handleAddExpense,
    handleDeleteExpense: expensesManager.handleDeleteExpense,

    // bestSellersManager
    bsPeriod: bestSellersManager.bsPeriod,
    setBsPeriod: bestSellersManager.setBsPeriod,
    bsTopSellers: bestSellersManager.bsTopSellers,
    bsSlowMovers: bestSellersManager.bsSlowMovers,
    bsLoading: bestSellersManager.bsLoading,
    fetchBestSellers: bestSellersManager.fetchBestSellers,

    // damagedGoodsManager
    damagedGoodsList: damagedGoodsManager.damagedGoodsList,
    showAddDamagedModal: damagedGoodsManager.showAddDamagedModal,
    setShowAddDamagedModal: damagedGoodsManager.setShowAddDamagedModal,
    newDamagedForm: damagedGoodsManager.newDamagedForm,
    setNewDamagedForm: damagedGoodsManager.setNewDamagedForm,
    fetchDamagedGoods: damagedGoodsManager.fetchDamagedGoods,
    handleAddDamaged: damagedGoodsManager.handleAddDamaged,
    handleDeleteDamaged: damagedGoodsManager.handleDeleteDamaged
  }
}
