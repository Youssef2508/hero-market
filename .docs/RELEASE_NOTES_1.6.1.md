# HeroMarket POS 1.6.1 – Release notes

Written for the shop owner. 1.6.1 brings the changes you asked for on 13 November 2026, on the shop PC and on the website alike. Everything in [RELEASE_NOTES_1.6.0.md](RELEASE_NOTES_1.6.0.md) still applies.

**Updating:** the website is updated first, by Youssef; then you install 1.6.1 over 1.6.0 on the shop PC, as for every update ([ROLLOUT_GUIDE.md](ROLLOUT_GUIDE.md), "Future improvements"). Nothing is paired again, and nothing waiting to be sent is lost.

## Paying suppliers from the drawer

- **«سداد لمورد من الدرج» lists every supplier,** not only those with a balance. Each shows what is owed, «لا مستحق مسجل», or «لنا رصيد عنده» (the store's credit), with any requests still waiting for approval.
- **You may pay more than is owed, or before the invoice is recorded** (an advance). The screen says so plainly instead of refusing.
- **The drawer need not hold the amount.** The shift may show a negative balance; the closing report explains it with the payment.
- **Unchanged:** the money leaves the drawer when recorded, and the supplier's balance falls only when you approve the request.
  - After approval, an advance shows as the store's credit with that supplier («لنا»).
  - The supplier's next invoice settles against it.
- **Preliminary invoices** already allowed any supplier and any amount from the drawer; that is unchanged.

## Preliminary invoices

- **Each shows the date and time it was recorded,** so invoices of different days are easy to tell apart.
- **Completed ones stay in view until the shift ends.** The cashier's list shows the invoices waiting for their items first, then «تمت في هذه الوردية»: those completed or cancelled during the shift, with who did it and when. The list starts empty again with the next shift; the full history stays in «الموردون والمشتريات».
- **A new notice, «فواتير مبدئية»,** next to «طلبات سداد», for whoever completes them. It shows how many wait, their total and since when, and opens «الموردون والمشتريات».
- **Everyone sees who is editing an invoice,** and until when: «فلان بيعدل الفاتورة حاليًا (حتى 14:30)». This works at the shop and on the website, and the lists refresh every 10 seconds.

## The keyboard at the till

- **F8:** the customer.
- **F9:** the amount paid. Shift+Tab from there reaches the payment methods; move between them with the arrows.
- **Supplier search:** in the supplier payment and preliminary invoice forms, typing part of a supplier's name chooses it when only one matches. Enter then goes straight on to the amount.

The hint row at the bottom of the till lists every key: F1, F2, F3, F4, F6, F7, F8, F9, Esc and Ctrl+Alt+L.

## Customer codes

- **Every new customer is shown their code before saving,** on the customers screen and at the till: the next number of the store's series (C00013 after C00012).
- **To use another code,** type it in place of the suggestion. It is checked at once; if another customer has it, the screen names that customer and asks for another code.
- **Typing a code** needs the permission «تحديد كود العميل يدوياً» (administrators by default). Give it to cashiers in «الأدوار والصلاحيات» if they should choose codes at the till too.
- **Customers added on the phone while the shop is offline** get W00001, W00002, …, so they never clash with the shop's codes.
- **Existing codes are not changed.**

## The installer

|                  |                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| File             | `HeroMarket-Setup-1.6.1.exe`                                                                                                     |
| Size             | 181,012,350 bytes                                                                                                                |
| SHA-256          | `5e23af6270ec65b62857f0c47abf0cc2365d10519dcc4433e6a55ebdf3e89726`                                                               |
| Built from       | the tag `v1.6.1`, `main`'s merge commit `cdb1f00`. No uncommitted change. Lint, and all 538 tests, passed on that checkout first |
| Package contents | checked: only the program, with migrations 0001–0037 and the bundled PostgreSQL; no tests, documents, databases or local files   |
| Signed           | no ("Windows protected your PC" → More info → Run anyway)                                                                        |

Check the file before installing: `Get-FileHash HeroMarket-Setup-1.6.1.exe` must show the SHA-256 above ([ROLLOUT_GUIDE.md](ROLLOUT_GUIDE.md) step 10).

## How this release was verified

- **The full test suite** passes (538 tests), with lint, the format check and the CI pipeline.
- **Stores made by the released 1.4.0 and 1.5.2 programs** were updated in place to 1.6.1 and paired; every record was kept.
- **A shop and its website together (automated):** a lock taken on the phone shows at the shop, the website suggests the code the shop then saves, and customers added on the phone while the shop is offline get W codes.
- **In a browser against a local shop and website (made-up data):** every step of the requests above, and all 31 screens at phone size. Two display faults found this way were fixed before the release.
- **This installer over the released 1.6.0 installer,** on a clean Windows (Windows Sandbox, made-up data) with a paired store, 177 changes waiting to be sent, customers (one of them deleted), a supplier and a preliminary invoice:
  - the installer took its verified copy, then applied migration 0037 (result "ok");
  - the pairing, the waiting changes, the customers and their codes, the supplier's balance and the preliminary invoice were identical afterwards;
  - the background service started as 1.6.1 over the running one;
  - the next customer got C00004: the deleted customer's C00003 was not given again.
