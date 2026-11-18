# Keyboard-first till, returns without an invoice, scale items, line count – QA report (1.9.0)

Written for Youssef, to review before anything is merged, released or deployed. Nothing here is merged, released or deployed. All tests ran on throw-away PostgreSQL databases with made-up data; the owner's PC, his database and the production website were not touched (one read-only query of the website's copy, to learn the owner's scale settings: prefix 20, item code at offsets 2–6, grams, EAN-13; 39 products registered under 7-digit codes starting with 2; 10 groups of codes that differ only by leading zeros).

Decisions: [DECISIONS.md](DECISIONS.md) D-116 (returns without an invoice), D-117 (scale items), D-118 (keyboard), D-119 (line count).

## 1. Why the keyboard never felt complete (root causes)

1. **Arrows only inside a few fixed groups:** radio groups, tabs, menus, the sidebar, the payment methods, button rows and the customer matches. Nothing linked one group to the next, so from the product field an arrow went nowhere.
2. **Groups went round instead of out:** at the last payment method → went back to the first, so the keyboard could never leave a group.
3. **Windows moved only between their buttons,** in a fixed cycle: a window's fields could not be reached with the arrows.
4. **The quantity box wrote to the line on every keystroke and was never focused after a scan.** The cashier had to find it, clear the 1, and a scan started in it (the next product scanned without Enter) left its first digit in the quantity.
5. **Pre-filled fields were not selected:** the opening float showed 200, so typing 500 made 200500 (found by the test below).
6. **A closed list box changed its choice on ↓:** moving down a form could change a delivery address unseen.
7. **Table rows kept ↓ at the last row,** so paging and buttons below a table were unreachable.
8. **F4 «حذف آخر صنف» removed nothing:** it passed the barcode where the cart expects the line key. This was old, and found by the new test.

## 2. Screens and controls audited

All **34 screens of the sidebar** were opened and entered with the keyboard alone, in the real desktop program, with the number of distinct controls the arrows reached from the screen's first control (↓ ×12, ← ×6):

| Screen                   | Controls reached | Screen             | Controls reached |
| ------------------------ | ---------------- | ------------------ | ---------------- |
| شاشة الكاشير             | 17               | التوالف والهوالك   | 13               |
| المرتجعات                | 14               | لوحة الإدارة       | 16               |
| مرتجع بدون فاتورة        | 13               | التقارير المتقدمة  | 18               |
| إعادة طباعة فاتورة       | 14               | تقييم الكاشيرات    | 6                |
| تغيير طريقة الدفع        | 14               | تقرير المنتجات     | 17               |
| الفواتير                 | 15               | قيمة المخزون       | 15               |
| العملاء                  | 14               | الورديات           | 16               |
| الموردون والمشتريات      | 18               | المستخدمون         | 8                |
| فواتير الموردين المبدئية | 13               | الأدوار والصلاحيات | 9                |
| سداد ديون الموردين       | 13               | الخصومات           | 15               |
| المصروفات                | 18               | إعدادات المتجر     | 9                |
| الخزنة                   | 18               | تصميم الفاتورة     | 12               |
| الأصناف والمخزن          | 17               | النسخ الاحتياطي    | 4                |
| حركات المخزون            | 16               | استيراد وتصدير     | 8                |
| التصنيفات                | 15               | المزامنة السحابية  | 6                |
| مساعد الطلبيات           | 15               | تحتاج انتباهك      | 13               |
|                          |                  | سجل العمليات       | 15               |
|                          |                  | أرشيف الشيكات      | 14               |

Small numbers are small screens (a single table, a few buttons), not unreachable controls.

**What this sweep proves, and what it does not:**

- **Proves:** every screen opens from the sidebar (↑ ↓, Enter), the arrows enter it (←), and they move between its controls and back to the sidebar (→).
- **Does not prove:** each screen's own workflow (adding a product, a supplier payment…) completed by keyboard. Only the workflows in §4 were carried out end to end.

**Kinds of controls exercised:**

- buttons, text and number fields, list boxes, checkboxes, date fields;
- table rows and sortable headers, product and customer matches;
- payment methods, the top bar and the sidebar, with its footer;
- windows: opening a shift, the weight window, confirmations.

## 3. The keyboard model (D-118)

- **One layer for the whole program** (`lib/spatialNav.js`): an arrow goes to the nearest usable control in that direction on the screen, as the eye sees it.
- **Order of preference:**
  1. the same row (or column);
  2. within the area the focus is in (top bar, sidebar or page), a control within 45° of the key's direction;
  3. only then the nearest control in another area.
- **Scope:** an open window is the only place it looks.
- **Never takes a key someone needs:**
  - a component's own keys come first (the product list, table rows, radio groups, tabs, menus, the sidebar's vertical list), and groups leave at their ends;
  - text fields keep ← → until the caret is at the edge (or the field is empty or all selected);
  - a closed list box is passed like a button: Enter opens it, and its arrows then choose.
- **Enter:** activates the focused control (checkbox, radio, option, tab; opens a list box; buttons and links as always).
- **Focus ring:** solid, with a gap, in both themes.
- **Fields with a value:** selected when a window opens or when the arrows reach them.
- **Unchanged:** Tab, Shift+Tab, F1–F9, Esc, Ctrl+Alt+L and the mouse.

## 4. Keyboard-only workflows that passed

All in the real desktop program (Electron), on a throw-away database (`scripts/e2e/keyboard.js`).

- **Input:** key presses only; no click and no programmatic focus after the window opens. A scan is a burst of digits and Enter (8 ms a key); typing is human speed, with each character confirmed in the field before the next.
- **No fixed waits:** payment waits for the sale in the database, a window for its closing.

| #   | Workflow                                                                                                                                                                                                                                                                         | Result |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Sign in; «فتح وردية» reached with ↑ from the product field; the float typed over 200 → the shift opens with 500                                                                                                                                                                  | passed |
| 2   | The till opens with the focus in the product field; «عدد الأصناف: 0»                                                                                                                                                                                                             | passed |
| 3   | Scan → focus on that line's quantity, selected → type 50 → Enter → back to the product field; the quantity is 50 (not 150, not 501)                                                                                                                                              | passed |
| 4   | A scale label of product 1 (its own code, not 2000001) → 0.125 kg, its quantity focused → 0.5                                                                                                                                                                                    | passed |
| 5   | The same product scanned again → its own line (51), not a new one; 2.5 pieces refused with «يباع بالعدد: اكتب عدداً صحيحاً», focus kept; 3 accepted                                                                                                                              | passed |
| 6   | 01 typed by hand → exactly 01 (never 1 or 001) → its weight window → 250 g → its quantity focused                                                                                                                                                                                | passed |
| 7   | ← from the product field to «فيزا», Enter chooses it; ↓ to the paid amount, typed; ↓ to the customer, typed, ↓ into the matches, Enter; ↓ to «طلب توصيل», Enter ticks it; the address list passed; ↓ to the receipt switch, Enter (printing off); → to the confirm button, Enter | passed |
| 8   | The sale: one invoice, Visa, the customer, delivery; lines 01 0.25, 1 0.5, 6223001360063 3; stock lower by exactly that, 001 untouched; focus back in the product field, «عدد الأصناف: 0»                                                                                        | passed |
| 9   | Codes typed by hand (6221234567890, 001 with its weight), F9 300, F2 → a cash sale of 290.00                                                                                                                                                                                     | passed |
| 10  | «عدد الأصناف»: the same product twice → 1; a second → 2; F4 → 1; Esc, the question's confirm by the arrows → 0, focus back in the product field                                                                                                                                  | passed |
| 11  | → from the till to the sidebar; ↓ to «مرتجع بدون فاتورة», Enter; scan → its quantity selected → 2 → Enter; ↓ to the reason, typed; ↓ to «صرف … وإتمام المرتجع», Enter; the confirmation's «تأكيد» by ←, Enter → saved: 26.00 refunded in cash, 2 back in stock                   | passed |
| 12  | Every sidebar screen (34): §2                                                                                                                                                                                                                                                    | passed |
| 13  | Tab and Shift+Tab: from the product field Tab moves on, Shift+Tab comes back; in the open-shift window 12 presses (Tab ×6, Shift+Tab ×6) all stay inside it                                                                                                                      | passed |

**Repeated runs, with nothing else running:** runs 4, 5 and 6 – 53/53 each; runs 7, 8 and 9 (with the Tab checks added) – 55/55 each.

**One earlier failure, explained:** run 2 of an earlier set failed because I briefly stashed the working tree while it started. The program reads its service code from `src/` at launch, so that run started without the new permission. It was my interference, not a product fault, and the clean runs after it passed.

**Screenshots:** in the run's shots folder (`keys-cart.png`, `keys-before-pay.png`, `keys-return.png`).

## 5. Tab and Shift+Tab

Unchanged by design: the new layer handles only the four arrow keys.

- **Checked in the end-to-end test:** Tab leaves the product field and Shift+Tab returns to it; Tab and Shift+Tab stay inside an open window (the existing trap).
- **Results of runs 7, 8 and 9,** each 55/55 including these checks: Tab leaves the product field and Shift+Tab returns to it; in the open-shift window, Tab ×6 and Shift+Tab ×6 stay inside and end back on the float.

## 6. Returns without an invoice (D-116)

- **Permission:** `sales.return_without_invoice`, given to «مدير النظام» and «مدير المتجر» only; never to cashiers by default. The service checks it on every request: a cashier's call is refused with 403 and nothing is written.
- **Screen:** «مرتجع بدون فاتورة» in «البيع اليومي», shown only with the permission.
- **The return:** scan or type each product; quantity (counted products whole, weights to the gram); an optional known customer; a required reason; the refund shown, then confirmed.
- **Price:** the product's selling price now (of the unit returned), kept on the line.
- **Its own document:** `customer_returns` + `customer_return_items`, with its number, time, user, customer, reason, lines, prices, total, the drawer movement and each stock movement. No invoice number is invented.

## 7. Drawer, stock and shift close (verified in `returnsWithoutInvoice.test.js`)

- **Stock:** one `customer_return` movement per product (rice +3, cheese +0.250), marked with the return.
- **Drawer:** one cash `refund` outflow of the user's open shift («مرتجع بدون فاتورة #…»). The expected cash drops by exactly the refund (175.00).
- **Close report:** the return is in the returns list («مرتجع بدون فاتورة», no invoice) and counted in the returns total and the drawer's refunds. No open shift: refused with `shift_required`.
- **Reports:** sales stay what was invoiced. The returns are shown apart, and their margin (refund − cost of the goods back) comes off the net profit (dashboard and periodic).
- **Once only:** the same request twice, or two at the same moment → one return, one movement of each kind.
- **Invalid inputs** are refused whole, with nothing written: 1.5 of a counted product, more than 3 decimals of a kilogram, an unknown product, an empty reason, no lines, a negative quantity, a product priced 0, a valid line beside an invalid one.
- **Offline and duplicate delivery:** made with the link down → not on the website; after reconnecting, the website holds the return, its line, its drawer movement and its stock movement once. Everything sent a second time → still once.

## 8. Scale labels (D-117): decoding and an example

- **Format:** the store's own settings decide the decoding. The owner's are a 13-digit label, prefix 20, item code at offsets 2–6, weight at 7–11 in grams (÷ 1000), EAN-13 check digit.
- **Example:** `2000001001257` → prefix 20, item code `00001`, weight `00125` → **0.125 kg**, check digit 7. It reads product **1** when 1 is marked «صنف ميزان».
- **Refused, never another product:**
  - a wrong check digit → 400 «رقم التحقق خاطئ»;
  - a zero weight → 400;
  - an unknown code → 404 (its details now reach the screen: `notFound` used to drop them);
  - a weight label on a product counted in pieces → 400;
  - an unconfigured prefix → not a label, so not found.
- **Resolution order:**
  1. a product's own barcode equal to the scanned text, as before;
  2. otherwise the marked product with the label's key;
  3. otherwise, for products nobody marked, exactly as before 1.9.0: a fixed order of exact codes (2000001, 00001, the digits after the prefix, then those without leading zeros).
- **Existing products:** they behave exactly as before. The update marks nothing and changes no code (`scaleUpgrade.test.js`, below).

## 9. Leading zeros and collisions

Typed codes stay exact: 1, 01, 001 and 0001 are four products, as fixed in D-110.

**Marking «صنف ميزان» is refused (409, every conflict named, in Arabic) when:**

- another marked product has the same key, in either order:
  - 1 then 01 / 001 / 0001;
  - 03 then 3;
  - 004 then 0004;
- another product answers that key's labels today:
  - a product registered under the label's digits (2000005 stops 5);
  - an unmarked product whose code is exactly the key (01 cannot be marked while 1 exists, or labels 2000001… would move from 1 to 01);
- another product's own barcode is such a label;
- the code has letters or is longer than the label's item code.

**The same check runs on:**

- a new product's code (2000001 and 00001 refused while 1 is marked);
- a changed code (7 → 0000001 refused; 7 → 77 accepted, its key following);
- an extra barcode (refused);
- the import (row errors in the check);
- the scale settings: a 2-digit item code refused, naming 345 (too long) and 1/01.

**Concurrency:** two people marking 1 and 01 at the same moment → exactly one succeeds. The service holds one lock, and the database keeps one key per product (deferred unique constraint).

**Example message:** «لا يمكن تفعيل صنف الميزان للصنف «جبنة بيضاء» (01) لأن كود الميزان الناتج يتعارض مع صنف آخر. الصنف المتعارض: جبنة رومي — الكود: 1، … غيّر كود أحد الصنفين أو عطّل خاصية الميزان للصنف الآخر.»

**Audit:** «فحص أصناف الميزان» in the scale settings lists anything that no longer fits, and changes nothing.

## 10. «عدد الأصناف» (D-119)

- **Where:** always beside the invoice title.
- **What it counts:** the cart's own lines (5 Pepsi + 6 yogurt + 3 juice = 3). The badge beside it keeps pieces, kilograms and litres.
- **Verified in the program:** 0 → 1 → 2 → 3 as products were added; a higher quantity and a repeated scan kept the count; F4 → one fewer; a clear → 0; a completed sale → 0.

## 11. Database migration 0041 (additive only)

- **`products`:** `scale_item boolean NOT NULL DEFAULT false` and `scale_key text`, with a deferred unique constraint and a check that the two agree.
- **New tables:** `customer_returns` and `customer_return_items`, both synchronised (sync capture trigger), in the backup and in the system reset.
- **Stock movement kinds:** + `customer_return`.
- **Permission:** `sales.return_without_invoice`, given once on upgrade to the administrator roles.

**Upgrade test** (`scaleUpgrade.test.js`):

- **The store:** a 1.8.0 store (schema 0040) built by the migrations, holding 2000001, 2000002, 1, 01, 001, a package and two extra barcodes;
- **The result after migrating:** every product, unit, barcode and stock movement identical, compared as text; every product unmarked; 2000001 still 2000001; each label names the same product as before.

## 12. Desktop and website

- **Desktop:** the till, the scale items and the return screen; migration 0041.
- **Website:** the same service code and the same migration (it holds the store's copy). The new operations are classified:
  - `sales.returnWithoutInvoice` – a new fact (`add`), like invoice returns;
  - `products.setScaleItem` – shop only (`linked`: kept for the shop while it is offline);
  - the lists and the audit – reads.
- **Synchronisation:** the new rows and the two product columns travel by the existing mechanism; no new event type.
- **Mixed versions:** refused by the schema check (D-105): a 1.9.0 PC and a 1.8.0 website do not synchronise until both are 1.9.0. The shop keeps selling meanwhile.

## 13. Automated tests

- **The whole suite:** 645/645 passed (it was 618 in 1.8.0).
- **New tests:**
  - `scaleItems.test.js` – 13;
  - `returnsWithoutInvoice.test.js` – 6;
  - `scaleUpgrade.test.js` – 1;
  - `spatialNav.test.mjs` – 7;
  - the end-to-end keyboard test (§4).
- **Updated:** the operation inventory (182 operations), the permission matrix, the sidebar layout (34 screens), the UI inventory.
- **Lint and format:** 0 lint errors; Prettier clean.
- **Builds:** the desktop and website builds succeed.

## 14. Screenshots

The end-to-end run saves them:

- `keys-cart.png` – the invoice with «عدد الأصناف: 3»;
- `keys-before-pay.png` – the payment panel reached by keyboard;
- `keys-return.png` – the return saved.

## 15. Performance and usability notes

- **Speed:** the arrow layer measures the visible controls on each key press. It was not timed on its own; in the end-to-end test every move had completed within the 140 ms the test waits after a key, on every screen.
- **Arriving in a field selects its text,** as Tab does, so typing replaces the value.
- **↓ at the bottom of the sidebar** moves into the page (the nearest control below); ↑ at the top of the page goes to the top bar.

## 16. Remaining risks

- **Each screen's own workflow by keyboard alone** (adding a product, recording a purchase, a supplier payment…) was not carried out end to end; only §4's workflows were. The arrows reach those screens' controls (§2).
- **Not run:** the installer-level upgrade (1.8.0 → 1.9.0 in Windows Sandbox, with a paired store). The migration-level upgrade test passed. Run it before releasing, as was done for 1.8.0.
- **Physical hardware:** the shop's real scanner and scale printer were not used; a scan was simulated as a keyboard-wedge burst.
- **Not tested end to end:**
  - a desktop restart while a no-invoice return waits to be sent (the outbox survives restarts, as for every table, but it was not tested for this one);
  - the website's own use of «مرتجع بدون فاتورة» from the owner's phone (it uses the owner's open shift there, like invoice returns).
- **New behaviour for the owner:** marking 01 while an unmarked 1 exists is refused. If he wants 01 on the scale, he first changes or removes the conflicting code.

## 17. In-place upgrade procedure

The same as 1.8.0 ([BUSINESS_LOGIC_REPORT_1.8.0.md](BUSINESS_LOGIC_REPORT_1.8.0.md) §14). No unpairing, no new code, no Excel import.

1. **The owner** backs up («النسخ الاحتياطي» → «إنشاء نسخة احتياطية الآن») to a USB stick.
2. **Merge and release** 1.9.0, after approval.
3. **Update the website:** `sudo deploy/cloud/update.sh v1.9.0` (backs up, applies 0041, keeps the store and its link).
4. **The owner** installs `HeroMarket-Setup-1.9.0.exe` over 1.8.0 (0041 applied automatically after the installer's verified copy) and signs in as before.
5. **Check «المزامنة السحابية»:** the same store, «بانتظار الإرسال» to 0, the same version on both sides.
6. **No product becomes a scale item by itself:** he marks «صنف ميزان» on the products he chooses, and the check refuses anything a label could not tell apart.

## 18. Must the website be updated before the EXE?

**Yes, as for 1.8.0.**

- **Why:** 0041 changes the store's database version, and the website refuses a PC whose version differs from its own (D-105).
- **Order:** update the website first. Between the two updates the owner's 1.8.0 PC is refused by the website, keeps selling on its own database, and catches up once updated.
- **The other order** (a 1.9.0 PC on a 1.8.0 website) is refused the same way and gains nothing.
- **Both are required:** the website's code also has to know the new operations and tables.
