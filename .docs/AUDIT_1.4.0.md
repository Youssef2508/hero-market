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

**Dependency PRs (#16–#25), reviewed one by one on 2026-10-16** (owner rule: small ones may be merged after their checks pass; no unrelated upgrade goes into 1.4.0):

| PR  | Change                                                     | Decision                             | Evidence                                                                                                          |
| --- | ---------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| #16 | `actions/upload-artifact` 7.0.1 → 7.0.2 (CI only)          | **Merged**                           | Rebased, PR CI green, `main` CI green                                                                             |
| #17 | `actions/setup-node` 7.0.0 → 7.1.0 (CI only)               | **Merged**                           | Same                                                                                                              |
| #19 | `actions/download-artifact` 8.0.1 → 8.0.2 (CI only)        | **Merged**                           | Same                                                                                                              |
| #21 | React 19.3, Vite, Prettier and lint plugins (shipped code) | **Held until after 1.4.0**           | Changes the shipped program                                                                                       |
| #25 | `pg` 8.23, `lucide-react`, Cairo font (shipped code)       | **Held until after 1.4.0**           | Same                                                                                                              |
| #22 | Electron 43 → 44                                           | **Held; own test cycle after 1.4.0** | CI green, but a major runtime change needs the packaged and clean-Windows checks again                            |
| #18 | Node 22 → 25 in the Docker server image                    | **Recommend closing**                | Node 25 is a short-lived release without long-term support; move to a long-term-support Node later                |
| #23 | ESLint 9 → 10                                              | **Blocked upstream**                 | `npm ci` fails: `eslint-plugin-react` 7.37.5 does not accept ESLint 10                                            |
| #24 | `@electron-toolkit/eslint-config` 3                        | **After 1.4.0**                      | New rule `preserve-caught-error` reports one place (an error re-thrown without its cause) plus formatting changes |

## 3. Defect register

Severity: **Critical** = wrong money or lost data; **High** = wrong business result, security exposure or broken main flow; **Medium** = limited impact or needs unusual conditions; **Low** = cosmetic or hygiene.

| ID   | Severity | Defect                                                                                                                                                                                            | Status                                                                                                                                                                                          | Test                                        |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| A-01 | Critical | A sale committing while its shift was being closed could land on the closed shift; expenses of a closed shift could be deleted, changing its totals                                               | **Fixed** (migration 0011 triggers, close locks the shift)                                                                                                                                      | `integrity.test.js` (real concurrency)      |
| A-02 | Critical | A return of a part-paid invoice refunded the unpaid part in cash                                                                                                                                  | **Fixed** (D-049: debt first, then balance, then cash)                                                                                                                                          | `integrity.test.js`                         |
| A-03 | High     | Store balance spent on an invoice came back as cash; a whole-invoice return of a balance-paid invoice refunded nothing                                                                            | **Fixed**                                                                                                                                                                                       | `integrity.test.js`                         |
| A-04 | High     | Two simultaneous "open shift" requests could open two shifts for one user                                                                                                                         | **Fixed** (advisory lock)                                                                                                                                                                       | `integrity.test.js`                         |
| A-05 | High     | The till matched a typed customer by "name OR phone", so a credit sale could go on another person with the same name                                                                              | **Fixed** (phone first; a name must be unique)                                                                                                                                                  | `integrity.test.js`                         |
| A-06 | High     | Printing built PowerShell/Typst command lines from printer and product names (shell injection)                                                                                                    | **Fixed** (argument lists, string literals, validated printer names)                                                                                                                            | `integrity.test.js`                         |
| A-07 | High     | Renderer not sandboxed; the generic `ipcRenderer` bridge was exposed                                                                                                                              | **Fixed** (`sandbox: true`, only `window.api`)                                                                                                                                                  | Verified in the running app                 |
| A-08 | High     | 1.4.0 development regression: the products screen's search and category filter were broken (a `$$` placeholder turned into `$`)                                                                   | **Fixed before release**; found by UI testing                                                                                                                                                   | `categories.test.js` (regression)           |
| A-09 | Medium   | Suppliers with a non-zero balance could be deleted                                                                                                                                                | **Fixed**                                                                                                                                                                                       | `integrity.test.js`                         |
| A-10 | Medium   | Remote stock receipts bypassed the quantity rules (fractional pieces)                                                                                                                             | **Fixed**                                                                                                                                                                                       | `sync.test.js`                              |
| A-11 | Medium   | The packaged program could be run as plain Node.js (`ELECTRON_RUN_AS_NODE`) and accepted debugging switches                                                                                       | **Fixed** (Electron fuses)                                                                                                                                                                      | Verified on the QA build                    |
| A-12 | Low      | Callers without access received schema details in 400 replies                                                                                                                                     | **Fixed** (access checked before validation)                                                                                                                                                    | `integrity.test.js`                         |
| A-13 | Low      | 5 new lint warnings (state set synchronously inside effects) in 1.4.0 code                                                                                                                        | **Fixed**                                                                                                                                                                                       | Lint 29 warnings, as before                 |
| A-14 | Low      | Changes inside the files of `app.asar` are not detected at start; only a modified package header is. **No full tamper detection is claimed.**                                                     | **Open, accepted**: Program Files is writable by administrators only; code signing (not bought) would add detection                                                                             | Verified on the QA build                    |
| A-15 | Medium   | Start-up froze (no window) while the store was copied: the copy-and-verify ran synchronously on the main thread (17.1 s for 157 MB)                                                               | **Fixed**: streamed copy, longest stall 85 ms; an interrupted move leaves no half database                                                                                                      | `upgradeSnapshot.test.mjs` (no-freeze test) |
| A-16 | Critical | On a clean Windows the database could not be created at all: the PostgreSQL tools need the Microsoft Visual C++ runtime, and the cashier saw only "initdb failed:"                                | **Fixed**: the installer installs Microsoft's signed redistributable when missing; clear Arabic message if a DLL is still missing                                                               | Windows Sandbox                             |
| A-17 | Critical | A standard Windows user could read the database superuser password, write the database files and run Windows commands as the account that opened HeroMarket (privilege escalation on the till PC) | **Fixed** (D-053, owner decision: option C): database as a Windows service with its own account, app role without superuser, locked folders. Residual: SQL access to shop data (option D later) | Windows Sandbox probe; `appRole.test.js`    |
| A-18 | Low      | Installation guide gave a wrong program folder (`HeroMarket POS`, also in the password-reset command)                                                                                             | **Fixed**: `C:\Program Files\HeroMarket-POS`                                                                                                                                                    | Windows Sandbox                             |
| A-19 | Low      | The app log wrote errors as `{}`, hiding the reason (a failed print)                                                                                                                              | **Fixed**: message and stack kept                                                                                                                                                               | Windows Sandbox                             |
| K-10 | —        | Manager-approval dialog has no flow opening it (risk-based policy awaits you)                                                                                                                     | Open (earlier)                                                                                                                                                                                  | —                                           |
| K-39 | Medium   | `system.reset` must be disabled once the cloud link is on                                                                                                                                         | Open (earlier)                                                                                                                                                                                  | —                                           |

The full history (K-01 … K-40) is in [TESTING_AND_KNOWN_ISSUES.md](TESTING_AND_KNOWN_ISSUES.md) §5. There are no open Critical or High defects. A-16 and A-17 were found by the clean-Windows checks requested by the owner on 2026-10-16; both would have affected the shop.

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

| Command                                                                | Where                           | Result                                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm test` (final, commit 1a2719f)                                     | Windows, PostgreSQL 17, this PC | **221 passed, 0 failed**                                                                                            |
| `npx eslint .`                                                         | Same                            | 0 errors, 29 warnings (unchanged from before 1.4.0)                                                                 |
| `npm run format:check`                                                 | Same                            | clean                                                                                                               |
| `npm run build`                                                        | Same                            | OK                                                                                                                  |
| `npm audit --omit=dev`                                                 | Same                            | 0 vulnerabilities                                                                                                   |
| `npm audit`                                                            | Same                            | 8 moderate, all in packaging tooling (`sprintf-js` via electron-builder), not shipped                               |
| CI (Linux, Windows, Docker)                                            | GitHub                          | Green on every PR head #1–#15 and on `main` after each merge (also after #16, #17, #19); PR #26: green on each push |
| Clean Windows (Windows Sandbox), real installers                       | this PC                         | see §10                                                                                                             |
| Property-based (fast-check, seed 20261015, 3,000 cases × 6 properties) | `npm test`                      | passed                                                                                                              |
| UI on the running app (Playwright over CDP, QA database)               | this PC                         | categories, browsing, saved phones and addresses, payment, delivery snapshot: passed                                |
| Packaged QA build (unpacked)                                           | this PC                         | store folder and permissions, 127.0.0.1 only, clean stop, store move with data, fuses: passed; see A-14 and A-15    |

**Kinds of testing not done, or only partly:**

- **Load and performance:** the earlier large-store probe covered 20k products and 30k sales. 1.4.0 adds only a 2,000-product category paging test, with no separate benchmark.
- **Accessibility:** the axe run from stage 3 was not repeated on the new screens.
- **Fuzzing:** limited to the property-based generators above.

## 6. Business rules (owner decisions, 2026-10-16)

1. **A phone number that belongs to another customer** is used for the current order only and not saved to the selected customer. The cashier is told before paying (note under the field) and after paying (warning message). The same applies to a third number when two are saved.
2. **A fourth address** is used for the current order (and kept on the invoice) but not added to the customer's list; the cashier is told the same way.
3. **Each product has exactly one category or none.** Products without one (or in a stopped category) are always listed under **بدون تصنيف**, last in the list.
4. **Stopping a product** uses the existing product-edit permission (unchanged).
5. **Database credentials:** not accepted as they were. They were reviewed and fixed with option C (A-17, D-053).
6. **Not built, and not asked for:** a delivery fee, discounts per category, choosing which saved address replaces an old one.

## 7. Fixes

Commits on `release/1.4.0` (PR #26), after the audit fixes of PR #15 (8b08ee9):

| Commit  | Content                                                                    |
| ------- | -------------------------------------------------------------------------- |
| 13c19ed | Installation for all users; version 1.4.0                                  |
| f20bc14 | Addresses, categories, till browsing; A-08, A-13                           |
| 975630e | Electron fuses (A-11)                                                      |
| 388798a | Cashier told what was not saved; start-up freeze (A-15)                    |
| 70a1fc7 | Visual C++ runtime in the installer (A-16); folder name in the docs (A-18) |
| af48365 | Database as a Windows service, ordinary app role (A-17, D-053)             |
| 1a2719f | Error messages kept in the log (A-19)                                      |

## 8. Customer addresses: status

**Done.** Your later request is included: saved phones and addresses are offered for selection, and new ones are saved for the next order.

- Rules: up to three addresses, one default, enforced in the service and the database. Legacy addresses are migrated, and invoices keep a snapshot.
- Verified by 8 service tests, the property tests and the running app.

## 9. 1.4.0 build and installer

- **Final candidate:** `dist\HeroMarket-Setup-1.4.0.exe` (owner edition, per-machine, **unsigned**), from commit 1a2719f.
  - Size: 181,018,791 bytes.
  - SHA-256: `d31e37f1a40e5700924533d7f0070b89f671e6721ec8d586992030f14a8168f2`.
  - Contains Microsoft's signed Visual C++ Redistributable 14.44.35211.0.
- **Not published:** no tag, no GitHub release. The release workflow builds the published installer from a tag. That build must pass the same checks, and its SHA-256 will differ from this local one.

## 10. Clean Windows results

Windows Sandbox: a clean, disposable Windows 10 (19045), no network, nothing installed, a copy of the shop's 1.3 data (9 products, 2 customers, 4 users, 1 shift, no sales). Three fresh runs used the real installers. The final installer, from commit 1a2719f, has SHA-256 `d31e37f1a40e5700924533d7f0070b89f671e6721ec8d586992030f14a8168f2`.

| Gate                                                                                                                                                                                      | Result                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install for all users, Visual C++ runtime, shortcuts, uninstall entry                                                                                                                     | Pass                                                                                                                                                 |
| Upgrade from 1.3: old per-user copy removed, data imported with parity (every table identical), 1.3 file unchanged                                                                        | Pass                                                                                                                                                 |
| Database service under `NT SERVICE\HeroMarketDB`, automatic start, 127.0.0.1 only                                                                                                         | Pass                                                                                                                                                 |
| Standard-user probe: database files, superuser password, server settings, service stop, superuser login, Windows commands                                                                 | All refused (Pass)                                                                                                                                   |
| Two Windows accounts with HeroMarket open at the same time                                                                                                                                | Pass                                                                                                                                                 |
| Sign-in with old PIN then a new password; sale; backup; restore removes the later sale (by the owner, twice)                                                                              | Pass                                                                                                                                                 |
| Update over 1.4.0 (verified copy first), uninstall (data kept), reinstall (data reused)                                                                                                   | Pass                                                                                                                                                 |
| Conversion of a database set up by the earlier 1.4.0 build, with the app open during installation: 57 objects moved to `hm_app`, old superuser password refused, user permissions removed | Pass                                                                                                                                                 |
| Printing                                                                                                                                                                                  | Not testable: no printer. The Sandbox's default "Microsoft Print to PDF" waits for a file name, so printing timed out after 20 s; the sale was saved |
| Reboot, real hardware, the shop's real data and PC                                                                                                                                        | **Not done**                                                                                                                                         |

## 11. Hosting comparison

[HOSTING_COST_ESTIMATE.md](HOSTING_COST_ESTIMATE.md) was checked against providers' pages on 2026-10-15. No account or resource was created.

## 12. Code-signing comparison

[CODE_SIGNING_OPTIONS.md](CODE_SIGNING_OPTIONS.md) was checked against official pages on 2026-10-15. Nothing was bought.

- Microsoft Artifact Signing is not available to a business or person in Egypt.
- EV certificates no longer change SmartScreen.
- For one shop, the recommendation is to stay unsigned for now.

## 13. Release gate (for the owner's approval)

### Gate checklist

| #   | Gate                                                                      | Status                                      | Evidence                                                                                                |
| --- | ------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | PRs #1–#15 merged in order with merge commits, `main` CI green after each | **Pass**                                    | §2; #2 deviation disclosed                                                                              |
| 2   | Automated tests on the final commit                                       | **Pass**                                    | §5: 221/221, lint 0 errors, format clean, build OK                                                      |
| 3   | CI on PR #26 head                                                         | **Pass** (re-checked after the last push)   | GitHub checks on PR #26                                                                                 |
| 4   | No open Critical or High defect                                           | **Pass**                                    | §3 (A-16, A-17 fixed)                                                                                   |
| 5   | Clean-Windows install for all users, VC++ runtime, shortcuts              | **Pass**                                    | §10, Windows Sandbox                                                                                    |
| 6   | Upgrade from 1.3 with a copy of the shop data, parity                     | **Pass** (small copy: 9 products, no sales) | §10                                                                                                     |
| 7   | Two Windows accounts                                                      | **Pass** (at the same time)                 | §10                                                                                                     |
| 8   | Backup and restore                                                        | **Pass** (by the owner, twice)              | §10                                                                                                     |
| 9   | Database credentials and privileges (security review)                     | **Pass** with residual risk (below)         | SECURITY_REVIEW_LOCAL_DATABASE.md                                                                       |
| 10  | Update, uninstall, reinstall, conversion of an earlier 1.4.0 setup        | **Pass**                                    | §10                                                                                                     |
| 11  | Start-up delay understood and fixed                                       | **Pass**                                    | A-15                                                                                                    |
| 12  | Version 1.4.0 everywhere; nothing tagged or published                     | **Pass**                                    | `package.json`, no tag                                                                                  |
| 13  | Original store data untouched                                             | **Pass**                                    | SHA-256 of `%APPDATA%\elnagdi-pos\market_unified.db` identical before and after all tests (`3408E70A…`) |
| 14  | Windows restart with the program installed                                | **Not done**                                | Sandbox cannot restart                                                                                  |
| 15  | Receipt printer and barcode scanner                                       | **Not done**                                | No hardware connected to the test PC                                                                    |
| 16  | The shop's real 1.3 data (full size) on a separate PC                     | **Not done**                                | Owner's step T1                                                                                         |
| 17  | Code signing                                                              | **Not done, by decision**                   | CODE_SIGNING_OPTIONS.md (SmartScreen warning expected)                                                  |

### Unresolved security risks

1. **SQL access to shop data by Windows users of the till PC** (residual of option C). Anyone with a Windows account and technical skill can change data outside HeroMarket's permissions and audit.
   - **Mitigation:** trusted Windows accounts only, each with its own password.
   - **Fix:** option D (the HeroMarket service as a Windows service).
2. **Unsigned installer and program.** SmartScreen warns. Changes inside the program files are not detected at start (A-14); Program Files is writable by administrators only.
3. **Dev dependency advisories:** 8 moderate, in packaging tooling only (`npm audit`). Runtime dependencies: 0.
4. **K-39:** "reset the system" must be disabled before the cloud link is switched on. The cloud is not set up.

### Proposed merge and publication steps (none done; each needs your approval)

1. **Trial:**
   - The owner tries the final candidate on his laptop. Optional; see the trial note.
   - Then T1 on a separate PC with a copy of the full shop data: install, sign in, sell, back up, restore, restart Windows, printer and scanner.
2. **Merge:** mark PR #26 ready for review. Re-check its CI. Merge it into `main` with a merge commit (no squash, no force-push). Wait for `main` CI to pass.
3. **Tag:** `git tag -a v1.4.0 <merge commit> -m "HeroMarket 1.4.0"`, then `git push origin v1.4.0`. The release workflow builds the unsigned installer and `SHA256SUMS.txt` and creates a **draft** release.
4. **Verify the draft:**
   - Download the draft's installer and check it against `SHA256SUMS.txt`.
   - Repeat the clean-Windows gate (install, upgrade from 1.3, standard-user probe) on **that exact file**.
5. **Publish** the draft release (your approval).
6. **Install at the shop** following INSTALLATION_GUIDE §6:
   - take a backup;
   - close HeroMarket on every account;
   - run the installer;
   - check sign-in, a sale and printing.
7. **Rollback, if needed:** reinstall the previous installer and restore `backups\pre-install\…\pgdata` (INSTALLATION_GUIDE §7).
8. **After release:** the dependency PRs held in §2 (#21, #22, #25, #24) and option D, each in its own cycle.
