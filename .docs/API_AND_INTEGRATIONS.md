# Interfaces and Integrations

HeroMarket POS has **no HTTP API and no network integrations**. All interfaces are Electron IPC channels between the renderer and the main process, plus local binaries and Windows printing. (Verified: `src/main/index.js`, `src/main/printer.js`, `src/preload/index.js`; the CSP only allows `self` and `ws://localhost:*` for Vite HMR.)

## 1. IPC channels

| Channel (`ipcMain.handle`)   | Preload accessor                            | Request                                                    | Response / errors                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execute-sql`                | `window.api.db.execute(sql)`                | One SQL string (may contain several statements)            | Array of row objects from the **last** result set; `[]` for statements without output. Throws `Invalid SQL query input` (empty / non-string), `Forbidden SQL operation` (matches `DROP TABLE`, `ALTER TABLE`, `ATTACH/DETACH DATABASE`, `DELETE FROM users`), or the `sqlite3` stderr text. |
| `backup-database`            | `window.api.db.backup()`                    | – (opens a Save dialog)                                    | `{ success: true, filePath }` · `{ success: false, error: 'User cancelled' \| message }`                                                                                                                                                                                                    |
| `restore-database`           | `window.api.db.restore()`                   | – (opens an Open dialog)                                   | `{ success: true, requiresRestart: true }` · `{ success: false, error }` – overwrites the live DB file.                                                                                                                                                                                     |
| `print-receipt`              | `window.api.printer.print(html, options)`   | Receipt HTML (see §3); `options` is ignored by the handler | Resolves `true` when PowerShell prints `PRINT_DONE`; rejects `Print failed: …` / `Not confirmed: …`. 20 s timeout.                                                                                                                                                                          |
| `generate-shortages-pdf`     | `window.api.generateShortagesPdf(items)`    | `[{ name, stock_qty, min_limit }]`                         | Compiles a Typst document with `typst.exe`, opens the PDF with the OS, resolves `{ success, path }`.                                                                                                                                                                                        |
| `print-shortages-to-printer` | `window.api.printShortagesToPrinter(items)` | same items                                                 | Prints the shortage list as text through `print_receipt.ps1`.                                                                                                                                                                                                                               |
| `ping` (`ipcMain.on`)        | –                                           | –                                                          | Logs `pong`. Template leftover.                                                                                                                                                                                                                                                             |

`window.electron` (from `@electron-toolkit/preload`) is also exposed but not used by app code.

## 2. Local binaries and scripts

| Asset                                                 | Used by                                           | Notes                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `sqlite3.exe` (repo root; packaged as extra resource) | `src/main/db.js`, tests, `scripts/init-dev-db.js` | Windows-only binary. Path: `process.cwd()` in dev, `process.resourcesPath` when packaged.                                        |
| `typst.exe` (repo root, ~52 MB; extra resource)       | `generate-shortages-pdf`                          | Windows-only.                                                                                                                    |
| `resources/print_receipt.ps1`                         | Receipt + shortages printing                      | Renders a UTF-8 text file with GDI (`System.Drawing.Printing.PrintDocument`); supports `[C]`, `[R]`, `[BOX]` line prefixes and ` | `-separated table rows. Takes `-TextFile`and`-PrinterName`. |
| `resources/print_raw.ps1`                             | Not referenced by code                            | Leftover.                                                                                                                        |

## 3. Receipt HTML contract (Verified – must be preserved)

`printer.js#buildReceiptText` extracts values with regexes. The receipt HTML generated by `src/renderer/src/lib/printTemplates.js` must keep:

- Labels: `رقم العملية` or `فاتورة` followed by `#<digits>`; `التاريخ:`, `الوقت:`, `الكاشير:`, `العميل:`, `هاتف العميل:`/`الهاتف:`, `العنوان:`, `نوع التقرير:`.
- Totals as `<span>LABEL:</span> <span>VALUE</span>` for `الإجمالي النهائي|الإجمالي`, `خصم الفاتورة|الخصم`, `المبلغ المدفوع|المدفوع`, `الباقي للعميل`.
- An items `<table>` whose first row contains `<th>` and data rows with 3 or 4 `<td>` cells (name, qty, [price], total).

The UI redesign does **not** modify `printTemplates.js`.

## 4. Hardware

| Device                               | Integration                                                                  | Verified?                                               |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| USB barcode scanner (keyboard wedge) | Global keystroke timing in `useBarcode`                                      | Logic verified; simulated in QA by fast `keyboard.type` |
| Weighing-scale labels                | EAN-13 prefixes 20/21/22/25 (`parseScaleBarcode`)                            | Code-verified                                           |
| Thermal receipt printer              | Windows printer by name (`settings.printer_name`, default `CITIZEN CT-S300`) | **Not verified** – no printer on the QA machine         |
| Cash drawer                          | No integration found                                                         | –                                                       |

## 5. External services

None. No telemetry, auto-update endpoint is a placeholder (`electron-builder.yml → publish.url: https://example.com/auto-updates`, unused at runtime).
