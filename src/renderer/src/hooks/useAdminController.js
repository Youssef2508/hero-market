import { useState } from 'react'
import { api, can } from '../lib/api'
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

  // Atomic fetch helpers (each one is a named service operation; see src/server/modules/reports.js)
  const fetchStats = async () => {
    try {
      setDbStats(await api('dashboard.stats'))
    } catch (e) {
      console.error('fetchStats:', e)
    }
  }

  const fetchAnalytics = async (period = 'weekly') => {
    try {
      // Same period rule and formulas as before, computed by the service.
      const res = await api('reports.periodic', { period })
      setPeriodicAnalytics(res)
      setAnalytics({ totalSales: res.totalSales, netProfit: res.netProfit })
    } catch (e) {
      console.error('fetchAnalytics:', e)
    }
  }

  const fetchShiftsHistory = async () => {
    try {
      setShiftsHistory(await api('reports.shiftsHistory'))
    } catch (e) {
      console.error('fetchShiftsHistory:', e)
    }
  }

  const [shiftAudits, setShiftAudits] = useState([])

  const fetchShiftAudits = async () => {
    try {
      setShiftAudits(await api('reports.shiftAudits'))
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

  const checksManager = useChecksManager()

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

  // Declared after sub-managers — can safely call their methods.
  // Only the sections this user may open are loaded (the service would refuse the others).
  const fetchAdminData = async () => {
    const u = currentUser
    if (can(u, 'pos.sell') || can(u, 'products.view') || can(u, 'reports.view')) await fetchStats()
    if (can(u, 'shifts.view_all')) {
      await fetchShiftsHistory()
      await fetchShiftAudits()
    }
    if (can(u, 'products.view')) await productsManager.fetchInventoryPage(1, '')
    if (can(u, 'reports.view')) {
      await fetchAnalytics()
      await bestSellersManager.fetchBestSellers(bestSellersManager.bsPeriod)
    }
    if (can(u, 'sales.view')) await salesManager.fetchSalesHistory()
    if (can(u, 'users.manage')) await usersManager.fetchUsersList()
    if (can(u, 'customers.view') || can(u, 'customers.manage')) {
      await clientsManager.fetchClientsList()
      await clientsManager.fetchClientStats()
    }
    if (can(u, 'expenses.manage')) await expensesManager.fetchExpensesList()
    if (can(u, 'inventory.damaged')) await damagedGoodsManager.fetchDamagedGoods()
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
    fetchChecksList: checksManager.fetchChecksList,

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
    rolesList: usersManager.rolesList,
    handleDeleteUser: usersManager.handleDeleteUser,
    handleSystemReset: usersManager.handleSystemReset,
    handleAddUser: usersManager.handleAddUser,
    handleEditUser: usersManager.handleEditUser,
    handleResetPassword: usersManager.handleResetPassword,

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
    expenseCategories: expensesManager.expenseCategories,
    saveExpenseCategory: expensesManager.saveExpenseCategory,

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
