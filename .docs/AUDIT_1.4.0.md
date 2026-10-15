# HeroMarket 1.4.0: audit, testing, integration and release readiness

Date: 2026-10-15. Release branch `release/1.4.0`, draft PR #26 (not merged). Nothing has been deployed, published, bought or installed on the shop PC. The original store data (`%APPDATA%\elnagdi-pos\market_unified.db`) has the same SHA-256 before and after every test (`3408E70A2D80C34E…`).

## 1. Inventory

- **Product:** a Windows point-of-sale program, Electron 43 with a sandboxed React 19 renderer. It runs an in-process Fastify 5 service and its own PostgreSQL 17 on `127.0.0.1`.
- **Optional pieces:**
  - networked tills over pinned TLS;
  - a cloud side for the owner (sync built and tested, **not deployed**).
- **Database:** 13 migrations (0001–0013); 0011–0013 are new in this release.
- **Service:** named operations with JSON schemas and server-side permissions; the renderer never composes SQL.
- **Tests:** 217 automated tests (70 database-free, 147 on PostgreSQL) in 35 files. CI runs Linux, Windows and Docker jobs.
- **Further detail:** [REPOSITORY_MAP.md](REPOSITORY_MAP.md), [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md), [ARCHITECTURE.md](ARCHITECTURE.md).

## 2. PR dependency graph and merge history

The 15 PRs formed one chain: each branch was built on the previous one, #1 → #2 → … → #15.

Each PR was merged with a **merge commit**, in order. There was no force-push and no history rewrite. Before each merge:

- the PR was retargeted to `main`;
- `main`'s tree was shown to be identical to the previous PR's head;
- the PR's head CI (3 jobs) had to be green.

The merge result was therefore byte-identical to the CI-tested PR head. After each merge, CI on `main` had to pass before the next one.

| PR                                                             | Merge commit on `main` | `main` CI |
| -------------------------------------------------------------- | ---------------------- | --------- |
| #1 brand, UI redesign, tests and CI foundation                 | 3b48df9                | ✅        |
| #2 PostgreSQL service, roles, receipt designer, local database | 588b43b                | ✅        |
| #3 Electron 43, production CSP                                 | 57244ab                | ✅        |
| #4 stage 3 hardening, TLS for tills                            | aecfc8e                | ✅        |
| #5 K-24 one expected-cash formula                              | 9fd7ff6                | ✅        |
| #6 stock ledger, purchase receipts, moving average             | 8a8095b                | ✅        |
| #7 units and packaging, weighed products                       | 4d156ec                | ✅        |
| #8 manual weighing                                             | 0f0a6d1                | ✅        |
| #9 12-hour clock                                               | dae618e                | ✅        |
| #10 automatic administrator discounts                          | 48b6f02                | ✅        |
| #11 Windows installer, verified pre-upgrade snapshot           | d4953ed                | ✅        |
| #12 two phone numbers per customer                             | 3d5f411                | ✅        |
| #13 passwords, supervised returns                              | 668ea95                | ✅        |
| #14 sync engine and failure-injection proof                    | ed365ba                | ✅        |
| #15 recovery after restore + **1.4.0 audit fixes (D-049)**     | ab488f8                | ✅        |

**Deviation, disclosed:** PR #2 was merged by an earlier script that checked only push CI, not the PR's own checks.

- Afterwards, `main`'s tree was verified identical to #2's head, whose CI had passed, so the merged code was the tested code.
- All later merges used the tree-and-CI gate above.

**Not merged (need your approval):** Dependabot PRs #16–#25. These are:

- GitHub Actions bumps;
- Node 22 → 25 in the Docker image;
- Electron 43 → 44;
- ESLint 9 → 10;
- `@electron-toolkit/eslint-config` 3;
- two grouped minor updates.

Electron 44, Node 25 and ESLint 10 are major upgrades and each needs its own test run.

## 3. Defect register

Severity: **Critical** = wrong money or lost data; **High** = wrong business result, security exposure or broken main flow; **Medium** = limited impact or needs unusual conditions; **Low** = cosmetic or hygiene.

| ID   | Severity | Defect                                                                                                                                              | Status                                                               | Test                                   |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| A-01 | Critical | A sale committing while its shift was being closed could land on the closed shift; expenses of a closed shift could be deleted, changing its totals | **Fixed** (migration 0011 triggers, close locks the shift)           | `integrity.test.js` (real concurrency) |
| A-02 | Critical | A return of a part-paid invoice refunded the unpaid part in cash                                                                                    | **Fixed** (D-049: debt first, then balance, then cash)               | `integrity.test.js`                    |
| A-03 | High     | Store balance spent on an invoice came back as cash; a whole-invoice return of a balance-paid invoice refunded nothing                              | **Fixed**                                                            | `integrity.test.js`                    |
| A-04 | High     | Two simultaneous "open shift" requests could open two shifts for one user                                                                           | **Fixed** (advisory lock)                                            | `integrity.test.js`                    |
| A-05 | High     | The till matched a typed customer by "name OR phone", so a credit sale could go on another person with the same name                                | **Fixed** (phone first; a name must be unique)                       | `integrity.test.js`                    |
| A-06 | High     | Printing built PowerShell/Typst command lines from printer and product names (shell injection)                                                      | **Fixed** (argument lists, string literals, validated printer names) | `integrity.test.js`                    |
| A-07 | High     | Renderer not sandboxed; the generic `ipcRenderer` bridge was exposed                                                                                | **Fixed** (`sandbox: true`, only `window.api`)                       | Verified in the running app            |
| A-08 | High     | 1.4.0 development regression: the products screen's search and category filter were broken (a `$$` placeholder turned into `$`)                     | **Fixed before release**; found by UI testing                        | `categories.test.js` (regression)      |
| A-09 | Medium   | Suppliers with a non-zero balance could be deleted                                                                                                  | **Fixed**                                                            | `integrity.test.js`                    |
| A-10 | Medium   | Remote stock receipts bypassed the quantity rules (fractional pieces)                                                                               | **Fixed**                                                            | `sync.test.js`                         |
| A-11 | Medium   | The packaged program could be run as plain Node.js (`ELECTRON_RUN_AS_NODE`) and accepted debugging switches                                         | **Fixed** (Electron fuses)                                           | Verified on the QA build               |
| A-12 | Low      | Callers without access received schema details in 400 replies                                                                                       | **Fixed** (access checked before validation)                         | `integrity.test.js`                    |
| A-13 | Low      | 5 new lint warnings (state set synchronously inside effects) in 1.4.0 code                                                                          | **Fixed**                                                            | Lint 29 warnings, as before            |
| A-14 | Low      | A byte changed inside a file of `app.asar` is not detected at start (only header changes are)                                                       | **Open, accepted**: Program Files is admin-only; code signing later  | Verified on the QA build               |
| A-15 | Low      | One packaged run showed no window for about a minute                                                                                                | **Open, not reproduced** (a repeat showed it after 12 s)             | Watch during T1                        |
| K-10 | —        | Manager-approval dialog has no flow opening it (risk-based policy awaits you)                                                                       | Open (earlier)                                                       | —                                      |
| K-39 | Medium   | `system.reset` must be disabled once the cloud link is on                                                                                           | Open (earlier)                                                       | —                                      |

The full history (K-01 … K-40) is in [TESTING_AND_KNOWN_ISSUES.md](TESTING_AND_KNOWN_ISSUES.md) §5. There are no open Critical or High defects.

## 4. Traceability matrix (1.4.0 requirements)

| Requirement                                                                       | Implementation                                                                               | Automated tests                                | Manual / UI evidence                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| Up to 3 optional addresses, labels, one default, enforced in backend and database | migration 0012, `customers.js`, `src/shared/address.mjs`                                     | `addresses.test.js` (8), `properties.test.mjs` | Customer forms in the running app                                |
| Legacy address preserved                                                          | migration 0012                                                                               | `addresses.test.js` (migration test)           | —                                                                |
| Invoice keeps the delivery address                                                | `sales.delivery_address`, `pos.js`                                                           | `addresses.test.js`                            | Invoice 25/26 on the QA database                                 |
| Cashier picks saved phones and addresses (your request)                           | `CheckoutTerminal.jsx`, `usePOSController.js`, `pos.js`                                      | `addresses.test.js` (returning customers)      | Phone and address lists verified in the app                      |
| Categories administration and product assignment                                  | migration 0013, `categories.js`, `CategoriesTab.jsx`, product forms                          | `categories.test.js` (12)                      | Categories screen in the app                                     |
| Browse categories without losing the cart; vertical list (your request)           | `CategoryBrowser.jsx`, `pos.css`                                                             | `catalogCache.test.mjs` (5)                    | F6, ↑/↓, Esc keeps the cart, screenshots                         |
| Products without a category under "بدون تصنيف" (your request)                     | `pos.categories` / `pos.categoryProducts` id 0                                               | `categories.test.js`                           | New product found and added in the app                           |
| Caching with invalidation, offline, authoritative pricing                         | `catalog_state` triggers, `catalogCache.js`; prices re-checked by `pos.resolve` and checkout | `catalogCache.test.mjs`, `categories.test.js`  | —                                                                |
| Authorisation on the server                                                       | `categories.manage`, `pos.sell`                                                              | `categories.test.js`                           | —                                                                |
| Per-machine installer usable by all Windows users                                 | `perMachine: true`, `%ProgramData%\HeroMarket`                                               | `upgradeSnapshot.test.mjs` (copy and verify)   | QA build: folder, permissions, store move; **installer not run** |
| Version 1.4.0, no release                                                         | `package.json`                                                                               | —                                              | No tag, no GitHub release                                        |
| Cashier discounts stay automatic                                                  | unchanged (D-044); browsing uses the scan path                                               | `discounts.test.js`, `categories.test.js`      | —                                                                |

## 5. Test execution report

| Command                                                                | Where                           | Result                                                                                                           |
| ---------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                             | Windows, PostgreSQL 17, this PC | **217 passed, 0 failed** (425 s)                                                                                 |
| `node tests/run-all.js service` (after the last test was added)        | Same                            | 147 / 147                                                                                                        |
| `node tests/run-all.js unit`                                           | Same                            | 70 / 70                                                                                                          |
| `npx eslint .`                                                         | Same                            | 0 errors, 29 warnings (unchanged from before 1.4.0)                                                              |
| `npm run format:check`                                                 | Same                            | clean                                                                                                            |
| `npm run build`                                                        | Same                            | OK                                                                                                               |
| `npm audit --omit=dev`                                                 | Same                            | 0 vulnerabilities                                                                                                |
| `npm audit`                                                            | Same                            | 8 moderate, all in packaging tooling (`sprintf-js` via electron-builder), not shipped                            |
| CI (Linux, Windows, Docker)                                            | GitHub                          | Green on every PR head #1–#15 and on `main` after each merge. PR #26: see the PR                                 |
| Property-based (fast-check, seed 20261015, 3,000 cases × 6 properties) | `npm test`                      | passed                                                                                                           |
| UI on the running app (Playwright over CDP, QA database)               | this PC                         | categories, browsing, saved phones and addresses, payment, delivery snapshot: passed                             |
| Packaged QA build (unpacked)                                           | this PC                         | store folder and permissions, 127.0.0.1 only, clean stop, store move with data, fuses: passed; see A-14 and A-15 |

**Kinds of testing not done, or only partly:**

- **Load and performance:** the earlier large-store probe covered 20k products and 30k sales. 1.4.0 adds only a 2,000-product category paging test, with no separate benchmark.
- **Accessibility:** the axe run from stage 3 was not repeated on the new screens.
- **Fuzzing:** limited to the property-based generators above.

## 6. Business rules that needed a decision (chosen defaults; please confirm)

1. **A typed phone that already belongs to another customer** is used for that order but never saved to this customer.
2. **A fourth address typed for a customer who already has three** is used for that order (and kept on the invoice) but not saved. Nothing is replaced automatically.
3. **A product has one category at most.** Products in a stopped category are sold under "بدون تصنيف".
4. **Stopping a product** uses the existing product-edit permission.
5. **Every Windows user of the till PC can read `heromarket.json`** (database password). This is accepted because each of them must be able to start the shop.
6. **Not built, and not asked for:**
   - a delivery fee;
   - discounts per category;
   - choosing which saved address replaces an old one.

   Tell me if you want any of them.

## 7. Fixes

The A-01 … A-13 fixes, with commits:

- 8b08ee9 (audit fixes, in PR #15);
- f20bc14 (1.4.0 features and the A-08 and A-13 fixes);
- 975630e (fuses, A-11).

## 8. Customer addresses: status

**Done.** Your later request is included: saved phones and addresses are offered for selection, and new ones are saved for the next order.

- Rules: up to three addresses, one default, enforced in the service and the database. Legacy addresses are migrated, and invoices keep a snapshot.
- Verified by 8 service tests, the property tests and the running app.

## 9. 1.4.0 build and installer

- **Built:** `dist\HeroMarket-QA-Setup-1.4.0.exe` (QA edition, 155.6 MB, per-machine, **unsigned**), from commit 975630e plus documentation.
- **Production installer:** the owner edition is built by the release workflow from a tag. No tag was created.

## 10. Clean Windows results

**No clean-Windows test was run.** This PC is a development PC, Windows Sandbox is not available, and installing for all users needs an administrator prompt that could not be approved here.

What was tested on this PC is listed separately: the unpacked QA build, the store folder, the store move and the fuses.

Still to do, in [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) §9 and [GO_LIVE_TEST_PLAN.md](GO_LIVE_TEST_PLAN.md) T1:

- the installation;
- upgrading a real 1.3 install;
- two Windows accounts on one PC;
- the physical printer and scanner;
- power loss.

## 11. Hosting comparison

[HOSTING_COST_ESTIMATE.md](HOSTING_COST_ESTIMATE.md) was checked against providers' pages on 2026-10-15. No account or resource was created.

## 12. Code-signing comparison

[CODE_SIGNING_OPTIONS.md](CODE_SIGNING_OPTIONS.md) was checked against official pages on 2026-10-15. Nothing was bought.

- Microsoft Artifact Signing is not available to a business or person in Egypt.
- EV certificates no longer change SmartScreen.
- For one shop, the recommendation is to stay unsigned for now.

## 13. Blockers and approvals needed

| #   | Decision                                           | Recommendation                                                                                              |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Merge draft PR #26 (1.4.0) into `main`             | After you run T1 (installer on a separate PC with a copy of your data)                                      |
| 2   | Tag and publish 1.4.0                              | Only after #1 and T1 pass                                                                                   |
| 3   | Dependabot PRs #16–#25                             | Merge the GitHub Actions bumps; test Electron 44, Node 25 and ESLint 10 separately                          |
| 4   | Business rules in §6                               | Confirm or change                                                                                           |
| 5   | Code signing                                       | Stay unsigned for one shop ([CODE_SIGNING_OPTIONS.md](CODE_SIGNING_OPTIONS.md))                             |
| 6   | Cloud hosting                                      | Your choice from [HOSTING_COST_ESTIMATE.md](HOSTING_COST_ESTIMATE.md); nothing is created until you approve |
| 7   | K-10 manager approval policy, K-39 reset with sync | Before the cloud link is switched on                                                                        |
