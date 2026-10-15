# Development Setup

How to get HeroMarket POS running on a development machine, run every check, and package it. Commands are for Windows (PowerShell or Git Bash); notes mark what differs on Linux.

## 1. Prerequisites

| Tool              | Version                  | Why                                                                                                                                              |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows 10/11 x64 | –                        | The app runs on Windows: PowerShell printing (`resources/print_receipt.ps1`), `typst.exe` for shortage PDFs, and the bundled PostgreSQL binaries |
| Node.js           | 22 or newer (CI uses 22) | Build tooling, Electron, the service, tests. `node:sqlite` is needed by the legacy importer.                                                     |
| npm               | bundled with Node        | `npm ci` installs exactly what `package-lock.json` pins                                                                                          |
| Git               | any recent               | Source control                                                                                                                                   |
| Docker Desktop    | optional                 | Store server and containerised tests ([DOCKER.md](DOCKER.md))                                                                                    |

No PostgreSQL installation is needed: `npm run pg:dev` runs PostgreSQL 17 from the `embedded-postgres` dev dependency.

On Linux: lint, build and all tests work, using a local PostgreSQL or `docker compose -f docker-compose.test.yml`. The desktop app itself targets Windows.

## 2. Clone and install

```powershell
git clone https://github.com/Youssef2508/hero-market.git HeroMarket
cd HeroMarket
npm ci            # also runs electron-builder install-app-deps
```

Remotes in the main working copy (see [SECURITY_AND_RELEASE.md](SECURITY_AND_RELEASE.md) §5):

| Remote                                                                | Use                                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `origin` → `https://github.com/Youssef2508/hero-market.git` (private) | All pushes and pull requests                                          |
| `upstream` → the original open-source code base                       | Fetch only; its push URL is set to `DISABLED-do-not-push-to-upstream` |

`gh` resolves the default repository to `upstream` in this clone. Always pass `--repo Youssef2508/hero-market` to `gh pr`, `gh run` and `gh repo` commands.

## 3. Development database

```powershell
npm run pg:dev                 # terminal 1: starts PostgreSQL 17 on 127.0.0.1:54329 (data in .pgdata/, git-ignored)
npm run pg:dev -- url          # print the connection URL of the 'heromarket' database
npm run pg:dev -- stop         # stop it (on Windows the server runs detached under pg_ctl)
```

- The first run creates the cluster, a random password (`.pgdata/credentials.json`) and the databases `heromarket` and `heromarket_test`.
- A development secret for PIN hashing is generated in `.pgdata/dev-secret.txt`.
- Never copy `.pgdata` anywhere public.

`npm run dev` connects to `heromarket` by default. On the first start the app asks you to create the administrator; there is no default account.

To work against a disposable copy, keep test sales away from your usual data with `HEROMARKET_DB_NAME`. Create the database first, for example with `psql` or by importing a fixture:

```powershell
$env:HEROMARKET_DB_NAME = "heromarket_qa"; npm run dev
```

**Legacy data.** To try the SQLite importer:

```powershell
npm run db:legacy-fixture -- --db C:\tmp\legacy.db --reset   # original schema + sample data (admin PIN 1234 …)
npm run db:import-sqlite -- --sqlite C:\tmp\legacy.db --database-url (npm run -s pg:dev -- url heromarket_qa) --dry-run
```

**Managed local mode in development** (the default for installed single-till stores):

```powershell
$env:HEROMARKET_LOCAL_DB = "1"; $env:HEROMARKET_USER_DATA = "C:\tmp\hm-local"; npm run dev
```

- This creates a private cluster in that folder exactly as an installed app would.
- If the folder contains a `market_unified.db`, it is imported as an upgrade. This is the way to rehearse an upgrade on a **copy** of a store's file.
- Development builds use `%APPDATA%\HeroMarket-dev` (or `HEROMARKET_USER_DATA`) and never the installed app's `%APPDATA%\HeroMarket`.

**Client mode against a local server:**

```powershell
# terminal 1
$env:HEROMARKET_DATABASE_URL = (npm run -s pg:dev -- url heromarket_qa); $env:HEROMARKET_SECRET = "<32+ chars>"; node src/server/cli.js serve
# terminal 2
$env:HEROMARKET_SERVER_URL = "http://127.0.0.1:8787"; npm run dev
```

## 4. Run the app

```powershell
npm run dev        # electron-vite dev server + Electron window with hot reload
npm start          # preview the production build (run `npm run build` first)
```

**`ELECTRON_RUN_AS_NODE` pitfall.** Some terminals (for example ones started by editor extensions or AI tools) export `ELECTRON_RUN_AS_NODE=1`. Electron then starts as plain Node.js, `require('electron').app` is `undefined`, and the main process dies at once. Clear the variable for the session:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npm run dev
```

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev
```

**Driving the window from a browser-automation tool.** Pass Chromium's debugging port through electron-vite, then connect any CDP client (Playwright `chromium.connectOverCDP('http://127.0.0.1:9222')`, or Chrome DevTools at `chrome://inspect`):

```bash
HEROMARKET_DB_NAME=heromarket_qa env -u ELECTRON_RUN_AS_NODE npx electron-vite dev --remoteDebuggingPort 9222
```

The app allows a single instance. A killed instance can leave the debugging port bound for a while; use another port (for example 9333) if a new instance cannot bind it.

## 5. Checks

| Command                                                               | What it does                                                                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                                        | ESLint (flat config, React, hooks, Prettier as warnings). Must report 0 errors.                                                  |
| `npm run format:check`                                                | Prettier check of `src`, `tests`, `scripts`. `npm run format` rewrites files.                                                    |
| `npm run build`                                                       | electron-vite production build into `out/`                                                                                       |
| `npm test`                                                            | All 53 tests. Service suites use `HEROMARKET_TEST_DATABASE_URL`, or the `pg:dev` cluster; the run fails if neither is available. |
| `npm run test:unit` / `npm run test:service`                          | Only the database-free suites / only the PostgreSQL suites                                                                       |
| `docker compose -f docker-compose.test.yml run --rm --build tests`    | Lint, format, build and all tests in Linux containers                                                                            |
| `node scripts/verify-package.js dist/win-unpacked/resources/app.asar` | After `npm run build:unpack`: required files present, nothing local shipped                                                      |

Test databases are created and dropped per test file. Tests never touch `heromarket`, `heromarket_qa` or any installed data.

## 6. Brand assets

`resources/brand/heromarket-mark.svg` is the single source of the logo. After editing it:

```powershell
npm run icons     # renders PNGs, build/icon.{png,ico,icns}, resources/icon.png and the favicon via Electron
```

(`ELECTRON_RUN_AS_NODE` must be unset here too.)

## 7. Packaging

```powershell
npm run build:unpack     # dist/win-unpacked/HeroMarket-POS.exe – quickest way to smoke-test a packaged build
npm run build:win        # NSIS installer dist/HeroMarket-POS-<version>-setup.exe (unsigned)
```

- The installer ships the app, the service (`src/server`, `src/shared`) and the PostgreSQL 17 server binaries (`resources/pgsql`, from `@embedded-postgres/windows-x64`, without the pgAdmin GUI DLLs).
- It ships **no database and no account**.
- A packaged app uses `%APPDATA%\HeroMarket`. To smoke-test it on a machine with real data without touching that data, start the exe with `HEROMARKET_USER_DATA` pointing at a scratch folder.

## 8. Day-to-day Git workflow

1. Branch: `git switch -c feature/<topic>` (or `fix/…`, `chore/…`). These prefixes run CI on push.
2. Keep commits focused. Run `npm run lint`, `npm run format:check` and `npm test` before pushing.
3. `git push -u origin feature/<topic>`, open a pull request with `--repo Youssef2508/hero-market`, and wait for CI ([CI_CD.md](CI_CD.md)).
4. Never push to `upstream`, never force-push shared branches, never commit `.db`, `.env`, `.pgdata`, `.migration-backups` or build output.
