# Decision Log

Format: context → decision → reason → consequences (→ alternatives).

## D-001 Keep the stack (Electron + React 19 + plain CSS); no UI framework

- **Context**: Renderer is React 19 with one global stylesheet and ~1,300 inline style objects.
- **Decision**: Build the design system as CSS custom properties + a small set of CSS component classes and thin React primitives. No Tailwind, MUI or CSS-in-JS.
- **Reason**: Smallest change surface; works with the existing inline styles (which can reference `var(--token)`); no build-chain risk.
- **Consequences**: Discipline needed to keep raw values out of components; documented in `UI_UX_DESIGN_SPEC.md`.
- **Alternatives**: Tailwind (large migration, new toolchain), component library (visual mismatch for RTL Arabic POS).

## D-002 Navigation remains state-based (no router)

- **Context**: `currentView` / `adminTab` drive both rendering and scanner routing (`useBarcode`).
- **Decision**: The new sidebar maps every destination to the **same** `currentView`/`adminTab` values via one config (`components/shell/navigation.js`).
- **Reason**: Preserves scanner behaviour and all data-loading side effects (the original menu-card `action`s are reused per item).
- **Consequences**: No deep links/back button (not needed in a kiosk-style desktop app).

## D-003 Sidebar on the right with an automatic compact rail

- **Decision**: Right-side sidebar (RTL start); 240 px expanded, 72 px compact rail; compact automatically below 1200 px window width, user toggle persisted in `localStorage['heromarket.sidebar']`.
- **Reason**: At 1000×630 a full sidebar would starve the cashier screen.

## D-004 Theme preference stored in `localStorage`, applied pre-paint

- **Context**: The app has a `settings` DB table, but reading it requires an async IPC + process spawn.
- **Decision**: Store `heromarket.theme` (`light` | `dark`; absent = system) in renderer `localStorage` (persisted by Electron in the profile directory) and apply it from an inline script in `index.html` before React renders.
- **Reason**: Synchronous → no flash of the wrong theme; per-workstation preference is the right scope.
- **Alternatives**: `settings` table (async, would flash; shared across workstations is undesirable).

## D-005 Branding without breaking installed data

- **Status**: **Superseded by D-034** (2026-10-14). Kept for history.
- **Decision (stage 1)**: user-facing names became "HeroMarket POS"; internal identifiers and the data folder kept the original project's name so installed databases upgraded in place.

## D-006 Lock screen: Enter submits the PIN

- **Context**: The hidden PIN input was outside the `<form>`, so keyboard users had to click "دخول".
- **Decision**: Put the input inside the form. Same handler (`handlePinSubmit`).
- **Behaviour change**: Enter now logs in. Intentional usability fix.

## D-007 Fix renderer crashes that blocked documented behaviour

- **Context**: `handleBarcodeSubmit` referenced `parsed` outside its block and used `round2` without importing it → unknown barcodes threw `ReferenceError` (no "not registered" toast; suffix matching never ran) and price-embedded scale barcodes failed.
- **Decision**: Hoist `parsed`, import `round2`. No rule changes.
- **Behaviour change**: The originally intended toast and suffix lookup now run.

## D-008 Fix undefined-identifier crashes in error paths

`AdminDashboard` (the Suppliers menu card called `setSelectedSupplier(null)`, which `useAdminController` already exported but the dashboard never destructured – the sidebar's `onEnter` for Suppliers now calls it on the controller), `SalesTab` (`setReturnErrorMsg`), `MomknOperationModal`/`MobileMoneyOperationModal` (`setErrorMsg`), `ChangePinModal` (hooks called after an early return, React rules-of-hooks), `shifts.dao` (missing imports). Each fix only makes the existing intent executable.

## D-009 Fix two queries referencing non-existent columns

- `ReorderingTab` selected `products.price` (no such column) → screen empty. Now selects `retail_price AS price`.
- `useAdvancedAnalytics` top products selected `sale_items.product_name` → now joins `products.name`.
- **Reason**: Both screens were broken in the baseline; fixes do not change any calculation.

## D-010 Bundle Cairo locally

- **Decision**: `@fontsource-variable/cairo` (OFL) imported by the renderer.
- **Reason**: The POS is offline-first and the CSP forbids remote fonts.

## D-011 Icons stay on `lucide-react`; emoji removed from UI chrome

- **Reason**: Already a dependency, consistent 1.5–2 px strokes, good RTL coverage. Emoji remain only inside receipt/print templates (not touched).

## D-012 Docker is used for CI/test reproducibility only

- See `DOCKER.md`. The product is a Windows desktop app with Windows-only binaries; a container cannot run it. A Linux image runs lint, renderer build and the SQL simulation tests with a Linux `sqlite3`.

## D-013 Dev database path override

- `HEROMARKET_DB_PATH` (dev only, ignored when packaged) points the app at a disposable database for QA and automated tests, so test sales never touch `market_unified_testing.db`.

## D-014 Customer delete passes the customer object

- **Context**: `ClientsTab` called `handleDeleteClient(c.id)`, but `useClientsManager.handleDeleteClient` expects the customer object (`client.debt_balance`, `client.name`, `client.id`). With a number, `client.debt_balance !== 0` was always true, so every delete attempt showed "لا يمكن حذف عميل لديه رصيد مالي" and no customer could ever be deleted.
- **Decision**: Call `handleDeleteClient(c)`. The hook, its confirmation and its SQL are unchanged.
- **Behaviour change**: Customers with a zero balance can be deleted (after the existing confirmation); customers with a balance are still refused, as the hook intended.

## D-015 Customer repayment form no longer reloads the window

- **Context**: The repayment `<form>` had no `preventDefault`, so pressing Enter or the submit button reloaded the renderer (losing the cart and session state) before or while `handleRepayment` ran.
- **Decision**: `onSubmit={(e) => { e.preventDefault(); handleRepayment() }}` – same handler, same validation.

## D-016 Alerts stay usable on the lock screen

- **Context**: A wrong PIN triggers the shared alert dialog, which rendered under the lock screen (z-index 1000 vs 100000) and was invisible; focus then stayed on the alert's hidden button, so further key presses went nowhere.
- **Decision**: The locked branch of `App.jsx` renders `CustomAlertModal` with a z-index above the lock screen, and typing a digit while no dialog is open refocuses the hidden PIN input.
- **Behaviour change**: The "wrong PIN" message is now visible; PIN entry recovers without a mouse click.

## D-017 Dialogs submit on Enter

- **Context**: Open shift, simple/advanced close shift and item return dialogs used buttons with `onClick` only (the add-expense dialog was already a form).
- **Decision**: Wrap their fields in `<form onSubmit>` calling the **same** handler with the same arguments (`handleStartShift`, `handleConfirmCloseShift(null)` / the advanced aggregated object, `handleReturnItem`). Validation is unchanged. Footer buttons keep their original order, so Tab from the last field reaches the same button as before.
- **Behaviour change**: Enter submits these dialogs, consistent with the other forms in the app.

## D-018 Tills screen waits for its first summary

- **Decision**: `TillsManagerTab` shows a loading state until the first drawer summary has loaded (`drawerReady`), instead of briefly rendering zeros that look like real balances. Queries and polling are unchanged.

## D-019 Suffix-match candidates are visible

- **Context**: After D-007 the unknown-barcode path finds products whose barcode ends with the scanned digits and stores them in `searchResults`, but the dropdown only rendered while the search box had text, so the candidates were invisible.
- **Decision**: The dropdown also renders when `searchResults` is non-empty, with a close button. Selecting a candidate uses the existing `selectSearchResult` path.

## D-020 Cashier quantity stepper

- **Decision**: Each cart row gets − / + buttons next to the existing quantity input. They call the existing `handleQtyChangeAttempt(barcode, String(qty ± 1))`, so permissions, stock checks and weighted-item rules are identical to typing the number; − is disabled when it would reach 0 (deleting stays an explicit action).
- **Reason**: Touch-friendly and faster than selecting the input; no new business path.

## D-021 Role label for managers

- `UsersTab` showed managers as "كاشير". The badge now maps `admin` → مدير النظام, `manager` → مشرف, `cashier` → كاشير. Display only; roles and permissions are unchanged.

## D-022 Lint baseline: rules adjusted, code fixed

- **Context**: 1,014 ESLint errors in the baseline, 848 of them `react/prop-types` in a JavaScript project with no PropTypes.
- **Decision**: Turn `react/prop-types` off; configure `no-unused-vars` to ignore `_`-prefixed names and unused catch parameters; allow empty `catch {}`; keep `react-hooks/set-state-in-effect` as a warning (the existing effects that sync state are intentional and behaviour-bearing). Every other error was fixed in code (dead code removed, undefined identifiers fixed per D-007/D-008, regex escapes cleaned).
- **Result**: 0 errors. Remaining warnings are listed in `TESTING_AND_KNOWN_ISSUES.md`.

## D-023 Formatting kept out of functional diffs

- **Decision**: Prettier (existing `.prettierrc.yaml`) is enforced on `src`, `tests`, `scripts` by `npm run format:check` in CI. Files whose only change was formatting were committed separately (`style:` commit, verified by re-formatting each HEAD version and comparing byte for byte); files that were rewritten anyway were formatted in their own commit.
- **Reason**: Keeps functional diffs reviewable and makes style a non-issue from now on.

## D-024 CI on Linux, Windows and Docker; releases as unsigned drafts

- **Decision**: Fast checks on Linux; the Windows job proves the real target (bundled `sqlite3.exe`, packaging); the Docker job proves the reproducible image. Releases are built only from version tags and land as **draft** GitHub Releases with checksums. No code signing until a real certificate exists.
- **Reason**: Matches a Windows-only desktop product without pretending to deploy anything; no secrets required. Details in `CI_CD.md` and `SECURITY_AND_RELEASE.md`.

## D-025 Test harness can fail

- **Decision**: `tests/run-all.js` runs the four suites and fails on a non-zero exit, a `❌` marker, `Error: FAILED` or a missing completion banner; suites set `process.exitCode = 1` on error and inner `catch` blocks rethrow `FAILED:` assertions; `db_helper.js` bootstraps a fresh database when no source DB exists or `--fresh` is given.
- **Reason**: The inherited suites could not fail (T-1…T-3), so their green results meant nothing. Test logic and SQL are unchanged.

## D-026 PostgreSQL 17 is the operational database

- **Context**: SQLite through one `sqlite3.exe` process per query: one PC, one writer, no access control, REAL money values.
- **Decision**: PostgreSQL 17. The weighted decision matrix scored PostgreSQL 78, MySQL/MariaDB 64, SQL Server Express 56 and SQLite 45 ([GAP_ANALYSIS.md](GAP_ANALYSIS.md) §1.1). SQLite remains only as the source format of the one-off import.
- **Consequences**: Money is `numeric`; real row locks and MVCC for several tills; WAL durability; `pg_dump` backups.

## D-027 The HeroMarket service owns the database

- **Decision**: A Node service (`src/server`) is the only database client. Terminals call named operations (`POST /api/<op>`) with JSON bodies. The service runs in-process for one-PC stores and as a server for several tills.
- **Reason**: One place for permissions, calculations and transactions; no database credentials on tills; the renderer cannot run SQL.
- **Rejected**: Pointing renderer SQL at PostgreSQL (no boundary). The main process connecting directly (credentials on every till).

## D-028 Fastify + pg + numbered SQL migrations, no ORM

- **Decision**: Fastify 5 (JSON-schema validation, pino logs), `pg` with hand-written parameterised SQL, and a small migration runner (checksums, advisory lock, one transaction per file).
- **Reason**: The existing SQL ports directly and stays reviewable. Pure JS: no native build inside Electron.

## D-029 Legacy import: exact values, original ids, row-level parity, source read-only

- **Decision**: `src/server/db/legacy-import.js` copies every table in one transaction with the original ids and exact decimal values. It proves parity per table (count + SHA-256 of canonical rows + foreign-key re-check) before committing, refuses foreign targets, invalid values and orphans, and only ever reads the SQLite file (after a verified backup copy).
- **Reason**: Mission rule: no dropped fields, changed values or replacement ids. The untouched source keeps rollback possible.

## D-030 PIN authentication and sessions

- **Decision**:
  - HMAC-SHA256 lookup key (server secret) plus scrypt verification.
  - Legacy hashes and plain-text PINs are upgraded on first login.
  - Lockout per terminal (5 in 5 min → 60 s) and per address (20 in 15 min → 15 min).
  - Server-side sessions: random tokens, SHA-256 stored, 12 h expiry.
  - No default account: first-run setup refuses guessable PINs, and a networked server requires a one-time setup code from its log.
- **Reason**: A 4-digit PIN is only safe with throttling and keyed hashing. The mission forbids a hard-coded administrator.

## D-031 Dynamic roles from a permission catalogue

- **Decision**:
  - 31 permission keys and six built-in roles, with the old `admin` / `manager` / `cashier` mapped to `super_admin` / `manager` / `cashier` with the same access as before.
  - Custom roles are allowed.
  - Invariants: a last active super admin always remains; no self-demotion or self-disable; no escalation; protected super-admin role.
  - Every operation is checked server-side.
  - `permission_catalog` grants new permissions to built-in roles once.
- **Reason**: Mission §9. Established behaviour preserved (cashiers see no management screens).

## D-032 Receipt templates are data: a block layout

- **Decision**:
  - A template is a list of blocks: logo, store fields, invoice data, customer box, items table, each total, free text, separators.
  - Each block has a zone (top / middle / bottom), an alignment (right / centre / left, or "spread" for label-value rows), a weight and a size.
  - The same template produces the thermal line language (`print_receipt.ps1`) and the A4/PDF HTML, and the preview renders the same lines the printer receives.
  - Version-1 templates convert automatically and print byte for byte as before (golden tests).
- **Reason**: Owner request (2026-10-14): place anything anywhere. Printed output stays the single source of truth.

## D-033 Managed local PostgreSQL for single-till stores

- **Decision**:
  - The installer ships the PostgreSQL 17 server binaries.
  - "This computer only" (`local`) is the default mode: the app creates, starts and stops a private cluster (127.0.0.1, random password, data in `%APPDATA%\HeroMarket`, or an ASCII-only ProgramData folder on non-ASCII profiles) and imports the earlier SQLite database once.
  - Safety: credentials are saved before `initdb`; config writes are atomic with a backup; an existing cluster is never recreated or re-initialised; single-instance lock; development builds use separate data.
- **Reason**: An upgraded one-PC store must keep working with no extra installation or configuration.
- **Cost**: About 85 MB more in the unpacked app.

## D-034 Hero Market everywhere (supersedes D-005)

- **Decision (owner, 2026-10-14)**:
  - The store and product are Hero Market / هيرو ماركت. Package name `heromarket-pos`, app id `com.heromarket.pos`, data folder `%APPDATA%\HeroMarket`.
  - Print templates, docs, README and the GitHub description were updated.
  - The earlier store default name is replaced once after a verified import, with an exact match and a log entry.
  - The only remaining technical references: the pre-PostgreSQL data folder name, which the importer must read to find old installations, and the matching rule for that exact default name.
- **Consequences**: Per-user preferences kept in the old folder's browser storage (theme, sidebar) start fresh. The store's data is imported.

## D-035 Multi-till deployment: Docker server on the LAN, no offline queue yet

- **Decision**: `docker-compose.yml` runs PostgreSQL (unpublished) and the HeroMarket server (non-root, read-only, health-checked). Tills use client mode over HTTP. Checkout is idempotent (`client_ref`), but **no offline sale queue** is implemented.
- **Reason**: Honest scope: LAN or server outages stop client tills, while local mode is unaffected. TLS is left to a reverse proxy (G-24).

## D-036 Reports are printed in the printer's line language

- **Decision**: Shift-close, Momkn and wallet reports are built by `src/shared/reportLines.mjs` and printed through `print-report`. The HTML-to-receipt converter is now used only for legacy sale-receipt HTML.
- **Reason**: K-32: the converter turned every report into an empty sale receipt.

## D-037 Tests on PostgreSQL, never skipped

- **Decision**: `npm test` fails without a database instead of skipping. CI runs the suites on Linux (service container), on Windows (bundled PostgreSQL through `pg_ctl`) and in Docker, and checks the packaged app's contents.
- **Reason**: Mission §16 and §17: green CI must mean the code was tested.

## D-038 Shift-close formulas kept as they were (K-24), pending a decision

- **Decision**: The simple and detailed close dialogs keep their different legacy formulas, now computed server-side and covered by tests.
- **Reason**: Changing cash-drawer accounting is a business decision. The owner must choose one formula.

## D-039 HTTPS for cashier terminals with a pinned store root (G-24)

- **Decision**:
  - The multi-till server publishes only a Caddy TLS proxy (`tls internal`, local root CA in a volume).
  - Each till pins that root certificate in its own configuration. Acceptance requires a chain signed up to the root, in date, with a matching name or IP. Windows-trusted certificates are accepted too.
  - Requests use Chromium's network stack (`session.fetch`) in a dedicated session.
  - `default_sni` covers tills that connect by IP.
- **Rejected**:
  - Installing the root into every till's Windows trust store: it needs admin rights per PC and widens trust machine-wide.
  - Plain HTTP on the LAN: session tokens would be readable on a shared network.
- **Consequences**:
  - One extra file per till at setup.
  - The `caddy_data` volume must be backed up with the database.
  - Plain `http://` remains possible for development or a server on the same PC.

## D-040 Offline selling on cashier terminals: designed, not enabled (G-20)

- **Context**:
  - In client mode a till sells through the store server. When the server or LAN is down, every operation fails with "تعذر الاتصال بخادم HeroMarket" and nothing is recorded. That is safe, but the till stops.
  - Local-mode stores are unaffected.
- **What the current code already guarantees**:
  - Checkout is idempotent: a client-generated `client_ref`, a unique index and an advisory lock mean a retried request returns the stored sale and never records it twice.
  - The service recomputes prices and refuses stale ones.
  - Stock can never go negative (trigger).
- **Analysis: what offline selling would have to decide**

| Question                            | Finding                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which operations could work offline | Cash sales of known products only. Credit and partial-payment sales (customer balances), returns (need the original sale), customer repayments, supplier, expense and till movements, shift open/close and anything in the back office **cannot** be done safely offline: they depend on balances other tills change at the same time. |
| Stale prices                        | The till would sell at its last known price. The service currently **refuses** a checkout whose price differs from the database. Offline replay therefore needs a rule: accept the till's price for sales made offline, and log the difference. That is a pricing policy.                                                              |
| Stale permissions                   | A role change or a disabled account would not reach an offline till. Offline mode would have to be limited to a time window (for example the current shift) and to the user already signed in.                                                                                                                                         |
| Stock conflicts                     | Two tills selling the last unit while one is offline leads to a replay that hits `stock_qty < 0`. Either replays may drive stock negative (a policy change to the inventory rule), or the sale is held in a **conflict queue** for a manager, while the customer already has the goods.                                                |
| Duplicates on reconnect             | Solved by `client_ref`: the outbox replays each sale with its original key, and the server returns the existing sale if it was already stored before the link dropped.                                                                                                                                                                 |
| Reconciliation                      | The outbox must be durable on the till (local file, append-only, fsync) and replayed in order. The till must keep showing "N sales waiting for the server" until every replay is acknowledged. A sale that cannot be replayed (conflict) needs a manager screen.                                                                       |
| Cash drawer                         | Offline cash sales change the drawer; the shift cannot close until the outbox is empty, otherwise the expected-cash figure is wrong.                                                                                                                                                                                                   |

- **Proposed architecture (if the owner wants it)**:
  1. Each till downloads a **price/stock snapshot** at login and on a timer.
  2. When the server is unreachable, the till may sell **cash sales only**, for the signed-in user, within the open shift.
  3. Each sale is written to an **encrypted, append-only outbox** in `%APPDATA%\HeroMarket\outbox` with its `client_ref`, before the receipt prints.
  4. On reconnect the outbox replays in order through a new `pos.checkoutOffline` operation that:
     - accepts the till's prices and records the difference;
     - records `offline=true` and the offline time;
     - on insufficient stock, either allows negative stock (policy A) or parks the sale in `offline_conflicts` (policy B).
  5. Shift close is blocked while the outbox or conflicts are non-empty. A manager screen lists and resolves conflicts.
  6. Tests: duplicate replay, crash during replay, two tills racing for the last unit, outbox corruption, permission revoked while offline.
- **Decision now**: keep the explicit failure. Implementing the design requires three owner policies: offline prices, negative stock or a conflict queue, and the offline time window. A partial implementation without them would risk silent stock or cash discrepancies, which the mission forbids.
- **Mitigations available today**:
  - Run the main till in **local mode** on the server PC: it keeps selling through LAN outages.
  - Put the server and switch on a UPS.
  - Checkout's idempotency already makes "retry after the link comes back" safe.

## D-041 Stock movement ledger, negative stock and moving-average cost (stage 4, phase 1)

- **Decision**:
  - Stock is the sum of immutable `stock_movements`. `products.stock_qty` is a cached total maintained only by a trigger on the movements; a guard trigger refuses any other stock write.
  - Negative stock is allowed (owner decision).
  - Costing is moving average with a defined rule for zero or negative stock: the receipt cost becomes the average and earlier sales are not revalued (STAGE4_ARCHITECTURE_REVIEW.md §7.2).
  - Product-form stock edits and counts post the difference against the stock the user saw (K-37). Purchase invoices can receive item lines into stock (K-38).
- **Rejected**:
  - Keeping `stock_qty` writable with application discipline only: K-37 showed how easily an absolute write slips in.
  - FIFO or standard costing: the owner chose moving average; FIFO needs lot tracking the store does not do.
- **Consequences**:
  - Every stock change is explainable and synchronisable.
  - Migration 0004 is forward-only; rollback means restoring the pre-upgrade backup.
  - Tests must seed stock through movements (`tests/service/helpers.js#seedProducts`).

## D-042 Single-PC deployment: one writer, row-change outbox, owner command queue (stage 4)

- **Context**: The owner chose one cashier PC and an owner-only cloud. Revision 1 of the stage 4 review assumed two peers merging business events.
- **Decision**:
  - The PC is the only writer of store data.
  - Store → cloud: triggers capture row changes into a transactional outbox with a store-wide row version. The cloud applies versioned idempotent upserts. Rows are acknowledged after the cloud commits, and per-table checksums are compared after each sync.
  - Cloud → store: the owner's operations are commands with base values. The PC applies each exactly once (`applied_commands`), detects same-field conflicts at apply time, and reports results back through the outbox.
  - A restored backup starts a new epoch and first recovers its own newer rows from the cloud.
- **Rejected**:
  - Two-way business-event merge (unnecessary with one writer).
  - Database-level two-way replication (row overwrites).
  - Cloud-authoritative designs (the store would depend on the internet).
- **Consequences**:
  - No global ids are needed; invoice numbers stay as they are.
  - Remote writes are limited to supplier invoices, stock receipts, product edits and price edits.
  - Anything involving drawer cash, sales, returns, shifts or counts stays local.

## D-043 Cloud hosting recommendation: Google Cloud free-tier e2-micro, Hetzner fallback (pending owner approval)

- **Context**:
  - The owner treats cost as a hard constraint and wants no silent stops.
  - Free tiers that sleep, pause, expire or reclaim idle machines (Oracle Always Free, Supabase, Neon, Render) can stop synchronisation silently, so they are rejected.
- **Decision**:
  - Recommend one Google Cloud free-tier e2-micro VM running the service and PostgreSQL: expected cost 0 USD, possibly about 3.65 USD/month for its IPv4 address; to be confirmed in billing.
  - Fall back to the cheapest paid VPS, about 4–6 EUR/month.
  - The cloud must be rebuildable from the PC.
- **Status**:
  - Official-source cost estimate in [HOSTING_COST_ESTIMATE.md](HOSTING_COST_ESTIMATE.md) (2026-10-15): about $4.2–4.5/month including 14 % VAT (IPv4 $0.005/h is the main cost); Hetzner CX23 €5.99–7.09/month excl. VAT.
  - Nothing created.
  - The owner must approve, and must create the billing account with their own card.

## D-044 Discounts: administrator rules applied automatically; no operator discounts (owner, 2026-10-15)

- **Context**:
  - The till accepted a manual invoice discount from anyone with `pos.discount`, and the cashier role had it.
  - The owner decided that cashiers have **no** discount authority: the administrator defines rules in advance, and checkout applies them automatically and identically whoever operates the till.
- **Decision**:
  - Manual discounts are refused for every operator (403). The `pos.discount` permission is removed. `discounts.manage` goes to the super and store administrators only.
  - Rules (`discount_rules`) are of two kinds:
    - **product**: a percentage, or an amount per base unit (per piece or per kg);
    - **cart**: a percentage or a fixed amount when the total reaches a threshold.

    Each rule has an optional start and end time and can be active or inactive. Rules are never deleted.

  - Evaluation is server-side only (`pricing/discounts.js`):
    1. line gross = quantity × price, rounded to 0.01;
    2. the best product rule per line (no stacking), capped at the line;
    3. cart thresholds compared with the total **after** product discounts, **inclusive** (EGP 500.00 qualifies for a 500 tier, 499.99 does not);
    4. the best single cart rule (tiers do not stack);
    5. ties go to the larger discount, then the older rule;
    6. the cart discount is allocated to lines by largest remainder in whole piastres.
  - **Till and checkout:**
    - The till shows the service's preview (`pos.price`) and sends the total it showed. Checkout recomputes it and refuses a different total (409), so the customer never pays an amount they were not shown.
    - Each invoice keeps the line shares (`line_discount`, `cart_discount`) and the applied rules by name and value (`sale_discounts`). Price or rule changes never alter history.
  - **Returns** of rule-priced sales refund the drop in the line's net. Successive partial returns add up exactly to what was paid.
  - **Reports** use line net (gross − shares) for revenue and profit.
  - Every rule creation, change, activation and deactivation is audited with before/after values. Stale edits are refused (version check).
- **Rejected**:
  - Role discount limits with supervisor approval: superseded by the owner's decision.
  - Stacking several product or cart rules: it is hard to predict and to audit.
  - Thresholds before product discounts: a customer would get a cart discount on money they did not pay.
- **Optional promotion types, not implemented** (recommendations only):
  - buy X get Y;
  - a bundle price;
  - category-wide percentages;
  - time-of-day offers;
  - customer-specific prices;
  - loyalty-point redemption.

  Category-wide discounts would need product categories as data; today the category is free text.

- **Consequences**:
  - Migration 0006 marks old invoices `pricing_version = 1`, and their return formula is unchanged except for K-40.
  - Old invoices keep their single invoice-level discount, with zero line shares, so their report figures are unchanged.

## D-045 Customers have at most two phone numbers (owner, 2026-10-15)

- **Decision**: a second nullable column `clients.phone2` (migration 0007), not a separate phone table.
  - The limit is part of the schema itself.
  - Searches, receipts, backups and synchronisation keep one row per customer.
- **Database rules**:
  - a second number needs a first;
  - the two numbers must differ;
  - a trigger keeps every number unique across both columns of all customers.
- **Validation**: one shared rule (`src/shared/phone.mjs`) used by the service and the screens.
  - Arabic-Indic digits, spaces, dashes and brackets are accepted and cleaned.
  - "+" or "00" mark an international number.
  - 7–15 digits; an Egyptian mobile written locally (01…) must be exactly 11 digits.
- **API**: `clients.create` and `clients.update` take `phones` (at most 2, schema-enforced). The old single `phone` field still works.
- **Existing records** are kept as they are. Numbers are cleaned when a customer is next saved. Duplicate checks compare digits, so "0100 123 4567" equals "01001234567" (this also fixes the earlier mismatch, where the check compared digits but stored the raw text).
- **Till**: a number typed at checkout is validated the same way and matches a customer by either number.

## D-046 Staff passwords and supervisor approvals (stage 4 phase 3, owner decisions 2026-10-14)

**Sign-in**

- Users sign in with **username + password**; the username ignores case. A PIN no longer identifies a user.
- **Moving existing users (no forced reset day).** Migration 0008 changes no existing value.
  - Each user's next sign-in takes their username + current PIN. That is accepted exactly once: the user must choose a password before any session is issued.
  - Choosing the password erases the PIN (`pin_lookup`, `pin_hash`, legacy `password_hash`).
  - Users not yet moved keep working until they sign in once.
- **Passwords**:
  - 8–128 characters with letters and digits; not a common password; must not contain the username (3+ letters).
  - Stored as scrypt, like the PINs were.
  - The service is the authority; the screens only show early hints.
- **Temporary passwords.** New accounts, administrator resets and the local reset command give a temporary password (shown once). It must be replaced at the next sign-in, and the user's sessions end.
- **Recovery code.**
  - A super administrator receives a one-time code (4 × 5 characters, no look-alike letters) at setup or when choosing a first password. It is shown once and stored only as a scrypt hash.
  - `auth.recover` sets a new password with it and issues a new code.
  - A signed-in super administrator can replace a lost code with their current password.
- **Local reset**, for someone at the store PC when no administrator can sign in:
  - command: `"HeroMarket-POS.exe" --reset-password=<username>` (or `node src/server/cli.js reset-password <username>` on a server);
  - it gives a temporary password and writes the event log;
  - it never re-enables a disabled account.
  - Physical access to the PC is the boundary, as before (the database files are on that PC anyway).
- **Lockouts and sessions are unchanged** (5 per terminal, 20 per address). They also apply to recovery codes, password changes and supervisor approvals.

**Approvals**

- The approval travels **with the action** (`approver: { username, password, decision }`). The service checks the supervisor and performs the action in one transaction, so an approval cannot be reused for another action, amount or invoice.
  - The old free-standing `auth.verifyApprover` (PIN) and the unused cart-approval dialog are removed. Cart edits never need approval (K-10).
- **Returns.**
  - New permission `sales.return_request`: cashiers by default, granted once to the built-in cashier role on upgrade.
  - A cashier can open an invoice by number and return one line or the whole invoice. A reason (3+ characters) and a supervisor holding `sales.return` and `pos.approve` are required.
  - Users with `sales.return` return directly, and their reason is optional.
  - Every return is recorded in `sale_returns` (who, reason, refund, approval, shift).
- **Shift difference.**
  - Closing with |actual − expected| **above** EGP 50.00 needs a supervisor (`pos.approve`). Exactly 50.00 does not.
  - A supervisor closing their own shift acknowledges it themselves, recorded with `self_approved`.
  - The shift links its approval (`shifts.difference_approval_id`). The note is optional.
- **Recording.**
  - `approvals` keeps every decision:
    - **approved** – written with the action, so it exists only if the action happened;
    - **refused** – the supervisor signed in and pressed "رفض";
    - **failed** – wrong credentials, no authority, the requester approving themselves, or a supervisor who still has to choose a password.
  - Refused and failed rows are written on a separate connection, so they survive the rollback. They are also written to the event log.
  - A refused or failed approval changes nothing else (tested on stock, money, invoice, customer balance and returns).
- **Discounts need no approval** (D-044 withdrew discount authority from cashiers entirely).

## D-047 Synchronisation engine: outbox, versioned JSON rows in the cloud, epochs, exactly-once commands (stage 4 phase 4)

- **Context:** D-042 fixed the model (one writer, row-change outbox, owner command queue). This records how it is built and what the proof suite showed. See [SYNC_DESIGN_AND_PROOF.md](SYNC_DESIGN_AND_PROOF.md).
- **PC (migration 0009, changes no existing data):**
  - A trigger on each synchronised table writes `sync_outbox` and `sync_row_versions` in the change's own transaction, with versions from one store-wide sequence. Administrative bulk work can switch capture off (`hm.sync_capture`); restore does so.
  - Users are sent through an **allow-list** (id, username, role, active state, dates). Sessions, role permissions, receipt templates, migrations and sync bookkeeping are not sent.
  - `applied_commands` holds the command id, outcome and detail. It is written in the command's transaction and synchronised back.
  - Existing rows are queued once, when the store first registers (`hm_sync_snapshot`).
- **Cloud (own database and schema, `src/server/cloud`):**
  - Rows are stored as **versioned JSON** (`cloud_rows`), not as copies of the store tables. Rows may then arrive in any order without foreign keys failing.
  - A row is replaced only by a strictly newer (epoch, version).
  - One transaction per batch; the answer comes after the commit.
  - Changes are accepted only for the store's current epoch.
  - Phase 5 builds the owner's read screens on views over these rows.
- **Transport:**
  - Only the PC connects (HTTPS).
  - The store is identified by a device token, stored hashed.
  - Rows travel as PostgreSQL JSON **text**, so numeric scale and digits are exact.
- **Commands:**
  - Types: supplier invoice (paid only outside the drawer), stock receipt, product edit and price edit, each with base values.
  - A business refusal rolls back the command's own writes (savepoint) and records **rejected** once.
  - A database failure rolls back everything; the command stays pending.
  - Outcomes: applied, partially applied (some fields in conflict) and rejected. All are audited on the PC as "المالك (عن بعد)" with the command id.
- **Restore:** the restore turns capture off, clears the outbox, and sets the epoch to "none". The next sync takes a new epoch and sends everything once, and the old copy is refused. Writing back rows that reached the cloud after the backup is PR #15.
- **Robustness fix found by the suite:** every pooled PostgreSQL connection now has an error listener. Previously a connection dropped while in use (a PostgreSQL restart) raised an uncaught exception that would have stopped the app.
- **Rejected:**
  - copying the store tables one-to-one into the cloud (out-of-order rows break foreign keys);
  - a high-water-mark cursor (it skips late commits);
  - sending parsed JSON (it loses numeric precision).

## D-048 Recovery after a restore pauses work; batches never split a local transaction (stage 4 phase 4)

- **Context:** a restored backup lacks what happened after it. Part of that already reached the cloud and can come back. If the shop sells before it comes back, new sales reuse invoice numbers that the cloud already holds for the lost sales.
- **Decision:**
  - A backup records its sync point (store, epoch, version).
  - Restoring a backup on a **linked** store sets `recovery_pending`. The service then refuses every operation except sign-in, `sync.*`, `backup.*` and `settings.public`, with 423 "recovery_pending", and the screens explain why.
  - The administrator recovers or skips:
    - **Recover** (`sync.recover`) writes back every row and deletion newer than the point, in one transaction, in foreign-key order, with triggers paused. Users and roles use the allow-list (no password data). Sequences continue after the recovered ids, and stock is re-checked against movements. The next cycle then takes a new epoch.
    - **Skip** (`sync.skipRecovery`, confirm "SKIP") is logged and deletes nothing in the cloud.
  - A backup of another store is refused.
  - An unlinked store never pauses.
  - Outbox rows record their transaction (`tx_id`), and batches are cut only at transaction boundaries. Only a bulk transaction larger than 4,000 rows is split.
- **Link settings:**
  - Stored in `sync_state` (URL, store id, device token, enabled), which is not in backups and never synchronised.
  - Administrators only (`sync.manage`); HTTPS only, except for localhost.
  - The token is never returned or logged.
  - Changing the store after synchronising needs an explicit relink.
- **Rejected:**
  - selling during recovery with large id gaps (invoice numbers would jump by millions);
  - merging both sides after the fact (ambiguous and error-prone).

## D-049 Integrity and security fixes from the 1.4.0 audit (before merging PRs #1–#15)

- **A closed shift is final** (migration 0011).
  - Sales, drawer rows, expenses and till movements lock their shift and require it open, for every insert, update and delete.
  - Closing locks the shift before computing its figures.
  - Before, a sale committing during a close could land on the closed shift, and deleting an expense of a closed shift changed its totals.
  - Bulk administrative work (restore, legacy import, cloud recovery, system reset) is exempt through `hm.bulk_load` / `hm.ledger_rebuild`.
- **One open shift per user**, also for simultaneous requests (advisory lock in the trigger).
- **Refunds go through the customer's account first.** Each invoice keeps what it left on the customer's account (`on_account_open`) and the store balance it consumed (`credit_open`). A return reduces those first; only the rest is cash from an open drawer.
  - Before, a part-paid invoice was refunded entirely in cash, including the unpaid part.
  - Before, balance spent on an invoice came back as cash.
  - Before, a whole-invoice return of a balance-paid invoice returned nothing.
  - Cash and credit (آجل) invoices refund exactly as before.
  - A cash refund now needs an open shift (the actor's, or the invoice's own while still open), instead of posting into a closed shift.
- **The till matches a typed customer by phone** (either number). Without a phone, it matches by name only when the name is unique; otherwise it asks the cashier to choose. Before, "name OR phone" could put a credit sale on another person with the same name.
- **A supplier with a balance cannot be deleted** (as for customers).
- **Printing never goes through a command shell:** PowerShell and Typst are started with argument lists. Printer names reject quotes and shell characters, and product names enter Typst as string literals.
- **Electron:** the renderer is sandboxed, and only the named `window.api` bridge is exposed (the generic `ipcRenderer` bridge of @electron-toolkit is removed).
- **Access before validation:** sign-in and permissions are checked before the request body is validated, so a caller without access receives 401/403 and no schema details. Credentials are redacted from logs.
- **Remote stock receipts** follow the shop's quantity rules (whole pieces for count products).
- **Tests:** `tests/service/integrity.test.js` (10), including real concurrency (a sale and a drawer row waiting on a close; four simultaneous shift openings).
