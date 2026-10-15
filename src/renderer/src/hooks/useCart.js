import { useState } from 'react'
import { round2 } from '../lib/utils'

/** Cart line key: one line per product unit (a carton and loose pieces are two lines). */
export const lineKey = (barcode, unitId) => `${barcode}|${unitId ?? ''}`

const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000

/**
 * Custom hook for POS checkout cart state management.
 *
 * A line is { key, barcode, name, unitId, unitName, factor, kind, units, price, qty, total, stock_qty }.
 * Products arrive resolved by the service (pos.resolve): product + unit + the sellable units.
 * A weighed product scanned without a weight opens the weight entry (pendingWeight) first.
 *
 * @param {object} params
 * @param {function} params.playSound
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
  const [pendingWeight, setPendingWeight] = useState(null)

  // Derived state: Cart subtotal before discount and credit
  const subTotal = round2(cart.reduce((sum, item) => sum + (item.total || 0), 0))

  // Derived state: Cart total after discount and applied credit
  const cartTotal = round2(
    Math.max(0, subTotal - (parseFloat(discount) || 0) - (parseFloat(appliedCredit) || 0))
  )

  // Derived state: Change due back to customer
  const changeDue = paidAmount ? round2(Math.max(0, (parseFloat(paidAmount) || 0) - cartTotal)) : 0

  /**
   * Add a resolved product. `resolved` is pos.resolve's answer ({ product, unit, units, qty }) or a
   * bare product row (legacy callers: base unit). `customQty` overrides the quantity.
   */
  const addToCart = (resolved, customQty) => {
    const product = resolved.product || resolved
    const unit = resolved.unit || {
      id: null,
      name: product.unit || '',
      factor: 1,
      price: Number(product.retail_price) || 0
    }
    const units = resolved.units || [unit]
    const kind = product.unit_kind || 'count'
    const given = customQty ?? resolved.qty ?? null
    if (kind !== 'count' && unit.id === null && (given === null || given === undefined)) {
      // Weighed by the kilogram: ask for the weight instead of assuming 1 kg.
      setPendingWeight({ product, unit, units })
      return
    }
    const qtyToAdd = given === null || given === undefined ? 1 : Number(given)
    const key = lineKey(product.barcode, unit.id)

    setCart((prevCart) => {
      const existing = prevCart.find((item) => item.key === key)
      playSound('success')
      if (existing) {
        const targetQty = round3(existing.qty + qtyToAdd)
        return prevCart.map((item) =>
          item.key === key
            ? { ...item, qty: targetQty, total: round2(targetQty * item.price) }
            : item
        )
      }
      return [
        ...prevCart,
        {
          key,
          barcode: product.barcode,
          name: product.name || 'صنف غير مسمى',
          unitId: unit.id,
          unitName: unit.name || product.unit || '',
          baseUnitName: product.unit || '',
          factor: Number(unit.factor) || 1,
          kind,
          units,
          price: Number(unit.price) || 0,
          cost_price: product.cost_price || 0.0,
          qty: qtyToAdd,
          unit: unit.name || product.unit || '',
          total: round2(Number(unit.price) * qtyToAdd),
          stock_qty: product.stock_qty || 0
        }
      ]
    })
  }

  /** Weight entry confirmed (kilograms) or cancelled (null). */
  const confirmWeight = (kg) => {
    const p = pendingWeight
    setPendingWeight(null)
    if (!p || kg === null || !(kg > 0)) return
    addToCart({ product: p.product, unit: p.unit, units: p.units }, round3(kg))
  }

  const updateQty = (key, qty) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((item) => item.key !== key))
      return
    }
    setCart((prev) => {
      return prev.map((item) =>
        item.key === key ? { ...item, qty, total: round2(qty * item.price) } : item
      )
    })
  }

  const handleQtyChangeAttempt = (key, newQtyVal) => {
    if (typeof newQtyVal === 'string' && (newQtyVal.endsWith('.') || newQtyVal.endsWith(','))) {
      return
    }
    if (newQtyVal === '' || newQtyVal === null || newQtyVal === undefined) {
      return
    }
    const newQty = parseFloat(newQtyVal)
    if (isNaN(newQty)) return
    if (newQty <= 0) return
    updateQty(key, round3(newQty))
  }

  /** Sell the line in another unit of the same product (merges with an existing line of that unit). */
  const changeLineUnit = (key, unitId) => {
    setCart((prev) => {
      const line = prev.find((item) => item.key === key)
      if (!line) return prev
      const unit = line.units.find((u) => (u.id ?? null) === (unitId ?? null))
      if (!unit) return prev
      const newKey = lineKey(line.barcode, unit.id)
      if (newKey === key) return prev
      const other = prev.find((item) => item.key === newKey)
      const updated = {
        ...line,
        key: newKey,
        unitId: unit.id,
        unitName: unit.name,
        unit: unit.name,
        factor: Number(unit.factor) || 1,
        price: Number(unit.price) || 0,
        qty: other ? round3(other.qty + line.qty) : line.qty
      }
      updated.total = round2(updated.qty * updated.price)
      return prev
        .filter((item) => item.key !== newKey)
        .map((item) => (item.key === key ? updated : item))
    })
  }

  const triggerDeleteItem = (key) => {
    setCart((prev) => prev.filter((item) => item.key !== key))
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
    changeLineUnit,
    triggerDeleteItem,
    triggerClearCart,
    pendingWeight,
    confirmWeight
  }
}
