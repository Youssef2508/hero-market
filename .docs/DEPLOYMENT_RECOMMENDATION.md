# Deployment Recommendation (plain language)

For the shop owner. Written 2026-10-15 from the current code. Nothing here has been bought, created or published.

## 1. In short

- **In the shop:** one Windows installer (`HeroMarket-Setup-<version>.exe`) installs the program **and its own database** on the cashier PC. The cashier double-clicks the Desktop icon and signs in. The database starts and stops with the program. Sales never need the internet.
- **From home:** a private web address (`https://…`) that only you can sign in to, with a password and a code from an authenticator app on your phone. It shows the shop's data as of the last synchronisation, and lets you enter supplier invoices, stock receipts and product or price changes.
  - The shop PC sends its changes to that server and picks up yours. The server never connects **into** the shop, so the shop PC is not exposed to the internet.
  - This part is phases 4 and 5. The hosting choice comes after synchronisation is built and tested.

## 2. The cashier PC: options considered

| Option                                                                                              | Verdict                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. One Electron installer that contains the program and a private PostgreSQL (current design)**   | **Recommended.** One file to install, no prerequisites, no admin rights. The database runs only while the program is open and only on `127.0.0.1`. Tested end to end on this PC (QA edition) – see [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) §9. |
| B. Install PostgreSQL as a separate Windows service (official installer) and the program separately | Two installers, admin rights, a service always running and a database password to manage: more for a non-technical owner to get wrong. No benefit for one PC.                                                                                         |
| C. Docker on the cashier PC                                                                         | Needs Docker Desktop (licensing for businesses, heavy, Hyper-V). Not appropriate for a cashier PC.                                                                                                                                                    |
| D. A browser-only app served from the cloud                                                         | The shop would stop when the internet stops. Rejected (the owner's first priority).                                                                                                                                                                   |

Installer type: **one-click, per user**.

- **Install:** no questions; Desktop and Start Menu shortcuts; the program opens at the end.
- **Upgrade:** run the newer installer.
- **Uninstall:** Windows Settings → Apps. Program files are removed and the data is kept.

A per-machine installer (for all Windows users, admin rights) is possible if the shop uses several Windows accounts on the cashier PC.

## 3. The owner's remote access: options considered

| Option                                                                                                | Verdict                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. A small cloud server runs the same HeroMarket service in "cloud" mode; the shop PC syncs to it** | **Recommended** ([STAGE4_ARCHITECTURE_REVIEW.md](STAGE4_ARCHITECTURE_REVIEW.md)). Works when the shop is offline (you see the last synced data; your entries wait). The shop PC only makes outgoing connections. |
| B. Remote desktop into the shop PC (AnyDesk, TeamViewer…)                                             | Easy, but it controls the cashier's screen, needs the shop PC on and online, and gives full access to the PC. Fine for support, not as the owner's interface.                                                    |
| C. VPN into the shop PC                                                                               | Nothing works when the shop is offline; the PC must be on; network setup. A possible stop-gap for viewing only.                                                                                                  |
| D. Open a port on the shop router to the PC                                                           | Exposes the shop PC to the internet. **Rejected.**                                                                                                                                                               |

## 4. Security assessment

| Topic                               | What the design does                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is distributed                 | Only the installer. The packaging rules exclude the repository's tests, scripts, documentation, Docker files, databases, `.env` files and backups, and CI checks the package content (`scripts/verify-package.js`). Shop staff never need GitHub or the source.                                                                                                                  |
| Source code secrecy (honest limits) | An Electron program is JavaScript inside an archive (`app.asar`). It can be unpacked and read by anyone with the installer. Packing and minifying make it harder, not impossible, so **no absolute code secrecy is promised**. The design therefore keeps nothing secret in the program: security comes from passwords, server-side checks and encryption, not from hidden code. |
| Credentials in the client           | **None are built in.** The local database password is random, created on the shop PC at first start and stored only in `%APPDATA%\HeroMarket\heromarket.json`. Cloud credentials will be per-installation pairing keys created at setup (phase 4), never shipped in the installer. Signing keys stay with whoever builds the release.                                            |
| Local database protection           | PostgreSQL listens on `127.0.0.1` only (verified) with a random password (scram-sha-256). Other computers on the network cannot reach it. Anyone who can sign in to the Windows account can read the files: use a Windows password for the cashier account, and BitLocker if the PC could be stolen.                                                                             |
| Business rules and authorisation    | Enforced by the HeroMarket service (permissions on every operation, prices, discounts, stock), not by the screens. A modified client cannot sell at another price or grant a discount (tested).                                                                                                                                                                                  |
| Remote access (phase 5)             | HTTPS only; one owner account; password plus **mandatory** TOTP two-factor; rate-limited login; short sessions; every remote action audited; server-side authorisation. The shop PC is never reachable from the internet.                                                                                                                                                        |
| Updates                             | Installers are built by the release workflow from a tagged version (CI checks first) as a **draft** that a person publishes. Without code signing, Windows SmartScreen warns. Signing is recommended before wide use (§5).                                                                                                                                                       |

## 5. Updates, migrations, backups and recovery for a non-technical owner

1. **Getting an update:** you receive a new `HeroMarket-Setup-<version>.exe` (USB stick or download link) and double-click it. Automatic downloads are possible later; they are not switched on, because an update should not arrive in the middle of a working day without your decision.
2. **Database changes:** the program itself:
   1. sees that the new version needs to change the database;
   2. stops the database and copies it completely, checking every file;
   3. starts it again;
   4. only then applies the changes.

   If the copy fails, nothing changes. The newest three copies are kept.

3. **Daily backups:** one click in the program to a USB stick, plus a weekly copy of the data folder. The future cloud copy is an extra off-site copy, not a replacement.
4. **Going back:** reinstall the previous installer and put the pre-upgrade copy back. The installation guide (§7) lists the steps. A guided "restore" button for pre-upgrade copies is a planned improvement.
5. **Code signing:**
   - An OV code-signing certificate (from a commercial certificate authority, typically a few hundred USD per year, with a hardware token) removes the "Windows protected your PC" warning over time.
   - This is a purchase decision for you. Nothing has been bought.

## 6. Decisions for the owner

1. **Code-signing certificate:** buy one before rolling out, or accept the SmartScreen warning ("More info → Run anyway") for now?
2. **Installer type:** keep the per-user one-click installer (recommended), or install for all Windows users on the PC (needs administrator rights)?
3. **The version number of the first release** (currently 1.3.0, the same as the installed version; 2.0.0 is recommended).
