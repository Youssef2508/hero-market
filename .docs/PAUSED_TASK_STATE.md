# Paused Task State (resume checkpoint)

Update this file at every milestone. When resuming, trust this file **and** `git status` / `git log` over memory.

_Last updated: 2026-10-13 (end of stage 1)._

## Where things are

- **Workspace:** `D:\Youssef\Brands\HeroMarket`
- **Branch:** `feature/heromarket-ui-redesign` (from `main` @ `6b7c838`)
- **Remotes:** `origin` → `https://github.com/Youssef2508/hero-market.git` (push here); `upstream` → the original open-source code base (push disabled)
- **Databases (SQLite, current operational store):**
  - Dev: `market_unified_testing.db` (repo root, git-ignored)
  - Installed earlier version on this machine: its SQLite file in the pre-PostgreSQL data folder under `%APPDATA%` (read only; never modify; backup in the session scratchpad `appdata-backup/`)
  - QA copies used by automation live outside the repo
- **Running app for manual testing:** `HEROMARKET_DB_PATH=<qa.db> env -u ELECTRON_RUN_AS_NODE npx electron-vite dev --remoteDebuggingPort 9222`

## Done (stage 1)

Redesign, brand, design system, light/dark, all screens, review fixes, docs, CI/Docker/Dependabot/release workflow files. All checks green locally (lint 0 errors, format, build, 4/4 suites, UI scripts). See IMPLEMENTATION_PROGRESS.md.

## In progress

1. Commit stage 1 in focused commits, push `feature/heromarket-ui-redesign`, open the PR into `main`, read the CI results.

## Next unfinished task

Master mission phase B: write `GAP_ANALYSIS.md` (with stack decision matrix) and `POS_BENCHMARK_RESEARCH.md`, then phase C (PostgreSQL + trusted service layer + data migration with parity checks) on a new branch stacked on the stage-1 branch.

## Known blockers

- Branch protection unavailable on the current GitHub plan (HTTP 403).
- Machine has ~8 GB RAM; Docker Desktop + Electron dev + PostgreSQL together are tight. Stop Docker Desktop when not needed.
