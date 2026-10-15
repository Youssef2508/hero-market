# Business Logic Map

> Purpose: record **what the code currently does**, so future business-logic work starts from facts. Nothing here was changed by the UI redesign unless explicitly listed in `DECISIONS.md`.
> Currency: Egyptian pound (`ج.م`). All money math uses JS floats with `utils#round2` in the cart.

## 1. Authentication and session

| Step                     | Implementation                                                                                                                                 | Rule                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PIN entry                | `components/pos/LockScreen.jsx` → `usePOSController#handlePinSubmit`                                                                           | PIN digits normalised (`normalizeDigits` converts Arabic-Indic digits). Max 4 digits in the UI.                                                                             |
| Lookup                   | `SELECT * FROM users WHERE password_hash = sha256(pin) OR password_hash = pin`                                                                 | Both hashed and **legacy plaintext** PINs are accepted.                                                                                                                     |
| Session resume on launch | `useShift#checkActiveShift` → `shifts.dao#getActiveShift`                                                                                      | If **any** user has an open shift, the app unlocks as **that** user without a PIN (Verified in baseline run).                                                               |
| After login              | Cashier ⇒ `currentView='pos'`. If the user has an open shift it is resumed; otherwise the Open-Shift dialog appears with `startingCash='200'`. |                                                                                                                                                                             |
| Lock / logout            | `usePOSController#handleLock` (also `Ctrl+Alt+L`)                                                                                              | Clears user, shift, cart, client and search state; returns to POS view. Does **not** close the shift.                                                                       |
| Roles                    | `admin`, `manager`, `cashier`                                                                                                                  | `admin` & `manager` see management; only `admin` sees Users; the close-shift dialog is the _advanced multi-till_ variant only for `admin`, others get the _simple_ variant. |
| Hard-coded exception     | `AdminDashboard` and `TillsManagerTab` check `username === 'سيف فايز'`                                                                         | Hides the admin "tills" entry and changes tills behaviour for that user. Preserved as-is.                                                                                   |

## 2. Product lookup

### 2.1 Barcode submit – `usePOSController#handleBarcodeSubmit`

1. Exact match on `barcode` = raw, leading-zeros-stripped, or `'0'+raw`.
2. Else scale barcode parsing – `useBarcode#parseScaleBarcode` (13 digits, prefix `20|21|22|25`):
   - `20/21/25`: `CCCCC` = product code (chars 3–7), `WWWWW` = grams → `qty = W/1000`.
   - `22`: `PPPPP` = price in piastres → `qty = round2(price / retail_price)`.
3. Else, for 6–12 char input, suffix match `barcode LIKE '%input'` (≤5): one hit ⇒ add; several ⇒ show them in the search dropdown.
4. Found ⇒ `addToCart(product, forcedQty)`; not found ⇒ error sound + error toast "رمز الباركود (…) غير مسجل".

> Pre-existing defect fixed during the redesign: step 3/4 referenced a block-scoped `parsed` variable and `round2` was not imported, so any unknown barcode threw `ReferenceError` (no toast) and price-embedded scale barcodes failed. See `DECISIONS.md` D-007.

### 2.2 Scanner detection – `useBarcode`

Global `keydown` listener: keystrokes ≤ 35 ms apart are treated as scanner input and **redirected** to the correct field even if focus is elsewhere (POS barcode input, inventory search when `adminTab==='inventory'`, or the Add-Product barcode field). It removes the stray first character from the previously focused input. Disabled while locked or while shift/approval/alert/confirm dialogs are open.

### 2.3 Instant search – `handleSearchChange` / `handleSearchKeyDown`

Debounced 150 ms, `name LIKE %q% OR barcode LIKE %q%`, `LIMIT 8`. Keys: ↑/↓ move, Enter adds the selected (or first) result, Esc clears and returns focus to the scanner.

## 3. Cart – `hooks/useCart.js`

| Operation            | Rule                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Line shape           | `{ barcode, name, price: retail_price, cost_price, qty, unit, total: round2(qty*price), stock_qty }`                                    |
| Add existing barcode | Increments qty by `customQty` (default 1). Plays success tone.                                                                          |
| Qty edit             | `handleQtyChangeAttempt` ignores empty / trailing `.`/`,` / NaN / ≤0 while typing; on blur an invalid or ≤0 value **removes** the line. |
| Delete line          | `triggerDeleteItem(barcode)` – immediate, no approval.                                                                                  |
| Clear cart           | `triggerClearCart` (Esc / button) – clears lines, discount, paid amount, resets payment to `نقدي`. **Does not** clear client fields.    |
| Stock check          | None at add time. Overselling is stopped by the DB trigger at checkout.                                                                 |

Derived values (recomputed every render):

```
subTotal   = round2(Σ line.total)
cartTotal  = round2(max(0, subTotal − discount − appliedCredit))
changeDue  = paidAmount ? round2(max(0, paidAmount − cartTotal)) : 0
```

The manager-approval dialog (`ManagerApprovalModal`, `pendingAction` types `DELETE_ITEM | QTY_REDUCTION | CLEAR_CART`) is wired but **never opened** by current code (no caller sets it to `true`). (Verified)

## 4. Customers at checkout

- Typing a name/phone searches `clients` (`LIMIT 5`) and shows an autocomplete; choosing one sets `selectedClient`.
- If `debt_balance < 0` (store owes credit) the cashier can toggle **"خصم من الرصيد"**: `appliedCredit = min(|debt_balance|, cartTotal + appliedCredit)`.
- When `changeDue > 0` and a client is selected, the cashier can store part of the change as credit (`depositChange`, capped at `changeDue`).
- Credit (`آجل`) and split (`دفع جزئي`) payments require a client name (UI guard).

## 5. Checkout – `usePOSController#handleCheckout`

Guards: cart not empty; an **open** shift exists.

1. Resolve client: `selectedClient.id`, else look up by name/phone, else **insert a new client** (separate statement, outside the transaction).
2. Compose one script:

```
BEGIN TRANSACTION;
INSERT INTO sales(shift_id, timestamp, total_amount=cartTotal, original_amount=subTotal|cartTotal, discount, payment_type, client_name, client_id);
-- per line
INSERT INTO sale_items(sale_id=(SELECT MAX(id) FROM sales), product_barcode, quantity, unit_price, total_price, cost_price);
UPDATE products SET stock_qty = stock_qty - qty WHERE barcode = …;
-- if client
UPDATE clients SET points = points + floor(cartTotal/100);
  آجل      → debt_balance += cartTotal; client_ledger('sale', cartTotal)
  دفع جزئي → upfront = min(cartTotal, paidAmount); debt += cartTotal-upfront (ledger 'sale'); safe_ledger inflow(upfront)
  appliedCredit>0 → debt_balance += appliedCredit; ledger 'sale'
  depositChange>0 → debt_balance -= min(depositChange, change); ledger 'payment'
COMMIT;
```

3. `logEvent('checkout_sale')`, read the new sale id (`ORDER BY id DESC LIMIT 1`).
4. Build receipt HTML (`printTemplates#generateReceiptHtml`) and, unless **"بدون فاتورة"** is toggled, call `window.api.printer.print`. Print failure ⇒ alert, sale stays committed.
5. Success toast, reset cart/payment/client state, refresh stats, refocus scanner.
6. Failure mapping: closed shift / insufficient stock / DB busy / generic friendly message.

Payment types and drawer effect (as used by reconciliation queries):

| `payment_type`             | Counted as drawer cash?                         |
| -------------------------- | ----------------------------------------------- |
| `نقدي`                     | Yes (cash sales)                                |
| `فودافون كاش`, `انستا باي` | No – "digital" sales                            |
| `آجل`                      | No – customer debt                              |
| `دفع جزئي`                 | Only the upfront part, via `safe_ledger` inflow |

Known accounting caveats are listed in `docs/issues/*.md` (C-01…): e.g. `MAX(id)` linkage and `original_amount` semantics. They are **unchanged**.

## 6. Returns – `hooks/useSalesManager.js`

- **Item return** `handleReturnItem(saleItem, qty)`: `0 < qty ≤ quantity − returned_qty`. Refund is pro-rated by the invoice discount ratio: `net = round2(qty*unit_price − qty*unit_price*discount/original_amount)`. Restocks the product, updates `returned_qty`/`total_price`, reduces `sales.discount` by the share and recomputes `total_amount`. Credit sale ⇒ reduce client debt + ledger `payment`; otherwise `safe_ledger` outflow `مرتجع صنف …`.
- **Full return** `handleReturnEntireSale(saleId)`: restocks remaining quantities, zeroes the sale, refunds the **fresh** `total_amount` (debt reduction for `آجل`, else outflow `مرتجع كامل الفاتورة #…`).

## 7. Shifts and cash reconciliation

### Open – `handleStartShift`

Inserts `shifts` with `initial_cash`, `momkn_start_balance/cash`, `vfcash_start_balance/cash` (negative values rejected). Trigger forbids a second open shift per user.

### Expected drawer cash (several copies of the same formula)

```
expectedMainCash = initial_cash
                 + cash sales (payment_type='نقدي', net of discount)
                 + safe_ledger inflows
                 − safe_ledger outflows (returns + supplier payments + expenses)
```

Implemented in `usePOSController#handleConfirmCloseShift`, `CloseShiftModal` (simple variant polls every 1 s), `TillsManagerTab#fetchMainDrawerData`, and `App.jsx#triggerAuditCheck` (periodic audit uses gross − debt − digital sales, equivalent intent).

### Close – `handleConfirmCloseShift`

Computes expected/difference, asks whether to back up the DB first, then `UPDATE shifts SET status='closed', …`, logs, prints the grand shift report (best effort), and locks the app. Simple close dialog subtracts a fixed **200 EGP float** (`FLOAT_AMOUNT`) to show the hand-over amount (display only).

### Periodic drawer audit – `App.jsx`

Every 10 s a timer checks: ≥ 1 h since the last audit, ≥ 20 s idle, empty cart, no dialog ⇒ opens the audit dialog. Also triggered manually from the shell ("جرد دوري للدرج"). Saves `shift_audits`; a deficit offers to record a reason. Snooze = 5 min; Skip = reset the hour.

## 8. Tills (Momkn and wallets) – `TillsManagerTab`, `useMomknTill`, `useMobileMoneyTill`

Per-shift ledgers of `digital_impact`, `cash_impact`, `commission`. Expected Momkn digital balance = `momkn_start_balance + Σ digital_impact`; expected wallet balances per platform. Printable till reports via `printTemplates`. Operation forms live in `MomknOperationModal` / `MobileMoneyOperationModal`.

## 9. Back-office rules

| Area          | Rule (hook)                                                                                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Products      | Add requires barcode+name; warns (confirm) when `retail < cost`; delete blocked by FK if sold. (`useProductsManager`)                                                                                                                     |
| Clients       | Phone uniqueness checked; delete only when `debt_balance == 0`; repayment > debt asks to confirm (creates credit); repayment writes ledger + safe inflow. (`useClientsManager`)                                                           |
| Suppliers     | Purchase: `remaining = total − paid` → supplier debt + ledger; paid → safe outflow `دفعة لمورد…`. Repayment → ledger + outflow `سداد دين مورد…` (only when a shift is open). Delete removes ledger and purchases. (`useSuppliersManager`) |
| Expenses      | Amount > 0 + description; mirrored as safe outflow `مصروفات - تصنيف: …`; delete reverses by matching the ledger description. (`useExpensesManager`)                                                                                       |
| Damaged goods | Qty ≤ stock; deducts stock with cost snapshot; delete restocks. (`useDamagedGoodsManager`)                                                                                                                                                |
| Checks        | CRUD + mark paid; "due today" banner. (`useChecksManager`)                                                                                                                                                                                |
| Users         | Username unique; PIN exactly 4 digits, unique, stored as SHA-256; cannot delete yourself. "System reset" deletes all transactional data (keeps products & users) after two confirmations. (`useUsersManager`)                             |
| Analytics     | Net profit = Σ(line total − (qty−returned)·cost) − damaged cost − expenses, filtered by shifts started in the period. (`useAdminController#fetchAnalytics`)                                                                               |

## 10. Where the rules run (stage 2)

Every rule in this document now runs **in the HeroMarket service** (`src/server/modules/*`), inside a transaction, with the same formulas as before (legacy behaviour preserved; deliberate fixes are K-23 … K-32 in [TESTING_AND_KNOWN_ISSUES.md](TESTING_AND_KNOWN_ISSUES.md)). The renderer only displays results. Prices and totals are recomputed by the service at checkout; a stale or tampered price is refused.

## 11. Receipts and printing

- Sale receipts come from the active **receipt template** of the paper size (`src/shared/receipt.mjs`): the same data and template produce the thermal lines and the A4/PDF page. The built-in template prints exactly what the original receipt printed (except the K-29 discount fix).
- Reprint shows `((id−1) % 10000) + 1` as the display number (legacy HTML path).
- Shift-close, Momkn and wallets reports: `src/shared/reportLines.mjs` (K-32).
- Shortages: PDF via Typst or direct thermal print.

## 12. Unknowns and open decisions

- K-24: the simple and detailed close dialogs use different legacy formulas – the owner must choose one.
- K-10: when a supervisor's approval should be required.
- Behaviour on the store's physical printer (verified to PDF only).
