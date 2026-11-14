# Session persistence, bulk import and offline synchronisation – findings and fixes (1.6.3)

Written for the developer reviewing branch `fix/session-resume-import-jobs` before anything is released or deployed.

**Status:**

- nothing is merged, released or deployed;
- every measurement below was made on the development PC with made-up data, on throw-away PostgreSQL 17 databases;
- the real shop's database and the cloud server were not used. The cloud server was only read, for counts; it was found empty (see §J).

Decisions: [D-108](DECISIONS.md) (sessions, import jobs), [D-109](DECISIONS.md) (synchronisation).

---

## A. Root causes

### A1. Refreshing the website signed the user out

- **Cause:** the session was never lost; the page did not ask for it.
  - `src/renderer/src/App.jsx` `checkStartup()` always ended on the sign-in screen. Its rule G-16 ("the till always starts locked") is right for the desktop till, and was applied to the browser too.
  - The browser's session is an HTTP-only cookie that page scripts cannot read, and nothing asked the service whether it was still valid.
- **Evidence:**
  - the cookie (`hm_session`, `Path=/api; HttpOnly; SameSite=Strict; Secure; Max-Age=43200`) and the `sessions` row both stayed valid after a reload;
  - `auth.me` with the same cookie answered 200;
  - no code path revoked the session on unload.
- **Not the cause:** cookie attributes, CORS (same origin), the proxy, `credentials`.

### A2. Large Excel imports "run for a long time and then do nothing"

Two independent causes.

1. **The file never finished reading.** This is the main cause, and it hit the desktop program too, before pairing.
   - read-excel-file and write-excel-file use fflate, which hands any part of an `.xlsx` larger than 512 KB uncompressed to a `Worker` made from a `blob:` URL (`fflate/esm/browser.js`, `wk`).
   - The production Content-Security-Policy (G-15: `script-src 'self' 'sha256-…'`, no `worker-src`), shared by the desktop and web builds, refuses that worker.
   - fflate sets no error handler, so its callback never fires and `readExcelFile()` never settles. The screen stays on «جارٍ قراءة الملف وفحصه…» indefinitely, with no error and nothing sent to the service.
   - Roughly 1,000 product rows reach 512 KB.
   - **Evidence:** in a real Chromium against the built pages, a 3,000-row file stayed on that message for more than 60 s, and no `storeImport.apply` request was ever made (network log). With the fix the same file is read and checked in 0.3–0.6 s.
2. **The import was one long request with fixed waits on the way.**
   - `storeImport.apply` validated and wrote everything inside one HTTP request (`src/server/modules/storeImport.js`), row by row: about 2 queries per product, 10,272 queries for 5,000 products.
   - **The desktop program on the shop PC** calls its service in-process, with no timeout, so this alone did not break the desktop. Any request that outlives one of the waits below, however:
     - a second till in client mode gives up after 15 s (`src/main/backend.js`);
     - the website waits 20 s for the shop's answer (`cloud/link.js` `forwardMs`);
     - and the shop counts as gone after 40 s without contact (`linkGraceMs`), while the shop's link loop is busy running the import.
   - The screen then showed «لم يتم الاستيراد» for an import that went on and finished.

### A3. Offline sales took about five minutes to reach the cloud

- **Cause** (`src/server/sync/agent.js` `start()`):
  - the regular cycle waits 15 s × 2^failures between attempts, capped at 5 minutes;
  - offline, every cycle and every immediate push after a sale fails, so the wait grows to the cap;
  - when the internet returned, the open link noticed, but sent nothing unless the cloud had an operation for the shop (`linkOnce`). The queued changes waited for the next cycle.
- **Measured** (`scripts/bench/offline-sync.js`, agent with production timings): 2 invoices = 13 changes after an 8-minute outage.
  - **first request 210.7 s after the return;**
  - **all confirmed at 211.1 s;**
  - one push of 13 rows taking under half a second.

  The event count was never the problem.

### A4. Found while testing: a large first synchronisation lost packages on the cloud

- **Cause:**
  - `hm_sync_snapshot()` (migration 0032) queued tables alphabetically, so `product_barcodes` and `product_units` came before `products`;
  - a first send spans many batches (4,000 rows each). A package arriving a batch before its product failed its foreign key on the cloud (`merge.js`), was skipped without a log line, and was acknowledged;
  - the periodic comparison is computed from what the cloud _received_ (`cloud_rows`), not from its tables, so it never noticed.
- **Measured:**
  - 51,750 products with 5,175 packages, imported unpaired and then paired: the cloud held every product and **0** packages and **0** package barcodes;
  - reproduced with 3,000 products and 1,500 packages.
- **Scope:** any shop whose first send exceeds one batch. Changes made one by one are not affected.

---

## B. Changes

| Area           | Change                                                                                                                                                                                                                                                                                                                                                                                   | Files                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Session        | `auth.session`: the sign-in answer from the cookie alone; no new session, no token. The start-up screen stays until it answers; 401/403 → sign-in screen; 503 → retried, never "signed out"                                                                                                                                                                                              | `src/server/modules/auth.js`, `src/renderer/src/lib/sessionResume.js`, `App.jsx`                                 |
| Excel reading  | `fflate` resolved to a main-thread version of `unzip`/`zip` in both builds; the CSP is unchanged                                                                                                                                                                                                                                                                                         | `src/renderer/src/lib/fflateMainThread.js`, `electron.vite.config.mjs`, `vite.web.config.mjs`                    |
| Import jobs    | `imports.start/get/list/cancel`; migration **0038** (`import_jobs` synchronised, `import_job_data` local); runner with one PostgreSQL advisory lock per database; one transaction per job (all or nothing, as before); progress on a separate connection; retry, crash and restart recovery; "committed" mark so a stop between commit and bookkeeping never writes twice                | `src/server/modules/imports.js`, `src/server/imports/runner.js`, `src/server/db/migrations/0038_import_jobs.sql` |
| Bulk writing   | Check and write split out of `storeImport.apply`; products, packages, barcodes and opening stock inserted 250 rows per statement; categories in one statement; one barcode lookup per file. Row triggers (ledger, change capture, customer codes) unchanged                                                                                                                              | `src/server/imports/storeData.js`, `src/server/modules/storeImport.js`                                           |
| Import screen  | Real progress (rows, stage, elapsed, time left once estimable); "trying again" on a failed request, never "failed"; a lost start is re-sent with the same id; a running job found again after reload, tab close or restart; cancel; history; xlsx error report with formula-like cells made text; files over 20 MB refused                                                               | `ImportTab.jsx`, `src/renderer/src/lib/importJob.js`, `components.css`                                           |
| Sync agent     | On the link's return: changes sent at once, cycle restarted; link retry ≤ 10 s; cycle backoff ≤ 60 s; log lines for every push (rows, batches, ms) and every return                                                                                                                                                                                                                      | `src/server/sync/agent.js`                                                                                       |
| Snapshot order | Migration **0039**: `hm_sync_table_order()` (parents first by foreign keys), used by `hm_sync_snapshot()`; the cloud logs rows it cannot apply, per table                                                                                                                                                                                                                                | `0039_sync_snapshot_order.sql`, `src/server/sync/merge.js`, `src/server/cloud/link.js`                           |
| Security       | Job visible to its starter and administrators only ("not found" otherwise, id is not a key); `data.import` on all four; filename reduced to its last segment without control characters; one job at a time per store (refused with the reason); same content noticed (`already_imported`, explicit confirmation needed); no server-side XLSX parsing (no zip-bomb surface on the server) | `imports.js`                                                                                                     |
| CI             | Browser E2E in the Linux job; desktop E2E (up to 5,000 rows) in the Windows job                                                                                                                                                                                                                                                                                                          | `.github/workflows/ci.yml`                                                                                       |

**Deployment consequence:** migrations 0038 and 0039 change the schema. The shop and the cloud refuse to synchronise with different schemas (D-105), so the cloud and the shop PC must both move to 1.6.3.

---

## C. Import performance

### Desktop program, never paired, no cloud (real window, `scripts/e2e/desktop.js`)

|   Rows |   File | Read + check | Import (start → "تم الاستيراد") | Rows/s |
| -----: | -----: | -----------: | ------------------------------: | -----: |
|     50 |  10 KB |       0.30 s |                          0.60 s |     83 |
|    200 |  17 KB |       0.17 s |                          1.77 s |    113 |
|    500 |  31 KB |       0.27 s |                          1.65 s |    304 |
|  3,000 | 144 KB |       0.59 s |                          6.14 s |    489 |
|  5,000 | 234 KB |       0.48 s |                          7.91 s |    632 |
| 10,000 | 461 KB |       1.08 s |                          27.6 s |    362 |
| 20,000 | 901 KB |       2.16 s |                          48.8 s |    410 |

- Each file was imported into the same database after the previous ones (51,750 products in the end).
- Below 500 rows the time is mostly the screen's polling.
- **Before:** files above roughly 1,000 rows never finished reading (A2.1), so there is no "before" time to compare.

### Stage by stage (service and Node, development PC, synthetic 5,000 products)

| Stage                                                                |                 Before |                             After |
| -------------------------------------------------------------------- | ---------------------: | --------------------------------: |
| Read the workbook (unzip + XML)                                      |                 0.30 s | 0.30 s (now on the page's thread) |
| Header mapping + normalisation (`readWorkbook`)                      |                 0.04 s |                            0.04 s |
| Validation incl. duplicate detection (`checkRows`, 1 query per file) |                 0.17 s |                       0.07–0.09 s |
| Database writes                                                      | 12.9 s, 10,272 queries |                 5.1 s, 89 queries |
| Commit                                                               |                      – |                          < 0.01 s |
| Memory (heap growth)                                                 |                      – |                       about 10 MB |

- **Batch size:** 100, 250 and 500 rows per statement differ by under 10% (5.2, 5.1–5.4 and 5.0–5.3 s). 250 was kept.
- **What remains:** the row triggers, which must stay:
  - stock ledger;
  - change capture: 13,682 outbox rows for 5,000 products;
  - the product row updated by its opening movement.

### Synchronisation after pairing (separate from the import)

| Store                                                 | Records in the first send |                                                                                            Duration |
| ----------------------------------------------------- | ------------------------: | --------------------------------------------------------------------------------------------------: |
| 51,750 products (before the A4 fix; packages missing) |                  ≈ 97,700 |                                                                                429 s (≈ 230 rows/s) |
| 21,750 products with 2,175 packages (after the fix)   |                  ≈ 40,000 | 117 s (≈ 350 rows/s); every product, package and package barcode on the cloud, both sides identical |

---

## D. Reliability (failure injection)

| #     | Scenario                                                                           | How tested                                                                                                                                 | Result                                                                                                               |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 1     | 5,000 rows                                                                         | desktop E2E; service tests                                                                                                                 | completed; counts equal the file                                                                                     |
| 2     | Refresh right after the start                                                      | browser E2E (3,000); desktop E2E (3,000)                                                                                                   | job found again and followed to the end                                                                              |
| 3     | Browser closed while processing                                                    | browser E2E (tab closed, reopened)                                                                                                         | continued on the server; completed once                                                                              |
| 4–5   | Internet lost for a while, then back                                               | browser E2E (`setOffline`)                                                                                                                 | "trying again" shown, never "failed"; completed                                                                      |
| 6–7   | Service / program stopped during an import                                         | `importJobs.test.js`; desktop E2E (program closed at row 1,000)                                                                            | nothing kept; resumed at next start; each product once                                                               |
| 6–7   | Process killed outright                                                            | `importJobsCrash.test.js` (separate process, SIGKILL at row 1,000 of 2,000); desktop E2E (whole program tree killed at row 2,000 of 5,000) | nothing kept; next start completed it, attempt 2; each product and movement once                                     |
| 8     | Two imports at once                                                                | `importJobs.test.js`                                                                                                                       | second refused `import_running` with the running file's name                                                         |
| 9     | Same file twice                                                                    | `importJobs.test.js`                                                                                                                       | `already_imported`; confirmed anyway → every barcode reported, nothing duplicated                                    |
| 10    | Cancel while processing                                                            | `importJobs.test.js`                                                                                                                       | everything undone; `cancelled`                                                                                       |
| 11–15 | Malformed file, missing headers, duplicate barcodes, invalid prices, unknown kinds | `storeImport.test.js`, `importJobs.test.js`                                                                                                | job `failed`, every problem by row and column, nothing written                                                       |
| 16    | Thousands valid + a few invalid                                                    | `importJobs.test.js` (300 rows, 5 bad)                                                                                                     | 5 rows reported, nothing written (the documented all-or-nothing rule)                                                |
| 17    | Constraint failure mid-import (barcode saved meanwhile at a till)                  | `importJobs.test.js`                                                                                                                       | `failed`/`conflict` with the reason; only the till's product exists; a sale during the import completed in under 3 s |
| 18    | Storage failure                                                                    | lost database connection mid-import (`pg_terminate_backend`)                                                                               | retried, completed on attempt 2, once                                                                                |
| 19    | Client timeout while the server continues                                          | lost answer to `imports.start` → re-sent with the same id                                                                                  | one job (idempotent start, tested)                                                                                   |
| 20    | Retry never duplicates                                                             | every case above                                                                                                                           | product counts equal the file                                                                                        |
| 21    | Backup restored while an import waits (review P1)                                  | `importJobsCrash.test.js`                                                                                                                  | the import is cancelled with the restore; nothing of the old file is written                                         |
| 22    | Cancelled at the moment the runner claims it (review P2)                           | `importJobsCrash.test.js`                                                                                                                  | stays cancelled; the next import starts                                                                              |

---

## E. Authentication (real browser, `scripts/e2e/browser.js`)

| Check                                                        | Result           |
| ------------------------------------------------------------ | ---------------- |
| Sign in; reload: still signed in, sign-in screen never shown | ✔                |
| Four more reloads; no new session row                        | ✔                |
| API requests right after a reload (3 at once)                | ✔ 200, 200, 200  |
| No sign-in screen while the session is checked               | ✔                |
| Second tab shares the session                                | ✔                |
| Tab closed and opened again                                  | ✔                |
| Browser closed and started again (persistent profile)        | ✔                |
| Sign-out in one tab → the other at its next load             | ✔                |
| Expired session                                              | ✔ sign-in screen |
| Revoked session                                              | ✔ sign-in screen |
| Forged cookie                                                | ✔ sign-in screen |

Service level: `sessionResume.test.js` (reloads, concurrent tabs, cookie without our header, malformed, expired, revoked, sign-out).

---

## F. Data integrity

- **Every import test compares the job's figures with the database:** products, packages, opening movements, categories, and that no rows were left in `import_job_data`.
- **Desktop run:** 51,750 products imported across 10 jobs, including 3 that were interrupted. Products 51,750; packages 5,175; opening movements 36,225; products whose stock differs from their ledger: 0; jobs not completed: 0.
- **Cloud paths** (`importJobsCloud.test.js`):
  - started from the website with the shop connected: run in the shop, followed on the cloud, both sides identical record by record;
  - with the shop unreachable: run on the cloud, received by the shop once, nothing listed for attention.

---

## G. Tests

| Suite                                                                                                                 | Result                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` (unit + service + migration, PostgreSQL 17)                                                                | 563 tests: 560 passed. The 3 that failed were bookkeeping for the new operations (operation count, the open-operations list, the generated permission matrix); fixed, and those files pass                |
| New: `sessionResume.test.js` / `.mjs`                                                                                 | pass                                                                                                                                                                                                      |
| New: `importJobs.test.js` (7), `importJobsCloud.test.js` (2), `importJobsCrash.test.js` (2), `importJob.test.mjs` (3) | pass                                                                                                                                                                                                      |
| New: `syncReconnect.test.js`                                                                                          | pass; **fails on the former agent** (checked)                                                                                                                                                             |
| New: `syncSnapshotOrder.test.js` (2)                                                                                  | pass                                                                                                                                                                                                      |
| Existing sync/cloud suites (38 tests) after the agent change                                                          | pass                                                                                                                                                                                                      |
| `scripts/e2e/browser.js`                                                                                              | 19/19 on the final code                                                                                                                                                                                   |
| `scripts/e2e/desktop.js`                                                                                              | 12/12 on the final code (50–5,000 rows, reload, close, kill, integrity, pairing and first send); 13/14 earlier with 10,000 and 20,000 rows, where the one failure was A4, found by that run and now fixed |
| Lint / format                                                                                                         | 0 errors / clean                                                                                                                                                                                          |

---

## Synchronisation report (issue 3)

### Offline invoices: before and after

The agent ran with production timings. Each invoice has 1–4 lines; every fifth is on account to a customer; the rest are cash or card, with shift and drawer effects. Outage: 2 minutes, except where noted.

|                     Invoices | Changes (measured) | Per invoice | First request after the return | All confirmed | Changes/s | Requests | Push batches (rows)   | Both sides identical |
| ---------------------------: | -----------------: | ----------: | -----------------------------: | ------------: | --------: | -------: | --------------------- | -------------------- |
| 2 (8-min outage, **before**) |                 13 |         6.5 |                    **210.7 s** |   **211.1 s** |         – |       12 | [13]                  | yes                  |
|      2 (8-min outage, after) |                 13 |         6.5 |                          5.0 s |         5.4 s |         2 |        4 | [13]                  | yes                  |
|                            2 |                 13 |         6.5 |                          4.4 s |         4.8 s |         3 |        4 | [13]                  | yes                  |
|                           10 |                 94 |         9.4 |                          4.4 s |         4.9 s |        19 |        4 | [94]                  | yes                  |
|                           50 |                494 |         9.9 |                          4.5 s |         5.7 s |        87 |        4 | [494]                 | yes                  |
|                          100 |              1,000 |          10 |                          4.6 s |         6.6 s |       152 |        5 | [505, 495]            | yes                  |
|                          500 |              5,004 |          10 |                          4.5 s |        13.6 s |       368 |       13 | 10 batches of 496–505 | yes                  |

- **Where the time goes now:**
  - about 4.5 s until the link's next retry notices the internet is back (retries at most every 10 s while offline);
  - then sending at about 370 changes per second through the in-process link.
- **Failed requests after the return:** 0 in every run.
- **The one-invoice-many-changes question:** an invoice is one database transaction (sale, its lines, stock movements, drawer, customer balance). Its rows travel together in one batch (`nextBatch` keeps a transaction whole), and the cloud applies a batch in one transaction. Nothing was split or removed to gain speed.

### Correctness under failure (existing and new tests)

| Scenario                                                | Covered by                                                                                                                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud commits, the answer is lost; the same batch again | `cloudApart.test.js` "never twice from the cloud: a lost acknowledgement and a failure half way through a batch"; the cloud keeps the newest version per row, so resent rows are no-ops |
| Cloud restarted / failure inside a batch                | same, plus `sync.test.js`; the cloud applies each batch in one transaction                                                                                                              |
| Desktop restarted with pending changes                  | the outbox is durable; acknowledged only after the cloud's answer (`push`); `syncService.test.js`                                                                                       |
| Two agents                                              | one link lock and one cycle lock per database (`holdLink`, `runOnce`); `syncService.test.js`                                                                                            |
| Invalid row in a batch                                  | skipped with a log line on the cloud (new), listed for attention on the shop                                                                                                            |
| Rows that depend on later rows                          | multi-pass within a batch; first sends now parents first (0039)                                                                                                                         |

### Remaining bottlenecks and risks

1. **The first send of a large store is slow:** about 230 rows per second on the cloud. The cloud applies each row with its own savepoint and field-by-field merge (`merge.js`). 100,000 records take about 7 minutes. This is a one-off, after pairing or a restore; the shop sells normally meanwhile. Bulk application on the cloud is possible, but changes the merge path and needs its own work.
2. **The comparison of the two sides cannot see a row the cloud skipped:** it uses `cloud_rows`. Skips are now logged, not detected. A comparison from the cloud's tables would close this.
3. **While a large import runs, saving a product at a till waits until it commits:** the catalogue version row is held. Sales are not affected (measured: a sale during an import completed in under 3 s). Seconds for 5,000 rows; about 50 s for 20,000.
4. **Import time grows faster than the row count beyond 5,000 rows** (10,000: 27.6 s; 20,000: 48.8 s) in a database that already holds tens of thousands of products. Likely index growth and an unpaired PC's outbox, which keeps every captured change until the first pairing replaces it with one snapshot (135,149 rows waiting in the desktop run). Not investigated further; 20,000 rows, the most one file may hold, still completed in under a minute.
5. **Not measured:** a real shop PC's disk and CPU, real internet latency (the benchmark has a `--latency` option, not used in these figures), and a real power cut. The kill tests stand in for the last.

## H. Remaining risks

The five points above, and:

- **The cloud and the shop PC must both be updated to 1.6.3** (schema 0039) before they synchronise again.
- **The website imports through the shop while it is connected.** The job's progress reaches the website at the speed of the shop's synchronisation, normally seconds.

## I. Verdict

**READY WITH DOCUMENTED LIMITATIONS**, for review. Not deployed, not released.

## J. Note on the cloud server

A read-only check on 2026-11-14 found the cloud's database empty: 0 stores, 0 products, 0 received rows. On 2026-11-13 it held the paired shop (1 store, 135 products). It was emptied in between, most likely with `reset-empty.sh`. The shop PC is therefore not paired with the website now and needs a new pairing code. It should be paired again only after both sides run 1.6.3: a first send larger than one batch would hit A4 on 1.6.2.
