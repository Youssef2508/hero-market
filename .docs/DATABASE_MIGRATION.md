# Database Migration: SQLite to PostgreSQL

Versions up to 1.3 kept each store's data in one SQLite file. This document covers how that data moves to PostgreSQL, how parity is proven, and how to go back. The code is `src/server/db/legacy-import.js` (`importLegacy`, `verifyParity`, `rebrandStoreName`), driven automatically by the app (`src/main/backend.js#importLegacyIfPresent`) or manually by `scripts/import-sqlite.js`.

## 1. Source inventory

| Source                             | Location                                                                     | Notes                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Installed store (v1.3 and earlier) | `%APPDATA%\elnagdi-pos\market_unified.db` (+ `-wal`, `-shm`)                 | Folder name from the original code base. HeroMarket only **reads** it.                                   |
| Development fixture                | `market_unified_testing.db`, or any file made by `npm run db:legacy-fixture` | `scripts/init-dev-db.js` builds the original schema with sample data using Node's built-in SQLite engine |

Schema: the 19 tables of the original application, listed in [DATA_MODEL.md](DATA_MODEL.md):

- **Business data:** `users`, `products`, `clients`, `client_ledger`, `shifts`, `sales`, `sale_items`, `suppliers`, `supplier_ledger`, `supplier_purchases`, `checks_register`, `expenses`, `damaged_goods`.
- **Tills:** `momkn_transactions`, `mobile_money_transactions`, `safe_ledger`.
- **Settings, audits and logs:** `settings`, `shift_audits`, `system_logs`.

The importer refuses a source whose columns are not all present in the target, so no field can be silently dropped.

## 2. Procedure (what `importLegacy` does)

1. **Read-only open.** The file is opened with `node:sqlite` in read-only mode and `PRAGMA integrity_check` must return `ok`. Its SHA-256 is recorded.
2. **Verified backup.** The `.db`, `-wal` and `-shm` files are copied to the backup folder and each copy is compared byte for byte (the app uses `%APPDATA%\HeroMarket\backups\legacy-sqlite`).
3. **Target check.** The target must already be migrated (the app runs migrations first) and must hold no data. If it has data, the importer refuses ("Refusing to overwrite"), unless this exact file (same SHA-256) was imported before. In that case it only re-verifies parity.
4. **Conversion, then validation.** Every row is converted by column type:
   - `REAL` becomes the shortest exact decimal string of the stored binary value. For example 0.1 + 0.2 is stored as `0.30000000000000004`, not rounded.
   - Local times are kept as written, and a date-only value becomes `00:00:00`.
   - Any value that cannot be converted, and any orphan row (a foreign key without its parent), stops the import before anything is written.
5. **One transaction.** All rows are inserted with their **original ids**, with the business triggers disabled for the copy (historic sales on closed shifts are valid history). Each table's id sequence then continues from the higher of `max(id)` and SQLite's `sqlite_sequence`, so a deleted id is never reused.
6. **Parity inside the transaction.** For every table, source and target rows are put into a canonical form and compared: row count, SHA-256 of all rows, and the first mismatches. Any difference rolls everything back.
7. **Commit**, then a foreign-key re-check of every declared relation (must be 0 violations). A row in `legacy_import_runs` stores the full report.
8. **Store name (owner decision, 2026-10-14).** If the store name is exactly the default name shipped by version 1.3, it becomes `"هيرو ماركت"`. The change is logged (`settings_update`, previous value in the log details) and runs once. Any other name is kept. `scripts/import-sqlite.js --keep-store-name` skips this step.

Users then log in with their **existing PINs**. On the first login a legacy SHA-256 or plain-text PIN is verified and replaced by the HMAC lookup key plus a scrypt hash. Legacy roles map to `admin` → `super_admin`, `manager` → `manager` and `cashier` → `cashier`.

## 3. Running it

**Automatically (installed app).** On first start in local mode, if the old file exists and the new database is empty, the app imports it while the start screen shows "جاري تجهيز قاعدة البيانات". The report is saved as `%APPDATA%\HeroMarket\backups\legacy-import-<time>.json`.

If anything fails, start-up stops with the reason: "تعذر نقل بيانات النسخة السابقة… لم يتم تعديل ملف البيانات القديم". Nothing is half-imported.

**Manually (server, or a second attempt):**

```powershell
# dry run: full conversion and parity check, then roll back
node scripts/import-sqlite.js --sqlite C:\path\market_unified.db --database-url $env:HEROMARKET_DATABASE_URL --dry-run
# real import, with backup folder and JSON report
node scripts/import-sqlite.js --sqlite C:\path\market_unified.db --database-url $env:HEROMARKET_DATABASE_URL `
  --backup-dir D:\backups\legacy --report D:\backups\import-report.json
```

The script exits with code 0 only if parity passed and no foreign-key violations were found. It prints a per-table `source / target / match` table.

## 4. Evidence

| Run                                                         | Source                                                                     | Result                                                                                                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development DB (2026-10-13)                                 | `market_unified_testing.db`                                                | 19/19 tables match. Users 4, products 9, clients 2, shifts 4, sales 2, sale items 3, settings 3, logs 6. 0 FK violations.                                                                            |
| Installed store copy (2026-10-13)                           | `%APPDATA%\elnagdi-pos\market_unified.db`                                  | 19/19 tables match. Source SHA-256 `3408e70a…` unchanged before and after.                                                                                                                           |
| Upgrade through the real app (2026-10-14)                   | Copy of the installed file in a scratch data folder, app in local mode     | Cluster created, import parity true, store name updated, legacy PIN `1234` logged in and was upgraded to scrypt. A restart did not import again.                                                     |
| Automated (`tests/service/migration.test.js`, every CI run) | Fixture with binary floats, quotes, NULLs, a deleted id and a closed shift | Dry run, exact values, verified backup, unchanged source, idempotent re-run, sequence high-water mark, legacy PIN upgrade, refusal of non-empty targets, invalid values and orphans, store-name step |

## 5. Rollback

The old SQLite file is never modified, so going back is always possible:

1. Uninstall HeroMarket and reinstall the previous version's installer. It reads `%APPDATA%\elnagdi-pos\market_unified.db` exactly as before the upgrade.
2. **Sales and changes made after the upgrade are only in PostgreSQL.** Before rolling back, export them (النسخ الاحتياطي → حفظ نسخة) and keep the file. Re-entering them in the old version is manual.
3. To retry an upgrade:
   - Stop HeroMarket.
   - Move `%APPDATA%\HeroMarket\pgdata` aside. Do not delete it until the retry is verified.
   - Remove `local` from `%APPDATA%\HeroMarket\heromarket.json`; otherwise the app refuses to start without its cluster.
   - Start the app again: a fresh cluster is created and the import runs again.

## 6. What is intentionally not migrated

- No schema objects are dropped or renamed: the 19 tables keep their names and columns. New features live in new tables and columns.
- `users.password_hash` is copied as it was. On each user's first login PostgreSQL replaces it with the keyed hash and sets the column to NULL. The SQLite file keeps the original values, so after a rollback the previous version still accepts everyone's old PIN.
- Data outside the SQLite file (printer driver settings, Windows shortcuts) is unaffected.
