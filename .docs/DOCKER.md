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
copy .env.example .env      # fill in POSTGRES_PASSWORD and HEROMARKET_SECRET (see the comments in the file)
docker compose up -d        # builds Dockerfile.server, starts db then server (waits for db health)
docker compose logs server  # first start: "HeroMarket first-run setup code: 12345678"
```

1. On the first till, choose **جهاز كاشير**, enter `http://<server-ip>:8787`, then create the administrator with the setup code from the log.
2. Every other till only needs the address.
3. Set `HEROMARKET_BIND` in `.env` to the server's LAN address so the tills can reach it. The default `127.0.0.1` keeps the API on the server PC only.

| Service  | Hardening                                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`     | No published port (reachable only by `server` on the compose network). Data in the named volume `pgdata`. UTF-8, `C` collation. `pg_isready` health check. `no-new-privileges`.                                                                                                                                                 |
| `server` | Runs as uid 1000 (`node`). `read_only: true` root filesystem with a tmpfs `/tmp`. `cap_drop: ALL`, `no-new-privileges`. Health check `node src/server/cli.js health` (polls `/api/health`). The secret and database URL come from the environment (`*_FILE` variants accept Docker secrets) and are never baked into the image. |

`Dockerfile.server`:

- Base: `node:22-bookworm-slim`, pinned by digest.
- Dependencies: `npm ci --omit=dev --ignore-scripts` (runtime dependencies only, exactly as locked).
- Copies only `src/server` and `src/shared`.
- `EXPOSE 8787`; `CMD node src/server/cli.js serve`. On start the server migrates the database, then listens. `SIGTERM` closes it cleanly.

**Operations:**

| Task                         | Command                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upgrade                      | `git pull` then `docker compose up -d --build` (migrations run on start)                                                                                                                                                                                                                                                    |
| Logs                         | `docker compose logs -f server`                                                                                                                                                                                                                                                                                             |
| Backup                       | `docker compose exec db pg_dump -U heromarket -Fc heromarket > heromarket-$(Get-Date -Format yyyyMMdd).dump`. Keep `.env` (it holds the secret) with the dumps, off the machine.                                                                                                                                            |
| Restore into an empty volume | `docker compose exec -T db pg_restore -U heromarket -d heromarket --clean --if-exists < file.dump`                                                                                                                                                                                                                          |
| Import an old SQLite store   | From a checkout of the repository: `node scripts/import-sqlite.js --sqlite <file> --database-url <url>`, with the URL pointing at the server's PostgreSQL (temporarily publish port 5432 or run it on the server). The server image does not contain the import script. See [DATABASE_MIGRATION.md](DATABASE_MIGRATION.md). |
| Stop / remove (keeps data)   | `docker compose down`. `down -v` **deletes the database volume**: only for throw-away setups.                                                                                                                                                                                                                               |

The API is plain HTTP on the LAN. For shared networks, put a TLS reverse proxy in front of port 8787 (G-24).

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
