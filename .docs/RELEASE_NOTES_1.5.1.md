# HeroMarket POS 1.5.1 – Release notes

Written for the shop owner. 1.5.1 is 1.5.0 with a correction in who may browse invoices, three screens to act on an invoice by its number, and the sign-out after closing a shift. Everything in [RELEASE_NOTES_1.5.0.md](RELEASE_NOTES_1.5.0.md) applies.

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

## Signing out after closing a shift

- **Cashiers, supervisors and every other non-administrator:** signed out automatically when they **successfully** close their shift, after the closing report is dismissed. A cancelled or refused close does not sign out.
- **«مدير النظام» and «مدير المتجر»:** never signed out automatically, also after closing their own shift. The screen then shows no open shift, and a new one can be opened at once.
- **Returns never sign anyone out**: approved, refused by the supervisor, with a wrong supervisor password, or of a whole invoice.

## Where to make a return

- **On the cashier screen («شاشة الكاشير»):** the «مرتجع» button, as in 1.5.0.
- **In the menu on the right, under «الحسابات»:** the new «المرتجعات» screen (1.5.1), for anyone with «المرتجعات» or «طلب مرتجع بموافقة المشرف». Type the invoice number, choose a line or the whole invoice, write the reason and, for a request, the supervisor's name and password.

## The installer

|                  |                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| File             | `HeroMarket-Setup-1.5.1.exe`                                                                                         |
| Size             | 181,155,666 bytes                                                                                                    |
| SHA-256          | `fdb02b68e3c24b77d438ccd6f93c362cdd05265790c4c22d8a9fea62abaed6d0`                                                   |
| Built from       | commit `3aac1ae` with no uncommitted change. Later commits change only `tests` and `.docs`, which are never packaged |
| Package contents | checked: only the program (`node_modules`, `src`, `out`, `resources`, `package.json`)                                |
| Signed           | no ("Windows protected your PC" → More info → Run anyway)                                                            |

Check the file before installing: `Get-FileHash HeroMarket-Setup-1.5.1.exe` must show the SHA-256 above ([UPGRADE_TO_1.5.1.md](UPGRADE_TO_1.5.1.md) step 8).

## How this release was verified

- **The full test suite: 410 of 410 pass** on the release code. New tests:
  - `invoiceScope.test.js`: browsing;
  - `invoiceActions.test.js`: each action permission alone and in combination, other cashiers, closed shifts, refused browsing and actions;
  - `closeSignOut.test.js`: returns never sign out; a cashier's and a supervisor's close sign out; a failed close does not; administrators never.
- **Lint:** no errors. **CI:** green on the branch head.
- **CI found a test bug, now fixed:** two test files took "today" from the machine running them instead of the store's time zone, so they failed on CI between 00:00 and 02:00 Cairo time. Test-only; no program change.
- **In the running program** (development build, disposable databases):
  - **Each action screen**, with a user holding only that permission:
    - a reprint lookup of another cashier's closed-shift invoice;
    - a payment change on it, recorded as after close and logged;
    - a return of one line, the refund paid from the user's own drawer.
    - The invoices list was absent from each of these users' menus.
  - **At the till's «مرتجع» button:** an approved return, a wrong supervisor password, the supervisor refusing and a whole invoice. The cashier stayed signed in every time.
  - **Closing a shift:** a cancelled close kept the cashier in; a successful close signed the cashier out after the report; the owner's close kept him signed in, with no open shift shown.
- **Windows Sandbox** (clean Windows 10), with this installer, from the shop's own 1.4.0 build (the visit stick) with sample money records:
  - 1.4.0 → 1.5.1: Case B, migrations 0015–0023, every figure identical, both backup tasks registered, «كل الفواتير» on exactly the administrators and the reviewer after the first start, a nightly copy verified;
  - going back, as documented: restore with 1.5.1, then the 1.4.0 installer, every figure identical;
  - 1.4.0 → 1.5.0 (the released installer) → 1.5.1: Case B then Case A, every figure identical, the new permission added at the first start.
- **Everything verified for 1.5.0 still applies** ([RELEASE_NOTES_1.5.0.md](RELEASE_NOTES_1.5.0.md)): the backups end to end, the update safety and the receipt tests.

## Known limits

The limits of 1.5.0 stay ([RELEASE_NOTES_1.5.0.md](RELEASE_NOTES_1.5.0.md#known-limits)): the installer is not code-signed, the automatic copies stay on the shop PC, and two reports scroll sideways on a 1024 px screen with the menu kept expanded.
