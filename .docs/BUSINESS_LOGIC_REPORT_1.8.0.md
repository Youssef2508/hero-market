# Business logic audit 1.8.0: product codes, purchase invoices, passwords, remote approvals, offline owner work

Written for Youssef, to review before anything is released, deployed or shown to the owner. Nothing in this report was deployed. The tests used throw-away PostgreSQL databases and made-up data; the owner's own data was never used. The cloud server was only read: its proxy log was summarised on the server and only times, paths and status codes were taken.

The decisions are recorded in [DECISIONS.md](DECISIONS.md) D-110 – D-113.

## 1. Root cause analysis

### Issue 1: `1` opened `01`, `01` opened `001`. Confirmed.

- **Cause** (`pos.resolve`, [src/server/modules/pos.js](../src/server/modules/pos.js)):
  - every code typed or scanned at the till was looked up under three spellings at once: as typed, without leading zeros, and with one more `0`;
  - the query had `LIMIT 1` and no order, so with `1`, `01` and `001` all registered, the row PostgreSQL happened to return first won;
  - a click on a result, or Enter on the highlighted result, sends that result's own code back through the same lookup, so even a correct choice came back as another product.
- **Evidence:** `productCodes.test.js` against the former code: choosing `01` and selling sold `001` (its stock fell; `01`'s did not), and 6 of its 8 tests fail. With the fix, 8 of 8 pass.
- **Why the spellings existed:** they were added with packaging barcodes (`edb3693`), so that a scanner reading a 12-digit UPC-A finds the product registered as its 13-digit EAN-13 (the same digits after a `0`).
- **Checked elsewhere and correct:**
  - the till's list already put the exact code first;
  - the purchase picker and damaged goods look codes up exactly (`products.get`);
  - storage is `text` throughout (database, API, sync);
  - the import reads code cells as text and the template formats them as text.
- **A smaller defect found:** product management sorted a search by name, so the exact code was not listed first.

### Issue 2: purchase invoices could not be corrected; decreases failed. Confirmed.

- **No way to correct:** a recorded invoice's quantities and prices could not be changed (D-088). The documented way was a purchase return plus a new invoice, and the owner's workaround was adding lines.
- **The "decreases" failure:** completing a preliminary invoice whose detailed total was below what had been paid with it was refused with «المدفوع أكبر من صافي الفاتورة» (`recordPurchase`, [src/server/modules/finance.js](../src/server/modules/finance.js)). Yet D-064 says the supplier then owes the store the difference. Increases and smaller decreases worked; a decrease below the payment did not.
- **The invoice list was per supplier only:** there was no list of all invoices, no date filter and no paging.

### Issue 3: one strong password rule for everyone. Confirmed (by design until now).

- `passwordProblem` (8+ characters, 4 different, no runs, no common passwords, not the username) applied to every user, whatever their access.
- Only a hash is stored, so the service had no way to know later whether a password was strong; it has to be recorded when the password is set.

### Issue 4: approvals and rejections from the phone failed. Confirmed, with the server's own log.

- **Evidence:** the proxy log on the cloud server (Sunday 2026-11-15, UTC):
  - 15 times between 03:20 and 10:35, `supplierPayments.reserve` answered 200 and the `approve` or `reject` right after it answered 401 (signed out) in under 5 ms;
  - each time the phone showed the sign-in screen and `auth.login` followed;
  - the shop's link was quiet from 01:05 to 11:30, so the cloud carried out those requests itself.
- **Cause** ([src/server/app.js](../src/server/app.js)):
  - for the browser, any answer from an operation the cloud carried out itself that had a `token` field was turned into the session cookie, and the field removed from the answer;
  - a reservation (D-099) answers `{ token, until }`, so reserving a request replaced the phone's session with the reservation token, and the next step was refused as signed out;
  - forwarded operations return before that code, which is why the same buttons worked while the shop was linked (Saturday 23:22: reserve and approve 200, about 0.5 s each, carried out in the shop).
- **Same defect elsewhere:** `supplierInvoices.reserve`, used for completing a preliminary invoice from the phone while offline.
- **"Still fails after reconnecting":** every failed attempt in the log is before 11:30, while the cloud still had no link from the shop. There were no approval attempts from the phone after the link returned. Why the link took until 11:30 cannot be seen from the cloud; the shop PC's own log would show it.
- **The stale lock the owner saw was not the cause.** The reservation is per user, renewed with the same token on the same user's other device, and expires on the database clock (5 minutes for a request). The phone kept showing the request as reserved because each attempt reserved it again before failing.
- **A related weakness:** an answer the cloud cannot confirm in time (504 "sent, awaiting the shop's confirmation") was shown to the user as a failure, and the screens never asked what became of it.
- **Hypotheses not confirmed:** a half-open connection keeping the shop "reachable" for up to `linkGraceMs` (40 s) after its internet drops. Bounded by design and not seen in the log.

### Issue 5: the owner could not change a product's code from the phone while offline. Confirmed.

- `products.changeBarcode`, like every deletion, is of kind `linked`, and the cloud refused it while the shop was unreachable (`shop_unreachable`, 503).
- Every other product field (name, prices, cost, category, units, active) already worked offline: it is saved on the copy and merged field by field when the shop returns (D-103).
- No screen disabled anything because the shop was offline.

## 2. Business logic decisions

- **Product codes are text.**
  - A code matches exactly itself: the product's own barcode, then an extra or packaging barcode.
  - The only other spelling: a 12-digit code also finds its 13-digit `0`-prefixed form, and the reverse, only when nothing has the exact code.
  - What is chosen in a list is the product added.
- **Purchase invoice corrections** (D-112):
  - **The invoice:** it always shows its corrected values; each correction is a revision with the lines before and after, totals, stock, prices, who, when and why.
  - **Totals:** recomputed from the lines, as when recording.
  - **One transaction** with a version check (`expectedRevision`) and a request id, so a correction applies exactly once and a stale screen cannot save.
  - **Preview first:** the same work as saving, rolled back.
  - **Permission:** `suppliers.purchase_revise`, administrators by default. Upgraded stores grant it only to roles that already manage purchases.
- **Supplier balance:** moves by (corrected net − previous net), in one `adjustment` ledger row. Payments, cash and shifts are never touched.
- **Overpayments:** when more was paid than the corrected invoice, the supplier owes the store the difference. This is the existing model: a balance below zero, as with purchase returns and cancelled preliminary invoices.
- **Inventory and cost:**
  - **Stock:** the per-product difference is posted as `purchase_correction` movements on top of the history. Stock may go below zero (D-041), and the preview says so.
  - **Purchase price (D-087):** a product takes the corrected price only while this invoice is its latest purchase and set its current price. A product removed from the invoice goes back to its previous purchase's price. Otherwise the price is kept and the preview says why.
  - **Past sales:** they keep their recorded cost (D-087, and the brief: never rewrite sales); the units sold since are shown.
  - **Lines with goods returned to the supplier:** they keep their product and unit, never fall below what was returned, and are never removed. Returns' credit never exceeds the corrected net.
- **Preliminary invoices:**
  - without lines: the total (up or down), number and notes are corrected, with one ledger row; a total below what was paid with it is refused there (the database requires paid ≤ total) and completed with its lines instead;
  - completing below what was paid is accepted now.
- **Passwords** (D-113):
  - **Which rule:** strong when the user's permissions include `internet.access`; otherwise any non-empty password up to 128 characters. Decided by the service.
  - **Recorded:** `users.password_strong` is set when a password is set.
  - **Granting internet access** with a simple password is refused, unless the password is reset in the same step (a strong temporary one, then a strong one chosen).
  - **Through the internet,** an account with a simple password is refused at sign-in and on every request.
- **Remote approvals:**
  - while the shop is unreachable, a decision is carried out at once on the cloud's copy, in one transaction, with the same rules, and reaches the shop once (D-103);
  - a rejection's cash goes back to the request's own shift drawer as a record (D-100), the same as from the shop; no cloud cash box is invented;
  - approval and rejection exclude each other through the row lock and the state check; repeats are idempotent;
  - a timeout is never shown as a failure: the page asks what happened.
- **Offline owner work** (D-111):
  - changes the cloud can hold are saved at once;
  - changes only the shop can make are kept as deferred operations, carried out there once when it returns, after the cloud's own changes and checked again there;
  - they are visible, with their outcome, in «عمليات بانتظار المتجر», and can be withdrawn before they are handed over.
- **Conflicts:**
  - different fields changed on both sides are both kept;
  - the same field keeps the shop's value and is listed for a person («تحتاج انتباهك», D-103);
  - a deferred change the shop refuses (for example a barcode taken meanwhile) is shown with its reason, and nothing is lost or half applied.

## 3. Implementation

- **Server:**
  - `pos.js`: exact-first code lookup;
  - `catalog.js`: exact code first in product management;
  - `app.js`: only sign-in operations set the cookie; `linked` operations are deferred while offline (202); simple passwords are refused on the internet path;
  - `cloud/link.js`: `defer()`, `cloud.operations`, `cloud.withdrawOperation`, the deferred count in `link.state`; a linked operation not taken in time stays deferred;
  - `auth/password.js`, `auth/access.js`, `auth/credentials.js`, `modules/auth.js`, `modules/admin.js`, `auth/reset.js`: the two rules, recorded strength, and the checks when granting access;
  - `modules/purchaseRevisions.js` (new): `suppliers.purchasesPage`, `suppliers.purchaseRevisions`, `suppliers.previewRevision`, `suppliers.revisePurchase`;
  - `supplierInvoices.js`: `supplierInvoices.updatePending`;
  - `finance.js`: completing below what was paid;
  - `purchaseReturns.js`: the line's unit id;
  - `backup.js`: revisions are backed up;
  - `operationKinds.js`: the two new `linked` operations;
  - `permissions.js`: `suppliers.purchase_revise`.
- **Migrations:**
  - **0040:**
    - `users.password_strong` (true for every existing password);
    - `supplier_purchases.revision`;
    - `supplier_purchase_revisions` (synchronised, backed up);
    - the `purchase_correction` stock movement kind;
    - an index on purchase time.
  - **Cloud 0006:** `cloud_operations.deferred`.
  - Both add columns, a table and a constraint value only: nothing is reset, renumbered or deleted.
- **Screens:**
  - **Suppliers:** the suppliers' page now shows the suppliers, the selected supplier and their ledger. Below them is the global invoice list with filters and paging (`PurchaseInvoices.jsx`), with «كل فواتير هذا المورد» to jump to one supplier.
  - **Invoice corrections:** the correction editor with its preview (`PurchaseRevisionModal.jsx`), and the history and correction button in the invoice window. Preliminary invoices get «تصحيح».
  - **Link strip:** «عمليات بانتظار المتجر».
  - **Passwords:** password hints follow the user's rule.
  - **Deferred answers:** shown for barcode changes and deletions.
  - **Outcome lookup:** the browser asks for the outcome of an unconfirmed answer (`webBridge.js`).
- **Documents:** DECISIONS D-110 – D-113, this report, PERMISSION_MATRIX regenerated.

## 4. Financial correctness

Every case below is a test in `purchaseRevisions.test.js`, against PostgreSQL, checking the supplier's balance and ledger, the payments, cash and drawer, the stock and its ledger (`verifyLedger`), the purchase price and the sales.

| Case                                                | Before               | After                                                                     |
| --------------------------------------------------- | -------------------- | ------------------------------------------------------------------------- |
| 3,000 → 3,500 (price 30 → 35)                       | owed 3,000           | owed 3,500; one +500 adjustment; no cash moved; price 35                  |
| 3,000 → 2,500 (C not delivered, B 80 → 100)         | owed 3,000           | owed 2,500; B +20, C −20 as correction movements                          |
| Partly paid: 1,000 of 3,000, corrected to 2,500     | owed 2,000           | owed 1,500; paid stays 1,000; nothing in the drawer or treasury           |
| Fully paid: 3,000, corrected to 2,500               | owed 0               | the supplier owes the store 500 (balance −500); invoice remaining −500    |
| Below what was paid: 3,000 paid, corrected to 2,000 | owed 0               | the supplier owes the store 1,000                                         |
| Product replaced: coffee (E) → tea (D), 10 at 100   | E +10 at 100         | E −10, D +10; D's price 100; E's price back to its previous purchase (90) |
| Quantity 10 → 5 after 7 sold                        | stock 3              | stock −2, shown before saving; the sale and its cost unchanged            |
| Preliminary 3,000 (1,000 paid), completed at 800    | refused before 1.8.0 | accepted; payable follows the detailed invoice; the supplier owes 200     |

- **Concurrency:** two corrections of the same invoice at once give exactly one revision; the other is refused with "reopen".
- **Retries:** the same request again returns the first result.
- **Stale screens:** a screen opened on an old revision cannot save.
- **Refusals:** a refused correction changes nothing.

## 5. Offline and remote operation results

From `cloudOwnerOffline.test.js` (8 tests, real shop and cloud services, the browser's own cookie handling), and `scripts/e2e/owner.js` (real Edge/Chrome, phone and desk sizes):

| Scenario                                                            | Result                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Phone approves, shop offline                                        | done in under 1 s (browser: 0.6–0.7 s), still signed in                                    |
| Phone rejects, shop offline                                         | done at once; the cash back in the shift drawer once                                       |
| Shop back                                                           | both decisions in the shop once; both sides identical                                      |
| Phone approves / rejects, shop online                               | carried out in the shop; session kept                                                      |
| Same user on two phones                                             | one reservation, the same token; the second approval answers "already approved"; paid once |
| Two administrators                                                  | the second is refused with the holder's name                                               |
| Phone reserved and left                                             | the reservation expires; another administrator takes over                                  |
| Approval and rejection at once (offline and online), approval twice | one outcome; paid once or reversed once                                                    |
| Answer lost after the shop approved                                 | the phone finds "applied"; repeating it does not pay again                                 |
| Owner edits name, prices, cost, category, active, offline           | saved at once; merged with the shop's own change; same-field conflict listed               |
| Barcode change and deletion offline                                 | kept (202); a retry is one operation; one withdrawn; the others done once on return        |
| Kept barcode change taken meanwhile at the shop                     | refused there with the reason; nothing lost                                                |
| Purchase correction offline                                         | previewed from the copy, kept, applied once on return                                      |

**Restarts:** deferred operations are rows in the cloud's database, so a cloud restart keeps them. The shop records every operation it carries out (`remote_operations`), so it never repeats one. This durability is by construction; no test restarts the services in the middle.

## 6. Password security results

From `passwordPolicy.test.js` (one long scenario against the shop and its cloud) and the updated `auth.test.js`:

- **Simple passwords at the shop:** a user who signs in only at the shop can set `1234`, `abcd`, `ABCD`, `a1`, `x` and `0000`, and signs in with each. An empty password, spaces only, or more than 128 characters are refused.
- **Strong passwords with internet access:** a user with internet access is refused `1234` (`weak_password`). The owner's strong-rule checks (too short, plain run, too few characters, containing the username) are unchanged.
- **Granting internet access with a simple password:**
  - refused, and nothing changes;
  - with a reset in the same step: granted, with a strong temporary password;
  - at the next sign-in, `1234` is refused and a strong password is accepted.
- **Taking it away and giving it back:** taken away, a simple password is allowed again. Given back while the password is simple: refused.
- **Roles:** adding internet access to a role is refused while a user in it has a simple password, and the refusal names that user.
- **Temporary passwords:** an administrator's temporary password follows the rule of the role it is for. Generated ones are always strong.
- **Through the internet:** a user without internet access is still refused for that reason. A simple password on an account with internet access (as could meet through synchronisation) is refused at sign-in, and an already open session stops working.
- **Unchanged protections:**
  - hashes are scrypt, and passwords appear in no log;
  - the wrong-password limit locks a terminal after 5 attempts, for simple passwords too (`429`);
  - sessions are unchanged.

## 7. Automated tests and CI

- **The whole suite (`npm test`, final run on the finished code): 594 tests, 594 passed, 0 failed.** The run before it had 592 of 594: the two `auth.test.js` checks that still expected the old single rule for users without internet access; they were updated (below) and pass.
- **Lint:** 0 errors. **Formatting:** clean.
- **New:**
  - `productCodes.test.js` (8);
  - `purchaseRevisions.test.js` (11);
  - `cloudOwnerOffline.test.js` (8);
  - `passwordPolicy.test.js` (1 scenario);
  - one export/import round trip of codes `1`, `01`, `001` in `storeImport.test.mjs`.
- **Changed:**
  - `operationKinds.test.js`: 177 operations;
  - `auth.test.js`: the strong-rule checks now use a user with internet access, and the simple rule is checked for a local-only user.
- **Browser:** `scripts/e2e/owner.js`, 8 of 8 in a real browser locally. It is added to CI's Linux job after the existing browser checks.
- **Shown to fail on the former code:**
  - `productCodes.test.js`: 6 of its 8 tests fail;
  - the first `cloudOwnerOffline.test.js` test fails: the reservation's token is missing, the session replaced.

## 8. Remaining risks

- **Nothing measured on the owner's PC or over a real phone connection.** The owner's exact steps ran in the test harness and a local browser.
- **Why the shop's link took until 11:30 on Sunday is unknown** from the cloud's side. The shop PC's sync log would tell; it was not read.
- **The phone's link strip can say "connected" for up to 25 s after the shop drops.** The cloud announces a change of reachability only on its next answer. Approvals are unaffected (they are routed by the server's own check), but the strip lags. This predates this work.
- **Past sales keep their cost after a purchase price is corrected (D-087).** Profit for units sold at a wrong purchase price is not restated; the preview lists those units. Restating it would mean rewriting sales, which the brief rules out.
- **Stock may go below zero after a correction,** when more was sold than was actually delivered. It is shown before saving; the count corrects it.
- **Deferred operations wait for the shop.** A barcode change made from the phone is not visible on the phone until the shop has carried it out; the strip shows it waiting.
- **Same-field conflicts keep the shop's value (D-103),** listed for a person to settle; they are not merged automatically.

## 9. Verdict

**READY WITH DOCUMENTED LIMITATIONS.** The limitations are those in §8. Nothing has been released, deployed or shown to the owner; CI runs on the branch.
