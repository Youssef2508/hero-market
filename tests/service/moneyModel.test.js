'use strict'
// Money model, end to end (owner feedback phase D, .docs/FINANCIAL_RECONCILIATION.md):
// opening float from the treasury, cash and cashless sales, refunds on their own method, shift and
// treasury expenses, debt payments with and without a shift, a payment method correction, the
// blind close with per-method variances, retries, the saved report and its reprint. Every expected
// figure is recomputed here independently from the raw rows.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts
} = require('./helpers')

let db, svc, owner, mgr, mgr2, cashier
const ref = () => crypto.randomUUID()
const q = async (sql, p) => (await svc.pool.query(sql, p)).rows
const one = async (sql, p) => (await q(sql, p))[0]
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}
const r2 = (n) => Math.round(Number(n) * 100) / 100
const balance = async () =>
  r2((await one('SELECT COALESCE(SUM(amount),0) AS b FROM treasury_ledger')).b)
const sell = (token, shiftId, items, paymentType = 'نقدي', extra = {}) =>
  svc.call('pos.checkout', { clientRef: ref(), shiftId, paymentType, items, ...extra }, token)

// Independent recomputation of a shift's expected amounts from raw rows (§3).
async function independentExpected(shiftId) {
  const types = {
    cash: ['نقدي'],
    visa: ['فيزا'],
    wallet: ['محفظة', 'فودافون كاش'],
    instapay: ['انستا باي']
  }
  const s = await one('SELECT initial_cash FROM shifts WHERE id = $1', [shiftId])
  const out = {}
  for (const [m, t] of Object.entries(types)) {
    const sales = (
      await one(
        `SELECT COALESCE(SUM(COALESCE(NULLIF(original_amount,0) - discount, total_amount)),0) AS v
           FROM sales WHERE shift_id = $1 AND payment_type = ANY($2)`,
        [shiftId, t]
      )
    ).v
    const led = await one(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE type='inflow'),0) AS i,
              COALESCE(SUM(amount) FILTER (WHERE type='outflow'),0) AS o
         FROM safe_ledger WHERE shift_id = $1 AND method = $2`,
      [shiftId, m]
    )
    out[m] = r2(
      (m === 'cash' ? Number(s.initial_cash) : 0) + Number(sales) + Number(led.i) - Number(led.o)
    )
  }
  return out
}

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  await createUser(svc, { username: 'owner', pin: '8642', roleKey: 'super_admin' })
  await createUser(svc, { username: 'mgr', pin: '9517', roleKey: 'manager' })
  await createUser(svc, { username: 'mgr2', pin: '9518', roleKey: 'manager' })
  await createUser(svc, { username: 'cashier', pin: '5173', roleKey: 'cashier' })
  owner = await login(svc, '8642')
  mgr = await login(svc, '9517')
  mgr2 = await login(svc, '9518')
  cashier = await login(svc, '5173')
  await seedProducts(
    svc,
    `INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, unit) VALUES
     ('M1', 'صنف 10', 6, 10, 9, 500, 'قطعة'), ('M2', 'صنف 25', 15, 25, 22, 500, 'قطعة')`
  )
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('a full shift reconciles per method, with the treasury, exactly once', async (t) => {
  if (!requireDb(t)) return
  const customer = ok(
    await svc.call('clients.create', { name: 'عميل الخزنة', phone: '01011112222' }, owner)
  )
  const supplier = ok(await svc.call('suppliers.create', { name: 'مورد الخزنة' }, owner))
  await q('UPDATE clients SET debt_balance = 500 WHERE id = $1', [customer.id])
  await q('UPDATE suppliers SET debt_balance = 300 WHERE id = $1', [supplier.id])

  // Opening balance of the treasury, recorded once even when the request is repeated.
  const dep = ref()
  ok(
    await svc.call(
      'treasury.record',
      { kind: 'deposit', amount: 1000, reason: 'رصيد افتتاحي', clientRef: dep },
      owner
    )
  )
  const again = ok(
    await svc.call(
      'treasury.record',
      { kind: 'deposit', amount: 1000, reason: 'رصيد افتتاحي', clientRef: dep },
      owner
    )
  )
  assert.equal(again.entry.duplicate, true)
  assert.equal(await balance(), 1000)

  // Opening float: −200 treasury, +200 drawer, once.
  const shift = ok(await svc.call('shifts.open', { startingCash: 200 }, mgr))
  assert.equal(await balance(), 800)
  assert.equal((await svc.call('shifts.open', { startingCash: 200 }, mgr)).status, 409)
  assert.equal(await balance(), 800, 'a second open posts nothing')

  // Sales: cash 10+25, Visa 25, wallet (old name) 10, InstaPay 25.
  const cashSale = ok(
    await sell(mgr, shift.id, [
      { barcode: 'M1', qty: 1 },
      { barcode: 'M2', qty: 1 }
    ])
  )
  const visaSale = ok(await sell(mgr, shift.id, [{ barcode: 'M2', qty: 1 }], 'فيزا'))
  const walletSale = ok(await sell(mgr, shift.id, [{ barcode: 'M1', qty: 1 }], 'فودافون كاش'))
  ok(await sell(mgr, shift.id, [{ barcode: 'M2', qty: 1 }], 'انستا باي'))
  assert.equal(
    (await one('SELECT payment_type FROM sales WHERE id = $1', [walletSale.saleId])).payment_type,
    'محفظة'
  )
  assert.equal(await balance(), 800, 'sales never touch the treasury')

  // Refunds go back on the sale's own method: the Visa refund leaves the drawer untouched.
  const visaItem = await one('SELECT id FROM sale_items WHERE sale_id = $1', [visaSale.saleId])
  const visaRefund = ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: visaItem.id, quantity: 1, reason: 'تالف', currentShiftId: shift.id },
      mgr
    )
  )
  assert.deepEqual(
    [visaRefund.refundMethod, visaRefund.cashRefund, visaRefund.methodRefund],
    ['visa', 0, 25]
  )
  const cashItem = await one(
    "SELECT id FROM sale_items WHERE sale_id = $1 AND product_barcode = 'M1'",
    [cashSale.saleId]
  )
  ok(
    await svc.call(
      'sales.returnItem',
      { saleItemId: cashItem.id, quantity: 1, reason: 'خطأ', currentShiftId: shift.id },
      mgr
    )
  )

  // Shift expense (no note), customer receipt in cash and by InstaPay into the shift.
  const exp = ok(
    await svc.call(
      'expenses.create',
      { amount: 15, category: 'عام', currentShiftId: shift.id },
      mgr
    )
  )
  assert.equal(exp.destination, 'shift')
  ok(
    await svc.call(
      'clients.repay',
      { clientId: customer.id, amount: 40, currentShiftId: shift.id },
      mgr
    )
  )
  ok(
    await svc.call(
      'clients.repay',
      {
        clientId: customer.id,
        amount: 10,
        destination: 'shift',
        method: 'instapay',
        currentShiftId: shift.id
      },
      mgr
    )
  )

  // The owner, without a shift: treasury expense, customer receipt and supplier payment.
  const tExp = ok(
    await svc.call('expenses.create', { amount: 25, category: 'إيجار', clientRef: ref() }, owner)
  )
  assert.equal(tExp.destination, 'treasury')
  const cref = ref()
  ok(await svc.call('clients.repay', { clientId: customer.id, amount: 60, clientRef: cref }, owner))
  ok(await svc.call('clients.repay', { clientId: customer.id, amount: 60, clientRef: cref }, owner))
  ok(
    await svc.call(
      'suppliers.repay',
      { supplierId: supplier.id, amount: 70, clientRef: ref() },
      owner
    )
  )
  assert.equal(await balance(), 800 - 25 + 60 - 70, 'treasury moved once per payment')
  assert.equal(
    Number(
      (await one('SELECT debt_balance FROM clients WHERE id = $1', [customer.id])).debt_balance
    ),
    500 - 40 - 10 - 60
  )
  assert.equal(
    Number(
      (await one('SELECT debt_balance FROM suppliers WHERE id = $1', [supplier.id])).debt_balance
    ),
    230
  )

  // PAY-02: only the owner corrects a method, with a reason; the sum per shift is unchanged.
  const before = await independentExpected(shift.id)
  const change = {
    saleId: walletSale.saleId,
    method: 'visa',
    reason: 'اختار الكاشير محفظة بالخطأ',
    clientRef: ref()
  }
  assert.equal((await svc.call('sales.changePaymentMethod', change, mgr)).status, 403)
  ok(await svc.call('sales.changePaymentMethod', change, owner))
  assert.equal(ok(await svc.call('sales.changePaymentMethod', change, owner)).duplicate, true)
  const afterChange = await independentExpected(shift.id)
  assert.equal(afterChange.visa, r2(before.visa + 10))
  assert.equal(afterChange.wallet, r2(before.wallet - 10))
  assert.equal(
    r2(Object.values(afterChange).reduce((a, b) => a + b)),
    r2(Object.values(before).reduce((a, b) => a + b))
  )
  const refundedSale = {
    saleId: visaSale.saleId,
    method: 'cash',
    reason: 'تجربة تغيير',
    clientRef: ref()
  }
  assert.equal(
    (await svc.call('sales.changePaymentMethod', refundedSale, owner)).status,
    409,
    'a returned sale keeps its method'
  )

  // Blind: the manager (no shifts.view_expected) cannot read any expected figure before closing.
  for (const op of ['shifts.liveSummary', 'shifts.auditPreview'])
    assert.equal((await svc.call(op, { shiftId: shift.id }, mgr)).status, 403, op)
  assert.deepEqual(
    ok(await svc.call('tills.drawerSummary', { shiftId: shift.id }, mgr)).blind,
    true
  )
  assert.equal((await svc.call('shifts.details', { shiftId: shift.id }, mgr)).status, 403)
  const count = ok(await svc.call('shifts.audit', { shiftId: shift.id, actualCash: 1 }, mgr))
  assert.deepEqual(Object.keys(count), ['id'])
  // The owner sees the live details of the open shift.
  const live = ok(await svc.call('shifts.details', { shiftId: shift.id }, owner))
  assert.equal(live.saved, false)

  // Independent expected figures; close 10 short in cash, 5 over on the wallet.
  const exp2 = await independentExpected(shift.id)
  assert.deepEqual(exp2, {
    cash: r2(200 + 35 + 40 - 10 - 15),
    visa: r2(25 - 25 + 10),
    wallet: 0,
    instapay: r2(25 + 10)
  })
  const closeRef = ref()
  const body = {
    shiftId: shift.id,
    actualCash: exp2.cash - 10,
    actual: { visa: exp2.visa, wallet: 5, instapay: exp2.instapay },
    clientRef: closeRef
  }
  const closed = ok(await svc.call('shifts.close', body, mgr))
  const rep = closed.report
  assert.deepEqual(rep.expected, exp2)
  assert.deepEqual(rep.variance, { cash: -10, visa: 0, wallet: 5, instapay: 0 })
  assert.deepEqual(rep.varianceLabels, {
    cash: 'عجز 10.00',
    visa: 'مطابق',
    wallet: 'زيادة 5.00',
    instapay: 'مطابق'
  })
  assert.equal(rep.invoiceCount, 4)
  assert.equal(rep.expenses.count, 1)
  assert.equal(rep.returns.count, 2)
  assert.equal(rep.openingFloat, 200)
  assert.equal(rep.netTotal, r2(exp2.cash - 10 + exp2.visa + 5 + exp2.instapay))
  // The counted cash went to the treasury once; a retry returns the same close.
  const afterClose = 800 - 25 + 60 - 70 + (exp2.cash - 10)
  assert.equal(await balance(), r2(afterClose))
  const retry = ok(await svc.call('shifts.close', body, mgr))
  assert.equal(retry.duplicate, true)
  assert.deepEqual(retry.report, rep)
  assert.equal(await balance(), r2(afterClose), 'a retried close posts nothing')
  assert.equal((await svc.call('shifts.close', { ...body, clientRef: ref() }, mgr)).status, 409)
  // The saved report reprints identically; another manager without view_all of it… sees it only
  // through shifts.view_all (managers hold it); a cashier cannot.
  assert.deepEqual(ok(await svc.call('shifts.closeReport', { shiftId: shift.id }, mgr)).report, rep)
  assert.equal((await svc.call('shifts.closeReport', { shiftId: shift.id }, cashier)).status, 403)
  // The closed shift's details now come from the snapshot.
  assert.equal(ok(await svc.call('shifts.details', { shiftId: shift.id }, owner)).saved, true)

  // Treasury reconciliation by kind (§9).
  const kinds = Object.fromEntries(
    (await q('SELECT kind, SUM(amount)::float8 AS s FROM treasury_ledger GROUP BY kind')).map(
      (r) => [r.kind, r.s]
    )
  )
  assert.deepEqual(kinds, {
    deposit: 1000,
    opening_float: -200,
    expense: -25,
    customer_payment: 60,
    supplier_payment: -70,
    shift_close: r2(exp2.cash - 10)
  })
  const sum = ok(await svc.call('treasury.summary', {}, owner))
  assert.equal(sum.balance, r2(afterClose))
  assert.equal((await svc.call('treasury.summary', {}, mgr)).status, 403)
  // Every idempotency key appears once.
  assert.equal(
    (
      await one(
        'SELECT COUNT(*)::int AS n FROM (SELECT idem_key FROM treasury_ledger WHERE idem_key IS NOT NULL GROUP BY idem_key HAVING COUNT(*) > 1) d'
      )
    ).n,
    0
  )
})

test('treasury rows are immutable; corrections are reversals, at most once', async (t) => {
  if (!requireDb(t)) return
  const b0 = await balance()
  const w = ok(
    await svc.call(
      'treasury.record',
      { kind: 'withdrawal', amount: 50, reason: 'سحب المالك', clientRef: ref() },
      owner
    )
  )
  assert.equal(await balance(), r2(b0 - 50))
  await assert.rejects(
    q('UPDATE treasury_ledger SET amount = 1 WHERE id = $1', [w.entry.id]),
    /لا يمكن تعديل/
  )
  await assert.rejects(
    q('DELETE FROM treasury_ledger WHERE id = $1', [w.entry.id]),
    /لا يمكن تعديل/
  )
  assert.equal(
    (await svc.call('treasury.reverse', { entryId: w.entry.id, reason: 'x' }, owner)).status,
    400
  )
  ok(await svc.call('treasury.reverse', { entryId: w.entry.id, reason: 'سُجّل بالخطأ' }, owner))
  assert.equal(
    ok(await svc.call('treasury.reverse', { entryId: w.entry.id, reason: 'سُجّل بالخطأ' }, owner))
      .entry.duplicate,
    true
  )
  assert.equal(await balance(), b0)
  // A shift close is undone where it was made, not from the treasury screen.
  const close = await one("SELECT id FROM treasury_ledger WHERE kind = 'shift_close' LIMIT 1")
  assert.equal(
    (await svc.call('treasury.reverse', { entryId: close.id, reason: 'تجربة عكس' }, owner)).status,
    409
  )
  // Negative balance is allowed and stays visible (D-059).
  ok(
    await svc.call(
      'treasury.record',
      { kind: 'withdrawal', amount: 100000, reason: 'تجربة رصيد سالب', clientRef: ref() },
      owner
    )
  )
  assert.ok(ok(await svc.call('treasury.summary', {}, owner)).balance < 0)
})

test('expenses: each user sees and deletes only their own; deleting removes its own drawer row', async (t) => {
  if (!requireDb(t)) return
  const s1 = ok(await svc.call('shifts.open', { startingCash: 0 }, mgr))
  const s2 = ok(await svc.call('shifts.open', { startingCash: 0 }, mgr2))
  const a = ok(
    await svc.call('expenses.create', { amount: 7, category: 'عام', currentShiftId: s1.id }, mgr)
  )
  const b = ok(
    await svc.call(
      'expenses.create',
      { amount: 9, category: 'صيانة', description: 'قفل', currentShiftId: s2.id },
      mgr2
    )
  )
  const ids = (list) => list.map((x) => x.id)
  const mine = ok(await svc.call('expenses.list', {}, mgr))
  assert.ok(ids(mine).includes(a.id) && !ids(mine).includes(b.id))
  assert.ok(
    !mine.some((x) => x.destination === 'treasury'),
    "the owner's treasury expenses stay hidden"
  )
  const all = ok(await svc.call('expenses.list', {}, owner))
  assert.ok(ids(all).includes(a.id) && ids(all).includes(b.id))
  // Direct API access to another user's expense: not found, and nothing changes.
  assert.equal((await svc.call('expenses.delete', { expenseId: b.id }, mgr)).status, 404)
  // Regression (EXP-02): an expense without a note removes exactly its drawer row.
  const rows = async (sid) =>
    Number(
      (
        await one(
          "SELECT COUNT(*) AS n FROM safe_ledger WHERE shift_id = $1 AND type = 'outflow'",
          [sid]
        )
      ).n
    )
  assert.equal(await rows(s1.id), 1)
  ok(await svc.call('expenses.delete', { expenseId: a.id }, mgr))
  assert.equal(await rows(s1.id), 0)
  // Totals do not depend on who can see: mgr2's shift still counts its expense.
  const exp = ok(await svc.call('shifts.details', { shiftId: s2.id }, owner)).report
  assert.equal(exp.expenses.total, 9)
  // A treasury expense is undone by a reversal, never by deleting money.
  const bal = await balance()
  const tx = ok(
    await svc.call(
      'expenses.create',
      { amount: 11, destination: 'treasury', clientRef: ref() },
      owner
    )
  )
  assert.equal(await balance(), r2(bal - 11))
  ok(await svc.call('expenses.delete', { expenseId: tx.id, reason: 'مكرر' }, owner))
  assert.equal(await balance(), bal)
  assert.ok(
    await one("SELECT 1 FROM treasury_ledger WHERE kind = 'reversal' AND ref_id = $1", [tx.id])
  )
  // With an open shift and treasury rights, the destination must be chosen.
  const o = ok(await svc.call('shifts.open', { startingCash: 0 }, owner))
  const unclear = await svc.call('expenses.create', { amount: 3 }, owner)
  assert.equal(unclear.status, 400)
  assert.equal(unclear.body.error.details.code, 'destination_required')
  ok(
    await svc.call(
      'expenses.create',
      { amount: 3, destination: 'shift', currentShiftId: o.id },
      owner
    )
  )
  // A manager cannot choose the treasury.
  assert.equal(
    (await svc.call('expenses.create', { amount: 3, destination: 'treasury' }, mgr)).status,
    403
  )
})

test('expense categories: rename keeps old expenses meaningful, a stopped one cannot be chosen', async (t) => {
  if (!requireDb(t)) return
  const cats = ok(await svc.call('expenseCategories.list', {}, owner))
  assert.ok(
    cats.some((c) => c.name === 'إيجار'),
    'categories offered before 1.5.0 exist'
  )
  const c = ok(await svc.call('expenseCategories.save', { name: 'نظافة' }, owner))
  const s = await one(
    "SELECT id FROM shifts WHERE user_id = (SELECT id FROM users WHERE username = 'mgr') AND status = 'open'"
  )
  const x = ok(
    await svc.call('expenses.create', { amount: 4, categoryId: c.id, currentShiftId: s.id }, mgr)
  )
  ok(await svc.call('expenseCategories.save', { id: c.id, name: 'نظافة وتعقيم' }, owner))
  assert.equal((await one('SELECT category FROM expenses WHERE id = $1', [x.id])).category, 'نظافة')
  ok(
    await svc.call(
      'expenseCategories.save',
      { id: c.id, name: 'نظافة وتعقيم', isActive: false },
      owner
    )
  )
  assert.equal(
    (await svc.call('expenses.create', { amount: 4, categoryId: c.id, currentShiftId: s.id }, mgr))
      .status,
    400
  )
  assert.equal((await svc.call('expenseCategories.save', { name: 'إيجار' }, owner)).status, 409)
  assert.equal((await svc.call('expenseCategories.save', { name: 'جديد' }, cashier)).status, 403)
})

test('backup and restore keep the treasury, closes, categories and corrections exactly', async (t) => {
  if (!requireDb(t)) return
  const tables = [
    'treasury_ledger',
    'shift_closings',
    'expense_categories',
    'sale_payment_corrections',
    'expenses',
    'safe_ledger'
  ]
  const snap = async () => {
    const out = {}
    for (const tb of tables) out[tb] = await q(`SELECT * FROM ${tb} ORDER BY 1`)
    return out
  }
  const exported = ok(await svc.call('backup.export', {}, owner))
  for (const tb of tables) assert.ok(exported.tables[tb], `${tb} is in the backup`)
  const before = await snap()
  const restored = await svc.call('backup.restore', { backup: exported, confirm: 'RESTORE' }, owner)
  assert.equal(restored.status, 200, JSON.stringify(restored.body))
  assert.deepEqual(await snap(), before)
})
