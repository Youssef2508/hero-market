# Security and Release

## 1. Security model (verified in code)

| Aspect                  | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trust boundary          | Only the **HeroMarket service** (`src/server`) talks to PostgreSQL. The renderer sends an operation name and a JSON body over IPC (`api:call`, name checked against `/^[a-zA-Z]+\.[a-zA-Z]+$/`). There is no SQL IPC channel. Each operation validates its body against a JSON schema (Fastify), checks permissions and runs in a transaction where it writes.                                                                             |
| Credentials             | Database URL and password, server secret and session token stay in the main process or the server. The local cluster's password is in `%APPDATA%\HeroMarket\heromarket.json` (written atomically, mode 0600; Windows ACLs restrict `%APPDATA%` to the user). It is never sent to the renderer. Tills in client mode hold no database credentials at all.                                                                                   |
| Authentication          | 4-digit PIN per user. Lookup is an HMAC-SHA256 key over the server secret (`users.pin_lookup`, unique); verification is scrypt (`users.pin_hash`, N=16384). Legacy SHA-256 or plain-text PINs are accepted once and upgraded on that login. The first administrator cannot use the guessable PINs `0000`, `1234` or `1111`; both the setup screen and the service refuse them.                                                             |
| Brute force             | 5 wrong PINs in 5 minutes lock that terminal for 60 s. 20 wrong PINs in 15 minutes lock the whole source address for 15 minutes, so rotating terminal names gives no extra attempts. The same applies to supervisor approval and the setup code. Failures are counted in memory per service instance.                                                                                                                                      |
| Sessions                | Random 32-byte tokens; only their SHA-256 is stored (`sessions`). They expire after 12 h, and logout, lock, a new login on the same till, disabling or deleting a user, or a restore revoke them. Every request re-reads the user and role, so a revoked permission takes effect on the next call.                                                                                                                                         |
| Authorisation (RBAC)    | Permission catalogue of 31 keys (`src/server/auth/permissions.js`). Roles hold permissions (`roles`, `role_permissions`). Every operation declares `permission` / `anyPermission` and the service checks it. Hidden UI elements are only convenience. Details in §2.                                                                                                                                                                       |
| First run               | No default account. `auth.setup` works only while `users` is empty, and creates one super administrator. A networked server (`cli.js serve`) also requires a one-time **setup code** printed in its log, so a LAN client cannot claim the store first.                                                                                                                                                                                     |
| Audit                   | Sensitive operations write `system_logs` rows server-side: sales, returns, approvals, shifts, tills, products, customers, suppliers, cheques, expenses, users, roles, settings, templates, backup and restore. 37 action types, shown with Arabic labels.                                                                                                                                                                                  |
| Logging                 | pino structured logs with `authorization` headers and `pin` fields redacted. Errors map to `{ error: { code, message } }` and never expose stack traces.                                                                                                                                                                                                                                                                                   |
| Renderer isolation      | `contextIsolation: true`, `nodeIntegration: false`. The preload exposes a small `window.api`. `setWindowOpenHandler` denies new windows, `will-navigate` is blocked, and no remote content is loaded.                                                                                                                                                                                                                                      |
| Content Security Policy | Production build (`electron.vite.config.mjs#productionCsp`): `default-src 'self' data: blob:`; `script-src 'self' 'sha256-…'` (only the hashed theme script, no `unsafe-eval`, no inline wildcard); `style-src 'self' 'unsafe-inline'` (React inline styles); `connect-src 'self'`. Development keeps `unsafe-eval`, inline scripts and the HMR websocket for React Fast Refresh. The build fails if the production policy is not applied. |
| Network                 | Local mode: PostgreSQL listens on `127.0.0.1` only, with scram-sha-256. Server mode: PostgreSQL is not published (compose network only), and the HeroMarket API is plain HTTP on port 8787, bound to `HEROMARKET_BIND`. **Use a TLS reverse proxy on shared networks** (G-24).                                                                                                                                                             |
| Printing input          | Receipt and report text is sanitised: printer tags, column and box separators and line breaks are stripped from all data and template text (tests in `receipt.test.mjs`, `reports.test.mjs`).                                                                                                                                                                                                                                              |
| Containers              | Non-root, read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, no secrets in images (environment variables or `*_FILE` Docker secrets).                                                                                                                                                                                                                                                                                        |

## 2. Roles and permissions

| Built-in role (`roles.key`) | Name                | Permissions                                                                                                                                    |
| --------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `super_admin`               | مدير النظام         | All 31. **Protected**: permissions cannot be edited and the role cannot be deleted.                                                            |
| `store_admin`               | مدير المتجر         | All except `system.reset`                                                                                                                      |
| `manager`                   | مشرف                | Management screens and reports without `users.manage`, `roles.manage`, `system.reset`, `shifts.multi_till`, `tills.manage` (the old "manager") |
| `cashier`                   | كاشير               | `pos.sell`, `pos.credit`, `pos.discount`, `shifts.operate`, `tills.operate`                                                                    |
| `inventory`                 | أمين مخزن / مشتريات | Products (view, manage, cost), damaged goods, reorder assistant, suppliers                                                                     |
| `auditor`                   | مراجع (قراءة فقط)   | View-only: sales, products and cost, customers, suppliers, all shifts, reports, logs                                                           |

Administrators can create custom roles from any subset of the catalogue (الأدوار والصلاحيات). The service enforces these invariants (`src/server/modules/admin.js`, tests in `admin.test.js`):

- at least one **active super administrator** always remains: the last one cannot be deleted, disabled or moved to another role;
- nobody can change their own role or disable themselves;
- nobody can grant a role, or assign a user to a role, with permissions they do not hold themselves (**no escalation**);
- the protected role's permissions are fixed, and a role that still has users cannot be deleted;
- changes apply on the next request, and disabling a user revokes their sessions at once.

New permissions introduced by later releases are granted once to the built-in roles that should include them (`permission_catalog`, migration 0003). A permission an administrator removed is never re-added.

## 3. Secrets and local data: rules

- Never commit `.env`, databases (`*.db`, `*-wal`, `*-shm`), `.pgdata/`, `.migration-backups/`, backup files, logs with customer data, certificates or keys. `.gitignore`, `.dockerignore`, the electron-builder `files` patterns and `scripts/verify-package.js` (run in CI) block these. Review `git status` before every commit anyway.
- `.env.example` documents every variable. The server's real values (`POSTGRES_PASSWORD`, `HEROMARKET_SECRET`) live only in the server's `.env` or Docker secrets. **Keep the secret with the database backups.**
- CI uses no repository secrets: the Docker job generates throw-away credentials per run.
- Do not copy a store's database to development machines, CI or containers. Use `npm run db:legacy-fixture`, the test suites' throw-away databases, or a **copy** in a scratch `HEROMARKET_USER_DATA` folder for upgrade rehearsals.

## 4. Repository and remote safety

| Remote                                          | Purpose                      | Safety measure                                                                                                                  |
| ----------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `origin` → `Youssef2508/hero-market` (private)  | All pushes and pull requests | Work on `feature/*`, `fix/*` and `chore/*` branches; PRs with green CI                                                          |
| `upstream` → the original open-source code base | Fetch only                   | Push URL set to `DISABLED-do-not-push-to-upstream`. `gh` defaults to this remote: always pass `--repo Youssef2508/hero-market`. |

No force-pushes to shared branches and no history rewriting. The current GitHub plan cannot enforce branch protection ([CI_CD.md](CI_CD.md) §5).

## 5. Dependency security

- `npm ci` with the committed lockfile everywhere. Dependabot sends weekly npm and Actions PRs and monthly Docker PRs.
- **2026-10-14:** Fastify was upgraded 5.6.2 → 5.12.7 and fast-uri 3.1.3 → 3.1.8. This fixes high advisories in the service's HTTP layer, among them a Content-Type parsing issue that bypassed body validation.
- **Electron 43 (PR #3, 2026-10-15):** Electron 39.8.10 → **43.7.11** (Node 24.21, Chromium 150). The four Electron advisories (GHSA-hq2x-r82h-9wj4, GHSA-gr2m-v5gq-v685, GHSA-j84w-jfhq-vhvj, GHSA-9qh4-3jw8-366w; fixed from 41.10.6) are resolved; 43 was chosen over 42 because Electron supports only the latest three majors and 42 drops out when 45 ships. `npm audit --omit=dev`: **0**. Full tree: 8 moderate, all one packaging-time chain (electron-builder → `@electron/get` → `global-agent` → `roarr` → `sprintf-js` ≤ 1.1.3, no patched release published) – not shipped in the app.
- Recommended account setting (owner): enable _Dependabot alerts_ and _security updates_ under Settings → Code security.

## 6. Versioning and tags

- Semantic versioning in `package.json`.
- A release is the tag `vX.Y.Z` on a commit of `main`. The release workflow refuses tags that do not match `package.json`.
- Feature work never creates releases. Only a deliberate tag push, or a manual run for an existing tag, does.

## 7. Building and publishing a release

The release workflow ([CI_CD.md](CI_CD.md) §2) builds on `windows-2025`: lint → tests on the bundled PostgreSQL → unsigned NSIS installer → package content check → `SHA256SUMS.txt` → **draft** GitHub Release.

**The installer ships no database and no account.** On first start a new store's app creates its database and asks for the administrator. An upgraded store's app imports the earlier data ([DATABASE_MIGRATION.md](DATABASE_MIGRATION.md)).

Before publishing a draft, a person must:

1. Check the installer's SHA-256 against `SHA256SUMS.txt`.
2. On a clean Windows test machine or VM:
   - install, check the window title and icon, and create the administrator;
   - open a shift, sell in a test store, print a receipt and a shift-close report, and close the app;
   - start it again and confirm the data is still there.
3. On a test machine with a **copy** of a v1.3 store in `%APPDATA%\elnagdi-pos`:
   - install the new version and confirm the import succeeds (report in `%APPDATA%\HeroMarket\backups`);
   - log in with an existing PIN, and confirm the store name and data are intact.
4. Publish the draft.

**Code signing (not configured).** Installers are unsigned, so SmartScreen warns, and the release notes say so. To sign later:

1. Obtain an Authenticode certificate, or use a cloud signing service.
2. Store a `.pfx` as the `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets.
3. Remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from `release.yml` and pass the secrets to the build step only.
4. Verify with `Get-AuthenticodeSignature`.

**Auto-update (not configured).** `electron-builder.yml` still has a placeholder `publish` URL and the app has no updater. Do not enable auto-update before signing and a real update feed exist.

## 8. Rollback

- **Bad installer, not yet installed anywhere:** delete the draft or its assets, fix, and tag a new patch version. Never move or reuse a published tag.
- **Installed and misbehaving:** export a backup (النسخ الاحتياطي → حفظ نسخة), then reinstall the previous HeroMarket version.
  - Versions from this one on share `%APPDATA%\HeroMarket` and migrate the schema forward only. A restore requires the backup's schema version to match.
  - Going back to **1.3 (SQLite)** uses the untouched `%APPDATA%\elnagdi-pos\market_unified.db`. Changes made since the upgrade must be re-entered ([DATABASE_MIGRATION.md §5](DATABASE_MIGRATION.md)).
- **Data problem:** restore a backup from the Backup screen. The current state is saved first as `backups\pre-restore-*.json`, the restore replaces all data in one transaction, and everyone is signed out.
