# Development Setup

How to get HeroMarket POS running on a development machine, run every check, and package it.
Commands are for Windows (PowerShell or Git Bash); notes mark what differs on Linux/macOS.

## 1. Prerequisites

| Tool              | Version             | Why                                                                                                                                            |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11 x64 | –                   | The app ships Windows binaries: `sqlite3.exe` (database), `typst.exe` (shortage PDFs) and PowerShell printing (`resources/print_receipt.ps1`). |
| Node.js           | 22 LTS (same as CI) | Build tooling, Electron, tests                                                                                                                 |
| npm               | bundled with Node   | Use `npm ci` to install exactly what `package-lock.json` pins                                                                                  |
| Git               | any recent          | Source control                                                                                                                                 |
| Docker Desktop    | optional            | Only for the Linux validation image (`DOCKER.md`)                                                                                              |

On Linux/macOS you can lint, build and run the SQL tests (install the `sqlite3` CLI), but you cannot run the app with its database: the main process always uses `sqlite3.exe` from the repository root.

## 2. Clone and install

```powershell
git clone https://github.com/Youssef2508/hero-market.git HeroMarket
cd HeroMarket
npm ci            # runs postinstall: electron-builder install-app-deps
```

Remotes in the main working copy (see `SECURITY_AND_RELEASE.md` §5):

| Remote     | URL                                                              | Use                                                                   |
| ---------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `origin`   | `https://github.com/Youssef2508/hero-market.git` (private)       | All pushes and pull requests                                          |
| `upstream` | `https://github.com/3bkader-gpt/elnagdi-pos.git` (public source) | Fetch only; its push URL is set to `DISABLED-do-not-push-to-upstream` |

## 3. Development database

In development (`npm run dev`) the main process opens `market_unified_testing.db` in the repository root (git-ignored). Create it once:

```powershell
npm run db:init            # schema + triggers + sample products/clients/users
node scripts/init-dev-db.js --reset          # recreate from scratch (deletes that file and its -wal/-shm)
node scripts/init-dev-db.js --db C:\tmp\qa.db --reset   # a separate disposable database
```

Sample accounts created by `db:init` (development only, never shipped):

| User           | PIN  | Role    |
| -------------- | ---- | ------- |
| `admin`        | 1234 | admin   |
| `manager`      | 9999 | manager |
| `cashier1`     | 1111 | cashier |
| `cashier_test` | 5555 | cashier |

To keep test sales away from your usual dev data, point a session at another file with `HEROMARKET_DB_PATH` (dev only; ignored by packaged builds):

```powershell
$env:HEROMARKET_DB_PATH = "C:\tmp\qa.db"; npm run dev
```

The packaged app never uses these files: it keeps its database in `%APPDATA%\elnagdi-pos\market_unified.db` (folder name kept for upgrade compatibility, decision D-005). Do not experiment against that file.

## 4. Run the app

```powershell
npm run dev        # electron-vite dev server + Electron window with hot reload
npm start          # preview the production build (run `npm run build` first)
```

**`ELECTRON_RUN_AS_NODE` pitfall.** Some terminals (for example ones started by editor extensions or AI tools) export `ELECTRON_RUN_AS_NODE=1`. Electron then starts as plain Node.js, `require('electron').app` is `undefined`, and the main process dies immediately with a `TypeError` while reading a property of `app`. Clear the variable for the session:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npm run dev
```

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev
```

**Driving the window from a browser-automation tool.** Pass Chromium's debugging port through electron-vite, then connect any CDP client (Playwright `chromium.connectOverCDP('http://127.0.0.1:9222')`, Chrome DevTools at `chrome://inspect`):

```bash
HEROMARKET_DB_PATH=/c/tmp/qa.db env -u ELECTRON_RUN_AS_NODE npx electron-vite dev --remoteDebuggingPort 9222
```

## 5. Checks

| Command                                                            | What it does                                             | Notes                                                                                          |
| ------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run lint`                                                     | ESLint (flat config, React, hooks, Prettier as warnings) | Must report 0 errors                                                                           |
| `npm run format:check`                                             | Prettier check of `src`, `tests`, `scripts`              | `npm run format` rewrites files                                                                |
| `npm run build`                                                    | electron-vite production build into `out/`               |                                                                                                |
| `npm test`                                                         | All four SQL simulation suites via `tests/run-all.js`    | Copies `%APPDATA%\elnagdi-pos\market_unified.db` if it exists, otherwise bootstraps a fresh DB |
| `npm run test:fresh`                                               | Same suites on a freshly bootstrapped database           | What CI runs; never touches installed data                                                     |
| `docker build -t heromarket-ci . && docker run --rm heromarket-ci` | Lint + format + build + fresh tests in Linux             | See `DOCKER.md`                                                                                |

Test environment variables (also listed in `.env.example`; the app does not read a `.env` file):

| Variable                | Effect                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `TEST_FRESH_DB=1`       | Same as `--fresh`                                                                   |
| `TEST_SOURCE_DB=<path>` | Copy this database instead of the installed one                                     |
| `SQLITE3_BIN=<path>`    | sqlite3 CLI to use (default: `sqlite3.exe` on Windows, `sqlite3` on PATH elsewhere) |

The suites always work on the throw-away copy `tests/temp_test.db` (git-ignored) and remove it at the end of each suite; they never write to the source database.

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

`electron-builder.yml` copies `market_unified.db` from the repository root into the installer as the first-run database. Generate a clean one (schema + a single `admin`/`1234` account, no sample data) before building an installer for anyone else:

```powershell
node scripts/init-dev-db.js --db market_unified.db --reset --release-seed
```

The release workflow does exactly this; see `SECURITY_AND_RELEASE.md` for signing and publishing.

Smoke-testing a packaged build launches the real app, which uses `%APPDATA%\elnagdi-pos\`. Back that folder up first and restore it afterwards if the machine has real data.

## 8. Day-to-day Git workflow

1. Branch from `main`: `git switch -c feature/<topic>` (or `fix/…`, `chore/…`; these prefixes run CI on push).
2. Keep commits focused; run `npm run lint`, `npm run format:check`, `npm run test:fresh` before pushing.
3. `git push -u origin feature/<topic>` and open a pull request into `main`; wait for CI (`CI_CD.md`).
4. Never push to `upstream`, never force-push shared branches, never commit `.db`, `.env` or build output.
