export function generateReceiptHtml({
  storeName = 'هيرو ماركت',
  branchName = 'الفرع الرئيسي',
  displaySaleId,
  datePart,
  timePart,
  currentUser,
  clientName,
  clientPhone,
  clientAddress,
  cart = [],
  cartTotal = 0,
  finalDiscount = 0,
  paidAmount = 0,
  changeRemaining = 0,
  paymentType = 'نقدي'
}) {
  const displayPaid = paidAmount && parseFloat(paidAmount) > 0 ? parseFloat(paidAmount) : cartTotal
  const displayChange = parseFloat(changeRemaining) || 0

  return `
    <div style="font-family: 'Courier New', monospace; width: 80mm; padding: 4px; direction: rtl; font-size: 12px; color: #000; background: #fff;">
      <div style="text-align: center; font-weight: bold; font-size: 15px; margin-bottom: 2px;">${storeName}</div>
      <div style="text-align: center; font-size: 11px; margin-bottom: 4px;">${branchName}</div>
      <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>
      
      <div style="font-size: 10px; margin-bottom: 4px;">
        <div><b>رقم العملية:</b> #${displaySaleId || '—'}</div>
        <div><b>التاريخ:</b> ${datePart || ''}</div>
        <div><b>الوقت:</b> ${timePart || ''}</div>
        ${currentUser?.username ? `<div><b>الكاشير:</b> ${currentUser.username}</div>` : ''}
        ${clientName ? `<div><b>العميل:</b> ${clientName}</div>` : ''}
        ${clientPhone ? `<div><b>هاتف العميل:</b> ${clientPhone}</div>` : ''}
        ${clientAddress ? `<div><b>العنوان:</b> ${clientAddress}</div>` : ''}
        <div><b>طريقة الدفع:</b> ${paymentType}</div>
      </div>
      
      <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>
      
      <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: right;">
        <thead>
          <tr style="border-bottom: 1px solid #000;">
            <th style="text-align: right; padding-bottom: 2px;">الصنف</th>
            <th style="text-align: center; width: 30px; padding-bottom: 2px;">ك</th>
            <th style="text-align: center; width: 45px; padding-bottom: 2px;">سعر</th>
            <th style="text-align: left; width: 50px; padding-bottom: 2px;">إجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${cart
            .map((item) => {
              const qty = item.qty || item.quantity || 1
              const price = item.price || item.unit_price || 0
              const total = item.total || qty * price || 0
              const name = item.name || item.product_name || 'صنف'
              return `
              <tr>
                <td style="text-align: right; padding: 2px 0;">${name}</td>
                <td style="text-align: center;">${qty}</td>
                <td style="text-align: center;">${price.toFixed(2)}</td>
                <td style="text-align: left;">${total.toFixed(2)}</td>
              </tr>
            `
            })
            .join('')}
        </tbody>
      </table>
      
      <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>
      
      <div style="font-size: 11px; font-weight: bold; display: flex; justify-content: space-between; margin: 2px 0;">
        <span>الإجمالي:</span>
        <span>${cartTotal.toFixed(2)} ج.م</span>
      </div>
      
      ${
        finalDiscount > 0
          ? `
        <div style="font-size: 10px; display: flex; justify-content: space-between; margin: 2px 0;">
          <span>خصم الفاتورة:</span>
          <span>-${finalDiscount.toFixed(2)} ج.م</span>
        </div>
      `
          : ''
      }

      <div style="font-size: 10px; display: flex; justify-content: space-between; margin: 2px 0;">
        <span>المدفوع:</span>
        <span>${displayPaid.toFixed(2)} ج.م</span>
      </div>

      <div style="font-size: 11px; font-weight: bold; display: flex; justify-content: space-between; margin: 2px 0;">
        <span>الباقي للعميل:</span>
        <span>${displayChange.toFixed(2)} ج.م</span>
      </div>

      <div style="border-bottom: 1px dashed #000; margin: 6px 0;"></div>
      <div style="text-align: center; font-size: 10px; margin-top: 4px; font-style: italic;">
        شكراً لتسوقكم معنا! - ${storeName}
      </div>
    </div>
  `
}

export function generateReprintHtml({
  storeName = 'هيرو ماركت',
  branchName = 'الفرع الرئيسي',
  displaySaleId,
  datePart,
  timePart,
  s = {},
  clName,
  clPhone,
  clAddress,
  items = []
}) {
  const isFullyReturned = s.total_amount === 0

  return `
    <div style="font-family: 'Courier New', monospace; width: 80mm; padding: 4px; direction: rtl; font-size: 12px; color: #000; background: #fff;">
      <div style="text-align: center; font-weight: bold; font-size: 15px; margin-bottom: 2px;">${storeName}</div>
      <div style="text-align: center; font-size: 11px; margin-bottom: 4px;">${branchName}</div>
      <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>
      
      <div style="font-size: 10px; margin-bottom: 4px;">
        <div style="text-align: center; font-weight: bold; font-size: 11px; margin-bottom: 4px; color: ${isFullyReturned ? '#ef4444' : '#000'}">
          ${isFullyReturned ? '*** فاتورة مرتجعة بالكامل ***' : '*** نسخة معاد طباعتها ***'}
        </div>
        <div><b>رقم العملية:</b> #${displaySaleId || s.id || '—'}</div>
        <div><b>التاريخ:</b> ${datePart || ''}</div>
        <div><b>الوقت:</b> ${timePart || ''}</div>
        ${s.username ? `<div><b>الكاشير:</b> ${s.username}</div>` : ''}
        ${clName ? `<div><b>العميل:</b> ${clName}</div>` : ''}
        ${clPhone ? `<div><b>هاتف العميل:</b> ${clPhone}</div>` : ''}
        ${clAddress ? `<div><b>العنوان:</b> ${clAddress}</div>` : ''}
        <div><b>طريقة الدفع:</b> ${s.payment_type || 'نقدي'}</div>
      </div>
      
      <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>
      
      <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: right;">
        <thead>
          <tr style="border-bottom: 1px solid #000;">
            <th style="text-align: right; padding-bottom: 2px;">الصنف</th>
            <th style="text-align: center; width: 30px; padding-bottom: 2px;">ك</th>
            <th style="text-align: center; width: 45px; padding-bottom: 2px;">سعر</th>
            <th style="text-align: left; width: 50px; padding-bottom: 2px;">إجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map((item) => {
              const retQty = item.returned_qty || 0
              const qty = item.quantity || 1
              const isItemReturned = retQty >= qty
              const isItemPartReturned = retQty > 0 && !isItemReturned
              const displayQty = isItemReturned ? 0 : isItemPartReturned ? qty - retQty : qty
              const unitPrice = Number(item.unit_price) || 0
              const totalPrice = Number(item.total_price) || qty * unitPrice

              let nameLabel =
                item.product_name || item.name || `باركود ${item.product_barcode || ''}`
              if (isItemReturned) {
                nameLabel = `<span style="text-decoration: line-through;">${nameLabel}</span> (مرتجع)`
              } else if (isItemPartReturned) {
                nameLabel = `${nameLabel} (مرتجع ${retQty})`
              }

              return `
              <tr style="${isItemReturned ? 'color: #888;' : ''}">
                <td style="text-align: right; padding: 2px 0;">${nameLabel}</td>
                <td style="text-align: center;">${displayQty}</td>
                <td style="text-align: center;">${unitPrice.toFixed(2)}</td>
                <td style="text-align: left; ${isItemReturned ? 'text-decoration: line-through;' : ''}">${totalPrice.toFixed(2)}</td>
              </tr>
            `
            })
            .join('')}
        </tbody>
      </table>
      
      <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>
      
      <div style="font-size: 11px; font-weight: bold; display: flex; justify-content: space-between; margin: 2px 0;">
        <span>الإجمالي:</span>
        <span>${Number(s.total_amount || 0).toFixed(2)} ج.م</span>
      </div>
      
      ${
        s.discount > 0
          ? `
        <div style="font-size: 10px; display: flex; justify-content: space-between; margin: 2px 0;">
          <span>خصم الفاتورة:</span>
          <span>-${Number(s.discount).toFixed(2)} ج.م</span>
        </div>
      `
          : ''
      }

      <div style="border-bottom: 1px dashed #000; margin: 6px 0;"></div>
      <div style="text-align: center; font-size: 10px; margin-top: 4px; font-style: italic;">
        شكراً لتسوقكم معنا! - ${storeName}
      </div>
    </div>
  `
}
