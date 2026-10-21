import { useState, useRef, useEffect } from 'react'
import { playSound } from '../lib/utils'
import { api, newClientRef } from '../lib/api'
import { checkoutFingerprint, outcomeUnknown, planCheckout } from '../lib/checkoutRetry'
import { receiptQty } from '../lib/weight'
import { kindInfo } from '../lib/measureKinds'
import { formatClock, ltrText } from '../lib/time'

/**
 * Custom hook to encapsulate the POS checkout/terminal workflow control logic,
 * including shifts logging, barcode parsing, search suggestions, printing,
 * supervisor approval of shift differences and checkout. All data goes through the HeroMarket
 * service (lib/api).
 */
export function usePOSController({
  currentUser,
  setCurrentUser,
  currentShift,
  setCurrentShift,
  setIsLocked,
  openShiftModal,
  setOpenShiftModal,
  startingCash,
  setStartingCash,
  momknStartBalance,
  momknStartCash,
  vfcashStartBalance,
  vfcashStartCash,
  setCloseShiftModal,
  actualEndCash,
  setApprovalRequest,
  rawHandleLock,

  cart,
  setCart,
  setDiscount,
  paidAmount,
  setPaidAmount,
  paymentType,
  upfrontMethod,
  setUpfrontMethod,
  setPaymentType,
  clientName,
  setClientName,
  clientPhone,
  setClientPhone,
  isDelivery,
  setIsDelivery,
  cartTotal,
  addToCart,

  barcodeInputRef,

  depositChange,
  setDepositChange,
  appliedCredit,
  setAppliedCredit,
  printSilent,
  noPrint,
  setToastMessage,
  fetchStats,
  fetchClientsList,
  fetchClientStats,
  fetchAdminData,
  triggerCustomAlert,
  triggerCustomConfirm,
  setCurrentView,
  appSettings,
  onLoggedIn
}) {
  const searchDebounceRef = useRef(null)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [searchInput, setSearchInput] = useState('')
  // Latest search text, so a late debounced query can tell the search was cleared or changed.
  const latestSearchRef = useRef('')
  useEffect(() => {
    latestSearchRef.current = searchInput
  }, [searchInput])
  const [searchResults, setSearchResults] = useState([])
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(-1)

  const [clientAddress, setClientAddress] = useState('')
  // A saved address of the selected customer chosen for delivery (null = typed address).
  const [clientAddressId, setClientAddressId] = useState(null)
  const [selectedClient, setSelectedClient] = useState(null)
  // Automatic discounts (administrator rules) priced by the service for the current cart.
  const [appliedDiscounts, setAppliedDiscounts] = useState([])
  // Manual fixed invoice discount (D-057): { amount, reason } or null; priced by the service too.
  const [manualDiscount, setManualDiscount] = useState(null)
  // Total after the automatic rules (the most a manual discount can be), from the last preview.
  const [afterRules, setAfterRules] = useState(0)
  const pricingSeqRef = useRef(0)
  const refreshPricing = async () => {
    const seq = ++pricingSeqRef.current
    if (cart.length === 0) {
      setDiscount(0)
      setAppliedDiscounts([])
      setAfterRules(0)
      setManualDiscount(null)
      return
    }
    try {
      const r = await api('pos.price', {
        items: cart.map((item) => ({
          barcode: item.barcode,
          unitId: item.unitId ?? null,
          qty: item.qty
        })),
        manualDiscount: manualDiscount || undefined
      })
      if (seq !== pricingSeqRef.current) return // a newer cart is being priced
      setDiscount(r.discount)
      setAppliedDiscounts(r.applied)
      setAfterRules(r.afterRules ?? r.afterDiscount)
    } catch (err) {
      if (seq !== pricingSeqRef.current) return
      // The cart shrank below the manual discount (or the permission was withdrawn): drop it and
      // say so; the next preview prices the cart without it.
      if (manualDiscount) {
        setManualDiscount(null)
        triggerCustomAlert(`أُلغي الخصم اليدوي: ${err.message}`, 'الخصم اليدوي')
      }
      // Other pricing problems (e.g. an invalid quantity) surface at checkout with their message.
    }
  }
  useEffect(() => {
    const t = setTimeout(refreshPricing, 120)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, manualDiscount])
  const [clientSearchResults, setClientSearchResults] = useState([])

  const handleLock = () => {
    // Revoke the service session too (the till keeps no token after locking).
    api('auth.logout').catch(() => {})
    rawHandleLock()
    setCart([])
    setBarcodeInput('')
    setSearchInput('')
    setSearchResults([])
    setClientName('')
    setClientPhone('')
    setIsDelivery(false)
    setClientAddress('')
    setClientAddressId(null)
    setSelectedClient(null)
    setClientSearchResults([])
    setCurrentView('pos')
  }

  // Signed in on the lock screen (auth.login / auth.setPassword / auth.recover answer).
  // One request id per close: a retry after a lost answer returns the saved close (PAY-01).
  const closeRef = useRef(null)
  // The saved close report, shown after the close is confirmed and saved (SHIFT-02).
  const [closeReport, setCloseReport] = useState(null)

  const completeSignIn = (res) => {
    const user = res.user
    // A close report belongs to the user who closed: never shown to the next one.
    setCloseReport(null)
    setCurrentUser(user)
    if (onLoggedIn) onLoggedIn(user)
    setIsLocked(false) // Unlock the screen layout
    if (!user.permissions.includes('reports.view')) {
      setCurrentView('pos')
    }
    if (res.openShift) {
      setCurrentShift(res.openShift)
      // A dialog left from the previous user (e.g. their open-shift prompt) must not stay open.
      setOpenShiftModal(false)
      playSound('success')
    } else if (user.permissions.includes('shifts.operate')) {
      setCurrentShift(null)
      try {
        setStartingCash(String(appSettings?.default_opening_cash ?? '200'))
      } catch {
        /* setter unavailable */
      }
      // Roles chosen in the settings must open a shift before working (the window cannot be
      // closed). Others, and always the owner, work without one and are asked when they sell or
      // move drawer cash (1.4.0).
      setOpenShiftModal(res.shiftRequired ? 'required' : false)
    } else {
      setCurrentShift(null)
    }
  }

  // Open Shift
  const handleStartShift = async () => {
    const startingCashNum = parseFloat(startingCash) || 0
    const momknStartNum = parseFloat(momknStartBalance) || 0
    const momknCashNum = parseFloat(momknStartCash) || 0
    const vfcashStartNum = parseFloat(vfcashStartBalance) || 0
    const vfcashCashNum = parseFloat(vfcashStartCash) || 0
    if (
      startingCashNum < 0 ||
      momknStartNum < 0 ||
      momknCashNum < 0 ||
      vfcashStartNum < 0 ||
      vfcashCashNum < 0
    )
      return

    try {
      if (!currentUser || !currentUser.id) {
        triggerCustomAlert('يرجى تسجيل الدخول أولاً برمز المرور الخاص بك لفتح الوردية.')
        return
      }
      const shift = await api('shifts.open', {
        startingCash: startingCashNum,
        momknStartBalance: momknStartNum,
        momknStartCash: momknCashNum,
        vfcashStartBalance: vfcashStartNum,
        vfcashStartCash: vfcashCashNum
      })
      const reason = openShiftModal
      setCurrentShift(shift)
      setOpenShiftModal(false)
      setIsLocked(false)
      playSound('chime')
      // Opened to complete a sale: finish it on the new shift.
      if (reason === 'sale') handleCheckout(shift)
    } catch (e) {
      console.error('Failed to open shift:', e)
      playSound('error')
      triggerCustomAlert('فشل فتح الوردية: ' + e.message)
    }
  }

  // Close Active Shift
  const handleConfirmCloseShift = async (opts) => {
    const actual = parseFloat(actualEndCash) || 0
    if (isNaN(actual) || actual < 0) {
      triggerCustomAlert('الرجاء إدخال مبلغ صحيح.')
      return
    }
    const counted = opts?.actual || { visa: 0, wallet: 0, instapay: 0 }
    if (!closeRef.current) closeRef.current = newClientRef()
    const closeBody = {
      shiftId: currentShift.id,
      actualCash: actual,
      actual: counted,
      clientRef: closeRef.current
    }

    try {
      const afterClose = async (closed) => {
        try {
          const shiftRow = closed.shift || currentShift
          // The close is saved: the dialog goes and the saved report shows at once; printing
          // follows (a missing printer can take seconds to report and never undoes the close).
          playSound('chime')
          closeRef.current = null
          setCloseShiftModal(false)
          if (closed.report) setCloseReport({ report: closed.report, shift: closed.shift })

          // Trigger print report automatically!
          if (window.api?.printer?.printReport) {
            try {
              await window.api.printer.printReport('shift', {
                shift: { ...shiftRow, username: currentUser?.username },
                cashSales: closed.figures.cashSales,
                inflow: closed.figures.inflow,
                outflow: closed.figures.outflow,
                expected: closed.expected,
                actual: closed.actual,
                difference: closed.difference,
                manualDiscounts: closed.live?.manualDiscounts,
                // The saved close (SHIFT-02): the printed report is exactly what was confirmed.
                report: closed.report
              })
            } catch (printErr) {
              console.error('Failed to print grand shift report:', printErr)
            }
          }

          // Signing out follows when the report is dismissed (a close without one signs out now).
          if (!closed.report) handleLock()
        } catch (e) {
          console.error('Failed after closing the shift:', e)
        }
      }

      const finalizeShiftClose = async () => {
        try {
          // The service computes the expected drawer cash with the legacy formula and closes the shift.
          const closed = await api('shifts.close', closeBody)
          await afterClose(closed)
        } catch (e) {
          if (e.code === 'approval_required') {
            // Difference above EGP 50: a supervisor acknowledges it (owner decision 2026-10-14).
            const d = e.details || {}
            playSound('error')
            setApprovalRequest({
              title: 'فرق في إغلاق الوردية',
              // Blind close: the cashier is not told the expected amount or the difference.
              summary: d.blind
                ? 'المبالغ المكتوبة تختلف عن المتوقع بأكثر من 50 ج.م: يلزم اعتماد المشرف لإغلاق الوردية. يمكنك الإلغاء وإعادة العد؛ كل محاولة تُسجَّل.'
                : `الفرق ${Number(d.difference).toFixed(2)} ج.م (المتوقع ${Number(d.expected).toFixed(2)}، الفعلي ${Number(d.actual).toFixed(2)}) يتجاوز 50 ج.م ويحتاج إلى اعتماد المشرف.`,
              noteLabel: 'سبب الفرق (اختياري)',
              noteRequired: false,
              onSubmit: async (approver, note) => {
                const closed = await api('shifts.close', {
                  ...closeBody,
                  approver,
                  note: note || undefined
                })
                setApprovalRequest(null)
                await afterClose(closed)
              }
            })
            return
          }
          console.error('Failed to close shift:', e)
          playSound('error')
          triggerCustomAlert('فشل إغلاق الوردية: ' + e.message)
        }
      }

      // Prompt for database backup
      triggerCustomConfirm(
        'هل تريد أخذ نسخة احتياطية من قاعدة البيانات الآن قبل إغلاق الوردية؟',
        async () => {
          if (window.api && window.api.db && window.api.db.backup) {
            const backupRes = await window.api.db.backup()
            if (backupRes && backupRes.success) {
              triggerCustomAlert(
                `تم حفظ النسخة الاحتياطية بنجاح في:\n${backupRes.filePath}`,
                'نجاح النسخ الاحتياطي',
                async () => {
                  await finalizeShiftClose()
                }
              )
            } else if (backupRes && backupRes.error && backupRes.error !== 'User cancelled') {
              triggerCustomAlert(
                `فشل حفظ النسخة الاحتياطية: ${backupRes.error}`,
                'فشل النسخ الاحتياطي',
                async () => {
                  await finalizeShiftClose()
                }
              )
            } else {
              await finalizeShiftClose()
            }
          } else {
            triggerCustomAlert(
              'خاصية النسخ الاحتياطي غير متوفرة في هذه البيئة.',
              'تنبيه',
              async () => {
                await finalizeShiftClose()
              }
            )
          }
        },
        async () => {
          await finalizeShiftClose()
        }
      )
    } catch (e) {
      console.error('Failed to close shift:', e)
      playSound('error')
    }
  }

  // Search results are plain product rows: resolve them so the line gets its units (and the
  // weight entry for products sold by the kilogram).
  const addProductByBarcode = async (barcode) => {
    try {
      const resolved = await api('pos.resolve', { code: barcode })
      if (resolved) addToCart(resolved)
      return !!resolved
    } catch (err) {
      triggerCustomAlert(err.message)
      return false
    }
  }

  // Handle Barcode Scanner Form Submit
  const handleBarcodeSubmit = async (e) => {
    if (e) e.preventDefault()
    if (!barcodeInput) return

    const rawInput = barcodeInput.trim()
    try {
      // The service resolves the scan to a product and a unit: product barcode, extra or
      // packaging barcode, or a scale label (weight or price) per the store's settings.
      let product = await api('pos.resolve', { code: rawInput })

      if (!product && rawInput.length >= 6 && rawInput.length <= 12) {
        const candidates = await api('pos.suffixCandidates', { suffix: rawInput })
        if (candidates.length === 1) {
          product = await api('pos.resolve', { code: candidates[0].barcode })
        } else if (candidates.length > 1) {
          setSearchResults(candidates)
          setBarcodeInput('')
          return
        }
      }

      if (product) {
        addToCart(product)
        setBarcodeInput('')
      } else {
        const missingBarcode = rawInput
        setBarcodeInput('')
        playSound('error')
        setToastMessage({
          text: `رمز الباركود (${missingBarcode}) غير مسجل في قاعدة البيانات!`,
          type: 'error'
        })
        setTimeout(() => setToastMessage(null), 4000)
      }
    } catch (err) {
      // The service explains why a scan cannot be used (a stopped product, an invalid scale
      // label, an unknown scale code…): show it, and never add anything (SCALE-01).
      console.error('Barcode lookup error:', err)
      playSound('error')
      setBarcodeInput('')
      setToastMessage({ text: err.message, type: 'error' })
      setTimeout(() => setToastMessage(null), 5000)
    }
  }

  // Instant catalog search
  const handleSearchChange = (e) => {
    const val = e.target.value
    setSearchInput(val)
    setSelectedSearchIndex(-1)

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    if (!val.trim()) {
      setSearchResults([])
      return
    }

    searchDebounceRef.current = setTimeout(async () => {
      if (latestSearchRef.current !== val) return
      try {
        if (latestSearchRef.current !== val) return
        const results = await api('pos.searchProducts', { term: val })
        if (latestSearchRef.current !== val) return
        setSearchResults(results)
      } catch (err) {
        console.error('Search query error:', err)
      }
    }, 150)
  }

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setSearchInput('')
      setSearchResults([])
      setSelectedSearchIndex(-1)
      barcodeInputRef.current?.focus()
      return
    }

    if (searchResults.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedSearchIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedSearchIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const targetItem =
        selectedSearchIndex >= 0 && selectedSearchIndex < searchResults.length
          ? searchResults[selectedSearchIndex]
          : searchResults[0]
      if (targetItem) {
        addProductByBarcode(targetItem.barcode)
        setSearchInput('')
        setSearchResults([])
        setSelectedSearchIndex(-1)
        barcodeInputRef.current?.focus()
      }
    }
  }

  // Checkout: the service validates, prices and commits the sale in one transaction.
  // A pending flag + per-attempt idempotency key prevent double sales from repeated F1/clicks.
  // An attempt whose outcome is unknown (reply lost) is retried under the same key (lib/checkoutRetry).
  const checkoutPendingRef = useRef(null)
  const unresolvedCheckoutRef = useRef(null)
  const handleCheckout = async (openedShift = null) => {
    // The button passes its click event; only a shift object from handleStartShift counts.
    const shiftNow = openedShift?.status === 'open' ? openedShift : currentShift
    if (cart.length === 0) {
      playSound('error')
      triggerCustomAlert('السلة فارغة! يرجى إضافة سلع أولاً.', 'تنبيه الفاتورة')
      return
    }

    if (!shiftNow || !shiftNow.id || shiftNow.status !== 'open') {
      // A user allowed to work without a shift (the owner) is asked to open one now.
      if (currentUser?.permissions?.includes('shifts.operate')) {
        setStartingCash(String(appSettings?.default_opening_cash ?? '200'))
        setOpenShiftModal('sale')
        return
      }
      playSound('error')
      triggerCustomAlert(
        'فشل البيع: لا توجد وردية كاشير مفتوحة حالياً!\nيرجى فتح وردية جديدة أولاً لبدء عمليات البيع.',
        'تنبيه الوردية'
      )
      return
    }
    if (checkoutPendingRef.current) return
    checkoutPendingRef.current = true
    let attempt = null

    try {
      const payload = {
        shiftId: shiftNow.id,
        items: cart.map((item) => ({
          barcode: item.barcode,
          unitId: item.unitId ?? null,
          qty: item.qty,
          unitPrice: item.price
        })),
        // The total shown to the customer; the service refuses the sale if its own differs.
        expectedTotal: cartTotal,
        manualDiscount: manualDiscount || undefined,
        paymentType,
        paidAmount: paidAmount ? parseFloat(paidAmount) || 0 : null,
        upfrontMethod: paymentType === 'دفع جزئي' ? upfrontMethod || 'cash' : undefined,
        appliedCredit: parseFloat(appliedCredit) || 0,
        depositChange: parseFloat(depositChange) || 0,
        isDelivery: !!isDelivery,
        client: clientName
          ? {
              id: selectedClient ? selectedClient.id : null,
              name: clientName,
              phone: clientPhone || '',
              // A saved address goes by id (checked on the server); otherwise the typed text.
              address: isDelivery && selectedClient && clientAddressId ? '' : clientAddress || '',
              addressId: isDelivery && selectedClient && clientAddressId ? clientAddressId : null
            }
          : null
      }
      const fingerprint = checkoutFingerprint(payload)
      const plan = planCheckout(unresolvedCheckoutRef.current, fingerprint)
      if (plan.checkFirst) {
        // The cart changed after an attempt whose reply was lost: find out whether it was recorded.
        const status = await api('pos.checkoutStatus', { clientRef: plan.checkFirst })
        unresolvedCheckoutRef.current = null
        if (status.recorded) {
          playSound('error')
          triggerCustomAlert(
            `الفاتورة السابقة رقم ${status.saleId} (الإجمالي ${status.total}) سُجِّلت بالفعل قبل انقطاع الاتصال، والسلة الحالية مختلفة عنها.\nراجع الفاتورة رقم ${status.saleId} في الفواتير قبل البيع مرة أخرى.`,
            'تنبيه الفاتورة'
          )
          return
        }
      }
      attempt = { clientRef: plan.clientRef || newClientRef(), fingerprint }
      const result = await api('pos.checkout', { clientRef: attempt.clientRef, ...payload })
      unresolvedCheckoutRef.current = null

      const displaySaleId = parseInt(result.saleId) > 0 ? result.saleId : '—'
      playSound('chime')

      const datePart = new Date().toLocaleDateString('ar-EG')
      const timePart = ltrText(formatClock(new Date()))
      const paidShown = paidAmount ? parseFloat(paidAmount) || cartTotal : cartTotal

      if (!noPrint && window.api && window.api.printer && window.api.printer.printSale) {
        window.api.printer
          .printSale(
            {
              saleId: displaySaleId,
              date: datePart,
              time: timePart,
              cashier: currentUser?.username,
              paymentType: paymentType || 'نقدي',
              client: {
                name: clientName,
                phone: clientPhone,
                address: result.deliveryAddress || clientAddress
              },
              items: cart.map((item) => ({
                // Packaging lines name their unit on the receipt (e.g. "كيك (كرتونة)").
                name: item.unitId ? `${item.name || 'صنف'} (${item.unitName})` : item.name || 'صنف',
                barcode: item.barcode,
                // Weighed lines print their weight with the unit (e.g. 0.250 كجم).
                qty: receiptQty(item.qty, {
                  ...item,
                  decimals: kindInfo(item.kind).decimals,
                  kindUnit: kindInfo(item.kind).unit
                }),
                price: item.price,
                total: item.total
              })),
              subTotal: result.subTotal,
              discount: result.discount,
              total: result.total,
              paid: paidShown,
              change: paidAmount ? Math.max(0, (parseFloat(paidAmount) || 0) - result.total) : 0
            },
            { silent: printSilent }
          )
          .catch((e) => {
            console.error('[PRINT FLOW] Printing failed:', e)
            // The sale is saved before printing: say so, so nobody records or pays it twice.
            const reason = String(e.message || '').replace(
              /^Error invoking remote method '[^']+': (Error: )?/,
              ''
            )
            triggerCustomAlert(
              `تعذرت طباعة الفاتورة رقم ${displaySaleId}: ${reason}\nالفاتورة محفوظة ولم تُسجَّل مرة ثانية. يمكن إعادة طباعتها من سجل الفواتير بعد توصيل الطابعة.`
            )
          })
      }

      // Owner rule: what was used for this order but not kept on the customer is said plainly.
      const notSaved = [
        result.notSaved?.phone === 'other_customer' &&
          'رقم الهاتف مسجَّل لعميل آخر، فاستُخدم لهذا الطلب فقط ولم يُحفظ لهذا العميل.',
        result.notSaved?.phone === 'no_free_slot' &&
          'للعميل رقمان محفوظان، فاستُخدم الرقم لهذا الطلب فقط ولم يُحفظ.',
        result.notSaved?.address === 'limit' &&
          'للعميل 3 عناوين محفوظة، فاستُخدم العنوان لهذا الطلب فقط ولم يُحفظ.'
      ].filter(Boolean)
      setToastMessage(
        result.duplicate
          ? `الفاتورة رقم ${displaySaleId} كانت قد سُجِّلت بالفعل، ولم تُسجَّل مرة ثانية.`
          : notSaved.length
            ? { type: 'warning', text: ['تم إنهاء الفاتورة بنجاح.', ...notSaved].join('\n') }
            : 'تم إنهاء الفاتورة بنجاح!'
      )
      setTimeout(() => setToastMessage(null), notSaved.length ? 7000 : 3000)
      setCart([])
      setDiscount(0)
      setManualDiscount(null)
      setAppliedCredit(0)
      setDepositChange('')
      setPaidAmount('')
      setClientName('')
      setClientPhone('')
      setClientAddress('')
      setClientAddressId(null)
      setIsDelivery(false)
      setSelectedClient(null)
      setClientSearchResults([])
      setPaymentType('نقدي')
      if (setUpfrontMethod) setUpfrontMethod('cash')
      try {
        if (fetchStats) fetchStats()
        if (fetchClientsList) fetchClientsList()
        if (fetchClientStats) fetchClientStats()
        if (fetchAdminData)
          fetchAdminData().catch((e) => console.error('Real-time admin sync failed:', e))
      } catch (refreshErr) {
        console.error('Post-checkout background refresh error:', refreshErr)
      }
      setTimeout(() => barcodeInputRef.current?.focus(), 100)
    } catch (e) {
      console.error('[CHECKOUT ERROR]', e)
      playSound('error')
      const errText = String(e?.message || e || '')
      const unknown = attempt && outcomeUnknown(e)
      if (unknown) unresolvedCheckoutRef.current = attempt
      if (!unknown && e.status === 409 && e.details && e.details.total !== undefined) {
        // Discounts or prices changed since the cart was shown: show the new total first.
        refreshPricing()
        triggerCustomAlert(errText, 'تنبيه الفاتورة')
      } else if (unknown) {
        triggerCustomAlert(
          `تعذر التأكد من حفظ الفاتورة: ${errText.slice(0, 200)}\nلا تغيّر السلة. اضغط F1 مرة أخرى بعد عودة الاتصال؛ إذا كانت الفاتورة قد سُجِّلت فلن تُسجَّل مرة ثانية.`
        )
      } else if (errText.includes('وردية مغلقة') || errText.includes('الوردية مغلقة')) {
        triggerCustomAlert(
          'فشل البيع: لا يمكن تسجيل المعاملة لأن الوردية مغلقة.\nيرجى فتح وردية جديدة للبدء.'
        )
      } else if (errText.includes('المخزون')) {
        triggerCustomAlert(
          'فشل البيع: رصيد المخزون لا يكفي لأحد الأصناف في السلة.\nيرجى مراجعة الكميات المطلوبة أو تحديث المخزون.'
        )
      } else if (e.status === 503) {
        triggerCustomAlert(
          `فشلت المعاملة: ${errText}\nلم يتم تسجيل الفاتورة. أعد المحاولة بعد عودة الاتصال.`
        )
      } else {
        triggerCustomAlert(
          `فشلت المعاملة أثناء حفظ الفاتورة!\nالسبب: ${errText.slice(0, 200)}\nيرجى المحاولة مرة أخرى.`
        )
      }
    } finally {
      checkoutPendingRef.current = null
    }
  }

  // Reprint Sale (K-31: the legacy reprint passed the sale under the wrong key and printed no header data)
  const handleReprintSale = async (saleId) => {
    try {
      const { sale: s, items } = await api('sales.reprintData', { saleId })
      const displaySaleId = parseInt(s.id) > 0 ? ((parseInt(s.id) - 1) % 10000) + 1 : '?'
      const when = s.timestamp ? new Date(String(s.timestamp).replace(' ', 'T')) : null
      const lines = items.map((item) => {
        const retQty = item.returned_qty || 0
        const qty = item.quantity || 1
        const isItemReturned = retQty >= qty
        const isItemPartReturned = retQty > 0 && !isItemReturned
        let name = item.product_name || item.name || `باركود ${item.product_barcode || ''}`
        if (item.unit_id) name = `${name} (${item.unit_name})`
        if (isItemReturned) name = `${name} (مرتجع)`
        else if (isItemPartReturned) name = `${name} (مرتجع ${retQty})`
        return {
          name,
          barcode: item.product_barcode,
          qty: receiptQty(isItemReturned ? 0 : isItemPartReturned ? qty - retQty : qty, {
            kind: item.unit_kind,
            unitId: item.unit_id,
            unitName: item.unit_name,
            decimals: kindInfo(item.unit_kind).decimals,
            kindUnit: kindInfo(item.unit_kind).unit
          }),
          price: Number(item.unit_price) || 0,
          total: Number(item.total_price) || 0
        }
      })
      const total = Number(s.total_amount) || 0
      const data = {
        saleId: displaySaleId,
        banner: total === 0 ? '*** فاتورة مرتجعة بالكامل ***' : '*** نسخة معاد طباعتها ***',
        date: when ? when.toLocaleDateString('ar-EG') : '',
        time: when ? ltrText(formatClock(when)) : '',
        cashier: s.username,
        paymentType: s.payment_type || 'نقدي',
        client: { name: s.client_name || '' },
        items: lines,
        subTotal: Number(s.original_amount) || total,
        discount: Number(s.discount) || 0,
        total,
        paid: total,
        change: 0
      }
      if (!noPrint && window.api && window.api.printer && window.api.printer.printSale) {
        window.api.printer
          .printSale(data, { silent: printSilent })
          .then(() => console.log('Historical receipt printed successfully.'))
          .catch((e) => triggerCustomAlert(`فشلت الطباعة: ${e.message}`))
      } else {
        console.log(data)
      }
    } catch (e) {
      triggerCustomAlert('حدث خطأ أثناء محاولة إعادة طباعة الفاتورة: ' + e.message)
    }
  }

  // Client Autocomplete triggers
  const handleClientNameChange = async (val) => {
    setClientName(val)
    setSelectedClient(null)
    setClientAddressId(null)
    if (!val.trim()) {
      setClientSearchResults([])
      return
    }
    try {
      const results = await api('pos.searchClients', { term: val })
      setClientSearchResults(results)
    } catch (e) {
      console.error(e)
    }
  }

  const handleClientPhoneChange = async (val) => {
    setClientPhone(val)
    setSelectedClient(null)
    setClientAddressId(null)
    if (!val.trim()) {
      setClientSearchResults([])
      return
    }
    try {
      const results = await api('pos.searchClients', { term: val })
      setClientSearchResults(results)
    } catch (e) {
      console.error(e)
    }
  }

  const selectClient = (client) => {
    setSelectedClient(client)
    setClientName(client.name)
    setClientPhone(client.phone || '')
    // Saved addresses: the default is preselected for a delivery; the cashier may pick another.
    const saved = Array.isArray(client.addresses) ? client.addresses : []
    const def = saved.find((a) => a.isDefault) || saved[0]
    setClientAddressId(def ? def.id : null)
    setClientAddress(def ? '' : client.address || '')
    setClientSearchResults([])
  }

  return {
    manualDiscount,
    setManualDiscount,
    afterRules,
    appliedDiscounts,
    addProductByBarcode,
    completeSignIn,
    handleStartShift,
    handleConfirmCloseShift,
    closeReport,
    dismissCloseReport: () => {
      setCloseReport(null)
      handleLock()
    },
    handleLock,
    barcodeInput,
    setBarcodeInput,
    handleBarcodeSubmit,
    searchInput,
    setSearchInput,
    handleSearchChange,
    handleSearchKeyDown,
    searchResults,
    setSearchResults,
    selectedSearchIndex,
    setSelectedSearchIndex,
    clientAddress,
    setClientAddress,
    clientAddressId,
    setClientAddressId,
    selectedClient,
    setSelectedClient,
    clientSearchResults,
    setClientSearchResults,
    handleClientNameChange,
    handleClientPhoneChange,
    selectClient,
    handleCheckout,
    handleReprintSale
  }
}
