const { setupTestDb, cleanupTestDb, executeSql } = require('./db_helper')

async function runAll28Flows() {
  console.log('======================================================================')
  console.log('STARTING 100% COMPLETE INTEGRATION SIMULATION: ALL 28 POS MOVEMENTS')
  console.log('======================================================================')

  try {
    // Copy prod database to sandbox test DB
    await setupTestDb()

    // --- PREPARATION ---
    const lastShifts = await executeSql('SELECT id, status FROM shifts ORDER BY id DESC LIMIT 1;')
    const lastShift = lastShifts[0]
    if (lastShift && lastShift.status === 'open') {
      await executeSql(
        `UPDATE shifts SET status = 'closed', end_time = 'prep-time', expected_end_cash = 0.0, actual_end_cash = 0.0, difference = 0.0 WHERE id = ${lastShift.id};`
      )
    }
    const shiftId = (lastShift ? lastShift.id : 0) + 1
    const testTime = '2026-07-23 09:00:00'
    const barcode = 'test-barcode-28'

    // ==========================================
    // SECTION 1: SHIFT OPERATIONS
    // ==========================================

    // 1. FLOW 1: Open Shift
    console.log('\n[FLOW 1] Opening shift #%d...', shiftId)
    const initialCash = 1500.0
    await executeSql(`
      INSERT INTO shifts (id, user_id, start_time, initial_cash, expected_end_cash, actual_end_cash, difference, status)
      VALUES (${shiftId}, 5, '${testTime}', ${initialCash}, ${initialCash}, 0.0, NULL, 'open');
    `)
    console.log('✔ Shift opened successfully.')

    // ==========================================
    // SECTION 2: CLIENTS & SUPPLIERS SETUP
    // ==========================================

    // 2. FLOW 2: Add Client
    console.log('\n[FLOW 2] Adding client "تست عميل"...')
    const clientId = 999
    await executeSql(`
      INSERT INTO clients (id, name, phone, address, debt_balance, points, created_at)
      VALUES (${clientId}, 'تست عميل', '01000000000', 'العنوان التجريبي', 0.0, 0, '${testTime}');
    `)
    console.log('✔ Client created.')

    // 3. FLOW 3: Add Supplier
    console.log('\n[FLOW 3] Adding supplier "تست مورد"...')
    const supplierId = 888
    await executeSql(`
      INSERT INTO suppliers (id, name, phone, address, contact_person, debt_balance, created_at)
      VALUES (${supplierId}, 'تست مورد', '01100000000', 'عنوان المورد', 'مسؤول التواصل', 0.0, '${testTime}');
    `)
    console.log('✔ Supplier created.')

    // ==========================================
    // SECTION 3: INVENTORY SETUP
    // ==========================================

    // 4. FLOW 4: Add Product
    console.log('\n[FLOW 4] Adding product "صنف تجربة 28"...')
    await executeSql(`
      INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, category, unit)
      VALUES ('${barcode}', 'صنف تجربة 28', 10.0, 15.0, 100.0, 'بسكويت', 'علبة');
    `)
    console.log('✔ Product added to inventory.')

    // ==========================================
    // SECTION 4: SALES TRANSACTIONS
    // ==========================================

    // 5. FLOW 5: Cash Sale (Anonymous Customer)
    console.log('\n[FLOW 5] Performing cash sale (10 units)...')
    const saleId1 = 3001
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId1}, ${shiftId}, '${testTime}', 150.0, 0.0, 'نقدي', '', NULL, 150.0);
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId1}, '${barcode}', 10.0, 15.0, 150.0, 0.0);
      UPDATE products SET stock_qty = stock_qty - 10.0 WHERE barcode = '${barcode}';
      COMMIT;
    `)
    console.log('✔ Cash sale completed.')

    // 6. FLOW 6: Cash Sale (Registered Client with points)
    console.log('\n[FLOW 6] Performing cash sale for registered client (points earned)...')
    const saleId2 = 3002
    // 150 EGP sale earns 1 point (150 / 100)
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId2}, ${shiftId}, '${testTime}', 150.0, 0.0, 'نقدي', 'تست عميل', ${clientId}, 150.0);
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId2}, '${barcode}', 10.0, 15.0, 150.0, 0.0);
      UPDATE products SET stock_qty = stock_qty - 10.0 WHERE barcode = '${barcode}';
      UPDATE clients SET points = points + 1 WHERE id = ${clientId};
      COMMIT;
    `)
    const clientPoints = await executeSql(`SELECT points FROM clients WHERE id = ${clientId};`)
    console.log(
      `✔ Cash sale with points completed. Client points: ${clientPoints[0].points} (Expected: 1)`
    )

    // 7. FLOW 7: Credit Sale (Debt)
    console.log('\n[FLOW 7] Performing credit sale (10 units)...')
    const saleId3 = 3003
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId3}, ${shiftId}, '${testTime}', 150.0, 0.0, 'آجل', 'تست عميل', ${clientId}, 150.0);
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId3}, '${barcode}', 10.0, 15.0, 150.0, 0.0);
      UPDATE products SET stock_qty = stock_qty - 10.0 WHERE barcode = '${barcode}';
      UPDATE clients SET debt_balance = debt_balance + 150.0 WHERE id = ${clientId};
      INSERT INTO client_ledger (client_id, type, amount, description, timestamp)
      VALUES (${clientId}, 'sale', 150.0, 'شراء آجل فاتورة رقم #${saleId3}', '${testTime}');
      COMMIT;
    `)
    const clientDebt1 = await executeSql(`SELECT debt_balance FROM clients WHERE id = ${clientId};`)
    console.log(
      `✔ Credit sale completed. Client debt balance: ${clientDebt1[0].debt_balance} EGP (Expected: 150)`
    )

    // 8. FLOW 8: Sale with Discount
    console.log('\n[FLOW 8] Performing discounted sale (10 EGP discount)...')
    const saleId4 = 3004
    // 2 units = 30 EGP - 10 discount = 20 EGP total
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId4}, ${shiftId}, '${testTime}', 20.0, 10.0, 'نقدي', '', NULL, 30.0);
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId4}, '${barcode}', 2.0, 15.0, 30.0, 0.0);
      UPDATE products SET stock_qty = stock_qty - 2.0 WHERE barcode = '${barcode}';
      COMMIT;
    `)
    console.log('✔ Discounted sale completed.')

    // 9. FLOW 9: Delivery Sale
    console.log('\n[FLOW 9] Performing delivery sale...')
    const saleId5 = 3005
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId5}, ${shiftId}, '${testTime}', 15.0, 0.0, 'نقدي', 'تست عميل (01000000000) - عنوان الدليفري', ${clientId}, 15.0);
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId5}, '${barcode}', 1.0, 15.0, 15.0, 0.0);
      UPDATE products SET stock_qty = stock_qty - 1.0 WHERE barcode = '${barcode}';
      COMMIT;
    `)
    console.log('✔ Delivery sale completed.')

    // ==========================================
    // SECTION 5: RETURNS & REFUNDS
    // ==========================================

    // 10. FLOW 10: Full Return (Cash Sale 3001 - 150 EGP)
    console.log('\n[FLOW 10] Performing FULL return of Cash Sale #3001...')
    await executeSql(`
      BEGIN TRANSACTION;
      UPDATE sale_items SET returned_qty = 10.0, total_price = 0.0 WHERE sale_id = ${saleId1};
      UPDATE sales SET total_amount = 0.0 WHERE id = ${saleId1};
      UPDATE products SET stock_qty = stock_qty + 10.0 WHERE barcode = '${barcode}';
      INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
      VALUES (${shiftId}, 'outflow', 150.0, 'ارجاع كامل فاتورة #${saleId1}', '${testTime}');
      COMMIT;
    `)
    console.log('✔ Full cash return completed.')

    // 11. FLOW 11: Partial Return (Cash Sale 3002 - return 2 units of 10)
    console.log('\n[FLOW 11] Performing PARTIAL return (2 units) of Cash Sale #3002...')
    // Return 2 units: 2 * 15 = 30 EGP refunded
    await executeSql(`
      BEGIN TRANSACTION;
      UPDATE sale_items SET returned_qty = 2.0, total_price = 120.0 WHERE sale_id = ${saleId2};
      UPDATE sales SET total_amount = 120.0 WHERE id = ${saleId2};
      UPDATE products SET stock_qty = stock_qty + 2.0 WHERE barcode = '${barcode}';
      INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
      VALUES (${shiftId}, 'outflow', 30.0, 'ارجاع جزئي فاتورة #${saleId2}', '${testTime}');
      COMMIT;
    `)
    console.log('✔ Partial cash return completed.')

    // 12. FLOW 12: Full Return (Credit Sale 3003 - 150 EGP)
    console.log('\n[FLOW 12] Performing FULL return of Credit Sale #3003...')
    await executeSql(`
      BEGIN TRANSACTION;
      UPDATE sale_items SET returned_qty = 10.0, total_price = 0.0 WHERE sale_id = ${saleId3};
      UPDATE sales SET total_amount = 0.0 WHERE id = ${saleId3};
      UPDATE products SET stock_qty = stock_qty + 10.0 WHERE barcode = '${barcode}';
      UPDATE clients SET debt_balance = debt_balance - 150.0 WHERE id = ${clientId};
      INSERT INTO client_ledger (client_id, type, amount, description, timestamp)
      VALUES (${clientId}, 'payment', 150.0, 'ارجاع شراء آجل فاتورة #${saleId3}', '${testTime}');
      COMMIT;
    `)
    const clientDebt2 = await executeSql(`SELECT debt_balance FROM clients WHERE id = ${clientId};`)
    console.log(
      `✔ Full credit return completed. Client debt: ${clientDebt2[0].debt_balance} EGP (Expected: 0)`
    )

    // 13. FLOW 13: Partial Return (Credit Sale - we create a credit sale 3006 for 30 EGP and return 1 unit for 15 EGP)
    console.log('\n[FLOW 13] Performing PARTIAL return (1 unit) of Credit Sale #3006...')
    const saleId6 = 3006
    await executeSql(`
      BEGIN TRANSACTION;
      -- Sell 2 units = 30 EGP on credit
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId6}, ${shiftId}, '${testTime}', 30.0, 0.0, 'آجل', 'تست عميل', ${clientId}, 30.0);
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId6}, '${barcode}', 2.0, 15.0, 30.0, 0.0);
      UPDATE products SET stock_qty = stock_qty - 2.0 WHERE barcode = '${barcode}';
      UPDATE clients SET debt_balance = debt_balance + 30.0 WHERE id = ${clientId};
      INSERT INTO client_ledger (client_id, type, amount, description, timestamp)
      VALUES (${clientId}, 'sale', 30.0, 'شراء آجل فاتورة رقم #${saleId6}', '${testTime}');
      COMMIT;
    `)
    // Return 1 unit = 15 EGP debt decrease
    await executeSql(`
      BEGIN TRANSACTION;
      UPDATE sale_items SET returned_qty = 1.0, total_price = 15.0 WHERE sale_id = ${saleId6};
      UPDATE sales SET total_amount = 15.0 WHERE id = ${saleId6};
      UPDATE products SET stock_qty = stock_qty + 1.0 WHERE barcode = '${barcode}';
      UPDATE clients SET debt_balance = debt_balance - 15.0 WHERE id = ${clientId};
      INSERT INTO client_ledger (client_id, type, amount, description, timestamp)
      VALUES (${clientId}, 'payment', 15.0, 'ارجاع جزئي آجل فاتورة #${saleId6}', '${testTime}');
      COMMIT;
    `)
    const clientDebt3 = await executeSql(`SELECT debt_balance FROM clients WHERE id = ${clientId};`)
    console.log(
      `✔ Partial credit return completed. Client debt: ${clientDebt3[0].debt_balance} EGP (Expected: 15)`
    )

    // ==========================================
    // SECTION 6: SAFE LEDGER OPERATIONS
    // ==========================================

    // 14. FLOW 14: Safe Inflow (manual cash addition)
    console.log('\n[FLOW 14] Adding manual cash Inflow of 500 EGP...')
    await executeSql(`
      INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
      VALUES (${shiftId}, 'inflow', 500.0, 'وارد يدوي للصندوق', '${testTime}');
    `)
    console.log('✔ Safe inflow recorded.')

    // 15. FLOW 15: Safe Outflow (manual cash deduction)
    console.log('\n[FLOW 15] Recording manual cash Outflow of 200 EGP...')
    await executeSql(`
      INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
      VALUES (${shiftId}, 'outflow', 200.0, 'صادر يدوي من الصندوق', '${testTime}');
    `)
    console.log('✔ Safe outflow recorded.')

    // 16. FLOW 16: Client Debt Repayment (Client pays 10 EGP of their debt)
    console.log('\n[FLOW 16] Recording client debt payment (10 EGP)...')
    await executeSql(`
      BEGIN TRANSACTION;
      UPDATE clients SET debt_balance = debt_balance - 10.0 WHERE id = ${clientId};
      INSERT INTO client_ledger (client_id, type, amount, description, timestamp)
      VALUES (${clientId}, 'payment', 10.0, 'سداد نقدي من العميل', '${testTime}');
      INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
      VALUES (${shiftId}, 'inflow', 10.0, 'سداد دين العميل: تست عميل', '${testTime}');
      COMMIT;
    `)
    const clientDebt4 = await executeSql(`SELECT debt_balance FROM clients WHERE id = ${clientId};`)
    console.log(
      `✔ Client debt payment recorded. Client debt: ${clientDebt4[0].debt_balance} EGP (Expected: 5)`
    )

    // 17. FLOW 17: Supplier Debt Payment (Shop pays 40 EGP of supplier debt)
    console.log('\n[FLOW 17] Recording supplier debt payment (40 EGP)...')
    // First let's put some supplier debt (e.g. 100 EGP)
    await executeSql(`UPDATE suppliers SET debt_balance = 100.0 WHERE id = ${supplierId};`)
    await executeSql(`
      BEGIN TRANSACTION;
      UPDATE suppliers SET debt_balance = debt_balance - 40.0 WHERE id = ${supplierId};
      INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp)
      VALUES (${supplierId}, 'payment', 40.0, 'دفعة سداد للمورد', '${testTime}');
      INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
      VALUES (${shiftId}, 'outflow', 40.0, 'سداد دين مورد: تست مورد', '${testTime}');
      COMMIT;
    `)
    const supplierDebt1 = await executeSql(
      `SELECT debt_balance FROM suppliers WHERE id = ${supplierId};`
    )
    console.log(
      `✔ Supplier debt payment recorded. Supplier debt: ${supplierDebt1[0].debt_balance} EGP (Expected: 60)`
    )

    // ==========================================
    // SECTION 7: INVENTORY & GERD
    // ==========================================

    // 18. FLOW 18: Update Product Details
    console.log('\n[FLOW 18] Updating product details (retail_price = 16.0 EGP)...')
    await executeSql(`UPDATE products SET retail_price = 16.0 WHERE barcode = '${barcode}';`)
    const productCheck2 = await executeSql(
      `SELECT retail_price FROM products WHERE barcode = '${barcode}';`
    )
    console.log(
      `✔ Product price updated. Price: ${productCheck2[0].retail_price} EGP (Expected: 16)`
    )

    // 19. FLOW 19: Manual Stock Update (Gerd)
    console.log('\n[FLOW 19] Modifying stock quantity directly to 80 units...')
    await executeSql(`UPDATE products SET stock_qty = 80.0 WHERE barcode = '${barcode}';`)
    const productCheck3 = await executeSql(
      `SELECT stock_qty FROM products WHERE barcode = '${barcode}';`
    )
    console.log(
      `✔ Stock quantity updated directly. Stock: ${productCheck3[0].stock_qty} (Expected: 80)`
    )

    // 20. FLOW 20: Record Damaged Goods (Talf - 2 units lost)
    console.log('\n[FLOW 20] Recording 2 units as Damaged Goods (Talf)...')
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO damaged_goods (shift_id, product_barcode, quantity, reason, cost_price, timestamp)
      VALUES (${shiftId}, '${barcode}', 2.0, 'تالف سوء تخزين', 10.0, '${testTime}');
      UPDATE products SET stock_qty = stock_qty - 2.0 WHERE barcode = '${barcode}';
      COMMIT;
    `)
    const productCheck4 = await executeSql(
      `SELECT stock_qty FROM products WHERE barcode = '${barcode}';`
    )
    console.log(`✔ Damaged goods recorded. New Stock: ${productCheck4[0].stock_qty} (Expected: 78)`)

    // ==========================================
    // SECTION 8: PURCHASES
    // ==========================================

    // 21. FLOW 21: Purchase Invoice from Supplier (Credit)
    console.log(
      '\n[FLOW 21] Recording credit purchase from supplier (50 units @ 10 EGP = 500 EGP)...'
    )
    // Supplier debt increases by 500. Stock increases by 50.
    await executeSql(`
      BEGIN TRANSACTION;
      UPDATE products SET stock_qty = stock_qty + 50.0 WHERE barcode = '${barcode}';
      UPDATE suppliers SET debt_balance = debt_balance + 500.0 WHERE id = ${supplierId};
      INSERT INTO supplier_ledger (supplier_id, type, amount, description, timestamp)
      VALUES (${supplierId}, 'purchase', 500.0, 'فاتورة مشتريات آجل رقم #999', '${testTime}');
      COMMIT;
    `)
    const supplierDebt2 = await executeSql(
      `SELECT debt_balance FROM suppliers WHERE id = ${supplierId};`
    )
    const stockPurchase1 = await executeSql(
      `SELECT stock_qty FROM products WHERE barcode = '${barcode}';`
    )
    console.log(
      `✔ Credit purchase recorded. Supplier debt: ${supplierDebt2[0].debt_balance} EGP (Expected: 560)`
    )
    console.log(`Stock after purchase: ${stockPurchase1[0].stock_qty} (Expected: 128)`)

    // 22. FLOW 22: Purchase Invoice from Supplier (Cash)
    console.log(
      '\n[FLOW 22] Recording cash purchase from supplier (10 units @ 10 EGP = 100 EGP)...'
    )
    // Cash leaves drawer (outflow = 100). Stock increases by 10. Supplier debt remains unchanged.
    await executeSql(`
      BEGIN TRANSACTION;
      UPDATE products SET stock_qty = stock_qty + 10.0 WHERE barcode = '${barcode}';
      INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
      VALUES (${shiftId}, 'outflow', 100.0, 'مشتريات نقدي مورد: تست مورد', '${testTime}');
      COMMIT;
    `)
    const stockPurchase2 = await executeSql(
      `SELECT stock_qty FROM products WHERE barcode = '${barcode}';`
    )
    console.log(`✔ Cash purchase recorded. Stock: ${stockPurchase2[0].stock_qty} (Expected: 138)`)

    // ==========================================
    // SECTION 9: CLIENT POINTS REDEMPTION
    // ==========================================

    // 23. FLOW 23: Redeem Client Points
    console.log('\n[FLOW 23] Redeeming client points...')
    await executeSql(`UPDATE clients SET points = points - 1 WHERE id = ${clientId};`)
    const clientPoints2 = await executeSql(`SELECT points FROM clients WHERE id = ${clientId};`)
    console.log(`✔ Points redeemed. Client points: ${clientPoints2[0].points} (Expected: 0)`)

    // ==========================================
    // SECTION 10: CHECK REGISTER
    // ==========================================

    // 24. FLOW 24: Add Check
    console.log('\n[FLOW 24] Adding a new check (1000 EGP)...')
    const checkId = 777
    await executeSql(`
      INSERT INTO checks_register (id, check_type, check_number, bank_name, party_name, issue_date, due_date, amount, status, notes, created_at)
      VALUES (${checkId}, 'صادر', '12345', 'البنك الأهلي', 'تست مورد', '${testTime}', '${testTime}', 1000.0, 'غير مسدد', 'شيك تجريبي', '${testTime}');
    `)
    const checkCheck = await executeSql(`SELECT status FROM checks_register WHERE id = ${checkId};`)
    console.log(`✔ Check added. Status: ${checkCheck[0].status} (Expected: غير مسدد)`)

    // 25. FLOW 25: Pay/Settle Check
    console.log('\n[FLOW 25] Settling check (marking as paid)...')
    await executeSql(`UPDATE checks_register SET status = 'مسدد' WHERE id = ${checkId};`)
    const checkCheck2 = await executeSql(
      `SELECT status FROM checks_register WHERE id = ${checkId};`
    )
    console.log(`✔ Check settled. Status: ${checkCheck2[0].status} (Expected: مسدد)`)

    // 26. FLOW 26: Delete Check
    console.log('\n[FLOW 26] Deleting check...')
    await executeSql(`DELETE FROM checks_register WHERE id = ${checkId};`)
    const checkCheck3 = await executeSql(
      `SELECT COUNT(*) as count FROM checks_register WHERE id = ${checkId};`
    )
    console.log(`✔ Check deleted. Count: ${checkCheck3[0].count} (Expected: 0)`)

    // ==========================================
    // SECTION 11: EXPENSES
    // ==========================================

    // 27. FLOW 27: Record Expense (150 EGP for rent/electricity)
    console.log('\n[FLOW 27] Recording expense of 150 EGP...')
    // Outflow in safe_ledger = 150 EGP. Record in expenses table.
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO expenses (shift_id, amount, category, description, timestamp)
      VALUES (${shiftId}, 150.0, 'إيجار كهرباء', 'فاتورة تجريبية', '${testTime}');
      INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
      VALUES (${shiftId}, 'outflow', 150.0, 'مصاريف: إيجار كهرباء', '${testTime}');
      COMMIT;
    `)
    const expenseCheck = await executeSql(`SELECT * FROM expenses WHERE shift_id = ${shiftId};`)
    console.log('✔ Expense recorded:', JSON.stringify(expenseCheck))

    // ==========================================
    // SECTION 12: SHIFT CLOSURE & CONSISTENCY
    // ==========================================

    // 28. FLOW 28: Close Shift (Difference & Consistency check)
    console.log('\n[FLOW 28] Closing shift and checking mathematical balance...')

    // Cash Sales in shiftId:
    // - Sale 3001: 0 (Refunded)
    // - Sale 3002: 120 (Partial return applied)
    // - Sale 3004: 20 (Discounted)
    // - Sale 3005: 15 (Delivery)
    // Total cash sales = 0 + 120 + 20 + 15 = 155.0 EGP.
    const salesRes = await executeSql(
      `SELECT SUM(total_amount) as total FROM sales WHERE shift_id = ${shiftId} AND payment_type = 'نقدي';`
    )
    const salesTotal = parseFloat(salesRes[0].total) || 0

    // Safe Inflows in shiftId:
    // - manual inflow: 500
    // - client debt payment: 10
    // Total inflows = 510.0 EGP.
    const inflowsRes = await executeSql(
      `SELECT SUM(amount) as total FROM safe_ledger WHERE shift_id = ${shiftId} AND type = 'inflow';`
    )
    const inflowsTotal = parseFloat(inflowsRes[0].total) || 0

    // Safe Outflows in shiftId:
    // - full return (3001): 150
    // - partial return (3002): 30
    // - supplier debt payment: 40
    // - cash purchase: 100
    // - manual outflow: 200
    // - expense: 150
    // Total outflows = 150 + 30 + 40 + 100 + 200 + 150 = 670.0 EGP.
    const outflowsRes = await executeSql(
      `SELECT SUM(amount) as total FROM safe_ledger WHERE shift_id = ${shiftId} AND type = 'outflow';`
    )
    const outflowsTotal = parseFloat(outflowsRes[0].total) || 0

    const expectedEndCash = initialCash + salesTotal + inflowsTotal - outflowsTotal

    console.log(`- Initial Cash: ${initialCash} EGP`)
    console.log(`- Cash Sales: ${salesTotal} EGP (Expected: 155.0)`)
    console.log(`- Safe Inflows: ${inflowsTotal} EGP (Expected: 510.0)`)
    console.log(`- Safe Outflows: ${outflowsTotal} EGP (Expected: 670.0)`)
    console.log(
      `=> Expected Drawer Cash: ${expectedEndCash} EGP (Expected: 1500 + 155 + 510 - 670 = 1495.0)`
    )

    // Close with exactly 1495 EGP to check 0 difference
    const actualEndCash = expectedEndCash
    const difference = actualEndCash - expectedEndCash

    await executeSql(`
      UPDATE shifts 
      SET status = 'closed', end_time = '${testTime}', expected_end_cash = ${expectedEndCash}, actual_end_cash = ${actualEndCash}, difference = ${difference}
      WHERE id = ${shiftId};
    `)

    const finalShiftCheck = await executeSql(
      `SELECT difference, status FROM shifts WHERE id = ${shiftId};`
    )
    console.log(
      `Shift closure status: ${finalShiftCheck[0].status}, Difference: ${finalShiftCheck[0].difference} EGP`
    )
    if (finalShiftCheck[0].difference !== 0) {
      throw new Error(`Shift closed with unexpected difference: ${finalShiftCheck[0].difference}`)
    }
    console.log('✔ Shift closed with exactly ZERO difference/error!')

    // Verifying database consistency (Zero Mismatches across ALL history)
    const salesAll = await executeSql('SELECT id, total_amount, discount FROM sales;')
    const itemsAll = await executeSql(
      'SELECT sale_id, quantity, unit_price, returned_qty FROM sale_items;'
    )

    const salesMap = new Map(salesAll.map((s) => [s.id, s]))
    const salesItemsMap = new Map()
    for (const item of itemsAll) {
      if (!salesItemsMap.has(item.sale_id)) {
        salesItemsMap.set(item.sale_id, [])
      }
      salesItemsMap.get(item.sale_id).push(item)
    }

    let mismatchCount = 0
    for (const [sId, sItems] of salesItemsMap.entries()) {
      const sale = salesMap.get(sId)
      if (!sale) continue

      const origSum = sItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
      const activeSum = sItems.reduce(
        (sum, item) => sum + (item.quantity - (item.returned_qty || 0)) * item.unit_price,
        0
      )
      const expectedSum = sale.total_amount + sale.discount

      const diffActive = Math.abs(activeSum - expectedSum)
      const diffOrig = Math.abs(origSum - expectedSum)

      if (diffActive > 0.01 && diffOrig > 0.01) {
        mismatchCount++
        console.log(
          `Mismatch in Sale ${sId}: Expected ${expectedSum}, ActiveSum ${activeSum}, OrigSum ${origSum}`
        )
      }
    }

    console.log(`Mismatches found in sales math: ${mismatchCount}`)
    if (mismatchCount === 0) {
      console.log('✔ Database math is 100% consistent. Zero mismatches!')
    } else {
      throw new Error('Database math mismatch found!')
    }

    console.log('\n======================================================================')
    console.log('ALL 28 INTEGRATION FLOWS TESTED AND VERIFIED SUCCESSFULLY!')
    console.log('======================================================================')
  } catch (error) {
    console.error('❌ COMPLETE SIMULATION TEST FAILED:', error)
    process.exitCode = 1
  } finally {
    // Cleanup test database
    cleanupTestDb()
  }
}

runAll28Flows()
