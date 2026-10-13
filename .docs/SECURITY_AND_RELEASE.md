# Security and Release

## 1. Security model in one page

| Aspect                  | Current state (verified in code)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment              | One Windows PC per store, offline. No server, no network API, no payment integration.                                                                                                                                                                                                                                                                                                                                                                                              |
| Data                    | One SQLite file: `%APPDATA%\elnagdi-pos\market_unified.db` (packaged) or `market_unified_testing.db` / `HEROMARKET_DB_PATH` (development).                                                                                                                                                                                                                                                                                                                                         |
| Renderer isolation      | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`; the preload exposes a small `window.api` (`db.execute`, backup/restore, printing, shortages PDF). `setWindowOpenHandler` denies in-app windows and hands the URL to the default browser (`shell.openExternal`, template default).                                                                                                                                                                            |
| Content Security Policy | `index.html`: `default-src 'self' data: blob:`; `script-src 'self' 'unsafe-inline' 'unsafe-eval'` (inherited; the inline pre-paint theme script relies on `'unsafe-inline'`); `style-src 'self' 'unsafe-inline'`; `img-src 'self' data:`; `font-src 'self' data:` (added for the bundled Cairo font); `connect-src 'self' ws://localhost:*`. No remote origins. Hardening idea: drop `'unsafe-eval'` for production builds and move the theme script to a hashed or external file. |
| SQL                     | The renderer composes SQL strings (values escaped with `escapeSql`) and the main process runs them through `sqlite3.exe`. A regex deny-list in `src/main/index.js` blocks `DROP TABLE`, `ALTER TABLE`, `ATTACH/DETACH DATABASE` and `DELETE FROM users`. This is defence-in-depth, not a security boundary (K-14).                                                                                                                                                                 |
| Authentication          | 4-digit PINs per user, stored as SHA-256 hashes; legacy plain-text PINs are still accepted and an open shift auto-resumes on launch (K-15). Roles: `admin`, `manager`, `cashier`.                                                                                                                                                                                                                                                                                                  |
| Secrets                 | None. The app needs no API keys, tokens or passwords at build or run time.                                                                                                                                                                                                                                                                                                                                                                                                         |

Known security-relevant defects are tracked in `TESTING_AND_KNOWN_ISSUES.md` (K-14, K-15, K-18).

## 2. Secrets and local data – rules

- Never commit `.env` files, databases (`*.db`, `*-wal`, `*-shm`), backups, logs with customer data, certificates or keys. `.gitignore` and `.dockerignore` block the common cases; review `git status` before every commit anyway.
- `.env.example` documents the only environment variables (all optional, all non-secret). The app does not load `.env` files.
- CI uses no repository secrets. If code signing is added (§6), its certificate lives only in GitHub encrypted secrets.
- Do not copy the store's production database to development machines, CI or containers. Use `npm run db:init`, `--release-seed` or `npm run test:fresh` instead.
- Back up `%APPDATA%\elnagdi-pos\` before testing a packaged build on a machine that has real data.

## 3. Repository and remote safety

| Remote                                                         | Purpose                                                     | Safety measure                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `origin` → `Youssef2508/hero-market` (private)                 | All development pushes and pull requests                    | Default branch `main`; work happens on `feature/*`, `fix/*`, `chore/*` branches                |
| `upstream` → `3bkader-gpt/elnagdi-pos` (public source project) | Fetch only, to compare with or pick fixes from the original | Push URL set to `DISABLED-do-not-push-to-upstream`, so an accidental `git push upstream` fails |

Rules: no force-pushes to shared branches, no history rewriting of `main`, merge through pull requests with green CI. Branch protection cannot be enforced on the current GitHub plan (`CI_CD.md` §5).

## 4. Dependency security

- `npm ci` with the committed lockfile everywhere (CI, Docker, release).
- Dependabot opens weekly npm and GitHub Actions update PRs and monthly Docker base-image PRs (`CI_CD.md` §3).
- **Recommended repository setting (not enabled yet):** _Settings → Code security → Dependabot alerts_ and _Dependabot security updates_. The API reported alerts as disabled on 2026-10-13. These are account settings, so they are left for the owner to switch on.

### Open advisories (`npm audit --omit=dev`, 2026-10-13)

7 findings (3 high, 4 moderate), all from the **Electron 39** dependency tree:

| Package                                                | Severity | Path / note                                                                                                                        | Fix                                                                                                                   |
| ------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `electron` 39.8.10                                     | high     | Sandbox/popup and protocol-handler advisories (GHSA-hq2x-r82h-9wj4, GHSA-gr2m-v5gq-v685, GHSA-j84w-jfhq-vhvj, GHSA-9qh4-3jw8-366w) | Electron ≥ 41.10.6 (npm suggests 44.x), a **major upgrade**                                                           |
| `extract-zip`                                          | high     | Used by `@electron/get` to unpack the Electron download (install time)                                                             | Comes with the Electron upgrade                                                                                       |
| `http-cache-semantics` 4.2.0                           | high     | `@electron/get` → `got` → `cacheable-request` (install time)                                                                       | 4.3.0 is in range; `npm audit fix` would also bump ~25 unrelated packages, so it is left to a dedicated dependency PR |
| `@electron/get`, `global-agent`, `roarr`, `sprintf-js` | moderate | Electron download tooling (install time)                                                                                           | Comes with the Electron upgrade                                                                                       |

Exposure assessment: the app loads only its own bundled renderer, opens no remote content, uses no `<webview>` and denies new windows, so the Electron advisories are not reachable through normal use. They are still real and should be fixed by upgrading Electron in its own pull request. Test that upgrade with the full checklist: lint, build, `npm run test:fresh`, a packaged smoke run, printing a receipt and generating a shortages PDF on a real Windows machine.

## 5. Versioning and tags

- Semantic versioning in `package.json` (`1.3.0` at the start of the redesign).
- A release is the tag `vX.Y.Z` on a commit of `main`; the release workflow refuses tags that do not match `package.json`.
- Feature work never creates releases. Only a deliberate tag push (or a manual run for an existing tag) does.

## 6. Building and publishing a release

The release workflow (`CI_CD.md` §2) builds on `windows-2025`: lint → fresh-database tests → release-seed database → unsigned NSIS installer → `SHA256SUMS.txt` → **draft** GitHub Release. A person must then:

1. Download the installer from the draft and check its SHA-256 against `SHA256SUMS.txt`.
2. Install it on a clean Windows test machine (or VM). Confirm the window title and icon, log in with `admin` / `1234`, change that PIN, open a shift, make a test sale in a test database, print a receipt.
3. On a machine with an existing installation, confirm the upgrade keeps the data (`%APPDATA%\elnagdi-pos\market_unified.db` is reused, decision D-005).
4. Publish the draft release.

### First-run database

`electron-builder.yml` ships `market_unified.db` from the repository root as the initial database; it is copied to `%APPDATA%\elnagdi-pos\` only if no database exists there. The release workflow generates it with `node scripts/init-dev-db.js --db market_unified.db --reset --release-seed`: full schema, default settings and **one account `admin` with PIN `1234` (stored hashed)**, no sample products, customers or users. The release notes tell the store to change that PIN immediately. Never build an installer from a working copy whose root `market_unified.db` contains development or store data.

### Code signing (not configured)

Installers are currently **unsigned**: Windows SmartScreen will warn on first run, and the release notes say so. No certificate exists in this project and none should be invented. To sign later:

1. Obtain an Authenticode code-signing certificate (OV or EV) from a certificate authority, or use a cloud signing service such as Azure Trusted Signing.
2. For a `.pfx` certificate, store it base64-encoded as the repository secret `WIN_CSC_LINK` and its password as `WIN_CSC_KEY_PASSWORD` (electron-builder reads both). Cloud/HSM signing uses electron-builder's `win.azureSignOptions` or a custom `sign` hook instead.
3. In `release.yml`, remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` and pass the secrets as environment variables to the build step only.
4. Verify the signature on the built installer (`Get-AuthenticodeSignature`) as part of the manual check.

### Auto-update (not configured)

`electron-builder.yml` contains a placeholder `publish` provider (`https://example.com/auto-updates`) inherited from the project template, and the app does not include an updater. Installers are distributed manually. Do not enable auto-update until signing is in place and a real update feed exists.

## 7. Rollback

- **Bad installer, not yet installed anywhere:** delete the draft release (or the asset), fix, and tag a new patch version. Do not move or reuse tags that were ever published.
- **Installed and misbehaving:** reinstall the previous version's installer; the database stays in `%APPDATA%\elnagdi-pos\`. The redesign added no schema changes, so moving between 1.3.x builds keeps the data compatible. Before any version that changes the schema, take a backup from _Backup_ (النسخ الاحتياطي) first.
- **Data problem:** restore a backup from the Backup screen. Restore **overwrites** the current database file (after a WAL checkpoint) and does not keep a copy of it, so take a fresh backup of the current state first, then restart the app as prompted.
