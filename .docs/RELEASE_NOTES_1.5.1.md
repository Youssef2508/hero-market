# HeroMarket POS 1.5.1 – Release notes

Written for the shop owner. 1.5.1 is 1.5.0 with a correction in who may browse invoices, and three screens to act on an invoice by its number. Everything in [RELEASE_NOTES_1.5.0.md](RELEASE_NOTES_1.5.0.md) applies.

**Install 1.5.1 instead of 1.5.0.** Follow [UPGRADE_TO_1.5.1.md](UPGRADE_TO_1.5.1.md):

- from 1.4.0, it is the same update as 1.5.0 (the database is updated once, with a verified copy first);
- if 1.5.0 is already installed, 1.5.1 goes over it with no database change.

## Invoices: who browses them, and who acts on them

**Before (1.5.0 and earlier):** anyone given «عرض الفواتير» saw every invoice in the store, of every cashier and every day.

**Browsing invoices** (the «الفواتير والمرتجعات» screen, a customer's invoices):

- **«مدير النظام» and «مدير المتجر»** browse every invoice, of every cashier and shift, open or closed, with or without a shift of their own.
- **Cashiers and supervisors («مشرف») given «عرض الفواتير»** browse only **their own invoices of their open shift**.
  - Asking for another cashier's invoice there, or one of an earlier shift, is refused («هذه الفاتورة ليست من ورديتك المفتوحة…»), and the attempt is written in «سجل العمليات».
  - In «العملاء والحسابات», a customer's invoices follow the same rule; the customer's balance and account stay visible.
- **A new permission, «كل الفواتير»**, in «الأدوار والصلاحيات», opens every invoice for browsing. The administrators and the read-only reviewer («مراجع») have it; supervisors and cashiers do not.

**Acting on an invoice by its number:** three new screens in the menu «الحسابات», each shown only to a role that holds its permission. None of them needs «عرض الفواتير».

- **«المرتجعات»** (with «المرتجعات» or «طلب مرتجع بموافقة المشرف»): type the invoice number, choose a line and quantity or the whole invoice, and return it. The rules are the same as at the till:
  - never more than what is left;
  - the stock comes back;
  - the money goes back to the customer's account first, then from the user's own open drawer;
  - «طلب مرتجع» needs a reason and the supervisor's name and password.
- **«إعادة طباعة فاتورة»** (with «إعادة طباعة الفواتير»): type the number, print a copy. Printing changes nothing.
- **«تغيير طريقة الدفع»** (with «تغيير طريقة دفع فاتورة»): type the number, choose the right method.
  - For an invoice of a closed shift, the change is recorded with that shift; no money moves.
  - An invoice with a return keeps its method.
- **Any invoice:** of any cashier, shift or date, closed shifts included. The screen shows only what the action needs: the number, time, method and total, plus the lines for a return. It never shows the list or who sold it.
- **Each permission works alone:** a role may have one, two or all three. Finding an invoice for one action does not allow another.
- **The till's return window** finds invoices the same way.

**What to check after installing**, in «الأدوار والصلاحيات»: which roles have «عرض الفواتير», «كل الفواتير», «المرتجعات», «طلب مرتجع بموافقة المشرف», «إعادة طباعة الفواتير» and «تغيير طريقة دفع فاتورة». The defaults:

| Role                      | Browse                    | Act by invoice number                |
| ------------------------- | ------------------------- | ------------------------------------ |
| مدير النظام / مدير المتجر | every invoice             | returns, reprint, payment change     |
| مشرف                      | own open shift            | returns, reprint                     |
| كاشير                     | none                      | return request (with the supervisor) |
| مراجع                     | every invoice (read only) | none                                 |

**Limit:** receipts print the invoice number, not a barcode of it, so the number is typed. A scanner that types digits works in the field once there is something to scan.

## The installer

<<INSTALLER>>

## How this release was verified

<<VERIFIED>>

## Known limits

The limits of 1.5.0 stay ([RELEASE_NOTES_1.5.0.md](RELEASE_NOTES_1.5.0.md#known-limits)): the installer is not code-signed, the automatic copies stay on the shop PC, and two reports scroll sideways on a 1024 px screen with the menu kept expanded.
