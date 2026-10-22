# HeroMarket — Owner Feedback Implementation Specification

## Requirements, Dependencies, Acceptance Criteria, Regression Tests, and Release Checklist

**Document type:** Implementation specification for Claude Code  
**Target repository:** `D:\Youssef\Brands\HeroMarket`  
**Target release:** Create a new release version only after inspecting the current repository and release history. Do not assume these changes belong in `1.4.0`; use the next appropriate version and ask before tagging/publishing.  
**Status:** Draft requirements — implementation has not been authorized by this document alone.  
**Primary rule:** Correctness and preservation of shop data take priority over speed of delivery.

---

## 0. Instructions and non-negotiable safety rules

1. Read the repository's current architecture, business rules, migrations, roles/permissions, backup/restore implementation, import/export templates, reports, POS flows, tests, CI configuration, and all relevant documentation before changing code.
2. Create a dependency map for these requirements before implementation. Several requests affect the same accounting, inventory, permissions, printing, backup, import/export, and shift-closing paths.
3. Do not implement each bullet in isolation. Identify shared services and single sources of truth so that one fix does not silently break another feature.
4. Do not delete or reset real shop data. Do not use the production database for development or tests. Use disposable test databases and verified copies.
5. Do not merge, tag, publish, deploy, create cloud resources, purchase services, or change the real shop database without explicit approval.
6. Preserve existing business records and audit history. Never silently rewrite completed sales, supplier invoices, stock movements, cash movements, or closed shifts to make a new feature work.
7. Every financial or stock-changing action must be atomic, auditable, permission-checked on the backend, and protected against duplicate submission.
8. No UI control may be considered implemented merely because it is visible. Every button, menu, setting, permission, filter, and report must have a real tested behavior. If the intended behavior cannot be inferred safely, ask the owner rather than inventing a business rule.
9. Before any database migration, state whether it changes schema, data, or both; provide a backup and recovery plan; test migration on representative copies; test application-only upgrades separately.
10. Keep the POS usable offline for its supported local workflows. Do not make local checkout depend on a cloud service.
11. Do not weaken existing authentication, role authorization, discount rules, inventory integrity, or owner-only access to sensitive financial information.
12. Work in small, reviewable phases. Maintain the living checklist in Section 16 and update it after every meaningful task with status, evidence, and remaining risks.
13. Do not mark a task complete based solely on code being written. Completion requires tests, integration/regression evidence, and documentation updates where relevant.
14. If requirements conflict with existing documented decisions, stop and report the conflict with options. Do not silently choose.
15. Do not claim “100% bug-free.” Report verified behavior and remaining risks honestly.

---

## 1. Reference material and evidence

The owner supplied two photos:

- **Reference A — customer sales receipt:** a physical Arabic receipt. The layout must read right-to-left structurally, including labels, values, columns, totals, and cashier/time fields.
- **Reference B — scale label:** a product label showing barcode `2000001001257`, product name `طماطم`, unit price `20.00 EGP/kg`, weight `0.125 kg`, and total `2.50 EGP`. The owner expects this to resolve to scale product code `2000001` and weight `125 g = 0.125 kg`, with the final digit handled according to the verified barcode/check-digit format.

### Image handling

Store the original images in the repository at:

- `.docs/reference-images/owner-sales-receipt.jpg`
- `.docs/reference-images/owner-scale-label.jpg`

If Claude Code cannot access the images directly from the chat, ask the owner to copy the two original images to these paths. Do not fabricate or recreate the photos. Keep personal/customer information in the receipt private; do not include the customer's personal details in test fixtures, logs, screenshots, or documentation. Redact them in any generated evidence.

---

## 2. Implementation workflow and dependency order

Before coding, create `.docs/OWNER_FEEDBACK_IMPLEMENTATION_PLAN.md` with:

- a requirement ID for every item in this document;
- files/modules likely affected;
- dependencies and shared services;
- whether a database migration is needed;
- permissions involved;
- import/export, backup/restore, reporting, receipt-printing, and offline implications;
- tests required;
- implementation order;
- questions that need the owner's decision.

Recommended order (revise after repository inspection and explain why):

1. Architecture audit, existing behavior inventory, data model, role matrix, financial ledger/cash drawer model, and backup/import/export map.
2. Shared foundations: permissions, audit log, money/decimal handling, database transactions/idempotency, keyboard navigation, printer RTL rendering, migration/backup compatibility.
3. Product units/wholesale packaging and scale barcode parsing.
4. Cash drawer/treasury ledger and payment-method reconciliation model.
5. Supplier invoices, supplier balances, purchase pricing/discounts, and cashier-submitted purchase notices.
6. Expenses, privacy by user/shift, and shift-independent owner transactions.
7. Shift history/closing report and cashier-safe reconciliation workflow.
8. Customer codes, product barcode editing, waste search, stock movement screen, dashboard snapshots, analytics date filters.
9. Reprint flows, receipt modes/shortcuts, sign-out, password reset, password validation, remove unused checkbook features.
10. Import/export templates, backup/restore, migrations, documentation, full regression suite, installer/update tests.
11. Release readiness review. No release/publish action without approval.

Do not follow this order blindly if repository evidence shows a safer dependency order. Document the final dependency graph first.

---

## 3. Requirement groups

Each requirement has a stable ID. Update the checklist in Section 16 with evidence and status.

### DATA-01 — Export the current database data in the existing import-template format

**Owner request:** The owner needs to extract/export existing database data using the same structure as the system's current import template.

**Requirements**

- Inspect the existing import template and supported import entities before designing export.
- Provide an owner-authorized export that produces files with matching column names, data types, formatting, relationships, and documented import expectations wherever that is semantically possible.
- Export only entities that can safely be re-imported. Explicitly document fields that are generated, read-only, sensitive, or unsuitable for round-trip import.
- Define a consistent encoding that preserves Arabic text and Excel compatibility.
- Do not export password hashes, secrets, database credentials, tokens, or other authentication secrets.
- Make exports deterministic and validate the generated file before reporting success.
- Avoid partial exports that look successful. If one file fails, report the failure and identify what was or was not written.
- Add a template/version marker or documented compatibility rule so later schema changes do not silently corrupt imports.
- Do not make export alter the live database.

**Acceptance**

- Export a representative database, then validate the exported structure against the current template.
- Import the export into a disposable empty database and compare supported entities and relationships.
- Document expected exclusions and any lossy/non-round-trippable fields.

### INV-01 — Wholesale packaging and loose-unit selling for the same product

**Owner example:** A box of 10 cakes should be purchasable as 10 boxes, while stock is tracked as 100 individual cakes. The cashier should be able to sell 2 boxes or 20 individual cakes and the remaining stock should be equivalent. The pack size may change later, e.g. from 10 to 12.

**Requirements**

- Keep one canonical stock unit per product (e.g. individual cake). Purchases, sales, waste, adjustments, returns, and stock movements must convert to this unit using exact decimal/integer-safe quantities.
- Add optional product detail fields for:
  - wholesale/package barcode;
  - wholesale/package name;
  - units per package.
- Keep ordinary purchase price and selling price fields. Clarify whether purchase price is per canonical unit or per package in the UI; never leave the unit ambiguous.
- Package metadata is optional. Existing products without package metadata must behave exactly as before.
- Allow purchase invoices to enter package quantity and package cost conveniently; convert to canonical stock quantity and cost transparently.
- Allow sales by individual unit and, where enabled, by whole package. Both routes must affect the same stock balance and stock ledger.
- If 10 boxes × 10 units are received, stock increases by 100 individual units. Selling 2 boxes reduces stock by 20 individual units. The resulting stock is 80 units, equivalent to 8 boxes.
- Support multiple barcodes only if the existing data model can do it safely; otherwise use separate canonical and package barcodes with uniqueness validation.
- Validate package size as a positive integer. Prevent zero, negative, invalid, or overflow values.
- **Historical integrity:** changing units-per-package from 10 to 12 must not retroactively alter completed invoices, old stock movements, cost history, or historical reports. Existing stock remains in canonical units. New package transactions use the new conversion factor. Show a warning and require explicit confirmation when changing package size for an existing product.
- Preserve moving-average costing and the project's current cost-of-goods-sold rules. Do not recalculate historical sale costs unless a separate, approved migration is specified.
- Keep barcode, search, category browsing, product reports, supplier purchases, waste, stock adjustments, backup, and import/export consistent.
- Do not connect to an electronic scale as part of this feature.

**Acceptance tests**

- Buy 10 packages × 10 units; stock = 100 canonical units.
- Sell 2 packages; stock = 80.
- Sell 20 loose units instead; same final stock.
- Return a package/loose units; stock and cost reversal follow existing return policy.
- Waste and stock adjustments use canonical units.
- Change pack size from 10 to 12; historical transactions remain unchanged and new purchases use 12.
- Export/backup/restore/import preserves package metadata and canonical stock.
- Offline purchase/sale flows work according to the current offline architecture.

### SUP-01 — Cashier-submitted supplier invoice notice (non-financial notification)

**Owner request:** Any normal role with permission can submit a simple notice that a supplier invoice exists. It must not affect inventory, pricing, supplier balances, cash drawer, treasury, or accounting. The owner later enters the real invoice through the existing supplier-invoice workflow and confirms that the notice was reviewed/handled.

**Requirements**

- Create a separate, clearly named “Supplier invoice notice” workflow, distinct from a real supplier invoice.
- The notice records only the supplier, amount the cashier says was paid/needs attention, timestamp, submitting user, optional note/reference, and status. Confirm with owner whether the amount means “paid” or “invoice total” if the existing UI cannot make this clear; never treat it as a transaction.
- The notice must not create invoice lines, purchase records, stock movements, price updates, supplier debt changes, cash movements, or treasury transactions.
- The entered amount is informational only: it must not be deducted from a drawer, added to shift totals, or treated as money received/paid.
- Show pending notices to the owner as a modest persistent notification, similar to low-stock alerts, until the owner marks the notice reviewed/handled.
- Owner must enter the actual invoice separately using the existing invoice flow. Provide a link/reference to the notice where possible.
- “Reviewed” must not imply that the real invoice has been posted. Prefer explicit statuses such as Pending review, Reviewed, and Linked to actual invoice, with distinct actions and audit history.
- Avoid duplicate handling; status changes must be idempotent and audited.
- Cashiers may view their own submitted notice status if permitted, but must not gain access to owner-only supplier financial data.
- Define whether the notice is deleted/archived; default to retaining an audit trail.

**Acceptance**

- Create a notice and verify that every stock, price, supplier-balance, drawer, shift, and treasury total remains unchanged.
- Owner sees the notice until handled.
- Owner posts the real supplier invoice; only that actual invoice changes stock/prices/balances.
- Permissions, duplicate submission, offline behavior, and audit logs are tested.

### CASH-01 — Cash drawer and treasury are separate, reconciled ledgers

**Owner rules**

- Cash in the drawer is transferred to the treasury when a shift closes, net of the appropriate cash expenses and cash refunds/returns.
- Any opening cash float entered when opening a shift is deducted from treasury, preventing double counting.
- Owner can make certain financial operations directly against treasury without opening a shift.

**Requirements**

- Inspect and document the existing drawer/treasury model before changes.
- Use an auditable ledger with explicit transaction types, source references, timestamps, actor, payment method, and signed amount.
- Never represent a transfer as both a new income and an expense. Define transfer semantics and reconciliation formulas once in a shared service.
- Opening float: a shift opening float must create a treasury outflow and drawer inflow exactly once in one atomic operation. Reopening/retrying must not double-post it.
- Shift close: transfer the closing drawer cash to treasury as a transfer, not revenue. Account for cash expenses and cash refunds/returns according to the verified business rules.
- Cashless payment methods (card/Visa, InstaPay, wallets) do not physically enter the cash drawer or cash treasury unless an explicit settlement/deposit transaction is recorded. Track their expected and counted/confirmed balances separately.
- Permit negative treasury balances if the current approved business rule requires it, but display them clearly and audit every transaction.
- Add reconciliation views and filters for deposits, withdrawals, transfers, opening float, shift closing, owner expenses, customer-debt receipts, and supplier-debt payments.
- Every operation must be transactional, idempotent, and recoverable.
- No silent balance “fixes”; use explicit adjustment transactions with reason and authorization.

**Acceptance**

- Opening float reduces treasury and increases the drawer by the same amount.
- Shift close transfers the correct net cash to treasury once.
- Retries do not duplicate transactions.
- Cashless sales never inflate cash drawer/treasury balances.
- Supplier/customer debt payments and owner expenses affect the intended ledger exactly once.
- Reconciliation equations are documented and covered by tests.

### EXP-01 — Expense visibility is limited to the creator/own shift; admin can see all

This request appears in two forms in the owner's notes: (a) every non-admin user should only see their own expenses, including prior shifts; (b) expense access should show only expenses associated with the user's own shift, and never admin/other users' private expenses. Reconcile this by using **creator + shift ownership** as the default access rule and ask the owner if a user should see expenses submitted by another user in the same shift.

**Requirements**

- Admin/owner can view all expenses and filter by user, shift, date, category, and status.
- A non-admin can create expenses only if granted the relevant permission.
- A non-admin can see only expenses they are authorized to see: default is expenses created by them and/or attached to their own shift. Do not expose owner-only expenses or other users' shifts.
- Enforce visibility in backend/API/database queries, not only by hiding rows in the UI.
- Apply the same rules to lists, details, search, exports, reports, notifications, and receipt/shift printouts.
- Prevent IDs in URLs/API calls from allowing unauthorized access to another user's expense.
- Maintain audit history for create/edit/delete/approval operations.
- Do not break shift totals or treasury accounting when filtering what a user can see.

**Acceptance**

- Test admin, cashier A, cashier B, user with expense permission, and owner expense made outside a shift.
- Attempt direct API access to another user's expense and verify denial.
- Verify prior-shift visibility follows the documented rule.
- Verify accounting totals are correct even when a user cannot see all underlying records.

### EXP-02 — Expense categories are manageable; description is optional

- Provide a real workflow to create, edit, activate/deactivate, and select expense categories.
- Existing categories and historical expense category names must remain meaningful if a category is deactivated or renamed.
- Make the descriptive note optional if the business operation does not require it. Keep any legally/operationally required fields.
- Fix validation that currently prevents confirming a valid expense solely because the optional note is blank.
- Do not let deleting a category erase or corrupt historical expenses.

### EXP-03 — Admin can record expenses without an open shift

- Admin can record an expense while no shift is open. This operation posts to treasury immediately and must not fabricate a shift.
- If the admin has an open shift and explicitly records an expense against that shift, it reduces that shift's appropriate expected payment balance and follows the existing accounting model.
- Make the destination explicit in the UI: “Treasury expense” versus “Current shift expense.”
- Do not silently choose a destination if the context is ambiguous.
- Non-admin roles remain subject to role permissions and their own-shift visibility rules.
- Record reason, amount, payment method, actor, timestamp, and audit data.

### SUP-02 — Supplier invoice: sale price, invoice-level discount, supplier debt

**Requirements**

- Add selling price to supplier purchase invoice lines and update the product's current selling price only when the invoice is actually posted/confirmed. Drafts and cashier notices must not change product prices.
- Decide and document whether a supplier invoice line's purchase cost is entered per package or canonical unit; integrate with INV-01.
- Add invoice-level discount options: fixed currency amount or percentage of the invoice subtotal. Apply once, validate bounds, display subtotal, discount, and final total, and allocate discount to line costs consistently for moving-average costing. Avoid rounding drift; document rounding policy.
- Supplier discount must reduce the invoice payable/total, not create a cash receipt or unrelated discount event.
- Prevent discount greater than subtotal unless the existing business rules explicitly permit it.
- Make finalization atomic: stock, costs, product selling prices, supplier balance, and payment records must either all commit or all roll back.
- Preserve a clear draft → confirmed/posted workflow. Only a posted invoice changes financial/inventory state.
- Add supplier opening balance/debt at setup (see SUP-03); keep opening balance distinct from invoices and payments.

### SUP-03 — Supplier opening balance and editable supplier contact details

- Allow an authorized admin to set a supplier's opening balance when creating the supplier or through an explicit opening-balance transaction.
- The owner example says a supplier may initially be owed EGP 2,000; clarify sign conventions in UI. Do not expose confusing negative numbers without labels such as “We owe supplier” / “Supplier owes us.”
- Opening balance is a ledger transaction dated at system setup; it must not be recorded as a purchase invoice or stock receipt.
- Opening supplier debt does not change stock, prices, or inventory cost.
- If the opening balance is payable, it increases the amount owed to the supplier; subsequent payments reduce it and affect treasury exactly once.
- Allow editing supplier representative/contact name and phone after creation, with validation and audit history. Do not alter historical invoices or payment records.
- Existing supplier data must migrate without changing balances.

### CUST-01 — Customer unique code and cashier lookup

- Assign each customer a stable unique customer code.
- Show the code in customer details and allow POS search by name, phone, or code.
- Enforce uniqueness at the data layer and handle concurrent creation safely.
- Do not recycle codes after deletion/archive. Preserve code in historical invoices.
- Existing customers need a safe backfill migration with collision tests.
- Keep the earlier limit of up to two phone numbers and up to three addresses; don't regress those rules.

### PROD-01 — Edit product barcode/item code

- Allow authorized users to edit product/item codes/barcodes.
- Validate uniqueness and supported barcode formats.
- If a barcode is used in historic invoices, stock records, or scale-label mappings, preserve the old code as an alias or historical identifier where needed; never make historical invoice snapshots incorrect.
- Log old value, new value, actor, timestamp, and reason if required.
- Test scanner lookup, search, package barcode, scale barcode, imports, and duplicate-code handling.

### SCALE-01 — Weighted products and scale barcode parsing

**Owner example:** A 13-digit barcode `2000001001257` should identify the product with scale code `2000001`, extract `00125` as 125 grams, convert to `0.125 kg`, and calculate `0.125 × 20.00 = EGP 2.50` for tomatoes priced at EGP 20/kg. The label photo is the reference.

**Important:** Do not hardcode this example as the only supported scheme. Inspect the current “scale labels” setting, existing code, actual product codes, barcode format documentation if available, and the exact sample. Verify the prefix and check-digit rules with evidence. The notes mention both a code starting with `20` and a sample `2000001001257`; resolve the exact slicing precisely before coding.

**Requirements**

- Add/verify a product flag indicating whether it is sold by weight and uses a scale barcode.
- Implement configurable scale barcode parsing where feasible: prefix, product-code width/range, quantity/weight field width, quantity unit and decimal divisor, optional price-embedded formats, and check digit.
- Never parse a normal 13-digit product barcode as a scale barcode unless it matches a configured, valid pattern.
- For the supplied sample, expected interpretation is product code `2000001`, weight `125 g = 0.125 kg`, total EGP 2.50 at EGP 20/kg, if the verified format confirms this.
- Determine whether the final digit is a check digit and implement/validate the correct algorithm only after confirming the actual scale format. Do not guess Modulo 10 parameters.
- Support manual entry of a scale barcode in the POS product-code field and scanner input.
- If barcode is invalid, product code unknown, or weight field malformed, show a clear message and do not add an incorrect item.
- Calculate using decimal-safe arithmetic and the existing currency rounding policy.
- Ensure price is per kg, inventory is canonical kg (or the current documented weight unit), and stock movements use the exact extracted quantity.
- Make the “scale labels” setting actually control documented behavior; remove or repair dead UI settings.
- Test boundary cases, invalid checksum, unknown product, wrong prefix, leading zeros, zero weight, maximum supported weight, scanner timing, manual entry, normal barcode compatibility, offline mode, returns, reports, backups, and import/export.

### PROD-02 — Product reports: stock valuation at cost and retail price

- Owner/admin can view current stock quantity and total value at current purchase cost and current selling price.
- Clearly label each valuation. Use canonical units and the current costing model.
- State treatment of negative stock, missing cost, inactive products, packages, and weighted products.
- Do not sum package quantities and loose quantities as if they were different products.
- Provide filters and a useful total; make sure filters affect both rows and totals.
- Reconcile the report to stock ledger and product records.

### WASTE-01 — Search products in waste/damage workflow

- Add fast product search by name and supported code/barcode to the waste/damage screen.
- Use the same product lookup and unit handling as other stock-changing workflows.
- Preserve reason, quantity, cost impact, permissions, audit history, and stock ledger integrity.
- Test keyboard-only use and large catalogs.

### STOCK-01 — Make “Stock Movements” a top-level navigation item

- Keep the existing per-product stock movement ledger behavior intact.
- Add a top-level navigation entry named **حركات المخزون**.
- Support filters by product and movement type, at minimum: purchase, sale, stock count/adjustment, waste, return, and any other existing movement types.
- Keep detail rows traceable to source documents and users.
- Do not implement a separate ledger that disagrees with the existing per-product history; use the same source of truth.
- Do not alter historical movements.

### DASH-01 — Admin dashboard financial/stock snapshots

Add three owner/admin-only dashboard summaries:

1. Total current inventory value at purchase cost.
2. Total current inventory value at current selling price.
3. Total currently owed to suppliers.
4. Total currently owed by customers (customer receivables).
   The original note says “3 snapshots” but enumerates four values; implement four unless the owner clarifies otherwise.

**Requirements**

- Values must come from authoritative ledgers/current stock and be consistent with detailed reports.
- Clearly define treatment of negative stock, products without cost, inactive products, returns, and supplier/customer credit balances.
- Clicking a snapshot should open the corresponding detailed report where possible.
- Restrict to admin/owner.
- Avoid stale cached values without clear refresh/invalidation rules.

### ANALYTICS-01 — Fix date filters in performance/profit and advanced reports

- Investigate the “today / month / all time” filter in performance/profit and the upper-left filter in advanced reports. The owner reports that results look identical across date ranges despite transactions on different dates.
- Trace query parameters through UI, API/service, SQL filters, timezone/date boundaries, and aggregate calculations.
- Define date semantics explicitly: local business timezone, inclusive/exclusive boundaries, and whether filtering by sale date, payment date, shift date, or posting date.
- Ensure both row data and aggregate totals use the same filter.
- Add tests with transactions on multiple dates, month boundaries, day boundaries, and empty periods.
- Do not merely change the displayed selected date while leaving queries unchanged.

### POS-01 — Keyboard-first operation and reliable numeric quantity entry

**Requirements**

- In small windows, dropdowns, lists, and selection dialogs, support Up/Down to move, Enter to select, Escape to close/cancel where safe, and visible focus/selection state.
- Do not hijack arrow keys when a text field, numeric field, or editable control needs them. Respect native accessibility expectations.
- In supplier invoice item selection, allow keyboard selection with Enter, not mouse-only selection.
- In the POS, typing quantity `0.5` directly must work; do not require arrow-key adjustment to commit the value.
- Correctly handle decimal separator, backspace/delete, select-all, validation, focus changes, and fractional quantities for weighted products.
- On the cashier screen, Escape must ask for confirmation before clearing a non-empty invoice. If confirmed, clear; if canceled, preserve the invoice exactly.
- Sign-out must always be available to an authenticated user even if they have not opened a shift. Signing out must not grant access to operational actions or bypass shift/accounting rules.
- Use a tested, documented keyboard map; avoid conflicting shortcuts.

### POS-02 — Sale receipt modes and keyboard shortcuts

- In the POS receipt area, provide clear actions for **طباعة بفاتورة** and **بدون فاتورة** (or the approved equivalent).
- Assign F1/F2 only after checking existing shortcuts and preventing browser/Electron conflicts. Display shortcuts beside the actions.
- Reprinting must be available for existing sale invoices, supplier invoices, and shift-closing reports subject to permissions.
- Reprinting must use the saved immutable document snapshot or reconstruct from preserved transaction data, not repeat the financial transaction.
- Reprint must never create a second sale, stock movement, supplier posting, or shift close.
- Keep the correct printer format for each document type; sale receipt and shift close report are separate templates.

### PRINT-01 — Correct Arabic RTL receipt and shift-close printing

Use Reference A as the visual target, while avoiding any personal data from the photo in tests.

**Requirements**

- Fix layout direction structurally, not by reversing strings or reversing column order ad hoc.
- Arabic labels and their values must have correct RTL ordering. In item rows, render the intended logical order right-to-left: item name, unit, unit price, and total in the owner-specified order and aligned columns.
- Ensure labels appear on the correct side of values for cashier, time, item count, totals, payment, and customer details.
- Use proper bidirectional text handling for mixed Arabic/English, numbers, dates, phone numbers, Latin barcodes, and currency.
- Support 58mm/80mm or the actual configured printer width without clipping; determine actual paper width from printer settings when available.
- Ensure printed text is not mirrored, reversed, overlapped, or reordered. Do not rely only on screenshots of the on-screen HTML; test the actual print pipeline and generated PDF/test raster if available.
- Time may remain in English if needed, but the overall receipt structure must read correctly right-to-left.
- Correctly format shift close receipts independently from customer sale receipts.
- Include totals, discount, payment breakdown, and item count in a readable layout.
- Keep printer errors from undoing or duplicating a saved sale.
- If no printer is connected, show a useful error/timeout and allow safe retry without reposting the transaction.

**Acceptance**

- Compare generated output against a redacted reference and a purpose-built RTL test fixture containing Arabic, Latin names, digits, decimals, phone numbers, and barcodes.
- Verify column order, label/value order, line wrapping, and totals on a real printer when available. Until then, mark hardware validation pending.

### PAY-01 — Payment methods, shift reconciliation, and owner-only expected balances

**Owner rules**

- Support cash, Visa/card, wallet, and InstaPay as distinct payment methods.
- Each method must contribute to its own sales totals and the shift report.
- At close, cashier enters actual counted/confirmed amounts for each method. The system compares them with expected amounts and reports the difference only after the cashier submits the actual amounts and confirms closing.
- Before final confirmation, do not reveal expected drawer/payment totals to the cashier. Expected balances are owner-only before final confirmation; after the cashier submits actual amounts and confirms, show reconciliation results as specified below.
- The cashier should see the final close receipt/report only after confirming the entered actual amounts and the closing record is durably saved.

**Requirements**

- Add Visa/card as a payment method if absent; support wallet and InstaPay separately.
- Validate split payments and ensure total payment equals the amount due under current rules.
- Refunds and returns must reverse the correct payment method and follow existing refund rules.
- Shift totals must show expected totals for cash, Visa/card, wallets, and InstaPay, plus sales totals, refunds, expenses, and discounts according to the ledger.
- Cash drawer expected amount must account for opening float, cash sales, cash refunds, cash expenses, and cash withdrawals/transfers using a single documented formula.
- Cashless expected amounts must be calculated separately and must not be added to cash drawer or treasury as if they were physical cash.
- At close, collect actual cash in drawer, actual card/terminal amount, actual wallet amount, and actual InstaPay amount.
- After submission/confirmation, calculate and show each method's variance using a documented sign convention. Example: expected EGP 1,000, actual EGP 950 → shortage EGP 50. Expected EGP 1,000, actual EGP 1,050 → surplus EGP 50. Use labels to avoid ambiguity.
- Apply permissions to any function that reveals expected balances early or allows editing a payment method after sale.
- Protect closing against double-clicks, retries, and interrupted network/database operations.
- The final shift receipt must reflect exactly the persisted closing record.

**Acceptance**

- Test cash-only, each cashless method, mixed payments, refunds, expenses, discounts, opening float, failed close, duplicate close attempt, and variance calculations.
- Verify a cashier cannot view expected totals before confirmation through UI, API, direct URL, or cached state.
- Verify owner can view full shift details.

### PAY-02 — Privileged correction of a sale's payment method

- Allow only roles with a dedicated permission to change the payment method of an existing sale during an open shift, as requested.
- Before implementation, determine whether editing an existing sale payment can be modeled safely as a compensating ledger entry plus replacement payment rather than mutating history.
- Keep an audit trail of original method, new method, actor, timestamp, reason, and source invoice.
- Update shift payment-method totals atomically and immediately.
- Do not change invoice total, stock, product quantities, revenue recognition, or customer debt unless an explicit existing business rule requires it.
- Restrict corrections after shift close unless the owner explicitly approves a separate correction workflow.
- Prevent a payment correction from creating or losing money; use idempotency and reconciliation tests.

### DISC-01 — Fixed-amount invoice-level sale discount with permissions

This request asks for a fixed EGP discount on the entire sale invoice, shown in shift details and shift-close reports, and assignable to selected roles.

**Conflict to resolve:** An earlier approved business rule said cashiers cannot choose, create, edit, remove, disable, or override discounts; only admin configures discount rules, which the system applies automatically. Do not silently overturn this. Before implementing manual invoice-level discounts, present the conflict to the owner and ask whether:
A. keep the prior rule (admin-configured automatic discounts only); or
B. allow a separate fixed-amount invoice discount permission for selected roles.
Until confirmed, implement neither new cashier capability nor UI affordance that weakens the earlier rule.

If option B is explicitly approved:

- Discount is a fixed EGP amount applied to the invoice total, with validation not exceeding the eligible total.
- Show discount amount and final total before payment; persist discount amount and its allocation/audit details.
- Show the discount in shift details and shift-close report as a separate total and link to affected invoices.
- Define how discounts interact with existing automatic product/category rules, stacking, returns, tax if any, and rounding.
- Permission checks must be enforced in backend and logged.
- Verify accounting, gross/net sales, margins, moving-average COGS, returns, exports, backups, and reports.

### USER-01 — Flexible password characters

- Passwords should allow normal combinations of letters, digits, and special characters, subject to sensible length and security rules.
- Remove accidental restrictions to one category/pattern. Do not reduce password strength or store plaintext.
- Test Arabic/Unicode behavior only if the app explicitly supports it and document policy; ensure password reset/login use the same normalization behavior (prefer no normalization of passwords).
- Verify existing accounts remain able to log in and password change/reset is compatible.

### USER-02 — Admin can reset a user's password

- Admin needs a secure recovery path even if the user has forgotten both their password and their recovery/change-password code.
- Implement an authorized admin reset flow that does not reveal the old password.
- Require the admin's own reauthentication where appropriate; log actor, target user, time, and action.
- Use a temporary password or forced-reset token that expires and requires the user to set a new password at next login.
- Revoke active sessions/refresh tokens as appropriate.
- Protect against privilege escalation and user enumeration.
- Preserve existing authentication migration and recovery-code security.

### ROLE-01 — Data import permission

- Add a dedicated role permission for data import.
- Only authorized roles can access/import through UI or direct API.
- Export and import may require separate permissions; do not assume permission to import implies permission to export.
- Import must validate all rows before committing where feasible, provide a dry-run/preview, and use transaction/rollback behavior appropriate to the import type.
- Never let import overwrite financial history or bypass audit/permission checks.
- Test every role and direct API access.

### NAV-01 — Remove unused cash-count/audit-drawer item

- Remove the “جرد الدرج” navigation/menu item and its related UI if it is genuinely unused, as requested.
- Before deleting code or database tables, inspect whether any shift-close, treasury, reports, permissions, tests, or historical data depend on it.
- If the underlying functionality is used by reconciliation, preserve the underlying data/service and remove only the redundant user-facing entry.
- Update navigation, permission matrix, tests, and documentation.

### NAV-02 — Remove checks feature

- Remove the “الشيكات” feature and UI because the shop does not use it.
- Search for all related routes, menu items, permissions, API endpoints, reports, schemas, migrations, seed data, tests, and references.
- Distinguish safe UI removal from deletion of historical data. Do not drop tables or delete records without explicit approval and a migration/data-retention review.
- Ensure removal does not affect supplier/customer debt, treasury, exports, or reports.

### SHIFT-01 — Admin shift history and live details

- Rename the navigation item “سجل الورديات” to **الورديات**.
- Admin can view all open and closed shifts and their detailed records: invoices, sales, expenses, cash, InstaPay, Visa/card, wallets, returns, discounts, and notes.
- The currently open shift should update promptly as operations occur. Define “instantly” based on the app architecture (e.g. refresh/push/polling) and ensure correctness after reconnect/offline recovery.
- Non-admin users must not see other users' shifts or owner-only expected balances.
- All details must be backed by the authoritative persisted records, not a separate UI-only cache.
- Every field displayed on a shift detail screen that is relevant to closing must appear in the close receipt where specified in PAY-01/PRINT-01.
- Avoid double-counting values that are shown in multiple sections.

### SHIFT-02 — Detailed shift-close receipt

The close receipt is a separate document from a sale receipt and must be independently configurable.

Required fields:

- shift number;
- cashier name;
- branch;
- shift opening timestamp;
- shift closing timestamp;
- report print timestamp;
- sales by payment method (cash, Visa/card, wallet, InstaPay);
- total sales;
- invoice count;
- expenses count and detailed expense lines;
- returns/refunds count and details, including related invoice;
- discounts count/total/details if the approved discount model supports them;
- opening float;
- cash sales;
- cash expenses;
- cash refunds;
- expected cash in drawer;
- expected Visa/card, wallet, and InstaPay amounts;
- actual counted/confirmed amount for each method;
- variance per method with clear shortage/surplus labels;
- net shift total and notes.

**Security behavior**

- Before confirmation, cashier sees only the actual-amount input fields (cash, Visa/card, wallet, InstaPay) and non-sensitive instructions. Do not reveal expected balances, totals that permit deriving them, or variance.
- After the cashier submits actual amounts and confirms close, persist the closing record, then show/print the close report with expected/actual/variance details according to approved policy.
- Owner/admin can inspect full details of open and closed shifts.
- The report must be generated from the persisted closing snapshot so reprinting later gives the same figures.
- If the close operation fails, do not mark the shift closed and do not print a report that claims it was closed.
- If the receipt printer is unavailable, the shift close remains persisted once, and the report can be reprinted later without closing the shift again.

### TREAS-01 — Treasury top-level feature

- Add a top-level navigation item **الخزنة**.
- Show current treasury balance, including positive or negative balances, with clear sign and currency.
- Provide auditable deposit, withdrawal, and transfer transactions, with source/destination, amount, reason, actor, timestamp, and links to related shifts/invoices/expenses/debt payments.
- Support filters by transaction type, date range, actor, and payment method where relevant.
- Closing a shift transfers the net cash to treasury once, according to CASH-01.
- Opening float deducts from treasury once.
- Admin can record permitted owner expenses, supplier-debt payments, and customer-debt receipts without opening a shift; these affect treasury directly, not an imaginary drawer/shift.
- Cashier-originated expenses attached to an open shift affect that shift and follow approved close-transfer rules.
- Keep cashless settlements separate from physical cash.
- Do not allow editing/deleting posted transactions as a shortcut; use compensating transactions with reasons and permissions.
- Test reconciliation across shift, drawer, treasury, supplier debt, customer debt, refunds, expenses, and imports.

### SUP-04 — Record supplier invoice price and payment without stock effects until posted

This is covered by SUP-02 and SUP-01. Ensure the two flows remain separate:

- A notice is informational only.
- A draft invoice is not posted.
- Only confirmed/posted actual invoice updates stock, cost, price, supplier balance, and payment records.

### CUST-02 — Customer debt receipts and supplier debt payments without opening a shift

- Admin can record customer-debt receipts and supplier-debt payments without opening a shift; they affect treasury directly.
- If the admin chooses to process one while a shift is open, require an explicit destination choice (treasury vs shift) where the business model supports both.
- Keep customer/supplier ledgers and treasury in sync atomically.
- Avoid recording the same payment both as a debt transaction and an unrelated cash expense/income.
- Test partial payments, full settlement, overpayment policy, retries, reversals, and opening balances.

### BACKUP-01 — Automatic daily backup at midnight, without blocking checkout

Owner preference: automatic backup at around 12:00 AM on the store PC, even if the app UI is closed; owner says the PC is normally running then. The current design must be inspected before choosing implementation.

**Requirements**

- Do not implement a blocking backup on shift close or in the cashier UI.
- Determine whether the database service and application can take a consistent online backup safely. Do not simply copy live database files unless the database engine officially supports that method.
- Schedule a daily backup around local midnight using a supported Windows service/task mechanism that runs when the app UI is closed. Confirm the machine's sleep/shutdown behavior and what happens if it is off at the scheduled time.
- If the PC was off, perform a missed-backup run at the next safe startup or next available opportunity, without running multiple redundant backups.
- Backup destination should be a protected folder outside the application installation directory, for example under `%ProgramData%\HeroMarket\backups` if appropriate after a permissions review. Do not store it in a per-user folder if the backup must run independently of user login.
- Define retention policy (e.g. daily/weekly rotation) and free-space management; ask the owner before choosing a retention duration if not documented.
- Use atomic file creation/rotation, checksums or integrity validation, and a clear backup status/log that avoids secrets and customer PII.
- Avoid running a full expensive backup in a way that blocks checkout. Measure runtime and I/O impact on a representative copy. If it may affect performance, use a supported low-impact method or ask the owner before enabling.
- Provide a restore procedure and periodically test restoring a backup into a disposable database. A backup is not proven until restore succeeds.
- Include backups in install/update/uninstall rules: routine update must never delete backup files or the data directory.
- Define encryption/access protection appropriate for customer data and Windows service accounts.
- Do not automatically overwrite the only good backup with a corrupt/new backup.
- The owner has not yet approved whether the scheduled task should be enabled immediately; present the design and performance findings if it is not safe to implement without a decision.

**Acceptance**

- Backup runs at scheduled time while app UI is closed.
- Backup is consistent while the database service is running.
- Missed run recovery works.
- Checkout is not materially blocked; measure and report.
- Retention and permissions work.
- Restore to a disposable database passes data-integrity checks.

### BACKUP-02 — Backup/restore, import/export, and schema-change regression gate

Any feature that changes schema, product model, financial ledger, role permissions, reports, or transaction flows can affect backup/restore and import/export.

For every migration or data-model change:

- Classify release as application-only, schema migration, data migration, or both.
- Version migrations and make them safe to detect/retry.
- Test upgrade from the current supported version with representative existing data.
- Test backup before migration, successful migration, failure partway through, restart after failure, restore, and rollback/recovery.
- Verify product/package metadata, customer codes, payment methods, supplier balances, treasury ledger, shifts, expenses, discounts, scale configuration, and all financial/stock history survive as appropriate.
- Keep export/import templates compatible and versioned. Test Arabic/decimal/barcode fields and relationships.
- Verify restore on a separate disposable database, not over the production database.
- A new application version that does not need a schema/data migration must not reset, recreate, or unnecessarily modify the existing database.
- If a migration ran, do not assume installing an older app is safe. Document whether reverse migration is supported; otherwise restore the verified pre-upgrade backup using a clearly defined procedure.
- No release may pass this gate solely because a backup file was created; restore and consistency checks must pass.

### ROLE-02 — User permissions and UI audit

- Audit all visible actions and routes against the backend permission matrix.
- Permissions must be enforced in backend/API/service layers, not only by hiding buttons.
- Add data import permission and any approved sale-payment correction/discount permissions.
- Preserve owner/admin-only supplier/customer debt snapshots, treasury views, all-expense views, all-shift details, and pre-close expected balances.
- Test role combinations and direct endpoint access.
- Produce a permission matrix in `.docs/` and keep it current.

### UX-01 — Functional audit of visible UI

- Inventory every menu item, button, modal, setting, filter, report, and shortcut.
- For each, document purpose, permission, input/output, side effects, and automated/manual test.
- Identify UI that is decorative, dead, or has no meaningful action. Implement the intended use case when clear; ask the owner when unclear.
- Do not remove an item simply because its purpose is not obvious; search code/docs and ask first.
- Check Arabic RTL, keyboard-only flows, focus order, readable error messages, empty states, loading states, and safe cancellation.
- Add meaningful loading/error/success feedback for operations that change money, stock, permissions, or database state.

---

## 4. Shared financial and stock integrity requirements

These rules apply across all requirements:

- Use decimal-safe money and quantity calculations. Never use binary floating point for money.
- Define rounding rules once and test boundary values.
- Every posted financial/stock operation must be one atomic transaction where supported.
- Use idempotency keys or durable unique operation IDs for actions that may be retried.
- Keep an auditable source document and immutable posted transaction history.
- Never let a UI-only filter alter accounting totals incorrectly.
- Separate cash, cashless payments, supplier balances, customer balances, inventory value, and treasury.
- Reconcile the same source-of-truth ledgers in POS, shift details, shift close, dashboard, exports, and printed documents.
- Any corrections to posted financial transactions should use compensating entries and audit history unless the owner explicitly approves another safe model.
- Validate permission on the server for every sensitive read/write.
- Test concurrent actions, duplicate clicks, app restart, service restart, disk-full/permission failures, and recovery where relevant.

---

## 5. Cross-feature regression matrix (mandatory)

Every affected feature must be tested against all relevant areas below, not only its own UI:

1. Database schema/migrations and existing data.
2. Backup creation, scheduled backup, restore, retention, permissions, and update/uninstall behavior.
3. Import/export templates, encoding, decimals, barcode fields, relationships, and round-trip compatibility.
4. POS sale, return/refund, discount, payment methods, reprint, offline use, and shift totals.
5. Supplier purchase invoice, package conversion, stock, average cost, selling price, supplier debt, payment, and treasury.
6. Customer codes, phone/address limits, debt receipts, search, and historical invoice snapshots.
7. Inventory movement ledger, stock count/adjustment, waste, negative stock policy, and valuation.
8. Role permissions, direct API access, privacy, audit logs, and password recovery.
9. Shift open/close, opening float, expected/actual balances, close report, reprint, and treasury transfer.
10. Reports, date filters, dashboard snapshots, and all-time historical data.
11. Arabic/RTL display and thermal printing, including mixed Arabic/English/numeric text.
12. Keyboard navigation, scanner input, decimal quantities, and focus handling.
13. Windows installation, multi-user permissions, service lifecycle, update, migration, rollback/recovery, and uninstall.
14. Failure injection: DB unavailable, log directory denied, printer missing, app closed, service restart, disk full, and interrupted operations.

---

## 6. Required automated tests

Add or update tests appropriate to the existing stack:

- Unit tests for unit conversion, scale barcode parsing/check digits, discount math, supplier discount allocation, cash/treasury reconciliation, date ranges, permissions, and receipt data formatting.
- Database integration tests for atomic posting, migrations, foreign keys, uniqueness, idempotency, opening balances, payment corrections, expense visibility, and backup/restore.
- API authorization tests for all role-sensitive data and direct access attempts.
- UI/E2E tests for keyboard navigation, category/product selection where applicable, quantity `0.5`, sign-out without shift, invoice cancellation, supplier invoice keyboard selection, and reprints.
- Regression tests for all affected old workflows.
- Property/boundary tests for decimal values, package sizes, large invoices, zero/negative/maximum values, duplicate requests, and date boundaries.
- Failure-injection tests for service startup, log permissions, database creation, migration failure, backup failure, printer timeout, and restart.
- Performance tests for product lookup, large stock movement lists, reports, and backup impact.
- No test may use the live shop database. Use disposable test databases and sanitized fixtures.
- Do not weaken/remove an existing test merely to get a green result. Explain any changed expectation.

---

## 7. Manual acceptance checklist for the owner

Provide a concise checklist with exact steps and expected results for:

- Clean Windows installation.
- Existing-version update with a verified copy of realistic shop data.
- App-only update preserving data.
- Schema/data migration update preserving data.
- Failed migration recovery using a verified backup.
- Two Windows users, login/logout, permissions, and service behavior.
- Product purchase/sale by package and loose unit.
- Scale label `2000001001257` with the configured scheme and tomatoes test product.
- Supplier invoice notice versus actual posted supplier invoice.
- Cash drawer opening float, shift close, treasury, and cashless methods.
- Owner vs cashier access to expenses, supplier/customer debt, shifts, and expected balances.
- Arabic receipt and shift close printing with actual printer.
- Barcode scanner with actual scanner.
- Automatic midnight backup while UI is closed and restore into a disposable DB.
- Export/import round-trip using the official template.
- Reprinting without duplicate financial or stock operations.

Hardware-dependent tests must remain explicitly “Pending hardware” until actually performed. Do not mark them passed based on mocks.

---

## 8. Release/version and update policy

- Inspect current `main`, open PRs, tags, and release state before choosing the next version.
- Do not force-push or overwrite release history.
- Do not merge, tag, publish, or deploy without explicit owner approval.
- Keep release version explicit and consistent across app, installer, docs, and release notes.
- For each release, declare one of:
  1. Application-only change — no database schema/data migration.
  2. Schema migration.
  3. Data migration.
  4. Schema + data migration.
- Application-only releases must preserve the existing DB and data directory.
- Migration releases must back up and verify first, apply a versioned migration safely, validate data, and document recovery.
- Do not assume downgrading the executable downgrades the database schema.
- Provide exact upgrade and recovery steps in `.docs/INSTALLATION_GUIDE.md` or a dedicated update guide.
- Do not claim automatic updates exist unless implemented, authenticated, integrity-checked, and tested.

---

## 9. Required documentation outputs

Update/create as appropriate:

- `.docs/OWNER_FEEDBACK_IMPLEMENTATION_PLAN.md` — dependency graph, phases, and owner questions.
- `.docs/OWNER_FEEDBACK_TASKS.md` — living checkbox list with status, evidence, and blockers.
- `.docs/PERMISSION_MATRIX.md` — roles, allowed actions, data visibility, API enforcement.
- `.docs/DATABASE_MIGRATION_AND_UPDATE_POLICY.md` — app-only vs migration releases and recovery.
- `.docs/BACKUP_RESTORE_AND_IMPORT_EXPORT.md` — schedule, retention, integrity, restore tests, template compatibility.
- `.docs/FINANCIAL_RECONCILIATION.md` — drawer, treasury, payment methods, opening float, shift close, variances.
- `.docs/RELEASE_NOTES_<version>.md` — user-visible changes, migrations, known limitations.
- Update the installation guide and operational instructions.

Do not create duplicate contradictory docs; inspect existing documents and update the canonical one where appropriate.

---

## 10. Owner questions that must be answered before implementation if repository inspection cannot resolve them

1. **Manual invoice-level discount:** this conflicts with the earlier rule that cashiers cannot choose/override discounts and only admin-configured automatic rules apply. Ask whether the earlier rule remains or selected roles may apply a fixed EGP invoice discount.
2. **Expense visibility:** should a non-admin see all expenses on their own shift, or only expenses they personally created? Default to creator + own shift, but ask before finalizing if that affects current workflows.
3. **Supplier notice amount:** is the cashier-entered amount the invoice total, amount already paid to the supplier, or an amount requiring owner attention? Keep it informational regardless.
4. **Scale barcode format:** verify exact digit positions and check digit using the actual scale configuration/manual or additional labels. The provided sample alone may not establish every format parameter.
5. **Backup retention:** confirm retention duration if no existing policy exists. Do not choose a potentially expensive or storage-heavy policy silently.
6. **Scheduled backup performance:** if measured impact is material, present options before enabling the schedule.
7. **Removing checks/cash-drawer audit:** confirm whether existing records must remain visible in historic reports even after the menu items are removed.
8. **Product pack-size changes:** warn and confirm when changing package size. If the app currently stores stock in packages rather than canonical units, stop and propose a safe migration before changing representation.
9. **Supplier discount cost allocation:** document how invoice-level discounts affect moving-average cost; ask if existing accounting policy is ambiguous.
10. **Negative treasury balance:** preserve the previously approved behavior only if it is still in the current repository's documented business rules; report any conflict.

Do not block every clear task while waiting for unrelated answers. Implement only unambiguous foundations and clearly separate owner decisions.

---

## 11. Definition of Done

A requirement is “Done” only when:

- implemented end-to-end;
- backend authorization and validation exist where relevant;
- database migrations are reviewed and tested if needed;
- automated tests pass;
- affected workflows and the cross-feature regression matrix pass;
- backup/restore and import/export compatibility have been verified for relevant data changes;
- documentation and task checklist are updated;
- screenshots/logs/test results provide evidence without exposing customer personal data or secrets;
- remaining risks and manual hardware checks are clearly identified.

“Code written,” “build succeeds,” or “unit tests pass” alone are not sufficient.

---

## 12. Execution reporting format

After each phase, report:

1. Requirements completed (IDs).
2. Files changed.
3. Database migration classification and migration IDs.
4. Tests run and exact pass/fail counts.
5. Backup/restore and import/export results.
6. Security/permission results.
7. Known issues and owner decisions required.
8. Whether real shop data, cloud resources, deployment, or release state changed (expected answer: no, unless separately approved).
9. The next small, reviewable phase.

Do not produce a large “all done” claim while hardware tests or required owner decisions remain open.

---

## 13. Dependency notes

These requirements share the following critical paths:

- **Inventory/unit model:** INV-01 ↔ supplier purchases ↔ POS sale/returns ↔ waste ↔ stock movements ↔ valuation reports ↔ backup/import/export.
- **Money model:** CASH-01 ↔ TREAS-01 ↔ EXP-01/02/03 ↔ SUP-02/03 ↔ CUST-02 ↔ PAY-01/02 ↔ SHIFT-01/02 ↔ DASH-01 ↔ BACKUP-01/02.
- **Permissions/privacy:** ROLE-01/02 ↔ expense visibility ↔ shift visibility ↔ supplier notices ↔ expected balances ↔ password reset.
- **Printing:** PRINT-01 ↔ POS-02 ↔ SHIFT-02 ↔ supplier invoice printing/reprint.
- **Scale/barcode:** SCALE-01 ↔ PROD-01 ↔ INV-01 ↔ POS quantities ↔ reports/import/export.
- **Data lifecycle:** every schema/data change ↔ migrations ↔ backup/restore ↔ import/export ↔ update/rollback.
- **Analytics:** ANALYTICS-01 ↔ dashboard/report date filters ↔ shift close/financial ledgers.
- **UX/keyboard:** POS-01 ↔ supplier invoice line selection ↔ product search ↔ waste search ↔ all small dialogs.
- **Navigation removal:** NAV-01/NAV-02 ↔ permissions, routes, reports, historical data, imports/exports.

---

## 14. Initial checklist

Use the following status values consistently:

- `[ ] Not started`
- `[~] In progress`
- `[x] Done with evidence`
- `[!] Blocked / owner decision`
- `[P] Pending physical hardware`

### Planning and foundations

- [ ] PLAN-01 Inspect repository and existing docs/flows.
- [ ] PLAN-02 Build dependency graph and identify conflicting rules.
- [ ] PLAN-03 Inventory every visible control and its real use case.
- [ ] PLAN-04 Create permission matrix and source-of-truth ledger map.
- [ ] PLAN-05 Identify schema/data migration and backup/export implications for every requirement.

### Data and inventory

- [ ] DATA-01 Export existing data using current import-template structure.
- [ ] INV-01 Wholesale package/loose-unit model.
- [ ] PROD-01 Edit product barcode/item code safely.
- [ ] SCALE-01 Configure and validate scale barcode parsing/check digit.
- [ ] PROD-02 Stock valuation by cost and retail.
- [ ] WASTE-01 Product search in waste/damage.
- [ ] STOCK-01 Top-level stock movements with filters.

### Suppliers and customers

- [ ] SUP-01 Informational supplier invoice notice.
- [ ] SUP-02 Supplier invoice selling price and invoice-level supplier discount.
- [ ] SUP-03 Supplier opening balance and editable contact details.
- [ ] CUST-01 Unique customer code and POS search.
- [ ] CUST-02 Debt receipts/payments without a shift where authorized.

### Cash, treasury, expenses, and shifts

- [ ] CASH-01 Reconcile drawer, opening float, and treasury.
- [ ] EXP-01 Restrict expense visibility by creator/own shift.
- [ ] EXP-02 Expense categories and optional description.
- [ ] EXP-03 Admin expense outside a shift.
- [ ] TREAS-01 Treasury navigation, ledger, filters, and reconciliation.
- [ ] PAY-01 Payment methods and close reconciliation.
- [ ] PAY-02 Privileged sale payment-method correction.
- [ ] DISC-01 Resolve owner decision; implement only after explicit approval if it changes existing discount policy.
- [ ] SHIFT-01 All-shift admin view/live details.
- [ ] SHIFT-02 Full shift-close receipt and post-confirmation disclosure.
- [ ] DASH-01 Stock value and debt dashboard snapshots.
- [ ] ANALYTICS-01 Fix report date filters.

### POS, UX, users, and printing

- [ ] POS-01 Keyboard navigation, decimal quantity entry, Escape confirmation, sign-out.
- [ ] POS-02 Receipt/no-receipt actions, shortcuts, safe reprints.
- [ ] PRINT-01 Arabic RTL receipt and shift-close printing.
- [ ] USER-01 Flexible password characters.
- [ ] USER-02 Secure admin password reset.
- [ ] ROLE-01 Data import permission.
- [ ] ROLE-02 Backend permission and data-visibility audit.
- [ ] NAV-01 Remove redundant drawer-count menu safely.
- [ ] NAV-02 Remove checks feature safely.
- [ ] UX-01 Audit every visible UI control.

### Data lifecycle, QA, and release

- [ ] BACKUP-01 Design/implement scheduled midnight backup without blocking checkout.
- [ ] BACKUP-02 Backup/restore/import/export/migration regression gate.
- [ ] QA-01 Unit/integration/E2E/authorization/failure-injection/performance tests.
- [ ] QA-02 Full cross-feature regression matrix.
- [ ] QA-03 Upgrade tests: application-only update.
- [ ] QA-04 Upgrade tests: schema/data migration and recovery.
- [ ] QA-05 Restore verified backup into disposable DB.
- [ ] QA-06 Clean Windows install and multi-user/service checks.
- [P] HW-01 Physical barcode scanner test.
- [P] HW-02 Physical thermal receipt printer test (sale receipt and shift-close receipt).
- [ ] DOC-01 Update canonical docs and operational guides.
- [ ] REL-01 Prepare release notes and risk register; no merge/tag/publish without owner approval.

---

## 15. Critical cautions

- Do not change existing financial/stock history just to make new reports appear correct.
- Do not make a supplier notice behave like a real purchase.
- Do not mix cashless settlement with physical cash.
- Do not reveal expected cash/card/wallet/InstaPay balances to a cashier before the approved closing confirmation point.
- Do not allow a routine update to erase database, backups, logs, or customer records.
- Do not claim a scale check digit is correct until the actual scheme is verified.
- Do not change the existing discount authorization policy without the owner's explicit answer.
- Do not delete check/cash-count data merely because the navigation item is removed.
- Do not mark hardware tests complete without physical hardware.
- Do not merge or publish automatically.

## 16. Living task checklist and evidence log

Maintain `.docs/OWNER_FEEDBACK_TASKS.md` as the canonical live tracker. For each task include:

- ID and short name;
- status (`Not started`, `In progress`, `Done with evidence`, `Blocked`, `Pending hardware`);
- implementation commit/PR if applicable;
- files changed;
- tests and pass/fail results;
- migration classification and IDs;
- backup/restore/import/export validation;
- permissions tested;
- screenshots/log references (sanitized);
- remaining risks/questions;
- next action.

At the end of each session, update this file immediately. Never mark a task done without evidence.

### Session log

| Date        | Phase    | Completed IDs | Tests/evidence | Blockers/decisions        | Next step                                          |
| ----------- | -------- | ------------- | -------------- | ------------------------- | -------------------------------------------------- |
| Not started | Planning | —             | —              | Repository audit required | Inspect current code/docs and build dependency map |
