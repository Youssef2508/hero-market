# HeroMarket screens, windows and keys

Written for whoever maintains or tests HeroMarket (UX-01, D-078). Every screen in the menu is listed with its permission, what it is for, its main actions and their effects, and the tests that cover it. A test (`tests/unit/uiInventory.test.js`) fails when a menu entry is missing here.

Permissions are enforced by the service on every request; the menu only hides what a role cannot use (see `PERMISSION_MATRIX.md`).

## 1. Screens

### البيع

| Screen                       | Permission      | Purpose                | Main actions and their effects                                                                                                                                                                                                                                                                                                                                         | Tests                                                                                          |
| ---------------------------- | --------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| شاشة الكاشير (`pos`)         | `pos.sell`      | Selling at the till    | Scan or search (F7) a product; quantity (F3), unit, weight; delete a line (F4); customer for credit; manual discount (`pos.manual_discount`); F1 confirm and print, F2 confirm without print; return (`sales.return_request`); clear the invoice (Esc, asks first). A sale writes the sale, its lines, stock movements and the drawer or receivable once (retry-safe). | checkout, manualDiscount, manualWeighing, units, packaging; keyboard checks in the app (D-065) |
| الأدراج والتحويلات (`tills`) | `tills.operate` | The own shift's drawer | Without `shifts.view_expected`: a notice only (blind). With it: expected per method. Preliminary supplier invoice (`suppliers.pending`); the own preliminary invoices with cancel; close the shift (four counted amounts).                                                                                                                                             | tills, payablesReceivables, supplierCancel, approvals (close)                                  |

### نظرة عامة

| Screen                | Permission      | Purpose                     | Main actions and their effects                                                                                                                                                                                                                                                                                        | Tests                   |
| --------------------- | --------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| لوحة الإدارة (`menu`) | `reports.view`  | The owner's overview        | Last 7 days; «الوضع الآن» (stock at cost and price, owed to suppliers and by customers; `reports.valuation`); period statistics and charts (today, week, month, year, «الكل» or a range: sales, invoices, expenses, purchases, net profit and margin, cash flow, collections); shortcuts to every section. Read only. | dashboard, stockReports |
| الخزنة (`treasury`)   | `treasury.view` | Treasury balance per method | Deposit, withdrawal, adjustment, reversal (`treasury.manage`): an immutable ledger row each, once per request.                                                                                                                                                                                                        | moneyModel              |

### التقارير

| Screen                                  | Permission          | Purpose                                      | Main actions and their effects                                                            | Tests         |
| --------------------------------------- | ------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------- |
| التقارير المتقدمة (`advanced-stats`)    | `reports.view`      | A chosen range: peaks, shifts, best products | Range choice. Read only.                                                                  | reportPeriods |
| تقييم الكاشيرات (`cashier-performance`) | `reports.view`      | Ranking and a profile per cashier            | Refresh; open a cashier. Read only.                                                       | reports       |
| تقرير المنتجات (`bestsellers`)          | `reports.view`      | Best and slow sellers                        | Period. Read only.                                                                        | reports       |
| قيمة المخزون (`stockvalue`)             | `reports.valuation` | Stock value at cost and selling price        | Filters (search, category, kind, status, stopped products) on rows and totals. Read only. | stockReports  |

### المخزون

| Screen                        | Permission          | Purpose                             | Main actions and their effects                                                                                                                                                    | Tests                                                |
| ----------------------------- | ------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| الأصناف والمخزن (`inventory`) | `products.view`     | Products, prices, stock             | Add, edit (`products.manage`), barcode change, units and packages, stock history and count (`inventory.adjust`), measurement kinds, delete. Stock changes only through movements. | catalog, units, measureKinds, packaging, stockLedger |
| حركات المخزون (`movements`)   | `products.view`     | Every stock movement                | Filters (product, type, dates); a sale opens its invoice. Read only.                                                                                                              | stockReports                                         |
| التصنيفات (`categories`)      | `categories.manage` | Categories for browsing at the till | Add, rename, order, stop, delete (empty only).                                                                                                                                    | categories                                           |
| مساعد الطلبيات (`reordering`) | `inventory.reorder` | Products near their reorder limit   | Read only (a list to order from).                                                                                                                                                 | reports                                              |
| التوالف والهوالك (`damaged`)  | `inventory.damaged` | Damaged goods                       | Record (product search, packages): stock out at cost, logged; delete reverses it.                                                                                                 | damagedUnits, stockLedger                            |

### الحسابات

| Screen                            | Permission        | Purpose                        | Main actions and their effects                                                                                                                                                                                                                    | Tests                                                                                 |
| --------------------------------- | ----------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| الفواتير والمرتجعات (`sales`)     | `sales.view`      | Sale invoices                  | Search; open; reprint (`sales.reprint`, a copy); return a line or the whole invoice (`sales.return`); change the payment method (`sales.change_payment`).                                                                                         | flows, approvals, ownerNotes, reprints                                                |
| العملاء والحسابات (`clients`)     | `customers.view`  | Customers, debts, codes        | Add, edit (two phones, three addresses), collect a payment (`customers.payments`) by method into the shift or treasury, open an invoice.                                                                                                          | customerPhones, addresses, customerCodes, payablesReceivables                         |
| الموردون والمشتريات (`suppliers`) | `suppliers.view`  | Suppliers, purchases, payables | Add and edit a supplier; opening balance (`suppliers.opening`); purchase invoice (lines, packages, discount, new selling and wholesale prices); preliminary invoices: complete, cancel; purchase return; print an invoice (copy); pay a supplier. | purchaseDiscountReturns, purchaseSalePrice, supplierOpening, supplierCancel, reprints |
| المصروفات (`expenses`)            | `expenses.manage` | Expenses                       | Record (category, method, shift or treasury), delete the own; categories.                                                                                                                                                                         | expenseNote, moneyModel                                                               |

### الإدارة

| Screen                             | Permission                   | Purpose                                | Main actions and their effects                                                                                                | Tests                                   |
| ---------------------------------- | ---------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| الورديات (`shifts`)                | `shifts.view_all`            | Every shift                            | List; details per method; print (closed: a copy); open an invoice. Open shifts' expected figures need `shifts.view_expected`. | shiftClose, ownerNotes                  |
| المستخدمون (`users`)               | `users.manage`               | Staff accounts                         | Add (temporary password), edit, disable, reset password (own password required; 72 hours), delete.                            | auth, admin, security                   |
| الأدوار والصلاحيات (`roles`)       | `roles.manage`               | Roles                                  | Create, edit, delete roles; only permissions the administrator holds.                                                         | admin, permissionsAudit                 |
| الخصومات (`discounts`)             | `discounts.manage`           | Automatic discounts                    | Add, edit, stop rules.                                                                                                        | discounts                               |
| إعدادات المتجر (`settings`)        | `settings.manage`            | Store details, printer, count reminder | Save settings (logged).                                                                                                       | admin                                   |
| تصميم الفاتورة (`receipts`)        | `settings.manage`            | Receipt templates                      | Edit, preview, test print.                                                                                                    | receipt                                 |
| سجل العمليات (`logs`)              | `logs.view`                  | Activity log                           | Filters. Read only.                                                                                                           | admin                                   |
| النسخ الاحتياطي (`backup`)         | `backup.manage`              | Backups                                | Save a copy; restore (all or nothing); nightly and after-close copies' status.                                                | backupAudit, scheduledBackup, backupJob |
| استيراد وتصدير البيانات (`import`) | `data.import`, `data.export` | Master data in and out                 | Template, export (checked before saving), import (preview, all or nothing).                                                   | storeImport, dataExport                 |
| أرشيف الشيكات (`checks`)           | `checks.archive`             | Old cheques                            | Read only (cheques stopped, D-060).                                                                                           | checksArchive                           |
| المزامنة السحابية (`sync`)         | `sync.manage`                | Link to the owner's cloud              | Configure, status, recovery after a restore.                                                                                  | sync, syncRecovery                      |

## 2. Windows

Every small window closes with its X and with a click outside it (asking first if something was typed); Esc closes it; Tab stays inside; the arrows move between its buttons; focus returns to where it was. Money and stock windows need a deliberate Enter on the confirm button. Checked in the running app on 51 window openings at 1366, 1024 and 800 px (D-069). The windows without a close are on purpose: a required shift opening and the recovery notice.

| Window                          | Opened from              | Effect when confirmed                                                     |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| فتح وردية                       | sign-in, till            | Opens the own shift with its float                                        |
| تسوية وإنهاء الوردية            | till, tills page         | Closes the shift (never refused, D-073); report; automatic backup (D-074) |
| تقرير إغلاق الوردية             | after a close, الورديات  | Read; print (a copy when printed again)                                   |
| خصم يدوي                        | till                     | A fixed discount on the current invoice                                   |
| إدخال الوزن                     | till (weighed product)   | The line's weight                                                         |
| مرتجع                           | till                     | A return request (approval when needed)                                   |
| تفريغ الفاتورة                  | till (Esc)               | Empties the cart (starts on إلغاء)                                        |
| إضافة / تعديل صنف               | الأصناف والمخزن          | Product saved; stock through a movement                                   |
| الوحدات والعبوات                | الأصناف والمخزن          | Units, packages, their prices and barcodes                                |
| سجل حركة المخزون                | الأصناف والمخزن          | Read; stock count                                                         |
| طرق القياس                      | الأصناف والمخزن          | Measurement kinds                                                         |
| تسجيل هالك                      | التوالف والهوالك         | Stock out                                                                 |
| تغيير طريقة الدفع               | الفواتير                 | Reclassifies the sale (no money moves after close)                        |
| إرجاع كمية                      | الفواتير                 | Return: stock back, refund by method                                      |
| إضافة / تعديل عميل              | العملاء                  | Customer saved                                                            |
| فاتورة مورد مبدئية              | الموردون, الأدراج        | Payment and payable, no stock                                             |
| إكمال / إلغاء الفاتورة المبدئية | الموردون, الأدراج        | Lines and stock / reversal                                                |
| فاتورة شراء                     | الموردون                 | Purchase: stock, cost, payable, prices                                    |
| مرتجع مشتريات                   | الموردون                 | Stock out, payable down, refund if received                               |
| إضافة / تعديل مورد              | الموردون                 | Contact; opening balance with its permission                              |
| مصروف, تصنيفات المصروفات        | المصروفات                | Expense in shift or treasury                                              |
| إيداع, سحب, تسوية, عكس          | الخزنة                   | Treasury rows                                                             |
| إضافة / تعديل حساب              | المستخدمون               | Account; password reset with own password                                 |
| خصم جديد / تعديل خصم            | الخصومات                 | Discount rule                                                             |
| اعتماد المشرف                   | returns needing approval | Supervisor's name and password                                            |
| تأكيد / تنبيه                   | everywhere               | Confirm or acknowledge                                                    |

## 3. Keys

| Key            | Where                       | Action                                                                   |
| -------------- | --------------------------- | ------------------------------------------------------------------------ |
| F1             | till                        | Confirm and print                                                        |
| F2             | till                        | Confirm without printing                                                 |
| F3             | till                        | Quantity of the first line                                               |
| F4             | till                        | Delete the last line                                                     |
| F6             | till                        | Browse categories                                                        |
| F7             | till                        | Product search                                                           |
| Esc            | till                        | Clear the invoice (asks first); in the search: back to the barcode field |
| Esc            | window                      | Close it the way its cancel does                                         |
| Ctrl+Alt+L     | anywhere                    | Lock (sign out)                                                          |
| Tab, Shift+Tab | everywhere                  | Next and previous control; stays inside an open window                   |
| ↑ ↓ Enter      | lists, rows, search results | Move and open                                                            |
| ← →            | period tabs, window buttons | Move                                                                     |
| Enter          | money and stock forms       | Next field; on the confirm button, confirm                               |

## 4. Checks done

- **Right to left:** Arabic layout throughout; identifiers (invoice numbers, barcodes, codes) isolated left to right in tables (D-065).
- **Keyboard only:** till hotkeys, windows, lists and forms (D-065, D-069), in the running app.
- **No sideways scrolling:** all 29 screens, closed and with the first row of every list opened, at 1366 and 1024 px; 51 window openings at 1366, 1024 and 800 px (D-069).
- **Feedback:** money, stock, permission and database operations answer with a success message or a readable Arabic error; destructive actions ask first and start on إلغاء; long operations show progress (import, export, backup, restore).
- **Empty states and loading:** lists show «لا توجد …» when empty and a loading line while reading.

## 5. The owner's answers (2026-10-22, D-078)

The audit raised three questions; the owner answered:

1. **Two unused permissions** («أرصدة مكن والمحافظ» and «حركات مكن والمحافظ», Momkn and wallet tills stopped in D-063): **hidden** from «الأدوار والصلاحيات». The keys stay valid, so roles that hold them are unchanged; the permission matrix marks them hidden.
2. **«المزامنة السحابية»:** **kept visible** to administrators.
3. **Overlapping report screens:** **merged.** «الأداء والأرباح» is removed; its figures are in the dashboard's period statistics, which gained the period «الكل» (from the store's first record), the profit margin and the cash flow («السيولة النقدية»: sales paid at once plus drawer money in, minus money out). «التقارير المتقدمة» stays for detailed ranges; the overview's 7-day cards open it.
