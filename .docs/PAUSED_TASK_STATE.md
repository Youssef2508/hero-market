# Paused Task State (resume checkpoint)

Update this file at every milestone. When resuming, trust this file **and** `git status` / `git log` over memory.

_Last updated: 2026-10-14 (stage 2 complete, PR #2 open)._

## Where things are

- **Workspace:** `D:YoussefBrandsHeroMarket`
- **Branches:** `feature/heromarket-ui-redesign` (PR #1 → `main`), `feature/postgres-service` (PR #2, stacked on PR #1)
- **Remotes:** `origin` → `https://github.com/Youssef2508/hero-market.git` (push here); `upstream` → the original open-source code base (push disabled). `gh` defaults to upstream: always pass `--repo Youssef2508/hero-market`.
- **Databases (development):** `npm run pg:dev` cluster in `.pgdata/` (`heromarket`, `heromarket_test`, `heromarket_qa`, `heromarket_installed` = parity copy of the installed store). QA of local mode used scratch folders via `HEROMARKET_USER_DATA`.
- **Installed earlier version on this machine:** its SQLite file under `%APPDATA%` (pre-PostgreSQL data folder). Read only – never modify.

## Done (stage 2)

PostgreSQL service and migrations, legacy import with parity, roles and permissions, settings, receipt designer with free placement, managed local PostgreSQL, Hero Market naming everywhere, server CLI, Docker Compose, CI on PostgreSQL (green on GitHub), docs, QA (screens, accessibility, performance, print path to PDF). See IMPLEMENTATION_PROGRESS.md and PRODUCTION_READINESS.md.

## Next unfinished tasks

1. Merge PR #1, then PR #2 (retarget to `main` after #1 merges).
2. Owner decisions: K-24 (close formula), K-10 (approval policy).
3. Go-live checklist in PRODUCTION_READINESS.md (physical printer, NSIS upgrade rehearsal on a test PC).
4. Separate PRs: Electron major upgrade (G-15), offline queue for client tills (G-20), TLS proxy guide (G-24), remove the unused `sqlite3.exe`.

## Known blockers

- Branch protection unavailable on the current GitHub plan (HTTP 403).
- ~8 GB RAM: stop Docker Desktop when not needed.
