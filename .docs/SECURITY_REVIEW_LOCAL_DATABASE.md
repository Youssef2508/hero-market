# Security review: the shop database on a PC shared by several Windows users (1.4.0)

Date: 2026-10-16. Requested by the owner before release: who can read the database credentials, what they allow, and what to do about it. Evidence comes from a clean Windows Sandbox running the 1.4.0 installer, with a standard Windows user created for the test.

## 1. How 1.4.0 runs the database today

- PostgreSQL is started by **whichever Windows user opens HeroMarket first**, and runs as that user.
- Its files are in `C:\ProgramData\HeroMarket\pgdata`. The settings file `heromarket.json` (database password, server secret) is in `C:\ProgramData\HeroMarket`.
- Every Windows user of the PC has **modify** rights on that folder, because each of them must be able to start the database.
- The app connects as `heromarket`. That role is the **database superuser**, because it was created by `initdb -U heromarket`.
- The server listens on `127.0.0.1` only, so other PCs cannot reach it.

## 2. What a standard Windows user can do (tested)

Test account: `cashier2`, a standard (non-administrator) user. HeroMarket and its database had been started by the Sandbox's administrator account.

| Question                                                                             | Result                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Read `heromarket.json` (database password, server secret)                            | **Yes**                                                                |
| Write inside the database folder, including `postgresql.auto.conf` (server settings) | **Yes**                                                                |
| Log in to the database directly with that password                                   | **Yes**                                                                |
| Is that login a database superuser?                                                  | **Yes**                                                                |
| Run a Windows command through the database (`COPY … TO PROGRAM`)                     | **Yes. It ran as the administrator account that started the database** |

**Consequence:** any person with a standard Windows account on the till PC can do all of the following, without any HeroMarket permission or audit entry:

- read and change all shop data (sales, prices, stock, users);
- run programs as the Windows account that opened HeroMarket first. If that is an administrator, they can take over the PC.

Writable server settings give the same result even without the password, the next time the database starts.

**Before 1.4.0**, the data lived inside one Windows user's profile, so other standard users could not reach it. The all-users installation introduced this exposure.

The secret in `heromarket.json` only protects lookups of old PINs, and old PINs are erased at the first password sign-in. It does not sign sessions, so reading it does not by itself allow forging a HeroMarket sign-in.

## 3. Other effects of running the database inside a user's session (tested or read in the code)

- When the account that started the database signs out of Windows, Windows ends its processes. The database stops under any other account still selling.
- After every account has closed HeroMarket, the database keeps running until the PC restarts (tested).
- The safety copy before a database upgrade stops the database, even if another account is connected.

## 4. Options

| Option                                                                                                           | Who can still read the credentials                                        | Direct database access by a Windows user                                                                                            | Effort                                      | Effect on the all-users installation                  |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| **A. Keep as is**                                                                                                | Every Windows user                                                        | Full superuser, plus Windows commands as another account                                                                            | 0                                           | —                                                     |
| **B. Restrict file permissions only**                                                                            | —                                                                         | **Not possible**: the database runs as whichever user opens HeroMarket, so every user needs write access to its files               | —                                           | —                                                     |
| **C. Database as a Windows service with its own account (recommended now)**                                      | Every Windows user can read only an **ordinary** database role's password | Shop data only, through SQL; **no** superuser, **no** server settings, **no** Windows commands, **no** access to the database files | About 2–3 days, then a full Sandbox re-test | Kept: one administrator approval at install, as today |
| **D. C, plus the HeroMarket service itself as a Windows service** (the app signs in to it like a networked till) | **Nobody** except administrators                                          | **None**: everything goes through HeroMarket sign-in, permissions and audit                                                         | About 1–2 weeks                             | Kept                                                  |

### Option C in detail

- The installer registers **`HeroMarketDB`**, a Windows service that runs PostgreSQL under the virtual account `NT SERVICE\HeroMarketDB` and starts automatically with Windows.
- **Folder rights:**
  - `pgdata` — only SYSTEM, Administrators and the service account.
  - Users can **read** only the app's connection settings and **write** none of them.
- **Database roles:**
  - `heromarket` becomes an **ordinary role** that owns the shop's tables. It has no superuser rights, and the app needs none (checked: migrations, restore and import use only table ownership).
  - A separate superuser password is kept in an administrators-only file, for the installer and support.
- **The safety copy before an upgrade** is taken by the installer itself (it already runs as administrator), with the same file-by-file check as today.
- **Side benefits:** the database no longer depends on who is signed in to Windows. That fixes the three problems in §3.
- **Residual risk after C:** a Windows user with technical skill could still connect with the ordinary role's password and change shop data directly, without HeroMarket's permissions or audit. They could no longer touch Windows, other accounts or the database files. Option D removes this.

## 5. Decision and result

**Decision (owner, 2026-10-16): option C, before release.** Implemented in 1.4.0:

- `src/main/serviceSetup.js`, run by the installer as administrator (`--setup-service`; `--stop-service` on update, `--remove-service` on uninstall);
- `src/server/db/appRole.js` (ordinary role `hm_app`, ownership transfer);
- `build/installer.nsh`.

**Verified in a clean Windows Sandbox (2026-10-16)**, same standard user `cashier2`, HeroMarket opened by the administrator account:

| Question                                                        | Before (A)                | After (C)                                            |
| --------------------------------------------------------------- | ------------------------- | ---------------------------------------------------- |
| Read `heromarket.json`                                          | Yes                       | Yes (it now holds only the ordinary role's password) |
| Read the superuser password (`adminsuperuser.json`)             | —                         | **No** (access denied)                               |
| List or write the database files, change `postgresql.auto.conf` | Yes                       | **No** (access denied)                               |
| Stop the database service                                       | —                         | **No** (access denied); starting it is allowed       |
| Log in to the database                                          | As superuser              | As `hm_app`, **not** a superuser                     |
| Read server files, change server settings, create roles         | Yes                       | **No** (permission denied)                           |
| Run a Windows command through the database                      | Yes, as the administrator | **No** (permission denied)                           |
| Read or change shop data with SQL                               | Yes                       | **Yes** (residual risk, below)                       |

Also verified there:

- **Service account:** PostgreSQL runs as `NT SERVICEHeroMarketDB` and starts with Windows.
- **Two Windows accounts** can work at the same time. The database keeps running when either one signs out or closes HeroMarket.
- **Upgrade from 1.3:** imported with parity, running as `hm_app`.
- **Update and reinstall:** a reinstall over 1.4.0 and a reinstall after uninstalling both take a verified copy first and reuse the data. Uninstalling removes the service and keeps the data.
- **Automated proof:** `tests/service/appRole.test.js` runs the whole app as an ordinary role (migrations from scratch, sales, backup and restore, the 1.3 import) and checks that each dangerous statement is refused.

## 6. Residual risk (accepted for 1.4.0, to be closed by option D)

A person with a Windows account on the till PC and technical skill can read `hm_app`'s password and change shop data directly with SQL. This bypasses HeroMarket's permissions and audit log.

They can no longer:

- touch Windows or another account;
- reach the database files or the server settings;
- obtain database superuser rights.

**Until option D:** give Windows accounts on the till PC only to trusted people, each with its own Windows password.
