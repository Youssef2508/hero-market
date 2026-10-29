import { useState, useEffect, useRef } from 'react'
import { CircleCheck, TriangleAlert, ClipboardCheck, NotebookPen } from 'lucide-react'
import packageInfo from '../../../package.json'

import { playSound } from './lib/utils'
import { api, can } from './lib/api'
import { loadMeasureKinds } from './lib/measureKinds'
import { canAccessAdmin } from './components/shell/navigation'
import StartupGate from './components/setup/StartupGate'

// Import Custom Hooks
import { useBarcode } from './hooks/useBarcode'
import { useCart } from './hooks/useCart'
import { useShift } from './hooks/useShift'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useAdminController } from './hooks/useAdminController'
import { usePOSController } from './hooks/usePOSController'

// Import POS Components
import CheckoutTerminal from './components/pos/CheckoutTerminal'
import LockScreen from './components/pos/LockScreen'
import AppShell from './components/shell/AppShell'

// Import Admin Dashboard Components
import AdminDashboard from './components/admin/AdminDashboard'
import TillsManagerTab from './components/admin/TillsManagerTab'

// Import Modals Components
import AppModals from './components/modals/AppModals'
import CloseReportModal from './components/modals/CloseReportModal'
import CustomAlertModal from './components/modals/CustomAlertModal'
import ChangePasswordModal from './components/modals/ChangePasswordModal'
import RecoveryPendingModal from './components/modals/RecoveryPendingModal'
import { ALL_NAV_ITEMS } from './components/shell/navigation'
import { startupPhaseFor } from './lib/startupPhase'
import { NumberField } from './components/ui'

function App() {
  // Refs
  const barcodeInputRef = useRef(null)
  const searchInputRef = useRef(null)
  const qtyInputRefs = useRef([])
  const adminSearchInputRef = useRef(null)
  const addProductBarcodeRef = useRef(null)

  // useShift hook
  const {
    currentUser,
    setCurrentUser,
    currentShift,
    setCurrentShift,
    isLocked,
    setIsLocked,
    openShiftModal,
    setOpenShiftModal,
    startingCash,
    setStartingCash,
    momknStartBalance,
    setMomknStartBalance,
    momknStartCash,
    setMomknStartCash,
    vfcashStartBalance,
    setVfcashStartBalance,
    vfcashStartCash,
    setVfcashStartCash,
    closeShiftModal,
    setCloseShiftModal,
    actualEndCash,
    setActualEndCash,
    approvalRequest,
    setApprovalRequest,
    returnRequestOpen,
    setReturnRequestOpen,
    handleLock: rawHandleLock
  } = useShift()
  // A supervisor dialog is open: barcode capture and the hourly audit wait.
  const supervisorModal = !!approvalRequest || returnRequestOpen

  // Startup: connection to the service, then first-run administrator setup (no default password).
  const [startupPhase, setStartupPhase] = useState('checking') // checking | connect | setup | ready
  const [backendInfo, setBackendInfo] = useState(null)
  // Store-wide settings from the service (store profile, opening cash, audit timing, receipts).
  const [appSettings, setAppSettings] = useState(null)
  const loadAppSettings = async () => {
    try {
      const res = await api('settings.public')
      setAppSettings(res.settings)
    } catch (e) {
      console.error('settings.public failed:', e)
    }
  }

  const [showChangePassword, setShowChangePassword] = useState(false)
  // A restored backup waits for recovery from the cloud (stage 4 phase 4).
  const [recoveryPending, setRecoveryPending] = useState(false)
  const [noPrint, setNoPrint] = useState(false)

  // Custom non-blocking alert state
  const [customAlert, setCustomAlert] = useState(null)
  const triggerCustomAlert = (message, title = 'تنبيه', onClose = null) => {
    setCustomAlert({ message, title, onClose })
  }

  // Global override for native window.alert to prevent blocking Electron popups
  useEffect(() => {
    window.alert = (msg) => {
      console.warn('[Alert Suppressed]:', msg)
      if (triggerCustomAlert) {
        triggerCustomAlert(String(msg || ''))
      }
    }
  }, [])
  const closeCustomAlert = () => {
    if (customAlert && customAlert.onClose) {
      customAlert.onClose()
    }
    setCustomAlert(null)
    setTimeout(() => {
      barcodeInputRef.current?.focus()
    }, 100)
  }

  const [customConfirm, setCustomConfirm] = useState(null)
  const triggerCustomConfirm = (message, onConfirm, onCancel = null, title = 'تأكيد العملية') => {
    setCustomConfirm({ message, title, onConfirm, onCancel })
  }
  const closeCustomConfirm = (confirmed) => {
    if (customConfirm) {
      if (confirmed && customConfirm.onConfirm) {
        customConfirm.onConfirm()
      } else if (!confirmed && customConfirm.onCancel) {
        customConfirm.onCancel()
      }
    }
    setCustomConfirm(null)
    setTimeout(() => {
      barcodeInputRef.current?.focus()
    }, 100)
  }

  // useCart hook
  const {
    cart,
    setCart,
    upfrontMethod,
    setUpfrontMethod,
    discount,
    setDiscount,
    paidAmount,
    setPaidAmount,
    paymentType,
    setPaymentType,
    clientName,
    setClientName,
    clientPhone,
    setClientPhone,
    isDelivery,
    setIsDelivery,
    depositChange,
    setDepositChange,
    appliedCredit,
    setAppliedCredit,
    cartTotal,
    changeDue,
    addToCart,
    handleQtyChangeAttempt,
    changeLineUnit,
    pendingWeight,
    confirmWeight,
    editWeight,
    triggerDeleteItem,
    triggerClearCart,
    updateQty,
    subTotal: cartSubtotal
  } = useCart({
    playSound,
    triggerCustomAlert
  })

  const [currentView, setCurrentView] = useState('pos')
  const [adminTab, setAdminTab] = useState('menu')
  const [toastMessage, setToastMessage] = useState(null)

  // useAdminController hook to manage all admin features & DB reports
  const adminController = useAdminController({
    currentShift,
    currentUser,
    setToastMessage,
    triggerCustomAlert,
    triggerCustomConfirm
  })

  // usePOSController hook — all checkout terminal handlers & states
  const {
    completeSignIn,
    handleStartShift,
    handleConfirmCloseShift,
    closeReport,
    dismissCloseReport,
    handleLock,
    barcodeInput,
    setBarcodeInput,
    handleBarcodeSubmit,
    addProductByBarcode,
    appliedDiscounts,
    manualDiscount,
    setManualDiscount,
    afterRules,
    searchInput,
    setSearchInput,
    handleSearchChange,
    handleSearchKeyDown,
    searchedTerm,
    searchResults,
    setSearchResults,
    selectedSearchIndex,
    setSelectedSearchIndex,
    clientAddress,
    setClientAddress,
    clientAddressId,
    setClientAddressId,
    selectedClient,
    clientSearchResults,
    handleClientNameChange,
    handleClientPhoneChange,
    selectClient,
    handleCheckout,
    handleReprintSale
  } = usePOSController({
    currentUser,
    setCurrentUser,
    currentShift,
    setCurrentShift,
    isLocked,
    setIsLocked,
    openShiftModal,
    setOpenShiftModal,
    startingCash,
    setStartingCash,
    momknStartBalance,
    setMomknStartBalance,
    momknStartCash,
    setMomknStartCash,
    vfcashStartBalance,
    setVfcashStartBalance,
    vfcashStartCash,
    setVfcashStartCash,
    closeShiftModal,
    setCloseShiftModal,
    actualEndCash,
    setActualEndCash,
    rawHandleLock,
    cart,
    setCart,
    discount,
    setDiscount,
    paidAmount,
    setPaidAmount,
    upfrontMethod,
    setUpfrontMethod,
    paymentType,
    setPaymentType,
    clientName,
    setClientName,
    clientPhone,
    setClientPhone,
    isDelivery,
    setIsDelivery,
    depositChange,
    setDepositChange,
    appliedCredit,
    setAppliedCredit,
    cartTotal,
    cartSubtotal,
    addToCart,
    triggerClearCart,
    updateQty,
    barcodeInputRef,
    searchInputRef,
    qtyInputRefs,
    printSilent: true,
    noPrint,
    setToastMessage,
    setCurrentView,
    fetchStats: () => adminController.fetchStats(),
    fetchClientsList: () => adminController.fetchClientsList(),
    fetchClientStats: () => adminController.fetchClientStats(),
    fetchAdminData: () => adminController.fetchAdminData(),
    triggerCustomAlert,
    appSettings,
    onLoggedIn: (user) => onLoggedIn(user)
  })

  // useBarcode after usePOSController so setBarcodeInput is available
  useBarcode({
    isLocked,
    currentView,
    openShiftModal,
    closeShiftModal,
    supervisorModal,
    showAddModal: adminController.showAddModal,
    adminTab,
    customAlert,
    customConfirm,
    barcodeInputRef,
    adminSearchInputRef,
    addProductBarcodeRef,
    setBarcodeInput,
    setAdminSearch: adminController.setAdminSearch,
    setNewProduct: adminController.setNewProduct
  })

  // --- Periodic Cash Audit System ---
  const [showAuditModal, setShowAuditModal] = useState(false)
  const [auditExpectedCash, setAuditExpectedCash] = useState(0)
  const [auditActualCash, setAuditActualCash] = useState('')
  const [auditNotes, setAuditNotes] = useState('')
  const [showReasonModal, setShowReasonModal] = useState(false)
  const [auditDeficitReason, setAuditDeficitReason] = useState('')
  const [reasonAuditId, setReasonAuditId] = useState(null)
  const [auditBreakdown, setAuditBreakdown] = useState(null)
  const lastActivityTime = useRef(0)
  const lastAuditTime = useRef(0)

  // Start both clocks at mount (same semantics as the original render-time Date.now()).
  // Declared before the effects below, which read them.
  useEffect(() => {
    const now = Date.now()
    lastActivityTime.current = now
    lastAuditTime.current = now
  }, [])

  // Track keyboard/mouse activity to prevent interrupting active checkout
  useEffect(() => {
    const updateActivity = () => {
      lastActivityTime.current = Date.now()
    }
    window.addEventListener('mousemove', updateActivity)
    window.addEventListener('keypress', updateActivity)
    window.addEventListener('click', updateActivity)
    return () => {
      window.removeEventListener('mousemove', updateActivity)
      window.removeEventListener('keypress', updateActivity)
      window.removeEventListener('click', updateActivity)
    }
  }, [])

  const triggerAuditCheck = async () => {
    if (!currentShift) return
    try {
      // Same formula as before, computed by the service (shifts.auditPreview). A blind count
      // (no shifts.view_expected, PAY-01) shows only the input: the service refuses the figures.
      if (can(currentUser, 'shifts.view_expected')) {
        const { expected, breakdown } = await api('shifts.auditPreview', {
          shiftId: currentShift.id
        })
        setAuditExpectedCash(expected)
        setAuditBreakdown(breakdown)
      } else {
        setAuditExpectedCash(null)
        setAuditBreakdown(null)
      }
      setAuditActualCash('')
      setAuditNotes('')
      setShowAuditModal(true)
    } catch (e) {
      console.error('Failed to get expected cash:', e)
      triggerCustomAlert('خطأ برمجي أثناء الجرد: ' + (e.message || e))
    }
  }

  // Periodic check timer (every 10 seconds)
  useEffect(() => {
    if (isLocked || !currentShift) return

    const interval = setInterval(async () => {
      const now = Date.now()
      const timeSinceLastAudit = now - lastAuditTime.current

      if (appSettings && appSettings.audit_enabled === 'false') return
      const intervalMs = (Number(appSettings?.audit_interval_minutes) || 60) * 60000
      const idleMs = (Number(appSettings?.audit_idle_seconds) || 20) * 1000
      // Default: 1 hour since the last audit (store setting audit_interval_minutes)
      if (timeSinceLastAudit >= intervalMs) {
        const idleTime = now - lastActivityTime.current
        const isCartEmpty = cart.length === 0
        const isModalOpen =
          openShiftModal ||
          closeShiftModal ||
          supervisorModal ||
          showAuditModal ||
          customAlert ||
          customConfirm

        // Idle for 20 seconds, empty cart, no modals open
        if (idleTime >= idleMs && isCartEmpty && !isModalOpen) {
          triggerAuditCheck()
        }
      }
    }, 10000)

    return () => clearInterval(interval)
  }, [
    isLocked,
    currentShift,
    cart,
    openShiftModal,
    closeShiftModal,
    supervisorModal,
    showAuditModal,
    customAlert,
    customConfirm,
    appSettings
  ])

  const submitAudit = async () => {
    const actual = parseFloat(auditActualCash)
    if (isNaN(actual) || actual < 0) {
      triggerCustomAlert('الرجاء إدخال مبلغ فعلي صحيح.')
      return
    }

    try {
      // K-23: the service returns the new audit id (the legacy last_insert_rowid() ran in a new process and was always 0).
      const saved = await api('shifts.audit', {
        shiftId: currentShift.id,
        actualCash: actual,
        notes: auditNotes
      })
      const diff = saved.difference
      const auditId = saved.id

      setShowAuditModal(false)
      lastAuditTime.current = Date.now() // reset hourly timer
      adminController.fetchAdminData()

      if (diff < 0) {
        triggerCustomConfirm(
          `تم حفظ جرد الدرج الدوري بنجاح. تنبيه: يوجد عجز بقيمة ${diff?.toFixed(2)} ج.م. هل تريد كتابة سبب أو تفاصيل لهذا العجز؟ (اختياري)`,
          () => {
            setAuditDeficitReason('')
            setReasonAuditId(auditId)
            setShowReasonModal(true)
          },
          () => {
            // Dismissed
          },
          'تنبيه عجز بالدرج',
          'تسجيل السبب',
          'تخطي'
        )
      } else {
        triggerCustomAlert('تم حفظ الجرد الدوري بنجاح. شكراً لك.', 'نجاح العملية')
      }
    } catch (e) {
      console.error('Failed to save shift audit:', e)
      triggerCustomAlert('فشلت عملية حفظ الجرد: ' + e.message)
    }
  }

  const snoozeAudit = () => {
    setShowAuditModal(false)
    const intervalMs = (Number(appSettings?.audit_interval_minutes) || 60) * 60000
    lastAuditTime.current = Date.now() - intervalMs + 5 * 60 * 1000 // snooze for 5 minutes
    triggerCustomAlert('تم تأجيل الجرد الدوري لمدة 5 دقائق.')
  }

  const skipAudit = () => {
    setShowAuditModal(false)
    lastAuditTime.current = Date.now() // reset hourly timer
    triggerCustomAlert('تم تخطي الجرد الدوري لهذه الساعة.')
  }

  // On App Mount: check the service connection and whether the first administrator exists.
  // The till always starts locked; an open shift is resumed after PIN login (G-16).
  // A temporarily unreachable database or server (503) is retried for about half a minute before
  // the connection settings are shown; the settings screen is for configuration problems.
  const checkStartup = async (attempt = 0) => {
    try {
      const st = window.api?.backend ? await window.api.backend.status() : { ready: false }
      setBackendInfo(st)
      if (!st.ready) {
        setStartupPhase(startupPhaseFor(st))
        return
      }
      const auth = await api('auth.status')
      setStartupPhase(auth.needsSetup ? 'setup' : 'ready')
    } catch (e) {
      if (e.status === 503 && attempt < 15) {
        setStartupPhase('checking')
        setTimeout(() => checkStartup(attempt + 1), 2000)
        return
      }
      setBackendInfo((b) => ({ ...(b || {}), error: e.message }))
      setStartupPhase('connect')
    }
  }
  useEffect(() => {
    checkStartup()
  }, [])

  // Session expired, account disabled or data restored: back to the lock screen.
  useEffect(() => {
    const onExpired = () => {
      rawHandleLock()
      setCurrentView('pos')
      triggerCustomAlert('انتهت الجلسة أو تغيّرت صلاحيات الحساب. يرجى تسجيل الدخول مرة أخرى.')
    }
    window.addEventListener('heromarket:session-expired', onExpired)
    const onRecovery = () => setRecoveryPending(true)
    window.addEventListener('heromarket:recovery-pending', onRecovery)
    return () => {
      window.removeEventListener('heromarket:session-expired', onExpired)
      window.removeEventListener('heromarket:recovery-pending', onRecovery)
    }
  }, [])

  // A cash operation was refused for lack of a shift: offer to open one (1.4.0). The refusal
  // message is shown by the screen that asked; the window opens behind it.
  useEffect(() => {
    const onShiftRequired = () => {
      if (can(currentUser, 'shifts.operate') && !(currentShift && currentShift.status === 'open')) {
        setStartingCash(String(appSettings?.default_opening_cash ?? '200'))
        setOpenShiftModal('cash')
      }
    }
    window.addEventListener('heromarket:shift-required', onShiftRequired)
    return () => window.removeEventListener('heromarket:shift-required', onShiftRequired)
  }, [currentUser, currentShift, appSettings, setOpenShiftModal, setStartingCash])

  // Store default for automatic receipt printing (the cashier can still toggle it per sale).
  useEffect(() => {
    if (appSettings) setNoPrint(appSettings.print_receipt_default === 'false')
  }, [appSettings])

  // Data the shell needs right after a login (previously loaded at mount, before login).
  const onLoggedIn = () => {
    loadAppSettings()
    loadMeasureKinds()
    api('sync.state')
      .then((r) => setRecoveryPending(!!r.recoveryPending))
      .catch(() => {})
    adminController.fetchStats()
  }

  // Global keyboard shortcuts
  // Esc and the "تفريغ" button ask first; a cancelled clear keeps the invoice exactly (POS-01).
  const confirmClearCart = () => {
    if (!cart.length) return
    triggerCustomConfirm(
      `سيتم حذف كل أصناف الفاتورة الحالية (${cart.length} صنف). هل تريد تفريغها؟`,
      triggerClearCart,
      null,
      'تفريغ الفاتورة'
    )
  }

  useKeyboardShortcuts({
    isLocked,
    customAlert,
    closeCustomAlert,
    handleLock,
    handleCheckout,
    searchInputRef,
    qtyInputRefs,
    triggerClearCart: confirmClearCart,
    cart,
    triggerDeleteItem
  })

  // Sidebar navigation → original state values (see components/shell/navigation.js)
  const handleNavigate = (item) => {
    if (item.view === 'admin') {
      const enteringAdmin = currentView !== 'admin'
      setCurrentView('admin')
      setAdminTab(item.tab)
      // The original "management" header button reloaded all admin data on entry;
      // each section card then ran its own loader. Both are preserved.
      if (enteringAdmin && item.tab !== 'menu') adminController.fetchAdminData()
      try {
        item.onEnter?.(adminController)
      } catch (e) {
        console.error('[NAV] onEnter failed:', e)
      }
    } else {
      setCurrentView(item.view)
    }
  }

  const toastIsError = typeof toastMessage === 'object' && toastMessage?.type === 'error'
  const toastIsWarning = typeof toastMessage === 'object' && toastMessage?.type === 'warning'
  const auditRows = [
    { label: 'إجمالي مبيعات الفواتير', value: auditBreakdown?.grossSales || 0, sign: '' },
    {
      label: 'مبيعات آجل ورقمية (لم تدخل الدرج)',
      value: auditBreakdown?.debtSales || 0,
      sign: '−',
      tone: 'warning'
    },
    {
      label: 'مرتجعات ومصروفات (خارج)',
      value: auditBreakdown?.refunds || 0,
      sign: '−',
      tone: 'danger'
    },
    {
      label: 'تحصيل ديون عملاء (داخل)',
      value: auditBreakdown?.repay || 0,
      sign: '+',
      tone: 'info'
    },
    {
      label: 'كاش الفكة الافتتاحي',
      value: auditBreakdown?.initialCash || 0,
      sign: '+',
      tone: 'info'
    }
  ]

  // Connection setup / first administrator, before the lock screen
  if (startupPhase !== 'ready') {
    return (
      <StartupGate
        phase={startupPhase}
        backendInfo={backendInfo}
        onRetry={checkStartup}
        onSetupDone={(user) => {
          setCurrentUser(user)
          setStartupPhase('ready')
          setIsLocked(false)
          onLoggedIn(user)
          setStartingCash('200')
          // The owner works without a shift; he may open one now or later (1.4.0).
          setOpenShiftModal('optional')
        }}
      />
    )
  }

  // Render Pin Authenticator Screen (the alert dialog must stay visible here, e.g. wrong PIN)
  if (isLocked) {
    return (
      <>
        <LockScreen onSignedIn={completeSignIn} />
        <CustomAlertModal customAlert={customAlert} closeCustomAlert={closeCustomAlert} />
      </>
    )
  }

  return (
    <>
      {toastMessage && (
        <div
          className={`toast ${toastIsError ? 'toast-error' : toastIsWarning ? 'toast-warning' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="toast-icon" aria-hidden="true">
            {toastIsError || toastIsWarning ? (
              <TriangleAlert size={18} />
            ) : (
              <CircleCheck size={18} />
            )}
          </span>
          <span className="toast-text">
            {typeof toastMessage === 'object' ? toastMessage.text : toastMessage}
          </span>
        </div>
      )}

      <AppShell
        currentUser={currentUser}
        currentView={currentView}
        adminTab={adminTab}
        onNavigate={handleNavigate}
        currentShift={currentShift}
        onOpenShift={() => setOpenShiftModal('optional')}
        onCloseShift={() => setCloseShiftModal(true)}
        onLock={handleLock}
        onChangePassword={() => setShowChangePassword(true)}
        version={packageInfo.version}
      >
        {currentView === 'admin' && canAccessAdmin(currentUser) ? (
          <AdminDashboard
            currentUser={currentUser}
            currentShift={currentShift}
            triggerCustomAlert={triggerCustomAlert}
            triggerCustomConfirm={triggerCustomConfirm}
            adminTab={adminTab}
            setAdminTab={setAdminTab}
            adminSearchInputRef={adminSearchInputRef}
            handleReprintSale={handleReprintSale}
            onNavigate={handleNavigate}
            onSettingsChanged={loadAppSettings}
            onOpenShift={() => setOpenShiftModal('optional')}
            {...adminController}
          />
        ) : currentView === 'tills' ? (
          <div className="admin-container">
            <TillsManagerTab
              currentUser={currentUser}
              currentShift={currentShift}
              triggerCustomAlert={triggerCustomAlert}
              triggerCustomConfirm={triggerCustomConfirm}
            />
          </div>
        ) : (
          <CheckoutTerminal
            cart={cart}
            triggerClearCart={confirmClearCart}
            addByBarcode={addProductByBarcode}
            onReturn={
              can(currentUser, 'sales.return_request') || can(currentUser, 'sales.return')
                ? () => setReturnRequestOpen(true)
                : null
            }
            qtyInputRefs={qtyInputRefs}
            handleQtyChangeAttempt={handleQtyChangeAttempt}
            changeLineUnit={changeLineUnit}
            pendingWeight={pendingWeight}
            confirmWeight={confirmWeight}
            editWeight={editWeight}
            triggerDeleteItem={triggerDeleteItem}
            cartSubtotal={cartSubtotal}
            discount={discount}
            appliedDiscounts={appliedDiscounts}
            canManualDiscount={can(currentUser, 'pos.manual_discount')}
            manualDiscount={manualDiscount}
            setManualDiscount={setManualDiscount}
            afterRules={afterRules}
            paidAmount={paidAmount}
            setPaidAmount={setPaidAmount}
            changeRemaining={changeDue}
            isDelivery={isDelivery}
            setIsDelivery={setIsDelivery}
            clientName={clientName}
            handleClientNameChange={handleClientNameChange}
            clientPhone={clientPhone}
            setClientPhone={setClientPhone}
            handleClientPhoneChange={handleClientPhoneChange}
            clientAddress={clientAddress}
            setClientAddress={setClientAddress}
            clientAddressId={clientAddressId}
            setClientAddressId={setClientAddressId}
            clientSearchResults={clientSearchResults}
            selectClient={selectClient}
            paymentType={paymentType}
            setPaymentType={setPaymentType}
            upfrontMethod={upfrontMethod}
            setUpfrontMethod={setUpfrontMethod}
            cartTotal={cartTotal}
            depositChange={depositChange}
            setDepositChange={setDepositChange}
            appliedCredit={appliedCredit}
            setAppliedCredit={setAppliedCredit}
            selectedClient={selectedClient}
            handleCheckout={handleCheckout}
            barcodeInputRef={barcodeInputRef}
            barcodeInput={barcodeInput}
            setBarcodeInput={setBarcodeInput}
            handleBarcodeSubmit={handleBarcodeSubmit}
            dbStats={adminController.dbStats}
            noPrint={noPrint}
            setNoPrint={setNoPrint}
            searchInputRef={searchInputRef}
            searchInput={searchInput}
            handleSearchChange={handleSearchChange}
            handleSearchKeyDown={handleSearchKeyDown}
            searchedTerm={searchedTerm}
            searchResults={searchResults}
            selectedSearchIndex={selectedSearchIndex}
            addToCart={(item) => addProductByBarcode(item.barcode)}
            setSearchInput={setSearchInput}
            setSearchResults={setSearchResults}
            setSelectedSearchIndex={setSelectedSearchIndex}
            triggerCustomAlert={triggerCustomAlert}
          />
        )}
      </AppShell>

      <CloseReportModal data={closeReport} onDone={dismissCloseReport} />
      <AppModals
        openShiftModal={openShiftModal}
        setOpenShiftModal={setOpenShiftModal}
        onSignOut={handleLock}
        currentUser={currentUser}
        startingCash={startingCash}
        setStartingCash={setStartingCash}
        momknStartBalance={momknStartBalance}
        setMomknStartBalance={setMomknStartBalance}
        momknStartCash={momknStartCash}
        setMomknStartCash={setMomknStartCash}
        vfcashStartBalance={vfcashStartBalance}
        setVfcashStartBalance={setVfcashStartBalance}
        vfcashStartCash={vfcashStartCash}
        setVfcashStartCash={setVfcashStartCash}
        handleStartShift={handleStartShift}
        closeShiftModal={closeShiftModal}
        currentShift={currentShift}
        actualEndCash={actualEndCash}
        setActualEndCash={setActualEndCash}
        setCloseShiftModal={setCloseShiftModal}
        handleConfirmCloseShift={handleConfirmCloseShift}
        customAlert={customAlert}
        closeCustomAlert={closeCustomAlert}
        customConfirm={customConfirm}
        closeCustomConfirm={closeCustomConfirm}
        approvalRequest={approvalRequest}
        setApprovalRequest={setApprovalRequest}
        returnRequestOpen={returnRequestOpen}
        setReturnRequestOpen={setReturnRequestOpen}
        addProductBarcodeRef={addProductBarcodeRef}
        {...adminController}
      />

      <RecoveryPendingModal
        open={recoveryPending}
        currentUser={currentUser}
        onClose={() => setRecoveryPending(false)}
        onOpenSync={() => {
          setRecoveryPending(false)
          const item = ALL_NAV_ITEMS.find((i) => i.id === 'sync')
          if (item) handleNavigate(item)
        }}
        onLock={() => {
          setRecoveryPending(false)
          handleLock()
        }}
      />

      <ChangePasswordModal
        open={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        currentUser={currentUser}
      />

      {/* Periodic drawer audit */}
      {showAuditModal && (
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <div
            className="modal-content tone-accent"
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-title"
            style={{ width: 500 }}
          >
            <div className="modal-header">
              <span className="modal-icon" aria-hidden="true">
                <ClipboardCheck size={24} />
              </span>
              <h2 id="audit-title">الجرد الدوري للدرج</h2>
              <p>
                مرحباً <strong>{currentUser?.username}</strong>، طابق النقدية في الدرج للوردية رقم{' '}
                <span className="num">#{currentShift?.id}</span> لتفادي أي عجز.
              </p>
            </div>

            <div className="modal-body">
              {auditExpectedCash === null ? (
                <div className="notice">
                  <span>
                    عُدّ النقدية الموجودة في الدرج واكتبها. لا يظهر المبلغ المتوقع أثناء الوردية.
                  </span>
                </div>
              ) : (
                <div className="audit-summary">
                  <dl className="kv">
                    {auditRows
                      .filter((r) => r.sign === '' || r.value > 0)
                      .map((r) => (
                        <div key={r.label} style={{ display: 'contents' }}>
                          <dt>{r.label}</dt>
                          <dd className={r.tone ? `text-${r.tone}` : ''}>
                            {r.sign} {r.value.toFixed(2)} ج.م
                          </dd>
                        </div>
                      ))}
                  </dl>
                  <div className="audit-expected">
                    <span>صافي الكاش المتوقع بالدرج</span>
                    <strong className="money">{(auditExpectedCash || 0).toFixed(2)} ج.م</strong>
                  </div>
                  <button
                    type="button"
                    className="btn btn-accent-soft btn-sm btn-block"
                    onClick={() => setAuditActualCash((auditExpectedCash || 0).toFixed(2))}
                  >
                    تعبئة المبلغ المتوقع تلقائياً
                  </button>
                </div>
              )}

              <label className="field">
                <span className="field-label">المبلغ النقدي الفعلي في الدرج حالياً (ج.م) *</span>
                <NumberField
                  className="input input-lg input-money"
                  placeholder="0.00"
                  value={auditActualCash}
                  onChange={(e) => setAuditActualCash(e.target.value)}
                  autoFocus
                />
              </label>

              <label className="field">
                <span className="field-label">ملاحظات الجرد (اختياري)</span>
                <textarea
                  className="input"
                  placeholder="مثال: تم الجرد الدوري والدرج مطابق..."
                  value={auditNotes}
                  onChange={(e) => setAuditNotes(e.target.value)}
                  rows={2}
                />
              </label>
            </div>

            <div className="modal-footer">
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={submitAudit}>
                تأكيد وحفظ الجرد
              </button>
              <button data-modal-close className="btn btn-secondary" onClick={snoozeAudit}>
                تأجيل 5 دقائق
              </button>
              <button className="btn btn-ghost" onClick={skipAudit}>
                تخطي
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deficit reason */}
      {showReasonModal && (
        <div className="modal-overlay" style={{ zIndex: 100000 }}>
          <div
            className="modal-content tone-warning"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reason-title"
            style={{ width: 440 }}
          >
            <div className="modal-header">
              <span className="modal-icon" aria-hidden="true">
                <NotebookPen size={24} />
              </span>
              <h2 id="reason-title">تسجيل سبب العجز</h2>
              <p>توضيح سبب الفارق المالي بالدرج</p>
            </div>
            <div className="modal-body">
              <label className="field">
                <span className="field-label">سبب أو ملاحظة العجز (اختياري)</span>
                <textarea
                  className="input"
                  placeholder="مثال: عجز فكة، أو زبون متبقي له حساب، إلخ..."
                  value={auditDeficitReason}
                  onChange={(e) => setAuditDeficitReason(e.target.value)}
                  rows={3}
                  autoFocus
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={async () => {
                  try {
                    await api('shifts.auditNote', {
                      auditId: reasonAuditId,
                      notes: auditDeficitReason
                    })
                    triggerCustomAlert('تم تسجيل سبب العجز بنجاح.', 'تم الحفظ')
                    setShowReasonModal(false)
                    adminController.fetchAdminData()
                  } catch (e) {
                    console.error('Failed to update audit notes:', e)
                  }
                }}
              >
                حفظ التوضيح
              </button>
              <button
                data-modal-close
                className="btn btn-secondary"
                onClick={() => setShowReasonModal(false)}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
