# Paused Task State (resume checkpoint)

Update this file at every milestone. When resuming, trust this file **and** `git status` / `git log` over memory.

_Last updated: 2026-10-14 (stage 4 analysis delivered; K-24 implemented; awaiting owner decisions)._

## Where things are

- **Workspace:** `D:\Youssef\Brands\HeroMarket`
- **Remotes:** `origin` → `https://github.com/Youssef2508/hero-market.git` (push here); `upstream` → the original open-source code base (push disabled). `gh` defaults to upstream: always pass `--repo Youssef2508/hero-market`.
- **Databases (development):** `npm run pg:dev` cluster in `.pgdata/` (`heromarket`, `heromarket_test`, `heromarket_qa`, `heromarket_installed` = parity copy of the installed store). QA of local mode used scratch folders via `HEROMARKET_USER_DATA`.
- **Installed earlier version on this machine:** its SQLite file under `%APPDATA%\elnagdi-pos`. Read or copy only – never modify.

## Pull requests (stacked; none merged)

| PR  | Branch → base                                                 | Content                                                                                                      |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| #1  | `feature/heromarket-ui-redesign` → `main`                     | Stage 1: UI redesign, brand, DevOps foundation                                                               |
| #2  | `feature/postgres-service` → `feature/heromarket-ui-redesign` | Stage 2: PostgreSQL service, migration, roles, settings, receipt designer, Docker, CI; owner decision briefs |
| #3  | `feature/electron-upgrade` → `feature/postgres-service`       | Electron 43, production CSP (G-15, K-22)                                                                     |
| #4  | `feature/stage3-hardening` → `feature/electron-upgrade`       | K-34/G-26, G-19, G-24 TLS, D-040, K-19, K-35, go-live plan and script, gap reconciliation                    |
| #5  | `feature/k24-close-formula` → `feature/stage3-hardening`      | K-24 option 1 (one drawer formula everywhere); stage 4 architecture review                                   |

CI's `pull_request` trigger only covers `main`, so stacked PRs are verified by their push runs.

**Merge order:** #1 into `main`; then retarget #2 to `main` (GitHub does it when the merged branch is deleted), wait for its pull_request CI, merge; the same for #3, then #4. Merge only with the owner's approval.

## Next unfinished tasks

1. **Owner:** answer the questions in [STAGE4_ARCHITECTURE_REVIEW.md](STAGE4_ARCHITECTURE_REVIEW.md) §10 (approach, K-36, negative-stock scope, costing, units, returns, discounts, thresholds, remote sign-in, offline remote operations, conflict rule, hosting); approve the merges of PRs #1–#5.
2. **Owner:** run [GO_LIVE_TEST_PLAN.md](GO_LIVE_TEST_PLAN.md) checks 1–9 on a test PC and the store printer.
3. After approval: phase 0 remainder (K-36 if confirmed), then phase 1 (stock movements, purchases that receive stock, negative stock) as described in the review §9. Do not start phases 1–6 before the owner approves the approach.
4. K-10: implement only the controls the owner picks from review §7.2. Ordinary cart edits never need approval (decided).
5. Release: raise the version (recommend 2.0.0), tag, let the release workflow build the installer.

## Known blockers

- Branch protection unavailable on the current GitHub plan (HTTP 403).
- No physical thermal printer, second PC or real store network here.
- ~8 GB RAM: stop Docker Desktop when not needed.
