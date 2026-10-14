# Paused Task State (resume checkpoint)

Update this file at every milestone. When resuming, trust this file **and** `git status` / `git log` over memory.

_Last updated: 2026-10-14 (stage 3 complete: closeout review, owner decision briefs, technical gaps, go-live plan)._

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

CI's `pull_request` trigger only covers `main`, so stacked PRs are verified by their push runs.

**Merge order:** #1 into `main`; then retarget #2 to `main` (GitHub does it when the merged branch is deleted), wait for its pull_request CI, merge; the same for #3, then #4. Merge only with the owner's approval.

## Next unfinished tasks

1. **Owner:** answer K-24 and K-10 ([OWNER_DECISIONS.md](OWNER_DECISIONS.md)); approve the merges.
2. **Owner:** run [GO_LIVE_TEST_PLAN.md](GO_LIVE_TEST_PLAN.md) checks 1–9 (and 10 for a second till) on a test PC and the store printer; record evidence.
3. After the K-24 decision: implement the chosen formula in both close dialogs with tests (both dialogs and the saved figure must agree on the OWNER_DECISIONS example).
4. After the K-10 decision: wire the approval dialog to the chosen actions and log rejections, with tests.
5. Release: raise the version (recommend 2.0.0), tag, let the release workflow build the installer.
6. After the G-20 policies (offline prices, negative stock or conflict queue, offline window): implement D-040.

## Known blockers

- Branch protection unavailable on the current GitHub plan (HTTP 403).
- No physical thermal printer, second PC or real store network here.
- ~8 GB RAM: stop Docker Desktop when not needed.
