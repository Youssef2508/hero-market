# Synchronisation: design and proof (stage 4 phase 4)

The owner's requirement (2026-10-15):

> Prove that sales, payments, stock movements and supplier receipts cannot be lost or applied twice. Versioned row copying alone is not sufficient evidence. Include atomic command application, durable queues, idempotency, conflict handling, restart recovery, and tests for duplicated, delayed, out-of-order and partially applied operations.

This document states each guarantee, the mechanism behind it, and the automated test that demonstrates it. Design decisions: D-042 and D-047 in [DECISIONS.md](DECISIONS.md).

**Status:**

- The engine and the proof suite run **locally only**. The "cloud" in every test is the cloud service running on the development PostgreSQL.
- **No cloud resource exists and nothing is hosted** (hosting awaits the owner's approval, D-043).
- The till never waits for any of this: it sells from its own database whether or not a cloud exists.

## 1. How it works

```text
 Cashier PC                                                     Cloud (owner only)
 ┌─────────────────────────────────────────────┐               ┌──────────────────────────────┐
 │ sale / payment / receipt (one transaction): │               │ cloud_rows                   │
 │   business rows                             │   push batch  │   (store, table, key) →      │
 │   + sync_outbox row per change ──────────────┼──────────────►│   newest (epoch, version)    │
 │   + sync_row_versions (current version)     │ ◄── ack after │   one transaction per batch  │
 │                                             │     commit    │                              │
 │ applied_commands (unique command id)        │   pull        │ cloud_commands               │
 │   + the command's effects, one transaction ◄┼───────────────┤   pending until the PC's     │
 │   outcome syncs back like any other row     │               │   outcome row arrives        │
 └─────────────────────────────────────────────┘               └──────────────────────────────┘
```

**Store → cloud**

- **Capture.** A trigger on each synchronised table writes one outbox row per changed row: the full new row, or a deletion marker. It runs **inside the same transaction** as the change. The version comes from one store-wide sequence.
- **Push.** The agent sends unacknowledged outbox rows in batches, oldest first.
- **Cloud apply.**
  1. The cloud replaces a row only by a **strictly newer (epoch, version)**.
  2. It keeps deletions as markers.
  3. It commits each batch **all or nothing**.
  4. It answers only after that commit.
- **Acknowledgement.** The PC marks rows acknowledged only after the cloud has answered.
- **No high-water mark.** The agent selects "not yet acknowledged", not "after id N", so a transaction that commits late is sent on the next push.
- **Whole transactions.** Every outbox row records its transaction. A batch is cut only at a transaction boundary, so the cloud holds a sale, a return or a receipt entirely or not at all. Only a bulk transaction larger than a batch can carry, such as the first snapshot, is split.
- **Exact values.** Rows travel as PostgreSQL's own JSON text, so 25.00 stays 25.00 and large or precise amounts keep every digit.

**Cloud → store (the owner's operations)**

- The owner's operations are commands with an id. Types:
  - supplier invoice (with received items, unpaid or paid outside the drawer);
  - stock receipt;
  - product edit;
  - price edit.
- The PC inserts the command id into `applied_commands` (unique) **in the same transaction** as the command's effects, so the command is applied at most once.
- The outcome row (`applied`, `partially_applied`, `rejected`) syncs back like any other row. The cloud shows a command as applied only when that row arrives.

**Epochs**

- The cloud accepts changes only for the store's **current epoch**.
- First registration takes epoch 1 and sends every existing row once.
- A restored backup starts a new epoch. An old copy of the PC (for example the broken machine coming back) is then refused and cannot overwrite the restored data.

**Recovery after a restore**

1. Each backup records where synchronisation stood: store, epoch and version.
2. When an administrator restores a backup on a PC linked to the cloud, work **pauses on every screen**. The service refuses everything except signing in, synchronisation, settings and backups.
   - This prevents a new sale from taking an invoice number that the cloud already holds for a sale made after the backup.
3. The administrator then chooses:
   - **Recover from the cloud.** The PC fetches every row and deletion newer than the backup's point and writes them back in **one transaction**, in foreign-key order. Users and roles are written only through the allow-list, so local passwords stay as they are. Id sequences continue after the recovered rows, and stock is re-checked against its movements. Then the PC takes a new epoch and sends everything once.
   - **Skip** (logged). Nothing is written back. The cloud keeps those rows and the check reports them as "only in the cloud". Nothing is deleted.
4. A replacement PC after a disk failure follows the same path: first-run setup, link to the same cloud store, restore the last backup, recover.
5. A backup that belongs to another store cannot be recovered into this one.

**Secrets never leave the PC.** Users are sent through an allow-list: id, username, role, active state and dates. Password and PIN hashes, recovery codes, sessions, role permissions, receipt templates, migrations and sync bookkeeping are not sent.

## 2. Guarantees and proof

`tests/service/sync.test.js` (18 scenarios) and `tests/service/syncRecovery.test.js` (5). Every synchronisation scenario ends with the **convergence oracle**: every synchronised row of the PC is in the cloud with **identical content (compared as text)**, and the cloud holds nothing else.

| Guarantee                                                                                                                                                               | Mechanism                                                                                       | Test (scenario)                                                                                                                                                                                               | Result |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| A committed sale, payment, movement or receipt is durably queued; a failed one queues nothing                                                                           | Capture trigger in the same transaction                                                         | _capture: a change is queued in the same transaction; a failed sale queues nothing_                                                                                                                           | Pass   |
| No secret leaves the PC                                                                                                                                                 | Allow-listed user row; excluded tables                                                          | same                                                                                                                                                                                                          | Pass   |
| Existing data is sent once at registration, then only changes                                                                                                           | Snapshot at epoch 1; outbox afterwards                                                          | _first registration sends the existing data once_                                                                                                                                                             | Pass   |
| **Duplicated** delivery doubles nothing                                                                                                                                 | (epoch, version) comparison; per-batch de-duplication                                           | _duplicated delivery: every batch arrives twice, and old acknowledged batches are replayed_ (one cloud row per PC row for sales, items, movements, drawer and customer ledger)                                | Pass   |
| A **lost answer** after the cloud committed loses nothing and doubles nothing                                                                                           | Acknowledge only on answer; re-send is a no-op                                                  | _lost answers_                                                                                                                                                                                                | Pass   |
| **Delayed** and **out-of-order** batches cannot roll a row back                                                                                                         | Strictly-newer rule                                                                             | _delayed and reordered delivery_ (stale batches delivered newest-first after the fresh one; product stock in the cloud unchanged)                                                                             | Pass   |
| A **partially applied** batch (cloud fails mid-batch) leaves no partial rows; finished batches stay; no local transaction is ever split                                 | One cloud transaction per batch; batches cut at transaction boundaries; ack after commit        | _partially applied batches_ (batches 1–2 committed and acknowledged, batch 3 rolled back, every local transaction entirely acknowledged or not at all, then completed)                                        | Pass   |
| **Outage and restart**: a backlog built offline survives an agent restart and arrives once                                                                              | Durable outbox in PostgreSQL; agent keeps no state in memory                                    | _outage and restart_                                                                                                                                                                                          | Pass   |
| **PostgreSQL connections cut** mid-cycle: no crash, nothing lost or doubled                                                                                             | Error listener on every connection (fixed here); retry                                          | _the PC's database connections are killed in the middle of a sync cycle_                                                                                                                                      | Pass   |
| A sale committing **during** a push is not skipped                                                                                                                      | No high-water mark                                                                              | _a sale committing while the agent pushes is sent on the next push_                                                                                                                                           | Pass   |
| Deletions and key changes propagate; a re-used key comes back                                                                                                           | Deletion markers; the old key is deleted when a key changes                                     | _deletions and key changes reach the cloud as deletions_                                                                                                                                                      | Pass   |
| **Owner's example**: 1 can, 10 sold offline, 24 received remotely → 15, once                                                                                            | Receipt = purchase movement; `applied_commands`                                                 | _owner's example_ (re-delivered command skipped; cloud shows "pending" until the PC's outcome arrives, then "applied"; one purchase movement)                                                                 | Pass   |
| **Atomic command application**: an interrupted command leaves nothing and is applied once later                                                                         | Command id and effects in one transaction                                                       | _a command interrupted half way_ (no purchase, movement or claim after the crash; then exactly one purchase, stock +10, supplier debt + unpaid part only, drawer untouched, audited with the command id)      | Pass   |
| **Conflicts**: fields changed on the PC since the owner's base are kept and reported; other fields apply                                                                | Base values compared at apply time                                                              | _conflicts_ (retail kept at the shop's 11, wholesale applied → partially applied; all-conflict edit → rejected)                                                                                               | Pass   |
| Refused commands are recorded once and never retried; one bad line refuses the whole command                                                                            | Rejection recorded in the same exactly-once row; savepoint rollback of the command's own writes | _refused commands_                                                                                                                                                                                            | Pass   |
| A replaced (restored) PC cannot be overwritten by an old copy                                                                                                           | Current-epoch rule                                                                              | _stale epoch_                                                                                                                                                                                                 | Pass   |
| Only the store's token is accepted                                                                                                                                      | Device token (stored hashed), constant-time compare                                             | _the cloud refuses requests without the store token_                                                                                                                                                          | Pass   |
| **Replay**: with every fault at once, the PC ends exactly where a fault-free run ends                                                                                   | All of the above                                                                                | _replay_ (stock, average costs, sales, customer and supplier balances, purchases, drawer and command outcomes identical to a clean run; oracle clean)                                                         | Pass   |
| A busy offline week catches up quickly                                                                                                                                  | Batches of 500                                                                                  | _backlog_: 400 sales = 3,200 changes in about 0.3–0.4 s on the development PC                                                                                                                                 | Pass   |
| **Restore on the same PC**: work pauses; everything made after the backup (sales, credit sale, return, repayment, purchase, remote receipt) comes back; nothing doubles | Sync point in the backup; pause; recovery in one transaction; `applied_commands` recovered      | _restore on the same PC_ (business figures after recovery **identical** to before the disaster; ledger consistent; the remote receipt not applied again; new sales get new numbers; new epoch, cloud matches) | Pass   |
| **Replacement PC** after a disk failure recovers everything; the old PC can no longer write                                                                             | Link to the same store; restore; recover; current-epoch rule                                    | _replacement PC after a disk failure_                                                                                                                                                                         | Pass   |
| Skipping recovery is explicit and logged; nothing is deleted from the cloud; the difference is reported                                                                 | `sync.skipRecovery` (confirm "SKIP")                                                            | _skipping recovery_                                                                                                                                                                                           | Pass   |
| A backup from another store cannot be recovered; an unlinked store does not pause                                                                                       | Store id check; pause only when linked                                                          | _a backup from another store…_                                                                                                                                                                                | Pass   |
| Link settings: administrators only, HTTPS, token never shown or logged                                                                                                  | `sync.manage`; checks in `sync.configure`                                                       | _link settings_                                                                                                                                                                                               | Pass   |

The suite found two real defects, both fixed in this change:

- Rows were first sent as parsed JSON, which turned `25.00` into `25`. Very large amounts could also have lost digits. Rows now travel as exact JSON text.
- A PostgreSQL connection dropped while in use raised an uncaught exception, which would have closed the app. Every connection now has an error listener (`src/server/db/pool.js`).

## 3. Limits (honest)

- **Recovery needs internet.** After a restore of a linked store, work stays paused until the administrator recovers (internet needed) or skips. This is the price of never reusing an invoice number.
- **Recovery covers only rows the cloud had** – see the next point.
- **Changes lost with a PC's disk** before they reached the cloud cannot be recovered from the cloud. Frequent sync and local backups keep that window small.
- **Same-field edits** are detected and shown, never merged automatically.
- **Not covered by the automated suite:**
  - a real internet connection;
  - a real PostgreSQL service restart on the cashier PC (simulated by cutting every connection);
  - power loss on physical hardware.

## 4. Checked in the running app (development PC, QA database, test cloud on 127.0.0.1)

1. Link the store on **المزامنة السحابية**, then press "مزامنة الآن": "كل التغييرات وصلت إلى السحابة وتطابقت".
2. An owner stock receipt of 12 was queued in the cloud. After the next sync, stock went from 6.45 to 18.45 and the cloud showed the command as "applied".
3. Take a backup, create a customer after it and sync, then restore the backup. After signing in, the "العمل متوقف مؤقتاً" dialog appeared.
4. Press "استرجاع من السحابة الآن". The customer was back and the check matched again.

## 5. Running the proof

```powershell
npm run pg:dev                                  # development PostgreSQL (another window)
node --test tests/service/sync.test.js          # the 18 synchronisation scenarios
node --test tests/service/syncRecovery.test.js  # the 5 recovery scenarios
npm test                                        # everything (176 tests)
node scripts/cloud-dev.js serve                 # a test cloud on 127.0.0.1:8790 for trying the screens
```
