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

## D-050 Customer addresses: up to three, reused at the till (1.4.0, migration 0012)

- **Model:** a customer has zero to three addresses in `client_addresses` (label home/work/other, address 1–300 characters, details up to 200, exactly one default when any exist).
  - The limit is enforced in the service and by a database trigger that locks the customer row, so two simultaneous saves cannot create a fourth.
  - The old single `clients.address` becomes the default address; nothing is invented or dropped.
  - Older screens that still send `address` replace only the default address.
- **At the till (owner's request):** for a known customer, the cashier picks one of the saved phones and one of the saved addresses from lists instead of typing them again ("رقم آخر…" / "عنوان آخر…" for a new one).
  - A new phone typed for a known customer is saved in a free slot (at most two phones, D-045) when no other customer has it.
  - A new address is saved when the customer has fewer than three and it is not a duplicate.
  - When there is no room, the order still uses what was typed; nothing is overwritten.
- **Invoice:** a delivery invoice keeps a snapshot of the address used (`sales.delivery_address`), so later edits of the customer do not change old invoices.
- **Rejected:** unlimited addresses (the owner asked for three); free-text "other" labels (they make the till list harder to read).

## D-051 Product categories and browsing at the till (1.4.0, migration 0013)

- **Model:** `categories` (unique name ignoring case and spaces, sort order, active flag). Each product has at most one category (`products.category_id`, deletion restricted) and its own active flag.
  - The existing free-text categories were converted; nothing was invented.
  - Only an empty category can be deleted. Otherwise it is stopped, and its products then appear under "بدون تصنيف" at the till, so nothing becomes impossible to sell.
  - A stopped product is refused by search, browsing, `pos.resolve` and checkout.
- **Products without a category** are always listed at the till as "بدون تصنيف" (last in the list). A product saved without a category belongs there automatically; nothing has to be assigned.
- **Browsing (F6 or "تصفح"):** a vertical list of categories beside the products, over the scan and cart column.
  - The cart, the totals and the pay button stay as they are, and the scanner keeps working.
  - Escape returns to the invoice and never clears the cart while the panel is open.
  - ↑/↓ move between categories.
  - A browsed product is added through the same path as a scan, so current prices, units, weighing and automatic discounts apply. Cashiers still cannot change discounts.
- **Cache:** the till keeps categories and the first pages it has opened (at most 40 categories). Freshness comes from `catalog_state.version`, bumped by triggers on names, prices, units, categories and active flags (not stock); it is checked at most every 30 seconds. Correctness never depends on the cache, because the server re-prices at checkout.
- **Permissions:** `categories.manage` (inventory and management roles) to edit; cashiers only read through `pos.*`.

## D-052 Per-machine installation, shared store folder and program hardening (1.4.0)

> **Partly superseded by D-053:** the database now runs as a Windows service with its own account. The shared-folder permissions, the "accepted risk" and the two-account database lifetime below no longer apply.

- **Install for all users:** the installer is per-machine (`C:\Program Files\HeroMarket-POS`, one administrator prompt). The store's data moved to `%ProgramData%\HeroMarket`.
  - On first creation, the local Users group is given modify rights, inherited by the database files.
  - Every Windows account on the cashier PC therefore opens the same shop.
  - Each person still signs in to HeroMarket with their own account.
- **Upgrade from a per-user installation:** the installer removes the installing user's old per-user copy (keeping its data). On first start, 1.4.0 copies that user's store into the shared folder and checks every file (`copyAndVerify`, the same check as the pre-upgrade snapshot).
  - The old database folder is left as it was; its settings file is renamed so the move happens once.
  - If the shared folder already holds a database, nothing is moved and the screen says so.
- **Two Windows accounts signed in together:** the second session finds the database already running (same folder, same port) and uses it. Only the session that started it stops it.
- **Accepted risk:** every Windows user of the PC can read `heromarket.json` (database password, server secret), because every one of them must be able to start the database. The guide tells the owner to give Windows accounts on the till only to trusted people.
- **Hardening (Electron fuses):** the packaged program cannot be used as a Node.js runtime and ignores `NODE_OPTIONS` and debugging switches. It loads only its own `app.asar` and checks that file's header at start.
  - Verified on the QA build: `ELECTRON_RUN_AS_NODE=1` has no effect, and a modified header is refused before the database starts.
  - Changes inside file contents are not caught at start. The protection for those is the administrator-only Program Files folder (and, later, code signing).
- **Rejected:** keeping per-user installs (a second Windows account would see an empty shop); a Windows service for PostgreSQL (needs an administrator for every change and survives uninstall).

## D-053 The store's database runs as a Windows service with its own account (1.4.0, security review option C)

- **Why:** with D-052's shared folder, any standard Windows user of the till PC could read the database superuser password and write the database files. Through the database, they could run Windows commands as the account that had started HeroMarket. This was verified in Windows Sandbox. See [SECURITY_REVIEW_LOCAL_DATABASE.md](SECURITY_REVIEW_LOCAL_DATABASE.md). The owner chose option C before release.
- **Service:** the installer, which runs as administrator, calls `HeroMarket-POS.exe --setup-service` (`src/main/serviceSetup.js`). That step registers **HeroMarketDB** (QA edition: HeroMarketDB-QA):
  - PostgreSQL runs under the virtual account `NT SERVICE\HeroMarketDB`, starts automatically, and listens on 127.0.0.1 only;
  - it restarts on failure;
  - Windows users may start the service but not stop, change or delete it.
- **Folders:**
  - `pgdata`: SYSTEM, Administrators and the service account only.
  - `admin\superuser.json`: Administrators only.
  - `heromarket.json`: users may read it, only administrators may change it.
  - `logs` and `backups`: users may write.
  - The 1.4.0 rule that gave every user modify rights on the whole folder is removed.
- **Roles:**
  - The app connects as `hm_app`. It owns the shop's objects but has no superuser, create-role, create-database or replication rights (`src/server/db/appRole.js`).
  - Proven by `tests/service/appRole.test.js`: migrations from scratch, sales, backup and restore, the 1.3 import; Windows commands, server files, server settings and role creation are refused.
  - New databases get the bootstrap superuser `hm_admin`.
  - An older database, created by the app as superuser `heromarket`, is handed over to `hm_app` object by object. `heromarket` then gets a new password that only administrators can read.
- **Lifetime:** the database no longer depends on who is signed in to Windows. This fixes three D-052 problems: signing out ended the database for other accounts, it ran on after everyone closed HeroMarket, and the upgrade copy stopped it for everyone.
- **Upgrades:** the installer takes the verified copy of the database (`backups\pre-install`) before re-registering the service. The app refuses to migrate when the setup did not complete for its version (`local.setupVersion`).
- **Residual risk (accepted for 1.4.0):** a Windows user with technical skill can change shop data with SQL as `hm_app`. Running the HeroMarket service itself as a Windows service (option D) would close this.
- **Rejected:**
  - restricting file permissions without a service (impossible while PostgreSQL runs as whichever user opens HeroMarket);
  - going back to per-user installs (breaks the all-users requirement).

## D-054 Who must open a shift (1.4.0, owner decision)

- **Rule:**
  - The owner (super administrator) is never required to open a shift. He signs in and uses everything without one.
  - Setting `shift_required_roles` lists the ids of the roles that must open one. Roles created in the roles screen have no key, so ids are used. `null`, the default, means every role with `shifts.operate`: the behaviour before 1.4.0.
  - Sign-in replies carry `shiftRequired` (`src/server/auth/shiftRule.js`). The till then shows the open-shift window, and it cannot be closed.
- **Cash without a shift:**
  - Unchanged on the service: a sale, cash expense, cash supplier payment, cash customer payment or cash refund needs the user's own open shift (the drawer ledger needs one).
  - Those refusals now carry the code `shift_required`. The till then offers the open-shift window, with the reason and a "لاحقاً" button. A sale is completed automatically once the shift is open.
- **Limit:** the "must open a shift" rule is enforced by the till, as before 1.4.0. The service does not refuse other work from a required user without a shift. Making it refuse would need a list of every operation that counts as "using the system", and was not asked for.
- **Rejected:** a single on/off switch for everyone. The owner asked to choose per role.

## D-055 Measurement kinds the owner adds (1.4.0, migration 0014)

- **Why:** the owner wants more than بالعدد, بالوزن and بالحجم, for example بالمتر.
- **Model:**
  - Table `measure_kinds` holds a key, name, unit, decimals (0–3), whether it is built-in, whether it is active, and the order.
  - `products.unit_kind` references it. It replaces the fixed list (0005's CHECK).
  - The table is synced and backed up like the catalogue.
- **Rules:**
  - A product's base quantities follow its kind's decimals in every place stock is counted: sales, purchases, returns, damaged goods, receipts from the cloud, opening and adjusted stock, and packaging factors (`kindRule`, `src/server/inventory/units.js`).
  - The built-in kinds keep their rules and messages.
  - Weighing (scale labels, the grams window) stays specific to `weight`. Other kinds with decimals get a plain quantity window in their unit.
- **Protection:**
  - Built-in kinds cannot be changed.
  - A kind's decimals can only be raised while products use it.
  - A kind in use is stopped, not deleted. A stopped kind is not offered for new products; products that have it keep it.
  - Switching a product to fewer decimals needs its stock and factors to fit.
- **Version:** in 1.4.0 at the owner's request. It makes the 1.4.0 update from earlier 1.4.0 builds Case B; the installer's checks apply.

## D-056 Store data import from an Excel template (1.4.0)

- **Why:** the supermarket runs another company's POS. The owner will fill a template with his products, customers and suppliers, and HeroMarket must import it ready to sell.
- **Template:** `templateSheets()` (`src/shared/storeImport.mjs`), also downloadable from the import screen.
  - An instructions sheet, then الأصناف, العملاء and الموردون, laid out right to left.
  - Barcode and phone columns are text.
  - Headers are matched loosely, so a sheet pasted from another program works if its header names match.
- **Checks:** `storeImport.apply` checks every row again and writes nothing if any row fails.
  - It needs `products.manage`, `customers.manage` and `suppliers.manage`.
  - It checks required fields, numbers, the measurement kind (by name, unit or common words, or from the unit) and its decimals, phone rules, duplicates in the file, and barcodes and phones already in the store.
  - `dryRun` checks only.
- **Writing:** one transaction.
  - Products are written with stock 0, then an `opening` movement (`ref_type` import), so stock equals its movements.
  - Categories are matched by name or created.
  - Customers get `debt_balance` plus a ledger line `opening` "رصيد افتتاحي (استيراد)"; suppliers the same.
  - A product without a barcode gets `HM` + 6 digits.
  - One audit entry records the counts.
- **Not done, on purpose:** updating existing products or customers from a file. Prices change through the product screens. A barcode or phone already in the store is reported instead.
- **Libraries:** `read-excel-file` 9.3.10 and `write-excel-file` 4.1.1 (MIT). They are pinned dev dependencies, bundled into the screens, and add no audit findings.

## D-058 Passwords accept any characters (owner feedback USER-01, 2026-10-21)

- **Why:** "letters and digits together" (D-046) refused normal passwords that use only letters, only digits, or symbols.
- **Rule now:**
  - 8–128 characters of any kind;
  - at least 4 different characters;
  - not a plain run (abcdefgh, 87654321);
  - not on the common-password list;
  - not containing the username;
  - no leading or trailing space.
- This follows NIST SP 800-63B: no composition rules; refuse guessable passwords instead.
- **Unchanged:** scrypt hashes; no normalisation (the stored password is compared exactly); temporary passwords and recovery codes.
- **Existing accounts:** no change; their passwords keep working.

## D-057 Manual fixed invoice discount for authorised users (owner decision 2026-10-21, DISC-01)

- **Decision:** approved by the owner; supersedes D-044's "no operator discounts" **for holders of the new permission only**.
  - Permission `pos.manual_discount` ("خصم يدوي على الفاتورة").
  - By default only `super_admin` and `store_admin` hold it. It is not in the manager defaults and is never given to cashiers automatically; the owner assigns it to roles.
- **Use:** a fixed EGP amount off the current sale invoice, with a reason (3–200 characters). Example: a yogurt pack whose EGP 2 promotion was missed at receiving. It never changes the product's price or stock.
- **Pricing (`pricing/discounts.js` rule 6):**
  - It applies after the automatic rules, on the total after them, and must not exceed it; amounts are in whole piastres.
  - It is spread over the lines by largest remainder and kept in each line's `cart_discount` share. So line nets, returns (refund = drop in the line's net) and profit need no new formula.
  - Customer credit applies after it.
- **Enforcement:**
  - `pos.price` and `pos.checkout` check the permission on the server. A refusal is 403 and written to the activity log (`manual_discount_refused`).
  - The old free `discount` field stays refused for everyone.
- **Records (migration 0015, schema only):**
  - `sales.manual_discount` holds the invoice's total; `sale_discounts` keeps a `manual` row with the amount, reason, user and time; there is one activity-log entry per discount.
  - These records feed invoice details (`sales.detail`, reprint data), the shift figures (`shifts.liveSummary.manualDiscounts`: count, total, invoices with user and amount), and the shift-close report section "الخصومات اليدوية".
- **Data lifecycle:**
  - The columns are in tables already backed up; tested by a backup → restore round trip.
  - Sales are not part of the import/export template, so neither is affected.

## D-059 Owner answers for the money and data phases (2026-10-21)

- **Expense visibility (EXP-01):** a user without "all expenses" sees only the expenses they created, in any of their shifts. Never another user's, never the owner's. Enforced in the service queries.
- **Treasury below zero (CASH-01 / TREAS-01):** allowed. Shown clearly as negative (red), and every movement is logged.
- **Supplier invoice notice (SUP-01):** its amount is what the cashier says was paid to the supplier. It is information only: no money, stock, price or balance changes.
- **Scheduled backup retention (BACKUP-01):** 14 daily copies plus 8 weekly copies. Enabling the schedule waits for the measured impact on checkout (Q6).

## D-060 Owner answers: scale format, midnight backup, cheques, version, supplier discount (2026-10-21)

- **Scale labels (SCALE-01, Q4):** every label has one layout. Product code = the first 7 digits (`2000001`). Weight = the next 5 digits in grams (`00125` = 0.125 kg). Last digit = EAN-13 check digit, validated. The physical scan at the shop stays a hardware check (HW-01).
- **Midnight backup (BACKUP-01, Q6):** approved without further confirmation, and replaces the "waits for measurement" note in D-059.
  - It runs every day at 00:00 local time, with no UI, even when nobody is signed in.
  - After a missed midnight, it runs one catch-up backup.
  - Copies go to `%ProgramData%\HeroMarket\backups`, timestamped and named daily or weekly. Retention is 14 daily + 8 weekly.
  - Each new copy is verified before pruning. The only good copy is never deleted, and a good copy is never overwritten.
  - It must not block checkout: the impact is measured, and a lower-impact method is used where needed.
- **Cheques (NAV-02, Q7):** removed from navigation and workflows. Historical records are kept; deleting a record or dropping a table needs a separate approval. Any archive view is for authorised administrators only. Cheque processing is not reintroduced.
- **Version (Q8):** this work ships as 1.5.0, and 1.4.0 is not published first. Merging, tagging, publishing and deploying each still need explicit approval.
- **Supplier invoice discount (SUP-02, Q9):** spread over the lines in proportion to their pre-discount values. Rounding is largest remainder in whole piastres, so the shares sum exactly to the discount.

## D-061 Payment methods: Cash, Visa, Wallet, InstaPay (2026-10-21)

- **Owner note:** the only payment methods are Cash, Visa, Wallet and InstaPay.
- **Mapping:**
  - فودافون كاش becomes Wallet (محفظة).
  - Visa is added.
  - Stored sales are not rewritten; reports group them by method.
- **Interpretation, pending the owner's confirmation:**
  - On account (آجل) and partial payment are not methods. They are an unpaid balance on the customer's account.
  - They stay, so existing credit sales and debts are not broken.

## D-062 Money model: treasury, payment methods, blind close (2026-10-21)

- **Owner rules applied:** CASH-01, PAY-01 and D-059. This closes D-038, the shift-close formula. The formulas are in `FINANCIAL_RECONCILIATION.md`.
- **Treasury:** a cash-only, immutable ledger.
  - The opening float leaves it and the counted cash at close returns to it, each exactly once.
  - Corrections are reversals or adjustments with a reason.
  - It starts at 0 after the update; the owner records the counted treasury once.
- **Methods:** cash, Visa, wallet and InstaPay each have their own expected, counted and variance figures at close.
  - Variance = actual − expected: below zero is a shortage (عجز), above zero a surplus (زيادة).
  - The 50 EGP acknowledgement applies to cash only.
- **Blind close:** expected amounts are refused by the service to users without `shifts.view_expected` (administrators only) until the close is saved. The supervisor request carries no amounts, and refused attempts are logged.
- **Expenses and debt payments:** they go to the user's shift or, for treasury managers, the treasury. When both are possible the user must choose; the service never guesses. Expenses are visible to their creator, and to administrators with `expenses.view_all`.
- **Payment method correction:** only while the sale's shift is open, never for a sale with a return. It's recorded in `sale_payment_corrections`.

## D-063 Owner notes after phase D (2026-10-21)

- **Payment methods only:** the store uses cash, Visa, wallet and InstaPay only. The Momkn machine and the wallet-service tills are removed from every screen and from the shift report; their old records are kept.
- **الورديات:** the page follows the owner's screenshots: a list with filters, and a full details page per shift.
- **Barcodes:** a product's barcode can be changed. Its whole history follows it.
- **No reasons asked:** the manual invoice discount needs no reason (this replaces the reason rule of D-057), and neither does a payment method correction.

## D-064 Owner decisions: preliminary supplier invoices, per-method treasury, receivables, close (2026-10-21)

- **Preliminary supplier invoice (replaces the "information only" notice of D-059 / SUP-01).**
  - A cashier records a supplier, a total, a payment mode (cash, credit, partial), the amount paid now and its payment method.
  - The payment is real and recorded once in the current shift (or, for treasury managers, the treasury). The rest becomes a supplier payable.
  - Nothing reaches stock or cost until an administrator converts it into a detailed purchase. That conversion moves stock and the moving average and records no payment again.
- **Final total ≠ preliminary total.** The detailed invoice is the true debt: the payable is adjusted by (final − preliminary), recorded as an explicit "تسوية فاتورة مبدئية" supplier ledger row. If more was paid than the final total, the supplier owes the store (a credit balance, as with customers).
- **Per-method treasury.** The treasury is a ledger of the business's funds by method: cash, Visa, wallet and InstaPay, plus the overall total.
  - At close, each method's **counted** amount goes to its own treasury balance (one row per method, once).
  - The opening float is cash.
  - Treasury expenses and debt payments state their method.
- **Close (owner, 2026-10-21).**
  - The cashier enters the four counted amounts. The total is calculated from them.
  - The difference is shown per method and overall, in the shift details page and the closing report. Nothing is charged to cash by default.
  - The total-only handover proposal is withdrawn.
- **Receivables.**
  - On account and partial sales stay.
  - The part paid at once on a partial sale is recorded with its own payment method.
  - Later collections reduce the customer's balance and appear in the collecting shift as collections, never as sales. Each request is recorded once.

## D-065 Owner requests of 2026-10-21 (evening)

- **Cancelling a preliminary supplier invoice (owner's answer).** A cashier may cancel their own preliminary invoice entered by mistake; an administrator may cancel any. The invoice is never deleted: it becomes "ملغاة", with who, when and how.
  - Cancelling reverses the payable it created.
  - **If money was paid:** the user says whether the supplier returned it.
    - Returned: the return is a real money movement in the current shift (or the treasury) by its method, and the original payment stays in its shift's history.
    - Not returned: nothing is added to cash or electronic balances. The amount becomes the supplier's debt to the store (a credit on the supplier's account).
  - **A converted invoice cannot be cancelled here.** Its stock and cost need a purchase return, which is not built yet; the user is told so. A cancelled invoice cannot be converted. Cancelling is atomic and happens once.
- **Payment method correction (owner's answer).** No reason is asked, as decided before (D-063). The correction is now also allowed after the sale's shift is closed:
  - the sale's method is reclassified and recorded (who, when, from, to, after close);
  - no money moves and the closed shift's saved close is not rewritten, because the treasury already holds the counted amounts;
  - the correction is listed with that shift.
- **Hotkeys:** F1 prints, as before (confirm and print). F2 confirms without printing. F7 opens the product search.
- **Dashboard:** period selector (today, this week, this month, this year, custom range) with cards and charts. The quick actions stay.
- **Packaging (Parts 9–10).** Already in place since 1.4.0: units with a factor, their own barcode and price, and the factor kept on every sale and purchase line (INV-01, D-055).
  - Added now: a package purchase price entered by the owner; a package selling price required for a sellable package (no derived price); stock shown as complete packages and loose units (floor); acceptance tests for the HoHos example.
- **Keyboard (Part 2), one shared behaviour for every window and list** (`lib/modalChrome.js`, `lib/keyboard.js`):
  - **Windows:**
    - a window that opens takes the focus: its first field, else its cancel button, never a confirm button;
    - Tab and Shift+Tab stay inside the top window;
    - Esc closes it the way its cancel button does, asking "إغلاق بدون حفظ؟" if something was typed. A window or list that uses Esc itself keeps it. Windows without a cancel (a required shift opening) do not close;
    - on closing, the focus goes back to the control that opened it.
  - **No action from a stray Enter:**
    - in the 13 forms that move money or stock (close, cancel, preliminary invoice, payment correction, returns, purchase, expense, treasury, debt payments, damaged goods), Enter in a field goes to the next field, and from the last field to the confirm button;
    - only Enter on that button carries the action out;
    - a confirm that deletes, cancels or returns starts on إلغاء.
  - **Lists:** clickable rows (invoices, customers, suppliers, cashiers) are reached by Tab, open with Enter or Space, and ↑ ↓ move between rows. The dashboard's period tabs move with ← →. A visible focus ring is on every row and control.
  - **The till's Esc:** Esc in the product search clears it and goes back to the barcode field. It no longer also asks to clear the invoice (a bug found in the running app).
- **Invoice numbers (Part 3):**
  - on the shift details they are buttons: a click or Enter opens the invoice in الفواتير والمرتجعات;
  - identifiers in tables are isolated left to right (`.ltr-id`), so "INV-39" and "#12" no longer flip or misalign in right-to-left cells.
- **Stat cards:** a long amount is shown smaller until it fits its card, measured at any window width, instead of being cut to "12,350.26 …".

## D-066 Purchase invoice discount and purchase returns (owner, 2026-10-22, migration 0020)

- **Invoice discount (SUP-02, revised by the owner).** An optional amount on the whole invoice, zero by default.
  - The supplier is owed the net: lines − discount. The payable, payments, purchase totals and the audit use the net, once.
  - Never allocated to lines. Product purchase prices, moving-average costs, selling prices and package prices do not change.
  - **Owner's answer (asked because profit would otherwise be understated):** the discount is a separate gain, "خصم مشتريات مكتسب", on the purchase's date. Net profit in the dashboard, the performance screen and the advanced reports adds it.
  - Stored: `supplier_purchases.gross_amount` and `discount`; `total_amount` stays the net. Old invoices: gross empty, discount 0.
  - Also on completing a preliminary invoice.
- **Purchase returns.** Separate from cancelling a preliminary invoice. Goods of a recorded purchase go back, in parts, never more than bought (per line, in the line's unit).
  - Stock leaves at the cost the line was bought at; the moving average falls back by exactly that value (FINANCIAL_RECONCILIATION §12).
  - **Owner's answer:** the supplier is credited the lines' value × net ÷ gross, so a discount is never credited twice. The part of the discount given back reduces the purchase gain.
  - The payable falls by the credit; below zero the supplier owes the store.
  - Money is recorded only when the supplier hands it back now, by its method, in the current shift or the treasury (`supplier_refund`). The rest stays owed by the supplier.
  - Goods already sold cannot go back (refused). One transaction; a request id makes a retry return the first result.
  - Permission `suppliers.manage` (granted per role by an administrator). Audit with the lines, values and refund.
- **Open:** the spec's line selling price that updates the product on posting (original SUP-02) is not built. The owner's revision says the purchase must not change prices automatically, so it waits for the owner.

## D-067 HeroMarket data workflow: export, templates, permissions, backup audit (owner, 2026-10-22)

- **No importer for the other POS.** The shop's data comes through HeroMarket's own Excel template. The plan's go-live and visit documents say so.
- **Export (DATA-01):** the template's sheets and headers, filled from one read-only snapshot. The file is read back and checked before it is saved. Details and exclusions: DATA_IMPORT_EXPORT.md.
- **Template version 2:** optional package columns on products (name, units per package, barcode, selling, wholesale and purchase price), checked like the units window. A version marker; newer files are refused, old files import unchanged. Optional fields stay optional.
- **Permissions (ROLE-01):** `data.import` and `data.export`, separate. Administrators by default; a supervisor or any other role gets them only when an administrator grants them. The import screen shows each part only to its holders. Owner's rule (2026-10-22): anything sensitive is granted by an administrator, per role.
- **Backup audit:** every schema table is backed up or listed with its reason; a store using every feature restores row for row with equal balances and stock and keeps working; a failing restore changes nothing.
- **Compatibility rule:** every later data-model change goes through the checklist in DATA_IMPORT_EXPORT.md §6 (migration, backup, template/import/export, reconciliation).

## D-068 New selling and wholesale prices on purchase lines (owner, 2026-10-22, migration 0021)

- **Owner's rule:** each purchase line has two optional fields, "سعر البيع الجديد" and "سعر البيع الجديد (الجملة)" (the owner asked for the wholesale one too). Both are prices of the product's base unit, even when the line is bought in boxes.
  - A filled field sets the product's price when the purchase is confirmed (saved, or a preliminary invoice completed). This holds even when an earlier purchase set a different price.
  - An empty field keeps the current price. Each product and each of the two prices is handled on its own.
  - Package prices are never changed by a purchase; they stay in the units window.
- **Same transaction** as the purchase: a refused or failing purchase changes no price.
  - One product on two lines (pieces and boxes) with two different prices of the same kind is refused.
  - The same price again changes and logs nothing.
- **Trail:** the line keeps the price it set and the one it replaced (`new_/old_retail_price`, `new_/old_wholesale_price`). Each change is an activity-log entry `product_price_change` with the invoice.
- **Unchanged:** the moving-average cost (it follows the line costs) and the invoice discount (D-066).
- **Data workflow:** the new columns are purchase history. They travel in the backup and are not template fields (DATA_IMPORT_EXPORT.md §6 checked).

## D-069 Every window and screen fits, closes and moves by keyboard (owner, 2026-10-22)

- **Owner's rule:** no sideways scrolling anywhere. Every small window closes with its X and with a click outside it. The arrows move between its buttons.
- **Fixes:**
  - **Purchase window:** wider (up to the screen); its lines fit the window; the two new prices are stacked in one column.
  - **Units window:** made wider, with the same fitted columns.
  - **Closing report:** now has the X and closes with a click outside.
  - **Arrows:** ← → ↑ ↓ move between a window's buttons and checkboxes. They never move into text fields; lists, dropdowns, radio groups and tabs keep their own arrows.
  - **Tables on windows narrower than 1280 px:** headers wrap, cells are tighter, dates and times may take two lines, and a button's word beside its icon is hidden (it stays as the button's name).
- **Checked in the running app:**
  - 51 window openings across every admin screen and the till: fit at 1366, 1024 and 800 px, X closes, a click outside closes, arrows move.
  - Every menu screen at 1366 and 1024 px: no sideways scrolling with the menu in its automatic size, which shrinks below 1200 px.
  - The windows without a close (a required shift opening, the recovery notice) stay that way by design.
- **Limit:** with the menu kept expanded by hand on a 1024 px screen, the two widest reports (التقارير المتقدمة, تقييم الكاشيرات) still scroll by up to 85 px.

## D-070 Supplier opening balance and editable contact (SUP-03, owner, 2026-10-22)

- **Opening balance:** what was owed between the store and a supplier before HeroMarket. It can be entered when the supplier is added, or set and corrected later from «تعديل».
  - It is a `supplier_ledger` line of type `opening` ("رصيد افتتاحي"): never a purchase, payment or stock receipt, so stock, cost, prices, the treasury and the drawer do not change.
  - A correction adds one line for the difference ("تعديل الرصيد الافتتاحي: من … إلى …"); earlier lines stay. Setting the same value again does nothing.
  - Later payments reduce the balance and reach the treasury or drawer once, as before.
- **Signs in words:** + means the store owes the supplier, − means the supplier owes the store. Screens show «مستحق للمورد (علينا)» or «مستحق على المورد (لنا)» with the amount, never a bare minus. The import template's hint uses the same rule.
- **Permission** `suppliers.opening` ("الرصيد الافتتاحي للموردين"): administrators by default; supervisors and the stock role get it only when an administrator grants it. Contact editing needs `suppliers.manage`.
- **Contact editing:** name, phone, address and representative, trimmed and checked (name required; phone digits and + - ( ) / only). The changes are listed in the activity log. Invoices, payments, ledger lines and balances do not change.
- **No migration:** existing balances are unchanged, and an imported opening balance already uses the same `opening` line.

## D-071 Stock value, the owner's snapshots, stock movements, damaged-goods search (phase F, 2026-10-22)

- **One stock-value rule** (`modules/stockReports.js`), used by the report and the dashboard:
  - quantities are in the product's base unit; packages are inside it, never counted twice; weighed products are in kg;
  - value at cost = stock × current moving-average cost; at selling price = stock × current retail price;
  - negative stock counts as 0 in totals and is listed and flagged;
  - a product with stock but no cost adds 0 at cost and is counted;
  - stopped products are left out unless asked for.
- **«قيمة المخزون» (PROD-02):**
  - filters (search, category, measurement kind, status, stopped products) change rows and totals together;
  - the rules are written on the screen;
  - it shows a reconciliation count of products whose stock differs from their movements (0 = healthy).
- **«الوضع الآن» on the dashboard (DASH-01):** the four figures the spec lists (stock at cost and at selling price, owed to suppliers, owed by customers).
  - Supplier and customer credits are shown apart from the debts.
  - Computed on every load (nothing cached), with a refresh button.
  - Each card opens its screen.
- **Permission** `reports.valuation` ("قيمة المخزون والأرصدة"): administrators by default; others when an administrator grants it.
- **«حركات المخزون» (STOCK-01):** a menu entry under المخزون listing every movement, newest first.
  - Filters: product (name or barcode), movement type, dates.
  - It reads the same `stock_movements` rows as each product's history (tested to be identical), with source document, user and reason. A sale opens its invoice.
  - Costs are hidden without `products.view_cost`. History is never changed.
- **Damaged goods (WASTE-01):** the window uses the purchase window's product search (name or barcode, ↑ ↓ Enter, scanner, paged for large catalogues). A package can be chosen (2 cartons = 24 pieces), converted by its factor as in sales and purchases. Records stay in the base unit, so reversal, cost and the ledger are unchanged.
- **Product search lists** close after a pick, in purchases and damaged goods alike; typing reopens them.

## D-072 Customer codes (CUST-01, migration 0022)

- **Code format:** every customer has a code C + its number with at least five digits (C00012), taken from the customer id.
  - Ids are never reused, so a code is never recycled after a deletion.
  - Concurrent creation cannot collide (identity sequence plus a unique constraint).
  - A trigger refuses any change to a code.
- **On sales:** each sale keeps its customer's code (`sales.client_code`), shown in the invoice details. Customers with invoices cannot be deleted anyway.
- **Search:** the till and the customers screen find a customer by name, phone or code; an exact code comes first.
- **Unchanged rules:** two phones and three addresses per customer.
- **Backfill:** existing customers get C + id, and their sales get the code; nothing else changes. Tested over existing data.
- **Data workflow:** the code is generated by the store; it is not a template column. Imported customers get new codes; the backup keeps the codes.

## D-073 A shift close is never refused; the cashier never sees expected amounts before it (owner, 2026-10-22)

- **Owner's rule, restated:** the cashier must not see the expected amount in the drawer, or any expected figure, until the shift is closed.
  - The cashier enters the counted amount for each payment method and confirms.
  - Only then does the report show expected, actual and the difference (shortage or surplus) per method and in total.
- **Audit of every place an expected figure can appear (2026-10-22):**
  - the tills page, the periodic drawer count ("جرد الدرج الدوري", a blind count) and the close window are blind without `shifts.view_expected`;
  - the server refuses `shifts.liveSummary`, `shifts.auditPreview` and open-shift `shifts.details` without that permission;
  - `tills.drawerSummary` answers blind, and a saved count returns only its id;
  - the cashier and supervisor roles do not hold `shifts.view_expected`. The owner's screenshot was of the administrator's own shift, which is meant to show them.
- **Changed:** a close is never refused, however large the shortage or surplus (even beyond EGP 5,000). This replaces the EGP 50 supervisor approval of D-046.
  - A refusal told the cashier "your count is off" and let them recount until it passed. Now there is nothing to probe.
  - The difference is saved with the close and shown in the report and in «الورديات», where the owner deals with it. No approval is asked or recorded; an approver sent by an older till is ignored.
  - Closes recorded before D-073 keep their acknowledgement in their report.
- **Tests:** the close test now proves that a 6,000 shortage and a 6,000 surplus close at once, with the difference in the report and the shift details and no approval. The existing test that a cashier cannot read expected amounts through any operation before closing still passes.
- **Running app, as cashier1:**
  - the tills page showed only the notice;
  - the close window showed no expected figure and no fill button;
  - a close with a 201,127.30 shortage was accepted;
  - the report after it showed expected, actual and «عجز» per method.

## D-074 The backup after a shift close is automatic (owner, 2026-10-22)

- **Owner's rule:** no question to the cashier. If the system makes a backup after a close, it does so automatically.
- **Removed:** the prompt «هل تريد أخذ نسخة احتياطية من قاعدة البيانات الآن قبل إغلاق الوردية؟» and its save dialog. The close goes straight through.
- **Added:** after every successful close, the till starts the on-demand task «HeroMarket Backup After Close» and does not wait.
  - The task runs the nightly job as the system account in its after-close mode: one new verified copy each time, in the same locked folder (users can read the copies, not delete them).
  - The newest 20 close copies are kept. The nightly daily and weekly copies, their schedule, catch-up, retention and checks are unchanged.
  - Windows users may start the task, but not change it.
  - The installer registers the task next to the nightly one and removes both on uninstall.
  - A development build logs that it skipped.
- **Evidence:**
  - unit tests (a close copy every time, never a daily or weekly one; retention 20; the task definition);
  - Windows Sandbox C1 with test build 1.5.0-test.2: installed, started twice with normal user rights, two verified copies written as SYSTEM, deletion as a normal user refused.
  - The close itself was checked in the running app.
- **Updates:** an installed 1.5.0 gets the new task when its installer runs (the service setup step registers both tasks).

## D-075 Permissions enforced by the service, tested by direct request; a generated matrix (ROLE-02, 2026-10-22)

- **Every service operation requires a permission.** The exceptions are listed with their reason:
  - 5 before sign-in: status, first setup, sign-in, first password, recovery;
  - 7 for any signed-in user: sign out, the own account, the own password and recovery code, display settings, two sync flags, measurement-kind names.
  - A new operation without a permission fails a test until it gets one or is listed with its reason.
- **Checked before the request is read:** a caller without access learns nothing about an operation's fields. Hiding a button is only a convenience.
- **Direct requests:** each built-in role is refused (403), with no screen involved, every operation it does not hold:
  - store administrator 1, supervisor 32, cashier 100, stock 97, auditor 103;
  - signed out, every non-public operation answers 401.
- **Owner-only by default** (an administrator may grant them per role): expected amounts before the close, the treasury, every user's expenses, stock value and balances, payment corrections, supplier opening balances, data import and export, users and roles.
- **Menu:** every permission the menu uses exists in the catalogue (tested).
- **`.docs/PERMISSION_MATRIX.md`** is generated from the code (`node scripts/permission-matrix.js`) and lists permissions × built-in roles and every operation with what it requires. A test fails when it is out of date.

## D-076 Administrator password reset: own password first, temporary password expires (USER-02, migration 0023)

- **Unchanged:**
  - the administrator never sees the old password;
  - a temporary password replaces it and the old one and any PIN stop working;
  - the user's sessions end, and they must choose their own password at the next sign-in;
  - the reset is logged;
  - an administrator cannot act on an account above their own authority (escalation check).
- **Added:**
  - **Re-authentication:** the administrator types their own password in the window. Missing or wrong refuses the reset, changes nothing, and logs `password_reset_refused`.
  - **Expiry:** the temporary password works for 72 hours (`users.temp_password_expires_at`; the local reset command too). After that it is refused with "انتهت صلاحية كلمة المرور المؤقتة…", shown only to whoever typed it correctly; a wrong password still gets the ordinary answer. Choosing a password clears it.
- **Not changed:** a new account's first password does not expire, since staff accounts are often prepared before the person starts.
- **The window:** it opens fresh each time, so a typed password never stays.
- **Tests:** `auth.test.js` covers the refused resets (2 logged), the 72-hour expiry, sign-in and set-password both refused after expiry, and a new reset working.

## D-077 Reprints from saved documents, marked as copies (POS-02, 2026-10-22)

- **Already in place:** the print / no-print choice at the till (F1 prints, F2 does not, D-065, shown beside the buttons); sale invoice reprint from `sales.reprintData` with «*** نسخة معاد طباعتها ***»; the closing report reprint from the saved close.
- **Added:**
  - **Supplier invoices:** a print button on each recorded purchase in the supplier's list, built from `suppliers.purchaseDetail`. It shows the lines (with what was returned), gross, invoice discount, net, paid and still owed at purchase, and the returns' credit. It always carries the copy mark.
  - **Closing reports printed again** (from the report window or the shift details) carry the copy mark; the automatic print at the close does not.
- **Each document keeps its own layout:** sale receipts use the receipt designer's template; closing reports and supplier invoices use the report layouts (`shared/reportLines.mjs`).
- **Printing records nothing:** `tests/service/reprints.test.js` reprints a sale, a supplier invoice and a closing report three times each, and every table's content fingerprint is unchanged (no second sale, stock movement, supplier posting or close). `tests/unit/reprints.test.mjs` checks the layouts and the copy marks.
- **Physical printing** is part of HW-02 at the shop.
- **2026-10-22, owner: the supplier's purchases table still scrolled sideways.** The earlier sweep had measured each screen only as it opens; the supplier, customer, invoice and cashier pages appear only after a row is opened.
  - The purchases table now has 5 columns: invoice (date and payment type under it); net (discount and returns under it); paid; owed; icon actions for print and return.
  - Bar charts share their width instead of scrolling (24 hours fit).
  - The sweep now opens the first row of every list: all 29 screens, closed and opened, at 1366 and 1024 px, show no sideways scrolling.
  - A purchase entered without an invoice number is named by its own number in the ledger, the drawer and the log ("#12", not "#").

## D-078 The visible-control inventory (UX-01, 2026-10-22)

- **`.docs/UI_INVENTORY.md`** covers:
  - every screen in the menu: permission, purpose, main actions and their effects, tests;
  - every window and its effect;
  - every key;
  - the checks done: right to left, keyboard only, no sideways scrolling, feedback, empty and loading states;
  - the open points for the owner.
- **Kept current:** a test fails when a menu screen is missing from it.
- **No dead or decorative control was found among the visible ones.** The audit raised three questions for the owner, and nothing is removed without an answer:
  - the two permissions marked «غير مستخدمة» in the roles screen (Momkn and wallet tills, stopped in D-063);
  - whether «المزامنة السحابية» stays visible while the shop does not use the cloud;
  - whether three overlapping report screens are kept.
- **Invisible leftovers of the old Momkn tills** (state passed between components, server operations kept so old shifts stay readable) are not controls and stay as they are.
- **The owner's answers (2026-10-22):**
  - the two unused permissions are hidden from the roles screen (`hidden: true` in the catalogue; `roles.catalog` leaves them out; the keys stay valid);
  - «المزامنة السحابية» stays visible;
  - «الأداء والأرباح» is merged into the dashboard's period statistics (new period «الكل», profit margin, cash flow); «التقارير المتقدمة» is kept.

## D-079 Release candidate 1.5.0: the copy before an update is kept; going back restores first (phase H, 2026-10-22)

- **Version 1.5.0** on this branch (`package.json`); release notes in `RELEASE_NOTES_1.5.0.md`. Nothing is merged, tagged or published.
- **Found in the Windows Sandbox update check:** after 1.4.0 → 1.5.0 and four later installer runs (Case A, a failing update, Case A again, the 1.4.0 installer refused), `--restore-pre-install` found no copy of the 1.4.0 data. Every installer run takes a copy, and only the newest 3 were kept.
- **Changed:**
  - the newest 3 copies are kept, plus the newest copy of each of the last 3 data versions (`pruneSnapshots` with the data version from `update.json`);
  - `--restore-pre-install=<version>` restores the newest copy of that version's data (a folder name still works);
  - going back is now: restore with the newer program, then run the older installer. 1.4.0's own installer still prunes by the old rule, so running it first can remove the 1.4.0 copy (UPDATE_GUIDE.md §6).
- **Tests:** unit tests replay the Sandbox sequence and the copy choice; the Sandbox runs are in UPDATE_GUIDE.md §8.

## D-080 Release 1.5.0: the shop upgrades from 1.4.0 in place; two backup fixes (2026-10-22)

- **The shop runs HeroMarket 1.4.0** with its data, imported from the old program's export through the HeroMarket template. The scanner, printer and workflows were tested there by the developer on 1.4.0. There is no further visit. The owner installs 1.5.0 over 1.4.0 himself, following `UPGRADE_TO_1.5.0.md`. The data is not imported again: the update keeps it.
- **Rehearsed on the real path** (disposable databases):
  - 1.4.0's own code (`main`, f0f0d84) imported a filled `.xlsx` template and recorded a day's work: cash, wallet, part-paid and credit sales, an expense, a purchase, supplier and customer payments, the close;
  - then the 1.5.0 migrations with the installer's own checks: no problem, every figure unchanged;
  - then 1.5.0: stock = movements, reports, a new sale and close, export;
  - the same 1.4.0 file reads into an empty 1.5.0 store, and importing it a second time is refused as a whole.
- **Backups across versions:** a 1.4.0 backup file restores only into 1.4.0. The owner makes one before the update as his way back.
- **Fix 1, backup lock:** the nightly and after-close runs share one lock. A run that found it taken gave up, so a shift closed just before midnight cost that day's daily copy: the scheduler counts the run as done and does not retry. A run now waits up to 20 minutes for the other one, then decides.
- **Fix 2, catch-up at start-up:** a missed midnight is made up as soon as the PC starts, often before the database service accepts connections. The run failed for the day. It now waits up to 10 minutes for the database, and only when a copy is due.
- **Tests:** `backupJob.test.mjs` (both cases); Windows Sandbox on the final installer (NIGHTLY_BACKUP.md).
- **Packaging:** a release candidate was found, by listing its package, to contain a git worktree that sat inside the project folder; it was discarded. Top-level dot-folders, `deploy/` and `electron-builder.qa.yml` are now excluded, and a test checks the rules.
- **The final installer:** `HeroMarket-Setup-1.5.0.exe`, SHA-256 `9f8e506cfb824c055bd4c97f42df29926291ed195389a750ab7067285529f9d5`, built from `f05eb99` with no uncommitted change.

## D-081 Browsing invoices: the own open shift unless «كل الفواتير» (owner, 1.5.1)

- **Owner's rules:**
  - the administrator sees every invoice, of every cashier and shift, independent of any shift;
  - a cashier or supervisor given «عرض الفواتير» sees only **their own invoices of the current shift**;
  - granting «عرض الفواتير» must not open every invoice;
  - the service enforces it, so asking for another cashier's invoice details by number is refused.
- **Root cause (1.5.0 and earlier):** the invoice operations checked only a permission, never whose invoice it was or which shift it belonged to, and no permission meant "all invoices". «عرض الفواتير» listed every invoice in the store, and `sales.detail` opened any invoice by its id. It was a missing scope in the service, not a screen filter that failed.
- **Fix:**
  - new permission `sales.view_all` («كل الفواتير»), held by default by the two administrator roles and by the read-only reviewer («مراجع»), which has no shift and cannot reprint, return or change an invoice. Supervisors («مشرف») and cashiers do not get it; roles made by the owner get it only if he grants it;
  - without it, browsing is limited to the user's own open shift: the invoices list (`sales.page`), an invoice's details (`sales.detail`) and a customer's invoices (`clients.profile`) (`src/server/auth/invoiceScope.js`);
  - a request for other details is refused (403) and logged as `invoice_access_refused`;
  - the customer's balance and account lines stay visible;
  - `sales.detail` no longer accepts «طلب مرتجع» as its permission: the till finds an invoice for a return through `sales.lookup` (D-082).
- **Not here:** the actions. Returns, reprint and payment method change reach any invoice by its number with their own permission (D-082).
- **Data:** no migration. The permission is added to the built-in roles at the first start, as every new permission (`ensureAccessControl`).
- **Tests:** `tests/service/invoiceScope.test.js`.

## D-082 Returns, reprint and payment change by invoice number, each with its own permission (owner, 1.5.1)

- **Owner's rule:**
  - a user may hold the permission for one action on invoices without «عرض الفواتير»;
  - each action has its own screen: enter the invoice number, get that invoice, do the action;
  - the invoice may be of any cashier, shift or date, closed shifts included;
  - only what the action needs is shown, never the list or the browsing history.
- **Service:**
  - **`sales.lookup` `{ saleId, action }`:** `action` is `return` (needs `sales.return` or `sales.return_request`), `reprint` (`sales.reprint`) or `payment` (`sales.change_payment`). The answer:
    - all actions: number, time, payment method and total;
    - a return adds the customer's name and the lines (name, quantity, returned, price, unit);
    - a payment change adds whether the shift is open and whether the invoice has a return.
    - Never the cashier, costs or discounts.
  - **The actions** (`sales.returnItem`, `sales.returnEntire`, `sales.reprintData`, `sales.changePaymentMethod`) check only their own permission, on any invoice. A lookup authorizes nothing: an action without its permission is refused.
  - **Unchanged rules:** returnable quantities, the refund through the customer's account first and then the returning user's own open drawer, stock movements, the supervisor's approval with a reason for «طلب مرتجع», the audit lines, and the payment-change reconciliation (a closed shift's sale is reclassified, D-065; an invoice with a return keeps its method). Reprinting records nothing.
- **Screens** (menu «الحسابات»), each shown only with its permission:
  - «المرتجعات»: the till's return panel as a page (`ReturnPanel`), same rules;
  - «إعادة طباعة فاتورة»;
  - «تغيير طريقة الدفع»: the existing payment window.
  - The till's return window uses the same lookup.
- **Change from the first 1.5.1 draft:** that draft also limited the actions to the own open shift. The owner then set this rule: the actions are governed by their own permission, browsing by D-081.
- **Limits:**
  - the receipt prints the invoice number, not a barcode of it, so a scanner has nothing to read on today's receipts; the number is typed (a scanner that types digits and Enter works in the field);
  - the number looked up is the invoice id. Receipts show `((id − 1) mod 10000) + 1`, which differs from the id only after the store's 10,000th invoice.
- **Tests:** `tests/service/invoiceActions.test.js`:
  - each permission alone and in combination;
  - invoices of other cashiers and closed shifts;
  - the fields returned;
  - refused browsing and refused actions, with nothing changed;
  - the existing return and payment rules.
