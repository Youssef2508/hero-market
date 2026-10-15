import { useState, useRef, useEffect } from 'react'
import {
  escapeSql,
  normalizeDigits,
  playSound,
  getNowStr,
  getFriendlyErrorMessage,
  hashPin,
  round2
} from '../lib/utils'
import { executeQuery } from '../lib/db'
import {
  generateReceiptHtml,
  generateReprintHtml,
  generateGrandShiftReportHtml
} from '../lib/printTemplates'
import { logEvent } from '../lib/dao/logs.dao'

/**
 * Custom hook to encapsulate the POS checkout/terminal workflow control logic,
 * including shifts logging, barcode parsing, search suggestions, printing,
 * manager authorization, and SQLite checkout transaction execution.
 */
export function usePOSController({
  currentUser,
  setCurrentUser,
  currentShift,
  setCurrentShift,
  setIsLocked,
  setOpenShiftModal,
  startingCash,
  setStartingCash,
  momknStartBalance,
  momknStartCash,
  vfcashStartBalance,
  vfcashStartCash,
  setCloseShiftModal,
  actualEndCash,
  setManagerApprovalModal,
  managerPin,
  setManagerPin,
  pendingAction,
  setPendingAction,
  rawHandleLock,

  cart,
  setCart,
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
  cartTotal,
  cartSubtotal,
  addToCart,
  updateQty,

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
  parseScaleBarcode,
  setCurrentView
}) {
  const [pin, setPin] = useState('')
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
  const [selectedClient, setSelectedClient] = useState(null)
  const [clientSearchResults, setClientSearchResults] = useState([])

  const handleLock = () => {
    rawHandleLock()
    setCart([])
    setPin('')
    setBarcodeInput('')
    setSearchInput('')
    setSearchResults([])
    setClientName('')
    setClientPhone('')
    setIsDelivery(false)
    setClientAddress('')
    setSelectedClient(null)
    setClientSearchResults([])
    setCurrentView('pos')
  }

  // Pin Authenticator
  const handlePinSubmit = async (customPin = null) => {
    if (customPin && typeof customPin.preventDefault === 'function') {
      customPin.preventDefault()
      customPin = null
    }
    const cleanPin = normalizeDigits(customPin !== null ? customPin : pin)
    try {
      if (!cleanPin) {
        return
      }
      const escapedPin = escapeSql(cleanPin)
      const hashedPin = await hashPin(cleanPin)
      let users = await executeQuery(
        `SELECT * FROM users WHERE (password_hash = '${escapeSql(hashedPin)}' OR password_hash = '${escapedPin}') LIMIT 1;`
      )

      if (users.length > 0) {
        const user = users[0]
        setCurrentUser(user)
        setPin('')

        console.log('[AUTH FLOW] Checking for active open shift for user:', user.username)
        const openShifts = await executeQuery(`
          SELECT * FROM shifts WHERE user_id = ${user.id} AND status = 'open' LIMIT 1;
        `)

        console.log(`[AUTH FLOW] Open shifts query complete. Found: ${openShifts.length}`)
        setIsLocked(false) // Unlock the screen layout
        if (user.role === 'cashier') {
          setCurrentView('pos')
        }
        if (openShifts.length > 0) {
          console.log(`[AUTH FLOW] Resuming open shift: ${JSON.stringify(openShifts[0])}`)
          setCurrentShift(openShifts[0])
          playSound('success')
        } else {
          console.log('[AUTH FLOW] No open shift found. Prompting to open a shift.')
          setCurrentShift(null)
          try {
            setStartingCash('200')
          } catch {
            /* setter unavailable */
          }
          setOpenShiftModal(true)
        }
      } else {
        console.warn(
          `[AUTH FLOW] Authentication failed. No user found with password_hash = '${escapedPin}'`
        )
        playSound('error')
        triggerCustomAlert('رمز الدخول خاطئ، يرجى المحاولة مرة أخرى.')
        setPin('')
      }
    } catch (err) {
      console.error('[AUTH FLOW] Critical exception caught during login:', err)
      triggerCustomAlert('خطأ في قاعدة البيانات: ' + getFriendlyErrorMessage(err))
      playSound('error')
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

      const activeUser = currentUser
      const nowStr = getNowStr()
      await executeQuery(`
        INSERT INTO shifts (user_id, start_time, initial_cash, expected_end_cash, actual_end_cash, status, momkn_start_balance, momkn_start_cash, vfcash_start_balance, vfcash_start_cash)
        VALUES (${activeUser.id}, '${nowStr}', ${startingCashNum}, ${startingCashNum}, 0, 'open', ${momknStartNum}, ${momknCashNum}, ${vfcashStartNum}, ${vfcashCashNum});
      `)

      const latestShift = await executeQuery(`
        SELECT * FROM shifts WHERE user_id = ${activeUser.id} AND status = 'open' ORDER BY id DESC LIMIT 1;
      `)

      if (latestShift.length > 0) {
        await logEvent({
          userId: activeUser.id,
          username: activeUser.username,
          actionType: 'shift_open',
          description: `فتح وردية جديدة بمبلغ بداية ${startingCashNum?.toFixed(2)} ج.م`
        })
        setCurrentShift(latestShift[0])
        setOpenShiftModal(false)
        setIsLocked(false)
        playSound('chime')
      }
    } catch (e) {
      console.error('Failed to open shift:', e)
      playSound('error')
      triggerCustomAlert('فشل فتح الوردية: ' + e.message)
    }
  }

  // Close Active Shift
  const handleConfirmCloseShift = async () => {
    const actual = parseFloat(actualEndCash) || 0
    if (isNaN(actual) || actual < 0) {
      triggerCustomAlert('الرجاء إدخال مبلغ صحيح.')
      return
    }

    try {
      const combinedRes = await executeQuery(`
        SELECT 
          (SELECT IFNULL(SUM(COALESCE(NULLIF(original_amount, 0) - discount, total_amount)), 0) FROM sales WHERE shift_id = ${currentShift.id}) as salesTotal,
          (SELECT IFNULL(SUM(COALESCE(NULLIF(original_amount, 0) - discount, total_amount)), 0) FROM sales WHERE shift_id = ${currentShift.id} AND payment_type = 'آجل') as debtSales,
          (SELECT IFNULL(SUM(COALESCE(NULLIF(original_amount, 0) - discount, total_amount)), 0) FROM sales WHERE shift_id = ${currentShift.id} AND payment_type NOT IN ('نقدي', 'آجل')) as digitalSales,
          (SELECT IFNULL(SUM(COALESCE(NULLIF(original_amount, 0) - discount, total_amount)), 0) FROM sales WHERE shift_id = ${currentShift.id} AND payment_type = 'نقدي') as cashSales,
          (SELECT IFNULL(SUM(amount), 0) FROM safe_ledger WHERE shift_id = ${currentShift.id} AND type = 'inflow') as repayTotal,
          (SELECT IFNULL(SUM(amount), 0) FROM safe_ledger WHERE shift_id = ${currentShift.id} AND type = 'outflow' AND (description LIKE 'مرتجع%')) as returnsTotal,
          (SELECT IFNULL(SUM(amount), 0) FROM safe_ledger WHERE shift_id = ${currentShift.id} AND type = 'outflow' AND (description LIKE 'دفعة لمورد%' OR description LIKE 'سداد دين مورد%')) as supplierTotal,
          (SELECT IFNULL(SUM(amount), 0) FROM safe_ledger WHERE shift_id = ${currentShift.id} AND type = 'outflow' AND (description NOT LIKE 'مرتجع%' AND description NOT LIKE 'دفعة لمورد%' AND description NOT LIKE 'سداد دين مورد%')) as expensesTotal,
          (SELECT IFNULL(SUM(cash_impact), 0) FROM momkn_transactions WHERE shift_id = ${currentShift.id}) as momknCashImpact,
          (SELECT IFNULL(SUM(cash_impact), 0) FROM mobile_money_transactions WHERE shift_id = ${currentShift.id}) as mobileMoneyCashImpact;
      `)

      const r = combinedRes[0] || {}
      const initialCash = currentShift.initial_cash || 0
      const cashSales = parseFloat(r.cashSales) || 0
      const inflow = parseFloat(r.repayTotal) || 0
      const returns = parseFloat(r.returnsTotal) || 0
      const supplierOutflow = parseFloat(r.supplierTotal) || 0
      const generalOutflow = parseFloat(r.expensesTotal) || 0

      const expectedMainCash =
        initialCash + cashSales + inflow - (returns + supplierOutflow + generalOutflow)

      const expected = expectedMainCash

      const d = {
        cashSales,
        inflow,
        outflow: returns + supplierOutflow + generalOutflow
      }

      const difference = actual - expected
      const nowStr = getNowStr()

      const finalizeShiftClose = async () => {
        try {
          await executeQuery(`
            UPDATE shifts 
            SET end_time = '${nowStr}', expected_end_cash = ${expected}, actual_end_cash = ${actual}, difference = ${difference}, status = 'closed'
            WHERE id = ${currentShift.id};
          `)
          await logEvent({
            userId: currentUser?.id,
            username: currentUser?.username,
            actionType: 'shift_close',
            description: `إغلاق الوردية رقم #${currentShift.id} (الفعلي: ${actual?.toFixed(2)} ج.م، المتوقع: ${expected?.toFixed(2)} ج.م، الفرق: ${difference?.toFixed(2)} ج.م)`
          })

          // Trigger print report automatically!
          if (window.api && window.api.printer && window.api.printer.print) {
            try {
              const momknRes = await executeQuery(`
                SELECT 
                  COALESCE((SELECT SUM(digital_impact) FROM momkn_transactions WHERE shift_id=${currentShift.id}), 0) as digitalImpact,
                  COALESCE((SELECT SUM(cash_impact) FROM momkn_transactions WHERE shift_id=${currentShift.id}), 0) as cashImpact,
                  COALESCE((SELECT SUM(commission) FROM momkn_transactions WHERE shift_id=${currentShift.id}), 0) as commission
              `)
              const mmRes = await executeQuery(`
                SELECT 
                  COALESCE((SELECT SUM(digital_impact) FROM mobile_money_transactions WHERE shift_id=${currentShift.id}), 0) as digitalImpact,
                  COALESCE((SELECT SUM(cash_impact) FROM mobile_money_transactions WHERE shift_id=${currentShift.id}), 0) as cashImpact,
                  COALESCE((SELECT SUM(commission) FROM mobile_money_transactions WHERE shift_id=${currentShift.id}), 0) as commission,
                  COALESCE((SELECT SUM(digital_impact) FROM mobile_money_transactions WHERE shift_id=${currentShift.id} AND platform='vodafone_cash'), 0) as vfcashDigitalImpact,
                  COALESCE((SELECT SUM(digital_impact) FROM mobile_money_transactions WHERE shift_id=${currentShift.id} AND platform='instapay'), 0) as instapayDigitalImpact,
                  COALESCE((SELECT SUM(digital_impact) FROM mobile_money_transactions WHERE shift_id=${currentShift.id} AND platform='bank_transfer'), 0) as bankDigitalImpact
              `)

              const mSum = momknRes[0] || {}
              const mmSum = mmRes[0] || {}

              const momknSummary = {
                expectedDigitalBalance:
                  (currentShift.momkn_start_balance || 0) + (parseFloat(mSum.digitalImpact) || 0),
                totalCashImpact: parseFloat(mSum.cashImpact) || 0,
                totalCommission: parseFloat(mSum.commission) || 0,
                startBalance: currentShift.momkn_start_balance || 0
              }

              const mobileMoneySummary = {
                expectedVfcashDigitalBalance:
                  (currentShift.vfcash_start_balance || 0) +
                  (parseFloat(mmSum.vfcashDigitalImpact) || 0),
                expectedInstapayDigitalBalance: parseFloat(mmSum.instapayDigitalImpact) || 0,
                expectedBankDigitalBalance: parseFloat(mmSum.bankDigitalImpact) || 0,
                totalCashImpact: parseFloat(mmSum.cashImpact) || 0,
                totalCommission: parseFloat(mmSum.commission) || 0,
                startBalance: currentShift.vfcash_start_balance || 0
              }

              const html = generateGrandShiftReportHtml({
                shift: { ...currentShift, username: currentUser?.username },
                salesTotal: d.cashSales,
                repayTotal: d.inflow,
                refundTotal: d.outflow,
                momknSummary,
                mobileMoneySummary,
                actualCash: actual,
                expectedCash: expected,
                difference
              })

              await window.api.printer.print(html)
            } catch (printErr) {
              console.error('Failed to print grand shift report:', printErr)
            }
          }

          playSound('chime')
          handleLock()
          setCloseShiftModal(false)
        } catch (e) {
          console.error('Failed to close shift in DB:', e)
          playSound('error')
        }
      }

      // Prompt for database backup
      triggerCustomConfirm(
        'هل تريد أخذ نسخة احتياطية من قاعدة البيانات الآن قبل إغلاق الوردية؟',
        async () => {
          if (window.api && window.api.db && window.api.db.backup) {
            const backupRes = await window.api.db.backup()
            if (backupRes && backupRes.success) {
              await logEvent({
                userId: currentUser?.id,
                username: currentUser?.username,
                actionType: 'database_backup',
                description: `أخذ نسخة احتياطية من قاعدة البيانات بنجاح في: ${backupRes.filePath}`
              })
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

  // Handle Barcode Scanner Form Submit
  const handleBarcodeSubmit = async (e) => {
    if (e) e.preventDefault()
    if (!barcodeInput) return

    let rawInput = barcodeInput.trim()
    const cleanRaw = escapeSql(rawInput)
    // Declared here (not inside the else-branch) because the suffix lookup below reads it.
    let parsed = { isWeighted: false, barcode: rawInput }
    try {
      let product = null

      // Try exact match, stripped leading zeros, or padded leading zero
      const cleanRawStripped = cleanRaw.replace(/^0+/, '')
      const cleanRawPadded = '0' + cleanRaw
      const exactProducts = await executeQuery(`
        SELECT * FROM products 
        WHERE barcode = '${cleanRaw}' 
           OR barcode = '${cleanRawStripped}' 
           OR barcode = '${cleanRawPadded}' 
        LIMIT 1;
      `)
      if (exactProducts.length > 0) {
        product = exactProducts[0]
      } else {
        // If no exact match, check weighted scale barcode parsing
        parsed = parseScaleBarcode(rawInput)
        const lookupProduct = async (p) => {
          if (p.isWeighted) {
            const code = escapeSql(p.barcode)
            const cleanCode = escapeSql(String(p.barcode || '').replace(/^0+/, ''))
            const products = await executeQuery(`
              SELECT * FROM products 
              WHERE barcode = '${code}' OR barcode = '${cleanCode}' 
              LIMIT 1;
            `)
            if (products.length > 0) {
              const item = products[0]
              let forcedQty = p.qty
              if (p.isPriceEmbedded && p.totalPrice && parseFloat(item.retail_price) > 0) {
                forcedQty = round2(p.totalPrice / parseFloat(item.retail_price))
              }
              return { ...item, forcedQty: forcedQty > 0 ? forcedQty : 1 }
            }
            return null
          } else {
            const code = escapeSql(p.barcode)
            const codeStripped = code.replace(/^0+/, '')
            const codePadded = '0' + code
            const products = await executeQuery(`
              SELECT * FROM products 
              WHERE barcode = '${code}' 
                 OR barcode = '${codeStripped}' 
                 OR barcode = '${codePadded}' 
              LIMIT 1;
            `)
            return products.length > 0 ? products[0] : null
          }
        }

        product = await lookupProduct(parsed)
      }

      if (!product && !parsed.isWeighted && rawInput.length >= 6 && rawInput.length <= 12) {
        const escaped = escapeSql(rawInput)
        const candidates = await executeQuery(`
          SELECT * FROM products
          WHERE barcode LIKE '%${escaped}'
          LIMIT 5;
        `)
        if (candidates.length === 1) {
          product = candidates[0]
        } else if (candidates.length > 1) {
          setSearchResults(candidates)
          setBarcodeInput('')
          return
        }
      }

      if (product) {
        addToCart(product, product.forcedQty)
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
      console.error('Barcode lookup error:', err)
      playSound('error')
    }
  }

  // Manager Authentication
  const handleManagerAuthSubmit = async (e) => {
    if (e) e.preventDefault()
    if (!managerPin) return

    try {
      const escapedPin = escapeSql(managerPin)
      const hashedPin = await hashPin(managerPin)
      let managers = await executeQuery(`
        SELECT * FROM users
        WHERE (password_hash = '${escapeSql(hashedPin)}' OR password_hash = '${escapedPin}') AND (role = 'admin' OR role = 'manager')
        LIMIT 1;
      `)

      if (managers.length > 0) {
        playSound('success')
        if (pendingAction.type === 'DELETE_ITEM') {
          setCart((prev) => prev.filter((item) => item.barcode !== pendingAction.payload))
        } else if (pendingAction.type === 'QTY_REDUCTION') {
          updateQty(pendingAction.payload.barcode, pendingAction.payload.qty)
        } else if (pendingAction.type === 'CLEAR_CART') {
          setCart([])
          setDiscount(0)
          setPaidAmount('')
        }
        setManagerApprovalModal(false)
        setPendingAction(null)
      } else {
        playSound('error')
        triggerCustomAlert('رمز التحقق للمشرف غير صحيح! العملية مرفوضة.')
        setManagerPin('')
      }
    } catch (err) {
      console.error('Manager auth error:', err)
      playSound('error')
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
        const escaped = escapeSql(val)
        const results = await executeQuery(`
          SELECT * FROM products 
          WHERE name LIKE '%${escaped}%' OR barcode LIKE '%${escaped}%'
          LIMIT 8;
        `)
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
        addToCart(targetItem)
        setSearchInput('')
        setSearchResults([])
        setSelectedSearchIndex(-1)
        barcodeInputRef.current?.focus()
      }
    }
  }

  // Checkout Receipt generator & DB commit
  const handleCheckout = async () => {
    if (cart.length === 0) {
      playSound('error')
      triggerCustomAlert('السلة فارغة! يرجى إضافة سلع أولاً.', 'تنبيه الفاتورة')
      return
    }

    if (!currentShift || !currentShift.id || currentShift.status !== 'open') {
      playSound('error')
      triggerCustomAlert(
        'فشل البيع: لا توجد وردية كاشير مفتوحة حالياً!\nيرجى فتح وردية جديدة أولاً لبدء عمليات البيع.',
        'تنبيه الوردية'
      )
      return
    }

    try {
      const nowStr = getNowStr()
      const finalDiscount = parseFloat(discount) || 0

      let clientId = null
      if (clientName) {
        if (selectedClient) {
          clientId = selectedClient.id
        } else {
          const searchQ = clientPhone
            ? `SELECT * FROM clients WHERE name = '${escapeSql(clientName)}' OR phone = '${escapeSql(clientPhone)}' LIMIT 1;`
            : `SELECT * FROM clients WHERE name = '${escapeSql(clientName)}' LIMIT 1;`
          const existing = await executeQuery(searchQ)
          if (existing && existing.length > 0) {
            clientId = existing[0].id
          } else {
            const phoneForInsert =
              clientPhone && clientPhone.trim() ? `'${escapeSql(clientPhone.trim())}'` : 'NULL'
            await executeQuery(`
              INSERT INTO clients (name, phone, address, debt_balance, points, created_at)
              VALUES ('${escapeSql(clientName)}', ${phoneForInsert}, '${escapeSql(clientAddress)}', 0.0, 0, '${nowStr}');
            `)
            const newClientRes = await executeQuery(`SELECT MAX(id) as id FROM clients;`)
            clientId = newClientRes?.[0]?.id || null
          }
        }
      }

      let clientDbValue = clientName
      if (clientName) {
        if (clientPhone) clientDbValue += ` (${clientPhone})`
        if (isDelivery && clientAddress) clientDbValue += ` - ${clientAddress}`
      }

      let sqlQuery = 'BEGIN TRANSACTION;\n'
      sqlQuery += `INSERT INTO sales (shift_id, timestamp, total_amount, original_amount, discount, payment_type, client_name, client_id) VALUES (${currentShift.id}, '${nowStr}', ${cartTotal}, ${cartSubtotal || cartTotal}, ${finalDiscount}, '${escapeSql(paymentType)}', '${escapeSql(clientDbValue)}', ${clientId || 'NULL'});\n`

      cart.forEach((item) => {
        sqlQuery += `INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, cost_price) VALUES ((SELECT MAX(id) FROM sales LIMIT 1), '${escapeSql(item.barcode)}', ${item.qty}, ${item.price}, ${item.total}, ${item.cost_price || 0.0});\n`
        sqlQuery += `UPDATE products SET stock_qty = stock_qty - ${item.qty} WHERE barcode = '${escapeSql(item.barcode)}';\n`
      })

      if (clientId) {
        const pointsEarned = Math.floor(cartTotal / 100)
        sqlQuery += `UPDATE clients SET points = points + ${pointsEarned} WHERE id = ${clientId};\n`
        if (paymentType === 'آجل') {
          sqlQuery += `UPDATE clients SET debt_balance = debt_balance + ${cartTotal} WHERE id = ${clientId};\n`
          sqlQuery += `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES (${clientId}, 'sale', ${cartTotal}, 'شراء آجل فاتورة رقم #' || (SELECT MAX(id) FROM sales LIMIT 1), '${nowStr}');\n`
        } else if (paymentType === 'دفع جزئي') {
          const upfrontPaid = Math.min(cartTotal, Math.max(0, parseFloat(paidAmount) || 0))
          const remainingDebt = Math.max(0, cartTotal - upfrontPaid)
          if (remainingDebt > 0) {
            sqlQuery += `UPDATE clients SET debt_balance = debt_balance + ${remainingDebt} WHERE id = ${clientId};\n`
            sqlQuery += `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES (${clientId}, 'sale', ${remainingDebt}, 'متبقي بيع دفع جزئي فاتورة رقم #' || (SELECT MAX(id) FROM sales LIMIT 1), '${nowStr}');\n`
          }
          if (upfrontPaid > 0) {
            sqlQuery += `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (${currentShift.id}, 'inflow', ${upfrontPaid}, 'مقدم نقدي بيع دفع جزئي فاتورة رقم #' || (SELECT MAX(id) FROM sales LIMIT 1), '${nowStr}');\n`
          }
        }

        // استهلاك الرصيد كخصم (إذا تم استخدامه)
        if (parseFloat(appliedCredit) > 0) {
          sqlQuery += `UPDATE clients SET debt_balance = debt_balance + ${parseFloat(appliedCredit)} WHERE id = ${clientId};\n`
          sqlQuery += `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES (${clientId}, 'sale', ${parseFloat(appliedCredit)}, 'استهلاك رصيد كخصم في فاتورة رقم #' || (SELECT MAX(id) FROM sales LIMIT 1), '${nowStr}');\n`
        }

        // حفظ الباقي في رصيد العميل (إذا تم تحديده والـ paidAmount أكبر من الصافي)
        const changeVal = paidAmount ? Math.max(0, (parseFloat(paidAmount) || 0) - cartTotal) : 0
        const depositVal = Math.min(parseFloat(depositChange) || 0, changeVal)
        if (depositVal > 0) {
          sqlQuery += `UPDATE clients SET debt_balance = debt_balance - ${depositVal} WHERE id = ${clientId};\n`
          sqlQuery += `INSERT INTO client_ledger (client_id, type, amount, description, timestamp) VALUES (${clientId}, 'payment', ${depositVal}, 'حفظ الباقي نقدي رصيد في فاتورة رقم #' || (SELECT MAX(id) FROM sales LIMIT 1), '${nowStr}');\n`
        }
      }

      sqlQuery += 'COMMIT;\n'
      await executeQuery(sqlQuery)

      await logEvent({
        userId: currentUser?.id,
        username: currentUser?.username,
        actionType: 'checkout_sale',
        description: `إتمام عملية بيع فاتورة بقيمة ${cartTotal?.toFixed(2)} ج.م (طريقة الدفع: ${paymentType})`
      })

      const saleResult = await executeQuery(`SELECT id FROM sales ORDER BY id DESC LIMIT 1;`)
      const rawSaleId =
        saleResult && saleResult.length > 0 && saleResult[0]
          ? saleResult[0].id || saleResult[0].ID || 0
          : 0
      const displaySaleId = parseInt(rawSaleId) > 0 ? rawSaleId : '—'

      playSound('chime')

      const datePart = new Date().toLocaleDateString('ar-EG')
      const timePart = new Date().toLocaleTimeString('ar-EG')

      const receiptHtml = generateReceiptHtml({
        storeName: 'هيرو ماركت',
        branchName: 'الفرع الرئيسي',
        displaySaleId,
        datePart,
        timePart,
        currentUser,
        clientName,
        clientPhone,
        clientAddress,
        cart,
        cartTotal,
        finalDiscount,
        paidAmount: paidAmount ? parseFloat(paidAmount) || cartTotal : cartTotal,
        changeRemaining: paidAmount ? Math.max(0, (parseFloat(paidAmount) || 0) - cartTotal) : 0,
        paymentType: paymentType || 'نقدي'
      })

      if (!noPrint && window.api && window.api.printer && window.api.printer.print) {
        console.log(
          '[PRINT FLOW] Invoking printer.print with HTML content length:',
          receiptHtml.length,
          'mode silent:',
          printSilent
        )
        window.api.printer
          .print(receiptHtml, { silent: printSilent })
          .then(() => console.log('[PRINT FLOW] Receipt printed successfully on Citizen CT-S300.'))
          .catch((e) => {
            console.error('[PRINT FLOW] Printing failed:', e)
            triggerCustomAlert(
              `تنبيه: فشلت عملية الطباعة المباشرة!\nالسبب: ${getFriendlyErrorMessage(e)}\nيرجى التحقق من اتصال الطابعة والتعريف.`
            )
          })
      }

      setToastMessage('تم إنهاء الفاتورة بنجاح!')
      setTimeout(() => setToastMessage(null), 3000)
      setCart([])
      setDiscount(0)
      setAppliedCredit(0)
      setDepositChange('')
      setPaidAmount('')
      setClientName('')
      setClientPhone('')
      setClientAddress('')
      setIsDelivery(false)
      setSelectedClient(null)
      setClientSearchResults([])
      setPaymentType('نقدي')
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
      if (
        errText.includes('وردية مغلقة') ||
        errText.includes('closed') ||
        errText.includes('prevent_sale_on_closed_shift')
      ) {
        triggerCustomAlert(
          'فشل البيع: لا يمكن تسجيل المعاملة لأن الوردية مغلقة.\nيرجى فتح وردية جديدة للبدء.'
        )
      } else if (errText.includes('stock') || errText.includes('المخزون')) {
        triggerCustomAlert(
          'فشل البيع: رصيد المخزون لا يكفي لأحد الأصناف في السلة.\nيرجى مراجعة الكميات المطلوبة أو تحديث المخزون.'
        )
      } else if (errText.includes('busy') || errText.includes('locked')) {
        triggerCustomAlert(
          'فشلت المعاملة: قاعدة البيانات مشغولة مؤقتاً.\nيرجى إعادة المحاولة فوراً.'
        )
      } else {
        const friendly = getFriendlyErrorMessage(e)
        triggerCustomAlert(
          `فشلت المعاملة أثناء حفظ الفاتورة!\nالسبب: ${friendly || errText.slice(0, 120)}\nيرجى المحاولة مرة أخرى.`
        )
      }
    }
  }

  // Reprint Sale
  const handleReprintSale = async (saleId) => {
    try {
      const sale = await executeQuery(`
        SELECT s.*, u.username 
        FROM sales s
        JOIN shifts sh ON s.shift_id = sh.id
        JOIN users u ON sh.user_id = u.id
        WHERE s.id = ${saleId} LIMIT 1;
      `)
      if (!sale || sale.length === 0) {
        triggerCustomAlert('لم يتم العثور على الفاتورة!')
        return
      }
      const s = sale[0]
      const items = await executeQuery(`
        SELECT si.*, p.name 
        FROM sale_items si
        LEFT JOIN products p ON si.product_barcode = p.barcode
        WHERE si.sale_id = ${saleId};
      `)

      const displaySaleId = parseInt(s.id) > 0 ? ((parseInt(s.id) - 1) % 10000) + 1 : '?'
      const receiptHtml = generateReprintHtml({
        sale: {
          ...s,
          id: displaySaleId
        },
        items: items
      })

      if (!noPrint && window.api && window.api.printer && window.api.printer.print) {
        window.api.printer
          .print(receiptHtml, { silent: printSilent })
          .then(() => console.log('Historical receipt printed successfully.'))
          .catch((e) => triggerCustomAlert(`فشلت الطباعة: ${getFriendlyErrorMessage(e)}`))
      } else {
        console.log(receiptHtml)
      }
    } catch (e) {
      triggerCustomAlert('حدث خطأ أثناء محاولة إعادة طباعة الفاتورة: ' + getFriendlyErrorMessage(e))
    }
  }

  // Client Autocomplete triggers
  const handleClientNameChange = async (val) => {
    setClientName(val)
    setSelectedClient(null)
    if (!val.trim()) {
      setClientSearchResults([])
      return
    }
    try {
      const results = await executeQuery(`
        SELECT * FROM clients 
        WHERE name LIKE '%${escapeSql(val)}%' OR phone LIKE '%${escapeSql(val)}%' 
        LIMIT 5;
      `)
      setClientSearchResults(results)
    } catch (e) {
      console.error(e)
    }
  }

  const handleClientPhoneChange = async (val) => {
    setClientPhone(val)
    setSelectedClient(null)
    if (!val.trim()) {
      setClientSearchResults([])
      return
    }
    try {
      const results = await executeQuery(`
        SELECT * FROM clients 
        WHERE phone LIKE '%${escapeSql(val)}%' OR name LIKE '%${escapeSql(val)}%' 
        LIMIT 5;
      `)
      setClientSearchResults(results)
    } catch (e) {
      console.error(e)
    }
  }

  const selectClient = (client) => {
    setSelectedClient(client)
    setClientName(client.name)
    setClientPhone(client.phone || '')
    setClientAddress(client.address || '')
    setClientSearchResults([])
  }

  return {
    pin,
    setPin,
    handlePinSubmit,
    handleStartShift,
    handleConfirmCloseShift,
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
    selectedClient,
    setSelectedClient,
    clientSearchResults,
    setClientSearchResults,
    handleClientNameChange,
    handleClientPhoneChange,
    selectClient,
    handleManagerAuthSubmit,
    handleCheckout,
    handleReprintSale
  }
}
