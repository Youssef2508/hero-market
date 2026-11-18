# HeroMarket POS 1.9.0 – Release notes

Written for the shop owner. 1.9.0 makes the till and every screen work fully from the keyboard, adds a customer return without an invoice, lets a product be sold from a scale label by its own code, and shows how many items are on the invoice. Everything in [RELEASE_NOTES_1.8.0.md](RELEASE_NOTES_1.8.0.md) still applies. The full technical report: [POS_KEYBOARD_RETURNS_SCALE_QA_REPORT.md](POS_KEYBOARD_RETURNS_SCALE_QA_REPORT.md).

**Updating:** the website is updated first, by Youssef; then you install 1.9.0 on the shop PC, over 1.8.0, as for every update ([ROLLOUT_GUIDE.md](ROLLOUT_GUIDE.md)). The database is updated once, after a verified copy.

**Stay linked.** Do not press «إلغاء الربط», and you need no new code: the shop PC stays linked to the same website, with all its data. Nothing has to be imported again. Between the two updates, the sync screen says the versions differ; the shop keeps selling, and everything comes together once the PC is on 1.9.0.

## What changes

- **The keyboard everywhere.** The arrow keys move to the nearest button or field in that direction on the screen, the right way in Arabic, and Enter presses the chosen button. Inside an open window the arrows stay in the window. Tab, the F-keys and the mouse work as before.
- **The till's cycle.** When a product is scanned or typed, its quantity is selected at once: type the quantity, press Enter, and you are back in the product field for the next one. A scan while the quantity is selected still goes to its own product.
- **A return without an invoice** («مرتجع بدون فاتورة», under البيع). For a customer who brings goods back without the receipt: choose the products and quantities and write the reason. The goods go back into stock at today's selling price, and the money is paid from your open shift's drawer, so the shift's expected cash and its closing report include it. Only administrators have this permission at first; you can give it to others in the roles screen.
- **«صنف ميزان».** A new box on the product form. When it is ticked, a scale label such as `2000001…` sells product `1` with the label's weight, without changing the product's code. Nothing is ticked by the update: every product keeps its code, its barcodes and the way labels found it before. Ticking is refused, with the reason, if it would make a label find a different product than today, for example ticking `01` while `1` exists. «فحص أصناف الميزان» in the scale settings lists anything to look at.
- **«عدد الأصناف: N»** next to the invoice title: how many different items are on the invoice now.

## Fixed

- **F4** did not remove the last item from the invoice. It does now.

## Checked before this release

- **The update of a 1.8.0 store** (made-up data, including codes `2000001`, `1`, `01` and `001`): every product, unit, barcode and stock movement unchanged, no product ticked, and each scale label finds the same product as before.
- **The whole program from the keyboard only,** three times in a row: signing in, opening a shift, scanning, quantities, a cash sale, a card sale with a customer and delivery, removing items, clearing the invoice, a return without an invoice, and all 34 screens of the menu.
- **A return without an invoice** sent twice, or made offline and sent later, is recorded once; without the permission, or with a wrong line, nothing is written.
- **Two people ticking** `1` and `01` at the same moment: exactly one succeeds.
- **All 645 automatic tests,** plus the full program on Windows and in a browser on every change.
