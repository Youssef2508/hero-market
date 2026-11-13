# HeroMarket – Production readiness checklist (2026-11-13)

Part of [PRE_PRODUCTION_AUDIT_REPORT.md](PRE_PRODUCTION_AUDIT_REPORT.md). ✅ verified with evidence · ⏳ pending a decision or approval · ❌ not done.

## Before the owner's first real pairing

|     | Item                                                           | Evidence / action                                                                     |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ✅  | Cloud empty, schema 0037, healthy, first-pairing state         | cleanup section of the report (fingerprint against the baseline, integrity, restart)  |
| ✅  | Only 80/443 and SSH (key only) reachable                       | `ss` on the server; `scripts/cloud-smoke.sh`                                          |
| ✅  | Encrypted cloud backup opens with the owner's key              | round trip on 2026-11-13 (decrypt on the PC, restore into a scratch database)         |
| ✅  | The shop installer 1.6.1 updates a paired store without loss   | Windows Sandbox, 1.6.0 → 1.6.1                                                        |
| ✅  | Shop ↔ cloud survive crashes, restarts and working apart       | live rehearsal, 15/15                                                                 |
| ✅  | Merge the audit fixes (AUD-03, CI gates, OPS-01, UX-01)        | #47, CI green                                                                         |
| ✅  | Release 1.6.2 and update the cloud                             | v1.6.2: installer built by the release workflow; cloud on 1.6.2, smoke test 28/28     |
| ✅  | OPS-01 on the server: an update survives a dropped SSH session | SSH cut 4 s into an update; it finished and the website came back healthy             |
| ✅  | Encrypted backups of the audit's test data removed             | the three made during the audit deleted; older rehearsal copies expire within 14 days |
| ✅  | Cloud updates work over the home Wi-Fi (port 21)               | OPS-01 deployed: the update runs on its own; read its log afterwards                  |

## Every release

|     | Gate                                                     | Where                                                                      |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| ✅  | Lint, format, build, all tests on Linux and Windows      | CI                                                                         |
| ✅  | Dependency gate: no unexcepted high/critical advisory    | CI (`scripts/audit-gate.js`) – new                                         |
| ✅  | Cloud stack starts as deployed and passes the smoke test | CI – new                                                                   |
| ✅  | LAN server stack over TLS with the pinned root           | CI                                                                         |
| ✅  | Package contents (PostgreSQL binaries, no local data)    | CI, release                                                                |
| ✅  | Installer built by the release workflow                  | first success at v1.6.2 (#44)                                              |
| ✅  | Installer over the previous release in Windows Sandbox   | manual, per release                                                        |
| ✅  | Cloud rehearsal against a cloud without a real store     | `scripts/cloud-rehearsal/run.js` – before a handover, or on a staging copy |

## Operations

|     | Item                                                                                        | Notes                                                                                       |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ✅  | Health endpoint, container health checks, automatic restart                                 | compose                                                                                     |
| ✅  | Nightly encrypted backup, kept 14 days                                                      | `backup` container                                                                          |
| ✅  | The shop sees the link's state (live / delayed / unreachable / waiting / failed / recovery) | `LinkStatus`, sync screen                                                                   |
| ❌  | Alerting when the cloud is down or a backup fails                                           | no paid monitoring (budget); the shop's sync screen shows the link; check the server weekly |
| ❌  | Off-server copy of the cloud backups                                                        | optional `BACKUP_OFFSITE` not configured (budget)                                           |
