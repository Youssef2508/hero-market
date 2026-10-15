# HeroMarket POS – Installation and Daily Use (shop owner)

Everything here is done with the mouse. Nobody in the shop needs a terminal, Node.js, Git, Docker or any developer tool.

## 1. What you need

- One Windows 10 or Windows 11 computer (64-bit), with at least 4 GB of memory and 2 GB of free disk space.
- The installer file `HeroMarket-Setup-<version>.exe`, about 155 MB. It contains everything: the program and its own database (PostgreSQL). Nothing else has to be installed first.
- No internet connection. The program never needs it to sell.

## 2. Install (once)

1. Copy `HeroMarket-Setup-<version>.exe` to the cashier PC, for example from a USB stick.
2. Double-click it.
   - The installer is **not code-signed yet**, so Windows may show "Windows protected your PC". Click **More info**, then **Run anyway**. This message disappears once a code-signing certificate is bought (see [DEPLOYMENT_RECOMMENDATION.md](DEPLOYMENT_RECOMMENDATION.md) §5).
3. Windows asks **"Do you want to allow this app to make changes to your device?"**. Click **Yes** (an administrator's password may be asked once). There are no other questions. The installer:
   - puts the program in `C:\Program Files\HeroMarket POS`, for **every Windows user of this PC**;
   - creates a **HeroMarket POS** shortcut on the Desktop and in the Start Menu of every user;
   - opens the program.

   If this Windows user had an older HeroMarket installed only for themselves, that copy is removed automatically. Its data is kept and moved in (step 4).

4. On the first start the program prepares its database on this computer. This takes up to a minute.
   - The store's data is kept in `C:\ProgramData\HeroMarket`, shared by all Windows users of the PC: whoever signs in to Windows opens the same shop, with the same products, invoices and shifts.
   - If this Windows user has data from HeroMarket 1.3 or earlier (`%APPDATA%\HeroMarket`), it is copied there and every file is checked. The old database folder is left as it was; only its settings file is renamed (`heromarket.json.moved-to-…`) so the data is never moved twice.
   - If the PC still has the old version's data (`%APPDATA%\elnagdi-pos`), it is copied in automatically. The old file is only read, never changed.
   - Then the **إعداد المتجر لأول مرة** screen asks you to create the first administrator. There is no default password.
   - Next, the **recovery code** is shown once. Write it on paper and keep it away from the till (§3a).

## 3. Daily use

- **Open:** double-click **HeroMarket POS** on the Desktop, wait for the login screen, and sign in. The database starts by itself.
- **Close:** close the window. The program stops its database cleanly. If Windows is shut down with the program open, the database recovers by itself on the next start.
- **Several Windows users on one PC:** each can open HeroMarket under their own Windows account, and all of them work in the same shop.
  - If two Windows accounts are signed in at the same time (switch user), the second one uses the database the first one started.
  - The database stops when the account that started it closes the program.
  - In every case, sign in to HeroMarket itself with your own HeroMarket username.
- Without internet everything works: sales, invoices, stock and shifts are saved on this computer immediately.

## 3a. Sign-in and passwords

- **Everyone signs in with a username and a password.** Passwords have at least 8 characters, letters and digits together, and must not contain the username.
- **After updating from a version with PINs:** each person types their username and their **old PIN** once. The program then asks them to choose a password. From then on the PIN no longer works.
- **New staff member:** الإدارة → المستخدمون → إضافة حساب. A temporary password appears once; give it to the person. They choose their own password at their first sign-in.
- **A staff member forgot their password:** الإدارة → المستخدمون → تعديل → **إعادة تعيين كلمة المرور**. A new temporary password appears once.
- **You (the owner) forgot your password:**
  1. On the sign-in screen click **نسيت كلمة المرور؟**.
  2. Type your username, the **recovery code** from the paper, and a new password.
  3. A **new** recovery code is shown. Write it down, because the old one no longer works.
- **Recovery code lost as well:**
  1. Close HeroMarket.
  2. Press **Win + R** and type:
     `"C:\Program Files\HeroMarket POS\HeroMarket-POS.exe" --reset-password=<your username>`
  3. A window shows a temporary password; sign in with it and choose a new one.

  This works only on the store PC itself and is written to the event log. Anyone who can use that PC's Windows account can do it, so protect the Windows account with its own password.

- **Returns by cashiers:** the cashier presses **مرتجع** on the till, types the invoice number, chooses the item or the whole invoice and writes the reason. A supervisor types their own username and password to approve (or refuse). Everything is recorded.
- **Closing a shift with a difference above EGP 50** (over or short) also needs a supervisor's username and password.

## 3b. Cloud link (later)

The owner's cloud is not set up yet (it needs your approval of the hosting). When it is:

1. Your cloud account gives you an address, a store number and a device code.
2. Enter them on **الإدارة → المزامنة السحابية**.

Until then the shop works fully without it.

**If you ever restore a backup on a linked shop**, work pauses on every screen. On the sync screen, press **استرجاع من السحابة**: whatever reached the cloud after that backup comes back, then work continues. If there is no internet, you can choose **تخطي الاسترجاع**, but those later sales then stay only in the cloud.

## 4. Where the data is

| What                                                          | Where                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| The store's database, settings and program log                | `C:\ProgramData\HeroMarket` (`pgdata`, `heromarket.json`, `app.log`)         |
| Automatic copies taken before every upgrade                   | `C:\ProgramData\HeroMarket\backups\pre-upgrade` (the newest 3 are kept)      |
| Copy of the old version's data (first start)                  | `C:\ProgramData\HeroMarket\backups\legacy-sqlite`                            |
| Data of version 1.3 or earlier (left as it was)               | `%APPDATA%\HeroMarket` of the Windows user who used it                       |
| Window preferences (theme, last username) of one Windows user | `%APPDATA%\HeroMarket`                                                       |
| The program files                                             | `C:\Program Files\HeroMarket POS` (replaced by every upgrade, holds no data) |

`heromarket.json` holds the database password and the server secret.

- Every Windows user of this PC can open HeroMarket, so every Windows user of this PC can also read this file.
- Give Windows accounts on the cashier PC only to people you trust with the shop's data, and protect each account with a Windows password.
- Keep the file together with the backups and never share it.

## 5. Back up

- **Every day:** open **النسخ الاحتياطي → حفظ نسخة** and save the file to a USB stick, not the same computer.
- **Once a week:** with the program **closed**, copy the whole `C:\ProgramData\HeroMarket` folder to a USB stick. This copy can rebuild the shop on a new PC.

## 6. Update to a new version

1. Take a backup (§5).
2. Close HeroMarket.
3. Double-click the new `HeroMarket-Setup-<newer version>.exe`. It replaces the program and keeps the data. You do not need to uninstall first.
4. Open HeroMarket. If the new version changes the database:
   - it first closes the database;
   - it makes a complete copy of it and checks every file;
   - only then does it update.

   If the copy fails (for example, a full disk), the update stops, nothing changes, and the screen says why.

## 7. If something goes wrong

| Problem                                                     | What to do                                                                                                                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The program says the database could not start               | Restart the computer and open the program again. If it repeats, send the file `C:\ProgramData\HeroMarket\logs\postgres.log` to support. Do **not** delete any folder.                                           |
| An update went wrong and you want the previous version back | Close the program. Reinstall the previous installer. Ask support to put the newest folder from `backups\pre-upgrade\…\pgdata` back as `C:\ProgramData\HeroMarket\pgdata` (a guided button for this is planned). |
| The PC broke                                                | Install HeroMarket on the new PC, close it, put the weekly copy of the `HeroMarket` folder back in `C:\ProgramData`, and open it.                                                                               |

## 8. Uninstall

Windows **Settings → Apps → HeroMarket POS → Uninstall**. The program and its shortcuts are removed. **The store's data stays** in `C:\ProgramData\HeroMarket`; reinstalling picks it up again. To erase the data as well, delete that folder after uninstalling, and only once you are sure you have a backup.

## 9. What has been tested, and what you still need to test

| Check                                                                                                                                                                                                       | Where it was tested                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Silent install; program folder; Desktop and Start Menu shortcuts; uninstall entry                                                                                                                           | This development PC, QA edition of the real installer (2026-10-15)                                                                      |
| First start: database created automatically, first administrator, login, a sale, stock deducted                                                                                                             | Same                                                                                                                                    |
| Closing stops the database; reopening shows the same sale and stock                                                                                                                                         | Same                                                                                                                                    |
| Database only on `127.0.0.1`; no connection leaves the computer                                                                                                                                             | Same                                                                                                                                    |
| Upgrade over the previous version: data kept, verified snapshot before migrating (1,447 files), migration applied                                                                                           | Same (versions 2.0.0-qa.1 → qa.2)                                                                                                       |
| Uninstall keeps data; reinstall finds it                                                                                                                                                                    | Same                                                                                                                                    |
| Snapshot of a real database starts and contains the data                                                                                                                                                    | Automated test (`upgradeSnapshot.test.mjs`)                                                                                             |
| 1.4.0 QA build: shared store folder created on first start, modify rights for all Windows users (inherited by the database), database only on `127.0.0.1`, clean stop on close                              | This development PC, unpacked QA build, **not installed**: installing for all users needs the Windows administrator prompt (2026-10-15) |
| 1.4.0 hardening: the program cannot be run as plain Node.js; a program package with a modified header is refused                                                                                            | Same                                                                                                                                    |
| 1.4.0 moving a per-user store: a store kept by an older per-user installation is copied to the shared folder, every file checked, the old settings file renamed, and the data (a marker row) opens in 1.4.0 | Same                                                                                                                                    |
| **1.4.0 installation for all users (administrator prompt, `C:\Program Files`)**                                                                                                                             | **Not yet**: needs a PC where you can approve the administrator prompt. Your step: [GO_LIVE_TEST_PLAN.md](GO_LIVE_TEST_PLAN.md) T1.     |
| **Upgrade from a real per-user installation (1.3) with the 1.4.0 installer: old copy removed by the installer, data moved**                                                                                 | **Not yet** (T1, on a separate PC with a copy of your data)                                                                             |
| **Two Windows accounts on one PC, one after the other and signed in at the same time**                                                                                                                      | **Not yet**                                                                                                                             |
| **A clean Windows PC with no development tools**                                                                                                                                                            | **Not yet**: Windows Sandbox is not enabled on the development PC. Your step: [GO_LIVE_TEST_PLAN.md](GO_LIVE_TEST_PLAN.md) T1.          |
| **Windows restart (reboot)** with the program installed                                                                                                                                                     | **Not yet**                                                                                                                             |
| **Upgrade from your real version 1.3**                                                                                                                                                                      | **Not yet**: test on a separate PC with a copy of your data (T1)                                                                        |
| **Power cut while selling**                                                                                                                                                                                 | **Not yet** (T8)                                                                                                                        |
