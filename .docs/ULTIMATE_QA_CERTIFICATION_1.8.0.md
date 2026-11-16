# HeroMarket 1.8.0 – Quality certification (pre-handover campaign)

Written for Youssef, to decide on merging and releasing PR #53. Campaign of 2026-11-16, on this PC (disposable PostgreSQL databases), in Windows Sandbox, and on an isolated test stack on the Contabo server. Made-up data only. Nothing was merged, released or deployed. The production website and the owner's PC were never written to.

## A. Executive summary

- **What was tested:**
  - the whole service: every one of its 177 operations swept for authentication, permissions and hostile input;
  - the money and stock rules, as properties over random operation sequences;
  - concurrency;
  - the five fixes of PR #53 and the new connection strip;
  - the 1.7.0 → 1.8.0 upgrade with the real installers;
  - mixed versions and interrupted migrations;
  - synchronisation, offline work and recovery on a real server, with a real browser at three screen sizes;
  - security from outside, performance with the measured internet latency, and a 20-minute soak;
  - a mutation sample of the critical rules.
- **Environments:** local (Windows 10, Node 24, PostgreSQL 17 embedded); Windows Sandbox (a clean Windows); the isolated `hmqa` stack on the production server (production untouched, see §K).
- **Found and fixed:**
  - 5 defects (§I); none were open at the end;
  - 3 test gaps closed after the mutation sample.
- **Remaining:** no blocker. Documented limitations are in §L.
- **Decision:** **READY WITH DOCUMENTED NON-BLOCKING LIMITATIONS** (§M).

## B. Architecture and module coverage

| Module (where)                                                                           | Covered by                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in, sessions, passwords, recovery (`auth`, `auth/*`)                                | `auth`, `sessionResume`, `passwordPolicy`, `cloudWeb`, `cloudSecurity`; sweep; QA stack `security`                                                    |
| Users, roles, permissions (`admin`, `auth/permissions`)                                  | `permissions`, `roles…`, sweep: every operation against a cashier's permissions                                                                       |
| Till: lookup, search, checkout, discounts, weighing labels (`pos`, `discounts`)          | `checkout`, `productCodes`, `units`, `scaleLabels`, `discounts…`; browser `owner.js` (1/01/001); invariants                                           |
| Products, categories, units, measure kinds (`catalog`, `categories`, `measureKinds`)     | `units`, `categories…`, `productCodes`; QA stack `offline` (barcode change kept for the shop)                                                         |
| Import and export (`storeImport`, `imports`, `shared/storeImport`)                       | `importJobs*`, `storeImport.test.mjs` (1/01/001 round trip), desktop E2E in CI                                                                        |
| Customers and their accounts (`customers`)                                               | `customerCodes*`, `payablesReceivables`; invariants (customer balance = account)                                                                      |
| Sales, returns, reprints, payment changes (`sales`)                                      | `checkout`, `returns…`, `salesView…`; invariants (sale total = lines)                                                                                 |
| Suppliers, purchases, returns, corrections, preliminary invoices, payment requests       | `purchaseRevisions`, `purchaseDiscountReturns`, `supplierPayment*`, `supplierLedgerRepair`, `concurrencyMix`; invariants (supplier balance = account) |
| Stock ledger, counts, damaged goods (`inventory/*`, `stockReports`)                      | `stockLedger`, `integrity`; invariants (stock = ledger) after every 25 operations                                                                     |
| Shifts, drawers, treasury, expenses (`shifts`, `tills`, `money`, `finance`)              | `shiftReconciliation*`, `treasury…`, `adminPurchaseTreasury`; invariants                                                                              |
| Reports and dashboard (`reports`, `stockReports`)                                        | existing report tests; sweep with hostile dates (QA-01)                                                                                               |
| Backup and restore (`backup`, `main/backupJob`)                                          | `backupAudit` (every table backed up or stated), restore test, scheduled backup tests                                                                 |
| Synchronisation, cloud link, deferred operations, connection strip (`sync/*`, `cloud/*`) | `sync*`, `cloud*`, `linkConnectivity`, `cloudOwnerOffline`; QA stack `pair`, `offline`, `restart`, `perf`, `soak`                                     |
| Installer, update, background service (`build/`, `main/*`)                               | Windows Sandbox 1.7.0 → 1.8.0; `upgradeInterruption`; `existingInstall`; Windows CI packaging check                                                   |
| Screens: phone, tablet, desktop; right-to-left                                           | QA stack `ui`: 31 screens × 3 sizes; browser E2E (`browser.js`, `owner.js`)                                                                           |
| Printing and receipts (`receipts`, `main/print*`)                                        | existing template tests; **no physical printer** (§L)                                                                                                 |

## C. Test execution statistics (actually run)

| Kind                                                                                                            | Count                                     |    Passed |     Failed | Skipped |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------: | ---------: | ------: |
| Unit and service suite, `npm test` (unit, PostgreSQL integration, API, permission, concurrency, property-based) | 618 tests                                 |       618 |          0 |       0 |
| — of which property-based (`invariants`)                                                                        | 5 seeds × 200 operations                  |         5 |          0 |       0 |
| — of which the sweep of every operation (`apiHardening`)                                                        | 4 tests over 177 operations, >1,000 calls |         4 |          0 |       0 |
| Browser E2E, local (`scripts/e2e/owner.js`)                                                                     | 8                                         |         8 |          0 |       0 |
| QA test stack on the server (`scripts/qa/stack-runner.js`)                                                      | 50 checks in 8 phase runs                 |        50 |          0 |       0 |
| Installer upgrade in Windows Sandbox                                                                            | 1 run, 15 checks                          |        15 |          0 |       0 |
| Mixed versions and pairing continuity (host)                                                                    | 14                                        |        14 |          0 |       0 |
| Mutation sample (`scripts/qa/mutation-sample.js`)                                                               | 17 mutants                                | 17 killed | 0 survived |       0 |
| Exploratory (screenshots read, production's proxy log, the owner's report reproduced)                           | –                                         |         – |          – |       – |

**Not run:**

- a full mutation tool such as Stryker (a targeted sample instead);
- a coverage measurement tool (coverage is accounted per module in §B, not as a percentage);
- the Electron desktop E2E locally (it runs in Windows CI on every push).

## D. Business logic certification

**Invariants held after every 25 random operations, 1,000 operations in all:**

- each product's stock equals the sum of its movements;
- each supplier's balance equals its account read as a statement;
- each customer's balance equals its account;
- each sale's total equals its lines less their discounts.

The operations covered:

- sales of each kind, customer returns and payments;
- purchases with partial payments, purchase returns with and without refunds, and corrections;
- supplier repayments, and payment requests approved or rejected;
- preliminary invoices: corrected, completed, and cancelled with or without the money returned;
- expenses and damaged goods.

QA-03 was found this way.

**Specific evidence:**

- **Purchase corrections:** the owner's seven cases in `purchaseRevisions.test.js` (PR report §4).
- **Concurrency on one product** (`concurrencyMix`): sales from two tills, a purchase return, a count and two competing corrections at once, five rounds. No deadlock; stock equals its ledger; the supplier's balance equals its account; revisions are consecutive; every sale exactly once.
- **Product identity:** `1`, `01` and `001` are distinct at the till, in a click, with Enter, with the arrows, by scanner, in purchases and returns, and through export and import.
- **Upgrade:** every record unchanged, with the store and pairing identity kept (§H).

## E. Offline/online certification

| Operation                                   | Origin | Connectivity                              | Destination | Expected                              | Actual                         | Time                    | Consistent |
| ------------------------------------------- | ------ | ----------------------------------------- | ----------- | ------------------------------------- | ------------------------------ | ----------------------- | ---------- |
| First sync, 10,003 products                 | Shop   | online                                    | Cloud       | every record once                     | as expected                    | 22.9 s                  | yes        |
| Supplier payment approval                   | Phone  | shop half-open                            | Cloud→Shop  | done now, reaches the shop once       | 25 ms; once in the shop        | 5.2 s after return      | yes        |
| Barcode change                              | Phone  | shop half-open                            | Shop        | kept, done once on return             | 202, then applied              | 5.2 s after return      | yes        |
| Purchase correction                         | Phone  | shop half-open                            | Shop        | kept, done once on return             | 202, then applied (revision 1) | 5.2 s after return      | yes        |
| 200 invoices                                | Shop   | link cut, cloud restarted, shop restarted | Cloud       | each once                             | 200/200, 0 duplicates          | –                       | yes        |
| 500 invoices (4,000 changes)                | Shop   | offline, then back                        | Cloud       | each once                             | as expected                    | 5.1 s (8.5 s at +58 ms) | yes        |
| 542 sales, 49 phone changes                 | Both   | 9 drops and returns in 20 min             | Both        | each once                             | 1,742 = 1,742, 0 duplicates    | –                       | yes        |
| Approval vs rejection race; double approval | Phone  | online and offline                        | Both        | one outcome, paid or reversed once    | as expected                    | –                       | yes        |
| Lost answer to an approval                  | Phone  | online                                    | Shop        | found as applied, not repeated        | as expected                    | –                       | yes        |
| Conflicting barcode kept for the shop       | Phone  | offline                                   | Shop        | refused with the reason, nothing lost | as expected                    | –                       | yes        |

## F. Performance and latency (measured)

**Reads and writes** (milliseconds; on the QA stack, with no added latency and with 58 ms each way, the measured path to the server):

| Operation                                  | p50 / p95 / p99 (no added latency) | p50 / p95 / p99 (+58 ms each way) |
| ------------------------------------------ | ---------------------------------: | --------------------------------: |
| `products.page`, search in 10,003 products |                       12 / 18 / 20 |                   130 / 135 / 147 |
| `products.page`, first page                |                       18 / 25 / 31 |                   136 / 141 / 142 |
| `sales.page`                               |                          5 / 8 / 9 |                   124 / 130 / 132 |
| `dashboard.stats`                          |                          5 / 7 / 9 |                   125 / 129 / 135 |
| `suppliers.purchasesPage` (all)            |                          4 / 8 / 8 |                   124 / 129 / 136 |
| `link.state`                               |                        5 / 10 / 11 |                   124 / 129 / 133 |
| A change from the phone done in the shop   |                      65 / 86 / 131 |                   661 / 698 / 709 |

**Other figures:**

- **Measured path from this PC to the server:** TCP connect p50 117 ms (max 320 ms); a full HTTPS request p50 316 ms.
- **Sync drain:** 500 offline invoices (4,000 changes) in 5.1 s, or 8.5 s at +58 ms.
- **First sync:** 10,003 products in 22.9 s on the server.
- **Soak (20 min):** phone reads p50 7 ms, p99 14 ms. The QA cloud's memory stayed at 109–124 MiB with no growth.
- **Production during the campaign:** CPU under 1%, memory unchanged (cloud 144.7 MiB).
- **Earlier PR figures, still valid:**
  - local import of 5,000 rows in 4.9 s and 20,000 rows in 48.8 s;
  - after an outage, 2 invoices on the cloud in 5.4 s.

## G. Security findings

| Area                                                               | Result                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| No session, every operation (177)                                  | 401, except the 5 deliberately public sign-in operations; none failed                                                                  |
| Least privilege, every operation                                   | a cashier is refused (403) every operation needing a permission the cashier lacks (over 100 checked)                                   |
| Hostile values (SQL, wildcards, RTL, extremes)                     | no internal failure after QA-01; nothing changed by reads                                                                              |
| Malformed bodies (array, string, null, broken JSON, prototype key) | refused as the caller's error                                                                                                          |
| Cookie and cross-site                                              | `HttpOnly; SameSite=Strict; Secure; Path=/api`; token never in the answer; a forged cookie or one without the page's header is refused |
| Limits                                                             | 30 MB body → 413; repeated wrong passwords → 429 (simple passwords too); path traversal not served                                     |
| One user against another                                           | another user cannot see or withdraw my kept operations (404)                                                                           |
| Passwords                                                          | scrypt; never logged; simple only without internet access; granting internet needs a strong one (D-113)                                |
| Production                                                         | its proxy log was read only as times, paths and status codes; no secret was read or changed                                            |

**Vulnerabilities found:** none. QA-01 was a robustness defect (a 500 on bad input), not an exposure.

## H. Installer and migration verification

**Windows Sandbox, the real installers:** 1.7.0 → 1.8.0 over a representative 1.7.0 store (§C, PR report §11).

| Preserved                                                        | Result                                  |
| ---------------------------------------------------------------- | --------------------------------------- |
| Store id                                                         | `9b7284cc-…` before and after           |
| Pairing: device token, cloud address, epoch, linked date         | identical                               |
| Products (3,005), invoices, purchases, payments, ledgers, shifts | every row of every table identical      |
| Supplier balances, stock                                         | identical (stock of 1/01/001 unchanged) |
| Users and their passwords                                        | valid after the upgrade                 |
| Sync metadata: waiting changes (10), sequences                   | all kept; no sequence lower             |
| Background service                                               | upgraded in place, running as 1.8.0     |
| Configuration                                                    | only `setupVersion` changed             |
| The program                                                      | opens; opens after a restart            |

**Also:**

- 0040 interrupted, by failing or by being killed, leaves 1.7.0 intact, and the next start completes it;
- mixed versions are refused at the version check while each side keeps working;
- after the shop's update, synchronisation continues with the same pairing and epoch.

## I. Defect register

| ID    | Severity | Module                                                | Root cause                                                                                                                            | Reproduction                                                                                  | Fix                                                                            | Test                                                            | Verified                         |
| ----- | -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------- |
| QA-01 | Medium   | Reports, shifts, treasury, purchases, stock movements | PostgreSQL's invalid-date errors (22007/22008) were not translated: a date matching `YYYY-MM-DD` but not on the calendar answered 500 | `shifts.list {date: '2026-02-29'}` and 4 more operations                                      | translated to 400 «تاريخ غير صالح» in the shared error mapping (all consumers) | `apiHardening.test.js`                                          | yes; mutant killed               |
| QA-02 | Medium   | Cloud link                                            | the end of a held long-poll request counted as contact; on a dead connection the shop stayed "reachable" up to 65 s                   | drop the shop's Wi-Fi without closing connections                                             | contact = a request's arrival only                                             | `linkConnectivity.test.js`; QA stack `offline`                  | yes; mutant killed               |
| QA-03 | High     | Supplier accounts                                     | cancelling a preliminary invoice with the payment returned entered the refund but not the payment's cancellation: account ≠ balance   | invoice 100 paid 40, cancelled with the 40 returned: the account reads 40 owed, the balance 0 | enter both rows; a one-time repair at the shop's start for existing records    | `invariants.test.js` (found it), `supplierLedgerRepair.test.js` | yes; mutant killed; 5 seeds pass |
| QA-04 | Low      | Connection strip                                      | "data shown as of" and the operation lists used the page's time zone beside a contact time in the store's                             | a phone in another time zone: two times 2 hours apart for the same moment                     | every time on the strip in the store's time zone                               | QA stack screenshot (`strip-offline.png`)                       | yes                              |
| QA-05 | Low      | Reorder assistant (phone)                             | two summary cards side by side at 360 px wrapped one word per line                                                                    | 360×740, «مساعد الطلبيات»                                                                     | stacked on a narrow phone                                                      | QA stack `ui` screenshot                                        | yes                              |

**Found earlier in PR #53:**

- the five issues (D-110 to D-113);
- completing a preliminary invoice below what was paid being refused (D-112).

## J. Test artifacts

- **Tests:**
  - `tests/service/apiHardening.test.js`, `invariants.test.js`, `concurrencyMix.test.js`;
  - `linkConnectivity.test.js`, `upgradeInterruption.test.js`, `supplierLedgerRepair.test.js`;
  - `productCodes.test.js`, `purchaseRevisions.test.js`, `cloudOwnerOffline.test.js`, `passwordPolicy.test.js`;
  - `tests/unit/connectivity.test.mjs`, `storeImport.test.mjs`.
- **Campaign scripts:** `scripts/qa/proxy.js`, `stack-runner.js`, `mutation-sample.js` (results in `mutation-results.json`); `scripts/e2e/owner.js`.
- **Outside the repository** (this PC's session scratch folder; results summarised in this report and the PR report):
  - the Sandbox kit (`sbx/sbx-cmd/M10b-upgrade170to180.ps1`, `sbx/sbx-in/upgrade/*`) and its log;
  - the host upgrade proof (`upgrade/host.js`, `lib.js`);
  - the QA stack results (`qa/stack-results/*.json`);
  - the production baselines (`qa/prod-baseline-*.txt`, without secrets);
  - screenshots (`qa/shots/`).

## K. Cloud test stack cleanup and production verification

**Full account:** [CLOUD_PREHANDOVER_REPORT_1.8.0.md](CLOUD_PREHANDOVER_REPORT_1.8.0.md).

**Removed:** the stack, its database volume, network, images and directory.

**Production compared with its baseline:**

- the same container ids and start times (never restarted);
- the same volumes, networks, and the `.env`, `Caddyfile` and compose fingerprints;
- the same store id, device-token fingerprint and epoch;
- the same counts, and the fingerprint of all 5,255 synced rows identical;
- 0 traces of test data, and 0 operations waiting;
- healthy; TLS valid until 2027-02-10;
- no test worker or agent remains.

## L. Remaining limitations

- **Not on the owner's PC and network.** The shop side ran on this PC and in Sandbox. The internet path was emulated at the measured latency, and the half-open drop with a proxy, not a real router.
- **No physical receipt printer or scanner** in any test. Scanning was simulated by typed codes; printing by templates.
- **No full mutation tool and no coverage percentage.** A targeted sample of 17 mutants (all killed) and per-module accounting instead.
- **The Electron desktop E2E** (`scripts/e2e/desktop.js`) runs in Windows CI, not again locally in this campaign.
- **Earlier phone sales stay as recorded:** profit of units sold before a purchase price correction keeps its recorded cost (D-087, by design).
- **Stock may go below zero after a correction,** as allowed since D-041. It is shown before saving.
- **Same-field conflicts between shop and phone** keep the shop's value and are listed for a person (D-103). They are not merged automatically.
- **The website's state between the two updates:** the owner's 1.7.0 PC is refused until it is updated (by design, D-105). The runbook orders the steps so this lasts minutes.

## M. Final certification verdict

**READY WITH DOCUMENTED NON-BLOCKING LIMITATIONS.**

**Evidence:**

- every release gate holds: no open critical or high defect (QA-03 fixed and repaired), the financial invariants pass, synchronisation stays consistent under drops and restarts, upgrade preservation is proven with the real installers, unauthorised access is refused everywhere, and no production safeguard was violated;
- the full suite passes (§C), and the mutation sample is fully killed.

**What remains** is listed in §L. None of it loses data or money. All of it is either by design or can only be observed at the shop.
