# HeroMarket POS 1.5.0 – Release notes

Status: **release 1.5.0.** For the shop, which runs HeroMarket 1.4.0. The owner installs it over 1.4.0 himself ([UPGRADE_TO_1.5.0.md](UPGRADE_TO_1.5.0.md)). 1.4.0 was never published as a release; 1.5.0 contains it (owner decision Q8).

Written for the shop owner. Screen names are given as they appear in the program. The reasons and details of each change are in [DECISIONS.md](DECISIONS.md) (D-057 to D-078).

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

## Installing: the shop's upgrade from 1.4.0

- **The shop runs HeroMarket 1.4.0** with its data, imported from the old program's export through the HeroMarket Excel template. The owner installs 1.5.0 over it himself. **Step by step: [UPGRADE_TO_1.5.0.md](UPGRADE_TO_1.5.0.md).**
- **Case B (database change):** the installer takes a verified copy of the whole database, applies migrations 0015 to 0023 and checks that no record and no total changed. On any problem it puts the copy back by itself and 1.4.0 can be reinstalled.
- **The data is not imported again.** It is already in the 1.4.0 database and the update keeps it. Importing the same template into the updated store is refused as a whole ("مسجل بالفعل"), and nothing is written.
  - The template filled for 1.4.0 can be read by 1.5.0 (template version 1), but only for a PC that never had HeroMarket. It brings back the opening state of the file, without the sales since.
- **Backups and versions:**
  - a backup file saved by 1.4.0 («إنشاء نسخة احتياطية الآن») restores only into 1.4.0;
  - 1.5.0 restores only its own backups, including the automatic ones.
  - So the owner makes a 1.4.0 backup before the update, as his way back, and keeps it with the old program's export and the filled template until 1.5.0 has run well for a week.
- **Going back to 1.4.0:** first `--restore-pre-install=1.4.0` with 1.5.0 still installed, then the 1.4.0 installer ([UPDATE_GUIDE.md §6](UPDATE_GUIDE.md); the order matters). Sales recorded in 1.5.0 since the update are lost. 1.4.0 refuses to open data updated by 1.5.0, so it cannot damage it.
- **Copies before each installation** are kept longer: the newest 3, plus the newest copy of each of the last 3 data versions.
- The installer refuses to run while HeroMarket is open on any Windows account.

## The installer

<<INSTALLER>>

## How this release was verified

**Automated** (on the release commit, and in CI):

<<AUTOMATED>>

**Windows Sandbox** (clean Windows 10, disposable, no network), with the final installer unless noted:

<<SANDBOX>>

**In the running program** (development build, disposable test database): every screen and 51 windows at 1366, 1024 and 800 px; keyboard only; blind close; the dashboard.

**At the shop, by the developer (2026-10-22), on HeroMarket 1.4.0:** the barcode scanner, the receipt printer and the shop's workflows. These hardware tests were done with 1.4.0, not with 1.5.0.

## What cannot be guaranteed without watching the shop PC

- **The 1.5.0 receipt on the shop's printer.** The right-to-left receipt and closing report are verified by automated tests and by rendering them to images with the same printing code. The printer's own driver and fonts were used only with 1.4.0. The owner checks the first printed receipt after the update ([UPGRADE_TO_1.5.0.md](UPGRADE_TO_1.5.0.md) step 16).
- **Scale labels on the shop's scanner.** The owner's label 2000001001257 is decoded correctly by tests. Scanning a label with 1.5.0 is the owner's step 16.
- **The automatic backups on the shop PC:**
  - Windows Sandbox proves the task definitions, the runs as the system account, the copies and their checks, retention and restore;
  - whether the shop PC is on, asleep or off at midnight, and its Windows Task Scheduler, can only be seen there.
  - The owner checks the first after-close and nightly copies (steps 18 to 20).
- **The update on the shop's real data.** It was rehearsed on the real 1.4.0 code with a template import and a day of sales, and in Windows Sandbox. The shop's own records are only touched by the owner's installer run, which checks them and puts them back on any problem.

## Known limits

- The installer is not code-signed: Windows shows "Windows protected your PC" (More info → Run anyway).
- The automatic copies stay on the shop PC. The owner copies the newest one to a USB stick each week; a lost or failed disk takes the copies with it.
- With the menu kept expanded by hand on a 1024 px screen, «التقارير المتقدمة» and «تقييم الكاشيرات» still scroll sideways by up to 85 px. The automatic menu size avoids it.
- The cloud link («المزامنة السحابية») is built but not used by the shop. Commands already applied from the cloud are not in the backup (they are not used).

## What to look at in the first days

- **Closing a shift:** the cashier sees no expected amount before confirming; afterwards the report shows expected, counted and the difference. No question about a backup.
- **«الخزنة»:** it receives the counted amounts of each close, per method, after the opening amount is recorded once.
- **Purchases:** a discount on the whole invoice; «سعر البيع الجديد» changes the product's price when the invoice is saved.
- **Customers:** each has a code (C00001…); the till finds a customer by it.
- **Permissions:** in «الأدوار والصلاحيات», check what each role may do: manual discount, the treasury, export and import, expected amounts.
