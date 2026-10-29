# HeroMarket POS 1.5.2 – Release notes

Written for the shop owner. 1.5.2 brings the changes you asked for after 1.5.1. Everything in [RELEASE_NOTES_1.5.1.md](RELEASE_NOTES_1.5.1.md) and [RELEASE_NOTES_1.5.0.md](RELEASE_NOTES_1.5.0.md) still applies.

**Install it over what the shop PC has now (1.4.0, 1.5.0 or 1.5.1).** Follow [UPGRADE_TO_1.5.2.md](UPGRADE_TO_1.5.2.md). The database is updated once, after a verified copy. Nothing has to be imported again.

## Purchase price: the latest purchase, not an average

- **When a purchase invoice is saved**, each product's purchase price becomes the price on that invoice. The price is per piece or per kilo: a carton at 120 for 24 pieces makes 5. Older purchases and the stock on hand no longer count.
  - Your example: bought at 200, sold at 240. A new invoice at 220 with a new selling price of 260 leaves the product at exactly **220 / 260**. Before, the purchase price would have become an average (about 206.67 or 207.69, depending on the stock). A package keeps its own typed selling price, or follows 260 × its count when it is automatic.
- **Empty fields keep the current price:**
  - an empty purchase price keeps the product's price, and the line counts at that price;
  - an empty selling price keeps the selling price;
  - a free line (price 0, bonus goods) does not change the price.
- **Past sales keep their cost and their profit.** Later prices never change them. A customer's return comes back at the cost it was sold at. A purchase return goes back at the cost it was bought at. Neither changes the purchase price.
- **On the day of the update**, each product takes the price of its latest purchase. A product never bought through HeroMarket keeps the price it has. Every change is recorded with the purchase it came from.
  - The profit of past sales does not change.
  - The stock value at purchase price changes once, by the difference between the old average and the latest price.
- **The stock value** («قيمة المخزون») now shows «سعر آخر شراء». It is an estimate, because HeroMarket does not track the price of each batch.

## Suppliers

- **Paying an old supplier debt from the drawer, with your approval** (new permission «طلب سداد دين مورد من الدرج»):
  - The cashier chooses the supplier and the amount on the new screen «سداد ديون الموردين» → «سداد دين مورد». The cash leaves the drawer at once.
  - **The supplier's balance falls only when you approve.** You see «طلبات سداد» in the top bar; it opens «سداد ديون الموردين», where you approve or reject («اعتماد طلبات سداد الموردين»). The same list is on «الموردون والمشتريات».
  - **Rejecting a request cancels it completely.** You give a reason, and the money goes back:
    - into the drawer of the shift it came from, if that shift is still open;
    - otherwise into the treasury, recorded against that shift and that request.

    The supplier's balance does not change. It is never an expense or a loss. The request, the money taken out and the money put back all stay in the history, the shift details, the closing report and the printed close.

  - **The cashier who recorded a request can cancel it** while it is still waiting («إلغاء الطلب» on «سداد دين مورد»), with a reason. The money comes back the same way. A cashier never approves their own request, even with the approval permission; an administrator approves it.
  - Rejecting or cancelling twice, or both at the same moment, puts the money back once.
  - Approving never takes money from the drawer a second time.
- **Opening a recorded purchase invoice:** the «عرض» button on each invoice shows all its lines, units, returns and where it was paid from.
  - Its number and notes can be corrected (new permission «تعديل بيانات فاتورة شراء مسجلة»), and the change is logged.
  - Quantities and prices are corrected with «مرتجع مشتريات» and a new invoice.
- **An administrator with no open shift** can record a purchase. The amount paid now is taken from the treasury automatically. With a shift open, the drawer pays, as before. Other users still need a shift.

## Two people never edit the same invoice or request

- When someone opens a **preliminary supplier invoice** to complete it, it is reserved for them for **30 minutes**. When an administrator opens a **supplier debt-payment request** to approve or reject it, it is reserved for **5 minutes**. The cashier cannot cancel it during that time.
- Everyone else still sees it in the list, in blue, with «[الاسم] بيعدل الفاتورة حاليًا» or «[الاسم] بيعدل طلب السداد حاليًا». Its buttons are disabled, and the reason and the time it becomes free are shown under them. The program refuses the attempt itself, not only the screen.
- It becomes free when the person finishes or closes the window, or when the time runs out (also if their PC was switched off). The lists update by themselves every 30 seconds.
- A reservation never pays, approves, or changes stock or a balance.

## Two prices only: purchase and selling

- **There is no wholesale price any more:** not in the product window, the products list, the purchase invoice, the packages window, the Excel file or the owner's remote edits. The till never used it, so no selling price changes. The old values stay stored, untouched, for history.
- **A package's selling price** (packages window, «تلقائي»):
  - **Automatic** (ticked): the piece's selling price × the number of pieces. It changes by itself whenever the piece price or the count changes.
  - **Typed** (unticked): your own price, kept as you typed it, also if it happens to equal piece × count.
  - Tick «تلقائي» again to go back to the automatic price.
  - On the day of the update, packages that already had a price of their own keep it (typed); packages without one become automatic, at the price they were already sold at.
- **Buying in pieces or in cartons** (choose the unit on each invoice line):
  - **in pieces at 5:** the piece costs 5 and the carton of 24 costs 120;
  - **in cartons at 120:** the carton costs exactly 120 and the piece 120 ÷ 24 = 5.
  - Both give the same stock and stock value; the invoice keeps what you entered.
  - A purchase price never changes a selling price. Only the line's «سعر البيع الجديد» does, when you fill it.

## The shift report and the closing receipt

The shift details («الورديات» → «تفاصيل»), the closing window and the printed closing receipt now list every record one by one, and each list adds up to its total:

- **Expenses:** what, how much, who, when and the reference.
- **Customer returns:** the invoice, «مرتجع جزئي» or «مرتجع الفاتورة كاملة», the customer, the products and quantities returned, the amount.
- **Credit and partial sales:** each invoice with the customer and what is still owed. A customer without a name is shown by the invoice number.
- **Customer debt collections:** never counted as sales.
- **Supplier invoices recorded in the shift**, final and preliminary: the real invoice total, paid now and still owed, with «آجل (لم يُدفع شيء)», «مدفوعة بالكامل» or «دفع جزئي». An unpaid invoice shows 0 paid, never a total of 0.
- **Supplier debt payments** with their status, purchase returns with money back, and the shift's treasury entries.

Each line shows its time, name, amount, who recorded it and its reference. The receipt prints every line, wrapped to the paper's width; a long report simply continues on the roll.

## At the till

- **One field** for scanning, typing a barcode or typing a product name.
  - The list opens with the first letter or digit, and every character narrows it. ↑ ↓ move, Enter adds, Esc clears.
  - Scanning works as before and never opens the list.
- Amount fields accept Arabic digits (١٥٠) and the Arabic decimal sign (12٫5).

## Customers

- **A customer code can be typed by hand** (new permission «تحديد كود العميل يدوياً», for the administrators). Two customers can never share a code, whatever the upper or lower case.
- The automatic code (C00012) stays the default.

## Scale labels

The default positions are now length 13, item code from position 1 for 6 digits, weight or price from position 7 for 5 digits, and divisors 1000 and 100. Positions are counted from 0. A store that never changed the settings gets them automatically; changed settings are kept. «استعادة المواضع الافتراضية» puts them back.

## The menu on the right

- **Six groups, with the daily selling first:** «البيع اليومي», «الحسابات», «المخزون», «التقارير», «الإدارة» and «النظام».
- **«الأدراج والتحويلات» is gone**, as you asked. What it showed is elsewhere:
  - the drawer's live figures: «الورديات» → the open shift → «تفاصيل»;
  - «فاتورة مورد مبدئية»: the new screen «فواتير الموردين المبدئية»;
  - «سداد دين مورد»: the new screen «سداد ديون الموردين».
- **The two new screens** are in «الحسابات», each with its own permission. A cashier who has one sees only that screen, with no drawers permission needed.
- A group can be folded by clicking its title.
- Shorter names: «الفواتير», «العملاء», «استيراد وتصدير».

## Keyboard

Arrow keys now move through:

- the menu and the user menu;
- choices (for example «كود تلقائي / أكتب الكود»), tabs and period buttons;
- the till's payment methods and customer matches.

Enter opens or chooses. Esc closes and returns to where you were.

## Permissions to check after installing

In «الأدوار والصلاحيات»:

| Permission                                          | Given to (by default)                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| فواتير الموردين المبدئية (was «فاتورة مورد مبدئية») | as before: cashiers and administrators. It opens its own screen now.              |
| طلب سداد دين مورد من الدرج (new)                    | administrators. Give it to the cashiers you trust: it opens «سداد ديون الموردين». |
| اعتماد طلبات سداد الموردين (new)                    | administrators                                                                    |
| تحديد كود العميل يدوياً (new)                       | administrators                                                                    |
| تعديل بيانات فاتورة شراء مسجلة (new)                | roles that already manage suppliers and purchases                                 |

- Nothing you set before is changed. Custom roles get no new permission.
- The old «الأدراج والتحويلات» permission no longer opens anything and is hidden from the screen.

## The installer

|                  |                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File             | `HeroMarket-Setup-1.5.2.exe`                                                                                                                                   |
| Size             | 181,182,005 bytes                                                                                                                                              |
| SHA-256          | `275b9cc8b8d8f1b57fadb8b380840adbbfe823f716fa3cc503ce8d0217b701ff`                                                                                             |
| Built from       | the merge commit `bcd3a23` on `main` (PR #35), with no uncommitted change. Later commits change only `.docs`, which is never packaged                          |
| Package contents | checked: only the program (`node_modules`, `out`, `src` with migrations 0001–0031, `resources`, `package.json`); no tests, documents, databases or local files |
| Signed           | no ("Windows protected your PC" → More info → Run anyway)                                                                                                      |

Check the file before installing: `Get-FileHash HeroMarket-Setup-1.5.2.exe` must show the SHA-256 above ([UPGRADE_TO_1.5.2.md](UPGRADE_TO_1.5.2.md) step 8).

## How this release was verified

- **The full test suite: 487 of 487 pass** on the release code (disposable PostgreSQL databases). Lint: no errors. Formatting: clean. **CI:** the Linux, Docker and Windows (bundled PostgreSQL and packaging check) jobs passed on PRs #32, #33 and #35.
- **New tests** include:
  - `latestPurchasePrice.test.js` (13): your 200 → 220 / 260 example with a typed and an automatic package, and migration 0026;
  - `twoPrices.test.js` (7): automatic and typed package prices, pieces against cartons, no wholesale price, migration 0029;
  - `shiftReportDetails.test.js`: every list of the shift report checked against its records and printed;
  - `reservations.test.js` (8): who may edit an invoice or a request, for how long, two people at once;
  - `supplierScreens.test.js` (3): each supplier screen with its own permission alone;
  - `supplierPaymentRequests.test.js` (8): approval once; rejection and cancellation putting the money back once, into the open shift's drawer or, after the close, into the treasury; the itemized shift report; backup restore;
  - `supplierPaymentReversal.test.js` (4): a cashier never approves their own request, an administrator may; a cancel and a rejection at the same moment put the money back once; a reservation holds a cancel back; the supplier balance reconciles;
  - `shiftReconciliation152.test.js`: one realistic shift with every kind of money movement and failed operations, reconciled to the drawer, treasury, supplier, customer, stock and the saved close;
  - `purchaseViewEdit`, `adminPurchaseTreasury`, `tillSearch`, `permissionUpgrade`, `customerCodesManual` and `navigationLayout`.
- **The update, in Windows Sandbox with the 1.5.2 installer**, on a made-up store (no real shop data):
  - 1.4.0 → 1.5.2;
  - going back to 1.4.0 as in step F;
  - 1.4.0 → 1.5.0 → 1.5.2;
  - going back to 1.5.0 → 1.5.1 → 1.5.2.

  Repeated with the final code (migrations up to 0031, the installer above): the same results, and packages with their own price stayed typed while those without one became automatic. No record was left reserved. The rejection columns and checks of migration 0031 were in place after each update to 1.5.2.

  Each time, every figure was identical before and after: products, stock, customers and their debts, users, shifts with their closing figures, sales, the drawer, expenses, suppliers, their purchases and balances. The purchase prices became the latest purchase (a carton at 120 for 24 → 5; a product never bought kept its price), with each change recorded. The new permissions were on the right roles. The backup tasks were registered and a nightly copy was made and verified.

- **In the running program** (development build, disposable database):
  - the till's one field (a name narrows letter by letter, a fast "scanner" code opens no list, an unknown code adds nothing);
  - the keyboard;
  - the menu groups;
  - a supplier request → the notice → approval (balance 200 → 150);
  - a purchase invoice opened and its notes saved;
  - the scale settings;
  - the customer code choice.

  The keys were simulated; the shop's scanner and keyboard should be tried once (step 16).

## Limits

- The stock value at purchase price uses the latest purchase price. It is not the cost of each batch.
- The till search, scanning and keyboard were tested with simulated keys in the development program, not with the shop's scanner. Scan a product and a scale label once after installing (step 16).
