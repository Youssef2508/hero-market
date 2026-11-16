# HeroMarket POS 1.8.0 – Release notes

Written for the shop owner. 1.8.0 keeps product codes like `1`, `01` and `001` apart, lets you correct a saved purchase invoice, makes phone approvals work while the shop PC is offline, and shows on the website when the shop PC last made contact. Everything in [RELEASE_NOTES_1.7.0.md](RELEASE_NOTES_1.7.0.md) still applies. The full technical report: [BUSINESS_LOGIC_REPORT_1.8.0.md](BUSINESS_LOGIC_REPORT_1.8.0.md).

**Updating:** the website is updated first, by Youssef; then you install 1.8.0 on the shop PC, over 1.7.0, as for every update ([ROLLOUT_GUIDE.md](ROLLOUT_GUIDE.md)). The database is updated once, after a verified copy.

**Stay linked.** Do not press «إلغاء الربط», and you need no new code: the shop PC stays linked to the same website, with all its data. Nothing has to be imported again. Between the two updates, the sync screen says the versions differ; the shop keeps selling and the phone keeps working, and everything comes together once the PC is on 1.8.0.

## What changes

- **Codes with leading zeros are different products.** Before, typing or scanning `1` could open `01`, and choosing `01` in a list could sell `001`. Now a code finds exactly itself, and what you choose in a list is what is added. A scanner reading a 12-digit code still finds the same product registered with 13 digits.
- **All purchase invoices in one list** («فواتير الشراء» on «الموردون»), from every supplier, with dates, search and paging.
- **Correcting a purchase invoice.** Quantities, prices and lines of a saved invoice can be corrected. Before saving, a preview shows what changes in stock, in the supplier's balance and in purchase prices. Each correction is kept with who, when and why, and the invoice shows its corrected values. Past sales keep their cost. Preliminary invoices can be corrected too.
- **Passwords follow internet access.** A user who works only at the shop may have a simple password, such as `1234`. A user who may sign in through the internet needs a strong one. Giving internet access to someone with a simple password asks for a new password at the same time.
- **Approvals from the phone work while the shop PC is offline.** Before, approving or rejecting a payment request then signed you out. Now the decision is made on the website at once and reaches the shop once.
- **Work only the shop can do is kept for it.** Changing a product's code or correcting a purchase from the phone while the PC is offline is kept in «عمليات بانتظار المتجر». It is carried out once when the PC is back, and you see the result. You can withdraw it before that.
- **The connection strip** on the website shows whether the shop PC is connected, delayed or offline, and the time of its last successful contact, for example «المحل غير متصل — آخر تواصل ناجح: 10:45:12 م».

## Fixed

- **A supplier's account statement** disagreed with the balance after cancelling a preliminary invoice whose payment the supplier gave back. The balance itself was right. On the first start of 1.8.0, any such invoice gets one corrective row in the statement, dated that day; no balance changes.
- **An impossible date** (such as 2026-02-29) in a date filter now says «تاريخ غير صالح» instead of a server error.

## Checked before this release

- **The update in place, in Windows Sandbox** (a clean Windows, made-up data): the released 1.7.0 with a linked store of 3,005 products (including `1`, `01` and `001`), sales, purchases, payments and shifts, and 10 changes waiting to be sent. After installing 1.8.0 over it: every record unchanged, the same link, all 10 waiting changes kept, the same passwords working.
- **An interrupted update** leaves the 1.7.0 store exactly as it was; the next start finishes it.
- **The website on 1.8.0 with a shop still on 1.7.0:** nothing mixes; the shop keeps selling; after its update, sync resumes with the same link and nothing is counted twice.
- **A separate copy of the website** (the real website was not touched): linking a store of 10,003 products, phone approvals with the shop offline, restarts during sync, security checks, 20 minutes with the connection dropping 9 times, and 31 screens at phone, tablet and desktop sizes.
- **All 618 automatic tests,** plus the full program on Windows and in a browser on every change.
