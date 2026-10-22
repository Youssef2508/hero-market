# Financial reconciliation: drawer, payment methods, treasury

Written for the developer and the reviewer of the money model. It's the single place where the money formulas are defined; the code follows it.

- **Owner decisions:** D-059 (expenses, negative treasury), D-061 (payment methods) and D-062 (this model).
- **Requirements:** CASH-01, TREAS-01, PAY-01, PAY-02, EXP-01/02/03, CUST-02, SHIFT-01/02 in `HeroMarket_Owner_Feedback_Specification.md`.
- **Code:** `src/server/money/` (methods, treasury) and `src/server/modules/shifts.js` (`drawerFigures`, `methodFigures`, `closeShift`).

## 1. What existed before 1.5.0 (inspected 2026-10-21)

| Part          | Before 1.5.0                                                                                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drawer        | `safe_ledger`: one row per cash movement of a shift (`inflow` / `outflow`). The expected drawer (K-24) = opening cash + cash sales as sold + inflows − outflows.                                               |
| Payment types | نقدي، فودافون كاش، انستا باي، آجل، دفع جزئي. Cashless sales were counted only as "non-cash sales"; there was no expected or counted figure per method.                                                         |
| Refunds       | First what the customer still owed on the invoice, then store balance spent on it, and the rest **in cash from the drawer** — for wallet and InstaPay sales too.                                               |
| Treasury      | None. The opening float was typed at open and came from nowhere; the counted cash at close went nowhere.                                                                                                       |
| Expenses      | Always drawer cash of an open shift; no creator; anyone with `expenses.manage` saw and deleted every expense. Categories were a fixed list in the screen.                                                      |
| Debt payments | Customer receipts and supplier payments always moved drawer cash, so an open shift was required.                                                                                                               |
| Close         | The cashier saw the expected drawer (and could fill it in with one click) before counting. `shifts.liveSummary`, `shifts.auditPreview` and `tills.drawerSummary` returned the expected figures to any cashier. |

## 2. Payment methods (D-061)

| Key        | Stored `payment_type`            | Physical cash?             |
| ---------- | -------------------------------- | -------------------------- |
| `cash`     | نقدي                             | yes: drawer, then treasury |
| `visa`     | فيزا                             | no                         |
| `wallet`   | محفظة (older sales: فودافون كاش) | no                         |
| `instapay` | انستا باي                        | no                         |

- **On account:** آجل and دفع جزئي are not methods. They leave an amount on the customer's account. The part paid at once on a دفع جزئي sale is cash, as before.
- **Stored values:** a sale stores its `payment_type` text. New sales store فيزا or محفظة; older فودافون كاش sales count as `wallet`. The mapping lives in `src/server/money/methods.js` only.
- **Per-method movements:** a shift's `safe_ledger` row now has a `method` (default `cash`, so every older row stays cash). A cashless movement, such as the refund of a Visa sale, is a `safe_ledger` row with that method. It never touches the cash drawer.

## 3. Shift formulas (the only ones)

For a shift _S_ and a method _m_:

- `sales(S, m)` = Σ sales of _S_ with method _m_, as sold: `COALESCE(NULLIF(original_amount,0) − discount, total_amount)` (K-40). Returns are counted separately, as outflows.
- `in(S, m)` and `out(S, m)` = Σ `safe_ledger` inflows and outflows of _S_ with method _m_.

```
expected_cash(S)  = opening_float(S) + sales(S, cash) + in(S, cash) − out(S, cash)
expected(S, m≠cash) =                  sales(S, m)    + in(S, m)    − out(S, m)
variance(S, m)    = actual(S, m) − expected(S, m)      > 0 surplus (زيادة), < 0 shortage (عجز)
```

- **Cash inflows:** customer debt receipts in the drawer, the cash part of a دفع جزئي sale, and change kept as store balance (K-36).
- **Cash outflows:** cash refunds, supplier payments from the drawer, and drawer expenses.
- **Sign convention:** expected 1,000, actual 950 → variance −50, labelled **عجز 50.00**. Expected 1,000, actual 1,050 → +50, labelled **زيادة 50.00**.
- **No approval at close (D-073, owner 2026-10-22, replaces the 50 EGP rule of 2026-10-14):** a close is never refused, whatever the variance. The variance is saved with the close and shown in the report and in «الورديات»; the owner deals with it there.

## 4. Treasury (`treasury_ledger`, by payment method since D-064)

Each row has a signed amount (+ into the treasury, − out), a kind, an actor, a time and a reference (shift, expense, customer, supplier). There's also a unique idempotency key, and the reason when one is required.

```
treasury_balance = Σ treasury_ledger.amount        (may be negative: shown in red, D-059)
```

| Event                                 | Treasury                                                  | Drawer                | Idempotency key         |
| ------------------------------------- | --------------------------------------------------------- | --------------------- | ----------------------- |
| Open a shift with float _F_           | −*F* `opening_float`                                      | opening_float = _F_   | `shift-open:<shift>`    |
| Close a shift, counted cash _A_       | +_A_ `shift_close`                                        | the drawer is emptied | `shift-close:<shift>`   |
| Deposit / withdrawal by the owner     | ±                                                         | —                     | the screen's request id |
| Treasury expense (no shift)           | − `expense`                                               | —                     | the screen's request id |
| Customer debt receipt to the treasury | + `customer_payment`                                      | —                     | the screen's request id |
| Supplier payment from the treasury    | − `supplier_payment`                                      | —                     | the screen's request id |
| Correction                            | ± `adjustment` (reason and permission required)           | —                     | the screen's request id |
| Undo a posted row                     | opposite amount, `reversal` (links the row, at most once) | —                     | `reverse:<row>`         |

- **A transfer is not income.** The float and the close are transfers between the drawer and the treasury. They never count as sales or expenses.
- **Expenses and refunds at close:** what the drawer paid during the shift is already missing from the counted cash. The close moves only the counted cash, so nothing is subtracted twice.
- **Counted amounts, not expected amounts, go to the treasury** (D-064): one `shift_close` row per method. Each method's shortage or surplus stays visible as that method's variance; nothing is moved to cash.
- **A float left in the drawer** for the next shift is part of the counted cash. It goes to the treasury at close and comes back as the next shift's float. The money is never counted twice.
- **Cash and electronic balances stay apart** (D-064). The treasury has a balance per method (cash = physical money; Visa, wallet, InstaPay = electronic balances) and an overall total. A Visa amount is never cash.
- **Rows are immutable.** A database trigger refuses UPDATE and DELETE except during a restore. A correction is a `reversal` or an `adjustment`.
- **At the upgrade to 1.5.0,** the treasury starts at 0. Earlier shifts are not replayed: that would invent a balance. The owner records the counted treasury once, as a deposit with the reason "رصيد افتتاحي".

## 5. Close, blind (PAY-01, SHIFT-02)

1. **Before confirming,** a user without `shifts.view_expected` sees only four inputs: cash, Visa, wallet and InstaPay. The service refuses that user every expected figure: `shifts.liveSummary` and `shifts.auditPreview` answer 403, `tills.drawerSummary` leaves the money out, and `shifts.audit` returns no expected figure or difference.
2. **`shifts.close`** takes `actual{cash,visa,wallet,instapay}` and a `clientRef`. In one transaction it:
   - locks the shift (0011);
   - computes every figure from §3;
   - stores the snapshot in `shift_closings` (expected, actual and variance per method, plus the full report);
   - posts the treasury `shift_close`;
   - closes the shift.
3. **Retries:** a repeated request with the same `clientRef` returns the stored report and changes nothing. Any other request on a closed shift is refused (409).
4. **Report:** the report and every reprint (`shifts.closeReport`) come from the stored snapshot, so a reprint matches the original exactly. If the printer is missing, the shift stays closed once and the report can be reprinted.
5. **Failure:** if the close fails, nothing is stored, and nothing claims the shift was closed.

## 6. Expenses (EXP-01/02/03)

- **Fields:** each expense records `created_by`, a category (`expense_categories`; the name at the time is kept on the row), its destination (`shift` or `treasury`) and the ledger row it posted.
- **Visibility:**
  - users without `expenses.view_all` (administrators only) see and delete only the expenses they created (Q2). It is enforced in the queries;
  - the shift and treasury totals are always computed from every row, whoever can see them.
- **Destination:**
  - `shift`: drawer cash of the user's own open shift, as before;
  - `treasury`: for holders of `treasury.manage`, with no shift needed;
  - when both are possible, the destination must be chosen explicitly. The service never guesses.
- **Deletion:**
  - a shift expense (open shift only, 0011) removes exactly its own `safe_ledger` row (by id);
  - a treasury expense posts a `reversal` instead.

## 7. Customer and supplier debt (CUST-02)

- `clients.repay` and `suppliers.repay` take a destination (`shift` or `treasury`), with the same rule as expenses. The customer or supplier ledger row and the money row are written in one transaction.
- A payment is never also recorded as an expense or an income.

## 8. Changing a sale's payment method (PAY-02)

- **Who:** only holders of `sales.change_payment` (administrators by default).
- **When:** between the four methods, for a sale without returns (a refund has already used the old method). Since D-065 also after the sale's shift is closed (`after_close` on the correction).
- **What changes:** `sales.payment_type` becomes the new method. The original method, new method, amount, actor, time and an optional note (D-063) are kept in `sale_payment_corrections` and the activity log.
- **What doesn't change:** totals, stock, revenue and customer debt.
- **Effect while the shift is open:** the shift's per-method expected figures move by the sale's value at once, and their sum is unchanged.
- **Effect after the close (D-065):** a reclassification only. The close already moved the counted amounts per method to the treasury, so no money row is written, the saved close is not rewritten, and the treasury is not changed. The correction is listed with that shift, so a per-method difference it explains can be read there.

## 9. Reconciliation checks (automated, `tests/service/moneyModel.test.js`)

- **One shift:** for every method, the stored `expected` equals the formula in §3 recomputed independently from the raw rows. Σ variance = Σ actual − Σ expected.
- **Treasury and shifts:** the treasury balance equals Σ deposits − Σ withdrawals − Σ floats + Σ counted cash at close − Σ treasury expenses + Σ customer receipts − Σ supplier payments ± adjustments and reversals.
- **Retries:** every idempotency key appears at most once.
- **Cashless:** no cashless sale or refund ever changes `expected_cash` or the treasury.

## 10. Movement kinds, receivables and payables (D-064, migration 0018)

- **Movement kinds.** Every `safe_ledger` row has a kind:
  - `sale_upfront`: the part of a دفع جزئي sale paid at once, by its method;
  - `kept_change`;
  - `customer_payment`: a collection, never a sale;
  - `supplier_payment`: paid with an invoice or a preliminary invoice;
  - `supplier_settlement`: a later payment of a payable;
  - `expense`, `refund`, `other`.

  The drawer formula of §3 is unchanged. The kinds feed the report's categories.

- **Retries.** A request id (`client_ref`) on the row makes a retried collection, settlement or expense a no-op.
- **Customer receivable.**
  - آجل adds the whole sale; دفع جزئي adds the sale minus what was paid at once.
  - A later collection reduces it and is a `customer_payment` of the collecting shift (or a treasury `customer_payment`).
- **Supplier payable, preliminary invoice.**
  - Payable += total − paid now. Supplier ledger: `purchase` (total) and `payment` (paid now).
  - The payment is a `supplier_payment` of the shift by its method, or a treasury `supplier_payment`.
  - No stock movement.
- **Supplier payable, conversion.**
  - Stock and moving-average cost from the lines (`receiveStock`), with no payment.
  - Payable += final − preliminary, as a supplier ledger `adjustment` row (negative when the final total is lower).
  - Exactly once: a converted invoice refuses a second conversion, and the same request id returns the first result.
- **Later settlement.** Payable −= amount; a `supplier_settlement` of the shift by its method, or a treasury `supplier_payment`.
- **Report categories.**
  - per method: sales, collections, supplier payments, expenses, refunds;
  - credit sales; partial sales (paid now and unpaid); collections; supplier payments (with invoices and settlements);
  - the expected, actual and difference totals;
  - the transfers to the treasury at close.

## 11. Cancelling a preliminary supplier invoice (D-065, migration 0019)

One transaction, once per request (`cancel_ref`); the invoice is kept with status `cancelled`, who, when, how and an optional note.

| Case                           | Supplier payable                         | Money                                                                           |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------- |
| Credit (nothing paid)          | − total (an `adjustment` row)            | none                                                                            |
| Paid, the supplier returned it | − unpaid part; the paid part refunded    | an inflow `supplier_refund` by its method, in the current shift or the treasury |
| Paid, not returned             | − total: the supplier owes the paid part | none (no cash or electronic balance is created)                                 |
| Converted to a purchase        | refused                                  | refused: stock and cost need a purchase return                                  |

- The original payment stays in its shift's history. A closed shift's saved close and count are never rewritten: money returned later is recorded where it arrives now.
- Tested with exact balances in `tests/service/supplierCancel.test.js` (6 tests).

## 12. Purchase invoice discount and purchase returns (D-066, migration 0020)

**Discount.** For a purchase with lines L (Σ line value = gross G) and discount D:

- net N = G − D = `total_amount`; payable += N − paid; the drawer or treasury pays at most N;
- stock and moving average use the line costs (G), never N;
- purchase gain of the period = Σ D (purchases dated in it) − Σ (gross_value − credit_value) of purchase returns dated in it; net profit = sales profit − damaged − expenses + purchase gain.

**Return** of quantities q from lines of a purchase:

| Item                                   | Value                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| Return value V                         | Σ q × line unit cost                                                              |
| Supplier credit C                      | V × N ÷ G (V when no discount); never more than N less earlier credits            |
| Stock                                  | − q × unit factor, at the line cost per base unit                                 |
| Moving average with stock s, average a | (s·a − q·c) ÷ (s − q); kept when nothing is left or it would be negative          |
| Payable                                | − C (`supplier_ledger` `return`)                                                  |
| Money received now R ≤ C               | inflow `supplier_refund` by its method, shift or treasury; payable + R (`refund`) |

Tested with exact balances in `tests/service/purchaseDiscountReturns.test.js` (10 tests).

## 13. New prices on purchase lines (D-068, migration 0021)

A purchase line may set the product's selling or wholesale price (base unit). This moves no money, stock or cost: the payable, payments, discount and moving average are exactly as in §12. A sale made after the change uses the new price.
