# HeroMarket POS 1.5.2 – Release notes

Written for the shop owner. 1.5.2 brings the changes you asked for after 1.5.1. Everything in [RELEASE_NOTES_1.5.1.md](RELEASE_NOTES_1.5.1.md) and [RELEASE_NOTES_1.5.0.md](RELEASE_NOTES_1.5.0.md) still applies.

**Install it over what the shop PC has now (1.4.0, 1.5.0 or 1.5.1).** Follow [UPGRADE_TO_1.5.2.md](UPGRADE_TO_1.5.2.md). The database is updated once, after a verified copy. Nothing has to be imported again.

## Purchase price: the latest purchase, not an average

- **When a purchase invoice is saved**, each product's purchase price becomes the price on that invoice. The price is per piece or per kilo: a carton at 120 for 24 pieces makes 5. Older purchases and the stock on hand no longer count.
  - Your example: bought at 200, sold at 240 retail and 225 wholesale. A new invoice at 220, with 260 retail and 240 wholesale, leaves the product at exactly **220 / 260 / 240**. Before, the price would have become about 206.67.
- **Empty fields keep the current price:**
  - an empty purchase price keeps the product's price, and the line counts at that price;
  - empty retail or wholesale fields keep those prices;
  - a free line (price 0, bonus goods) does not change the price.
- **Past sales keep their cost and their profit.** Later prices never change them. A customer's return comes back at the cost it was sold at. A purchase return goes back at the cost it was bought at. Neither changes the purchase price.
- **On the day of the update**, each product takes the price of its latest purchase. A product never bought through HeroMarket keeps the price it has. Every change is recorded with the purchase it came from.
  - The profit of past sales does not change.
  - The stock value at purchase price changes once, by the difference between the old average and the latest price.
- **The stock value** («قيمة المخزون») now shows «سعر آخر شراء». It is an estimate, because HeroMarket does not track the price of each batch.

## Suppliers

- **Paying an old supplier debt from the drawer, with your approval** (new permission «طلب سداد دين مورد من الدرج»):
  - The cashier chooses the supplier and the amount at «الأدراج والتحويلات» → «سداد دين مورد». The cash leaves the drawer at once.
  - **The supplier's balance falls only when you approve.** You see «طلبات سداد» in the top bar. On «الموردون والمشتريات» you approve or reject («اعتماد طلبات سداد الموردين»).
  - A request rejected after the money was handed over does not put money back in the drawer by itself. You settle it by what really happened:
    - the supplier gave it back (it is recorded where it arrives);
    - it was a real payment after all (the balance falls);
    - it is lost.
  - Approving never takes money from the drawer a second time.
- **Opening a recorded purchase invoice:** the «عرض» button on each invoice shows all its lines, units, returns and where it was paid from.
  - Its number and notes can be corrected (new permission «تعديل بيانات فاتورة شراء مسجلة»), and the change is logged.
  - Quantities and prices are corrected with «مرتجع مشتريات» and a new invoice.
- **An administrator with no open shift** can record a purchase. The amount paid now is taken from the treasury automatically. With a shift open, the drawer pays, as before. Other users still need a shift.

## The shift report and the closing receipt

Every money movement that is not a sale is now listed one by one: customer debt collections, supplier payments (with each request's status) and money returned by suppliers. Each line shows the time, the name, the method, the amount, who recorded it and its reference. Collections are never counted as sales. Expenses and returns show their time and the user.

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
- A group can be folded by clicking its title. Nothing was removed.
- Shorter names: «الفواتير», «العملاء», «استيراد وتصدير».

## Keyboard

Arrow keys now move through:

- the menu and the user menu;
- choices (for example «كود تلقائي / أكتب الكود»), tabs and period buttons;
- the till's payment methods and customer matches.

Enter opens or chooses. Esc closes and returns to where you were.

## Permissions to check after installing

In «الأدوار والصلاحيات»:

| New permission                 | Given to (by default)                              |
| ------------------------------ | -------------------------------------------------- |
| طلب سداد دين مورد من الدرج     | administrators. Give it to the cashiers you trust. |
| اعتماد طلبات سداد الموردين     | administrators                                     |
| تحديد كود العميل يدوياً        | administrators                                     |
| تعديل بيانات فاتورة شراء مسجلة | roles that already manage suppliers and purchases  |

Nothing you set before is changed. Custom roles get no new permission.

## The installer

|                  |                                                           |
| ---------------- | --------------------------------------------------------- |
| File             | `HeroMarket-Setup-1.5.2.exe`                              |
| Size             | INSTALLER_SIZE bytes                                      |
| SHA-256          | `INSTALLER_SHA256`                                        |
| Built from       | INSTALLER_COMMIT                                          |
| Package contents | INSTALLER_CONTENTS                                        |
| Signed           | no ("Windows protected your PC" → More info → Run anyway) |

Check the file before installing: `Get-FileHash HeroMarket-Setup-1.5.2.exe` must show the SHA-256 above ([UPGRADE_TO_1.5.2.md](UPGRADE_TO_1.5.2.md) step 8).

## How this release was verified

- **The full test suite: 463 of 463 pass** on the release code (disposable PostgreSQL databases). Lint: no errors. Formatting: clean. **CI:** the Linux, Docker and Windows (bundled PostgreSQL and packaging check) jobs passed on PR #32.
- **New tests** include:
  - `latestPurchasePrice.test.js` (13): your 200 → 220 / 260 / 240 example and migration 0026;
  - `supplierPaymentRequests.test.js` (8): approval once, rejection and settlement, the itemized shift report, backup restore;
  - `shiftReconciliation152.test.js`: one realistic shift with every kind of money movement and failed operations, reconciled to the drawer, treasury, supplier, customer, stock and the saved close;
  - `purchaseViewEdit`, `adminPurchaseTreasury`, `tillSearch`, `permissionUpgrade`, `customerCodesManual` and `navigationLayout`.
- **The update, in Windows Sandbox with the 1.5.2 installer**, on a made-up store (no real shop data):
  - 1.4.0 → 1.5.2;
  - going back to 1.4.0 as in step F;
  - 1.4.0 → 1.5.0 → 1.5.2;
  - going back to 1.5.0 → 1.5.1 → 1.5.2.

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
- A supplier request settled as «خسارة» is recorded but is not counted as an expense in the profit figures.
