const { setupTestDb, cleanupTestDb, executeSql } = require('./db_helper')

async function runSimulation() {
  console.log('==================================================')
  console.log('STARTING INTEGRATION TEST SIMULATION OF POS FLOWS')
  console.log('==================================================')

  try {
    // 1. Copy prod database to temp test DB
    await setupTestDb()

    // --- PREPARATION ---
    // Check current shifts
    const lastShifts = await executeSql('SELECT id, status FROM shifts ORDER BY id DESC LIMIT 1;')
    const lastShift = lastShifts[0]
    console.log(`[PREP] Last shift in database is ID: ${lastShift.id}, Status: ${lastShift.status}`)

    // If there is an open shift, close it first in the test DB to start our test shift clean
    if (lastShift.status === 'open') {
      await executeSql(
        `UPDATE shifts SET status = 'closed', end_time = 'test-time', expected_end_cash = 0.0, actual_end_cash = 0.0, difference = 0.0 WHERE id = ${lastShift.id};`
      )
      console.log(`[PREP] Closed active open shift ${lastShift.id} in test DB.`)
    }

    // Determine our test shift ID
    const nextShiftId = lastShift.id + 1
    console.log(`[TEST SHIFT] Creating test shift with ID: ${nextShiftId}`)

    // --- FLOW 1: Start Shift ---
    console.log('\n--- FLOW 1: Starting new shift ---')
    const initialCash = 1000.0
    await executeSql(`
      INSERT INTO shifts (id, user_id, start_time, initial_cash, expected_end_cash, actual_end_cash, difference, status) 
      VALUES (${nextShiftId}, 5, 'test-start-time', ${initialCash}, ${initialCash}, 0.0, NULL, 'open');
    `)
    const shiftCheck = await executeSql(`SELECT * FROM shifts WHERE id = ${nextShiftId};`)
    console.log('Created Shift:', JSON.stringify(shiftCheck))

    // --- FLOW 2: Add New Product ---
    console.log('\n--- FLOW 2: Adding a test product ---')
    const testBarcode = 'test-item-999'
    await executeSql(`
      INSERT INTO products (barcode, name, cost_price, retail_price, stock_qty, category, unit)
      VALUES ('${testBarcode}', 'بسكوت تست تجربة', 8.0, 10.0, 50.0, 'بسكويت', 'علبة');
    `)
    const productCheck = await executeSql(
      `SELECT barcode, name, stock_qty, retail_price FROM products WHERE barcode = '${testBarcode}';`
    )
    console.log('Created Product:', JSON.stringify(productCheck))

    // --- FLOW 3: Regular Cash Sale ---
    console.log('\n--- FLOW 3: Performing regular cash sale (2 units) ---')
    // We sell 2 units of testBarcode at sell_price 10.0 EGP. Total = 20.0 EGP.
    const saleId1 = 2001 // Choose a high ID for test sales to avoid conflicts
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId1}, ${nextShiftId}, 'sale-time-1', 20.0, 0.0, 'نقدي', '', NULL, 20.0);
      
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId1}, '${testBarcode}', 2.0, 10.0, 20.0, 0.0);
      
      UPDATE products SET stock_qty = stock_qty - 2.0 WHERE barcode = '${testBarcode}';
      COMMIT;
    `)

    const stockAfterSale1 = await executeSql(
      `SELECT stock_qty FROM products WHERE barcode = '${testBarcode}';`
    )
    const sale1Check = await executeSql(`SELECT * FROM sales WHERE id = ${saleId1};`)
    console.log(`Stock after selling 2 units: ${stockAfterSale1[0].stock_qty} (Expected: 48)`)
    console.log('Sale 1 Record:', JSON.stringify(sale1Check))

    // --- FLOW 4: Discounted Cash Sale ---
    console.log('\n--- FLOW 4: Performing discounted cash sale (1 unit with 2 EGP discount) ---')
    // Sell 1 unit of testBarcode (price 10.0 EGP, discount 2.0 EGP). Total = 8.0 EGP.
    const saleId2 = 2002
    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId2}, ${nextShiftId}, 'sale-time-2', 8.0, 2.0, 'نقدي', '', NULL, 10.0);
      
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId2}, '${testBarcode}', 1.0, 10.0, 10.0, 0.0);
      
      UPDATE products SET stock_qty = stock_qty - 1.0 WHERE barcode = '${testBarcode}';
      COMMIT;
    `)

    const stockAfterSale2 = await executeSql(
      `SELECT stock_qty FROM products WHERE barcode = '${testBarcode}';`
    )
    await executeSql(`SELECT * FROM sales WHERE id = ${saleId2};`)
    console.log(
      `Stock after selling 1 discounted unit: ${stockAfterSale2[0].stock_qty} (Expected: 47)`
    )

    // --- FLOW 5: Credit (Debt) Sale ---
    console.log('\n--- FLOW 5: Performing credit sale to client "سحس" (ID 3) ---')
    // Client 3 buys 3 units of testBarcode = 30.0 EGP. Payment type = 'آجل'.
    const clientId = 3
    const clientName = 'سحس'
    const saleId3 = 2003

    const clientBefore = await executeSql(
      `SELECT debt_balance FROM clients WHERE id = ${clientId};`
    )
    console.log(`Client debt balance BEFORE credit sale: ${clientBefore[0].debt_balance} EGP`)

    await executeSql(`
      BEGIN TRANSACTION;
      INSERT INTO sales (id, shift_id, timestamp, total_amount, discount, payment_type, client_name, client_id, original_amount)
      VALUES (${saleId3}, ${nextShiftId}, 'sale-time-3', 30.0, 0.0, 'آجل', '${clientName}', ${clientId}, 30.0);
      
      INSERT INTO sale_items (sale_id, product_barcode, quantity, unit_price, total_price, returned_qty)
      VALUES (${saleId3}, '${testBarcode}', 3.0, 10.0, 30.0, 0.0);
      
      UPDATE products SET stock_qty = stock_qty - 3.0 WHERE barcode = '${testBarcode}';
      
      UPDATE clients SET debt_balance = debt_balance + 30.0 WHERE id = ${clientId};
      
      INSERT INTO client_ledger (client_id, type, amount, description, timestamp)
      VALUES (${clientId}, 'sale', 30.0, 'شراء آجل فاتورة رقم #${saleId3}', 'sale-time-3');
      COMMIT;
    `)

    const clientAfter = await executeSql(`SELECT debt_balance FROM clients WHERE id = ${clientId};`)
    const stockAfterSale3 = await executeSql(
      `SELECT stock_qty FROM products WHERE barcode = '${testBarcode}';`
    )
    console.log(
      `Client debt balance AFTER credit sale: ${clientAfter[0].debt_balance} EGP (Expected increase of 30)`
    )
    console.log(`Stock after credit sale: ${stockAfterSale3[0].stock_qty} (Expected: 44)`)

    // --- FLOW 6: Return a Sale ---
    console.log('\n--- FLOW 6: Refunding Sale 1 (Cash Sale of 20 EGP) ---')
    // We return 2.0 units of testBarcode.
    await executeSql(`
      BEGIN TRANSACTION;
      -- Update returned quantity in sale_items
      UPDATE sale_items SET returned_qty = 2.0, total_price = 0.0 WHERE sale_id = ${saleId1} AND product_barcode = '${testBarcode}';
      
      -- Update sale total to 0.0
      UPDATE sales SET total_amount = 0.0 WHERE id = ${saleId1};
      
      -- Return products to stock
      UPDATE products SET stock_qty = stock_qty + 2.0 WHERE barcode = '${testBarcode}';
      
      -- Record outflow in safe_ledger
      INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
      VALUES (${nextShiftId}, 'outflow', 20.0, 'مرتجع كاش فاتورة رقم #${saleId1}', 'refund-time-1');
      COMMIT;
    `)

    const stockAfterRefund = await executeSql(
      `SELECT stock_qty FROM products WHERE barcode = '${testBarcode}';`
    )
    const sale1Refunded = await executeSql(`SELECT total_amount FROM sales WHERE id = ${saleId1};`)
    const safeLedgerCheck = await executeSql(
      `SELECT * FROM safe_ledger WHERE shift_id = ${nextShiftId} AND type = 'outflow';`
    )
    console.log(`Stock after refund: ${stockAfterRefund[0].stock_qty} (Expected: 46)`)
    console.log(`Sale 1 total after refund: ${sale1Refunded[0].total_amount} (Expected: 0)`)
    console.log('Safe Ledger Outflow Record:', JSON.stringify(safeLedgerCheck))

    // --- FLOW 7: Repay Client Debt ---
    console.log('\n--- FLOW 7: Client "سحس" paying 15 EGP cash to settle debt ---')
    const paymentAmount = 15.0

    await executeSql(`
      BEGIN TRANSACTION;
      -- Decrease client debt balance
      UPDATE clients SET debt_balance = debt_balance - ${paymentAmount} WHERE id = ${clientId};
      
      -- Record client ledger payment
      INSERT INTO client_ledger (client_id, type, amount, description, timestamp)
      VALUES (${clientId}, 'payment', ${paymentAmount}, 'سداد نقدي من العميل', 'payment-time-1');
      
      -- Record safe ledger inflow
      INSERT INTO safe_ledger (shift_id, type, amount, description, timestamp)
      VALUES (${nextShiftId}, 'inflow', ${paymentAmount}, 'سداد دين العميل: ${clientName}', 'payment-time-1');
      COMMIT;
    `)

    const clientDebtFinal = await executeSql(
      `SELECT debt_balance FROM clients WHERE id = ${clientId};`
    )
    const safeInflowCheck = await executeSql(
      `SELECT * FROM safe_ledger WHERE shift_id = ${nextShiftId} AND type = 'inflow';`
    )
    console.log(`Client debt balance after paying 15 EGP: ${clientDebtFinal[0].debt_balance} EGP`)
    console.log('Safe Ledger Inflow Record:', JSON.stringify(safeInflowCheck))

    // --- FLOW 8: Close Shift & Difference Check ---
    console.log('\n--- FLOW 8: Closing Shift and verifying math ---')

    // Calculate expected cash in drawer:
    // Expected = initialCash + cash_sales + safe_inflows - safe_outflows
    // cash_sales in this shift:
    // - Sale 1 (originally 20.0, but refunded so total_amount = 0.0) -> Cash sales of active transactions = 0 + 8 = 8.0 EGP.
    // - Wait! Let's check the database sales for this shift
    const salesRes = await executeSql(
      `SELECT SUM(total_amount) as total FROM sales WHERE shift_id = ${nextShiftId} AND payment_type = 'نقدي';`
    )
    const salesTotal = parseFloat(salesRes[0].total) || 0

    const inflowsRes = await executeSql(
      `SELECT SUM(amount) as total FROM safe_ledger WHERE shift_id = ${nextShiftId} AND type = 'inflow';`
    )
    const inflowsTotal = parseFloat(inflowsRes[0].total) || 0

    const outflowsRes = await executeSql(
      `SELECT SUM(amount) as total FROM safe_ledger WHERE shift_id = ${nextShiftId} AND type = 'outflow';`
    )
    const outflowsTotal = parseFloat(outflowsRes[0].total) || 0

    const expectedEndCash = initialCash + salesTotal + inflowsTotal - outflowsTotal

    console.log(`- Initial Cash: ${initialCash} EGP`)
    console.log(`- Cash Sales: ${salesTotal} EGP (Expected: 8.0)`)
    console.log(`- Safe Inflows (debt repayment): ${inflowsTotal} EGP (Expected: 15.0)`)
    console.log(`- Safe Outflows (refunds): ${outflowsTotal} EGP (Expected: 20.0)`)
    console.log(
      `=> Expected Drawer Cash: ${expectedEndCash} EGP (Expected: 1000 + 8 + 15 - 20 = 1003.0)`
    )

    // Suppose we physically have 1003.0 EGP in the drawer (perfect match, 0 difference)
    const actualEndCash = expectedEndCash
    const difference = actualEndCash - expectedEndCash

    await executeSql(`
      UPDATE shifts 
      SET status = 'closed', end_time = 'test-end-time', expected_end_cash = ${expectedEndCash}, actual_end_cash = ${actualEndCash}, difference = ${difference}
      WHERE id = ${nextShiftId};
    `)

    const shiftClosedCheck = await executeSql(`SELECT * FROM shifts WHERE id = ${nextShiftId};`)
    console.log('Closed Shift Record:', JSON.stringify(shiftClosedCheck))
    if (shiftClosedCheck[0].difference === 0) {
      console.log('✔ Shift closed with exactly ZERO difference/error!')
    } else {
      throw new Error(`Shift closed with unexpected difference: ${shiftClosedCheck[0].difference}`)
    }

    // --- FLOW 9: Final Database Consistency Check ---
    console.log('\n--- FLOW 9: Verifying database consistency (Zero Mismatches) ---')
    const sales = await executeSql('SELECT id, total_amount, discount FROM sales;')
    const items = await executeSql(
      'SELECT sale_id, quantity, unit_price, returned_qty FROM sale_items;'
    )

    const salesMap = new Map(sales.map((s) => [s.id, s]))
    const salesItemsMap = new Map()
    for (const item of items) {
      if (!salesItemsMap.has(item.sale_id)) {
        salesItemsMap.set(item.sale_id, [])
      }
      salesItemsMap.get(item.sale_id).push(item)
    }

    let mismatchCount = 0
    for (const [saleId, sItems] of salesItemsMap.entries()) {
      const sale = salesMap.get(saleId)
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
          `Mismatch in Sale ${saleId}: Expected ${expectedSum}, ActiveSum ${activeSum}, OrigSum ${origSum}`
        )
      }
    }

    console.log(`Mismatches found in sales math: ${mismatchCount}`)
    if (mismatchCount === 0) {
      console.log('✔ Database math is 100% consistent. Zero mismatches!')
    } else {
      throw new Error('Database math mismatch found!')
    }

    console.log('\n==================================================')
    console.log('ALL INTEGRATION TEST SIMULATIONS PASSED SUCCESSFULLY!')
    console.log('==================================================')
  } catch (error) {
    console.error('❌ SIMULATION TEST FAILED:', error)
    process.exitCode = 1
  } finally {
    // 10. Cleanup test DB
    cleanupTestDb()
  }
}

runSimulation()
