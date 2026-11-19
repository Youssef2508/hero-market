# HeroMarket POS 1.9.2 – Release notes

Written for the shop owner. 1.9.2 makes three corrections the owner asked for. Everything in [RELEASE_NOTES_1.9.1.md](RELEASE_NOTES_1.9.1.md) still applies.

**Updating:** install 1.9.2 over 1.9.1 on the shop PC; the website is updated too, by Youssef. The database does not change, so the website and the shop keep working together whichever is updated first. Stay linked: no «إلغاء الربط», no new code, nothing to import.

## Fixed

- **A purchase return is no longer refused because of the stock.** Before, returning a wrong purchase invoice was refused when the recorded stock was less than the quantity returned (for example the stock was -1 and the invoice had 10). Now it is recorded, and the stock may go below zero, as it can after a sale. You still cannot return more than the invoice line bought.
- **«نقدي كامل» on a new purchase invoice pays the whole invoice.** The amount paid now is filled in with the invoice's net (after any discount) and follows it as you add lines; you do not type it. Before, an invoice marked «نقدي كامل» could be saved with nothing paid.
- **Changing a product's code and ticking «صنف ميزان» from the website while the shop is offline.** The code change is kept for the shop, as before. The tick is no longer sent with the old code (it would have been refused at the shop); you are told to tick it once the shop is back, on the product's new code.

## Checked before this release

- A product at stock -1 with a purchase invoice of 3: the whole invoice returned; the stock is -4, the supplier is credited, and returning more than the line bought is still refused.
- Every automatic test.
