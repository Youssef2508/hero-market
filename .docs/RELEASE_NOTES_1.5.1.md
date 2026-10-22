# HeroMarket POS 1.5.1 – Release notes

Written for the shop owner. 1.5.1 is 1.5.0 with one correction in who may see and act on invoices. Everything in [RELEASE_NOTES_1.5.0.md](RELEASE_NOTES_1.5.0.md) applies.

**Install 1.5.1 instead of 1.5.0.** Follow [UPGRADE_TO_1.5.1.md](UPGRADE_TO_1.5.1.md):

- from 1.4.0, it is the same update as 1.5.0 (the database is updated once, with a verified copy first);
- if 1.5.0 is already installed, 1.5.1 goes over it with no database change.

## The correction: invoices belong to their shift

**Before (1.5.0 and earlier):** anyone given «عرض الفواتير» saw every invoice in the store, of every cashier and every day. Anyone allowed to reprint, return or change a payment method could do it on any invoice, also by typing another cashier's invoice number.

**Now:**

- **«مدير النظام» and «مدير المتجر»** see every invoice, of every cashier and shift, open or closed, with or without a shift of their own. They can do what their permissions allow on any of them.
- **Cashiers and supervisors («مشرف»)** see and work only on **their own invoices of their open shift**: the invoice list, the details, reprinting, changing the payment method, returns and return requests. This holds whatever invoice permissions they are given.
  - Typing the number of another cashier's invoice, or of an invoice of an earlier shift, is refused: «هذه الفاتورة ليست من ورديتك المفتوحة…». The attempt is written in «سجل العمليات».
  - Once a shift is closed, its invoices are with the administrator.
  - In «العملاء والحسابات», a customer's invoices follow the same rule. The customer's balance and account stay visible.
- **A new permission, «كل الفواتير»**, in «الأدوار والصلاحيات»: it opens every invoice. The administrators and the read-only reviewer («مراجع») have it; supervisors and cashiers do not. Grant it to another role only if that role should see all invoices.
- **Seeing is not acting:** reprinting, returning and changing a payment method still need their own permissions. The reviewer sees every invoice but cannot reprint, return or change one.
- **Returns at the till** work as before for the cashier's own invoices: a reason and the supervisor's approval. The supervisor's approval cannot be used on another cashier's invoice.

**What changes in daily work:** a customer bringing back goods from an invoice of an earlier shift, or of another cashier, is handled by the administrator.

## The installer

<<INSTALLER>>

## How this release was verified

<<VERIFIED>>

## Known limits

The limits of 1.5.0 stay ([RELEASE_NOTES_1.5.0.md](RELEASE_NOTES_1.5.0.md#known-limits)): the installer is not code-signed, the automatic copies stay on the shop PC, and two reports scroll sideways on a 1024 px screen with the menu kept expanded.
