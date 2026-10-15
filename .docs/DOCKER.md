# Docker

## 1. What runs in containers

The HeroMarket **desktop app** (Electron window, PowerShell printing, Typst PDFs) runs on Windows and is not containerised. Since the PostgreSQL migration, Docker has two jobs:

| Compose file              | Purpose                                                                                                      | Images                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `docker-compose.yml`      | **Multi-till store server**: PostgreSQL 17 + the HeroMarket service that the tills ("جهاز كاشير") connect to | `postgres:17-bookworm`, `Dockerfile.server` |
| `docker-compose.test.yml` | **Validation environment**: lint, build and every test suite against a throw-away PostgreSQL                 | `postgres:17-bookworm`, `Dockerfile`        |

A single-till store needs no Docker: the app manages its own PostgreSQL ([DATABASE_ARCHITECTURE.md §3.1](DATABASE_ARCHITECTURE.md)).

## 2. Store server

```powershell
copy .env.example .env      # POSTGRES_PASSWORD, HEROMARKET_SECRET, HEROMARKET_BIND (LAN IP), HEROMARKET_TLS_NAMES / _DEFAULT_NAME
docker compose up -d        # db, server, proxy (HTTPS on HEROMARKET_BIND:8443)
docker compose logs server  # first start: "HeroMarket first-run setup code: 12345678"
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./root.crt   # the store's root certificate
```

On each till choose **جهاز كاشير**:

1. Enter `https://<server-ip>:8443`.
2. Press **اختيار الشهادة…** and pick `root.crt` (copied on a USB stick, for example). Compare the SHA-256 shown on the till with the one printed on the server: `docker compose exec proxy sh -c "openssl x509 -noout -fingerprint -sha256 -in /data/caddy/pki/authorities/local/root.crt"`.
3. The first till of a new server also needs the setup code.

| Service                                  | Exposure                                                 | Hardening                                                                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`                                     | Compose network only                                     | Volume `pgdata`; `pg_isready` health check; `no-new-privileges`                                                                                                                                                                    |
| `server`                                 | Compose network only (`expose: 8787`, **not published**) | uid 1000, read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, health check `cli.js health`; secrets from the environment or `*_FILE`                                                                                  |
| `proxy` (Caddy 2.10, `deploy/Caddyfile`) | `HEROMARKET_BIND:8443`, HTTPS only                       | TLS 1.2/1.3 with Caddy's **local CA** (`tls internal`, root kept in volume `caddy_data`); HSTS; admin API off; read-only root filesystem, `cap_drop: ALL` + `NET_BIND_SERVICE` (the binary's file capability), `no-new-privileges` |

**Trust model (G-24, D-039).**

- The proxy's root CA is created on the server and never leaves it, except as the public `root.crt`.
- Tills do **not** add it to Windows: each till pins it in `heromarket.json` (`serverCaPem`). It accepts the server only when the presented chain is signed up to that root, every certificate is in date, and the certificate names the address the till uses (`src/main/tlsPin.js`, Chromium's network stack in a dedicated session).
- Session tokens therefore travel only inside TLS.
- Certificates trusted by Windows, for example from a real certificate authority, are accepted too.
- Plain `http://` is still accepted for development and for a server on the same PC. Do not use it across a shared network.
- **Back up the `caddy_data` volume with the database:** a new root means re-pinning every till.

Verified on 2026-10-14:

- `https://127.0.0.1:8443` (no SNI) and `https://localhost:8443` work with the pinned root over TLS 1.3.
- The connection is refused without the root and for a wrong name.
- Port 8787 is unreachable from the host.
- A real Electron till completed setup and login over HTTPS with the pinned root, and was refused with "شهادة أمان خادم المتجر غير موثوقة…" without it.

**Operations:**

| Task                         | Command                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upgrade                      | `git pull` then `docker compose up -d --build` (migrations run on start)                                                                                                                                                                                                                                                    |
| Logs                         | `docker compose logs -f server`                                                                                                                                                                                                                                                                                             |
| Backup                       | `docker compose exec db pg_dump -U heromarket -Fc heromarket > heromarket-$(Get-Date -Format yyyyMMdd).dump`. Keep `.env` (it holds the secret) with the dumps, off the machine.                                                                                                                                            |
| Restore into an empty volume | `docker compose exec -T db pg_restore -U heromarket -d heromarket --clean --if-exists < file.dump`                                                                                                                                                                                                                          |
| Import an old SQLite store   | From a checkout of the repository: `node scripts/import-sqlite.js --sqlite <file> --database-url <url>`, with the URL pointing at the server's PostgreSQL (temporarily publish port 5432 or run it on the server). The server image does not contain the import script. See [DATABASE_MIGRATION.md](DATABASE_MIGRATION.md). |
| Stop / remove (keeps data)   | `docker compose down`. `down -v` **deletes the database volume**: only for throw-away setups.                                                                                                                                                                                                                               |

## 3. Validation environment

```powershell
docker compose -f docker-compose.test.yml run --rm --build tests   # exit code = result
docker compose -f docker-compose.test.yml down -v
```

`Dockerfile`:

- Base: `node:22-bookworm-slim` pinned by digest, non-root `node` user.
- `npm ci --ignore-scripts`: no Electron binary is needed to lint, build or test.
- `CMD`: `npm run lint && npm run format:check && npm run build && npm test`.

`test-db` is PostgreSQL 17 with `trust` authentication on the internal compose network, data in tmpfs and nothing published. Each test file creates and drops its own database. `npm test` fails rather than skips if the database is not reachable.

## 4. What `.dockerignore` keeps out

- `node_modules`, `out`, `dist`, `.git`, `.github`.
- Every `*.db` / `*-wal` / `*-shm` / `*-journal` file, `.pgdata` and `.migration-backups` (real data never enters an image).
- `.env*` (except `.env.example`).
- Windows binaries, and documentation and report folders the checks do not read.

## 5. In CI

The `docker` job in `.github/workflows/ci.yml` runs both: the validation environment, then the server stack with throw-away credentials. It checks health, the setup-code requirement and the log line, then removes everything. See [CI_CD.md](CI_CD.md).

## 6. Verified

On 2026-10-14 (Docker 29.4.1, Windows host, Linux containers):

- the validation run passed 50/50 tests;
- the server stack started healthy, required the setup code and ran as uid 1000;
- CI repeated both on GitHub-hosted runners.
