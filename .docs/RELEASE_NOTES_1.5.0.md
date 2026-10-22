# HeroMarket POS 1.5.0 – Release notes

Status: **ready for your testing, not released.** Nothing has been merged, tagged, published or installed on the shop PC. 1.4.0 was never published; 1.5.0 contains it (Owner decision Q8).

Written for the owner and for whoever installs HeroMarket at the shop. Screen names are given as they appear in the program. The reasons and details of each change are in [DECISIONS.md](DECISIONS.md) (D-057 to D-078).

## For the cashier

- **Payment methods:** cash, Visa, wallet (محفظة) and InstaPay. «آجل» and «دفع جزئي» stay: they leave a balance on the customer's account. The part paid at once on a partial sale is recorded with its own method.
- **Hotkeys:** F1 confirms and prints, F2 confirms without printing, F7 opens the product search. Typing 0.5 in a quantity box works. Esc and «تفريغ» ask before clearing an invoice. Signing out is always possible, also from the open-shift window.
- **Scale labels:** a label from the shop's scale is read directly (code = first 7 digits, weight in grams = next 5, the check digit is verified).
- **Manual discount on the invoice:** a fixed amount in EGP, only for roles the administrator allows (permission «خصم يدوي على الفاتورة»). It never changes the product's price.
- **Closing a shift (blind close):**
  - the cashier never sees the expected amounts before closing: not in the drawer page, not in «جرد الدرج الدوري», not in the close window;
  - they enter the counted amount for each payment method and confirm;
  - only then does the report show expected, counted and the difference (عجز / زيادة) per method and in total;
  - **a close is never refused**, whatever the difference. The owner reviews it in «الورديات». The old EGP 50 supervisor approval is gone.
- **Backup after closing:** made automatically after every close; the cashier is not asked anything.
- **Preliminary supplier invoice** (when a supplier delivers and the details come later): the cashier records the supplier, the total and what was paid now, by its method. The payment is real money from the shift; the rest is owed to the supplier. Nothing enters the stock until an administrator completes the invoice. A cashier can cancel their own preliminary invoice entered by mistake.
- **Customers have codes** (C00001…), kept on their invoices. The till finds a customer by name, phone or code.
- **Every window** fits the screen without sideways scrolling, closes with its X, with a click outside it and with Esc, and the arrow keys move between its buttons. Enter in a form that moves money or stock goes to the next field, never straight to the action.

## Money: drawer and treasury

- **«الخزنة»** (treasury): the store's money outside the drawers, kept per method (cash, Visa, wallet, InstaPay) plus the total.
  - The opening float of a shift leaves it; the amounts counted at close return to it, each exactly once.
  - It may go below zero; that is shown in red. Every movement is recorded and never edited; corrections are separate entries with a reason.
  - It starts at 0 after the update. Record the counted treasury once on the first day.
- **Expenses and customer debt payments** can be recorded in the current shift or, by those allowed, directly in the treasury, without a shift. Each user sees only the expenses they recorded; the owner sees all.
- **Changing a sale's payment method** (for example cash entered by mistake for Visa) is allowed, also after its shift is closed, but not for a sale with a return. It is recorded with who and when; no money moves.
- **«الورديات»:** a list with filters and a full page per shift: sales by method, expenses, collections, manual discounts, payment corrections and the close.

## Suppliers and purchases

- **Purchase invoice:**
  - an optional **discount on the whole invoice**. The supplier is owed the net. Product costs stay as on the lines; the discount appears in profit as «خصم مشتريات مكتسب»;
  - two optional prices per line, «سعر البيع الجديد» and «سعر البيع الجديد (الجملة)». A filled price becomes the product's price when the purchase is saved; an empty one keeps the current price. Package prices are not changed by a purchase;
  - the window fits the screen; prices are stacked in one column.
- **Purchase returns:** goods of a recorded purchase can go back to the supplier, in parts. The supplier is credited the lines' value after the invoice discount. Money is recorded only if the supplier pays it back now. Goods already sold cannot be returned.
- **Supplier opening balance:** what was owed before HeroMarket, entered when the supplier is added or corrected later in «تعديل». Balances are written in words: «مستحق للمورد (علينا)» or «مستحق على المورد (لنا)».
- **Supplier contact details** (name, phone, address, representative) can be edited.
- **Printing a supplier invoice** from the supplier's list, marked as a copy.

## Stock

- **«قيمة المخزون»:** stock value at purchase cost and at selling price, with filters, the rules written on the screen and a check that every product's stock matches its movements.
- **«حركات المخزون»:** every stock movement, newest first, with filters by product, type and date. A sale opens its invoice.
- **Damaged goods:** search products by name or barcode, and choose a package (2 cartons = 24 pieces).
- **Packages:** a package has its own purchase price and selling price, entered by the owner; stock is shown as full packages and loose pieces.
- **A product's barcode can be changed**; its whole history follows it.

## Dashboard and reports

- **«لوحة الإدارة»:**
  - «الوضع الآن»: stock value at cost and at selling price, owed to suppliers, owed by customers. Each card opens its screen;
  - «إحصائيات الفترة»: today, this week, this month, this year, «الكل» (since the first record) or a chosen range. It shows sales, invoices, expenses, purchases (with returns), net profit and margin, «السيولة النقدية» (cash flow) and customer collections, with charts.
- **«الأداء والأرباح» was removed** (owner's answer): its figures are in the dashboard. «التقارير المتقدمة» stays for detailed ranges.
- **Every report filters by each record's own date**, also across the year boundary.

## Users, permissions and security

- **Passwords** may use any characters (8 or more; obvious ones such as 12345678 or the username are refused).
- **Resetting a user's password:** the administrator types their own password first. The temporary password works for 72 hours.
- **Every sensitive feature is a permission the administrator grants per role**: expected amounts before the close, the treasury, all expenses, stock value, payment corrections, supplier opening balances, manual discount, data import and data export. The service checks each one on every request, not only by hiding buttons.
- **Two unused permissions** (the old Momkn machine and wallet tills) are hidden from «الأدوار والصلاحيات».
- The full list: [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md).

## Backups and data

- **Every night at 00:00** a verified backup is made automatically, even when nobody is signed in. 14 daily and 8 weekly copies are kept. If the PC was off at midnight, one backup is made at the next start.
- **After every shift close**, one more verified copy (the newest 20 are kept).
- Copies are in `C:\ProgramData\HeroMarket\backups`. Windows users can read them but not delete them.
- **Export** (الإدارة → استيراد البيانات → تصدير): the store's products, customers and suppliers in the same Excel template that the import reads. Import and export are separate permissions.
- **Template version 2:** optional package columns. Files made for 1.4.0 still import.

## Removed

- The cheques screen (old records are kept and readable by administrators), the «جرد الدرج» button at the top (the periodic count and its reminder stay), the Momkn machine and wallet-service tills (old records kept), and «الأداء والأرباح».

## Installing and updating

- **At the supermarket:** a fresh installation (the shop runs another company's program today). The store's data comes through HeroMarket's Excel template. The first visit only collects information ([SUPERMARKET_VISIT_1.md](SUPERMARKET_VISIT_1.md)); the step-by-step installation guide for the shop is written after it, from what the visit finds (PC, printer, scanner, data).
- **Over 1.4.0 (for example the owner's laptop): Case B**, a database change. The installer takes a verified copy, applies migrations 0015 to 0023 and checks that no record or total changed. On any problem it puts the copy back by itself.
- **Going back to 1.4.0** means restoring the copy taken before the update: first `--restore-pre-install=1.4.0` with 1.5.0 still installed, then the 1.4.0 installer (UPDATE_GUIDE.md §6; the order matters). Sales recorded in 1.5.0 since the update are then lost. 1.4.0 refuses to open data updated by 1.5.0, so it cannot damage it.
- **Copies before each installation** are kept longer: the newest 3, plus the newest copy of each of the last 3 data versions, so the copy from before a database update is never removed by later installer runs.
- The installer refuses to run while HeroMarket is open on any Windows account.

## What was tested

- **Automated tests:** 390 of 390 pass (service, database, migrations, backup and restore, permissions by direct request, reprints, keyboard behaviour), on every push in CI.
- **In the running program** (disposable test database): every screen and 51 windows at 1366, 1024 and 800 px; keyboard only; blind close; the after-close backup; the dashboard.
- **Windows Sandbox (clean Windows, release candidate):** 1.3 → 1.4.0 with sample money records → 1.5.0 (every figure identical), a refusal while the program is open, a reinstall, a failing update put back by itself, the older installer refused, and going back to 1.4.0. Details in [UPDATE_GUIDE.md §9](UPDATE_GUIDE.md).

## Not tested yet

- **The barcode scanner (HW-01) and the receipt printer (HW-02)** at the shop: a sale receipt, a reprint and a shift-close report on the real printer; scale labels and product barcodes on the real scanner.
- **The nightly and after-close backups on the shop PC** itself (tested in Windows Sandbox only).
- The installer is not code-signed yet: Windows shows "Windows protected your PC" (More info → Run anyway).

## Known limits

- With the menu kept expanded by hand on a 1024 px screen, «التقارير المتقدمة» and «تقييم الكاشيرات» still scroll sideways by up to 85 px. The automatic menu size avoids it.
- The cloud link («المزامنة السحابية») is built but not used by the shop.

## Try it yourself (on the laptop, before the shop)

Tick each line when it behaves as described. Use test data, never the shop's real sales.

- [ ] **Blind close:** sign in as a cashier, sell something, open «إغلاق الوردية». No expected amount appears anywhere until you confirm; then the report shows expected, counted and the difference. A large shortage still closes.
- [ ] **No question after closing:** the close finishes without asking about a backup. A new copy appears in `C:\ProgramData\HeroMarket\backups\scheduled`.
- [ ] **Treasury:** «الخزنة» shows the counted amounts of that close, per method.
- [ ] **Manual discount:** as the owner, take EGP 2 off an invoice; as a cashier (without the permission) the field is not there.
- [ ] **Purchase:** enter an invoice with a discount and a new selling price on one line. The product's price changes; the supplier is owed the net.
- [ ] **Purchase return:** return part of that invoice. The stock and the supplier's balance fall.
- [ ] **Preliminary invoice:** as a cashier, record a supplier delivery with a payment; as the owner, complete it with the lines.
- [ ] **Supplier opening balance:** add a supplier with an opening balance; its balance is shown in words.
- [ ] **Customer code:** a new customer gets a code; the till finds the customer by it.
- [ ] **Scale label:** scan or type a scale barcode; the weight is right.
- [ ] **Dashboard:** «الكل» shows everything since the first record; the stock-value cards open their screens.
- [ ] **Export:** الإدارة → استيراد البيانات → تصدير gives an Excel file that the import accepts.
- [ ] **Password reset:** reset a cashier's password; it asks for your own password first.
- [ ] **Windows:** every window closes with X, a click outside and Esc; nothing scrolls sideways.

## Before installing at the shop

1. The first visit (SUPERMARKET_VISIT_1.md): the PC, the printer, the scanner, and the filled data template.
2. The installation guide for the shop, written from that visit: install, sign in as the owner, import the template.
3. Check the scanner and the printer there (HW-01, HW-02) before the first real sale.
4. Record the counted treasury once.
5. The next morning, check that the midnight backup is in `C:\ProgramData\HeroMarket\backups\scheduled`.
