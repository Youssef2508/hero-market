# HeroMarket POS 1.9.1 – Release notes

Written for the shop owner. 1.9.1 corrects one rule of «صنف ميزان» from 1.9.0 and makes the reason of a return without an invoice optional. Everything in [RELEASE_NOTES_1.9.0.md](RELEASE_NOTES_1.9.0.md) still applies.

**Updating:** the website is updated first, by Youssef; then you install 1.9.1 on the shop PC, over 1.9.0 ([ROLLOUT_GUIDE.md](ROLLOUT_GUIDE.md)). The database changes slightly (the reason may be empty), so between the two updates the sync screen says the versions differ; the shop keeps selling. Stay linked: no «إلغاء الربط», no new code, nothing to import.

## Fixed

- **A product that is not «صنف ميزان» no longer stops another one being marked.** In 1.9.0, ticking «صنف ميزان» for code `1` was refused while a product with code `00001` (or `2000001`) existed, even though that product was not ticked. Now:
  - the ticked product takes its scale labels: a label `2000001…` sells `1` with the label's weight;
  - the product that is not ticked is only its own code: typing or scanning `00001` still finds `00001`;
  - ticking is still refused when the other product is also ticked with the same code apart from zeros at the start (`1` and `00001`), or when another product's barcode is itself a full scale label of that code.

- **«السبب» in «مرتجع بدون فاتورة» is optional.** Leave it empty when there is nothing to say; a reason you write is kept as before.

## Checked before this release

- Ticking `1` while `00001` exists, not ticked: allowed. The label finds `1` with 0.125 kg, and typing `1` and `00001` each finds its own product.
- Ticking `1` and `01` together, or `1` while `00001` is ticked: refused, also when two people do it at the same moment.
- A return without an invoice with no reason, or only spaces, is saved with no reason.
- Every automatic test.
