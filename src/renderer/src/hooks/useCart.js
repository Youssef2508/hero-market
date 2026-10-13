import { useState } from 'react'
import { round2 } from '../lib/utils'

/**
 * Custom hook for POS checkout cart state management.
 *
 * @param {object} params
 * @param {function} params.playSound
 * @param {function} params.triggerCustomAlert
 */
export function useCart({ playSound }) {
  const [cart, setCart] = useState([])
  const [discount, setDiscount] = useState(0)
  const [paidAmount, setPaidAmount] = useState('')
  const [paymentType, setPaymentType] = useState('نقدي')
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [isDelivery, setIsDelivery] = useState(false)
  const [depositChange, setDepositChange] = useState('')
  const [appliedCredit, setAppliedCredit] = useState(0)

  // Derived state: Cart subtotal before discount and credit
  const subTotal = round2(cart.reduce((sum, item) => sum + (item.total || 0), 0))

  // Derived state: Cart total after discount and applied credit
  const cartTotal = round2(
    Math.max(0, subTotal - (parseFloat(discount) || 0) - (parseFloat(appliedCredit) || 0))
  )

  // Derived state: Change due back to customer
  const changeDue = paidAmount ? round2(Math.max(0, (parseFloat(paidAmount) || 0) - cartTotal)) : 0

  const addToCart = (product, customQty = 1) => {
    const availableStock = product.stock_qty || 0

    setCart((prevCart) => {
      const existing = prevCart.find((item) => item.barcode === product.barcode)
      const currentQty = existing ? existing.qty : 0
      const targetQty = currentQty + customQty

      playSound('success')
      if (existing) {
        return prevCart.map((item) =>
          item.barcode === product.barcode
            ? { ...item, qty: targetQty, total: round2(targetQty * item.price) }
            : item
        )
      } else {
        return [
          ...prevCart,
          {
            barcode: product.barcode,
            name: product.name || 'صنف غير مسمى',
            price: product.retail_price || 0.0,
            cost_price: product.cost_price || 0.0,
            qty: customQty,
            unit: product.unit || '',
            total: round2((product.retail_price || 0.0) * customQty),
            stock_qty: availableStock
          }
        ]
      }
    })
  }

  const updateQty = (barcode, qty) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((item) => item.barcode !== barcode))
      return
    }
    setCart((prev) => {
      return prev.map((item) =>
        item.barcode === barcode ? { ...item, qty, total: round2(qty * item.price) } : item
      )
    })
  }

  const handleQtyChangeAttempt = (barcode, newQtyVal) => {
    if (typeof newQtyVal === 'string' && (newQtyVal.endsWith('.') || newQtyVal.endsWith(','))) {
      return
    }
    if (newQtyVal === '' || newQtyVal === null || newQtyVal === undefined) {
      return
    }
    const newQty = parseFloat(newQtyVal)
    if (isNaN(newQty)) return
    if (newQty <= 0) return
    updateQty(barcode, newQty)
  }

  const triggerDeleteItem = (barcode) => {
    setCart((prev) => prev.filter((item) => item.barcode !== barcode))
  }

  const triggerClearCart = () => {
    if (cart.length === 0) return
    setCart([])
    setDiscount(0)
    setPaidAmount('')
    setPaymentType('نقدي')
  }

  return {
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
    depositChange,
    setDepositChange,
    appliedCredit,
    setAppliedCredit,
    subTotal,
    cartTotal,
    changeDue,
    addToCart,
    updateQty,
    handleQtyChangeAttempt,
    triggerDeleteItem,
    triggerClearCart
  }
}
