# Feature Inventory

Status legend: **Implemented** (works in baseline QA) · **Partial** (works with gaps) · **Broken** (fails at runtime in baseline) · **Unverified** (code present, not exercised – usually hardware).
"Baseline QA" = running app on 2026-10-13 against the dev database, before redesign changes.

## 1. Cashier (POS)

| Feature                                                       | Entry point (redesigned UI)                       | Implementation                                                                | Reads / writes                                     | Status                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| PIN login / lock                                              | Lock screen; `Ctrl+Alt+L`; sidebar "تسجيل الخروج" | `LockScreen.jsx`, `usePOSController#handlePinSubmit/handleLock`               | `users`, `shifts`                                  | Implemented (baseline: Enter key did not submit – fixed, D-006)              |
| Auto-resume open shift on launch                              | App start                                         | `useShift#checkActiveShift`                                                   | `shifts`, `users`                                  | Implemented                                                                  |
| Barcode scan (keyboard wedge)                                 | Scanner field                                     | `useBarcode`, `handleBarcodeSubmit`                                           | `products`                                         | Implemented (unknown-barcode path Broken in baseline – fixed, D-007)         |
| Scale barcodes 20/21/22/25                                    | Scanner field                                     | `parseScaleBarcode`                                                           | `products`                                         | Implemented (price-embedded 22 Broken in baseline: `round2` missing – fixed) |
| Instant product search (F2)                                   | Search field                                      | `handleSearchChange/KeyDown`                                                  | `products`                                         | Implemented                                                                  |
| Cart add / qty / delete / clear                               | Cart table, F3/F4/Esc                             | `useCart`                                                                     | –                                                  | Implemented                                                                  |
| Discount (amount)                                             | Checkout panel                                    | `useCart.discount`                                                            | –                                                  | Implemented                                                                  |
| Paid amount & change due                                      | Checkout panel                                    | `useCart.changeDue`                                                           | –                                                  | Implemented                                                                  |
| Payment methods: cash, Vodafone Cash, InstaPay, credit, split | Payment group                                     | `CheckoutTerminal`, `handleCheckout`                                          | `sales`, `clients`, `client_ledger`, `safe_ledger` | Implemented                                                                  |
| Customer autocomplete, delivery address                       | Customer section                                  | `handleClientNameChange/PhoneChange`, `selectClient`                          | `clients`                                          | Implemented                                                                  |
| Use customer credit / save change as credit                   | Customer section                                  | `appliedCredit`, `depositChange`                                              | `clients`, `client_ledger`                         | Implemented                                                                  |
| Loyalty points (1 per 100 EGP)                                | Automatic                                         | `handleCheckout`                                                              | `clients.points`                                   | Implemented                                                                  |
| Checkout (F1) + receipt                                       | Pay button                                        | `handleCheckout`, `printTemplates`, `printer.js`                              | `sales`, `sale_items`, `products`                  | Implemented (printing Unverified – no printer)                               |
| "No receipt" toggle                                           | Next to pay button                                | `noPrint` state                                                               | –                                                  | Implemented                                                                  |
| Low-stock list + shortages PDF/print                          | Cashier side panel                                | `CheckoutTerminal`, IPC `generate-shortages-pdf`/`print-shortages-to-printer` | `products`                                         | Implemented (PDF Unverified)                                                 |
| Manager approval for deletions                                | –                                                 | `ManagerApprovalModal`                                                        | `users`                                            | Partial – dialog exists but nothing opens it                                 |

## 2. Shift and cash

| Feature                                                   | Entry point                     | Implementation                                                            | Status                                                                      |
| --------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Open shift (cash + Momkn + wallet opening balances)       | Auto after login / shell button | `OpenShiftModal`, `handleStartShift`                                      | Implemented                                                                 |
| Close shift – simple (cashier/manager) with 200 EGP float | Shell "إغلاق الوردية"           | `CloseShiftModal#SimpleCloseShiftModal`                                   | Implemented                                                                 |
| Close shift – advanced 3-till (admin)                     | same                            | `CloseShiftModal#AdvancedCloseShiftModal`                                 | Implemented                                                                 |
| Backup prompt on close + grand report print               | Close flow                      | `handleConfirmCloseShift`                                                 | Implemented (print Unverified)                                              |
| Periodic drawer audit (hourly, idle-gated) + manual       | Shell "جرد دوري"                | `App.jsx` audit block                                                     | Implemented                                                                 |
| Change own PIN                                            | Shell user menu                 | `ChangePinModal`                                                          | Implemented (hooks-order defect fixed, D-008)                               |
| Tills: supermarket drawer, Momkn machine, wallets         | Sidebar "الأدراج والتحويلات"    | `TillsManagerTab`, `useMomknTill`, `useMobileMoneyTill`, operation modals | Implemented (error-path `setErrorMsg` undefined in baseline – fixed, D-008) |

## 3. Management (admin / manager)

| Screen (`adminTab`)   | Purpose                                                                                 | Implementation                                                  | Status                                                                          |
| --------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `stats`               | Period KPIs (sales, profit, expenses, debt, cash flow)                                  | `StatsTab`, `useAdminController#fetchAnalytics`                 | Implemented                                                                     |
| `advanced-stats`      | Custom-range report: daily, hourly, per-shift, top products, payment mix, smart summary | `AdvancedStatsTab`, `useAdvancedAnalytics`                      | Partial – top-products query used non-existent `si.product_name` (fixed, D-009) |
| `cashier-performance` | Cashier ranking/scorecards and drill-down                                               | `CashierPerformanceTab`, `useCashierPerformance`                | Implemented                                                                     |
| `bestsellers`         | Top sellers / slow movers by period                                                     | `BestSellersTab`, `useBestSellersManager`                       | Implemented                                                                     |
| `inventory`           | Products CRUD, search, sort, pagination (12/page)                                       | `InventoryTab`, `useProductsManager`, Add/Edit product modals   | Implemented                                                                     |
| `reordering`          | Reorder assistant from stock vs. limit                                                  | `ReorderingTab`                                                 | Broken in baseline (`products.price` column missing; fixed, D-009)              |
| `damaged`             | Write-offs                                                                              | `DamagedGoodsTab`, `useDamagedGoodsManager`                     | Implemented                                                                     |
| `sales`               | Invoice history, detail, item/full returns, reprint                                     | `SalesTab`, `useSalesManager`                                   | Implemented (error-path `setReturnErrorMsg` undefined – fixed, D-008)           |
| `shifts`              | Closed shifts + periodic audits                                                         | `ShiftsTab`                                                     | Implemented                                                                     |
| `clients`             | Client directory, profile, ledger, repayments, monthly top clients                      | `ClientsTab`, `useClientsManager`, client modals                | Implemented                                                                     |
| `suppliers`           | Suppliers, purchases, ledger, repayments                                                | `SuppliersTab`, `useSuppliersManager`, supplier/purchase modals | Implemented (`setSelectedSupplier` crash on open – fixed, D-008)                |
| `checks`              | Cheque register + due-today                                                             | `ChecksTab`, `useChecksManager`, `AddCheckModal`                | Implemented                                                                     |
| `expenses`            | Expense log (mirrored to drawer)                                                        | `ExpensesTab`, `useExpensesManager`                             | Implemented                                                                     |
| `users` (admin only)  | Users CRUD + system reset                                                               | `UsersTab`, `useUsersManager`, user modals                      | Implemented                                                                     |
| `logs`                | System event log                                                                        | `LogsTab`, `logs.dao`                                           | Implemented                                                                     |
| `backup`              | Backup / restore                                                                        | `BackupTab`, IPC                                                | Implemented (dialogs are native; restore not exercised to protect data)         |

## 4. Not present (do not assume)

- No discounts by percentage or per line; no taxes/VAT.
- No card terminal integration; "Vodafone Cash"/"InstaPay" are labels only.
- No product categories UI (column exists), no product images.
- No purchase orders linked to stock (supplier purchases do **not** change `stock_qty`).
- No multi-store sync, no cloud, no user-level permissions beyond the three roles.
- No settings screen for `store_name` / `branch_name` / `printer_name` (values live in the `settings` table only).
- No automated UI tests in the original project (only DB-level simulation scripts).

## 5. Tests touching features

`tests/simulate_flows.js`, `tests/simulate_all_28_flows.js`, `tests/simulate_edge_cases.js`, `tests/simulate_advanced_edge_cases.js` – SQL-level simulations of shift, sale, return, client, supplier and expense flows against a copy of the DB. See `TESTING_AND_KNOWN_ISSUES.md`.
