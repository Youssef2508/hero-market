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

## The installer

|            |                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| File       | `HeroMarket-Setup-1.9.2.exe`                                                                                                 |
| Size       | 181,057,405 bytes                                                                                                            |
| SHA-256    | `f9f8a682eb3af3bedf9cb80c11ba4ebb1ef01b6f152cf7ce80424d4ee369ddcf`                                                           |
| Built from | the tag `v1.9.2` (`main`'s merge commit `97e7a86`) by the release workflow on GitHub, after lint and every test passed there |
| Signed     | no ("Windows protected your PC" → More info → Run anyway)                                                                    |

Check the file before installing: `Get-FileHash HeroMarket-Setup-1.9.2.exe` must show the SHA-256 above ([ROLLOUT_GUIDE.md](ROLLOUT_GUIDE.md) step 10).

**The website** was updated to 1.9.2 on 2026-11-19 and still serves the shop's own store, with the same link. A shop PC still on 1.9.0 installs 1.9.2 directly: it brings the 1.9.1 database change with it.
