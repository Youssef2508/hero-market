# Docker

## 1. What Docker is (and is not) used for

HeroMarket POS is a Windows desktop application. At runtime it needs the Electron window, the bundled Windows binaries `sqlite3.exe` and `typst.exe`, and PowerShell-based printing. None of that can run in a Linux container, and the store has no server component to containerise. So **the application is not containerised** (decision D-012).

Docker is used for one thing: a **reproducible Linux validation image**. Every developer and CI get the same toolchain to run:

1. `npm run lint`
2. `npm run format:check`
3. `npm run build` (main, preload and renderer bundles)
4. `npm run test:fresh` (the four SQL simulation suites against a freshly bootstrapped SQLite database, using Debian's `sqlite3` CLI)

There is no `docker-compose.yml`: there is one short-lived container with no services, ports or volumes to orchestrate.

## 2. Files

| File            | Purpose                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `Dockerfile`    | Validation image definition                                                        |
| `.dockerignore` | Keeps the build context small and free of local data, secrets and Windows binaries |

### Dockerfile summary

| Choice                                                       | Reason                                                                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `node:22-bookworm-slim` pinned **by digest**                 | Same Node major as CI; the digest makes builds reproducible. Dependabot (`docker` ecosystem, monthly) proposes digest updates as pull requests. |
| `apt-get install sqlite3`                                    | Linux replacement for `sqlite3.exe` in the tests (`SQLITE3_BIN` is not needed; `sqlite3` is on `PATH`).                                         |
| `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, `npm ci --ignore-scripts` | Lint, build and tests do not need the Electron binary or native rebuilds.                                                                       |
| `USER node` (non-root), `/app` owned by `node`               | No root at runtime; the tests can still write `tests/temp_test.db` and ESLint its cache.                                                        |
| `package.json` + `package-lock.json` copied first            | `npm ci` layer is cached until dependencies change.                                                                                             |
| No `EXPOSE`, no volumes, no secrets, no `--privileged`       | Nothing is served and nothing from the host is mounted.                                                                                         |
| `HEALTHCHECK NONE`                                           | One-shot job, not a service.                                                                                                                    |

### What `.dockerignore` excludes

`node_modules`, `out`, `dist`, `.git`, `.github`, every `*.db`/`*-wal`/`*-shm`/`*-journal` file (no local or production data ever enters an image), `.env` and `.env.*` (except `.env.example`), `sqlite3.exe`, `typst.exe`, `*.bat`, and documentation/report folders that the checks do not read.

## 3. Usage

```bash
docker build -t heromarket-ci .
docker run --rm heromarket-ci                          # lint + format + build + tests (exit code = result)
docker run --rm heromarket-ci npm run test:fresh       # one step only
docker run --rm -it heromarket-ci bash                 # explore the toolchain
```

The container exits non-zero if any step fails. Because the source is copied into the image at build time, rebuild after changing code.

## 4. In CI

The `docker` job in `.github/workflows/ci.yml` builds the image with Buildx (layer cache stored in the GitHub Actions cache, nothing pushed to a registry) and runs it. It proves that the Dockerfile still builds and that the project checks pass as a non-root user on a clean Linux machine. See `CI_CD.md`.

## 5. Limitations

- Debian bookworm ships sqlite3 **3.40.1**; the app bundles **3.53.3** (`sqlite3.exe`). All four suites pass with both (verified locally on 2026-10-13: container run and Windows run). The Windows CI job keeps exercising the bundled binary, so a query that only works on one version is caught.
- No Electron binary in the image: the app UI, printing and PDF generation are not exercised here. The UI is checked manually or with the CDP-based QA scripts described in `TESTING_AND_KNOWN_ISSUES.md`.
- The image is a validation tool, not a deliverable. Installers are produced by the release workflow on a Windows runner (`SECURITY_AND_RELEASE.md`).
