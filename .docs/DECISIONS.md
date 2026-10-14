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
