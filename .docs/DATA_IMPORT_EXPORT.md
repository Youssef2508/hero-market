# HeroMarket data: import, export and backup

Written for whoever changes HeroMarket's data model. HeroMarket has one way to move a store's master data in and out: its own Excel template. There is no importer for any other POS program (owner, 2026-10-22, D-067).

## 1. The three tools and what each is for

| Tool              | What it carries                                                                   | Who (permission, granted per role by an administrator) | Use                                                              |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| Import (template) | New products (with stock and one package), customers, suppliers, opening balances | `data.import`                                          | Set up a new store; add many records at once                     |
| Export (template) | The same sheets and columns, filled from the store                                | `data.export`                                          | Review or edit in Excel; move master data to a new or test store |
| Backup / restore  | Every business table, all history, row for row                                    | `backup.manage`                                        | Safety copy; moving a whole store; recovery                      |

By default only the administrator roles (مدير النظام, مدير المتجر) hold `data.import`, `data.export` and `backup.manage`. A supervisor (مشرف) does not get import or export until an administrator grants them. Export does not imply import. Each export is written to the activity log with its counts only.

## 2. The template

Defined once in `src/shared/storeImport.mjs` (`SHEETS`), used by the template download, the export, the file reader and the tests. Headers are matched by name, so column order does not matter.

**Version marker:** the instructions sheet (`تعليمات`) holds `إصدار القالب | 2`. A file of a newer version than the program is refused with a clear message. A file without a version (1.4.0 templates) is version 1 and imports unchanged.

### الأصناف (products)

| Column                | Key               | Required       | Notes                                                                                |
| --------------------- | ----------------- | -------------- | ------------------------------------------------------------------------------------ |
| الباركود              | `barcode`         | no             | Text (leading zeros kept). Empty: an internal code HM000001… is given                |
| اسم الصنف             | `name`            | yes            |                                                                                      |
| سعر البيع             | `retail_price`    | yes            | Price of one base unit                                                               |
| سعر الشراء            | `cost_price`      | no             | Cost of one base unit. The export writes the current moving-average cost             |
| سعر الجملة            | `wholesale_price` | no             | Wholesale price of one base unit                                                     |
| الكمية الحالية        | `stock_qty`       | no             | In the base unit; written as an opening stock movement                               |
| الوحدة                | `unit`            | no             | The base unit's name                                                                 |
| طريقة القياس          | `unit_kind`       | no             | بالعدد / بالوزن / بالحجم or a kind the owner added; empty = from the unit            |
| التصنيف               | `category`        | no             | Created when new                                                                     |
| حد الطلب              | `reorder_limit`   | no             |                                                                                      |
| اسم العبوة            | `pack_name`       | no (v2)        | One package of the product (carton, box…). All package columns are optional together |
| عدد الوحدات في العبوة | `pack_factor`     | with a package | Whole number for counted products; > 1                                               |
| باركود العبوة         | `pack_barcode`    | no             | Text; unique in the file and the store                                               |
| سعر بيع العبوة        | `pack_price`      | with a package | The owner's price for the whole package, never derived (D-065)                       |
| سعر جملة العبوة       | `pack_wholesale`  | no             |                                                                                      |
| سعر شراء العبوة       | `pack_cost`       | no             | Default cost when buying that package                                                |

### العملاء (customers)

The customer code (C00012) is generated by the store and is not a template column (D-072): imported customers get new codes.

`اسم العميل` (required), `الهاتف`, `هاتف آخر`, `العنوان` (the default address), `المبلغ المستحق على العميل` (negative = credit). The balance is an opening ledger line.

### الموردون (suppliers)

`اسم المورد` (required), `الهاتف`, `العنوان`, `اسم المسؤول`, `المبلغ المستحق للمورد`. The balance is an opening ledger line.

## 3. Import rules

- Every row is checked before anything is written: required fields, numbers, signs, the measurement kind and its decimals, package rules (the same as the units window), duplicate barcodes and phones in the file and in the store. One error anywhere writes nothing. The screen shows a preview first (`dryRun`).
- Import only adds. A barcode or phone already in the store is reported, never overwritten. No history (sales, ledgers, shifts) is touched.
- One transaction; stock arrives as `opening` movements, so the stock ledger stays exact.

## 4. Export rules

- One read-only snapshot (`REPEATABLE READ`), so the file is one consistent moment. The database is not changed (only the activity log entry).
- The file is built, then read back with the import reader and compared (no errors, same row counts) before it is saved. A failed check saves nothing and says why.
- Deterministic order: products by barcode, customers and suppliers by id.
- No passwords, PINs, sessions, settings or users are exported.

**Not exported (the backup keeps them):**

- history: sales, returns, purchases, purchase returns, preliminary invoices, shifts, drawer and treasury movements, expenses, damaged goods, ledgers;
- inactive products;
- a product's extra barcodes for its base unit;
- packages beyond the largest one of a product.

The export screen shows how many of these were left out. A product's stock, cost and balances are exported as current values, so re-importing them gives the same figures as opening balances, not the history behind them.

## 5. Backup and restore

- `src/server/modules/backup.js#TABLES` lists every business table in foreign-key order. Every table of the schema is either in that list or in `NOT_BACKED_UP` in `tests/service/backupAudit.test.js`, with its reason (sessions, schema version, sync bookkeeping, a cache counter). A new table that is in neither fails the test.
- A restore accepts only a backup of the same schema version, runs in one transaction (any failure changes nothing), keeps foreign keys enforced, and resets the id sequences.
- The nightly backup (`NIGHTLY_BACKUP.md`) keeps its midnight schedule, catch-up after downtime, retention and safety checks; it uses the same snapshot.
- **Known gap:** `applied_commands` (cloud commands already applied) is not in the backup; after a restore the new sync epoch (D-047) governs. Cloud sync is not in use at the shop. Settle this before it is.

### Between versions (1.4.0 → 1.5.0)

- A template filled for 1.4.0 (template version 1) reads in 1.5.0 unchanged. Tested on a real `.xlsx` written from 1.4.0's own template code.
- The shop updates in place: its data is already in the database, and the update keeps it. Importing the same file into a store that has its records is refused as a whole ("مسجل بالفعل"), and nothing is written.
- A backup restores only into the same database version: a 1.4.0 backup file into 1.4.0, a 1.5.0 copy into 1.5.0.

## 6. Checklist when a feature changes the data model

For every added, removed or renamed field or table:

1. **Migration:** forward only, one transaction, existing rows unchanged or backfilled explicitly; a test over a database with existing data (`moneyMigration.test.js` style).
2. **Backup:** new tables in `TABLES` in FK order, in `system.reset`, and in `sync_tables` with the capture trigger when synced. `backupAudit.test.js` must stay green.
3. **Template, import and export:** if the field belongs to a product, customer or supplier, add it to `SHEETS` as optional, read it in `storeImport.apply`, write it in `storeExport.data`, and extend `dataExport.test.js`. Never make an optional field required, rename or remove a column without raising `TEMPLATE_VERSION`.
4. **Reports and reconciliation:** update `FINANCIAL_RECONCILIATION.md` when money moves.

## 7. Tests

| Test                                    | Proves                                                                                                                                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/service/dataExport.test.js`      | The export is the template (sheets, headers, version, text barcodes); a real .xlsx imported into an empty store gives identical products, packages, customers and suppliers; left-out items are counted; package validation; version rule; separate permissions granted per role |
| `tests/service/backupAudit.test.js`     | Every table accounted for; a store using every feature restores row for row (content fingerprints), with equal balances and stock, and keeps working; a failing restore changes nothing; another schema version is refused                                                       |
| `tests/service/storeImport.test.js`     | Import validation, all-or-nothing writing, opening balances and movements                                                                                                                                                                                                        |
| `tests/service/scheduledBackup.test.js` | The nightly backup, catch-up, retention and restore                                                                                                                                                                                                                              |
| `tests/service/moneyMigration.test.js`  | Migrations 0016, 0018 and 0020 over existing data                                                                                                                                                                                                                                |
