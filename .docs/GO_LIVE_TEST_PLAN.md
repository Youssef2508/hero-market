# Go-Live Test Plan

This plan covers the ten checks to run before HeroMarket POS replaces version 1.3 in the store. Steps that can run without the store's hardware are automated (`npm run golive:check`). The rest are step-by-step instructions for a **test PC**, the **store's printer** and, if wanted, a **second till on the store network**.

**Safety rules for every test**

- Never install over, upgrade or migrate the store's **only** installation. Use a test PC (or a virtual machine) and a **copy** of the data.
- The store's data folder `%APPDATA%\elnagdi-pos` is only ever **copied**, with version 1.3 closed. Nothing in this plan writes to it.
- A check counts as passed only when it has been performed and its evidence is kept. The table below says which checks have been performed so far.

## 1. Status

| #   | Check                                                    | How                                            | Status on 2026-10-14                                                                                                                                |
| --- | -------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | NSIS installer upgrade from a copy of a 1.3 installation | Test PC (T1)                                   | **Not yet performed.** The upgrade code path (first start → import) was run from a packaged build on a copy of the installed store's data.          |
| 2   | Migration parity and preservation of the SQLite source   | Automated (A1, A2), then on the test PC (T1)   | Automated: **passed** on a copy of the installed store. Test PC: not yet performed                                                                  |
| 3   | Existing administrator PIN login; account set-up         | Automated (A4) with the owner's PIN; T3        | Automated: passed on the test fixture only. **The owner's PIN: not yet performed**                                                                  |
| 4   | Stock, customer balances and historical sales            | Automated (A3); spot check on screen (T1)      | Automated: **passed** on a copy of the installed store. Spot check: not yet performed                                                               |
| 5   | Thermal receipt printing                                 | Store printer (T5)                             | **Not yet performed** (verified to PDF only)                                                                                                        |
| 6   | Shift-close report printing                              | Store printer (T6)                             | **Not yet performed** (verified to PDF only)                                                                                                        |
| 7   | Backup and restore into a disposable environment         | Automated (A5); in the app on the test PC (T7) | Automated: **passed**. In the app on the test PC: not yet performed                                                                                 |
| 8   | Restart and recovery after interruption                  | Test PC (T8)                                   | Forced-kill restart verified during development QA. **Power loss on a real PC: not yet performed**                                                  |
| 9   | Windows profile with non-ASCII characters                | Regression test; test PC (T9)                  | Automated: **passed** (real `initdb` from an Arabic path; packaged app run from Arabic folders). **Real Arabic Windows account: not yet performed** |
| 10  | Multi-till over the store network (only if wanted)       | Server PC + till PC (T10)                      | HTTPS stack verified on one PC and in CI. **Two PCs on a real network: not yet performed**                                                          |

## 2. Before you start

1. **Build the release installer**: `npm run build:win` produces `dist\HeroMarket-POS-<version>-setup.exe`.
   - `package.json` still says **1.3.0**, the same number as the installed version. Raise it before a release, for example to 2.0.0, so the installed version is unambiguous in Windows "Apps" and in support.
   - A release tag (`v2.0.0`) builds the same installer in GitHub Actions.
2. **Copy the store data**, with version 1.3 closed on the store PC: the whole folder `%APPDATA%\elnagdi-pos` to a USB stick. Do not open the copy on the store PC.
3. **Test PC**: any Windows 10/11 PC other than the store PC, with the version 1.3 installer the store uses.
4. **Evidence folder**: create one folder (for example `golive-evidence\`) and keep every report, screenshot and photo named after its test, for example `T5-receipt.jpg`.

## 3. Automated checks (A1–A5)

They run on a development PC with the repository, Node 22.5 or later and the development PostgreSQL (`npm run pg:dev`), against a **copy** of `market_unified.db`:

```powershell
npm run pg:dev                               # in a second window, keep it running
$url = (npm run --silent pg:dev -- url) -replace '/[a-z_]+$', '/postgres'
$env:HEROMARKET_GOLIVE_PIN = '<an existing administrator PIN>'   # optional, enables A4; never written anywhere
npm run golive:check -- --sqlite D:\copies\market_unified.db --admin-url $url --report golive-evidence\A-report.json
Remove-Item Env:HEROMARKET_GOLIVE_PIN
```

| Check | What it proves                                                                                                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1    | The given file has the same SHA-256 before and after the run: the import works on its own copy only                                                                                          |
| A2    | Import into a new, empty PostgreSQL database: every table's rows match (count and per-row SHA-256), no broken references                                                                     |
| A3    | What the store sees is identical in SQLite and PostgreSQL: stock, retail and cost price per product, every customer's and supplier's balance, sales count and total per day and payment type |
| A4    | An existing PIN still logs in after the move (legacy PIN hashes are upgraded on first login)                                                                                                 |
| A5    | A backup made through the service restores into a second new database, and A3 between the two databases finds no difference                                                                  |

Both temporary databases are dropped at the end. Exit code 0 means every check that ran passed.

**Result here on 2026-10-14:**

- Copy of the installed store (9 products, 338 units, no sales yet): A1, A2, A3 and A5 passed; A4 not run, because it needs the owner's PIN.
- Test fixture (2 sales, total 351.10): A1–A5 passed, including the PIN login.

## 4. Manual checks

### T1 Installer upgrade, parity and data comparison (checks 1, 2, 4)

On the **test PC**:

1. Install version 1.3 and start it once, then close it.
2. Replace `%APPDATA%\elnagdi-pos` with the copy from the USB stick.
3. Start version 1.3. Write down or photograph:
   - the number of products and the stock of five products you know;
   - three customers' balances;
   - today's, and one past day's, sales total.

   Close it.

4. Record the source fingerprint:

   ```powershell
   Get-FileHash "$env:APPDATA\elnagdi-pos\market_unified.db" | Format-List
   ```

5. Run `HeroMarket-POS-<version>-setup.exe`. Do **not** uninstall 1.3 first: the new version installs over it.
6. Start HeroMarket POS. The first start imports the old data, which takes up to a minute on a large store, then shows the lock screen. If it shows an error instead, photograph it and stop.
7. Evidence to keep:
   - `%APPDATA%\HeroMarket\backups\legacy-import-*.json`: open it; `"parity"` must contain `"ok": true`.
   - `%APPDATA%\HeroMarket\backups\legacy-sqlite\market_unified-*.db` must exist (the verified backup copy).
   - `Get-FileHash` of `%APPDATA%\elnagdi-pos\market_unified.db` again: it must be identical to step 4.
8. Log in and compare with step 3: products and stock, the three customer balances, and the two sales totals (التقارير). Every figure must match.

**Passed when** the import report says parity ok, the fingerprint is unchanged and every figure from step 3 matches.

### T3 Logins and accounts (check 3)

1. On the T1 test PC: log in with the existing administrator PIN, then with each cashier's PIN. A PIN that worked in 1.3 must work unchanged.
2. الإدارة → المستخدمون (and الأدوار والصلاحيات): check each person's role, disable former staff, and create any missing accounts.
3. Change every PIN that was shared or written down under the old system.

**Evidence:** a screenshot of the user list. **Never write PINs into the evidence folder.**

### T5 Receipt on the store's thermal printer (check 5)

On the store PC, or the test PC with the store printer connected:

1. إعدادات المتجر → اسم الطابعة: select the thermal printer exactly as Windows names it. Set the paper width (58 or 80 mm).
2. تصميم الفاتورة → طباعة تجريبية.
3. Check on paper:
   - the Arabic text is not mirrored or broken;
   - the store name reads **Hero Market**;
   - every element sits where the designer placed it (right, centre, left; top, middle, bottom);
   - nothing is cut at the edges;
   - the paper is cut.
4. Make one real sale on the test copy, with a discount and two products, and print its receipt. Check that the totals on paper equal the screen.

**Evidence:** photos `T5-test.jpg` and `T5-sale.jpg` next to a screenshot of the sale.

### T6 Shift-close report on the store's printer (check 6)

1. On the test copy, open a shift and make:
   - one cash sale;
   - one return;
   - one expense.
2. إغلاق الوردية: enter the counted cash and confirm. The shift report prints automatically.
3. Check that the expected cash, counted cash and difference on paper match the close dialog. Also check that the Momkn and wallet sections print.

**Evidence:** a photo `T6-report.jpg` and a screenshot of the close dialog before confirming. Until the K-24 decision ([OWNER_DECISIONS.md](OWNER_DECISIONS.md)), the dialogs can show a different expected figure from the saved and printed one in shifts that contain returns. Note which figure is on paper.

### T7 Backup and restore in the app (check 7)

On the T1 test PC:

1. النسخ الاحتياطي → حفظ نسخة: save to a USB stick.
2. Make one more sale, so the live data now differs from the backup.
3. النسخ الاحتياطي → استعادة نسخة احتياطية: choose the file and confirm. Everyone is logged out.
4. Log in again. The sale from step 2 must be gone and everything from step 1 must be present: check one product's stock and the day's total.
5. `%APPDATA%\HeroMarket\backups\pre-restore-*.json` must exist: the automatic safety copy taken just before the restore.

**Evidence:** the backup file's name and size; screenshots before and after.

### T8 Restart and recovery (check 8)

On the T1 test PC:

1. **Forced close during a sale:**
   - Scan two products. Before pressing F1, end HeroMarket POS in Task Manager. Start it again: the lock screen appears, the unfinished sale is not recorded, and stock is unchanged.
   - Then complete a sale and, right after the receipt, end the app again. After the restart, that sale appears exactly once and its stock is deducted once.
2. **Power loss:**
   - Make a sale, wait 5 seconds, and switch the PC off at the power button (hold it) or pull the plug.
   - Start the PC and the app. The sale must be present exactly once. The app must start without asking for setup.
   - If it reports a database problem, photograph it, keep the folder `%APPDATA%\HeroMarket` as it is, and stop.
3. **Network cable** (client tills only, see T10): unplug during a sale. The till shows the connection error and records nothing. After reconnecting, press F1 again: the sale is recorded **once**.

**Evidence:** sales list screenshots around each interruption.

### T9 Windows account with an Arabic name (check 9)

1. On the test PC create a local account whose name is Arabic, for example `محمد`: Settings → Accounts → Other users.
2. Sign in as that user and install HeroMarket POS (per-user install under `C:\Users\محمد\…`).
3. Start it, choose هذا الجهاز فقط, create the first administrator, make a sale and restart the app.
4. Check that `C:\ProgramData\HeroMarket\` contains `runtime\pgsql-…` and `store-…`. This is expected: the database tools need an ASCII path.

**Passed when** set-up, the sale and the restart work. **Evidence:** a screenshot of the sale and of the `ProgramData\HeroMarket` folder.

### T10 Two tills over the store network (check 10, only if a second till is planned)

Needs: a **server PC** with Docker Desktop and a **till PC** on the same network.

1. On the server PC follow [DOCKER.md §2](DOCKER.md):
   - set `HEROMARKET_BIND` to the server's LAN IP and `HEROMARKET_TLS_NAMES` to `localhost, 127.0.0.1, <server LAN IP>`;
   - run `docker compose up -d`;
   - note the setup code from `docker compose logs server`;
   - copy `root.crt` to a USB stick.
2. On the till: first start → جهاز كاشير → `https://<server LAN IP>:8443` → اختيار الشهادة… → `root.crt`. Compare the SHA-256 on screen with the server's (DOCKER.md §2), then enter the setup code.
3. Check from the till PC that only HTTPS is reachable:
   - `Test-NetConnection <server IP> -Port 8443` must succeed;
   - the same for ports 8787 and 5432 must **fail**.
4. Sell on both tills at the same time for 10 minutes, including the same product. Stock must equal the starting stock minus everything sold, and no invoice number may repeat.
5. Run the cable test in T8 step 3.
6. Back up the server with `pg_dump` (DOCKER.md, Operations). Restore it into a throw-away stack with a different project name, and check the totals.

**Evidence:** the `Test-NetConnection` output, both tills' sales lists, and the stock of the shared product before and after.

## 5. Results record

Fill in as each check is performed; a check without evidence stays "not performed".

| #   | Date | Performed by | Result | Evidence file(s) | Notes |
| --- | ---- | ------------ | ------ | ---------------- | ----- |
| 1   |      |              |        |                  |       |
| 2   |      |              |        |                  |       |
| 3   |      |              |        |                  |       |
| 4   |      |              |        |                  |       |
| 5   |      |              |        |                  |       |
| 6   |      |              |        |                  |       |
| 7   |      |              |        |                  |       |
| 8   |      |              |        |                  |       |
| 9   |      |              |        |                  |       |
| 10  |      |              |        |                  |       |
