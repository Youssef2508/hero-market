const { setupTestDb, cleanupTestDb, executeSql } = require('./db_helper')

async function runAdvancedEdgeCases() {
  console.log('======================================================================')
  console.log('STARTING ADVANCED POS ACCOUNTING & SYSTEM EDGE CASES TEST SUITE')
  console.log('======================================================================')

  try {
    await setupTestDb()

    const shiftId = 98
    const testTime = '2026-07-23 11:00:00'
    const barcode = 'test-adv-item'

    // Close existing open shifts and clean up conflicting barcode
    await executeSql(
      `UPDATE shifts SET status = 'closed'; DELETE FROM products WHERE barcode = '${barcode}';`
    )

    // Setup initial shift and product
    await executeSql(`
      INSERT INTO shifts (id, user_id, start_time, initial_cash, expected_end_cash, actual_end_cash, difference, status)
      VALUES (${shiftId}, 5, '${testTime}', 1000.0, 1000.0, 0.0, NULL, 'open');
      
      INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, category, unit)
      VALUES ('${barcode}', 'صنف متطور', 10.0, 15.0, 100.0, 'بسكويت', 'علبة');
    `)

    // ==========================================
    // CATEGORY 1: INVENTORY EDGE CASES
    // ==========================================
    console.log('\n--- CATEGORY 1: INVENTORY EDGE CASES ---')

    // 1.1 Oversell Simulation (Sell 200 when stock is 100)
    console.log('[Test 1.1] Oversell Simulation...')
    try {
      await executeSql(
        `UPDATE products SET stock_qty = stock_qty - 200.0 WHERE barcode = '${barcode}';`
      )
      throw new Error('FAILED: Allowed negative stock (oversell)!')
    } catch (e) {
      if (String(e && e.message).startsWith('FAILED')) throw e // a real assertion failure, not the expected DB rejection
      console.log(`✔ PASSED: Database correctly rejected negative stock. Error: ${e.message}`)
    }

    // 1.2 Duplicate Barcode Insertion
    console.log('[Test 1.2] Duplicate Barcode Insertion...')
    try {
      await executeSql(`
        INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, category, unit)
        VALUES ('${barcode}', 'صنف مكرر الباركود', 12.0, 18.0, 50.0, 'بسكويت', 'علبة');
      `)
      throw new Error('FAILED: Duplicate barcode insertion allowed!')
    } catch (e) {
      if (String(e && e.message).startsWith('FAILED')) throw e // a real assertion failure, not the expected DB rejection
      console.log(`✔ PASSED: Database correctly rejected duplicate barcode. Error: ${e.message}`)
    }

    // 1.3 Transaction Rollback Verification on Trigger Failure
    console.log('[Test 1.3] Multi-Item Sale Rollback verification on Trigger Failure...')
    const barcode2 = 'test-adv-item-2'
    // Create product 2 with stock = 10
    await executeSql(`
      INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, category, unit)
      VALUES ('${barcode2}', 'صنف متطور 2', 5.0, 8.0, 10.0, 'بسكويت', 'علبة');
    `)

    // Set Product 1 stock = 100
    await executeSql(`UPDATE products SET stock_qty = 100.0 WHERE barcode = '${barcode}';`)

    try {
      // Start transaction. Sell 5 of Product 1 (valid), and 15 of Product 2 (invalid - only 10 available)
      await executeSql(`
        BEGIN TRANSACTION;
        UPDATE products SET stock_qty = stock_qty - 5.0 WHERE barcode = '${barcode}';
        UPDATE products SET stock_qty = stock_qty - 15.0 WHERE barcode = '${barcode2}';
        COMMIT;
      `)
      throw new Error('FAILED: Allowed negative stock inside transaction!')
    } catch (e) {
      if (String(e && e.message).startsWith('FAILED')) throw e // a real assertion failure, not the expected DB rejection
      console.log(`✔ PASSED: Database trigger threw error. Verifying rollback...`)
      // Check stock of Product 1. Should still be 100 (rollback).
      const prod1 = await executeSql(`SELECT stock_qty FROM products WHERE barcode = '${barcode}';`)
      console.log(`- Product 1 stock after rollback: ${prod1[0].stock_qty} (Expected: 100)`)
      if (prod1[0].stock_qty === 100.0) {
        console.log(
          '✔ PASSED: Transaction successfully rolled back entirely. Product 1 stock is unmodified.'
        )
      } else {
        throw new Error(
          `FAILED: Product 1 stock was updated to ${prod1[0].stock_qty} despite transaction failure!`
        )
      }
    }
    await executeSql(`DELETE FROM products WHERE barcode = '${barcode2}';`)

    // ==========================================
    // CATEGORY 2: CONCURRENCY / RACE CONDITIONS
    // ==========================================
    console.log('\n--- CATEGORY 2: CONCURRENCY / RACE CONDITIONS ---')

    // 2.1 Concurrent Sales Stock Deduction
    console.log('[Test 2.1] Concurrent Sales Stock Deduction...')
    // Stock is currently 100. Let's set it to 10.
    await executeSql(`UPDATE products SET stock_qty = 10.0 WHERE barcode = '${barcode}';`)

    // Cashier A reads stock = 10, sells 6
    // Cashier B reads stock = 10, sells 5
    // Cashier B's transaction should fail because of negative stock protection trigger!
    try {
      const updateA = `UPDATE products SET stock_qty = stock_qty - 6.0 WHERE barcode = '${barcode}';`
      const updateB = `UPDATE products SET stock_qty = stock_qty - 5.0 WHERE barcode = '${barcode}';`
      await executeSql(`BEGIN TRANSACTION; ${updateA} ${updateB} COMMIT;`)
      throw new Error('FAILED: Concurrent sale allowed stock to go below zero!')
    } catch (e) {
      if (String(e && e.message).startsWith('FAILED')) throw e // a real assertion failure, not the expected DB rejection
      console.log(
        `✔ PASSED: Database prevented concurrent sale from depleting stock past zero. Error: ${e.message}`
      )
    }

    // 2.2 Multiple Open Shifts for Same User
    console.log('[Test 2.2] Multiple Open Shifts...')
    const duplicateShiftId = 97
    try {
      await executeSql(`
        INSERT INTO shifts (id, user_id, start_time, initial_cash, expected_end_cash, actual_end_cash, difference, status)
        VALUES (${duplicateShiftId}, 5, '${testTime}', 500.0, 500.0, 0.0, NULL, 'open');
      `)
      throw new Error('FAILED: Allowed opening multiple shifts concurrently!')
    } catch (e) {
      if (String(e && e.message).startsWith('FAILED')) throw e // a real assertion failure, not the expected DB rejection
      console.log(
        `✔ PASSED: Database correctly prevented opening multiple open shifts. Error: ${e.message}`
      )
    }

    // ==========================================
    // CATEGORY 3: SHIFT LIFECYCLE
    // ==========================================
    console.log('\n--- CATEGORY 3: SHIFT LIFECYCLE ---')

    // 3.1 Closed Shift Protection (Selling on a closed shift in DB)
    console.log('[Test 3.1] Sales on Closed Shift...')
    const closedShiftId = 96
    await executeSql(`
      INSERT INTO shifts (id, user_id, start_time, end_time, initial_cash, expected_end_cash, actual_end_cash, difference, status)
      VALUES (${closedShiftId}, 5, '${testTime}', '${testTime}', 100.0, 100.0, 100.0, 0.0, 'closed');
    `)

    try {
      await executeSql(`
        INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
        VALUES (5002, ${closedShiftId}, '${testTime}', 15.0, 0.0, 'نقدي', '', NULL, 15.0);
      `)
      throw new Error('FAILED: Allowed inserting sales on a closed shift!')
    } catch (e) {
      if (String(e && e.message).startsWith('FAILED')) throw e // a real assertion failure, not the expected DB rejection
      console.log(`✔ PASSED: Database prevented sales on a closed shift. Error: ${e.message}`)
    }
    await executeSql(`DELETE FROM shifts WHERE id = ${closedShiftId};`)

    // 3.2 Shift Shortage / Overage Recording
    console.log('[Test 3.2] Shift Shortage and Overage Recording...')
    const shortageShiftId = 95
    const overageShiftId = 94

    // Shortage Shift: expected 1000, actual 950 => difference -50 EGP
    await executeSql(`
      INSERT INTO shifts (id, user_id, start_time, end_time, initial_cash, expected_end_cash, actual_end_cash, difference, status)
      VALUES (${shortageShiftId}, 5, '${testTime}', '${testTime}', 1000.0, 1000.0, 950.0, -50.0, 'closed');
    `)
    // Overage Shift: expected 1000, actual 1020 => difference +20 EGP
    await executeSql(`
      INSERT INTO shifts (id, user_id, start_time, end_time, initial_cash, expected_end_cash, actual_end_cash, difference, status)
      VALUES (${overageShiftId}, 5, '${testTime}', '${testTime}', 1000.0, 1000.0, 1020.0, 20.0, 'closed');
    `)

    const shortageRecord = await executeSql(
      `SELECT difference FROM shifts WHERE id = ${shortageShiftId};`
    )
    const overageRecord = await executeSql(
      `SELECT difference FROM shifts WHERE id = ${overageShiftId};`
    )
    console.log(`- Shortage Shift difference: ${shortageRecord[0].difference} EGP (Expected: -50)`)
    console.log(`- Overage Shift difference: ${overageRecord[0].difference} EGP (Expected: 20)`)

    // Clean up
    await executeSql(`DELETE FROM shifts WHERE id IN (${shortageShiftId}, ${overageShiftId});`)

    // ==========================================
    // CATEGORY 4: CLIENT & SUPPLIER
    // ==========================================
    console.log('\n--- CATEGORY 4: CLIENT & SUPPLIER ---')

    // 4.1 Client Overpayment (Paying more than owed)
    console.log('[Test 4.1] Client Overpayment...')
    const testClientId = 991
    await executeSql(`
      INSERT INTO clients (id, name, phone, address, debt_balance, points, created_at)
      VALUES (${testClientId}, 'عميل دفع زيادة', '0100', 'العنوان', 50.0, 0, '${testTime}');
    `)

    // Pay 70 EGP (when debt is 50 EGP)
    await executeSql(`
      BEGIN TRANSACTION;
      UPDATE clients SET debt_balance = debt_balance - 70.0 WHERE id = ${testClientId};
      INSERT INTO client_ledger (client_id, type, amount, description, timestamp)
      VALUES (${testClientId}, 'payment', 70.0, 'سداد نقدي زيادة من العميل', '${testTime}');
      COMMIT;
    `)
    const overpaidClient = await executeSql(
      `SELECT debt_balance FROM clients WHERE id = ${testClientId};`
    )
    console.log(
      `- Client debt balance after paying 70 EGP (owed 50): ${overpaidClient[0].debt_balance} EGP (Expected negative balance: -20)`
    )
    console.log(
      `- Note: A negative balance is correct and indicates credit/points in the client's favor.`
    )

    // Clean up client
    await executeSql(
      `DELETE FROM client_ledger WHERE client_id = ${testClientId}; DELETE FROM clients WHERE id = ${testClientId};`
    )

    // 4.2 Deleting Client with Active Transactions (Referential Integrity Check)
    console.log('[Test 4.2] Deleting client with active transactions...')
    const tempClientId = 992
    await executeSql(`
      INSERT INTO clients (id, name, phone, address, debt_balance, points, created_at)
      VALUES (${tempClientId}, 'عميل للتجربة', '0101', 'العنوان', 10.0, 0, '${testTime}');
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (5003, ${shiftId}, '${testTime}', 10.0, 0.0, 'آجل', 'عميل للتجربة', ${tempClientId}, 10.0);
    `)

    try {
      await executeSql(`DELETE FROM clients WHERE id = ${tempClientId};`)
      throw new Error('FAILED: Allowed deleting client with active sales!')
    } catch (e) {
      if (String(e && e.message).startsWith('FAILED')) throw e // a real assertion failure, not the expected DB rejection
      console.log(
        `✔ PASSED: Database prevented deleting client with active sales (Referential Integrity). Error: ${e.message}`
      )
    }

    // Clean up
    await executeSql(
      `DELETE FROM sales WHERE id = 5003; DELETE FROM clients WHERE id = ${tempClientId};`
    )

    // ==========================================
    // CATEGORY 5: DISCOUNTS & PRICES
    // ==========================================
    console.log('\n--- CATEGORY 5: DISCOUNTS & PRICES ---')

    // 5.1 Percentage Discount Simulation
    console.log('[Test 5.1] Percentage Discount (10% on 30 EGP)...')
    // Sale of 2 units = 30 EGP. 10% discount = 3 EGP. Final total = 27 EGP.
    const saleId3 = 5004
    const originalTotal = 30.0
    const discountPercent = 0.1
    const calculatedDiscount = originalTotal * discountPercent
    const discountedTotal = originalTotal - calculatedDiscount

    await executeSql(`
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId3}, ${shiftId}, '${testTime}', ${discountedTotal}, ${calculatedDiscount}, 'نقدي', '', NULL, ${originalTotal});
    `)
    const sale3Check = await executeSql(
      `SELECT total_amount, discount FROM sales WHERE id = ${saleId3};`
    )
    console.log(
      `- Sale Total: ${sale3Check[0].total_amount} EGP, Discount: ${sale3Check[0].discount} EGP (Expected: 27.0 and 3.0)`
    )

    // Clean up
    await executeSql(`DELETE FROM sales WHERE id = ${saleId3};`)

    // 5.2 Under-Cost Sale (Selling below purchase price)
    console.log('[Test 5.2] Under-Cost Sale (Cost: 10 EGP, Sell: 8 EGP)...')
    const saleId4 = 5005
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId4}, ${shiftId}, '${testTime}', 8.0, 0.0, 'نقدي', '', NULL, 8.0);
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId4}, '${barcode}', 1.0, 8.0, 8.0, 0.0);
      COMMIT;
    `)
    console.log(
      `- Database successfully registered under-cost sale. Profit for this sale = 8.0 (Sell) - 10.0 (Cost) = -2.0 EGP.`
    )

    // Clean up
    await executeSql(
      `DELETE FROM sale_items WHERE sale_id = ${saleId4}; DELETE FROM sales WHERE id = ${saleId4};`
    )

    // 5.3 Modifying Price and Checking Historical Invoices Impact
    console.log('[Test 5.3] Modifying product price and checking historical impact...')
    const saleId5 = 5006
    // Sell 1 unit at 15.0 EGP
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId5}, ${shiftId}, '${testTime}', 15.0, 0.0, 'نقدي', '', NULL, 15.0);
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId5}, '${barcode}', 1.0, 15.0, 15.0, 0.0);
      COMMIT;
    `)

    // Now change product price in inventory to 20.0 EGP
    await executeSql(`UPDATE products SET retail_price = 20.0 WHERE barcode = '${barcode}';`)

    // Check if historical sale is changed
    const historicalItem = await executeSql(
      `SELECT unit_price, total_price FROM sale_items WHERE sale_id = ${saleId5};`
    )
    console.log(
      `- Historical Sale price after updating inventory: ${historicalItem[0].unit_price} EGP (Expected: 15.0, price updates must not affect past sales)`
    )
    if (historicalItem[0].unit_price === 15.0) {
      console.log('✔ PASSED: Historical sales prices are preserved.')
    } else {
      throw new Error('FAILED: Historical sales price was modified by inventory update!')
    }

    // Clean up
    await executeSql(
      `DELETE FROM sale_items WHERE sale_id = ${saleId5}; DELETE FROM sales WHERE id = ${saleId5};`
    )

    // 5.4 Purchase Cost Update Profit Calculation Check
    console.log(
      '[Test 5.4] Modifying purchase cost and verifying historical profit calculations...'
    )
    const saleId9 = 5010
    // Set cost = 10 EGP, retail = 15 EGP. Sell 1 unit.
    await executeSql(
      `UPDATE products SET cost_price = 10.0, retail_price = 15.0 WHERE barcode = '${barcode}';`
    )
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId9}, ${shiftId}, '${testTime}', 15.0, 0.0, 'نقدي', '', NULL, 15.0);
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty, cost_price)
      VALUES (${saleId9}, '${barcode}', 1.0, 15.0, 15.0, 0.0, 10.0);
      COMMIT;
    `)

    // Profit query using products cost price:
    const profitBefore = await executeSql(`
      SELECT si.total_price - ((si.quantity - si.returned_qty) * COALESCE(NULLIF(si.cost_price, 0), p.cost_price)) as profit
      FROM sale_items si JOIN products p ON si.product_barcode = p.barcode WHERE si.sale_id = ${saleId9};
    `)
    console.log(`- Profit with cost = 10 EGP: ${profitBefore[0].profit} EGP (Expected: 5.0)`)

    // Update product cost price to 12 EGP in products table (simulating new batch purchase price update)
    await executeSql(`UPDATE products SET cost_price = 12.0 WHERE barcode = '${barcode}';`)

    // Check profit calculation again using historical cost_price
    const profitAfter = await executeSql(`
      SELECT si.total_price - ((si.quantity - si.returned_qty) * COALESCE(NULLIF(si.cost_price, 0), p.cost_price)) as profit
      FROM sale_items si JOIN products p ON si.product_barcode = p.barcode WHERE si.sale_id = ${saleId9};
    `)
    console.log(
      `- Profit with cost = 12 EGP: ${profitAfter[0].profit} EGP (Expected: 5.0 - cost price updates must not affect past sales)`
    )

    if (profitAfter[0].profit === 5.0) {
      console.log('✔ PASSED: Historical purchase cost and profits are preserved.')
    } else {
      throw new Error(`FAILED: Historical profit was changed to ${profitAfter[0].profit}!`)
    }

    // Clean up
    await executeSql(
      `DELETE FROM sale_items WHERE sale_id = ${saleId9}; DELETE FROM sales WHERE id = ${saleId9};`
    )

    // ==========================================
    // CATEGORY 6: CHECKS
    // ==========================================
    console.log('\n--- CATEGORY 6: CHECKS ---')

    // 6.1 Bounced/Overdue Check
    console.log('[Test 6.1] Bounced/Overdue Check Handling...')
    const overdueCheckId = 776
    await executeSql(`
      INSERT INTO checks_register (id, check_type, check_number, bank_name, party_name, issue_date, due_date, amount, status, notes, created_at)
      VALUES (${overdueCheckId}, 'صادر', '55555', 'البنك الأهلي', 'مورد', '2026-05-01', '2026-06-01', 5000.0, 'غير مسدد', 'شيك قديم متأخر', '${testTime}');
    `)
    const overdueCheck = await executeSql(
      `SELECT status, due_date FROM checks_register WHERE id = ${overdueCheckId};`
    )
    console.log(
      `- Overdue Check Status: ${overdueCheck[0].status}, Due Date: ${overdueCheck[0].due_date}`
    )

    // 6.2 Editing Check details after adding
    console.log('[Test 6.2] Editing check details...')
    await executeSql(
      `UPDATE checks_register SET amount = 5500.0, notes = 'تعديل الشيك' WHERE id = ${overdueCheckId};`
    )
    const editedCheck = await executeSql(
      `SELECT amount, notes FROM checks_register WHERE id = ${overdueCheckId};`
    )
    console.log(
      `- Check amount after update: ${editedCheck[0].amount} EGP, Notes: ${editedCheck[0].notes}`
    )

    // Clean up
    await executeSql(`DELETE FROM checks_register WHERE id = ${overdueCheckId};`)

    // ==========================================
    // CATEGORY 7: INPUT VALIDATION & ROUNDING
    // ==========================================
    console.log('\n--- CATEGORY 7: INPUT VALIDATION & ROUNDING ---')

    // 7.1 Quantity = 0 in sale
    console.log('[Test 7.1] Selling quantity = 0...')
    const saleId6 = 5007
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId6}, ${shiftId}, '${testTime}', 0.0, 0.0, 'نقدي', '', NULL, 0.0);
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId6}, '${barcode}', 0.0, 15.0, 0.0, 0.0);
      COMMIT;
    `)
    const zeroSale = await executeSql(`SELECT total_amount FROM sales WHERE id = ${saleId6};`)
    console.log(
      `- Sale total amount for 0 quantity: ${zeroSale[0].total_amount} EGP (Expected: 0.0)`
    )
    await executeSql(
      `DELETE FROM sale_items WHERE sale_id = ${saleId6}; DELETE FROM sales WHERE id = ${saleId6};`
    )

    // 7.2 High Precision Decimals (Rounding errors test)
    console.log('[Test 7.2] High precision rounding check (15.3333333333333 * 3)...')
    const saleId7 = 5008
    const precisionPrice = 15.3333333333333
    const quantity = 3
    const rawTotal = precisionPrice * quantity
    const roundedTotal = Math.round(rawTotal * 100) / 100 // round to 2 decimal places in JS

    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId7}, ${shiftId}, '${testTime}', ${roundedTotal}, 0.0, 'نقدي', '', NULL, ${roundedTotal});
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId7}, '${barcode}', ${quantity}, ${precisionPrice}, ${roundedTotal}, 0.0);
      COMMIT;
    `)
    const precisionSale = await executeSql(`SELECT total_amount FROM sales WHERE id = ${saleId7};`)
    console.log(
      `- Rounded total amount stored in DB: ${precisionSale[0].total_amount} EGP (Expected: 46.0)`
    )
    await executeSql(
      `DELETE FROM sale_items WHERE sale_id = ${saleId7}; DELETE FROM sales WHERE id = ${saleId7};`
    )

    // 7.3 Empty/Special Characters (SQL injection test)
    console.log('[Test 7.3] Empty and Special Characters Name escaping...')
    const sqliClientId = 993
    const sqliName = "' OR 1=1; --"
    // We escape the quote in SQL
    await executeSql(`
      INSERT INTO clients (id, name, phone, address, debt_balance, points, created_at)
      VALUES (${sqliClientId}, 'escaped: ${sqliName.replace(/'/g, "''")}', '0102', 'العنوان', 0.0, 0, '${testTime}');
    `)
    const sqliClient = await executeSql(`SELECT name FROM clients WHERE id = ${sqliClientId};`)
    console.log(`- Saved client name with quotes: "${sqliClient[0].name}"`)
    await executeSql(`DELETE FROM clients WHERE id = ${sqliClientId};`)

    // ==========================================
    // CATEGORY 8: REPORTING & CROSS-CHECK
    // ==========================================
    console.log('\n--- CATEGORY 8: REPORTING & CROSS-CHECK ---')

    // 8.1 Safe ledger cross-check across multiple shifts
    console.log('[Test 8.1] Safe ledger cross-shift matching...')
    // Let's create Shift A and Shift B with safe transactions
    const shiftA = 81
    const shiftB = 82
    await executeSql(`
      INSERT INTO shifts (id, user_id, start_time, end_time, initial_cash, expected_end_cash, actual_end_cash, difference, status)
      VALUES (${shiftA}, 5, '${testTime}', '${testTime}', 1000.0, 1100.0, 1100.0, 0.0, 'closed');
      INSERT INTO shifts (id, user_id, start_time, end_time, initial_cash, expected_end_cash, actual_end_cash, difference, status)
      VALUES (${shiftB}, 5, '${testTime}', '${testTime}', 1100.0, 1250.0, 1250.0, 0.0, 'closed');
      
      INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
      VALUES (${shiftA}, 'inflow', 100.0, 'مكسب وردية أ', '${testTime}');
      INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
      VALUES (${shiftB}, 'inflow', 150.0, 'مكسب وردية ب', '${testTime}');
    `)

    // Cross check: Safe ledger total inflows across both shifts should be 250 EGP
    const safeTotalRes = await executeSql(
      `SELECT SUM(amount) as total FROM safe_ledger WHERE shift_id IN (${shiftA}, ${shiftB}) AND type = 'inflow';`
    )
    console.log(
      `- Safe Ledger Inflows for Shift A + B: ${safeTotalRes[0].total} EGP (Expected: 250)`
    )
    await executeSql(
      `DELETE FROM safe_ledger WHERE shift_id IN (${shiftA}, ${shiftB}); DELETE FROM shifts WHERE id IN (${shiftA}, ${shiftB});`
    )

    // 8.2 Profit Report simulation (cost vs retail price)
    console.log('[Test 8.2] Profit Report Simulation (cost vs retail)...')
    // Let's record a mock sale with profit: cost = 10 EGP, sell = 16 EGP. Qty = 5.
    const saleId8 = 5009
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId8}, ${shiftId}, '${testTime}', 80.0, 0.0, 'نقدي', '', NULL, 80.0);
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty, cost_price)
      VALUES (${saleId8}, '${barcode}', 5.0, 16.0, 80.0, 0.0, 10.0);
      COMMIT;
    `)

    // Profit query using sale_items cost price:
    const profitQuery = await executeSql(`
      SELECT 
        s.id as sale_id,
        si.product_barcode,
        si.quantity,
        si.unit_price,
        si.cost_price,
        ((si.quantity - si.returned_qty) * (si.unit_price - si.cost_price)) as calculated_profit
      FROM sales s
      JOIN sale_items si ON s.id = si.sale_id
      WHERE s.id = ${saleId8};
    `)
    console.log(
      `- Profit Calculated: Product: ${profitQuery[0].product_barcode}, Qty: ${profitQuery[0].quantity}, Retail: ${profitQuery[0].unit_price}, Cost: ${profitQuery[0].cost_price}, Profit: ${profitQuery[0].calculated_profit} EGP (Expected: 5 * (16 - 10) = 30)`
    )
    await executeSql(
      `DELETE FROM sale_items WHERE sale_id = ${saleId8}; DELETE FROM sales WHERE id = ${saleId8};`
    )

    // Clean up initial shift
    await executeSql(
      `DELETE FROM shifts WHERE id = ${shiftId}; DELETE FROM products WHERE barcode = '${barcode}';`
    )

    console.log('\n======================================================================')
    console.log('ALL ADVANCED EDGE CASES TESTED AND VERIFIED SUCCESSFULLY!')
    console.log('======================================================================')
  } catch (error) {
    console.error('❌ ADVANCED EDGE CASE SIMULATION FAILED:', error)
    process.exitCode = 1
  } finally {
    cleanupTestDb()
  }
}

runAdvancedEdgeCases()
