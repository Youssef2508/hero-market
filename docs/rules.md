# HeroMarket POS Development Rules for AI Agents

This document outlines the strict rules, architectural patterns, constraints, and pitfalls that every AI agent MUST follow when working on the **HeroMarket POS** project. These rules have been established to prevent UI freezes, database locks, build failures, and ledger discrepancies.

---

## 1. UI/UX: Modals & Blocking Dialogs
*   **BANNED PATTERNS:** 
    *   Never use native browser dialogs: `window.alert()`, `alert()`, `window.confirm()`, `confirm()`, or `prompt()`. 
    *   These dialogs freeze the Electron renderer process, lock the main UI thread, and crash the production application.
*   **MANDATORY ALTERNATIVE:**
    *   Use the React-based, non-blocking modal system.
    *   **For alerts:** Call `triggerCustomAlert(message, title)`.
    *   **For confirms:** Call `triggerCustomConfirm(message, onConfirmCallback, onCancelCallback, title)`.
    *   Ensure `triggerCustomAlert` and `triggerCustomConfirm` are passed down through `useAdminController` to all child hooks/sub-managers:
        *   `useClientsManager`
        *   `useSuppliersManager`
        *   `useProductsManager`
        *   `useSalesManager`
        *   `useUsersManager`
        *   `useExpensesManager`
        *   `useChecksManager`

---

## 2. Database Integration & Concurrency
*   **Mock vs. Production Database:**
    *   Never import database helper functions from `mockDb` in production files (e.g. do NOT use `../../lib/mockDb`).
    *   Always use `executeQuery` imported from `src/renderer/src/lib/db.js` for IPC communication in the renderer.
*   **SQLite Concurrency (WAL Mode):**
    *   SQLite must always run in **Write-Ahead Logging (WAL)** mode.
    *   Ensure `PRAGMA journal_mode=WAL;` is executed during database initialization in `src/main/db.js`.
    *   Do not revert or disable WAL mode. It is critical for permitting concurrent reads (e.g., manager dashboards/reports) during active checkouts.
*   **Transaction Safety (ACID):**
    *   All multi-query mutations (e.g., checking out, system reset, paying invoice) MUST be wrapped in a transaction block: `BEGIN TRANSACTION;` ... `COMMIT;` sent as a single execution script to prevent partial writes.

---

## 3. Environment & Commands Execution
*   **Portable Node Environment:**
    *   The host system lacks a global Node/npm installation.
    *   Always use the local portable node under `node-portable`.
    *   Before executing any Node.js or npm script, add `node-portable` to the environment path:
        ```powershell
        $env:Path = "<project folder>\node-portable;" + $env:Path
        ```
    *   Do not run raw `npm` or `npm.ps1` commands directly in PowerShell due to system execution policies. Use `npm.cmd` instead:
        ```powershell
        & npm.cmd run dev
        & npm.cmd run build
        ```

---

## 4. Hardware & Printer Configuration
*   **Printer Name Resolution:**
    *   Never hardcode the thermal printer name (e.g., `'CITIZEN CT-S300'`) in print scripts.
    *   Always query the database settings table dynamically to retrieve the configured printer name:
        ```sql
        SELECT val FROM settings WHERE key = 'printer_name';
        ```
*   **Arabic Unicode Support:**
    *   Thermal receipt printing uses the GDI library inside PowerShell (`print_receipt.ps1`). This maintains correct Arabic ligatures and Right-to-Left formatting. Do not replace it with low-level ESC/POS raw bytes unless RTL wrappers are fully implemented.

---

## 5. Barcode Scanner Focus & Events
*   **Scanner Hook Interference:**
    *   The global barcode listener in `useBarcode.js` intercepts keyboard inputs.
    *   To prevent scanner input from leaking into open text inputs or modals:
        *   The hook MUST verify that no modals are open: `!customAlert`, `!customConfirm`, `!openShiftModal`, `!closeShiftModal`, and `!managerApprovalModal`.
        *   Autofocus on the main barcode input must be bypassed if any modal is active.

---

## 6. Financial Ledger & Historical Data Safeguards
*   **Safe Reconciliation:**
    *   Never inject historical data (e.g., bulk wholesale supplier invoices) directly into active cashier shifts.
    *   Historical purchases must be imported as "Paid" with `remaining = 0` in `supplier_purchases` and `supplier_ledger`, bypassing the active shift's safe ledger (`safe_ledger`). This prevents fake deficit/surplus cash reports at shift close.
*   **Idempotency Checklist:**
    *   Any migration or import script (e.g., `import_invoices.js`) must check if the invoice number/reference (`invoice_ref`) and supplier already exist in the database before inserting to prevent duplicate records on re-runs.

---

## 7. Packaging & Path Configurations
*   **Relative Paths in Bundling:**
    *   Ensure all build directories and resource copying paths in `electron-builder.yml` reference local workspace files (`./`) instead of parent directories (`../`).
    *   SQLite database binary `sqlite3.exe` and database file `market_unified.db` must be packaged in the same application directory.

---

## 8. Release Versioning & Build Cleanup
*   **Build Directory Cleanup:**
    *   Before initiating any new production build, the builder MUST clean the `dist/` directory (delete all old `.exe` installers, blockmaps, and directories) so that only the newly compiled release installer exists.
*   **Version Incrementing:**
    *   Every new build must be assigned a unique, incremented version number in `package.json` (e.g., `1.0.1` -> `1.0.2`).
    *   The updated version badge in `AppHeader.jsx` must dynamically reflect this new version.

