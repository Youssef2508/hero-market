# Updating HeroMarket at the supermarket (every release after 1.4.0)

Written for you, the developer, and for whoever installs updates at the shop. It describes what exists in 1.4.0 and what was tested. Anything not done yet is marked.

## 1. What kind of update system this is

- **Updates are manual.** You run a new installer on the cashier PC. HeroMarket has **no automatic update**: it never downloads or runs anything by itself.
  - The `publish` address in `electron-builder.yml` is a placeholder and is not used.
  - Do not switch on automatic updates without signing and an authenticated update source.
- **One installer does everything, as administrator:**
  1. It refuses to start while HeroMarket is open on any Windows account.
  2. It stops the database service.
  3. It makes a **verified copy** of the database (`C:\ProgramData\HeroMarket\backups\pre-install`, the newest 3 kept, plus the newest copy of each of the last 3 data versions, so the copy from before a database update is never pushed out by later installer runs).
  4. It replaces the program files.
  5. It updates the database if needed (Case B), checks it, and **puts the copy back by itself if anything is wrong**.
  6. It writes the result to `logs\update-history.jsonl` and `logs\setup.log`.
- **The program never changes the database by itself** on an installed PC. It also refuses a database that a newer version has already changed, so an older program cannot damage it.

## 2. The two kinds of release

|                                                       | Case A: program only                                          | Case B: database change                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When                                                  | No new file in `src/server/db/migrations/`                    | One or more new migration files                                                                                                                                                                                                                                               |
| Example                                               | A new report screen that reads existing tables; a fixed label | A new column or table (for example the invoice photo in 1.4.1)                                                                                                                                                                                                                |
| What the installer does to the data                   | Nothing beyond the verified copy (the history shows "Case A") | Applies the migrations. It then checks that no table lost rows, that the totals of stock, sales, customer and supplier balances and the drawer are unchanged, that stock equals its movements, and that no reference is broken. On any problem it puts the verified copy back |
| Can the previous version use the database afterwards? | **Yes**                                                       | **No.** The previous program refuses a newer database. Going back means restoring the copy (§6), which loses sales made after the update                                                                                                                                      |
| Release notes must say                                | "No database change"                                          | Which migrations, why, and that going back needs the copy                                                                                                                                                                                                                     |

**Never** reset, recreate or replace the production database in a routine update. Migrations only add or change; they do not drop data. A migration that must remove something needs its own written decision.

## 3. Rules for writing migrations (developer)

- Use **one new file per change**, numbered after the last one (`0014_…sql`, `0015_…sql`).
- **Never edit an applied migration**: the checksum check refuses it at the shop.
- Each file runs in **one transaction**. If any statement fails, the whole file is undone (tested: `tests/service/upgrade.test.js`).
- **Only add:** new tables, new columns with defaults, new indexes, new triggers. Moving data is allowed only when no row or total changes; the installer's checks enforce this.
- Test the migration on a **copy** of real-sized data before release (§4 step 3).

## 4. Step by step, for every release

| #   | Who                     | What                                                                                                                                                                                                                                                 | Evidence                             |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | You                     | Describe the change (for example "add a report X"). Decide the business rules.                                                                                                                                                                       | A written request or spec in `.docs` |
| 2   | Claude                  | Build it on a **branch**, never on `main`, with tests. Development uses its own test databases (`npm run pg:dev`), never the shop's.                                                                                                                 | Commits on the branch                |
| 3   | Claude                  | **Checks:** `npm test`, lint, format, build. For Case B, run the migration on a copy of a full-size store (the shop's backup copy, or the large test store) and compare before and after (`dataFingerprint` / `integrityProblems`).                  | Counts in the PR                     |
| 4   | Claude                  | **Version and notes:** raise the version (`npm version 1.4.1 --no-git-tag-version`). Write the release notes with the **update case** (A or B), the migrations, and whether the previous version can still open the data.                            | `.docs/RELEASE_NOTES_<version>.md`   |
| 5   | Claude                  | **CI:** open the PR; Linux, Windows and Docker CI must be green.                                                                                                                                                                                     | PR checks                            |
| 6   | Claude                  | **Clean-Windows update test** (Windows Sandbox): install the version in use at the shop, add data, run the new installer over it, and check every record is kept. For Case B also test a **failing** migration: the copy must be put back by itself. | Results in the PR                    |
| 7   | You                     | **Trial** on your laptop: install the new version **over** the old one, sell, check reports.                                                                                                                                                         | Your OK                              |
| 8   | You                     | **Approve** the PR and the release.                                                                                                                                                                                                                  | —                                    |
| 9   | Claude (after approval) | Merge with a merge commit; tag `v<version>`. CI builds the installer and `SHA256SUMS.txt` as a **draft** release. Verify the draft installer's fingerprint, then you publish it.                                                                     | Release page                         |
| 10  | At the shop             | Follow §5.                                                                                                                                                                                                                                           | `logs\update-history.jsonl`          |

## 5. At the supermarket PC (the update itself)

**Before:**

1. Choose a quiet time: no customers, all shifts closed.
2. **Take a backup:** الإدارة → النسخ الاحتياطي → حفظ نسخة, saved to a USB stick (not only on the PC).
3. **Close HeroMarket on every Windows account** (also accounts reached with "switch user").
4. Copy the new installer to the PC. **Check its fingerprint** against the release's `SHA256SUMS.txt`:

   ```
   Get-FileHash .\HeroMarket-Setup-<version>.exe
   ```

**Update:**

5. Double-click the installer. Click **Yes** at the administrator prompt. If Windows warns "Windows protected your PC", click More info → Run anyway; the installer is not signed.
6. Wait. It can take a few minutes: the verified copy of the database is made first.
   - **"HeroMarket مفتوح الآن…":** close it on all accounts and run the installer again. Nothing was changed.
   - **"لم يكتمل تثبيت HeroMarket…":** the database could not be updated. **The installer has already put the verified copy back**, so the shop's data is as before the update. The program will not open until the problem is solved. Go to §6, case 1.

**After:**

7. Open HeroMarket and sign in. Check:
   - yesterday's sales and the last invoice number in **الفواتير**;
   - the stock of two or three known products;
   - customer and supplier balances;
   - one sale, one return, and a receipt print.
8. Open `C:\ProgramData\HeroMarket\logs\update-history.jsonl`. Its last line must show the new `toVersion` with `"result":"ok"`, and say `"case":"A"` or `"case":"B"`.

## 6. If something goes wrong (recovery)

**Case 1: the installer reported a failure.** The data was already put back by the installer. Then:

1. Run the **previous version's** installer (keep every installer you have used). Its setup finds the data at its own version and opens normally.
2. Send `logs\setup.log` and `logs\update-history.jsonl` to the developer. The failed database is kept beside the good one as `pgdata.failed-<time>`, for analysis; do not delete it.

**Case 2: the update succeeded, but a problem appears later.**

- **Case A release:** reinstall the previous version's installer. The database fits both versions.
- **Case B release:** the previous program will **not** open the updated database. That is deliberate, so it cannot damage it. Either:
  - **(preferred)** wait for a fixed new version; or
  - **go back to the copy taken just before the update.** This loses everything recorded since the update, so first save a backup (النسخ الاحتياطي) and write down the sales made since then. **Restore first, with the newer program still installed; install the previous version after.** Then:
    1. Close HeroMarket on every Windows account.
    2. As administrator (right-click Command Prompt → Run as administrator), run the restore command of the program installed now, naming the version to go back to (here 1.4.0):

       ```
       "C:\Program Files\HeroMarket-POS\HeroMarket-POS.exe" --restore-pre-install=1.4.0
       ```

       It picks the newest copy whose data **belongs to that version**, checks it against its manifest, sets the current database aside (`pgdata.replaced-<time>`), puts the copy back and restarts the service. The program installed now then refuses to open (its setup does not match the data): that is expected.

    3. Run the **previous version's** installer. Its setup finds the data at its own version (Case A) and HeroMarket opens on the data as it was before the update.

    **Why this order:** every installer run takes a copy and removes old ones by its own rule. From 1.5.0 on, the newest copy of each of the last 3 data versions is always kept. 1.4.0 keeps only the newest 3 copies of any kind, so running the 1.4.0 installer first can remove the only copy of the 1.4.0 data. That happened in the 1.5.0 Sandbox check after four installer runs.

  - Instead of a version, a specific copy can be named: `--restore-pre-install=<folder name in backups\pre-install>`. Without a name or version, the newest copy of the installed version's own data is used. If no copy matches, the command lists the copies with the version of their data.

**Never** delete `pgdata`, a copy in `backups\pre-install`, or a `pgdata.failed-…` / `pgdata.replaced-…` folder before the developer has confirmed the shop works.

## 7. Release checklist (copy into every PR)

```
Version: 1.4.x            Update case: A / B
Migrations: none / 0014_… (why: …)
Previous version can open the database after this update: yes (A) / no (B: restore the copy)
[ ] npm test green (count: …)        [ ] lint 0 errors       [ ] format clean      [ ] build
[ ] CI green on the PR head
[ ] Case B: migration run on a full-size copy, before/after checks clean
[ ] Sandbox: install the current shop version + data, update, all records kept
[ ] Sandbox (Case B): a failing migration puts the copy back by itself
[ ] Laptop trial by the owner/developer
[ ] Release notes: case, migrations, compatibility, what to check after the update
[ ] Installer SHA-256 recorded; draft release verified before publishing
```

## 8. What was tested in 1.4.0 (and what not)

- **Tested automatically** (`tests/service/upgrade.test.js`):
  - Case A and Case B detection;
  - the installed program refusing to migrate by itself;
  - a newer database refused by an older program;
  - lost rows and changed totals caught;
  - a failing migration leaving data and schema unchanged.
- **Tested in Windows Sandbox (2026-10-16)**, with the 1.4.0 candidate from commit f351e4f and two test-only builds (`1.4.1-test.1` with a harmless migration, `1.4.1-test.2` with a migration that fails); never released:

  | Scenario                                        | Result                                                                                                                                                   |
  | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Installer started while HeroMarket is open      | Refused after 3 s, exit 4, nothing changed                                                                                                               |
  | Case A: new 1.4.0 over the previous 1.4.0 build | Every record kept; history "case A, ok"; program opens                                                                                                   |
  | Case B: 1.4.0 → 1.4.1-test.1                    | Migration 0014 applied; every record kept; history "case B, ok"                                                                                          |
  | Older 1.4.0 over the updated data               | Refused (exit 3), data untouched; history "refused: database_newer"; the program explains it                                                             |
  | `--restore-pre-install` with the 1.4.0 program  | The right copy (1.4.0 data) put back; every record; the program opens                                                                                    |
  | Case B with a failing migration (1.4.1-test.2)  | Exit 3; the data identical to before; history "restored" with the reason; the program refuses until fixed; the previous installer brings everything back |

- **Tested on the owner's laptop (2026-10-16):** a Case A update of 1.4.0 over an earlier 1.4.0 build. A verified copy was taken first; every record was identical before and after; the history said "ok".
- **Not tested:** an update on the supermarket's real PC (that happens with the first real release), and a Case B update on a real PC.

## 9. What was tested in 1.5.0 (release candidate, 2026-10-22)

- **Windows Sandbox** (clean Windows 10, no network), never released. Builds:
  - the 1.4.0 installer of candidate 7515377 (schema 0014, the same as `main`);
  - the 1.5.0 candidate (migrations 0015–0023);
  - a test-only `1.5.1-test.1`, whose migration 0024 adds a column and then fails on purpose.
- **Starting point:** HeroMarket 1.3 with a copy of the 1.3 data (9 products, 2 customers, 4 users), then 1.4.0 over it. Sample money records were added to the 1.4.0 store before the update: a closed shift with a cash, a Visa and an on-account sale, a sale line, an expense and two drawer movements, a supplier with a part-paid purchase and its ledger, and a damaged item.
- **Every figure was compared before and after each step:** row counts, stock, customer and supplier balances, each shift's amounts, sales and line totals, the drawer, expenses, purchases and the supplier ledger.

  | Scenario                                                                          | Result                                                                                                                                                                              |
  | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Case B: 1.4.0 with the sample records → 1.5.0                                     | Migrations 0015–0023 applied; every figure identical; customer codes C00001…; the old purchase has no discount; history "case B, ok"; both backup tasks registered; program opens   |
  | Installer started while HeroMarket is open                                        | Refused, exit 4, history unchanged                                                                                                                                                  |
  | Case A: 1.5.0 over 1.5.0                                                          | Every figure identical; history "case A, ok"; program opens                                                                                                                         |
  | Case B with a failing migration (1.5.1-test.1)                                    | Exit 3; every figure identical; the test column absent; history "restored" with the reason; the program refuses until fixed; the 1.5.0 installer brings everything back             |
  | Older 1.4.0 installer over the 1.5.0 data                                         | Refused (exit 3), every figure identical; history "refused: database_newer"; the program explains it                                                                                |
  | Going back, as first documented (1.4.0 installer, then its restore)               | **Failed:** the 1.4.0 installer's own pruning had removed the only copy of the 1.4.0 data. Fixed in 1.5.0 and §6 rewritten (D-079)                                                  |
  | Going back, new order: `--restore-pre-install=1.4.0` with 1.5.0, then 1.4.0 setup | The copy of the 1.4.0 data was still there after three later installer runs; restore exit 0; every 1.4.0 figure, schema 0014; then the 1.4.0 installer: "case A, ok", program opens |

- **Builds:** the refusal checks (installer open, older installer) ran with the candidate built before the D-079 fix; that fix changes only how copies are kept and chosen. Every other row ran with the final candidate.
- **Earlier, with test build 1.5.0-test.2 (D-074):** the after-close backup task runs as the system account when started with normal user rights; a normal user cannot delete a copy.
- **Not tested:** the update on a real PC (the shop gets a fresh install; the owner's laptop update is the first real one), and the backups on the shop PC.
