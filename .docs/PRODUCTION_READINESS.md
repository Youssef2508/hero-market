# Production Readiness Assessment

Assessment date: **2026-10-14**, branch `feature/postgres-service` (PR #2). It applies the mission's §21 rule: a polished UI or a passing build alone does not make the system production-ready. Each dimension is judged on evidence in the repository, its tests, CI runs and the recorded QA.

**Ratings**

- **Ready**: implemented, tested, evidence linked.
- **Ready with conditions**: usable once the listed conditions are met.
- **Not ready**: a blocking gap.

## Verdict

| Deployment                                                                  | Verdict                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single-till store, "this computer only" mode** (new or upgraded from 1.3) | **Ready for a supervised pilot**, after the go-live checklist below. Core risks addressed: data, money, permissions. Not yet seen on the store's own hardware.                                     |
| **Multi-till store with a Docker server**                                   | **Ready with conditions:** a trusted LAN, the server PC on a UPS, `pg_dump` backups scheduled, TLS proxy if the network is shared. LAN or server outages stop the client tills (no offline queue). |
| **Public or untrusted networks**                                            | **Not ready:** plain HTTP (G-24).                                                                                                                                                                  |

## Dimensions

| Dimension                        | Rating                | Evidence                                                                                                                                                                                                                         | Remaining risk / condition                                                                                                                                   |
| -------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data integrity and migration     | Ready                 | Row-level parity import (count + SHA-256 + FK re-check) with original ids and exact decimals; source read-only with a verified backup; automatic upgrade run on a copy of the installed store; `migration.test.js` in CI         | An upgrade over a real installed 1.3 with the NSIS installer is still to be rehearsed on a test PC (go-live checklist)                                       |
| Core business correctness        | Ready with conditions | Server-side pricing, totals, discounts, credit, returns (no double refund), repayments, suppliers, cheques, expenses, tills, closing math; legacy flows ported (`flows.test.js`, `checkout.test.js`); defects K-23 … K-32 fixed  | **Owner decisions:** K-24 (two legacy close formulas) and K-10 (when supervisor approval is required). Tax rules are not implemented and none were invented. |
| Authentication and authorisation | Ready                 | Keyed and scrypt PIN hashes, two-layer lockout, sessions with revocation, dynamic roles with invariants, server-side checks on all 89 operations, no default admin, setup code on servers (`auth.test.js`, `admin.test.js`)      | 4-digit PINs are a product choice; throttling makes them acceptable on a till                                                                                |
| Security controls                | Ready with conditions | No SQL or credentials in the renderer, sanitised print input, redacted logs, non-root read-only containers, package content check; Fastify advisories fixed                                                                      | Electron 39 advisories need the major upgrade (G-15, not reachable in normal use); CSP keeps `unsafe-eval`; LAN traffic not encrypted (G-24)                 |
| Functional completeness          | Ready with conditions | All original screens on PostgreSQL; roles, settings, receipt designer (free placement, 58/80 mm, A4/PDF), local database, multi-till server                                                                                      | No offline queue for client tills (G-20); renderer not code-split (G-19)                                                                                     |
| UI/UX and accessibility          | Ready                 | HeroMarket design system, light and dark, RTL; 66 screenshots inspected and defects fixed; **axe-core: 0 WCAG 2.2 A/AA violations** on 23 screens × 2 themes                                                                     | Native date pickers follow the Windows region format (K-33)                                                                                                  |
| Reliability and recovery         | Ready with conditions | Transactions everywhere; WAL; idempotent checkout; lost connections → 503 and start-up retry; restart after a forced kill reuses the cluster; credentials saved before `initdb`; atomic config with backup; single-instance lock | Not yet tested: power loss on the store PC, and non-ASCII Windows profiles (K-34)                                                                            |
| Performance and concurrency      | Ready                 | 20k products / 30k sales: scan 5.7 ms, checkout 17 ms (p50); 10 parallel checkouts never oversell                                                                                                                                | Monthly reports take up to 1.5 s at that volume (acceptable)                                                                                                 |
| Testing depth                    | Ready                 | 53 automated tests (unit, integration, flows, migration, security, concurrency), scripted E2E QA, visual and accessibility checks, performance probe                                                                             | UI E2E is scripted but not in CI (needs a desktop session)                                                                                                   |
| Packaging and deployment         | Ready with conditions | Unpacked build verified (service, shared code, PostgreSQL binaries; no local data); Docker server verified (healthy, non-root)                                                                                                   | Installers are **unsigned** (SmartScreen warning, G-22); the NSIS install and upgrade still to be rehearsed                                                  |
| Backup and restoration           | Ready with conditions | In-app JSON export and restore in one transaction with a safety copy (`admin.test.js` round trip); `pg_dump` / `pg_restore` documented for servers                                                                               | The store must **schedule** backups off the machine and keep the secret with them                                                                            |
| CI/CD                            | Ready                 | CI green on GitHub for Linux (PostgreSQL service), Windows (bundled PostgreSQL + packaging) and Docker; the release workflow builds draft releases with checksums                                                                | Branch protection unavailable on the current plan (discipline instead)                                                                                       |
| Documentation                    | Ready                 | `.docs/` updated to the implementation: architecture, database architecture and migration, security and RBAC, testing, Docker, CI/CD, decisions D-026 … D-038, gap statuses                                                      | Keep it in step with future changes                                                                                                                          |

## Go-live checklist (single-till store)

1. Install the release build on a **test PC** that holds a **copy** of the store's `%APPDATA%\elnagdi-pos` folder. Confirm the import report (`%APPDATA%\HeroMarket\backups\legacy-import-*.json`, parity true), log in with existing PINs, and check stock, customer balances and today's sales against the old version.
2. Open **Receipt designer → طباعة تجريبية** on the store's thermal printer, for both the receipt and a shift-close report. Adjust the template and paper size (G-25).
3. Decide K-24 (close formula) and K-10 (approval policy).
4. Create the real accounts and roles, and change any PIN that was shared under the old system.
5. Set a backup routine: النسخ الاحتياطي → حفظ نسخة at least daily, saved to a USB drive or another PC. Keep `%APPDATA%\HeroMarket\heromarket.json` safe: it holds the server secret and the local database password.
6. Keep the old `%APPDATA%\elnagdi-pos` folder untouched for the rollback window ([DATABASE_MIGRATION.md §5](DATABASE_MIGRATION.md)).
7. First week: the owner reviews سجل العمليات and the shift reports daily.

## Open items (from [GAP_ANALYSIS.md](GAP_ANALYSIS.md))

| Item                                                    | Priority                       |
| ------------------------------------------------------- | ------------------------------ |
| G-25 physical printer test                              | P1 (go-live)                   |
| G-27 / K-24 close formula decision                      | P1                             |
| G-13 / K-10 approval policy                             | P2                             |
| G-15 Electron major upgrade + CSP without `unsafe-eval` | P2                             |
| G-20 offline queue for client tills                     | P2                             |
| G-24 TLS for multi-till on shared networks              | P2                             |
| G-26 / K-34 non-ASCII Windows profiles                  | P2                             |
| G-19 renderer code-splitting                            | P3                             |
| G-22 code signing and auto-update                       | Deferred (needs a certificate) |
