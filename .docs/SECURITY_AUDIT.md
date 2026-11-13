# HeroMarket – Security audit (pre-production, 2026-11-13)

Part of [PRE_PRODUCTION_AUDIT_REPORT.md](PRE_PRODUCTION_AUDIT_REPORT.md). Audited: `main` at `36b45c8` (release 1.6.1) and the deployed cloud `https://heromarket.duckdns.org` (1.6.1, schema 0037), before the owner's first pairing. Fixes are on the branch `audit/pre-production`.

## 1. Threat model

**What is protected:** the store's business records (sales, money, stock, customers and their phone numbers, suppliers), the staff accounts, the ability to change records, and the shop's ability to keep selling.

**Attackers considered:**

| Attacker                          | Reaches                                            | Goal                                                                                     |
| --------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Anyone on the internet            | the cloud's ports 80/443 (and SSH 21/22)           | read or change the store's data, take over an account, claim the empty cloud, disrupt it |
| A staff member with a weaker role | the shop PC or the website, with their own account | do what their role does not allow (refunds, discounts, deleting, other users' data)      |
| A stolen or lost phone            | a signed-in browser session                        | act as that user                                                                         |
| Someone on the shop's LAN         | a networked store server, if one is set up         | reach the service without the till                                                       |
| A compromised dependency          | the build or the runtime                           | run code in the app or the server                                                        |

**Trust boundaries:**

1. Internet → Caddy (TLS, headers, 20 MB body cap) → the cloud service (sessions, permissions) → its PostgreSQL. Only Caddy is published.
2. Shop PC → cloud (outbound HTTPS only; device token, constant-time hash check; the cloud never connects to the shop).
3. Cloud → shop: a change made on the internet is carried out by the shop's own operation with the user's own permissions (`x-heromarket-remote` key, known only inside the shop process).
4. Electron renderer → main process: sandboxed renderer, context isolation, named IPC channels only, no navigation or pop-ups.

## 2. Attack surface inventory

| Surface                                          | Exposure                                                                                                               | Controls (verified)                                                                                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /` and static files                         | public                                                                                                                 | CSP meta (scripts from the site + one hashed inline), X-Frame-Options DENY, nosniff, no-referrer, HSTS; SPA fallback serves no files outside the bundle (`/api/../../etc/passwd` → 404) |
| `GET /api/health`                                | public                                                                                                                 | constant answer                                                                                                                                                                         |
| `auth.status`, `auth.login`                      | public                                                                                                                 | attempt limits per terminal, per address, per typed username (internet only); answers identical for unknown and wrong; scrypt N=2^14 r=8 p=5                                            |
| `auth.setup`, `auth.recover`, `auth.setPassword` | public in the shop, **refused on the cloud** (`shop_only`) before anything runs                                        | live probe: all three refused                                                                                                                                                           |
| every other operation                            | session (Bearer token or HTTP-only cookie + the page's own header) and its permission, checked before the body is read | `permissionsAudit.test.js` (every role refused every operation it lacks, by direct request); live probe without a session / with a forged token / a cookie alone: 401                   |
| `link.pair`                                      | public on the cloud                                                                                                    | one-time code (~59 bits), 15 minutes, hash only, 5 wrong codes cancel all open codes (counted in the database)                                                                          |
| `sync.*`, `link.*` (shop ↔ cloud)                | device token                                                                                                           | constant-time hash comparison; old epochs and replaced devices refused (`sync.test.js`, `syncRecovery.test.js`)                                                                         |
| SSH                                              | 21, 22                                                                                                                 | key only (`passwordauthentication no`), no root login; checked live                                                                                                                     |
| PostgreSQL, the service port 8787                | not published                                                                                                          | `ss` on the server: only 21/22/80/443; the new CI job checks it on every run                                                                                                            |

## 3. Findings

| ID     | Severity | Component             | Finding                                                                                                                                                                                                                                                                                                  | Status                                                                                                                                                                                                                                |
| ------ | -------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-03 | Medium   | service error handler | Malformed JSON, an over-limit body and an unknown content type were answered **500** and logged as "unhandled error" **with a stack trace**. Anyone on the internet could fill the log with false failures (15 such entries were found in the cloud log from this audit's own probes), hiding real ones. | **Fixed** (`src/server/app.js`): 400 / 413 / 415, not logged as failures. Regression test `preProductionAudit.test.js`. Live until the next cloud update.                                                                             |
| SEC-07 | Medium   | CI                    | The dependency audit was report-only (`continue-on-error: true`): a critical advisory would have left CI green.                                                                                                                                                                                          | **Fixed**: `scripts/audit-gate.js` fails on any high/critical advisory unless `.github/audit-exceptions.json` holds a reviewed, dated exception. Proven: unlisted → fails, dated exception → passes, expired → fails.                 |
| SEC-09 | Medium   | CI                    | The cloud stack (`deploy/cloud`) was never started in CI; only the LAN server stack was.                                                                                                                                                                                                                 | **Fixed**: the Docker job starts it as deployed and runs `scripts/cloud-smoke.sh` (headers, CSP, refusals, sessions, CSRF header, forged tokens, error leakage, body limit, traversal, unpublished ports). Proven on the next CI run. |
| SEC-08 | Low      | deployment            | `postgres:17-bookworm` and `caddy:2.10-alpine` were floating tags (everything else pinned by digest).                                                                                                                                                                                                    | **Fixed**: pinned to the digests running on the server; Dependabot watches `deploy/cloud`.                                                                                                                                            |
| SEC-10 | Low      | login guard           | Attempt counters live in memory: a restart of the cloud service clears them. Restarts happen only at updates; an attacker cannot trigger one.                                                                                                                                                            | Accepted (residual risk R-2).                                                                                                                                                                                                         |
| SEC-11 | Low      | CSP                   | The CSP meta has no `base-uri`, `form-action`, `object-src 'none'`. No injection point was found that they would stop (React escapes output; `default-src 'self'` covers objects).                                                                                                                       | Open, low.                                                                                                                                                                                                                            |
| SEC-12 | Low      | containers            | The Caddy container runs as root inside the container (with every capability dropped but NET_BIND_SERVICE, read-only filesystem, no-new-privileges). The internal network is not `internal: true` (Caddy needs the internet for certificates).                                                           | Accepted.                                                                                                                                                                                                                             |

No critical or high security finding. No authentication or authorization bypass was found.

## 4. Verified controls (evidence)

- **Proxy trust:** 20 failed sign-ins with forged `X-Forwarded-For`/`X-Real-IP`, then a new forged address → 429 for the real address (live, 2026-11-13).
- **Shop-only operations refused on the cloud:** `auth.setup`, `auth.recover`, `auth.setPassword`, `backup.export`, `backup.restore`, `system.reset` → `shop_only`; `sync.pair`, `sync.unlink` do not exist there (live).
- **Sessions:** 256-bit random tokens, stored as SHA-256; 12 h; revoked by logout, by a password change at the shop (D-106), by disabling the user; internet access withdrawn at the shop is refused before the cloud hears of it (`cloudSecurity.test.js`).
- **Secrets in the repository:** all 281 commits scanned for private keys, age secret keys, GitHub/AWS/Slack/OpenAI tokens and filled-in `POSTGRES_PASSWORD`/`HEROMARKET_SECRET`: none. Only empty example env files are tracked; compose refuses to start without real values.
- **Server:** `.env` mode 600; secrets 48 and 64 characters; the service runs as `node` on a read-only filesystem; no privileged container; unattended upgrades active.
- **Cryptography:** CSPRNG everywhere (`crypto.randomBytes`, `randomInt`); constant-time comparisons for PINs, passwords, device tokens and setup codes; backups encrypted to the owner's age key – **round trip proven**: an encrypted cloud backup was downloaded (checksum equal to the server's), decrypted on the PC with the owner's key (which never reaches the server), and restored into a scratch database (`--exit-on-error`), holding exactly the expected records.
- **Electron:** sandboxed renderer, context isolation, no Node integration; named IPC channels only; navigation and pop-ups refused (links open in the browser); the installed connection settings are writable by administrators only.
- **Dependencies:** runtime 0 vulnerabilities; build 6 moderate (one `minimatch` ReDoS advisory inside `electron-builder`, build time only, reported by the gate).

## 5. Residual risk register

| ID  | Risk                                                                                                                                  | Why accepted / mitigation                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | Distributed password guessing from many addresses against many usernames costs CPU (scrypt) on the cloud.                             | Per-username and per-address limits stop guessing one account; the shop's selling never depends on the cloud. Watch the server's load. |
| R-2 | A cloud restart clears attempt counters (SEC-10).                                                                                     | Restarts only at approved updates.                                                                                                     |
| R-3 | Anyone can pause one username's internet sign-in for 15 minutes by typing it wrongly 10 times (by design, D-105).                     | The shop is not affected; the owner can sign in at the shop.                                                                           |
| R-4 | A lost phone with a live session acts as that user for up to 12 hours.                                                                | Changing the password at the shop signs it out everywhere (D-106).                                                                     |
| R-5 | The owner's age private key exists on the dev PC and the owner's USB sticks only; if all are lost, the cloud backups cannot be read.  | The shop's local backups remain the primary recovery path.                                                                             |
| R-6 | Encrypted backup files made during this audit (synthetic data only) remain in the cloud's backup volume until they age out (14 days). | Deleting backup files was outside the authorization; they hold no real data.                                                           |

## 6. Production security checklist

- [x] Only 80/443 (Caddy) and SSH 21/22 (key only) reachable; PostgreSQL and the service unpublished.
- [x] TLS from Let's Encrypt, HTTP → HTTPS, HSTS.
- [x] First-run setup and password recovery impossible from the internet.
- [x] Every operation authorised on the server; role matrix tested by direct request.
- [x] Proxy trust limited to the proxy's fixed address.
- [x] Secrets only in `deploy/cloud/.env` (600), none in git.
- [x] Backups encrypted to the owner's key; restore proven.
- [ ] Deploy the AUD-03 fix (next release).
- [ ] CI green with the new dependency gate and cloud-stack job (branch `audit/pre-production`).
