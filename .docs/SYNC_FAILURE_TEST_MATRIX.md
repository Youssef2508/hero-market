# HeroMarket – Synchronisation, parity and failure matrix (pre-production, 2026-11-13)

Part of [PRE_PRODUCTION_AUDIT_REPORT.md](PRE_PRODUCTION_AUDIT_REPORT.md). Evidence comes from three places:

- **Automated suite** – `tests/service/*.test.js`, shop and cloud services on disposable databases, joined by an in-process transport the test can cut, delay, duplicate or lose (542 tests, all passing).
- **Live rehearsal** – `scripts/cloud-rehearsal/run.js` against the deployed cloud before the handover: a disposable shop with the real service, the real sync agent and the real HTTPS transport, in its own process (so it can be killed). Ground truth is what the driver submitted; the two databases are compared with plain SQL (`to_jsonb` by key), never with the sync code under test.
- **Inspection** – reading the code, where neither of the above applies.

## 1. Invariants

| Invariant                                                                                      | How it is enforced                                                                                                 | Proven by                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| A committed change is captured for sending in the same transaction; a rolled-back one never is | triggers write `sync_outbox` inside the business transaction                                                       | `sync.test.js` "capture"                                                                                       |
| Retrying the same operation never doubles it                                                   | `client_ref` / operation ids, unique per table; remote operations recorded in their own transaction (at most once) | suite (`cloudConnected`, `cloudApart`), live: same id twice at once → one sale; lost answer + retry → one sale |
| Acknowledgement only after the cloud committed                                                 | the agent marks rows acknowledged from the cloud's answer only                                                     | `sync.test.js` "lost answers"                                                                                  |
| A batch is all or nothing on the cloud                                                         | one transaction per batch                                                                                          | `sync.test.js` "partially applied batches"                                                                     |
| An old epoch or a replaced PC cannot overwrite newer state                                     | epoch check; device secret replaced at re-pairing                                                                  | `sync.test.js` "stale epoch", `pairing.test.js`, `syncRecovery.test.js`                                        |
| Deletions propagate                                                                            | deletions travel as tombstones; a reused key comes back                                                            | `sync.test.js` "deletions and key changes"                                                                     |
| Nothing disappears silently; conflicts are listed for a person                                 | `sync_attention`; refused commands recorded once                                                                   | `sync.test.js` "conflicts", `cloudApart.test.js`                                                               |
| After synchronisation both sides hold the same records                                         | —                                                                                                                  | live: 42 tables, 2,288 rows identical (one intended column difference, below)                                  |

## 2. Failure injection

| Scenario                                                         | Outcome required                                                   | Evidence                                                    | Result   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- | -------- |
| Network down before a request                                    | change stays queued; sent later once                               | suite "outage and restart"                                  | pass     |
| Network lost after the cloud committed, before the answer        | re-send changes nothing                                            | suite "lost answers"                                        | pass     |
| Duplicate batches, replayed old batches                          | nothing doubles                                                    | suite "duplicated delivery"                                 | pass     |
| Delayed / reordered batches                                      | stale batches change nothing                                       | suite "delayed and reordered delivery"                      | pass     |
| Cloud fails half way through a batch                             | batch rolled back, nothing lost                                    | suite "partially applied batches"                           | pass     |
| All faults at once                                               | ends where a fault-free run ends                                   | suite "replay"                                              | pass     |
| **Shop PC killed (no shutdown) with 480 changes waiting**        | arrives once after restart                                         | live                                                        | **pass** |
| **Cloud service restarted under load (576 waiting)**             | nothing lost or doubled                                            | live                                                        | **pass** |
| **Cloud PostgreSQL restarted under load (336 waiting)**          | service recovers, nothing lost or doubled                          | live                                                        | **pass** |
| Sale committing while the agent pushes                           | sent on the next push, never skipped                               | suite                                                       | pass     |
| Long offline period (a busy week, 400 sales)                     | catches up in well under a minute                                  | suite "backlog"                                             | pass     |
| Background service and desktop both running                      | one holder of the link at a time                                   | `syncService.test.js`                                       | pass     |
| Restore on the same PC after pairing                             | work pauses; rows made after the backup come back; nothing doubles | `syncRecovery.test.js`                                      | pass     |
| Replacement PC; old PC reconnecting                              | new PC takes over; old PC can no longer write                      | `syncRecovery.test.js`, `pairing.test.js`                   | pass     |
| Schema-version mismatch shop ↔ cloud                             | refused until both are updated; both work apart                    | `cloudSecurity.test.js`                                     | pass     |
| Pairing code reused                                              | refused                                                            | live (403)                                                  | pass     |
| Installer over a running background service with changes waiting | pairing and queue identical                                        | Windows Sandbox (1.6.0 → 1.6.1)                             | pass     |
| Windows restart / power loss                                     | as "shop killed" above (process killed, PostgreSQL survives)       | live (process kill); a real power cut was **not** simulated | partial  |
| Disk full; corrupted queue rows; interrupted migration           | —                                                                  | **not tested** (see the report, section H)                  | open     |

## 3. Offline / cloud parity

What the cloud may do depends on whether it can reach the shop (D-101, D-103):

| Operation group                                                    | Shop      | Internet, shop connected               | Internet, shop unreachable                                          |
| ------------------------------------------------------------------ | --------- | -------------------------------------- | ------------------------------------------------------------------- |
| Sales, returns, discounts, payment methods                         | yes       | carried out by the shop (same handler) | yes, in the phone's own shift (W- numbers); merged on return        |
| Shifts open/close, expenses, drawer movements                      | yes       | by the shop                            | yes (own shift)                                                     |
| Customers (create, repay), customer codes                          | yes       | by the shop                            | yes (W- codes)                                                      |
| Supplier invoices, preliminary invoices, payment requests          | yes       | by the shop                            | yes                                                                 |
| Products, prices, categories, stock adjustments, damaged           | yes       | by the shop                            | yes, except barcode changes and deletions ("linked": need the shop) |
| Users, roles, settings                                             | yes       | by the shop                            | refused where they need both sides                                  |
| First-run setup, password recovery, backup/restore, reset, pairing | shop only | refused (`shop_only`)                  | refused                                                             |

Parity proven by the suite ("the same day through the desktop and through the internet leaves the same records in the shop", "the shop PC is off: a whole day from the phone … the same business as if done at the shop") and live (internet sales carried out by the shop; 18 simultaneous checkouts from both sides, 18/18 correct; apart then together, 339 sales on both sides, each once).

## 4. Live rehearsal result (2026-11-13, 10:04–10:11)

| Check                                                      | Result                     |
| ---------------------------------------------------------- | -------------------------- |
| Pairing with the deployed cloud (one-time code, HTTPS)     | pass                       |
| A pairing code works once                                  | pass (second use 403)      |
| First registration: the cloud holds exactly the shop       | pass (42 tables, 298 rows) |
| A sale from the internet is carried out by the shop        | pass                       |
| The same internet operation sent twice at once             | pass (one sale)            |
| A lost answer, then a retry with the same id               | pass (one sale)            |
| Supplier advance from the internet (1.6.1)                 | pass                       |
| 18 checkouts at once, shop and internet                    | pass (18/18)               |
| Connected work: both sides hold exactly what was submitted | pass                       |
| Shop crash mid-backlog                                     | pass (480 waiting)         |
| Cloud restarted mid-push                                   | pass                       |
| Cloud database restarted mid-push                          | pass                       |
| The phone works alone in its own shift                     | pass                       |
| Apart, then together                                       | pass                       |
| Final: the cloud is the shop row for row                   | pass (2,288 rows)          |

The one column that differs between the copies, `users.recovery_hash`, never leaves the shop by design (D-106).
