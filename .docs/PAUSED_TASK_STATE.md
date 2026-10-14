# Paused Task State (resume checkpoint)

Update this file at every milestone. When resuming, trust this file **and** `git status` / `git log` over memory.

_Last updated: 2026-10-14 (stage 4 phase 0 and phase 1 implemented; architecture revised for one PC + owner-only cloud)._

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
| #6  | `feature/stage4-ledger` → `feature/k24-close-formula`         | K-36; stage 4 phase 1 (stock ledger, K-37, K-38, negative stock, moving average); architecture revision 2    |

CI's `pull_request` trigger only covers `main`, so stacked PRs are verified by their push runs.

**Merge order:** #1 into `main`; then retarget #2 to `main` (GitHub does it when the merged branch is deleted), wait for its pull_request CI, merge; the same for #3, then #4. Merge only with the owner's approval.

## Next unfinished tasks

The owner's stage 4 decisions are final ([OWNER_DECISIONS.md](OWNER_DECISIONS.md)); do not ask again.

1. **Phase 2 – units and packaging** (next to implement):
   - base unit (kilograms with 3 decimals for weighed products);
   - product units with factors, barcodes and prices;
   - unit-aware cart, sale, purchase and return lines with snapshots;
   - scale-label settings.

   See [STAGE4_ARCHITECTURE_REVIEW.md](STAGE4_ARCHITECTURE_REVIEW.md) §6.

2. **Phase 3:**
   - username + password with PIN migration and a recovery code;
   - approvals for cashier returns (with a reason), discounts above role limits, and shift differences above EGP 50;
   - cart edits never need approval.
3. **Phase 4:** sync engine on the PC (outbox, versions, epoch, command executor, conflicts, convergence check) with the failure-injection suite against a local test cloud.
4. **Phase 5:** cloud mode and the owner web app with TOTP. **Blocked on the owner's hosting approval** (D-043). Create no paid resource.
5. **Owner:**
   - approve hosting;
   - review and merge PRs #1–#6 in order;
   - run the go-live checks on a test PC.

## Known blockers

- Branch protection unavailable on the current GitHub plan (HTTP 403).
- No physical thermal printer, second PC or real store network here.
- ~8 GB RAM: stop Docker Desktop when not needed.
