# Stage 4 – Architecture: One Cashier PC, Owner-Only Cloud

Revision 2, 2026-10-14. It replaces revision 1 (store server plus cloud peers) after the owner's final deployment decisions. The owner's approvals are listed in §1 and in [OWNER_DECISIONS.md](OWNER_DECISIONS.md). Each phase's status is in §12.

## 1. Decisions in force

| Topic                    | Decision (owner, 2026-10-14)                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment               | **One cashier PC.** The application and its PostgreSQL run on it. No store server, no LAN, no multi-till infrastructure.                                              |
| Authority                | The local PC is the authority for every in-store operation. Nothing in the store needs the internet.                                                                  |
| Cloud                    | Used by **the owner only**: username, password and **mandatory two-factor authentication**. No staff accounts in the cloud.                                           |
| Remote writes            | Supplier invoices, stock receipts, product edits and price edits. They are queued while the shop is offline and never shown as applied until the PC has applied them. |
| Conflicts                | The same editable field changed in both places is detected and shown to the owner. Financial and inventory movements are never overwritten.                           |
| K-24                     | Option 1, a single expected-cash formula (implemented, PR #5).                                                                                                        |
| K-10                     | Editing an unfinished cart never needs approval.                                                                                                                      |
| K-36                     | Change kept as customer credit counts as drawer cash (implemented).                                                                                                   |
| Negative stock           | Allowed for every product, with alerts and reports (implemented).                                                                                                     |
| Costing                  | Moving average. The rule for negative stock is defined and tested (§7.2, implemented).                                                                                |
| Quantities               | Weighed products in kilograms with 3 decimals; no cash rounding of totals.                                                                                            |
| Returns                  | Cashiers may return with supervisor approval and a mandatory reason.                                                                                                  |
| Discounts                | Limits per role; supervisor approval above the limit.                                                                                                                 |
| Shift difference         | Supervisor acknowledgement above EGP 50.                                                                                                                              |
| Till offline from server | Not applicable (no separate server).                                                                                                                                  |
| Hosting                  | Cheapest option that is reliable. No paid resource is created without the owner's explicit approval (§10).                                                            |

## 2. What changes because there is only one PC

- Selling never leaves the PC. The till talks to its own service in-process, as local mode already does. Internet loss cannot affect a sale, by construction.
- **There is exactly one writer of store data.** The cloud never creates sales, movements or balances itself; it only asks the PC to perform the owner's operations. This removes the hardest problem of revision 1, two histories that must be merged. It also removes the need for global ids: the PC's integer ids and invoice numbers stay as they are.
- The LAN server, the TLS proxy for tills (G-24) and till-to-server offline mode (D-040) remain in the code base but are not part of this deployment.

## 3. Architecture

```text
 Cashier PC (works with no internet)                                   Internet                      Owner
 ┌──────────────────────────────────────────────┐
 │ HeroMarket app (Electron)                    │
 │  ├─ cashier screens ──► service (in-process) │
 │  │                       │                   │   HTTPS, PC-initiated only   ┌────────────────────────┐   HTTPS + 2FA   ┌─────────┐
 │  │                 PostgreSQL (authority)    │ ───── changes (outbox) ────► │ Cloud service          │ ◄────────────── │ browser │
 │  │                   ├─ business tables      │ ◄──── owner commands ─────── │  read copy + commands  │                 └─────────┘
 │  │                   ├─ sync_outbox          │                               │  owner account (TOTP)  │
 │  │                   └─ applied_commands     │                               │  PostgreSQL            │
 │  └─ sync agent (main process)                │                               └────────────────────────┘
 └──────────────────────────────────────────────┘
```

- **PC side**:
  - Every business transaction also writes its row changes to `sync_outbox`, in the same transaction, captured by database triggers. A change is therefore recorded durably at the moment the sale commits.
  - The sync agent pushes outbox batches, pulls the owner's pending commands, and runs each command through the normal service operation with the owner's identity.
  - Only the PC opens connections, so nothing in the shop is reachable from the internet.
- **Cloud side**:
  - The same service code in a "cloud" mode, with its own PostgreSQL holding a **read copy** of the store tables plus the owner's commands.
  - Read screens and reports reuse the existing read operations, because the schema is the same.
  - Store-table writes are disabled except through the sync endpoint and the command queue.

## 4. Consistency model

### 4.1 Store → cloud: row changes, exactly once and order-independent

- **Change capture.** Triggers on the synchronised tables write one outbox row per changed row: table, primary key, the full new row (or a deletion marker), and a `row_version` taken from one store-wide sequence at the moment of the change.
- **Ordering per row.** Row locks serialise concurrent writers, so the later change of a row always gets the higher version.
- **Apply rule in the cloud.** Upsert the row only if the incoming version is higher than the stored one, and keep deletions as markers carrying their version.
- **Why this is safe** (store → cloud direction):
  - Duplicate, delayed and out-of-order messages are harmless.
  - A replayed batch changes nothing.
  - A lost acknowledgement only causes a harmless re-send.
- **Completeness.**
  - The agent marks outbox rows as acknowledged only after the cloud has committed them.
  - An uncommitted local transaction is invisible to the agent, so it is shipped later and never skipped. No high-water mark is used, so there is no gap problem.
- **Convergence check.** After each sync the agent compares per-table row counts and a checksum of (primary key, version) between the PC and the cloud. A mismatch triggers a resend of the affected table and is shown in the sync status.

### 4.2 Cloud → store: owner commands

- **Command lifecycle.** A command has an id (UUID), a type, a payload, and the **base values** of every edited field as the owner saw them. Its status starts as `pending (waiting for the shop)`.
- **Pulling and applying.**
  - The PC pulls pending commands in creation order.
  - Each command runs inside one local transaction that also inserts its id into `applied_commands` (unique). A retried, duplicated or re-delivered command is therefore applied **at most once**.
  - The result (`applied`, `partially applied – conflict`, `rejected` with reason) is written to a local table, which itself syncs to the cloud through the outbox.
  - The cloud therefore shows a command as applied only when the PC has actually applied it.
- **Field conflicts.**
  - For product and price edits the PC compares each field's base value with its current local value.
  - Fields that changed locally since the owner's base are **not applied**. They are reported as conflicts, showing both values.
  - Other fields are applied. The owner resolves a conflict by sending a new edit with a new base.
- **Movements never conflict.** A remote stock receipt or supplier invoice becomes purchase movements (phase 1 ledger), which add to whatever the shop did meanwhile. Owner's example: 1 can, 10 sold offline, 24 received remotely gives 15.

### 4.3 What the owner sees

- Every remote screen shows "data as of (time of the last successful sync)" and the shop's connection state.
- After a configurable time (default 5 minutes) without contact from the PC, a warning banner appears. Figures are **never labelled live** unless the last sync is within that window.
- Pending commands are listed separately: "waiting for the shop", then "applied at 14:05", "conflict" or "rejected".

### 4.4 Remote operations

| Operation                                                                                  | Remotely?      | While the shop is offline                      | Why                                                                                          |
| ------------------------------------------------------------------------------------------ | -------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Supplier invoice with received items (unpaid, or paid by the owner **outside** the drawer) | Yes            | Queued                                         | Purchase movements commute with local sales                                                  |
| Stock receipt (the item lines above)                                                       | Yes            | Queued                                         | Same                                                                                         |
| Product edit: name, unit, reorder limit, category                                          | Yes            | Queued; field conflicts detected at apply time | Edits are compared against the PC's current values                                           |
| Price edit: retail, wholesale, cost                                                        | Yes            | Queued; field conflicts detected               | Same; historical sale lines keep their snapshot price                                        |
| Supplier invoice **paid from the drawer**                                                  | No             | –                                              | The drawer is physically in the shop; recording drawer cash remotely would falsify the shift |
| Sales, returns, refunds, shifts, drawer movements, customer repayments in cash             | No             | –                                              | Need the cash and the goods in the shop                                                      |
| Stock counts and adjustments                                                               | No             | –                                              | A count is a physical observation in the shop                                                |
| Local users, roles, settings, backup, restore, reset                                       | No (initially) | –                                              | Security-sensitive and needed even when the cloud is unreachable                             |
| Reports, invoices, stock and movements, shifts, cashier activity, suppliers, customers     | Read           | Shown "as of" the last sync                    | Read copy                                                                                    |

No remote operation needs the PC online at the moment it is entered. All are queued and applied when the PC next connects. Anything whose validity depends on the PC's latest state is checked **at apply time** and reported back, rather than being decided remotely.

### 4.5 Backup restore and recovery of unsynchronised data

- **Epoch.** The PC keeps a sync epoch. Restoring a local backup starts a new epoch.
- **Recovery before selling.** In a new epoch the agent first asks the cloud for the PC's own rows that are newer than the restored backup's last version, and writes them back locally. These are sales and movements made after the backup that had already reached the cloud. Then the outbox resumes.
- **Honest limit:** changes that never reached the cloud before the PC's disk was lost cannot be recovered from the cloud. Frequent sync plus local scheduled backups keep that window small.
- **Cloud lost:** the cloud copy can be rebuilt entirely from the PC with a full resend. Queued owner commands that had not yet reached the PC are the only cloud-only data, so cloud backups cover them.

### 4.6 Guarantees and limits

| Guarantee                                                                            | Status                                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| A sale completes with no internet                                                    | **Yes, by construction** (in-process service, local database)                                |
| A committed sale, payment or movement is durable on the PC before the receipt prints | **Yes** (PostgreSQL commit; the outbox row is in the same transaction)                       |
| No duplicate or lost store change in the cloud, whatever the network does            | **Yes** (versioned idempotent upserts; acknowledgement after cloud commit; checksum compare) |
| An owner command is applied at most once, and shown as applied only after it is      | **Yes** (`applied_commands` uniqueness; result synced back)                                  |
| Stock and balances correct after offline sales plus remote receipts                  | **Yes** (movements; phase 1 ledger tested)                                                   |
| Same-field edits on both sides                                                       | **Detected and shown**, not merged automatically                                             |
| Real-time owner view                                                                 | Near real time while online (target: seconds); stale and labelled while offline              |
| Recovery of changes made after the last backup on a lost PC disk                     | Only those that already reached the cloud                                                    |

## 5. The owner's reliability scenarios (single-PC version)

| #   | Scenario                                           | Behaviour                                                                                                                                               |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Internet lost during checkout                      | No effect: checkout is local. The change waits in the outbox.                                                                                           |
| 2   | Repeated disconnects                               | The agent retries with back-off. Resent batches are ignored by version.                                                                                 |
| 3   | PC or app restart                                  | Committed work is in PostgreSQL. The outbox and pending commands survive. The agent resumes on start.                                                   |
| 4   | Cloud unavailable                                  | Shop unaffected. The PC shows the sync status. The owner sees "as of" figures when it returns.                                                          |
| 5   | Cashier retries after an apparent failure          | Local `client_ref` idempotency (K-35).                                                                                                                  |
| 6   | Same message twice                                 | Version rule (store → cloud); `applied_commands` (cloud → store).                                                                                       |
| 7   | Two cashiers                                       | Not applicable (one PC). Concurrent requests inside the PC are still serialised by row locks (tested).                                                  |
| 8   | Owner receives stock while the shop is selling     | Command → purchase movements on the PC → synced back. Final stock = sum.                                                                                |
| 9   | Changes on both sides during an outage             | Movements add up; field edits are checked at apply time.                                                                                                |
| 10  | Supplier invoice entered while the shop is offline | Queued; "waiting for the shop" until applied.                                                                                                           |
| 11  | Price or unit factor changes while pending         | Sale lines keep their price, cost (and, in phase 2, unit and factor). A queued price edit applies to future sales only.                                 |
| 12  | History after configuration changes                | Snapshots on lines (phase 1 cost; phase 2 unit and factor).                                                                                             |
| 13  | Partial sync                                       | Outbox rows are acknowledged individually after the cloud commits. The rest is retried. A rejected row is shown with the reason.                        |
| 14  | Unexpected shutdown                                | PostgreSQL recovery. Nothing is half-applied (one transaction per command and per batch).                                                               |
| 15  | Large backlog                                      | Batches of 500 rows. Target: a week offline catches up in under a minute (to be measured in phase 4).                                                   |
| 16  | Backup restore                                     | New epoch and recovery from the cloud (§4.5).                                                                                                           |
| 17  | Auth and audit across sites                        | Local staff logins are local. The owner's cloud account is separate. Every applied command is audited locally with "owner (remote)" and the command id. |
| 18  | Temporary disagreement                             | Expected while offline. The cloud labels its data with the sync time.                                                                                   |
| 19  | Multiple terminals                                 | Not applicable.                                                                                                                                         |
| 20  | Conflicting edits                                  | Field-level detection (§4.2).                                                                                                                           |

## 6. Units and packaging (phase 2)

Unchanged from revision 1, with the owner's choices:

- **Base unit per product.** Weighed products use kilograms with 3 decimals.
- **Product units**: carton, box, pack and so on, each with a factor to the base unit, its own barcodes, its own price (or one derived from the base price), and flags for "can sell" and "can buy". Example: carton = 24 packets.
- **Scan behaviour.** A scan resolves to a product **and** a unit.
- **Line snapshots.** Sale and purchase lines keep the unit, factor, unit price, unit cost and base quantity.
- **Stock and returns.** Stock movements are always in base units. Returns may be in any sellable unit, limited to the line's remaining base quantity.
- **Scale labels.** Scale-label rules become settings.
- **Prices.** Line total = quantity × unit price, rounded to 0.01 per line, with no cash rounding. Example: 0.250 kg × 180 = 45.00.

## 7. Inventory ledger and costing (phase 1, implemented)

### 7.1 Ledger

- `stock_movements` is immutable. `products.stock_qty` is maintained only by the movement trigger. A guard trigger refuses every other stock write, so K-37-style overwrites are impossible even from future code.
- Movement kinds: opening, sale, return, purchase, adjustment, count, damaged, damaged_reversal.
- **Product form**: a changed quantity becomes an adjustment of target − the stock the form showed. Sales made meanwhile are kept (K-37).
- **Counts**: counted − the stock shown when counting started, with a mandatory reason. New permission `inventory.adjust`.
- **Purchases**: invoices can carry item lines that receive stock (K-38). A supplier whose invoices received stock cannot be deleted.
- **Negative stock**: allowed. It is shown as a banner and a badge on the inventory screen and by `inventory.negative`. `inventory.verify` proves stock = Σ movements.

### 7.2 Moving-average cost

| Event                                            | Effect on average cost (`products.cost_price`) | Cost recorded on the movement or line |
| ------------------------------------------------ | ---------------------------------------------- | ------------------------------------- |
| Receipt of q at c, stock s > 0, average a        | a' = (s·a + q·c) / (s + q), 4 decimals         | c                                     |
| Receipt when s ≤ 0 (none or negative)            | a' = c                                         | c                                     |
| Sale (including sales that drive stock negative) | unchanged                                      | a at the moment of sale (sale line)   |
| Return                                           | unchanged                                      | current a                             |
| Damaged, count, adjustment                       | unchanged                                      | current a                             |
| Manual cost edit in the product form             | replaced (audited)                             | –                                     |

**Units sold while stock was negative are not revalued when the covering receipt arrives.** Their profit uses the average at the time of sale. Tested: 10 @ 5 + 10 @ 7 gives 6; sell 25 gives −5, with the line cost 6; receive 20 @ 8 gives 8; receive 5 @ 10 gives 8.5; a return leaves 8.5.

## 8. Authentication

- **Local staff (phase 3)**: username + password, replacing PIN-only login.
  - Each user signs in once with username + current PIN and must set a password; the PIN is then disabled.
  - The super administrator receives a one-time recovery code, and a local command can reset a password with access to the PC.
  - Lockout and session rules stay as they are.
- **Owner in the cloud (phase 5)**: a separate cloud account, not a copy of the local accounts.
  - Username + password (scrypt) + **TOTP two-factor**, mandatory, with backup codes.
  - Rate limits and short sessions.
  - Login, failure and command auditing.
  - There is no remote account for staff, and the local password database is **not** sent to the cloud (only usernames for reports).
- **Supervisor approvals (phase 3)**: the supervisor types their own username and password on the till. Approvals and refusals are both audited.
  - **Returns** by cashiers: approval plus a reason.
  - **Discounts** above the role's limit: approval.
  - **Shift difference** above EGP 50: acknowledgement.
  - **Cart edits**: never.

## 9. Testing strategy

- Phases 1–3: unit and service tests per rule, migration parity on a copy of the real store (`npm run golive:check`, which now includes check A6 for the ledger), and UI checks in the running app.
- Phase 4–5 failure-injection suite (automated, in CI):
  - internet loss during checkout;
  - repeated disconnects every few seconds;
  - a lost cloud response followed by a retry;
  - duplicated, delayed and reordered batches and commands;
  - simultaneous local sales and remote receipts;
  - the same field edited in both places;
  - a kill and restart of the app and of PostgreSQL with pending outbox rows and commands;
  - restore of an old backup with recovery from the cloud;
  - a backlog of a week of sales;
  - authentication attacks on the cloud: wrong passwords, missing or replayed TOTP, a stolen session, a forged sync request.
- **Convergence oracle.** After every scenario, per-table checksums of the PC and the cloud must be identical. Stock and balances must equal a replay of the same operations on a single database.

## 10. Hosting: cost and reliability

What the cloud has to do:

- run one small Node service and one PostgreSQL;
- store a few hundred MB per year;
- carry small sync traffic plus the owner's browsing;
- be reachable on HTTPS;
- **never pause, sleep or suspend silently.**

The PC is the system of record, and the cloud can be rebuilt from it (§4.5). Cloud data loss is therefore limited to queued owner commands not yet applied.

| Option                                                                                      | Recurring cost                                                                                                                                   | Limits and failure modes                                                                                                                                                                                                                                                                              | Verdict                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Google Cloud free tier: one e2-micro VM** (US regions only), app and PostgreSQL on the VM | **0 USD expected**; up to about 3.65 USD/month if the external IPv4 address is billed (sources conflict; confirm in the billing report on day 1) | 1 GB RAM (needs tuning and swap); 30 GB standard disk; 1 GB/month outbound traffic free (enough for sync and one owner, estimated 100–300 MB); US latency from Egypt about 150–200 ms (acceptable); no SLA; Google may change the free tier with 30 days' notice; needs a billing account with a card | **Recommended**, with a budget alert at 1 USD and nightly backups to the free 5 GB of Cloud Storage |
| Hetzner Cloud CX23 (cheapest paid VPS, EU)                                                  | about 4–6 EUR/month including IPv4 and 20% for backups (prices changed twice in 2026; confirm)                                                   | Reliable, EU latency is lower, automatic backups                                                                                                                                                                                                                                                      | **Fallback** if the free tier is unsuitable                                                         |
| Oracle Cloud Always Free (ARM)                                                              | 0                                                                                                                                                | **Idle instances are reclaimed** (stopped) after 7 days under 20% use; this workload is idle by nature, so sync would **stop silently**                                                                                                                                                               | Rejected                                                                                            |
| Supabase free                                                                               | 0                                                                                                                                                | Project **pauses after a week without activity** (manual unpause); no backups on the free plan; 500 MB database                                                                                                                                                                                       | Rejected (silent stop during a closed week)                                                         |
| Neon free (PostgreSQL) plus a separate free app host                                        | 0                                                                                                                                                | About 0.5 GB storage per project, after which it is **suspended until the next month**; 100 compute-hours per month with scale-to-zero (continuous sync keeps it awake); two providers to keep healthy                                                                                                | Rejected as primary                                                                                 |
| Render free (web + PostgreSQL)                                                              | 0                                                                                                                                                | **The free database expires after 30 days**; the web service sleeps                                                                                                                                                                                                                                   | Rejected                                                                                            |
| Cloudflare Workers + D1 free                                                                | 0                                                                                                                                                | Not PostgreSQL and not Node/Fastify: a rewrite; daily row limits now fail queries when exceeded                                                                                                                                                                                                       | Rejected                                                                                            |

**Monitoring at no cost:**

- The PC app shows sync status and alerts when the cloud has been unreachable for a while.
- The cloud shows when the shop was last seen.
- A free external uptime check is optional.

Nothing is created or paid for until the owner approves (§13).

Sources (consulted 2026-10-14):

- [Google Cloud free tier](https://docs.cloud.google.com/free/docs/free-cloud-features)
- [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Supabase free tier summary](https://mykavo.app/blog/supabase-free-tier-limits)
- [Neon free plan FAQ](https://neon.com/faqs/free-plan-limits-and-quotas)
- [Render free deploys](https://render.com/docs/free)
- [Hetzner 2026 pricing summary](https://agentdeals.dev/hetzner-pricing-2026)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [GCP external IPv4 charge claim](https://agentdeals.dev/gcp-free-tier-2026)

## 11. Risk register

| Risk                                            | Mitigation                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Ledger migration changes stock                  | Opening balances reproduce stock exactly (tested on existing data, on the legacy import and on a copy of the installed store) |
| A code path writes stock directly               | Database guard trigger refuses it                                                                                             |
| Negative stock hides missing receipts           | Banner, badge, `inventory.negative`; receipts as documents                                                                    |
| Sync stalls silently                            | Status on both sides; staleness banner; checksum compare after every sync                                                     |
| Owner command applied twice or reported falsely | `applied_commands`; result synced back                                                                                        |
| Free tier changes or VM lost                    | Rebuild from the PC; budget alert; Hetzner fallback documented                                                                |
| Cloud breach                                    | Owner-only account with TOTP; nothing in the shop is reachable; minimal open ports; automatic updates; audit                  |
| PC disk lost                                    | Cloud copy plus scheduled local backups on USB; recovery procedure (§4.5)                                                     |
| Downgrade after migration 0004                  | Not supported; roll back by restoring the pre-upgrade backup ([DATABASE_MIGRATION.md](DATABASE_MIGRATION.md))                 |

## 12. Roadmap and status

| Phase                                 | Content                                                                                                                                                   | Status                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0. Close-out                          | K-24, K-36                                                                                                                                                | **Done** (PR #5, PR #6)                                   |
| 1. Ledger                             | Stock movements, K-37, K-38 purchases, negative stock, moving average, counts, history, alerts                                                            | **Done** (PR #6): 87 tests, UI checked in the running app |
| 2. Units and packaging                | Base unit, product units with factors and barcodes, unit-aware cart, sale/purchase/return lines with snapshots, scale-label settings                      | Next                                                      |
| 3. Authentication and approvals       | Username + password with PIN migration and recovery code; return, discount and shift-difference approvals                                                 | Planned                                                   |
| 4. Sync engine (PC side + test cloud) | Change capture, outbox, versions, epoch, command executor, conflict detection, convergence checks, failure-injection suite against a local cloud instance | Planned                                                   |
| 5. Cloud and owner web app            | Cloud mode, owner account with TOTP, read screens, command screens, staleness display, deployment scripts for the approved host                           | Planned; **hosting needs owner approval**                 |
| 6. Go-live                            | Go-live plan on a test PC, then the real PC; cloud in read-only mode for two weeks, then remote writes                                                    | Planned                                                   |

Each phase ships as its own PR with migrations, tests and a rollback note. A phase does not start before the previous one passes its tests in CI on Linux, Windows and Docker.

## 13. What the owner needs to do

1. **Hosting**:
   - Approve the Google Cloud free-tier plan (expected 0 USD, worst case about 4 USD/month) or the Hetzner fallback (about 4–6 EUR/month).
   - Then create the Google account or billing account yourself, since it needs your card. I will provide the exact setup steps and scripts. I will not create anything.
2. **Review and merge** the PR stack in order (#1 → #6), when convenient.
3. **Run the go-live checks** on a test PC ([GO_LIVE_TEST_PLAN.md](GO_LIVE_TEST_PLAN.md)). They are still not performed.
