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

- **Context**: Electron derives the user-data folder (which holds the production database) from the app name.
- **Decision**: User-facing names become "HeroMarket POS" (window title, installer/shortcut names, artifacts, UI). `package.json#name` stays `elnagdi-pos`, electron-builder `appId` is unchanged, and the main process pins `userData` to the legacy `elnagdi-pos` folder.
- **Reason**: Existing installations keep their database and upgrade in place.
- **Consequences**: Internal identifiers still mention `elnagdi`; documented here intentionally.

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
