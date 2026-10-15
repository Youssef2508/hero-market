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
3. There are no questions to answer. The installer:
   - puts the program in `C:\Users\<you>\AppData\Local\Programs\heromarket-pos`;
   - creates a **HeroMarket POS** shortcut on the Desktop and in the Start Menu;
   - opens the program.

   No administrator rights are needed.

4. On the first start the program prepares its database on this computer. This takes up to a minute.
   - If the PC still has the old version's data (`%APPDATA%\elnagdi-pos`), it is copied in automatically. The old file is only read, never changed.
   - Then the **إعداد المتجر لأول مرة** screen asks you to create the first administrator. There is no default password.

## 3. Daily use

- **Open:** double-click **HeroMarket POS** on the Desktop, wait for the login screen, and sign in. The database starts by itself.
- **Close:** close the window. The program stops its database cleanly. If Windows is shut down with the program open, the database recovers by itself on the next start.
- Without internet everything works: sales, invoices, stock and shifts are saved on this computer immediately.

## 4. Where the data is

| What                                         | Where                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| The store's database and settings            | `%APPDATA%\HeroMarket` (`pgdata`, `heromarket.json`)                                |
| Automatic copies taken before every upgrade  | `%APPDATA%\HeroMarket\backups\pre-upgrade` (the newest 3 are kept)                  |
| Copy of the old version's data (first start) | `%APPDATA%\HeroMarket\backups\legacy-sqlite`                                        |
| The program files                            | `%LOCALAPPDATA%\Programs\heromarket-pos` (replaced by every upgrade, holds no data) |

`heromarket.json` holds the database password and the server secret. Keep it together with the backups and never share it.

## 5. Back up

- **Every day:** open **النسخ الاحتياطي → حفظ نسخة** and save the file to a USB stick, not the same computer.
- **Once a week:** with the program **closed**, copy the whole `%APPDATA%\HeroMarket` folder to a USB stick. This copy can rebuild the shop on a new PC.

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

| Problem                                                     | What to do                                                                                                                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The program says the database could not start               | Restart the computer and open the program again. If it repeats, send the file `%APPDATA%\HeroMarket\logs\postgres.log` to support. Do **not** delete any folder.                                           |
| An update went wrong and you want the previous version back | Close the program. Reinstall the previous installer. Ask support to put the newest folder from `backups\pre-upgrade\…\pgdata` back as `%APPDATA%\HeroMarket\pgdata` (a guided button for this is planned). |
| The PC broke                                                | Install HeroMarket on the new PC, close it, put the weekly copy of the `HeroMarket` folder back in `%APPDATA%`, and open it.                                                                               |

## 8. Uninstall

Windows **Settings → Apps → HeroMarket POS → Uninstall**. The program and its shortcuts are removed. **The store's data stays** in `%APPDATA%\HeroMarket`; reinstalling picks it up again. To erase the data as well, delete that folder after uninstalling, and only once you are sure you have a backup.

## 9. What has been tested, and what you still need to test

| Check                                                                                                             | Where it was tested                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Silent install; program folder; Desktop and Start Menu shortcuts; uninstall entry                                 | This development PC, QA edition of the real installer (2026-10-15)                                                             |
| First start: database created automatically, first administrator, login, a sale, stock deducted                   | Same                                                                                                                           |
| Closing stops the database; reopening shows the same sale and stock                                               | Same                                                                                                                           |
| Database only on `127.0.0.1`; no connection leaves the computer                                                   | Same                                                                                                                           |
| Upgrade over the previous version: data kept, verified snapshot before migrating (1,447 files), migration applied | Same (versions 2.0.0-qa.1 → qa.2)                                                                                              |
| Uninstall keeps data; reinstall finds it                                                                          | Same                                                                                                                           |
| Snapshot of a real database starts and contains the data                                                          | Automated test (`upgradeSnapshot.test.mjs`)                                                                                    |
| **A clean Windows PC with no development tools**                                                                  | **Not yet**: Windows Sandbox is not enabled on the development PC. Your step: [GO_LIVE_TEST_PLAN.md](GO_LIVE_TEST_PLAN.md) T1. |
| **Windows restart (reboot)** with the program installed                                                           | **Not yet**                                                                                                                    |
| **Upgrade from your real version 1.3**                                                                            | **Not yet**: test on a separate PC with a copy of your data (T1)                                                               |
| **Power cut while selling**                                                                                       | **Not yet** (T8)                                                                                                               |
