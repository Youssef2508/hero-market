# HeroMarket POS – Installation and Daily Use (shop owner)

Everything here is done with the mouse. Nobody in the shop needs a terminal, Node.js, Git, Docker or any developer tool.

## 1. What you need

- One Windows 10 or Windows 11 computer (64-bit), with at least 4 GB of memory and 2 GB of free disk space.
- The installer file `HeroMarket-Setup-<version>.exe`, about 175 MB. It contains everything: the program, its own database (PostgreSQL) and the Microsoft Visual C++ runtime that database needs. Nothing else has to be installed first.
- No internet connection. The program never needs it to sell.

## 2. Install (once)

1. Copy `HeroMarket-Setup-<version>.exe` to the cashier PC, for example from a USB stick.
2. Double-click it.
   - The installer is **not code-signed yet**, so Windows may show "Windows protected your PC". Click **More info**, then **Run anyway**. This message disappears once a code-signing certificate is bought (see [DEPLOYMENT_RECOMMENDATION.md](DEPLOYMENT_RECOMMENDATION.md) §5).
3. Windows asks **"Do you want to allow this app to make changes to your device?"**. Click **Yes** (an administrator's password may be asked once). There are no other questions. The installer, in about two to five minutes:
   - puts the program in `C:\Program Files\HeroMarket-POS`, for **every Windows user of this PC**;
   - installs the Microsoft Visual C++ runtime if the PC does not have it;
   - sets up the shop's database as a Windows service, **HeroMarketDB**. It starts with Windows and runs under its own account, so Windows users cannot open its files (see §4);
   - creates a **HeroMarket POS** shortcut on the Desktop and in the Start Menu of every user.

   If this Windows user had an older HeroMarket installed only for themselves, that copy is removed automatically. Its data is kept and moved in.

4. Open **HeroMarket POS**.
   - The store's data is kept in `C:\ProgramData\HeroMarket`, shared by all Windows users of the PC: whoever signs in to Windows opens the same shop, with the same products, invoices and shifts.
   - If the PC has the data of HeroMarket 1.3 (`%APPDATA%\elnagdi-pos` of the Windows user who used it), it is imported on the first start by that user. The old file is only read, never changed, and a copy is kept in `backups\legacy-sqlite`.
   - If the installing Windows user has data from a pre-1.4.0 PostgreSQL version (`%APPDATA%\HeroMarket`), the installer copies it in and checks every file. The old database folder is left as it was; only its settings file is renamed (`heromarket.json.moved-to-…`) so the data is never moved twice.
   - Without old data, the **إعداد المتجر لأول مرة** screen asks you to create the first administrator. There is no default password.
   - Next, the **recovery code** is shown once. Write it on paper and keep it away from the till (§3a).

## 3. Daily use

- **Open:** double-click **HeroMarket POS** on the Desktop, wait for the login screen, and sign in.
- **Close:** close the window. The database keeps running in the background as a Windows service (it uses little memory) and stops cleanly when Windows shuts down. After a power cut it recovers by itself.
- **Several Windows users on one PC:** each can open HeroMarket under their own Windows account, at the same time if needed (switch user), and all of them work in the same shop. Signing out of one account does not affect the others. In every case, sign in to HeroMarket itself with your own HeroMarket username.
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
     `"C:\Program Files\HeroMarket-POS\HeroMarket-POS.exe" --reset-password=<your username>`
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

| What                                                                              | Where                                                                             | Who can open it                                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| The store's database                                                              | `C:\ProgramData\HeroMarket\pgdata`                                                | Only the database service and administrators                      |
| The superuser password of the database (support only)                             | `C:\ProgramData\HeroMarket\admin`                                                 | Administrators only                                               |
| Connection settings of the program                                                | `C:\ProgramData\HeroMarket\heromarket.json`                                       | Every Windows user may read it; only administrators may change it |
| Program log and installer log                                                     | `C:\ProgramData\HeroMarket\logs` (`app.log`, `setup.log`)                         | Every Windows user                                                |
| Copies taken before each installation or update (verified, the newest 3 are kept) | `C:\ProgramData\HeroMarket\backups\pre-install`                                   | Every Windows user may read them                                  |
| Copy of the old version's data (first start), copies before a restore             | `C:\ProgramData\HeroMarket\backups`                                               | Every Windows user may read them                                  |
| Data of version 1.3 or earlier (left as it was)                                   | `%APPDATA%\elnagdi-pos` or `%APPDATA%\HeroMarket` of the Windows user who used it | That user                                                         |
| Window preferences (theme, last username) of one Windows user                     | `%APPDATA%\HeroMarket`                                                            | That user                                                         |
| The program files                                                                 | `C:\Program Files\HeroMarket-POS` (replaced by every update, holds no data)       | Every user may run it; only administrators may change it          |

**What a Windows user of this PC can and cannot do** (security review, [SECURITY_REVIEW_LOCAL_DATABASE.md](SECURITY_REVIEW_LOCAL_DATABASE.md)):

- **Cannot:**
  - open the database files;
  - read the superuser password;
  - change the database server;
  - use the database to run programs on Windows.
- **Can:** someone with technical skill could read the program's connection settings and change shop data directly, outside HeroMarket's permissions and audit.

So give Windows accounts on the cashier PC only to people you trust with the shop's data, and protect each account with its own Windows password.

**Changing the connection settings** (for example, turning this PC into a till of another server) needs an administrator: close HeroMarket, then right-click it → **Run as administrator**.

## 5. Back up

- **Every day:** open **النسخ الاحتياطي → حفظ نسخة** and save the file to a USB stick, not the same computer.
- **Once a week:** with the program **closed**, copy the whole `C:\ProgramData\HeroMarket` folder to a USB stick. This copy can rebuild the shop on a new PC.

## 6. Update to a new version

1. Take a backup (§5).
2. Close HeroMarket on **every** Windows account that has it open.
3. Double-click the new `HeroMarket-Setup-<newer version>.exe` and click **Yes**. It replaces the program and keeps the data. You do not need to uninstall first.
   - Before anything changes, the installer stops the database, makes a complete copy of it and checks every file (`backups\pre-install`). Only then does it update.
   - If the copy fails (for example, a full disk), the update stops, nothing changes, and the reason is in `logs\setup.log`.
4. Open HeroMarket.

## 7. If something goes wrong

| Problem                                                      | What to do                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The program says the database service does not run           | Restart the computer. If it repeats, run the installer again (it repairs the service and keeps the data). Send `C:\ProgramData\HeroMarket\logs\setup.log` and `app.log` to support. Do **not** delete any folder.                                         |
| The program says "لم يكتمل تجهيز قاعدة البيانات لهذه النسخة" | The installer did not finish. Run it again. Nothing was changed in your data.                                                                                                                                                                             |
| The installer says the database could not be set up          | Nothing was deleted. Send `logs\setup.log` to support. The database server's own log is in `pgdata\log`; an administrator can open it.                                                                                                                    |
| An update went wrong and you want the previous version back  | Ask support: reinstall the previous installer, then put the newest folder from `backups\pre-install\…\pgdata` back as `C:\ProgramData\HeroMarket\pgdata` (with the database service stopped). A guided button for this is planned.                        |
| The PC broke                                                 | Install HeroMarket on the new PC. Then, as an administrator, stop the **HeroMarketDB** service, put the weekly copy of the `HeroMarket` folder back in `C:\ProgramData`, and run the installer once more so it secures the folder and starts the service. |

## 8. Uninstall

Windows **Settings → Apps → HeroMarket POS → Uninstall**. The program, its shortcuts and the **HeroMarketDB** service are removed. **The store's data stays** in `C:\ProgramData\HeroMarket`; reinstalling finds it again (tested). To erase the data as well, delete that folder after uninstalling, and only once you are sure you have a backup.

## 9. What has been tested, and what you still need to test

Tested on 2026-10-16 in **Windows Sandbox**: a clean, disposable Windows 10 with nothing else installed, no network, and a copy of the shop's 1.3 data. Each test used the real 1.4.0 installer.

| Check                                                                                                                                                                               | Result                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Install for all users (silent), program in `C:\Program Files\HeroMarket-POS`, shortcuts for all users                                                                               | ✅                                                                                    |
| On a clean Windows, the Microsoft Visual C++ runtime is installed by the installer and the database tools run                                                                       | ✅ (before the fix: the database could not be created at all)                         |
| The old per-user 1.3 is removed (program, uninstall entry, shortcuts); its data is kept                                                                                             | ✅                                                                                    |
| First start: window after 2–4 s, database ready, 1.3 data imported with parity (every table identical)                                                                              | ✅                                                                                    |
| Database service: own account `NT SERVICE\HeroMarketDB`, starts with Windows, only on `127.0.0.1`                                                                                   | ✅                                                                                    |
| A standard Windows user cannot open the database files, the superuser password or the server settings, cannot stop the service and cannot run Windows commands through the database | ✅ (before: all possible)                                                             |
| Two Windows accounts with HeroMarket open at the same time; either can close it                                                                                                     | ✅                                                                                    |
| Sign-in with an old PIN, then a new password; a sale; backup; restore removes the later sale                                                                                        | ✅ (by hand)                                                                          |
| Update over the installed version: verified copy first, data kept                                                                                                                   | ✅                                                                                    |
| Uninstall removes the program and the service and keeps the data; reinstalling reuses it                                                                                            | ✅                                                                                    |
| **Windows restart (reboot)** with the program installed                                                                                                                             | **Not yet** (Windows Sandbox cannot restart)                                          |
| **Your real cashier PC**, with **your real 1.3 installation and data** (the copy used here has 9 products and no sales)                                                             | **Not yet**: on a separate PC first ([GO_LIVE_TEST_PLAN.md](GO_LIVE_TEST_PLAN.md) T1) |
| **Receipt printer and barcode scanner**                                                                                                                                             | **Not yet**: none was connected to the test PC                                        |
| **Power cut while selling**                                                                                                                                                         | **Not yet** (T8)                                                                      |
