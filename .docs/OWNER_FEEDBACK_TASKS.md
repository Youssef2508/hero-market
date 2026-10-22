# Owner feedback: living task tracker

Written for the developer and the next work session. It is the canonical status of every requirement in `HeroMarket_Owner_Feedback_Specification.md`. The plan, audit and dependency graph are in [OWNER_FEEDBACK_IMPLEMENTATION_PLAN.md](OWNER_FEEDBACK_IMPLEMENTATION_PLAN.md).

**Status values:** Not started · In progress · Done with evidence · Blocked — owner decision required · Pending physical hardware.

A task is "Done" only with tests, regression evidence and documentation (spec §11). Branch: `feature/owner-feedback` (version 1.5.0). Nothing is merged, tagged or published.

## Summary

| ID           | Name                                                      | Phase           | Status                                                                                                                                                                                                 | Migration             |
| ------------ | --------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| PLAN-01      | Inspect repository, docs, flows                           | —               | Done with evidence (plan §2–3)                                                                                                                                                                         | —                     |
| PLAN-02      | Dependency graph, conflicts                               | —               | Done with evidence (plan §5, §1: D-038)                                                                                                                                                                | —                     |
| PLAN-03      | Inventory of visible controls                             | G               | Done: .docs/UI_INVENTORY.md (UX-01, D-078)                                                                                                                                                             | —                     |
| PLAN-04      | Permission matrix, ledger map                             | G               | Done with evidence (.docs/PERMISSION_MATRIX.md generated from the code, D-075)                                                                                                                         | —                     |
| PLAN-05      | Migration and data-lifecycle implications                 | —               | Done with evidence (plan §6–7)                                                                                                                                                                         | —                     |
| ANALYTICS-01 | Report date filters                                       | A               | Done with evidence                                                                                                                                                                                     | none                  |
| SCALE-01     | Scale barcode, check digit                                | A               | Done with evidence (format confirmed by the owner, Q4; tests decode the owner's label 2000001001257)                                                                                                   | none (settings field) |
| POS-01       | Keyboard, 0.5, Esc confirm, sign-out                      | A               | Done with evidence (keyboard across windows and lists, F1/F2/F7, safe Enter, checked in the running app, D-065)                                                                                        | none                  |
| USER-01      | Flexible password characters                              | A               | Done with evidence                                                                                                                                                                                     | none                  |
| EXP-02       | Optional note (categories in D)                           | A / D           | Done with evidence (optional note in A; categories in D)                                                                                                                                               | none / 0016           |
| NAV-01       | Remove "جرد الدرج" menu entry                             | A               | Done with evidence                                                                                                                                                                                     | none                  |
| NAV-02       | Remove cheques screen                                     | A               | Done with evidence (admin-only read-only archive, processing removed, data kept)                                                                                                                       | none                  |
| SHIFT-01     | "الورديات" screen                                         | A (rename) / D  | Done with evidence (page rebuilt to the owner’s screenshots, D-063)                                                                                                                                    | 0016                  |
| DISC-01      | Manual fixed invoice discount                             | B               | Done with evidence (approved 2026-10-21; installer Case B test with phase H)                                                                                                                           | 0015                  |
| PRINT-01     | Arabic RTL receipt and shift report                       | C               | Done with evidence (software: tests and rendered previews; printer tested at the shop on 1.4.0, HW-02)                                                                                                 | none                  |
| CASH-01      | Drawer ↔ treasury                                         | D               | Done with evidence (phase D)                                                                                                                                                                           | 0016                  |
| TREAS-01     | Treasury page and ledger                                  | D               | Done with evidence (per payment method since D-064)                                                                                                                                                    | 0016                  |
| PAY-01       | Payment methods, blind close                              | D               | Done with evidence (phase D; blind close enforced in the service)                                                                                                                                      | 0016                  |
| PAY-02       | Change a sale's payment method                            | D               | Done with evidence (no reason asked; allowed after close as a reclassification, D-065)                                                                                                                 | 0016                  |
| EXP-01       | Expense visibility                                        | D               | Done with evidence (phase D)                                                                                                                                                                           | 0016                  |
| EXP-03       | Admin expense without shift                               | D               | Done with evidence (phase D)                                                                                                                                                                           | 0016                  |
| CUST-02      | Debt payments without shift                               | D               | Done with evidence (collections by method, retries recorded once, D-064)                                                                                                                               | 0016                  |
| SHIFT-02     | Shift-close report                                        | D               | Done with evidence (software; printer tested at the shop on 1.4.0, HW-02)                                                                                                                              | 0016                  |
| SUP-01       | Supplier invoice notice                                   | E               | Done with evidence (preliminary invoice with real payment and payable, D-064; cancellation, D-065)                                                                                                     | 0018 / 0019           |
| SUP-02       | Purchase sale price, discount, posting                    | E               | Done with evidence (invoice discount D-066; new selling and wholesale prices on purchase lines D-068)                                                                                                  | 0020 / 0021           |
| SUP-03       | Supplier opening balance, contact edit                    | E               | Done with evidence (opening balance as its own ledger line with its own permission; contact editing; D-070)                                                                                            | none                  |
| SUP-04       | Notice vs draft vs posted                                 | E               | Done with evidence (preliminary ≠ posted; conversion moves stock once, D-064)                                                                                                                          | 0017                  |
| INV-01       | Packages and loose units                                  | E               | Done with evidence (one stock in the base unit; package price and purchase price entered by the owner; HoHos acceptance tests, D-065)                                                                  | 0019                  |
| CUST-01      | Customer code                                             | F               | Done with evidence (codes C00001…, never recycled or changed, on invoices, searchable; D-072)                                                                                                          | 0022                  |
| PROD-01      | Edit barcode                                              | F               | Done with evidence (owner notes, 0017)                                                                                                                                                                 | 0018                  |
| PROD-02      | Stock valuation                                           | F               | Done with evidence (stock value at cost and selling price, rules stated, filters on rows and totals, reconciliation; D-071)                                                                            | none                  |
| WASTE-01     | Product search in waste                                   | F               | Done with evidence (product search and packages in the damaged-goods window; D-071)                                                                                                                    | none                  |
| STOCK-01     | "حركات المخزون" page                                      | F               | Done with evidence (حركات المخزون: same rows as each product's history, filters, traceable; D-071)                                                                                                     | none                  |
| DASH-01      | Dashboard snapshots                                       | F               | Done with evidence (period dashboard D-065; four live snapshots with links, D-071)                                                                                                                     | none                  |
| DATA-01      | Export in the import template                             | G               | Done with evidence (export in the template, read back before saving; round trip into an empty store, D-067)                                                                                            | none                  |
| ROLE-01      | Import/export permissions                                 | G               | Done with evidence (data.import and data.export, separate, granted per role, D-067)                                                                                                                    | none (catalogue)      |
| ROLE-02      | Backend permission audit, matrix                          | G               | Done with evidence (every operation permissioned or listed; roles refused by direct request; generated matrix kept current by a test; D-075)                                                           | —                     |
| UX-01        | Visible-control audit                                     | G               | Done (D-065 keys; D-078 inventory; owner answers: 2 permissions hidden, sync kept, «الأداء والأرباح» merged into the dashboard)                                                                        | —                     |
| POS-02       | Receipt modes, reprints                                   | G               | Done with evidence (F1/F2 print choice; reprints of sales, supplier invoices and closing reports from saved data, marked as copies, record nothing; D-077; physical print in HW-02)                    | none                  |
| USER-02      | Admin password reset                                      | G               | Done with evidence (admin re-authentication, temporary password expires after 72 h, sessions end, logged; D-076)                                                                                       | 0023                  |
| BACKUP-01    | Scheduled midnight backup                                 | G               | Done with evidence (tests + Windows Sandbox; shop PC check pending)                                                                                                                                    | none                  |
| BACKUP-02    | Lifecycle regression gate                                 | every phase     | Done with evidence (backup audit test: every table, restore row for row, failing restore; checklist DATA_IMPORT_EXPORT.md §6)                                                                          | —                     |
| QA-01…06     | Test layers, regression, upgrades, restore, clean install | every phase / H | Done with evidence for the software (390 tests; Windows Sandbox: clean install, Case A, Case B with records, failing update, older installer refused, going back; UPDATE_GUIDE.md §9). Shop PC pending | —                     |
| INSTALL-01   | Laptop install failure: regression test, evidence         | D               | Done with evidence (automated + laptop; new path automated only)                                                                                                                                       | none                  |
| DATA-02      | Test-data isolation (QA rows never reach a release)       | D               | In progress (verified and guarded; `heromarket_qa` still holds QA rows, dropped at the end of the UI checks)                                                                                           | none                  |
| HW-01        | Physical scanner                                          | H               | Done at the shop by the developer (2026-10-22, on 1.4.0): scanner and workflows. Scale labels in 1.5.0 by tests; the owner scans one after the upgrade (UPGRADE_TO_1.5.0.md step 16)                   | —                     |
| HW-02        | Physical receipt printer (sale + shift close)             | H               | Done at the shop by the developer (2026-10-22, on 1.4.0): receipt printer. The 1.5.0 right-to-left layout by tests and rendered previews; the owner checks the first print after the upgrade (step 16) | —                     |
| DOC-01       | Canonical docs                                            | every phase     | Done (release documents for 1.5.0: RELEASE_NOTES_1.5.0.md, UPGRADE_TO_1.5.0.md, UPDATE_GUIDE.md, NIGHTLY_BACKUP.md)                                                                                    | —                     |
| REL-01       | Release notes, risk register                              | H               | Done with evidence (version 1.5.0; RELEASE_NOTES_1.5.0.md with the owner's checklist, known limits and risks; D-079). Merge, tag and publish wait for the owner                                        | —                     |

## Owner decisions

| #   | Question                                                                                                                                                                                                            | Default used until answered                                                                                                                                                                                                                                     | Blocks |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| —   | **Manual invoice discount (DISC-01)**                                                                                                                                                                               | **Answered 2026-10-21: approved**, own permission, not given to cashiers by default. Never ask again.                                                                                                                                                           | —      |
| Q2  | Expense visibility for non-admin users: only expenses **they created**, or every expense of **their own shift**?                                                                                                    | **Answered 2026-10-21: only expenses the user created (any of their shifts); nobody else's, never the owner's**                                                                                                                                                 | —      |
| Q3  | Supplier notice amount: invoice total, amount already paid, or "amount needing attention"? It is informational either way.                                                                                          | **Answered 2026-10-21: the amount the cashier says was paid to the supplier; informational only**                                                                                                                                                               | —      |
| Q4  | Scale format: the sample is a valid EAN-13 (check digit 7 verified). Is the product code in HeroMarket `2000001` (prefix + 5 digits)? Do other labels use the same layout (prefix 20, 5-digit code, 5-digit grams)? | **Answered 2026-10-21: every label has the same layout.** Product code = the first 7 digits (`2000001`), weight = the next 5 digits in grams (`00125` = 0.125 kg), last digit = EAN-13 check digit. The physical scan stays HW-01                               | —      |
| Q5  | Backup retention (e.g. 14 daily + 8 weekly)?                                                                                                                                                                        | **Answered 2026-10-21: 14 daily + 8 weekly copies**                                                                                                                                                                                                             | —      |
| Q6  | Enable the midnight backup right away, after the measured impact is reported?                                                                                                                                       | **Answered 2026-10-21: approved, never ask again.** Every day at 00:00 local time, no confirmation and no UI; runs with nobody signed in; one catch-up run after a missed midnight; never blocks checkout (details in BACKUP-01)                                | —      |
| Q7  | After removing the cheques and drawer-audit screens, should old records stay visible in history reports?                                                                                                            | **Answered 2026-10-21:** cheques leave normal navigation and workflows; records kept, nothing deleted or dropped without separate approval; any archive is for authorised administrators only; cheque processing is not brought back                            | —      |
| Q8  | Release: skip publishing 1.4.0 and publish 1.5.0 when ready, or publish 1.4.0 first?                                                                                                                                | **Answered 2026-10-21: plan toward 1.5.0; 1.4.0 is not published first.** This is not approval to merge, tag, publish or deploy                                                                                                                                 | —      |
| Q9  | Supplier invoice discount: spread over the lines in proportion to line value, lowering each line's cost (moving average)?                                                                                           | **Answered 2026-10-21: proportional to the pre-discount line values**, deterministic rounding (largest remainder, whole piastres) so the shares add up exactly; tests cover line cost, moving average, supplier balance, stock value, returns, reports, exports | —      |
| Q10 | Treasury below zero: allowed and shown in red, or refused? (Negative stock is allowed; nothing is documented for money.)                                                                                            | **Answered 2026-10-21: allowed, shown in red, every movement logged**                                                                                                                                                                                           | —      |

## Task details

### Phase A: correctness fixes, application only

#### ANALYTICS-01: report date filters

- **Description:** "اليوم / آخر 7 أيام / آخر 30 يوماً / كل الأوقات" in الأداء والأرباح, and the period filter in التقارير المتقدمة, must change the figures.
- **Root cause (audit):**
  - `reports.periodic` selects shifts **started** since N days (`shiftIdsSince`), so a long-open shift's sales fall in every range.
  - "Today" starts at **yesterday** 00:00.
- **Fix:** filter sales, expenses, damaged goods and drawer movements by **their own timestamp**, in local business time.
  - Today = from today 00:00.
  - 7 / 30 days = today and the 6 / 29 days before.
  - "All" = no bound.
  - The same bound applies to rows and totals.
- **Dependencies:** none. **Migration:** none. **Backup/import:** none.
- **Tests:** service tests with sales, expenses and damage on several dates (today, yesterday, 10 days ago, 40 days ago), a shift spanning days, empty periods, and the day boundary.
- **Acceptance:** each period shows only its dates; totals equal the sum of the shown rows.
- **Evidence (2026-10-21):**
  - `tests/service/reportPeriods.test.js` (3 tests, pass): one shift open 45 days with sales today, yesterday 23:59:59, 6 and 40 days ago. Today / 7 / 30 / all = 10 / 70 / 70 / 150 EGP; expenses 1 / 1 / 3 / 3; advanced report for yesterday = 20 only; best sellers of today = today's product only.
  - UI: in التقارير المتقدمة, "الكل" changes the dates and the figures without pressing تحليل.
  - Fix in `reports.js` (`periodStartSql`; advanced report by record time, shifts overlapping) and `useAdvancedAnalytics.js` (quick ranges run at once; "أمس" ends at 23:59).
  - Cashier performance stays per shift on purpose: its rows are shifts.
- **Risks:** "advanced reports" uses its own range code. Check that it already uses timestamps.

#### SCALE-01: scale labels

- **Description:** `2000001001257` → product `2000001`, 125 g = 0.125 kg, 20.00/kg = 2.50.
- **Verified format:**
  - EAN-13 with prefix `20` (GS1 in-store range), item code `00001` (5 digits), weight `00125` in grams (5 digits), check digit `7`.
  - Check: weighted sum 23 → (10 − 3) mod 10 = 7 ✓.
  - This is the existing default layout (`codeStart 2, codeLength 5, valueStart 7, valueLength 5, weightDivisor 1000`).
- **Gaps:**
  - check-digit validation;
  - lookup by `prefix + code` (`2000001`);
  - clear refusals (bad check digit, unknown product, zero weight, kind mismatch).
- **Migration:** none. The settings JSON gains `checkDigit` (`ean13` by default for 13-digit labels, `none` otherwise); old stored settings stay valid.
- **Tests:**
  - unit tests: the sample, a wrong check digit, prefix not configured, a normal 13-digit barcode, leading zeros, zero weight, max weight, a price label;
  - service tests: scan → line 0.125 kg × 20 = 2.50; sale and return use 0.125 in the stock movements.
- **Backup/import:** the setting is in the `settings` table (backed up). Imported product codes like `2000001` work.
- **Acceptance:** the sample resolves as above; invalid labels are refused with a message and add nothing.
- **Evidence (2026-10-21):**
  - `tests/unit/units.test.mjs`: the owner's label is checked by hand-computed check digit (7), every wrong last digit, zero weight, the 99.999 kg maximum, a normal barcode, a scale without check digit, and old settings without the field.
  - `tests/service/units.test.js` "the owner's tomato label…": resolve → 0.125 kg at 20.00 = 2.50; stock 10 → 9.875 → 10 after the return; the movement is −0.125. Refusals: wrong check digit (400), unregistered code (404 naming 2000009), weight label on a count product (400), zero weight (400); `2000001` still resolves as a normal barcode.
  - UI: scanning `2000001001257` adds "QA طماطم" 0.125 kg = 2.50; `…1250` shows the check-digit message and adds nothing.
  - **Changed test expectations (explained):** the earlier fixtures `2000777002503`, `2200777045004`, `2900777001257` had invalid check digits; they are now the valid `…2502`, `…5008`, `…1256`. Real labels always carry a valid one.
- **Risks:** none for the format (Q4 confirmed: every label has the same layout); the physical scan is HW-01.

#### POS-01: keyboard and till behaviour

- **Description:**
  - typing `0.5` in a quantity box works;
  - Esc (and the "تفريغ" button) asks before clearing a non-empty invoice, and keeps it exactly when cancelled;
  - sign-out is always reachable, including from a required open-shift window;
  - small lists use ↑/↓/Enter (the purchase picker already does);
  - Esc never fires the clear-cart shortcut while a window is open.
- **Root causes:**
  - the quantity input is bound to the cart number;
  - `triggerClearCart` clears at once;
  - the required shift window (D-054) has no exit.
- **Migration:** none.
- **Tests:** UI run in the dev app: 0.5, Esc confirm and cancel, sign-out from the required window; unit test for the quantity draft rules.
- **Acceptance:** as described; the cart is unchanged after cancel.
- **Evidence (2026-10-21):**
  - `tests/unit/qtyText.test.mjs` (2 tests): 0 → 0. → 0.5 key by key; Arabic digits and decimal separators; invalid text.
  - UI (dev app, QA data): typed 0.5 into a weighed line, the box shows 0.5 and the total 10.00, kept after leaving the box. Esc shows "تفريغ الفاتورة"; cancel keeps the line, confirm clears it. cashier1 (required shift) sees "تسجيل الخروج" in the shift window and returns to the sign-in screen.
  - Esc is ignored by the clear shortcut while any window is open.
  - Scan errors are now shown to the cashier (they were only logged).

#### USER-01: password characters

- **Description:** allow any characters (letters, digits, symbols, spaces inside).
- **Rules kept:**
  - 8–128 characters;
  - not a common password;
  - not one repeated character;
  - not containing the username;
  - no leading or trailing space.
- **Removed:** "must contain letters and digits". This follows NIST SP 800-63B: no composition rules. It is a policy change, recorded as D-058.
- **Migration:** none. Existing hashes are untouched; login compares as before (no normalisation).
- **Tests:** unit tests for accepted symbol-only and letter-only passwords, and the refused cases; existing auth tests still pass.
- **Evidence (2026-10-21):**
  - `tests/unit/password.test.js`: letters only, digits only, symbols and Arabic are accepted; short, fewer than 4 different characters, plain runs, common passwords, leading space and the username are refused.
  - `tests/service/auth.test.js`: the change-password test now checks a plain run and too few characters instead of "letters only" (expectation changed by the owner's rule); 11/11 pass.
  - Existing hashes are untouched.
  - Decision D-058.

#### EXP-02 (part 1): optional expense note

- The note is optional in the service and the form. Categories become a table in Phase D (0016).
- **Tests:** service test, an expense without a note.
- **Evidence (2026-10-21):** `tests/service/expenseNote.test.js` passes. Expenses without a note (missing, '' or null) are stored with '', and the drawer line reads "مصروفات - تصنيف: صيانة" without a trailing dash. A given note is kept; the amount is still required (400).

#### NAV-01: drawer audit menu

- Remove the topbar "جرد الدرج" button.
- Keep `shift_audits`, the service and the reminder setting. The reminder is off when the owner unticks it in الإعدادات.
- **Tests:** UI check that the button is gone and the shift close still works.
- **Evidence (2026-10-21):** UI shows no "جرد الدرج" button; the periodic reminder and `shift_audits` are unchanged (setting in الإعدادات).

#### NAV-02: cheques

- Hide the "الشيكات" menu item and screen.
- Keep `checks_register`, its permission key (roles keep valid data) and its backup.
- **Owner decision (Q7, 2026-10-21):**
  - remove cheques from normal navigation and workflows;
  - keep every historical record; no deletion and no table drop without a separate explicit approval;
  - an archive or history view, if any, is for authorised administrators only;
  - cheque processing is not reintroduced.
- **Done (2026-10-21):**
  - the service no longer has `checks.create`, `checks.markPaid`, `checks.delete` or `checks.list` (they answer 404); the "due today" alert on the dashboard and at sign-in is gone;
  - new read-only operation `checks.archive` behind the new permission `checks.archive` ("أرشيف الشيكات (عرض فقط)"), held only by مدير النظام and مدير المتجر (excluded from the manager role);
  - `checks.manage` grants nothing; it stays so that stored roles remain valid;
  - the "أرشيف الشيكات" menu entry shows only to holders of `checks.archive`, and the screen has no add, settle or delete button;
  - `checks_register` is unchanged, with no migration, no deletion and no drop. It stays in backups and the import list.
- **Tests:** `tests/service/checksArchive.test.js` (3):
  - both administrator roles read the old records complete;
  - manager and cashier get 403; only the two administrator roles hold the permission;
  - the four old operations give 404 and the rows are byte-identical afterwards.
- **Changed test:** `flows.test.js` "FLOWS 24–27" exercised recording, settling and deleting a cheque. Those operations were removed by the owner's decision, so the test is now "FLOW 27" (expenses, unchanged), and the cheque cases moved to the archive test.
- **Evidence (2026-10-21):** the menu has no "الشيكات"; the roles screen labels the permission "الشيكات (الشاشة مخفية)"; `checks_register` stays in the backup list.

#### SHIFT-01 (part 1)

- Rename the menu item "سجل الورديات" → "الورديات".

### Phase B: DISC-01, manual fixed invoice discount (approved)

- **Description:**
  - A user holding the new permission `pos.manual_discount` can deduct a fixed EGP amount from the current invoice, with a reason, for example the yogurt case.
  - It never changes the product's price or stock.
- **Design:**
  - It applies **after** the automatic rules (D-044) and before customer credit. It is capped at the total after automatic discounts and must be > 0.
  - It is allocated to the lines by largest remainder, in whole piastres, into a **separate** `manual_discount` share on each line (or into `cart_discount` with a separate record). The final choice keeps returns refunding the line's net, so partial returns stay exact.
  - Stored in `sale_discounts` with `scope = 'manual'`, the amount, reason, actor and time; `sales.manual_discount` holds the total for reports.
  - One audit log entry per discount.
- **Permission:**
  - The service checks it in `pos.price` and `pos.checkout`; a refusal is 403 and logged.
  - Granted by default to `super_admin` and `store_admin` only; the owner assigns it to other roles in الأدوار والصلاحيات.
- **Shown in:**
  - the till (amount and new total before payment) and the receipt;
  - invoice details;
  - shift details and the shift-close report: count, total and the affected invoices.
- **Migration 0015 (schema only):** new nullable columns; no existing row changes.
- **Backup:** the columns are in already-backed-up tables. **Import/export:** sales are not in the template; no effect.
- **Tests:**
  - no permission → 403;
  - amount > total → refused;
  - reason required;
  - with and without automatic rules;
  - stacking order;
  - partial and full returns refund the exact paid net;
  - shift summary totals;
  - backup → restore keeps it;
  - the price preview equals checkout.
- **Acceptance:** the yogurt example: price 20, automatic 0, manual 2 → total 18; stock −1; price unchanged; the return refunds 18.

- **Evidence (2026-10-21):**
  - **Service tests:** `tests/service/manualDiscount.test.js` (4 tests, pass).
    - A cashier is refused in the preview and at checkout (403), with two `manual_discount_refused` log rows, and nothing is sold.
    - The old `discount` field stays refused.
    - Only store_admin and super_admin hold the permission by default.
    - Yogurt: 20 − 2 = 18. The price stays 20; stock goes 10 → 9 → 10; the manual row records owner and reason; an activity-log entry exists; invoice details show it; the return refunds 18.
    - Stacking: 150 − 15 (10% rule) = 135 − 10 manual = 125. Line shares: line 15, invoice 10. Over 135 refused; reason missing refused; 1.005 refused. Three partial returns refund 125 exactly.
    - Shift figures: count 2, total 12, invoices with user. A custom role granted the permission can use it. Backup → restore keeps the columns and the reason.
  - **Unit and property tests** of `priceCart` (unchanged) pass, so rule results are unchanged without a manual amount.
  - **UI (dev app, QA data):**
    - the owner sees "خصم يدوي"; 25 on a 20 invoice is refused in the window;
    - with 2 and a reason the due amount is 18.00 and the reason is shown;
    - F1 records total 18, discount 2, manual 2;
    - cashier1 sees no button.
  - **Not yet:** the installer's Case B check for migration 0015 runs in phase H with the other migrations. The receipt printing of the discount line is covered by PRINT-01 (phase C).

### Phase C: PRINT-01, Arabic right-to-left printing

- **Root cause (audit and photo):**
  - `print_receipt.ps1` draws table columns left to right (name at the left edge, total at the right) and label/value pairs value-right, with no `DirectionRightToLeft`;
  - mixed Arabic, Latin and digit text is shaped in left-to-right paragraphs.
- **Fix:**
  - right-to-left string formats for the receipt;
  - mirrored column geometry: name at the right, then qty, price, total at the left;
  - label right / value left for pairs, with the header drawn on the same columns;
  - bidi-safe isolation for numbers, phones and Latin names;
  - a preview mode that renders the page to a PNG with the same drawing code, so evidence comes without a printer.
- **Tests:**
  - render the RTL fixture (Arabic, Latin name, digits, decimals, phone, barcode) to PNG and compare positions;
  - existing receipt line tests still pass;
  - the shift report uses its own template.
- **Hardware:** HW-02 stays **Pending physical hardware**.

- **Evidence (2026-10-21):**
  - **Fix** (`resources/print_receipt.ps1`, line language unchanged): Arabic lines drawn as right-to-left paragraphs; the item table mirrored (name right … total left) with the header on the same columns; label right / value left; two-sided lines (date ↔ time) kept on their sides.
    - Latin and digit runs inside Arabic lines are wrapped in U+200E marks, so "09:34 PM", "#6", "2026-10-21 08:00:00" and "-15.00" keep their order. Embedding and isolate controls were tried and rejected: GDI+ draws them as boxes.
    - Table columns are sized from the widest value, so "0.125 كجم" is no longer cut to "0.12" (an earlier defect).
  - **Preview mode** `-PreviewFile`: the same drawing code renders PNGs.
    - Evidence: `.docs/reference-images/print-preview-receipt-rtl.png` and `print-preview-shift-rtl.png`.
    - The fixture data is invented: an Arabic name, a Latin name, a weighed line, a phone, a manual discount, and the shift report with "الخصومات اليدوية".
  - **Tests:**
    - `tests/unit/printPreview.test.mjs` (3, Windows): BOM kept; receipt and shift report render; a preview never prints "PRINT_DONE"; a missing printer still exits 2 with INVALID_PRINTER.
    - The 15 golden receipt cases and the report tests pass unchanged.
  - **Pending:** HW-02, the shop's thermal printer (sale receipt and shift report). The preview uses the same code but not the printer's driver or fonts.

### Phases D–H

### Phase F (2026-10-22, D-071, D-072, migration 0022)

- **«قيمة المخزون»:** stock value at cost and at selling price, from one stated rule (base units; negative stock as 0; no cost counted; stopped products optional). The filters change rows and totals together, and the screen reports a ledger reconciliation.
- **Dashboard «الوضع الآن»:** stock at cost and at selling price, owed to suppliers, owed by customers. The figures are live and each opens its screen. Permission `reports.valuation`.
- **«حركات المخزون»:** every movement, from the same rows as each product's history, filtered and traceable; a sale opens its invoice.
- **Damaged goods:** search by name or barcode by keyboard, and packages.
- **Customer codes:** C00001…, never recycled or changed, kept on invoices, searchable at the till.
- **Tests:** `stockReports.test.js` (5), `damagedUnits.test.js` (2), `customerCodes.test.js` (5, including the 0022 backfill over existing data).
- **Running app:**
  - snapshots and their link;
  - value filters (negative, weighed) on rows and totals;
  - movements with a sale opening its invoice by Enter;
  - no sideways scrolling at 1366 and 1024 px;
  - damaged goods found by part of a name with the keyboard only, with a carton = 24 pieces.

### SUP-03 (2026-10-22, D-070): supplier opening balance and contact

- **Opening balance:** entered when adding a supplier, or set and corrected from «تعديل». It is its own ledger line (corrections add the difference), never a purchase, stock receipt or money movement. Later payments reduce it once.
- **Words, not signs:** «مستحق للمورد (علينا)» or «مستحق على المورد (لنا)».
- **Permission:** `suppliers.opening`, administrators by default.
- **Contact editing:** name, phone, address and representative, in the activity log; invoices and payments unchanged.
- **Tests:** `supplierOpening.test.js` (5), including the owner's example of a supplier owed 2,000 at setup.
- **Running app:** a supplier was added owed 2,000, its contact edited (balance unchanged), and its opening balance corrected to 1,800.

### Owner decision D-068 (2026-10-22, migration 0021): new prices on purchase lines

- **Fields:** each purchase line has two optional fields, "سعر البيع الجديد" and "سعر البيع الجديد (الجملة)", for the product's base unit.
- **When filled:** the price is set when the purchase is confirmed, even over an earlier purchase's price, in the same transaction, and logged with its old and new value.
- **When empty:** the price stays. Package prices are never changed by a purchase.
- **Unchanged:** the moving average and the invoice discount.
- **Tests:** `purchaseSalePrice.test.js` (5).

### Owner requests D-066 and D-067 (2026-10-22, migration 0020): invoice discount, purchase returns, data workflow

- **Invoice discount (SUP-02, revised):** optional amount on the whole invoice. The payable and payments use the net; product costs and prices never change. The discount is a separate gain in profit (owner's answer). It is also available when completing a preliminary invoice.
- **Purchase returns (new):**
  - partial, never more than bought;
  - stock leaves at the line's cost, and the supplier is credited the net share (owner's answer);
  - money is recorded only when received, by its method, in the shift or the treasury; the rest stays owed by the supplier;
  - one transaction, once per request;
  - screen: «مرتجع» on each purchase with lines in the supplier's purchases list.
- **Data workflow (D-067):**
  - no importer for the other POS;
  - the export in the template's own layout (DATA-01);
  - template version 2 with optional package columns;
  - separate `data.import` and `data.export` permissions (ROLE-01), granted per role by an administrator;
  - the backup audit;
  - the compatibility checklist (DATA_IMPORT_EXPORT.md).
- **Migration 0020:** schema only. It adds the discount columns, two return tables and the `purchase_return` stock kind, all synced, backed up and included in the system reset. Existing rows are unchanged; a test over existing data covers it.
- **Tests (new):**
  - `purchaseDiscountReturns.test.js` (10);
  - `dataExport.test.js` (6, a real .xlsx round trip);
  - `backupAudit.test.js` (3);
  - `moneyMigration.test.js` 0020 (1).
- **Waiting for the owner:** the line selling price in purchases (original SUP-02).

### Owner requests D-065 (2026-10-21, migration 0019): cancellation, keyboard, invoice links, correction after close, dashboard, hotkeys, packages

- **Cancel a preliminary supplier invoice** (cashier: their own; administrator: any):
  - reverses the payable;
  - paid and returned: a real `supplier_refund` movement by its method, in the current shift or the treasury;
  - paid and not returned: the supplier owes it, with no money created;
  - converted: refused, a purchase return is needed;
  - a cancelled invoice cannot be completed; once only, atomic, never deleted;
  - screens: إلغاء on the suppliers screen and in "فواتير مبدئية بانتظار الأصناف" on the tills page.
- **Keyboard:** see D-065 in DECISIONS. Windows take and return the focus, keep Tab inside and close with Esc. Money forms need a deliberate Enter on the confirm button. Destructive confirms start on إلغاء. Rows work by Tab, Enter and the arrows.
- **Invoice links and alignment:** invoice numbers on the shift details open the invoice by click or Enter; identifiers in 10 tables isolated left to right.
- **Payment correction:** no reason (owner's answer); after close it reclassifies only (FINANCIAL_RECONCILIATION §8).
- **Dashboard:** today, this week (from Saturday), this month, this year, custom range. It shows sales, invoices, on-account sales, collections (never sales), expenses, damaged, purchases, preliminary purchases and net profit, plus sales per day or month, per method, and top products. The quick actions stay.
- **Hotkeys:** F1 confirm and print; F2 confirm without printing; F7 product search. They do nothing behind an open window and are shown on the till.
- **Packages (Parts 9–10):**
  - **already in 1.4.0:** units with a factor, own barcodes and price, factor snapshots on sale and purchase lines, purchase in units;
  - **added:** the package purchase price (the default cost when buying that package), a selling price required for a sellable package (never derived), stock shown as whole packages plus loose units (floor), and the pieces a purchase line adds;
  - **implementation order:** unchanged; INV-01 needed acceptance tests, now written.
- **Migration 0019:** schema only. It adds the cancellation columns and `cancelled` status, the `supplier_refund` kind, `after_close` on corrections and `product_units.purchase_cost`. No existing row changes.
- **Tests (new):**
  - `supplierCancel.test.js` (6);
  - `dashboard.test.js` (2, known data, collections and transfers never sales);
  - `packaging.test.js` (6, HoHos);
  - `packages.test.mjs` (1);
  - `ownerNotes.test.js`: correction after close.
- **Tests (updated):** units and measureKinds fixtures give explicit package prices, and a missing price is refused.
- **Running app (dev, `heromarket_qa`):**
  - F7 → search; F2 → 1 sale, no print (twice fast → 1); quantity typed then F2 → saved 3; F1 → 1 sale sent to the printer (a nonexistent printer name was set for the check and restored: no physical print);
  - Esc → clear confirm focused on إلغاء, a stray Enter kept the cart, F2 behind it made no sale;
  - shift details → invoice by Enter; ↓ and Enter in the invoice list;
  - treasury deposit: Enter in the amount saved nothing, 30 Tab presses stayed inside, Esc asked first, focus returned to إيداع;
  - dashboard ← → between periods, no amount cut off at 1000 and 1353 px;
  - the units window blocks a box without its price; stock "= 1 علبة QA + 8 علبة"; the purchase window fills the box purchase price 80 and shows "= 30 علبة" for 3 boxes (closed unsaved).
- **Not done:** a purchase return for converted invoices (needed to undo one; not requested); SUP-02 and SUP-03; physical scanner and printer (HW-01, HW-02).

### Owner decisions D-064 (2026-10-21, migration 0018): payables, receivables, per-method treasury, close

- **Decided:**
  - The owner answered the close question: the cashier enters the four counted amounts, as already built. The total is shown from them.
  - The difference is per method and overall, on both the shift details page and the closing report. The total-only proposal is withdrawn.
  - Each method's counted amount goes to its own treasury balance.
- **Inferred from the model and recorded in D-064 (not invented):**
  - the detailed invoice is the true debt, so the payable is adjusted by final − preliminary in an explicit ledger row;
  - when more was paid than the final total, the supplier owes the store (a credit balance, as for customers).
- **Built:**
  - **Preliminary supplier invoices** (`supplierInvoices.*`, permission `suppliers.pending` for cashiers):
    - stage A records the payment once, by its method, from the shift (or the treasury), plus the payable; no stock;
    - stage B ("إكمال" on the suppliers screen, `suppliers.manage`) records the lines, stock and moving-average cost, with no payment, and an explicit adjustment for a different total;
    - one conversion only; retries return the first result.
  - **Treasury per method:** balances for cash, Visa, wallet and InstaPay plus the total; a method on every row, filter and form; one close transfer per method.
  - **Movement kinds and retries:** `safe_ledger.kind` and `client_ref`. Collections, settlements and expenses are recorded once per request.
  - **Receivables:** the part of a دفع جزئي sale paid at once has its own method at the till. Collections can be by any method.
  - **Reports:**
    - shift details and the closing report (screen and print) show per method the expected, actual and difference, with the totals;
    - they also show credit and partial sales (paid now / unpaid), collections, supplier payments (with invoices / settlements) and the transfers to the treasury.
  - **Payment method pickers:** on collections, supplier payments and expenses.
  - **Purchase window:** the "شيك" option is removed (cheques are not processed).
- **Opening and close screens:** the opening window shows only the drawer float (as since D-063). The close dialog shows the four counted amounts and their total.
- **Migration 0018:** schema + data. It backfills the kinds from existing texts and changes no amount.
  - Rollback: the installer's verified copy (Case B).
  - Backup, restore and the system reset include `supplier_pending_invoices`; the new columns travel with their tables.
- **Tests:**
  - new `payablesReceivables.test.js` (7);
  - `moneyMigration.test.js`: 0018 backfill on existing data;
  - `closeReport.test.mjs`: totals and categories.
- **Updated tests (owner rules):**
  - `moneyModel.test.js`: cashless counted amounts now reach their treasury balances;
  - `security.test.js`: the cashier holds `suppliers.pending`, and not `suppliers.manage`.
- **UI evidence (dev app, `heromarket_qa`):**
  - the opening window has one section and one input;
  - preliminary invoice 250 with 100 paid shows 150 remaining;
  - the blind dialog shows only the shift number and the cashier's own total;
  - report rows per method and the total row; completion with a +10 difference;
  - per-method treasury tiles; the details page reconciliation.
- **Not done in this segment:**
  - SUP-02: sale price entry on purchase, and the supplier invoice discount allocation;
  - SUP-03: opening balance and contact edit;
  - a "cancel" for a preliminary invoice entered by mistake (not requested; a reversal would need an owner rule).

### Owner notes after phase D (2026-10-21, D-063, migration 0017)

1. **Payment methods only (no Momkn):**
   - الأدراج والتحويلات now shows the shift's cash drawer and the four methods: expected per method, and sales, collections and refunds for cashless;
   - for users without `shifts.view_expected` it shows a blind notice;
   - the Momkn machine and wallet-service tills are gone from the open-shift window, the close dialog (the multi-till close is removed), the printed shift report and the menus;
   - their permissions are labelled "(غير مستخدمة)", and their old records stay in the database.
2. **الورديات rebuilt to the owner's screenshots:**
   - list with branch and day filters: # / الكاشير / الفرع / الفتح / الإغلاق / افتتاح / المتوقع / الفعلي / الفرق / الحالة (مفتوحة / مغلقة) / تفاصيل, and "فتح وردية جديدة" when the user can open one;
   - full details page with رجوع and طباعة الوردية: four cards (الافتتاح، المتوقع نقدي، الفعلي كاش، الفرق); sales by method with filter chips and method tiles; الكاشير / الفرع / المخزن / وقت الفتح / وقت الغلق / مدة الوردية; invoices; expenses; returns ("مسترد" per return, with its method);
   - an open shift refreshes every 5 s;
   - service: `shifts.list` (an open shift's expected cash only for `shifts.view_expected`); `shifts.details` adds invoices, branch and cashier;
   - the periodic count tab (الجرد الدوري) is no longer shown; its records are kept.
3. **Barcode edit (PROD-01):**
   - the edit window has a الباركود field, saved through `products.changeBarcode`;
   - sale lines, stock movements, units, extra barcodes, purchases, damaged goods and discount rules all follow the product;
   - stock is unchanged, and movements stay immutable;
   - migration 0017 makes the sale-line and damaged-goods foreign keys cascade.
4. **Manual discount without a reason:** the field is removed. The service accepts the discount without one and keeps a reason if one is sent. This replaces the reason rule of D-057.
5. **Payment method correction without a reason:** the field is removed; 0017 makes the column optional.

- **Migration 0017:** schema only: two foreign keys, an optional reason, and `sale_returns.refund_method` / `paid_back`. Rollback is the installer's verified copy (Case B).
- **Tests:**
  - new `ownerNotes.test.js` (3): barcode change with its whole history and refusals; discount without a reason; correction without a reason;
  - `manualDiscount.test.js` asserted "reason required"; it now asserts the owner's new rule.
- **UI evidence (dev app, `heromarket_qa`):** shifts list, open and closed details (the Visa chip filters to 1 invoice), الأدراج والتحويلات per method with no Momkn, barcode QABAR1 → QABAR2.

### Phase D: money model (migration 0016, D-062)

- **Design and formulas:** [FINANCIAL_RECONCILIATION.md](FINANCIAL_RECONCILIATION.md), the single source for every money formula.
- **Migration 0016:** schema + data. It adds, and changes or removes nothing.
  - `safe_ledger.method` defaults to cash, so every older row stays cash;
  - new tables: `treasury_ledger` (rows immutable, by trigger), `shift_closings` (immutable), `expense_categories`, `sale_payment_corrections` (immutable);
  - new columns on expenses: `created_by`, `category_id`, `destination`, `ledger_id` and `treasury_entry_id`. `created_by` is backfilled from the shift's cashier, the category from its name;
  - the new tables join the cloud sync, the backup and the system reset.
- **Rollback and recovery:**
  - the installer takes a verified copy before migrating (Case B). Going back to 1.4.0 means restoring that copy;
  - money recorded after the update would then be lost, so the owner decides before a rollback (UPDATE_GUIDE).
- **New permissions,** administrators only (`super_admin`, `store_admin`): `shifts.view_expected`, `expenses.view_all`, `treasury.view`, `treasury.manage`, `sales.change_payment`. Managers also get `expenses.categories`.
- **Service:**
  - opening float −treasury, close +counted cash, each once (idempotency keys);
  - expected and variance per method;
  - blind close: `shifts.liveSummary` and `shifts.auditPreview` answer 403, `tills.drawerSummary` and `shifts.audit` leave the money out. The approval request carries no amounts, and every refused attempt is logged with what was counted;
  - close snapshot, retry by `clientRef`, `shifts.closeReport`, `shifts.details`, `shifts.openList`;
  - refunds go back on the sale's method;
  - expenses are scoped to their creator; categories; shift or treasury destination, chosen explicitly;
  - customer and supplier payments to the shift or the treasury;
  - `treasury.*` operations; `sales.changePaymentMethod`.
- **Found and fixed:** since phase A, deleting an expense without a note left its drawer row behind (the text match expected " - note"). Expenses now delete their own row by id, and older ones match both text forms. A regression test covers it.
- **Screens:**
  - payment buttons cash / Visa / wallet / InstaPay plus on account;
  - blind close dialog with four counted amounts; the close report shown at once and reprintable;
  - الخزنة page (balance in red when negative, filters, deposit, withdrawal, adjustment, reversal);
  - expenses (creator, destination, categories manager); destination choice on customer and supplier payments;
  - الورديات: open shifts with live details (refreshed every 5 s) and the report of every closed shift;
  - "تغيير" payment method on an invoice of an open shift;
  - blind periodic count; the tills screen without drawer figures for the cashier.
- **Tests:** full suite 295/295. New:
  - `moneyModel.test.js` (5): one shift end to end, recomputed independently from raw rows; treasury immutability and reversals; expense visibility, deletion and destination; categories; backup and restore round trip;
  - `moneyMigration.test.js` (1): 0016 over 1.4.0 data with an open and a closed shift;
  - `closeReport.test.mjs` (3).
- **Mutation checks:** refunding cashless sales from the drawer, or returning the expected amount to a blind count, makes `moneyModel.test.js` fail.
- **Changed tests,** each for an owner rule (none removed):
  - approvals, checkout, integrity and flows now read expected figures as the owner and assert the cashier gets 403;
  - the approval test asserts no amounts reach the cashier;
  - flows asserts `destination_required`;
  - shiftRule: an owner expense with no shift goes to the treasury, and a manager still needs a shift.
- **UI evidence (dev app, `heromarket_qa`, 1353×706):**
  - cashier: blind dialog shows no figure except the shift number;
  - with a cash difference above 50, the approval window shows no amount; after the owner approved, the report was saved;
  - exact count: the report shows at once, every method "مطابق"; sign-out follows; the next user does not see it;
  - treasury −100 / +100 for the shift;
  - the owner is asked to choose a destination;
  - open shift live details and the closed shift report.
- **Print evidence:** `.docs/reference-images/print-preview-close-report-rtl.png`, rendered by `print_receipt.ps1` (preview). HW-02, the shop printer, is still pending.
- **Not covered (documented):**
  - the Momkn and wallet _service_ tills keep their own sections;
  - a partial payment's upfront part is cash;
  - a supplier invoice paid at purchase still uses the drawer (phase E, SUP-02);
  - cashless settlement to the bank is outside HeroMarket;
  - "instant" shift details means a 5-second refresh.
- **Upgrade note:** a shift opened before the update has no float in the treasury; its close still adds the counted cash. The owner records the counted treasury once as a deposit ("رصيد افتتاحي").

#### PAY-01: payment methods (owner note, 2026-10-21)

- **The only payment methods are Cash, Visa, Wallet and InstaPay** (نقدي، فيزا، محفظة، انستا باي).
- **Today** the till offers نقدي، فودافون كاش، انستا باي، آجل، دفع جزئي. There is no Visa.
- **Mapping:**
  - فودافون كاش becomes محفظة (Wallet). Old sales keep their stored text and are reported under Wallet.
  - Visa is added.
- **Interpretation, to be confirmed by the owner:**
  - آجل (on account) and partial payment are not payment methods. They leave an amount unpaid on the customer's account (customer debt).
  - They stay so that existing credit sales and debts keep working. The paid part, if any, uses one of the four methods.
  - Not covered: removing on-account sales altogether.

#### BACKUP-01: automatic midnight backup (approved 2026-10-21)

- **Built 2026-10-21:** see [NIGHTLY_BACKUP.md](NIGHTLY_BACKUP.md) for the path, schedule, names, retention, restore steps, failure reporting and the evidence table.
- **Method:** the program's own backup format, read from one consistent REPEATABLE READ snapshot.
  - The bundled PostgreSQL has no `pg_dump`/`pg_restore`, and adding binaries needs approval.
  - The manual backup had the same consistency gap (each table on any free connection); it is fixed too.
- **Evidence:**
  - `backupJob.test.mjs` (6) and `scheduledBackup.test.js` (3): restore into a disposable database, sales during a backup, about 80,000 rows in 1.6 s;
  - Windows Sandbox B1–B5: task, run with the program closed as SYSTEM, permissions, same-day skip, automatic catch-up after a missed midnight, uninstall.
- **Pending at the shop:** a PC switched off over midnight, and the timing on the real data.

- **Schedule:** every day at 00:00 local time, with no confirmation and no window. It runs while nobody is signed in (Windows Task Scheduler or the service, as the system account).
- **Catch-up:** one backup at the next start of the machine when midnight was missed. Never more than one.
- **Location:** `%ProgramData%\HeroMarket\backups`, after the permissions of the account that runs it are checked.
- **Names:** timestamped and showing the kind, e.g. `HeroMarket-daily-2026-10-22_0000.backup` and `HeroMarket-weekly-…`.
- **Retention:** 14 daily and 8 weekly copies.
- **Safety:**
  - each new copy is verified before anything is pruned;
  - the only known-good copy is never deleted, and a good copy is never overwritten;
  - checkout is never blocked; the impact is measured and, if there is a risk, a lower-impact method is used and documented with evidence.
- **Tests:** restore into a disposable database; retention; permissions; logs; a scheduled run with the app closed; missed-run recovery.
- **Docs:** path, schedule, naming, retention, restore steps, failure reporting.

#### SUP-02: supplier invoice discount (Q9 answered)

- The invoice discount is spread over the lines in proportion to their pre-discount values.
- Rounding is deterministic (largest remainder, whole piastres). The shares add up exactly to the discount.
- **Tests:** line cost, moving average, supplier balance, stock valuation, returns, reports, exports.

#### INSTALL-01: the owner's laptop install failure (revisited 2026-10-21)

- **Reported symptoms:**
  - `setup.log` showed a database preparation failure;
  - writing `app.log` failed with EPERM;
  - the connection setup screen appeared even though preparation had failed.
- **Fix:** commit bfde35b (AUDIT A-20 to A-23).
- **Root causes and the fix:** commit bfde35b, 2026-10-16 (AUDIT A-20 to A-23):
  - **Preparation failure:** a Unix `whoami.exe` (`C:\WinAVR-20100110\utils\bin`) came first on the laptop's PATH, so the elevated setup could not read the user's SID. Every Windows tool now starts from System32 (`src/main/winTools.js`).
  - **EPERM on `app.log`:** the elevated setup had created `logs\app.log`, and the program running with normal rights could not open it. Installer steps now log only to `setup.log`, and the app log falls back and never throws (`src/main/logFile.js`).
  - **Connection screen after the failure:** the installer now stops with exit code 3 and does not start the program. An installed store that cannot open shows "قاعدة بيانات المتجر غير جاهزة" with a retry.
- **Gap found and closed (2026-10-21):**
  - a damaged `heromarket.json` (the file and its `.bak`) on an installed PC still led to the connection screen, which would have rewritten the file;
  - it now shows the store problem (`config_damaged`);
  - the checks moved to `src/main/storeCheck.js` and the screen choice to `src/renderer/src/lib/startupPhase.js`, so both are tested without Electron.
- **Regression tests:**
  - `tests/unit/startupPhase.test.mjs` (7): no config written (the laptop's state) → `store_not_prepared` → store problem; `setup_incomplete`; `database_newer`; `config_damaged`; a service start failure with and without a code; a prepared store opens; client and development PCs keep the connection screen;
  - the earlier `winTools.test.mjs` (PATH hijack reproduced), `logFile.test.mjs` (unwritable log) and `migration.test.js` (1.3 files unchanged).
- **Evidence, kept apart by where it was obtained:**

  | Where                                                                      | What                                                                                                                                                                | Result                          |
  | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
  | Automated (this PC, CI)                                                    | The tests above                                                                                                                                                     | Pass                            |
  | Windows Sandbox laptop replica (clean Windows, `whoami.exe` first on PATH) | The old build fails exactly as on the laptop; the fixed build installs over that state; first start with normal rights; the store-problem screen                    | Pass (AUDIT §10, screenshot)    |
  | **The owner's laptop**                                                     | Build 4fbed9f installed over the failed attempt (service, locked folders, import, 1.3 files byte- and time-identical); f351e4f installed over it as a Case A update | Pass (AUDIT §10, rows 6 and 11) |
  | **The owner's laptop: not done**                                           | The store-problem screen itself (it needs a failed preparation); the `config_damaged` case; any 1.5.0 build                                                         | **Not tested on the laptop**    |

- **Status:** the reported failure is fixed, with evidence from the laptop for the install and the update. The new `config_damaged` path has automated evidence only.

#### DATA-02: test-data isolation

- **Where the QA rows are (queried 2026-10-21):**
  - only in the database `heromarket_qa`, on the development cluster at `D:\Youssef\Brands\HeroMarket\.pgdata` (port 54329) on the development PC;
  - sale #34 (total 18.00, manual discount 2.00, shift 6, item `QAYOG`); products `QAYOG` "QA زبادي" and `QAUNC723869`; 34 sales and 11 products in all;
  - the other databases on that cluster (`heromarket`, `heromarket_installed`, `heromarket_test`) have no QA products and no sale #34.
- **The real shop data:** the supermarket PC and its database were never reached by this work. The 1.3 store `%APPDATA%\elnagdi-pos` was only ever read or copied.
- **Clean-up:** `heromarket_qa` is disposable and stays until the money phase's checks in the app are done. It is then dropped, and its removal is recorded here.
- **Release check:**
  - the 1.4.0 candidate installer (f0f0d84, SHA-256 `960bc572…`) was unpacked and searched: no database, dump, backup, `PG_VERSION`, `heromarket.json`, credentials or `.env` file, and no QA product code anywhere, including the 5,196 files of `app.asar`.
- **Guard test** `tests/unit/releaseContents.test.mjs` (3):
  - the package excludes `.pgdata`, backups, docs, tests, scripts, database and log files, and `.env` (checked to fail when `.pgdata` is removed from the exclusions);
  - migrations add rows to the shop's tables only by copying existing rows (`INSERT … SELECT`), never literal rows;
  - no QA record name appears in migrations or in the service and shared code.

Each requirement keeps the scope, acceptance criteria and tests listed in the specification; the audit gaps are in the plan §3. Detail is added here when its phase starts.

## Session log

| Date       | Phase     | Completed IDs                                                                        | Tests / evidence                                                                        | Blockers / decisions                              | Next step                      |
| ---------- | --------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------ |
| 2026-10-21 | Planning  | PLAN-01, PLAN-02, PLAN-05                                                            | Audit in the plan §3; reference images stored, receipt redacted for git                 | DISC-01 approved; Q2–Q10 open                     | Phase A                        |
| 2026-10-21 | A         | ANALYTICS-01, SCALE-01, USER-01, NAV-01, NAV-02; POS-01, EXP-02 and SHIFT-01 in part | npm test 266/266; lint 0 errors; UI runs in the dev app at 1353×706                     | Q4 at the shop                                    | Phase B (DISC-01)              |
| 2026-10-21 | B         | DISC-01                                                                              | npm test 270/270; manualDiscount.test.js 4/4; UI in the dev app                         | —                                                 | Phase C                        |
| 2026-10-21 | Decisions | Q4, Q6–Q9 recorded (D-060); payment methods note (D-061); INSTALL-01; NAV-02         | 283 → 286 tests; startupPhase.test.mjs, releaseContents.test.mjs, checksArchive.test.js | —                                                 | Phase D                        |
| 2026-10-21 | D-064     | SUP-01, SUP-04, TREAS-01 (per method), CUST-02, close per method                     | 316/316 tests; payablesReceivables, moneyMigration 0018, closeReport; UI evidence above | —                                                 | SUP-02 rest, SUP-03, phase F   |
| 2026-10-21 | D         | CASH-01, TREAS-01, PAY-01, PAY-02, EXP-01/02/03, CUST-02, SHIFT-01, SHIFT-02         | 295/295; moneyModel, moneyMigration, closeReport tests; UI and print evidence above     | Payment methods interpretation (D-061) to confirm | BACKUP-01, then phase E        |
| 2026-10-21 | C         | PRINT-01 (software)                                                                  | npm test 273/273; printPreview.test.mjs; preview PNGs in reference-images               | HW-02 at the shop                                 | Phase D (money model; Q2, Q10) |
