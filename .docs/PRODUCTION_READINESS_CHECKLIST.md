# HeroMarket – Production readiness checklist (2026-11-13)

Part of [PRE_PRODUCTION_AUDIT_REPORT.md](PRE_PRODUCTION_AUDIT_REPORT.md). ✅ verified with evidence · ⏳ pending a decision or approval · ❌ not done.

## Before the owner's first real pairing

|     | Item                                                                                                                                          | Evidence / action                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ✅  | Cloud empty, schema 0037, healthy, first-pairing state                                                                                        | cleanup section of the report (fingerprint against the baseline, integrity, restart) |
| ✅  | Only 80/443 and SSH (key only) reachable                                                                                                      | `ss` on the server; `scripts/cloud-smoke.sh`                                         |
| ✅  | Encrypted cloud backup opens with the owner's key                                                                                             | round trip on 2026-11-13 (decrypt on the PC, restore into a scratch database)        |
| ✅  | The shop installer 1.6.1 updates a paired store without loss                                                                                  | Windows Sandbox, 1.6.0 → 1.6.1                                                       |
| ✅  | Shop ↔ cloud survive crashes, restarts and working apart                                                                                      | live rehearsal, 15/15                                                                |
| ⏳  | Merge `audit/pre-production` (AUD-03, CI gates, OPS-01, UX-01)                                                                                | PR, after CI is green and you approve                                                |
| ⏳  | Release 1.6.2 with those fixes and update the cloud                                                                                           | needs approval; until then the cloud keeps AUD-03 (log noise, no data risk)          |
| ⏳  | Prove OPS-01 on the server (update survives a dropped SSH session)                                                                            | proven in Linux (WSL) with a stand-in; the server run needs approval                 |
| ⏳  | Decide on the encrypted test backups left in the backup volume (synthetic data only; expire after 14 days)                                    | delete now, or let them age out                                                      |
| ✅  | Until OPS-01 is deployed: run cloud updates from a network that allows port 22 (e.g. the phone hotspot), never over port 21 on the home Wi-Fi | documented                                                                           |

## Every release

|     | Gate                                                     | Where                                                                      |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| ✅  | Lint, format, build, all tests on Linux and Windows      | CI                                                                         |
| ✅  | Dependency gate: no unexcepted high/critical advisory    | CI (`scripts/audit-gate.js`) – new                                         |
| ✅  | Cloud stack starts as deployed and passes the smoke test | CI – new                                                                   |
| ✅  | LAN server stack over TLS with the pinned root           | CI                                                                         |
| ✅  | Package contents (PostgreSQL binaries, no local data)    | CI, release                                                                |
| ⏳  | Installer built by the release workflow                  | fixed in #44, proven at the next tag                                       |
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
