# HeroMarket – Pre-production audit report

**Date:** 2026-11-13. **Audited:** `main` at `36b45c8` (release 1.6.1, schema 0037) and the deployed cloud `https://heromarket.duckdns.org`, before the owner's first pairing. **Fixes:** branch `audit/pre-production`, not merged. Supporting documents:

- [SECURITY_AUDIT.md](SECURITY_AUDIT.md)
- [SYNC_FAILURE_TEST_MATRIX.md](SYNC_FAILURE_TEST_MATRIX.md) (includes the offline/cloud parity matrix)
- [MOBILE_UX_AUDIT.md](MOBILE_UX_AUDIT.md)
- [PRODUCTION_READINESS_CHECKLIST.md](PRODUCTION_READINESS_CHECKLIST.md)

## A. Executive summary

**Verdict: CONDITIONALLY READY** for a controlled shop rollout (section I).

- **No critical findings.** No authentication or authorization bypass, no data loss, no duplicated financial operation, no divergence between the shop and the cloud.
- **Live test against the real deployed cloud:** 15/15 checks passed. Failures were injected while work was in flight:
  - the shop PC killed with 480 changes waiting;
  - the cloud service and its database restarted under load;
  - the shop off while the phone sold alone.

  Afterwards, both databases were identical row for row (2,288 rows), compared independently of the sync code.

- **Fixed, released in 1.6.2 and deployed to the cloud the same day:**

| ID     | Severity           | Fix                                                                                                                                               |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPS-01 | High (operational) | A cloud update over the owner's Wi-Fi could be cut half way and leave the website down. It now runs on its own and survives a dropped connection. |
| AUD-03 | Medium             | Malformed or oversized requests were answered 500 and logged with stack traces. They are now 400/413/415.                                         |
| SEC-07 | Medium             | The dependency audit could not fail CI. It is now a real gate with dated exceptions.                                                              |
| SEC-09 | Medium             | The cloud stack was never tested in CI. It is now started as deployed and checked from outside.                                                   |
| UX-01  | Medium             | Tablets got mouse-sized buttons. They now get finger-sized ones.                                                                                  |
| SEC-08 | Low                | Two floating image tags. Both are now pinned by digest.                                                                                           |

- **Follow-up (same day):**
  - the fixes were merged (#47) and released as **1.6.2**;
  - the installer was built by the release workflow itself, for the first time since 1.5.2;
  - the cloud was updated to 1.6.2;
  - OPS-01 was proven on the server: an update whose SSH connection was cut 4 seconds in finished by itself, and the website came back healthy.

  Section H lists what remains unverified.

## B. Architecture (as implemented)

```mermaid
flowchart LR
  subgraph Shop PC (Windows)
    UI[Electron renderer<br/>sandboxed, React] -- named IPC --> MAIN[Electron main]
    MAIN -- in-process --> SVC[HeroMarket service<br/>Fastify operations]
    BG[Background service<br/>same service, sync agent] --- PG[(PostgreSQL 17<br/>shop database)]
    SVC --- PG
  end
  subgraph Cloud (Contabo VPS, Docker)
    CADDY[Caddy<br/>TLS, headers, 20 MB cap] --> CSVC[HeroMarket service<br/>role 'cloud']
    CSVC --- CPG[(PostgreSQL 17<br/>the store's copy)]
    BK[backup<br/>age-encrypted, nightly] --- CPG
  end
  PHONE[Phone / browser] -- HTTPS, cookie session --> CADDY
  BG -- outbound HTTPS only<br/>device token --> CADDY
```

**How an operation travels:**

| Started at                                          | Handled by                                                                                                                                                                                    | Written to                           | Reaches the other side                                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Shop (till, back office)                            | the shop service, same transaction as its audit line and its outbox row                                                                                                                       | shop database                        | the agent pushes the outbox (batches, one transaction each, acknowledged after the cloud commits)                      |
| Phone, shop reachable                               | the cloud forwards it (`cloud_operations`, an id per attempt); the shop runs **the same operation handler** with the user's own permissions; the cloud answers after the changed rows arrived | shop database, then the cloud's copy | the forwarding itself                                                                                                  |
| Phone, shop unreachable                             | the cloud runs the operation on its copy, own number series (W-…), own shift                                                                                                                  | cloud database                       | the shop fetches the cloud's work when it returns, applies it once, lists anything needing a person (`sync_attention`) |
| Shop only (setup, recovery, backup, reset, pairing) | the shop                                                                                                                                                                                      | shop database                        | refused on the cloud (`shop_only`)                                                                                     |

**Trust boundaries:** see the security audit, section 1. **Duplicated logic:** none found. The business rules exist once, and the cloud runs the same handlers; the cloud's own routes cover only link bookkeeping. **Where the sides can behave differently, by design:**

- the phone's offline mode refuses "linked" operations (barcode changes, deletions);
- numbers made on the cloud working alone are W-numbers;
- the cloud has no first-run or recovery paths.

**What is proven how:**

- **Automated tests:** 542, listed per area in the matrix.
- **Live tests:** the rehearsal and the smoke test.
- **Inspection only:** the Electron IPC surface, CSP coverage, container settings.
- **Documented but not tested:** a real power cut, disk full, corrupted queue rows (section H).

## C. Security findings

The full list is in [SECURITY_AUDIT.md](SECURITY_AUDIT.md). Summary:

- **Medium:**
  - AUD-03 (500 and stack traces for malformed requests): fixed, with a regression test;
  - SEC-07 (dependency audit not a gate): fixed;
  - SEC-09 (cloud stack untested in CI): fixed.
- **Low:**
  - SEC-08 (floating image tags): fixed;
  - SEC-10 (attempt counters reset at restart): accepted;
  - SEC-11 (CSP lacks `base-uri`/`form-action`): open;
  - SEC-12 (proxy runs as root in its container): accepted.

**Verified controls:**

- proxy trust (forged addresses ignored, live);
- shop-only operations refused on the cloud (live);
- every role refused every operation it lacks, by direct request (test);
- sessions and revocation;
- CSPRNG and constant-time comparisons;
- no secrets in 281 commits;
- server hardening;
- backup encryption round trip.

## D. Data consistency results

All in [SYNC_FAILURE_TEST_MATRIX.md](SYNC_FAILURE_TEST_MATRIX.md).

**Invariants:** captured in the same transaction; at most once; acknowledged after commit; atomic batches; stale epochs refused; deletions travel; conflicts listed.

**Failure injection:** every listed scenario has a defined outcome and passed, except three that were not tested: a real power cut, disk full and corrupted queue rows.

**Live oracle:** the driver's own record of what it submitted, checked against each database:

- every sale present once, with the right total;
- stock equal to the opening stock minus what was sold, and equal to its movements;
- no orphans.

It then compared all 42 synchronised tables row for row with `to_jsonb`. 0 differences; one column differs by design (`users.recovery_hash`, D-106).

## E. Business logic results

**Existing suite:** money model, shift finality and reconciliation, returns against part-paid and credit invoices, stock ledger, discounts, manual weighing, units, purchase discounts and returns, supplier payments and reversals, reservations, invoice scope, customer codes.

**New in this audit:** AUD-05, three seeded random sequences of 120 operations: cash, card, credit and part-paid sales; returns, a quarter of them impossible; repayments; expenses.

After every step, in plain SQL:

- stock equals its movements;
- each customer's balance equals credit sales minus payments;
- nothing is returned beyond what was sold;
- **a refused operation leaves no trace**.

All held.

The test's own first version was found to exercise only error paths: customers without names made every credit sale fail. It now tallies its refusals so that this cannot hide again.

An overpayment becoming store credit was confirmed as intended: the screen asks first.

**Between the shop and the internet:** the same operation gives the same records (suite and live). The differences are intended and listed in section B.

## F. Testing evidence

| What                                        | Command                                                                                                     | Result                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Full suite (Windows, bundled PostgreSQL 17) | `npm test` with `HEROMARKET_TEST_DATABASE_URL`                                                              | **542 / 542 pass, 0 skipped**                             |
| Lint / format                               | `npm run lint`, `npm run format:check`                                                                      | 0 errors (24 older warnings, as `main`); clean            |
| Builds                                      | `npm run build`, `npm run build:web`                                                                        | ok                                                        |
| Dependency gate                             | `node scripts/audit-gate.js`                                                                                | 0 high/critical; 6 moderate (build tooling) reported      |
| Live smoke (read-only)                      | `sh scripts/cloud-smoke.sh https://heromarket.duckdns.org`                                                  | 28 / 28 pass on 1.6.2 (AUD-03 deployed)                   |
| Live rehearsal                              | `node scripts/cloud-rehearsal/run.js`                                                                       | 15 / 15 pass (2026-11-13 10:04–10:11)                     |
| Screens                                     | `node scripts/phone-check.js --width W --height H` × 9 sizes                                                | 31 screens each, 0 overflow                               |
| Backup round trip                           | download, checksum, decrypt with the owner's key (PC), `pg_restore --exit-on-error` into a scratch database | ok; contents as expected                                  |
| Update detach (OPS-01)                      | WSL with stand-in work; then the server, SSH cut 4 s into a real update                                     | completed both times; exit status passed through          |
| Installer                                   | Windows Sandbox, 1.6.0 → 1.6.1 over a running service                                                       | pairing and 177 waiting changes identical (release 1.6.1) |

**Load parameters (live):**

- 18 simultaneous checkouts (12 at the shop, 6 over the internet);
- backlogs of 120 sales, sent while the cloud restarted;
- 480 changes waiting at a crash.

A busy week offline (400 sales) catches up in under a minute (suite). No long soak test was run (section H).

## G. Mobile UX

All in [MOBILE_UX_AUDIT.md](MOBILE_UX_AUDIT.md). Nine viewport sizes from 320 × 640 to 1920 × 1080, 31 screens each:

- no sideways scrolling or cut-off content at any size, and no page errors;
- tablet touch targets fixed (UX-01: 23 screens → 4).

## H. Production blockers and open items

| Class   | Item                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLOCKER | none                                                                                                                                                                                                          |
| HIGH    | none. OPS-01, AUD-03 and the CI gates are released in 1.6.2, deployed, and proven on the server.                                                                                                              |
| MEDIUM  | Not tested: a real power cut of the shop PC (a process kill was tested; PostgreSQL's own crash recovery was not exercised), disk full, corrupted queue rows, an interrupted migration on a real installation. |
| MEDIUM  | No alerting when the cloud is down or a backup fails (budget); no off-server backup copy.                                                                                                                     |
| MEDIUM  | No long soak test (hours of activity), no test on real phones or tablets, no Electron end-to-end test of the desktop window itself.                                                                           |
| LOW     | SEC-11 CSP directives; UX-02 narrow table fields on tablets; UX-05 setup form on an unpaired cloud; older encrypted test backups in the cloud's backup volume until they expire (synthetic data only).        |

## I. Recommendation

**CONDITIONALLY READY.** The shop can start real business. No defect was found that loses, doubles or corrupts records or money, or lets anyone in who should not be.

The conditions that followed from the audit's own findings are met (1.6.2 released and deployed, OPS-01 proven on the server). One condition remains: accept the medium items in section H as known risks, or schedule them:

- no alerting;
- the untested power-cut and disk-full cases;
- no soak test;
- no tests on real phones and tablets.

## Cloud pre-handover cleanup and health verification

**Baseline, 10:31 (before any test):**

- cloud 1.6.1, schema 0037, cloud migrations 5;
- no users, stores, sessions or business rows;
- rows only in 8 seed tables (`catalog_state` 1, `client_code_series` 2, `cloud_schema_migrations` 5, `expense_categories` 7, `measure_kinds` 3, `schema_migrations` 37, `sync_state` 1, `sync_tables` 44).

Recorded on the server as `deploy/cloud/audit-baseline/` (root-only): a verified dump (63 table-data entries, restorable) and a fingerprint (row count and content hash) of all 63 tables.

**What modified the cloud:**

- the read-only smoke tests (refused requests, failed sign-ins);
- three rehearsal runs, each pairing a synthetic test store («متجر اختبار التدقيق», users `audit-owner` and `audit-cashier`, products AUD001–AUD020), with sales, expenses, a supplier payment request, shifts, the cloud's own offline shift, and restarts of the `cloud` and `db` containers;
- a scratch database for the backup restore check (dropped);
- a second scratch database for the baseline comparison (dropped).

**Cleanup strategy:** no row-by-row deletion. `deploy/cloud/reset-empty.sh`, the supported procedure:

1. it takes an encrypted copy;
2. it stops the service;
3. it drops and recreates the `heromarket` database;
4. it starts the service, which builds the schema from its migrations.

So no test row, user, session, pairing code, cloud operation, outbox, epoch or device identity can survive.

**Preserved:**

- the server;
- `deploy/cloud/.env` (secrets unchanged);
- the Caddy volumes and certificate;
- the backup volume and the owner's public key;
- the pre-update copies;
- the image `heromarket-cloud:v1.6.1`;
- DNS, the firewall (21, 22, 80, 443), SSH access.

**Verification after cleanup** (10:45–11:00):

| Check                                                                                          | Result                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tables                                                                                         | 63, same as the baseline                                                                                    |
| Rows                                                                                           | only the same 8 seed tables, same counts; every other table 0                                               |
| Seed rows field by field against the restored baseline (times and the cloud's own id excluded) | identical                                                                                                   |
| Users, sessions, stores, pairing codes, cloud operations                                       | 0                                                                                                           |
| `sync_state`                                                                                   | no epoch, link disabled, no address, no device token, id floor 1,000,000,000 (the cloud's W series)         |
| Schema / cloud migrations                                                                      | 0037 / 5                                                                                                    |
| Invalid indexes, unvalidated constraints, disabled triggers                                    | 0 / 0 / 0 (80 foreign keys, 120 checks, 67 triggers)                                                        |
| Sequences advanced                                                                             | 0                                                                                                           |
| Other databases                                                                                | none (scratch databases dropped)                                                                            |
| Restart of `cloud` and `proxy`                                                                 | healthy in seconds; fingerprint after the restart identical to before it                                    |
| `auth.status`                                                                                  | `{"needsSetup":true}`: the first-pairing state                                                              |
| HTTPS, headers, CSP, refusals, sessions                                                        | smoke test: all pass except the known AUD-03 (not yet deployed)                                             |
| Service log since the restart                                                                  | only the 2 entries caused by the smoke test's own malformed requests (AUD-03), and Caddy's 2 matching lines |
| Test agents                                                                                    | none running (no process, no listening port); the cloud has no store, so a stray agent would be refused     |

**Remaining:**

- Three encrypted copies of synthetic test data (`heromarket-cloud-20261113-115815`, `-120427`, `-124655`), made by `reset-empty.sh`, remain in the backup volume and expire after 14 days. Deleting backup files was outside this audit's authorization; say if they should be removed sooner.
- An authenticated API check is not possible on the clean cloud by design: it has no users until the shop is paired. Authenticated paths were exercised during the rehearsal.
- On this PC, the 13 disposable test databases were dropped and the decrypted backup copy deleted.
