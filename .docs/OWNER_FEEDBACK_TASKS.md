# Owner feedback: living task tracker

Written for the developer and the next work session. It is the canonical status of every requirement in `HeroMarket_Owner_Feedback_Specification.md`. The plan, audit and dependency graph are in [OWNER_FEEDBACK_IMPLEMENTATION_PLAN.md](OWNER_FEEDBACK_IMPLEMENTATION_PLAN.md).

**Status values:** Not started · In progress · Done with evidence · Blocked — owner decision required · Pending physical hardware.

A task is "Done" only with tests, regression evidence and documentation (spec §11). Branch: `feature/owner-feedback` (version 1.5.0). Nothing is merged, tagged or published.

## Summary

| ID           | Name                                                      | Phase           | Status                                                              | Migration             |
| ------------ | --------------------------------------------------------- | --------------- | ------------------------------------------------------------------- | --------------------- |
| PLAN-01      | Inspect repository, docs, flows                           | —               | Done with evidence (plan §2–3)                                      | —                     |
| PLAN-02      | Dependency graph, conflicts                               | —               | Done with evidence (plan §5, §1: D-038)                             | —                     |
| PLAN-03      | Inventory of visible controls                             | G               | Not started (UX-01)                                                 | —                     |
| PLAN-04      | Permission matrix, ledger map                             | G               | In progress (plan §4; matrix in G)                                  | —                     |
| PLAN-05      | Migration and data-lifecycle implications                 | —               | Done with evidence (plan §6–7)                                      | —                     |
| ANALYTICS-01 | Report date filters                                       | A               | Done with evidence                                                  | none                  |
| SCALE-01     | Scale barcode, check digit                                | A               | Done with evidence (Q4 confirmation at the shop)                    | none (settings field) |
| POS-01       | Keyboard, 0.5, Esc confirm, sign-out                      | A               | In progress (0.5, Esc, sign-out done; list keyboard audit in UX-01) | none                  |
| USER-01      | Flexible password characters                              | A               | Done with evidence                                                  | none                  |
| EXP-02       | Optional note (categories in D)                           | A / D           | In progress (optional note done; categories in D)                   | none / 0016           |
| NAV-01       | Remove "جرد الدرج" menu entry                             | A               | Done with evidence                                                  | none                  |
| NAV-02       | Remove cheques screen                                     | A               | Done with evidence (UI hidden, data kept; Q7 for reports)           | none                  |
| SHIFT-01     | "الورديات" screen                                         | A (rename) / D  | In progress (renamed; live details in D)                            | 0016                  |
| DISC-01      | Manual fixed invoice discount                             | B               | Not started (**approved 2026-10-21**)                               | 0015                  |
| PRINT-01     | Arabic RTL receipt and shift report                       | C               | Not started                                                         | none                  |
| CASH-01      | Drawer ↔ treasury                                         | D               | Not started                                                         | 0016                  |
| TREAS-01     | Treasury page and ledger                                  | D               | Not started                                                         | 0016                  |
| PAY-01       | Payment methods, blind close                              | D               | Not started                                                         | 0016                  |
| PAY-02       | Change a sale's payment method                            | D               | Not started                                                         | 0016                  |
| EXP-01       | Expense visibility                                        | D               | Blocked — owner decision (Q2)                                       | 0016                  |
| EXP-03       | Admin expense without shift                               | D               | Not started                                                         | 0016                  |
| CUST-02      | Debt payments without shift                               | D               | Not started                                                         | 0016                  |
| SHIFT-02     | Shift-close report                                        | D               | Not started                                                         | 0016                  |
| SUP-01       | Supplier invoice notice                                   | E               | Blocked — owner decision (Q3) for the amount's meaning              | 0017                  |
| SUP-02       | Purchase sale price, discount, posting                    | E               | Not started (Q9 for cost allocation)                                | 0017                  |
| SUP-03       | Supplier opening balance, contact edit                    | E               | Not started                                                         | 0017                  |
| SUP-04       | Notice vs draft vs posted                                 | E               | Not started                                                         | 0017                  |
| INV-01       | Packages and loose units                                  | E               | In progress (exists; confirmation and acceptance tests missing)     | none                  |
| CUST-01      | Customer code                                             | F               | Not started                                                         | 0018                  |
| PROD-01      | Edit barcode                                              | F               | Not started                                                         | 0018                  |
| PROD-02      | Stock valuation                                           | F               | Not started                                                         | none                  |
| WASTE-01     | Product search in waste                                   | F               | Not started                                                         | none                  |
| STOCK-01     | "حركات المخزون" page                                      | F               | Not started                                                         | none                  |
| DASH-01      | Dashboard snapshots                                       | F               | Not started                                                         | none                  |
| DATA-01      | Export in the import template                             | G               | Not started                                                         | none                  |
| ROLE-01      | Import/export permissions                                 | G               | Not started                                                         | none (catalogue)      |
| ROLE-02      | Backend permission audit, matrix                          | G               | Not started                                                         | —                     |
| UX-01        | Visible-control audit                                     | G               | Not started                                                         | —                     |
| POS-02       | Receipt modes, reprints                                   | G               | Not started                                                         | none                  |
| USER-02      | Admin password reset                                      | G               | In progress (exists, D-046; verify, add re-authentication)          | none                  |
| BACKUP-01    | Scheduled midnight backup                                 | G               | Blocked — owner decision (Q5 retention, Q6 after measurement)       | none                  |
| BACKUP-02    | Lifecycle regression gate                                 | every phase     | In progress                                                         | —                     |
| QA-01…06     | Test layers, regression, upgrades, restore, clean install | every phase / H | In progress                                                         | —                     |
| HW-01        | Physical scanner                                          | H               | Pending physical hardware                                           | —                     |
| HW-02        | Physical receipt printer (sale + shift close)             | H               | Pending physical hardware                                           | —                     |
| DOC-01       | Canonical docs                                            | every phase     | In progress                                                         | —                     |
| REL-01       | Release notes, risk register                              | H               | Not started                                                         | —                     |

## Owner decisions

| #   | Question                                                                                                                                                                                                            | Default used until answered                                                                           | Blocks                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------- |
| —   | **Manual invoice discount (DISC-01)**                                                                                                                                                                               | **Answered 2026-10-21: approved**, own permission, not given to cashiers by default. Never ask again. | —                                  |
| Q2  | Expense visibility for non-admin users: only expenses **they created**, or every expense of **their own shift**?                                                                                                    | None (current behaviour unchanged until answered)                                                     | EXP-01                             |
| Q3  | Supplier notice amount: invoice total, amount already paid, or "amount needing attention"? It is informational either way.                                                                                          | —                                                                                                     | SUP-01                             |
| Q4  | Scale format: the sample is a valid EAN-13 (check digit 7 verified). Is the product code in HeroMarket `2000001` (prefix + 5 digits)? Do other labels use the same layout (prefix 20, 5-digit code, 5-digit grams)? | Both `2000001` and `00001` are accepted as the product code                                           | SCALE-01 (final confirmation only) |
| Q5  | Backup retention (e.g. 14 daily + 8 weekly)?                                                                                                                                                                        | —                                                                                                     | BACKUP-01                          |
| Q6  | Enable the midnight backup right away, after the measured impact is reported?                                                                                                                                       | —                                                                                                     | BACKUP-01                          |
| Q7  | After removing the cheques and drawer-audit screens, should old records stay visible in history reports?                                                                                                            | Data kept; old records stay in the database and the activity log                                      | NAV-02 history only                |
| Q8  | Release: skip publishing 1.4.0 and publish 1.5.0 when ready, or publish 1.4.0 first?                                                                                                                                | Work continues as 1.5.0                                                                               | REL-01                             |
| Q9  | Supplier invoice discount: spread over the lines in proportion to line value, lowering each line's cost (moving average)?                                                                                           | Proportional (largest remainder, whole piastres), like the automatic cart discount                    | SUP-02                             |
| Q10 | Treasury below zero: allowed and shown in red, or refused? (Negative stock is allowed; nothing is documented for money.)                                                                                            | —                                                                                                     | CASH-01 / TREAS-01                 |

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
- **Risks:** Q4 (other label layouts at the shop).

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
- **Q7** only decides whether old cheques appear in reports.
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

### Phases D–H

Each requirement keeps the scope, acceptance criteria and tests listed in the specification; the audit gaps are in the plan §3. Detail is added here when its phase starts.

## Session log

| Date       | Phase    | Completed IDs                                                                        | Tests / evidence                                                        | Blockers / decisions          | Next step         |
| ---------- | -------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------- | ----------------- |
| 2026-10-21 | Planning | PLAN-01, PLAN-02, PLAN-05                                                            | Audit in the plan §3; reference images stored, receipt redacted for git | DISC-01 approved; Q2–Q10 open | Phase A           |
| 2026-10-21 | A        | ANALYTICS-01, SCALE-01, USER-01, NAV-01, NAV-02; POS-01, EXP-02 and SHIFT-01 in part | npm test 266/266; lint 0 errors; UI runs in the dev app at 1353×706     | Q4 at the shop                | Phase B (DISC-01) |
