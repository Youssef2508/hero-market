# Paused Task State (resume checkpoint)

Update this file at every milestone. When resuming, trust this file **and** `git status` / `git log` over memory.

_Last updated: 2026-10-15 (stage 3 started: closeout review, owner decision briefs, independent technical gaps)._

## Where things are

- **Workspace:** `D:YoussefBrandsHeroMarket`
- **Branches:** `feature/heromarket-ui-redesign` (PR #1 → `main`), `feature/postgres-service` (PR #2, stacked on PR #1)
- **Remotes:** `origin` → `https://github.com/Youssef2508/hero-market.git` (push here); `upstream` → the original open-source code base (push disabled). `gh` defaults to upstream: always pass `--repo Youssef2508/hero-market`.
- **Databases (development):** `npm run pg:dev` cluster in `.pgdata/` (`heromarket`, `heromarket_test`, `heromarket_qa`, `heromarket_installed` = parity copy of the installed store). QA of local mode used scratch folders via `HEROMARKET_USER_DATA`.
- **Installed earlier version on this machine:** its SQLite file under `%APPDATA%` (pre-PostgreSQL data folder). Read only – never modify.

## Verified 2026-10-15 (before stage 3 work)

- Working tree clean; `feature/postgres-service` = `origin` at `1f22e2d`.
- PR #1 `feature/heromarket-ui-redesign` → `main` (7 commits, head `f07679a`, CI green on that head, mergeable, based on current `main`).
- PR #2 `feature/postgres-service` → `feature/heromarket-ui-redesign` (10 commits, head `1f22e2d`, CI green on that head – push run, because the workflow's `pull_request` trigger only covers `main`; mergeable).
- Merge order: PR #1 into `main`, then retarget PR #2 to `main` (GitHub does this automatically when the base branch is deleted after merging, otherwise change the base) and merge after its CI re-runs as a pull_request.
- Owner decision briefs: [OWNER_DECISIONS.md](OWNER_DECISIONS.md) (K-24 measured: dialogs show 610 / 670 where the saved value and the drawer are 650).

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
