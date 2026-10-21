import { useEffect, useRef, useState } from 'react'
import {
  ScanBarcode,
  Search,
  Trash2,
  Minus,
  Plus,
  X,
  Banknote,
  CreditCard,
  Smartphone,
  ArrowLeftRight,
  BookOpen,
  Split,
  CircleCheck,
  Printer,
  PrinterX,
  TriangleAlert,
  FileDown,
  ShoppingBasket,
  UserRound,
  Phone,
  MapPin,
  PiggyBank,
  CornerDownLeft,
  Info,
  Undo2,
  FolderTree,
  List
} from 'lucide-react'
import { Kbd } from '../ui'
import CategoryBrowser from './CategoryBrowser'
import { ADDRESS_LABELS } from '../../../../shared/address.mjs'
import WeightEntryModal from './WeightEntryModal'
import { formatMoney } from '../../lib/utils'
import { api } from '../../lib/api'
import { kindInfo } from '../../lib/measureKinds'
import { qtyFromText } from '../../lib/qtyText'
import ManualDiscountModal from './ManualDiscountModal'

// Payment types are business values written to sales.payment_type – do not rename. The payment
// methods are cash, Visa, wallet and InstaPay (owner, 2026-10-21, D-061); آجل and دفع جزئي put the
// unpaid part on the customer's account.
const PAYMENT_METHODS = [
  { value: 'نقدي', label: 'نقدي', icon: Banknote },
  { value: 'فيزا', label: 'فيزا', icon: CreditCard },
  { value: 'محفظة', label: 'محفظة', icon: Smartphone },
  { value: 'انستا باي', label: 'انستا باي', icon: ArrowLeftRight },
  { value: 'آجل', label: 'آجل', icon: BookOpen, needsClient: true },
  { value: 'دفع جزئي', label: 'دفع جزئي', icon: Split, needsClient: true }
]

const money = (n) => formatMoney(n)

function ShortagesButton({ dbStats, onPrint, onPdf }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const count = dbStats.lowStock || 0

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    // Esc closes the popover instead of reaching the global Esc (clear cart) shortcut.
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-overlay')) return
      setOpen(false)
      // Esc typed in a field with text keeps its own meaning (e.g. the F2 search box).
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.value) return
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="shortages" ref={ref}>
      <button
        type="button"
        className={`btn btn-sm ${count > 0 ? 'btn-warning-soft' : 'btn-ghost'}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="الأصناف تحت حد الطلب"
      >
        <TriangleAlert size={15} aria-hidden="true" />
        النواقص
        <span className="count-pill num">{count}</span>
      </button>
      {open && (
        <div className="popover shortages-popover" role="dialog" aria-label="نواقص المخزون">
          <div className="shortages-head">
            <strong>نواقص المخزون</strong>
            <span className="text-muted num">{count} صنف</span>
          </div>
          {count > 0 ? (
            <>
              <ul className="shortages-list">
                {dbStats.lowStockItems?.map((item, idx) => (
                  <li key={idx}>
                    <span className="text-ellipsis">{item.name}</span>
                    <span className="num text-danger">
                      {item.stock_qty} / {item.reorder_limit} {item.unit}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="shortages-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={onPrint}>
                  <Printer size={15} aria-hidden="true" />
                  طباعة على الطابعة
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onPdf}>
                  <FileDown size={15} aria-hidden="true" />
                  تصدير PDF
                </button>
              </div>
            </>
          ) : (
            <p className="shortages-ok">مستويات المخزون آمنة حالياً.</p>
          )}
        </div>
      )}
    </div>
  )
}

// Quantity box of a cart line (POS-01). The typed text is kept while typing, so "0", "0." and
// "0.5" can be typed (the box used to snap back to the cart value at "0"). A valid quantity reaches
// the cart at once; on leaving the box, "0" removes the line (as before) and anything invalid goes
// back to the last valid quantity.
function QtyInput({ item, inputRef, onQty, onZero }) {
  const [text, setText] = useState(String(item.qty))
  const focused = useRef(false)
  // The cart changed from elsewhere (stepper, another scan): show it unless the user is typing.
  useEffect(() => {
    if (!focused.current) setText(String(item.qty))
  }, [item.qty])
  return (
    <input
      type="text"
      inputMode="decimal"
      className="qty-input num"
      value={text}
      ref={inputRef}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setText(e.target.value)
        const { value } = qtyFromText(e.target.value)
        if (value !== null) onQty(value)
      }}
      onBlur={() => {
        focused.current = false
        const { value, zero } = qtyFromText(text)
        if (zero) onZero()
        else if (value === null) setText(String(item.qty))
      }}
      aria-label={`كمية ${item.name}`}
    />
  )
}

function CheckoutTerminal({
  cart,
  triggerClearCart,
  onReturn,
  addByBarcode,
  qtyInputRefs,
  handleQtyChangeAttempt,
  changeLineUnit,
  pendingWeight,
  confirmWeight,
  editWeight,
  triggerDeleteItem,
  cartSubtotal,
  discount,
  appliedDiscounts = [],
  canManualDiscount = false,
  manualDiscount = null,
  setManualDiscount,
  afterRules = 0,
  paidAmount,
  setPaidAmount,
  changeRemaining,
  isDelivery,
  setIsDelivery,
  clientName,
  handleClientNameChange,
  clientPhone,
  setClientPhone,
  handleClientPhoneChange,
  clientAddress,
  setClientAddress,
  clientAddressId,
  setClientAddressId,
  clientSearchResults,
  selectClient,
  paymentType,
  setPaymentType,
  cartTotal,
  handleCheckout,
  barcodeInputRef,
  barcodeInput,
  setBarcodeInput,
  handleBarcodeSubmit,
  dbStats,
  searchInputRef,
  searchInput,
  handleSearchChange,
  handleSearchKeyDown,
  searchResults,
  selectedSearchIndex,
  addToCart,
  setSearchInput,
  setSearchResults,
  setSelectedSearchIndex,
  noPrint,
  setNoPrint,
  depositChange,
  setDepositChange,
  appliedCredit,
  setAppliedCredit,
  selectedClient,
  triggerCustomAlert
}) {
  // Saved numbers of the selected customer (pick one; "رقم آخر" types a new one for this order).
  const savedPhones = selectedClient
    ? [selectedClient.phone, selectedClient.phone2].filter(Boolean)
    : []
  // "Another number…" belongs to the customer it was chosen for: picking another customer resets it.
  const [typingPhoneFor, setTypingPhoneFor] = useState(null)
  const typingPhone = selectedClient != null && typingPhoneFor === selectedClient.id

  // Before payment, say whether a new number or address will be kept on the customer (owner rule:
  // a number of another customer, a third number or a fourth address serve this order only).
  const phoneKey =
    selectedClient && typingPhone && clientPhone.trim()
      ? `${selectedClient.id}|${clientPhone.trim()}`
      : null
  const [phoneCheck, setPhoneCheck] = useState(null)
  useEffect(() => {
    if (!phoneKey) return
    let alive = true
    const [id, phone] = [Number(phoneKey.split('|')[0]), phoneKey.slice(phoneKey.indexOf('|') + 1)]
    const timer = setTimeout(() => {
      api('pos.phoneOwner', { phone, clientId: id }).then(
        (r) => alive && setPhoneCheck({ ...r, key: phoneKey }),
        () => {}
      )
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [phoneKey])
  const phoneInfo =
    phoneCheck && phoneCheck.key === phoneKey && phoneCheck.valid ? phoneCheck : null
  const phoneNote =
    !phoneInfo || phoneInfo.savedHere
      ? null
      : phoneInfo.otherCustomer
        ? {
            warn: true,
            text: 'هذا الرقم مسجَّل لعميل آخر: سيُستخدم لهذا الطلب فقط ولن يُحفظ لهذا العميل.'
          }
        : !phoneInfo.freeSlot
          ? {
              warn: true,
              text: 'للعميل رقمان محفوظان: سيُستخدم هذا الرقم لهذا الطلب فقط ولن يُحفظ.'
            }
          : { warn: false, text: 'سيُحفظ الرقم الجديد للعميل ليظهر في الطلبات القادمة.' }
  const savedAddresses = selectedClient?.addresses || []
  const typedAddress =
    isDelivery && selectedClient && !clientAddressId ? (clientAddress || '').trim() : ''
  const addressIsSaved =
    !!typedAddress &&
    savedAddresses.some((a) => a.address.trim().toLowerCase() === typedAddress.toLowerCase())
  const addressNote =
    !typedAddress || addressIsSaved
      ? null
      : savedAddresses.length >= 3
        ? {
            warn: true,
            text: 'للعميل 3 عناوين محفوظة: سيُستخدم هذا العنوان لهذا الطلب فقط ولن يُحفظ.'
          }
        : { warn: false, text: 'سيُحفظ العنوان الجديد للعميل ليظهر في الطلبات القادمة.' }
  // Category browsing panel (1.4.0). F6 opens/closes it; the cart stays as it is.
  const [browsing, setBrowsing] = useState(false)
  // Manual invoice discount window (D-057).
  const [manualOpen, setManualOpen] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F6' && !document.querySelector('.modal-overlay')) {
        e.preventDefault()
        setBrowsing((b) => !b)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rowRefs = useRef({})
  const prevCartRef = useRef(cart)
  const resultsRef = useRef(null)

  // Brief highlight + scroll for the line that was just added or incremented.
  useEffect(() => {
    const prev = prevCartRef.current
    prevCartRef.current = cart
    if (cart.length === 0 || cart === prev) return
    const prevQty = Object.fromEntries(prev.map((i) => [i.key, i.qty]))
    const changed = cart.find((i) => prevQty[i.key] === undefined || i.qty > prevQty[i.key])
    const row = changed && rowRefs.current[changed.key]
    if (!row) return
    row.scrollIntoView({ block: 'nearest' })
    if (row.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      row.animate(
        [{ backgroundColor: 'var(--accent-soft-hover)' }, { backgroundColor: 'transparent' }],
        { duration: 900, easing: 'ease-out' }
      )
    }
  }, [cart])

  // Keep the keyboard-selected search result visible.
  useEffect(() => {
    if (selectedSearchIndex < 0 || !resultsRef.current) return
    resultsRef.current
      .querySelectorAll('.result-item')
      [selectedSearchIndex]?.scrollIntoView({ block: 'nearest' })
  }, [selectedSearchIndex])

  const shortageItems = () =>
    (dbStats.lowStockItems || []).map((item) => ({
      name: item.name,
      stock_qty: item.stock_qty,
      min_limit: item.reorder_limit
    }))

  const handlePrintShortages = async () => {
    if (!dbStats.lowStockItems || dbStats.lowStockItems.length === 0) return
    try {
      await window.api.generateShortagesPdf(shortageItems())
    } catch (e) {
      console.error('PDF export error:', e)
    }
  }

  const handlePrintShortagesToPaper = async () => {
    if (!dbStats.lowStockItems || dbStats.lowStockItems.length === 0) return
    try {
      await window.api.printShortagesToPrinter(shortageItems())
    } catch (e) {
      console.error('Direct print error:', e)
    }
  }

  const choosePayment = (method) => {
    if (method.needsClient && !clientName.trim()) {
      if (triggerCustomAlert) {
        triggerCustomAlert(
          method.value === 'آجل'
            ? 'يرجى تحديد العميل أولاً لإجراء عملية بيع آجل!'
            : 'يرجى تحديد العميل أولاً لإجراء عملية دفع جزئي!',
          method.value === 'آجل' ? 'تنبيه البيع الآجل' : 'تنبيه الدفع الجزئي'
        )
      }
      return
    }
    setPaymentType(method.value)
  }

  const pickResult = (item) => {
    addToCart(item)
    setSearchInput('')
    setSearchResults([])
    setSelectedSearchIndex(-1)
    barcodeInputRef.current?.focus()
  }

  // Weighed lines step by 100 g (kinds with decimals by 0.1); pieces and packages by one.
  const stepOf = (item) => (kindInfo(item.kind).decimals > 0 && !item.unitId ? 0.1 : 1)
  const stepQty = (item, delta) => {
    const next = Math.round((item.qty + delta * stepOf(item)) * 1000) / 1000
    if (next > 0) handleQtyChangeAttempt(item.key, String(next))
  }

  // Several products end with the scanned digits: the list is open while the search box is empty.
  const candidatesOpen = !searchInput && searchResults.length > 0
  const closeCandidates = () => {
    setSearchResults([])
    setSelectedSearchIndex(-1)
    barcodeInputRef.current?.focus()
  }
  useEffect(() => {
    if (!candidatesOpen) return undefined
    // Esc closes the list instead of reaching the global Esc (clear cart) shortcut.
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-overlay')) {
        e.preventDefault()
        e.stopPropagation()
        setSearchResults([])
        setSelectedSearchIndex(-1)
        barcodeInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [candidatesOpen, setSearchResults, setSelectedSearchIndex, barcodeInputRef])

  const itemCount = cart.length
  // Pieces in base units (a carton of 12 counts 12) and weight/volume separately: never mixed.
  const baseOf = (i) => (parseFloat(i.qty) || 0) * (Number(i.factor) || 1)
  const pieceCount = cart
    .filter((i) => (i.kind || 'count') === 'count')
    .reduce((s, i) => s + baseOf(i), 0)
  const kgCount = cart.filter((i) => i.kind === 'weight').reduce((s, i) => s + baseOf(i), 0)
  const literCount = cart.filter((i) => i.kind === 'volume').reduce((s, i) => s + baseOf(i), 0)
  // Kinds the owner added (metres…): one total per kind, in its own unit.
  const otherKinds = [...new Set(cart.map((i) => i.kind || 'count'))].filter(
    (k) => !['count', 'weight', 'volume'].includes(k)
  )
  const cartSummary = [
    `${itemCount} صنف`,
    pieceCount ? `${Math.round(pieceCount)} قطعة` : null,
    kgCount ? `${(Math.round(kgCount * 1000) / 1000).toFixed(3)} كجم` : null,
    literCount ? `${(Math.round(literCount * 1000) / 1000).toFixed(3)} لتر` : null,
    ...otherKinds.map((k) => {
      const info = kindInfo(k)
      const sum = cart.filter((i) => i.kind === k).reduce((s, i) => s + baseOf(i), 0)
      return sum ? `${sum.toFixed(info.decimals)} ${info.unit}` : null
    })
  ]
    .filter(Boolean)
    .join(' · ')
  const showResults = !!searchInput || searchResults.length > 0
  const discountNum = parseFloat(discount) || 0
  const creditNum = parseFloat(appliedCredit) || 0

  return (
    <div className="pos">
      {/* ── Product entry + cart ── */}
      <section className="pos-main" aria-label="إدخال الأصناف والفاتورة">
        <CategoryBrowser
          open={browsing}
          onClose={() => setBrowsing(false)}
          onAdd={addByBarcode}
          cart={cart}
          cartTotal={cartTotal}
        />
        <div className="pos-entry">
          <form onSubmit={handleBarcodeSubmit} className="scan-field" role="search">
            <ScanBarcode className="scan-icon" size={22} aria-hidden="true" />
            <input
              type="text"
              className="scan-input"
              ref={barcodeInputRef}
              onFocus={(e) => e.target.select()}
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              placeholder="امسح الباركود أو اكتبه"
              aria-label="باركود الصنف"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="scan-enter" aria-hidden="true">
              <CornerDownLeft size={14} />
            </span>
          </form>

          <div className="product-search">
            <div className="search-field">
              <Search size={17} aria-hidden="true" />
              <input
                type="text"
                className="input search-input"
                ref={searchInputRef}
                value={searchInput}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                placeholder="بحث بالاسم…"
                role="combobox"
                aria-autocomplete="list"
                aria-label="البحث في الأصناف"
                aria-expanded={showResults}
                aria-controls="pos-search-results"
                aria-describedby="pos-search-count"
                autoComplete="off"
              />
              <span className="search-meta">
                <span className="search-count" id="pos-search-count">
                  <span className="num">{(dbStats.totalItems || 0).toLocaleString('en-US')}</span>{' '}
                  صنف
                </span>
                <span aria-hidden="true">
                  <Kbd>F2</Kbd>
                </span>
              </span>
            </div>

            {showResults && (
              <div
                className="popover search-results"
                id="pos-search-results"
                role="listbox"
                ref={resultsRef}
              >
                {candidatesOpen && (
                  <div className="results-head">
                    <span>عدة أصناف تطابق الباركود – اختر الصنف</span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="إغلاق النتائج"
                      onClick={closeCandidates}
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                {searchResults.length === 0 ? (
                  <div className="results-empty">لا توجد أصناف مطابقة لـ «{searchInput}»</div>
                ) : (
                  searchResults.map((item, index) => {
                    const low = item.stock_qty <= item.reorder_limit
                    return (
                      <div
                        key={item.barcode}
                        role="option"
                        aria-selected={index === selectedSearchIndex}
                        className={`result-item ${index === selectedSearchIndex ? 'is-active' : ''}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickResult(item)}
                      >
                        <div className="result-info">
                          <span className="result-name">{item.name}</span>
                          <span className="result-code mono">{item.barcode}</span>
                        </div>
                        <div className="result-meta">
                          <span className="result-price money">{money(item.retail_price)} ج.م</span>
                          <span className={`result-stock ${low ? 'is-low' : ''}`}>
                            المخزون: <span className="num">{item.stock_qty}</span> {item.unit}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </div>

        <div className="cart card">
          <div className="cart-head">
            <div className="cart-title">
              <h2>الفاتورة الحالية</h2>
              {itemCount > 0 && <span className="badge num">{cartSummary}</span>}
            </div>
            <div className="row">
              <ShortagesButton
                dbStats={dbStats}
                onPrint={handlePrintShortagesToPaper}
                onPdf={handlePrintShortages}
              />
              <button
                type="button"
                className={`btn btn-sm ${browsing ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setBrowsing((b) => !b)}
                aria-pressed={browsing}
                title="تصفح الأصناف حسب التصنيف (F6)"
              >
                <FolderTree size={15} aria-hidden="true" />
                تصفح
                <Kbd>F6</Kbd>
              </button>
              {onReturn && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onReturn}
                  title="إرجاع صنف أو فاتورة برقمها"
                >
                  <Undo2 size={15} aria-hidden="true" />
                  مرتجع
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={triggerClearCart}
                disabled={itemCount === 0}
                title="تفريغ الفاتورة (Esc)"
              >
                <Trash2 size={15} aria-hidden="true" />
                تفريغ
                <Kbd>Esc</Kbd>
              </button>
            </div>
          </div>

          <div className="cart-scroll">
            {itemCount === 0 ? (
              <div className="cart-empty">
                <span className="cart-empty-icon" aria-hidden="true">
                  <ShoppingBasket size={30} />
                </span>
                <strong>الفاتورة فارغة</strong>
                <span>امسح باركود الصنف، أو ابحث بالاسم بالضغط على F2.</span>
              </div>
            ) : (
              <table className="cart-table">
                <thead>
                  <tr>
                    <th className="col-idx">#</th>
                    <th>الصنف</th>
                    <th className="col-price">السعر</th>
                    <th className="col-qty">الكمية</th>
                    <th className="col-total">الإجمالي</th>
                    <th className="col-del">
                      <span className="visually-hidden">حذف</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item, index) => (
                    <tr key={item.key} ref={(el) => (rowRefs.current[item.key] = el)}>
                      <td className="col-idx num">{index + 1}</td>
                      <td className="col-name">
                        <span className="line-name">
                          {item.name}
                          {item.unitId ? ` (${item.unitName})` : ''}
                        </span>
                        <span className="line-code mono">{item.barcode}</span>
                      </td>
                      <td className="col-price money">{money(item.price)}</td>
                      <td className="col-qty">
                        <div className="qty-stepper">
                          <button
                            type="button"
                            tabIndex={-1}
                            className="qty-btn"
                            aria-label={`زيادة كمية ${item.name}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => stepQty(item, 1)}
                          >
                            <Plus size={14} />
                          </button>
                          <QtyInput
                            item={item}
                            inputRef={(el) => (qtyInputRefs.current[index] = el)}
                            onQty={(v) => handleQtyChangeAttempt(item.key, v)}
                            onZero={() => triggerDeleteItem(item.key)}
                          />
                          <button
                            type="button"
                            tabIndex={-1}
                            className="qty-btn"
                            aria-label={`تقليل كمية ${item.name}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => stepQty(item, -1)}
                            disabled={item.qty - stepOf(item) <= 0}
                          >
                            <Minus size={14} />
                          </button>
                        </div>
                        {item.units && item.units.length > 1 ? (
                          <select
                            className="line-unit-select"
                            value={item.unitId ?? ''}
                            onChange={(e) =>
                              changeLineUnit(
                                item.key,
                                e.target.value === '' ? null : Number(e.target.value)
                              )
                            }
                            aria-label={`وحدة بيع ${item.name}`}
                          >
                            {item.units.map((u) => (
                              <option key={u.id ?? 'base'} value={u.id ?? ''}>
                                {u.name || 'الوحدة'}
                                {u.id ? ` (${u.factor})` : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          item.unit && <span className="line-unit">{item.unit}</span>
                        )}
                        {item.kind === 'weight' && !item.unitId && (
                          <button
                            type="button"
                            className="line-weight-btn num"
                            onClick={() => editWeight(item.key)}
                            aria-label={`تعديل وزن ${item.name}`}
                            title="تعديل الوزن"
                          >
                            {Math.round(item.qty * 1000).toLocaleString('en-US')} جم
                          </button>
                        )}
                      </td>
                      <td className="col-total money">{money(item.total)}</td>
                      <td className="col-del">
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => triggerDeleteItem(item.key)}
                          aria-label={`حذف ${item.name}`}
                          title="حذف الصنف"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {pendingWeight && <WeightEntryModal pending={pendingWeight} onDone={confirmWeight} />}

          <footer className="pos-hints" aria-label="اختصارات لوحة المفاتيح">
            <span>
              <Kbd>F1</Kbd> دفع
            </span>
            <span>
              <Kbd>F2</Kbd> بحث
            </span>
            <span>
              <Kbd>F3</Kbd> كمية أول صنف
            </span>
            <span>
              <Kbd>F4</Kbd> حذف آخر صنف
            </span>
            <span>
              <Kbd>Esc</Kbd> تفريغ
            </span>
            <span className="hide-md">
              <Kbd>Ctrl+Alt+L</Kbd> قفل
            </span>
          </footer>
        </div>
      </section>

      {/* ── Checkout panel ── */}
      <aside className="pos-checkout card" aria-label="الدفع">
        <div className="due">
          <span className="due-label">المطلوب من العميل</span>
          <span className="due-amount money" aria-live="polite">
            {money(cartTotal)}
            <small>ج.م</small>
          </span>
          <dl className="due-breakdown">
            <div>
              <dt>إجمالي الأصناف</dt>
              <dd className="money">{money(cartSubtotal)}</dd>
            </div>
            {/* Automatic discounts (administrator rules) and the manual one (D-057), as priced
                by the service. */}
            {appliedDiscounts.map((d) => (
              <div key={`${d.scope}-${d.ruleId ?? 'manual'}`}>
                <dt>
                  {d.scope === 'manual'
                    ? `خصم يدوي: ${manualDiscount?.reason || ''}`
                    : `خصم: ${d.name}`}
                </dt>
                <dd className="money text-danger">− {money(d.amount)}</dd>
              </div>
            ))}
            {appliedDiscounts.length === 0 && discountNum > 0 && (
              <div>
                <dt>الخصم</dt>
                <dd className="money text-danger">− {money(discountNum)}</dd>
              </div>
            )}
            {creditNum > 0 && (
              <div>
                <dt>من رصيد العميل</dt>
                <dd className="money text-accent">− {money(creditNum)}</dd>
              </div>
            )}
          </dl>
          {canManualDiscount && cart.length > 0 && (
            <div className="manual-discount-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setManualOpen(true)}
              >
                {manualDiscount ? 'تعديل الخصم اليدوي' : 'خصم يدوي'}
              </button>
              {manualDiscount && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setManualDiscount(null)}
                >
                  إلغاء الخصم اليدوي
                </button>
              )}
            </div>
          )}
          {manualOpen && (
            <ManualDiscountModal
              current={manualDiscount}
              maxAmount={afterRules}
              onApply={(m) => {
                setManualDiscount(m)
                setManualOpen(false)
              }}
              onClose={() => setManualOpen(false)}
            />
          )}
        </div>

        <div className="checkout-body">
          <fieldset className="pay-methods">
            <legend className="section-label">طريقة الدفع</legend>
            <div className="pay-grid">
              {PAYMENT_METHODS.map((m) => {
                const Icon = m.icon
                const selected = paymentType === m.value
                return (
                  <button
                    key={m.value}
                    type="button"
                    className={`pay-option ${selected ? 'is-selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => choosePayment(m)}
                    title={m.needsClient ? 'يتطلب تحديد العميل' : undefined}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{m.label}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="money-fields">
            <label className="field">
              <span className="field-label">
                {paymentType === 'دفع جزئي' ? 'المدفوع مقدماً' : 'المدفوع من العميل'}
              </span>
              <input
                type="number"
                className="input input-amount num"
                value={paidAmount}
                placeholder="0.00"
                onChange={(e) => setPaidAmount(e.target.value)}
              />
            </label>
          </div>

          <div className={`change-due ${changeRemaining > 0 ? 'is-positive' : ''}`}>
            <span>الباقي للعميل</span>
            <strong className="money">{money(changeRemaining)} ج.م</strong>
          </div>

          {paymentType === 'دفع جزئي' && (
            <p className="checkout-note">
              <Info size={14} aria-hidden="true" />
              المبلغ المدفوع يُسجَّل مقدماً، والمتبقي من الفاتورة يُضاف لحساب العميل.
            </p>
          )}

          <div className="customer">
            <div className="section-label">
              <UserRound size={15} aria-hidden="true" />
              العميل <span className="text-muted">(اختياري – مطلوب للآجل والدفع الجزئي)</span>
            </div>
            <div className="customer-fields">
              <div className="search-field">
                <UserRound size={15} aria-hidden="true" />
                <input
                  type="text"
                  className="input"
                  placeholder="اسم العميل"
                  value={clientName}
                  onChange={(e) => handleClientNameChange(e.target.value)}
                  aria-label="اسم العميل"
                  autoComplete="off"
                />
              </div>
              {selectedClient && savedPhones.length > 0 && !typingPhone ? (
                // A returning customer: pick one of the saved numbers instead of typing it again.
                <div className="search-field">
                  <Phone size={15} aria-hidden="true" />
                  <select
                    className="input num"
                    aria-label="هاتف العميل"
                    value={savedPhones.includes(clientPhone) ? clientPhone : savedPhones[0]}
                    onChange={(e) => {
                      if (e.target.value === 'other') {
                        setTypingPhoneFor(selectedClient.id)
                        setClientPhone('')
                      } else setClientPhone(e.target.value)
                    }}
                  >
                    {savedPhones.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                    <option value="other">رقم آخر…</option>
                  </select>
                </div>
              ) : (
                <div className="search-field">
                  <Phone size={15} aria-hidden="true" />
                  <input
                    type="text"
                    className="input num"
                    placeholder={selectedClient ? 'رقم جديد لهذا العميل' : 'رقم الهاتف'}
                    value={clientPhone}
                    onChange={(e) =>
                      selectedClient
                        ? setClientPhone(e.target.value)
                        : handleClientPhoneChange(e.target.value)
                    }
                    aria-label="هاتف العميل"
                    autoComplete="off"
                  />
                  {selectedClient && savedPhones.length > 0 && (
                    <button
                      type="button"
                      className="icon-btn saved-phones-btn"
                      aria-label="الأرقام المحفوظة"
                      title="الرجوع إلى الأرقام المحفوظة"
                      onClick={() => {
                        setTypingPhoneFor(null)
                        setClientPhone(savedPhones[0])
                      }}
                    >
                      <List size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
              {phoneNote && (
                <p className={`field-hint ${phoneNote.warn ? 'is-warning' : ''}`} role="status">
                  {phoneNote.text}
                </p>
              )}
              {clientSearchResults.length > 0 && (
                <div className="popover client-results" role="listbox">
                  {clientSearchResults.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      className="dropdown-item client-result"
                      onClick={() => selectClient(c)}
                    >
                      <span className="client-result-name">{c.name}</span>
                      <span className="client-result-meta">
                        {c.phone && <span className="num">{c.phone}</span>}
                        {c.debt_balance > 0 && (
                          <span className="text-danger">
                            دين: <span className="money">{money(c.debt_balance)}</span>
                          </span>
                        )}
                        {c.points > 0 && (
                          <span>
                            نقاط: <span className="num">{c.points}</span>
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <label className="check-row">
              <input
                type="checkbox"
                checked={isDelivery}
                onChange={(e) => setIsDelivery(e.target.checked)}
              />
              طلب توصيل (دليفري)
            </label>
            {isDelivery && selectedClient && selectedClient.addresses?.length > 0 && (
              <div className="search-field">
                <MapPin size={15} aria-hidden="true" />
                <select
                  className="input"
                  aria-label="عنوان التوصيل"
                  value={clientAddressId ?? 'typed'}
                  onChange={(e) =>
                    setClientAddressId(e.target.value === 'typed' ? null : Number(e.target.value))
                  }
                >
                  {selectedClient.addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {(ADDRESS_LABELS[a.label] || '') + ': '}
                      {a.address}
                      {a.details ? ` – ${a.details}` : ''}
                      {a.isDefault ? ' (افتراضي)' : ''}
                    </option>
                  ))}
                  <option value="typed">عنوان آخر…</option>
                </select>
              </div>
            )}
            {isDelivery &&
              !(selectedClient && selectedClient.addresses?.length > 0 && clientAddressId) && (
                <div className="search-field">
                  <MapPin size={15} aria-hidden="true" />
                  <input
                    type="text"
                    className="input"
                    placeholder="عنوان التوصيل بالتفصيل"
                    value={clientAddress}
                    onChange={(e) => setClientAddress(e.target.value)}
                    aria-label="عنوان التوصيل"
                  />
                </div>
              )}
            {addressNote && (
              <p className={`field-hint ${addressNote.warn ? 'is-warning' : ''}`} role="status">
                {addressNote.text}
              </p>
            )}

            {selectedClient && (
              <div className="client-balance">
                {selectedClient.debt_balance < 0 ? (
                  <span className="text-accent fw-bold">
                    رصيد متوفر للعميل:{' '}
                    <span className="money">{money(Math.abs(selectedClient.debt_balance))}</span>{' '}
                    ج.م
                  </span>
                ) : selectedClient.debt_balance > 0 ? (
                  <span className="text-danger fw-bold">
                    مديونية سابقة:{' '}
                    <span className="money">{money(selectedClient.debt_balance)}</span> ج.م
                  </span>
                ) : (
                  <span className="text-muted">لا يوجد رصيد أو مديونية</span>
                )}
                {selectedClient.debt_balance < 0 && (
                  <button
                    type="button"
                    className={`btn btn-sm ${appliedCredit > 0 ? 'btn-danger-soft' : 'btn-accent-soft'}`}
                    onClick={() => {
                      if (appliedCredit > 0) {
                        setAppliedCredit(0)
                      } else {
                        const maxUsable = Math.min(
                          Math.abs(selectedClient.debt_balance),
                          cartTotal + appliedCredit
                        )
                        setAppliedCredit(maxUsable)
                      }
                    }}
                  >
                    <PiggyBank size={15} aria-hidden="true" />
                    {appliedCredit > 0 ? 'إلغاء الخصم من الرصيد' : 'خصم من الرصيد'}
                  </button>
                )}
              </div>
            )}

            {changeRemaining > 0 && selectedClient && (
              <label className="deposit-row">
                <span>حفظ جزء من الباقي كرصيد للعميل</span>
                <input
                  type="number"
                  id="deposit-change-input"
                  className="input num"
                  value={depositChange}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === '' || (!isNaN(val) && parseFloat(val) >= 0)) {
                      setDepositChange(val)
                    }
                  }}
                  placeholder="0.00"
                  max={changeRemaining}
                  min={0}
                  step="0.01"
                />
                <span className="text-muted num">حد أقصى {money(changeRemaining)}</span>
              </label>
            )}
          </div>
        </div>

        <div className="checkout-actions">
          <button
            type="button"
            className={`pay-button ${noPrint ? 'is-no-receipt' : ''}`}
            onClick={handleCheckout}
          >
            <CircleCheck size={22} aria-hidden="true" />
            <span>{noPrint ? 'دفع بدون فاتورة' : 'تأكيد الدفع'}</span>
            <Kbd>F1</Kbd>
          </button>
          <button
            type="button"
            className={`receipt-toggle ${noPrint ? 'is-off' : ''}`}
            onClick={() => setNoPrint((p) => !p)}
            aria-pressed={!noPrint}
            aria-label={
              noPrint
                ? 'طباعة الفاتورة معطّلة – اضغط للتفعيل'
                : 'طباعة الفاتورة مفعّلة – اضغط للإيقاف'
            }
            title={noPrint ? 'الطباعة معطّلة — اضغط لتفعيلها' : 'الطباعة مفعّلة — اضغط لإيقافها'}
          >
            {noPrint ? <PrinterX size={20} /> : <Printer size={20} />}
            <span>{noPrint ? 'بدون فاتورة' : 'فاتورة'}</span>
          </button>
        </div>
      </aside>
    </div>
  )
}

export default CheckoutTerminal
