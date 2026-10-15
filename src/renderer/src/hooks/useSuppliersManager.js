import { useState } from 'react'
import { executeQuery } from '../lib/db'
import { escapeSql, getNowStr, getFriendlyErrorMessage } from '../lib/utils'

export function useSuppliersManager({ currentShift, triggerCustomAlert, triggerCustomConfirm }) {
  const [suppliersList, setSuppliersList] = useState([])
  const [suppliersSearch, setSuppliersSearch] = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [supplierLedger, setSupplierLedger] = useState([])
  const [supplierPurchases, setSupplierPurchases] = useState([])
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false)
  const [showAddPurchaseModal, setShowAddPurchaseModal] = useState(false)
  const [newSupplierForm, setNewSupplierForm] = useState({
    name: '',
    phone: '',
    address: '',
    contact_person: ''
  })
  const [newPurchaseForm, setNewPurchaseForm] = useState({
    invoice_ref: '',
    total_amount: '',
    paid_amount: '',
    payment_type: 'آجل',
    notes: ''
  })
  const [supplierRepayAmount, setSupplierRepayAmount] = useState('')

  const fetchSuppliersList = async (search = '') => {
    try {
      const where = search
        ? `WHERE name LIKE '%${escapeSql(search)}%' OR phone LIKE '%${escapeSql(search)}%'`
        : ''
      const res = await executeQuery(`SELECT * FROM suppliers ${where} ORDER BY name ASC;`)
      setSuppliersList(res || [])
    } catch (err) {
      console.error('fetchSuppliersList error:', err)
    }
  }

  const fetchSupplierProfile = async (supplier) => {
    setSelectedSupplier(supplier)
    try {
      const [ledger, purchases] = await Promise.all([
        executeQuery(
          `SELECT * FROM supplier_ledger WHERE supplier_id = ${supplier.id} ORDER BY id DESC LIMIT 50;`
        ),
        executeQuery(
          `SELECT * FROM supplier_purchases WHERE supplier_id = ${supplier.id} ORDER BY id DESC;`
        )
      ])
      setSupplierLedger(ledger || [])
      setSupplierPurchases(purchases || [])
    } catch (err) {
      console.error('fetchSupplierProfile error:', err)
    }
  }

  const handleAddSupplier = async (e) => {
    if (e) e.preventDefault()
    if (!newSupplierForm.name) {
      triggerCustomAlert('يرجى إدخال اسم المورد!')
      return
    }
    try {
      const nowStr = getNowStr()
      await executeQuery(`
        INSERT INTO suppliers (name, phone, address, contact_person, debt_balance, created_at)
        VALUES ('${escapeSql(newSupplierForm.name)}', '${escapeSql(newSupplierForm.phone)}',
                '${escapeSql(newSupplierForm.address)}', '${escapeSql(newSupplierForm.contact_person)}',
                0.0, '${nowStr}');
      `)
      setShowAddSupplierModal(false)
      setNewSupplierForm({ name: '', phone: '', address: '', contact_person: '' })
      await fetchSuppliersList()
    } catch (err) {
      triggerCustomAlert('فشل إضافة المورد: ' + getFriendlyErrorMessage(err))
    }
  }

  const handleAddPurchase = async (e) => {
    if (e) e.preventDefault()
    if (!selectedSupplier) return
    const total = parseFloat(newPurchaseForm.total_amount) || 0
    const paid = parseFloat(newPurchaseForm.paid_amount) || 0
    if (total <= 0) {
      triggerCustomAlert('يرجى إدخال مبلغ الفاتورة!')
      return
    }
    try {
      const nowStr = getNowStr()
      const remaining = total - paid
      const shiftId = currentShift ? currentShift.id : 'NULL'
      let sql = 'BEGIN TRANSACTION;\n'
      sql += `INSERT INTO supplier_purchases (supplier_id, invoice_ref, total_amount, paid_amount, remaining, payment_type, timestamp, notes)
              VALUES (${selectedSupplier.id}, '${escapeSql(newPurchaseForm.invoice_ref)}', ${total}, ${paid}, ${remaining}, '${escapeSql(newPurchaseForm.payment_type)}', '${nowStr}', '${escapeSql(newPurchaseForm.notes)}');\n`
      if (remaining > 0) {
        sql += `UPDATE suppliers SET debt_balance = debt_balance + ${remaining} WHERE id = ${selectedSupplier.id};\n`
        sql += `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES (${selectedSupplier.id}, 'purchase', ${remaining}, 'فاتورة شراء #${escapeSql(newPurchaseForm.invoice_ref)} - متبقي آجل', '${nowStr}');\n`
      }
      if (paid > 0) {
        sql += `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (${shiftId}, 'outflow', ${paid}, 'دفعة لمورد: ${escapeSql(selectedSupplier.name)} - فاتورة #${escapeSql(newPurchaseForm.invoice_ref)}', '${nowStr}');\n`
      }
      sql += 'COMMIT;\n'
      await executeQuery(sql)
      setShowAddPurchaseModal(false)
      setNewPurchaseForm({
        invoice_ref: '',
        total_amount: '',
        paid_amount: '',
        payment_type: 'آجل',
        notes: ''
      })
      const updated = await executeQuery(
        `SELECT * FROM suppliers WHERE id = ${selectedSupplier.id} LIMIT 1;`
      )
      if (updated.length > 0) await fetchSupplierProfile(updated[0])
    } catch (err) {
      triggerCustomAlert('فشل تسجيل الفاتورة: ' + getFriendlyErrorMessage(err))
    }
  }

  const handleSupplierRepay = async (e) => {
    if (e) e.preventDefault()
    const amount = parseFloat(supplierRepayAmount) || 0
    if (amount <= 0) {
      triggerCustomAlert('يرجى إدخال مبلغ صحيح!')
      return
    }
    try {
      const nowStr = getNowStr()
      const shiftId = currentShift ? currentShift.id : 'NULL'
      let sql = 'BEGIN TRANSACTION;\n'
      sql += `UPDATE suppliers SET debt_balance = debt_balance - ${amount} WHERE id = ${selectedSupplier.id};\n`
      sql += `INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp) VALUES (${selectedSupplier.id}, 'payment', ${amount}, 'دفعة سداد للمورد', '${nowStr}');\n`
      if (shiftId !== 'NULL') {
        sql += `INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp) VALUES (${shiftId}, 'outflow', ${amount}, 'سداد دين مورد: ${escapeSql(selectedSupplier.name)}', '${nowStr}');\n`
      }
      sql += 'COMMIT;\n'
      await executeQuery(sql)
      setSupplierRepayAmount('')
      const updated = await executeQuery(
        `SELECT * FROM suppliers WHERE id = ${selectedSupplier.id} LIMIT 1;`
      )
      if (updated.length > 0) await fetchSupplierProfile(updated[0])
    } catch (err) {
      triggerCustomAlert('فشل تسجيل السداد: ' + getFriendlyErrorMessage(err))
    }
  }

  const handleDeleteSupplier = async (supplierId) => {
    triggerCustomConfirm('هل أنت متأكد من حذف هذا المورد وكافة سجلاته؟', async () => {
      try {
        let sql = 'BEGIN TRANSACTION;\n'
        sql += `DELETE FROM supplier_ledger WHERE supplier_id = ${supplierId};\n`
        sql += `DELETE FROM supplier_purchases WHERE supplier_id = ${supplierId};\n`
        sql += `DELETE FROM suppliers WHERE id = ${supplierId};\n`
        sql += 'COMMIT;\n'
        await executeQuery(sql)
        setSelectedSupplier(null)
        setSupplierLedger([])
        setSupplierPurchases([])
        await fetchSuppliersList()
      } catch (err) {
        if (err.message && err.message.includes('FOREIGN KEY')) {
          triggerCustomAlert(
            'لا يمكن حذف هذا المورد لأنه مرتبط بسجلات أو حركات شراء سابقة بالنظام.'
          )
        } else {
          triggerCustomAlert('فشل حذف المورد: ' + getFriendlyErrorMessage(err))
        }
      }
    })
  }

  return {
    suppliersList,
    setSuppliersList,
    suppliersSearch,
    setSuppliersSearch,
    selectedSupplier,
    setSelectedSupplier,
    supplierLedger,
    supplierPurchases,
    showAddSupplierModal,
    setShowAddSupplierModal,
    showAddPurchaseModal,
    setShowAddPurchaseModal,
    newSupplierForm,
    setNewSupplierForm,
    newPurchaseForm,
    setNewPurchaseForm,
    supplierRepayAmount,
    setSupplierRepayAmount,
    fetchSuppliersList,
    fetchSupplierProfile,
    handleAddSupplier,
    handleAddPurchase,
    handleSupplierRepay,
    handleDeleteSupplier
  }
}
