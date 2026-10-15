# AI Handoff & Development Rules

This file provides critical context, constraints, and operational guidelines for AI coding agents working on the **HeroMarket POS** codebase. Follow these rules to avoid breaking application stability, causing UI lockups, or causing database corruption.

---

## 1. Critical Rules & Guardrails

### 🚫 Rule 1: No Native Browser Dialogs
*   **Banned APIs:** `alert()`, `window.alert()`, `confirm()`, `window.confirm()`, `prompt()`, `window.prompt()`.
*   **Why:** These APIs block the Electron renderer process, halting UI execution and freezing the app.
*   **Alternative:** Always use the custom React modals system. Call `triggerCustomAlert(message, title)` or `triggerCustomConfirm(message, onConfirm, onCancel, title)`. Ensure these functions are passed down through `useAdminController` to child hooks.

---

### 🛢️ Rule 2: SQL Concurrency & Integrity (WAL Mode)
*   **WAL Mode:** SQLite must always run in **Write-Ahead Logging (WAL)** mode (`PRAGMA journal_mode=WAL;` in `src/main/db.js`). This prevents database locking when managers query statistics while cashiers are checking out.
*   **Foreign Keys:** The system uses standard `sqlite3.exe` CLI wrappers. Prepend `PRAGMA foreign_keys = ON;` to every query transaction to enforce relational constraints.
*   **Transactions:** Any operation mutating multiple tables (like checking out a sale or settling an invoice) MUST be wrapped in a transaction block (`BEGIN TRANSACTION;` ... `COMMIT;`) and sent to the db CLI as a single command string.
*   **SQL Injection:** Always escape input values using `escapeSql()` from `src/renderer/src/lib/utils.js`.

---

### 💻 Rule 3: Portable Node Environment Path
*   **Constraint:** The host Windows OS does not have global Node.js or npm installed.
*   **Execution Rule:** You must append the local portable Node path to the environment variable before running scripts or commands.
*   **PowerShell Command Prefix:**
    ```powershell
    $env:Path = "<project folder>\node-portable;" + $env:Path
    & npm.cmd run dev
    & npm.cmd run build
    ```
*   Always use `npm.cmd` instead of raw `npm` commands because of execution policy constraints.

---

### 📊 Rule 4: Financial Ledger Safeguards
*   **Shift Ledger Separation:** Supplier invoices or inventory imports (historical entries) must **never** write into the cashier's active shift safe ledger (`safe_ledger`).
*   Import historical invoices as paid with `remaining = 0` and bypass the safe ledger. Otherwise, the cashier's shift closing balance will show a huge artificial cash deficit.
*   **Idempotency:** Any batch importing script (e.g. products, historical clients) must check if the item already exists in the database by unique key (like `barcode` or `invoice_ref`) before inserting.

---

## 2. Codebase Quickstart Context

### Database Queries Flow
When the React UI needs to run a query:
1.  React components call functions inside `src/renderer/src/lib/dao/`.
2.  The DAO files invoke `executeQuery` from `src/renderer/src/lib/db.js`.
3.  `executeQuery` verifies if `window.api.db.execute` is available. If yes, it fires the IPC invocation. If running in a standard browser (development review), it falls back to a JS memory mock database (`mockDb.js`).
4.  The Preload script `src/preload/index.js` handles the IPC invoke and maps it to the main process channel.
5.  The Main process `src/main/index.js` routes the query to `executeSql` in `src/main/db.js`, which spawns `sqlite3.exe -json` and pipes the query into stdin.
