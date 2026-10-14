# Frontend Architecture

## 1. Before the redesign (baseline, Verified)

- **Shell**: `components/pos/AppHeader.jsx` – one wrapping header row with store name, "connected (SQLite)" badge, version, three nav buttons (POS, Tills, Management), user, PIN, shift, audit, close/open shift, logout.
- **Screens**: `CheckoutTerminal` (POS), `TillsManagerTab` (top-level view), `AdminDashboard` (card grid of 17 sections → each `*Tab.jsx`, with a "back to sections" button).
- **Styling**: `assets/base.css` (tokens for a blue light theme) + `assets/main.css` (~970 lines of global classes) **plus ~1,300 inline `style={{…}}` objects and ~500 hard-coded hex colours** spread across components (`TillsManagerTab` 133, `CashierPerformanceTab` 122, `ClientsTab` 121, `AdvancedStatsTab` 98, `CloseShiftModal` 78…). Several CSS variables referenced inline (`--bg-main`, `--text-main`, `--accent-blue-hover`) were never defined.
- **RTL**: `<html lang="ar" dir="rtl">` and `body { direction: rtl }`; layout mostly correct, but some absolute positioning used physical `left/right`.
- **Typography**: Segoe UI/Tahoma; no Arabic web font; many 0.75–0.82 rem labels.
- **Icons**: `lucide-react` mixed with emoji used as icons (📊📦🕒🧾🖨️📄⚠️…).
- **Theme**: light only (an older doc described a dark theme that no longer existed).
- **Common primitives**: CSS classes `.btn*`, `.form-input`, `.modal-*`, `.admin-*`; no React UI primitives; dialogs re-implemented per modal with inline styles; toast is an inline-styled div in `App.jsx`.
- **Reuse problems**: duplicated stat-card/table/header markup per tab, hover effects via `onMouseEnter` style mutation, white-on-white surfaces with heavy shadows.

## 2. After the redesign (Implemented)

```
src/renderer/
  index.html                 # pre-paint theme script, HeroMarket title, favicon
  src/
    main.jsx                 # imports Cairo font + styles/index.css, wraps ThemeProvider
    App.jsx                  # composition root (unchanged responsibilities) → <AppShell>
    styles/
      index.css              # import order
      tokens.css             # ★ design tokens, light + dark
      base.css               # reset, typography, focus, scrollbars, reduced motion
      components.css         # buttons, fields, tables, badges, cards, dialogs, toasts, segmented, kbd, empty/loading
      shell.css              # sidebar, topbar, page container, user menu
      pos.css                # cashier screen layout
      screens.css            # management screen patterns (page header, toolbars, grids, profiles)
      legacy.css             # maps legacy class names (.admin-card, .admin-table, .stat-card, …) onto tokens
    theme/ThemeProvider.jsx  # useTheme(): theme, resolvedTheme, setTheme, toggleTheme
    components/
      brand/BrandMark.jsx    # SVG logo + wordmark
      shell/AppShell.jsx     # sidebar + topbar + content slot
      shell/Sidebar.jsx      # grouped nav, compact rail, theme toggle
      shell/Topbar.jsx       # title/breadcrumb, shift chip, audit, open/close shift, user menu
      shell/navigation.js    # ★ single source of nav items, permissions and on-enter loaders
      ui/index.jsx           # PageHeader, StatCard, EmptyState, Kbd, Section, ThemeToggle, SortableTh, Pagination
      ui/charts.jsx          # VBarChart (token-coloured bar chart used by the report screens)
      ui/chartColors.js      # CHART_COLORS → var(--chart-1…5)
      pos/CheckoutTerminal.jsx  # redesigned cashier screen (same props contract)
      pos/LockScreen.jsx        # redesigned lock screen (same props)
      admin/AdminDashboard.jsx  # section router + overview (no more back button; sidebar navigates)
      admin/*Tab.jsx            # restyled on tokens and shared classes
      modals/*                  # restyled on shared dialog classes
```

### Contracts preserved

- `App.jsx` still owns all state and passes the **same props** to `CheckoutTerminal`, `AdminDashboard`, `AppModals`, `TillsManagerTab`.
- `currentView` / `adminTab` values unchanged (scanner routing).
- Element refs (`barcodeInputRef`, `searchInputRef`, `qtyInputRefs`, `adminSearchInputRef`, `addProductBarcodeRef`) attach to the equivalent inputs.
- Data-loading side effects that the original menu cards triggered are executed by the sidebar through `navigation.js#onEnter`.

### Theme

`ThemeProvider` reads `localStorage['heromarket.theme']`, resolves `system` via `matchMedia('(prefers-color-scheme: dark)')`, writes `data-theme` on `<html>`, and listens for OS changes. `index.html` applies the stored theme before React mounts.

### Inline styles policy

Inline `style={{…}}` objects went from about 1,290 to 134; the remaining ones are mostly dynamic values (widths of chart bars, computed colours from tokens). Raw hex/rgb colours remain only in `brand/BrandMark.jsx` (the fixed brand colours) and the `ErrorBoundary` crash screen; everything else resolves to tokens (`var(--…)`), so both themes render correctly. Buttons, inputs, tables and badges use shared classes, hover effects are pure CSS (no `onMouseEnter` style mutation). New code must use classes; when touching a screen, prefer moving inline styles to `screens.css`.

## 3. Where to change what

See `REPOSITORY_MAP.md#where-to-change-things`.

## 4. Recommended next steps

1. Introduce a light context (`SessionContext`, `UIContext` for alert/confirm/toast) to remove 100-prop drilling.
2. Move SQL into DAO modules (then into the main process) so components stop composing queries.
3. Split the bundle per management screen (`React.lazy`) – the renderer is a single 1.3 MB chunk.
4. Replace remaining inline styles in `CashierPerformanceTab`, `AdvancedStatsTab`, `TillsManagerTab` with screen classes.

## Stage 2 changes (PostgreSQL release)

- **Data access:** all SQL left the renderer. `lib/api.js#api(op, body)` is the only data path (IPC `api:call`); `lib/db.js` and `mockDb.js` were removed. Hooks keep their names and return shapes so screens did not change.
- **Start-up:** `components/setup/StartupGate.jsx` (connection with three device roles; first-run administrator with the setup code when required); `App.jsx#checkStartup` retries temporary 503s.
- **Permissions in the UI:** `shell/navigation.js` lists the permissions each item needs; `canOpenTab` guards admin tabs; the service enforces the same permissions.
- **New screens:** `RolesTab`, `SettingsTab`, `ReceiptDesignerTab` (block editor with zones, alignment segmented control, bold/size toggles, drag-and-drop, live thermal preview parsing the printer tags, sandboxed A4 iframe).
- **Shared primitives:** `Timestamp` (date-times kept left-to-right, date first), `BidiText` (isolates quoted names and codes in mixed Arabic/Latin messages), `StatCard` keeps amounts and currency together.
- **Accessibility:** product search is a `combobox`; the roles list uses pressed buttons; axe-core reports 0 WCAG 2.2 A/AA violations on all screens in both themes.
